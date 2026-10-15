/** Procedural audio only: no samples, downloads, or background autoplay. */
export class SynthAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.volume = 0.45;
    this.muted = false;
    this.disposed = false;
    this.engineNodes = [];
    this.effects = new Set();
    this.noiseBuffer = null;
  }

  async enable() {
    if (this.disposed) return false;
    try {
      if (!this.context) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) return false;
        this.context = new Context();
        const ctx = this.context;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(ctx.destination);
        this.noiseBuffer = this.createNoise(2);
        this.engineGain = ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineFilter = ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 320;
        this.engineFilter.Q.value = 0.65;
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.master);
        this.engine = ctx.createOscillator();
        this.engine.type = 'sawtooth';
        this.engine.frequency.value = 42;
        this.engine.connect(this.engineFilter);
        this.harmonic = ctx.createOscillator();
        this.harmonic.type = 'triangle';
        this.harmonic.frequency.value = 84;
        const harmonicGain = ctx.createGain();
        harmonicGain.gain.value = 0.35;
        this.harmonic.connect(harmonicGain);
        harmonicGain.connect(this.engineFilter);
        this.wind = ctx.createBufferSource();
        this.wind.buffer = this.noiseBuffer;
        this.wind.loop = true;
        this.windFilter = ctx.createBiquadFilter();
        this.windFilter.type = 'highpass';
        this.windFilter.frequency.value = 950;
        this.windGain = ctx.createGain();
        this.windGain.gain.value = 0;
        this.wind.connect(this.windFilter);
        this.windFilter.connect(this.windGain);
        this.windGain.connect(this.master);
        this.engineNodes = [this.engine, this.harmonic, this.wind, harmonicGain,
          this.engineFilter, this.engineGain, this.windFilter, this.windGain];
        this.engine.start();
        this.harmonic.start();
        this.wind.start();
      }
      if (this.context.state === 'suspended') await this.context.resume();
      return this.context.state === 'running';
    } catch {
      // Audio is optional. A blocked device or browser leaves the game playable.
      return false;
    }
  }

  createNoise(seconds) {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    return buffer;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.setMasterGain();
  }

  setVolume(volume) {
    const next = Number(volume);
    if (Number.isFinite(next)) this.volume = Math.max(0, Math.min(1, next));
    this.setMasterGain();
  }

  setMasterGain() {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.025);
  }

  update(state = {}, dt = 1 / 60) {
    if (!this.context || !this.engineGain || this.disposed) return;
    const now = this.context.currentTime;
    const racing = ['running', 'playing', 'racing'].includes(state.status);
    const speed = Math.max(0, Number(state.speedKmh ?? state.speed) || 0);
    const timeScale = Math.max(0.1, Math.min(1, Number(state.timeScale) || 1));
    const speedRatio = Math.min(1.5, speed / 170);
    const smooth = Math.max(0.025, Math.min(0.12, (Number(dt) || 1 / 60) * 3));
    const pitch = (38 + Math.min(260, speed) * 0.72) * (0.48 + 0.52 * timeScale);
    this.engine.frequency.setTargetAtTime(pitch, now, smooth);
    this.harmonic.frequency.setTargetAtTime(pitch * 2.01, now, smooth);
    this.engineFilter.frequency.setTargetAtTime(220 + speedRatio * 1150, now, smooth);
    this.engineGain.gain.setTargetAtTime(racing ? 0.055 + speedRatio * 0.02 : 0, now, smooth);
    this.windGain.gain.setTargetAtTime(racing ? speedRatio * speedRatio * 0.018 : 0, now, smooth);
    this.wind.playbackRate.setTargetAtTime(0.6 + timeScale * 0.4, now, smooth);
  }

  tone(frequency, duration, delay = 0, gain = 0.09, type = 'sine', endFrequency = frequency) {
    const ctx = this.context;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + Math.min(0.012, duration / 4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    this.trackEffect(oscillator, [envelope]);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  noise(duration, gain, frequency, endFrequency = frequency, delay = 0, filterType = 'lowpass') {
    const ctx = this.context;
    const start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const envelope = ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    this.trackEffect(source, [filter, envelope]);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  trackEffect(source, nodes) {
    const effect = { source, nodes };
    this.effects.add(effect);
    source.onended = () => {
      source.disconnect();
      for (const node of nodes) node.disconnect();
      this.effects.delete(effect);
    };
  }

  play(type) {
    if (!this.context || this.context.state !== 'running' || this.disposed || this.muted) return;
    switch (type) {
      case 'start':
        this.tone(330, 0.12, 0, 0.075);
        this.tone(660, 0.22, 0.14, 0.08);
        break;
      case 'collision':
        this.noise(0.28, 0.24, 1900, 180);
        this.tone(125, 0.2, 0, 0.13, 'triangle', 48);
        break;
      case 'slow':
        this.tone(680, 0.7, 0, 0.085, 'sine', 130);
        this.noise(0.45, 0.035, 1500, 220);
        break;
      case 'explosion':
        this.noise(1.5, 0.32, 4000, 60);
        this.tone(95, 0.8, 0, 0.2, 'sine', 25);
        break;
      case 'finish':
        [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => {
          this.tone(note, index === 3 ? 0.6 : 0.25, index * 0.12, 0.065, 'triangle');
        });
        break;
      case 'grand-prize':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((note, i) => {
          this.tone(note, 0.55, i * 0.14, 0.045, 'triangle');
        });
        this.play('cheer');
        break;
      case 'cheer':
        // Synthesized crowd wash, applause bursts and rising whistles; no samples.
        this.noise(1.8, 0.045, 850, 1400, 0, 'bandpass');
        for (let i = 0; i < 14; i++) this.noise(0.09, 0.035, 2800, 1100, i * 0.105);
        this.tone(720, 0.45, 0.18, 0.018, 'sine', 1120);
        this.tone(880, 0.55, 0.48, 0.015, 'sine', 1360);
        break;
      case 'tick':
        this.tone(880, 0.08, 0, 0.055);
        break;
      default:
        break;
    }
  }

  dispose() {
    this.disposed = true;
    for (const effect of this.effects) {
      effect.source.onended = null;
      try { effect.source.stop(); } catch { /* Source may already have ended. */ }
      effect.source.disconnect();
      for (const node of effect.nodes) node.disconnect();
    }
    this.effects.clear();
    for (const node of this.engineNodes) {
      if (typeof node.stop === 'function') {
        try { node.stop(); } catch { /* Oscillator may already be stopped. */ }
      }
      node.disconnect();
    }
    this.engineNodes.length = 0;
    this.master?.disconnect();
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
