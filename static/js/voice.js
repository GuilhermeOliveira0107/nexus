const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
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
    this.muted = false;
    this.deafened = false;
    this.sharing = false;
    this.onSpeaking = () => {};
    this.onShareChange = () => {};
    this._raf = 0;
  }

  remoteVideo(userId) {
    return this.videos.get(Number(userId));
  }

  async join(channelId, existingPeers, send) {
    this.send = send;
    if (this.channelId === channelId) return;
    await this.leave(false);
    this.channelId = channelId;
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

  async startShare() {
    if (this.sharing || !this.channelId) return;
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 24, width: { max: 1920 }, height: { max: 1080 } },
      audio: true,
    });
    this.sharing = true;
    this.screenStream.getTracks().forEach((track) => {
      track.onended = () => { this.stopShare(); };
      for (const pc of this.pcs.values()) pc.addTrack(track, this.screenStream);
    });
    for (const id of this.pcs.keys()) await this._offer(id);
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
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === "video") {
            try { pc.removeTrack(sender); } catch (_) {}
          }
        });
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

  async onOffer(fromId, sdp) {
    const pc = this._peer(fromId);
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({ type: "webrtc_answer", target_id: fromId, sdp: pc.localDescription });
  }

  async onAnswer(fromId, sdp) {
    const pc = this.pcs.get(fromId);
    if (pc) await pc.setRemoteDescription(sdp);
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
      this.screenStream.getTracks().forEach((track) => pc.addTrack(track, this.screenStream));
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) this.send({ type: "webrtc_ice", target_id: userId, candidate: event.candidate });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      if (event.track.kind === "video") {
        this.videos.set(userId, stream);
        event.track.onended = () => {
          this.videos.delete(userId);
          this.onShareChange();
        };
        this.onShareChange();
        return;
      }
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
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "webrtc_offer", target_id: userId, sdp: pc.localDescription });
  }

  _dropPeer(userId) {
    const pc = this.pcs.get(userId);
    if (pc) pc.close();
    this.pcs.delete(userId);
    this.streams.delete(userId);
    this.videos.delete(userId);
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
