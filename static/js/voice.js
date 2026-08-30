const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

class VoiceChat {
  constructor() {
    this.pcs = new Map();
    this.streams = new Map();
    this.elements = new Map();
    this.videos = new Map();
    this.analysers = new Map();
    this.speaking = new Set();
    this.localStream = null;
    this.screenStream = null;
    this.channelId = null;
    this.myId = null;
    this.muted = false;
    this.deafened = false;
    this.sharing = false;
    this.makingOffer = new Set();
    this.onSpeaking = () => {};
    this.onShareChange = () => {};
    this._raf = 0;
  }

  remoteVideo(userId) {
    return this.videos.get(Number(userId));
  }

  async join(channelId, existingPeers, send, myId) {
    this.send = send;
    this.myId = myId;
    if (this.channelId === channelId) return;
    await this.leave(false);
    this.channelId = channelId;
    this.myId = myId;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this._watchLocal();
    this._applyTracks();
    for (const peer of existingPeers) {
      await this._offer(peer.id);
    }
    this._loop();
  }

  async leave(notify = true) {
    await this.stopShare(false);
    this.channelId = null;
    for (const [userId] of [...this.pcs]) this._dropPeer(userId);
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this._raf) cancelAnimationFrame(this._raf);
    this.speaking.clear();
    if (notify && this.send) this.send({ type: "voice_leave" });
  }

  setMuted(muted) {
    this.muted = muted;
    this._applyTracks();
    this._emitState();
  }

  setDeafened(deafened) {
    this.deafened = deafened;
    if (deafened) this.muted = true;
    this._applyTracks();
    for (const el of this.elements.values()) el.muted = deafened;
    this._emitState();
  }

  _videoSender(pc) {
    return pc.getSenders().find((sender) => {
      if (sender.track && sender.track.kind === "video") return true;
      const params = sender.getParameters ? sender.getParameters() : null;
      return Boolean(params && params.encodings && !sender.track);
    }) || pc.getSenders().find((sender) => !sender.track);
  }

  async startShare() {
    if (this.sharing || !this.channelId) return;
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 24, width: { max: 1920 }, height: { max: 1080 } },
      audio: false,
    });
    const videoTrack = this.screenStream.getVideoTracks()[0];
    if (!videoTrack) throw new Error("Nenhuma tela foi escolhida.");
    videoTrack.onended = () => { this.stopShare(); };
    this.sharing = true;
    for (const [id, pc] of this.pcs) {
      const sender = pc.getSenders().find((item) => !item.track || item.track.kind === "video");
      if (sender) await sender.replaceTrack(videoTrack);
      else pc.addTrack(videoTrack, this.screenStream);
      await this._offer(id);
    }
    this._emitState();
    this.onShareChange();
  }

  async stopShare(renegotiate = true) {
    if (!this.sharing && !this.screenStream) return;
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }
    this.sharing = false;
    if (renegotiate) {
      for (const [id, pc] of this.pcs) {
        for (const sender of pc.getSenders()) {
          if (sender.track && sender.track.kind === "video") {
            try { await sender.replaceTrack(null); } catch (_) {}
          }
        }
        await this._offer(id);
      }
    }
    this._emitState();
    this.onShareChange();
  }

  _emitState() {
    if (this.send) {
      this.send({
        type: "voice_state",
        muted: this.muted,
        deafened: this.deafened,
        sharing: this.sharing,
      });
    }
  }

  _polite(peerId) {
    return Number(this.myId) > Number(peerId);
  }

  async onOffer(fromId, sdp) {
    const pc = this._peer(fromId);
    try {
      if (pc.signalingState !== "stable") {
        if (!this._polite(fromId)) return;
        try { await pc.setLocalDescription({ type: "rollback" }); } catch (_) {}
      }
      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ type: "webrtc_answer", target_id: fromId, sdp: pc.localDescription });
    } catch (_) {}
  }

  async onAnswer(fromId, sdp) {
    const pc = this.pcs.get(fromId);
    if (!pc) return;
    try {
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(sdp);
      }
    } catch (_) {}
  }

  async onIce(fromId, candidate) {
    const pc = this.pcs.get(fromId);
    if (pc && candidate) {
      try { await pc.addIceCandidate(candidate); } catch (_) {}
    }
  }

  drop(userId) {
    this._dropPeer(userId);
  }

  async ensurePeer(userId, myId) {
    this.myId = myId ?? this.myId;
    if (!this.channelId || userId === myId || this.pcs.has(userId)) return;
    if (myId && userId < myId) return;
    await this._offer(userId);
  }

  _peer(userId) {
    if (this.pcs.has(userId)) return this.pcs.get(userId);
    const pc = new RTCPeerConnection(ICE);
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream));
    }
    if (this.screenStream) {
      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) pc.addTrack(videoTrack, this.screenStream);
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) this.send({ type: "webrtc_ice", target_id: userId, candidate: event.candidate });
    };
    pc.ontrack = (event) => {
      const track = event.track;
      if (track.kind === "video") {
        let stream = this.videos.get(userId);
        if (!stream) {
          stream = new MediaStream();
          this.videos.set(Number(userId), stream);
        }
        if (!stream.getTrackById(track.id)) stream.addTrack(track);
        track.onended = () => {
          stream.removeTrack(track);
          if (!stream.getVideoTracks().length) this.videos.delete(Number(userId));
          this.onShareChange();
        };
        this.onShareChange();
        return;
      }
      const stream = event.streams[0] || new MediaStream([track]);
      this.streams.set(userId, stream);
      let audio = this.elements.get(userId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        this.elements.set(userId, audio);
      }
      audio.srcObject = stream;
      audio.muted = this.deafened;
      this._watchRemote(userId, stream);
    };
    this.pcs.set(userId, pc);
    return pc;
  }

  async _offer(userId) {
    const pc = this._peer(userId);
    if (this.makingOffer.has(userId) || pc.signalingState !== "stable") return;
    this.makingOffer.add(userId);
    try {
      const hasVideo = pc.getTransceivers().some((item) => item.receiver?.track?.kind === "video" || item.sender?.track?.kind === "video");
      if (!hasVideo) pc.addTransceiver("video", { direction: "sendrecv" });
      const offer = await pc.createOffer();
      if (pc.signalingState !== "stable") return;
      await pc.setLocalDescription(offer);
      this.send({ type: "webrtc_offer", target_id: userId, sdp: pc.localDescription });
    } catch (_) {
    } finally {
      this.makingOffer.delete(userId);
    }
  }

  _dropPeer(userId) {
    const pc = this.pcs.get(userId);
    if (pc) pc.close();
    this.pcs.delete(userId);
    this.streams.delete(userId);
    this.videos.delete(Number(userId));
    const audio = this.elements.get(userId);
    if (audio) {
      audio.srcObject = null;
      this.elements.delete(userId);
    }
    this.analysers.delete(userId);
    this.speaking.delete(userId);
  }

  _applyTracks() {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.muted && !this.deafened;
    });
  }

  _watchLocal() {
    this._watchRemote("local", this.localStream);
  }

  _watchRemote(id, stream) {
    try {
      if (!stream.getAudioTracks().length) return;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.analysers.set(id, { analyser, data: new Uint8Array(analyser.frequencyBinCount) });
    } catch (_) {}
  }

  _loop() {
    let n = 0;
    const tick = () => {
      n += 1;
      if (n % 4 === 0) {
        const next = new Set();
        for (const [id, pack] of this.analysers) {
          pack.analyser.getByteFrequencyData(pack.data);
          let sum = 0;
          for (let i = 0; i < pack.data.length; i += 4) sum += pack.data[i];
          if (sum / (pack.data.length / 4) > 14) next.add(id === "local" ? "me" : Number(id));
        }
        this.speaking = next;
        this.onSpeaking(next);
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
}

window.VoiceChat = VoiceChat;
