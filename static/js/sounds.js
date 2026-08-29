class NexusSounds {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem("nexus_sfx") !== "off";
    this.master = Number(localStorage.getItem("nexus_sfx_vol") || 0.42);
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem("nexus_sfx", on ? "on" : "off");
  }

  setVolume(value) {
    this.master = Math.min(1, Math.max(0.05, Number(value) || 0.42));
    localStorage.setItem("nexus_sfx_vol", String(this.master));
  }

  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) this.ctx = new AudioCtx();
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  play(name) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const fn = this[name];
    if (typeof fn === "function") fn.call(this, now);
  }

  join(t) {
    this._blip(t, 784, 0.07, 0.22);
    this._blip(t + 0.09, 1047, 0.1, 0.24);
  }

  leave(t) {
    this._blip(t, 932, 0.07, 0.18);
    this._blip(t + 0.1, 622, 0.12, 0.2);
  }

  disconnect(t) {
    this._blip(t, 392, 0.09, 0.16, "triangle");
    this._blip(t + 0.1, 311, 0.1, 0.15, "triangle");
    this._blip(t + 0.21, 233, 0.16, 0.18, "sine");
  }

  mute(t) {
    this._blip(t, 420, 0.05, 0.14);
    this._slide(t, 420, 260, 0.07, 0.1);
  }

  unmute(t) {
    this._slide(t, 260, 480, 0.07, 0.12);
    this._blip(t + 0.04, 620, 0.05, 0.1);
  }

  deafen(t) {
    this._blip(t, 300, 0.05, 0.12);
    this._blip(t + 0.06, 190, 0.08, 0.14);
  }

  undeafen(t) {
    this._blip(t, 220, 0.05, 0.1);
    this._blip(t + 0.06, 420, 0.07, 0.13);
  }

  message(t) {
    this._blip(t, 880, 0.045, 0.12, "sine");
    this._blip(t + 0.05, 1175, 0.07, 0.14, "triangle");
  }

  mention(t) {
    this._blip(t, 988, 0.05, 0.16);
    this._blip(t + 0.07, 1319, 0.08, 0.18);
    this._blip(t + 0.15, 1568, 0.06, 0.12);
  }

  _blip(when, freq, dur, vol, type = "sine") {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq * 3.2, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(this.master * vol, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.03);
  }

  _slide(when, from, to, dur, vol) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), when + dur);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(this.master * vol, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }
}

window.Sfx = new NexusSounds();
document.addEventListener("pointerdown", () => window.Sfx.unlock(), { once: true });
