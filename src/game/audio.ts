/* 程序化 WebAudio 音效：环境嗡鸣、穿越风声、拾取钟鸣、心跳、低语、死亡与胜利 */
export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambOscA: OscillatorNode | null = null;
  private ambOscB: OscillatorNode | null = null;
  private ambGain: GainNode | null = null;
  private airGain: GainNode | null = null;
  muted = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(this.ctx.destination);
    // 白噪声缓冲
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** 启动/切换群系环境音 */
  setAmbient(baseFreq: number, dark = 0) {
    this.ensure();
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    if (!this.ambOscA) {
      this.ambGain = this.ctx.createGain();
      this.ambGain.gain.value = 0;
      this.ambGain.connect(this.master);
      this.ambOscA = this.ctx.createOscillator();
      this.ambOscB = this.ctx.createOscillator();
      this.ambOscA.type = "sine";
      this.ambOscB.type = "triangle";
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.35;
      this.ambOscA.connect(this.ambGain);
      this.ambOscB.connect(g2);
      g2.connect(this.ambGain);
      this.ambOscA.start();
      this.ambOscB.start();
      // 空气噪声
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      this.airGain = this.ctx.createGain();
      this.airGain.gain.value = 0.028;
      src.connect(lp);
      lp.connect(this.airGain);
      this.airGain.connect(this.master);
      src.start();
    }
    const a = this.ambOscA;
    const b = this.ambOscB;
    const g = this.ambGain;
    if (!a || !b || !g) return;
    a.frequency.setTargetAtTime(baseFreq, t, 1.4);
    b.frequency.setTargetAtTime(baseFreq * 1.498 + dark * 3, t, 1.4);
    g.gain.setTargetAtTime(0.05, t, 1.2);
  }

  stopAmbient() {
    if (this.ambGain && this.ctx)
      this.ambGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.3);
  }

  private env(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, delay = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  whoosh() {
    this.noise(0.9, 0.16, 900, 0.6);
    this.env("sine", 160, 60, 0.8, 0.08);
  }
  step() {
    this.noise(0.09, 0.07, 500, 0.8);
  }
  thud() {
    this.env("sine", 90, 38, 0.28, 0.22);
    this.noise(0.12, 0.1, 220, 1);
  }
  chime(stepIdx: number) {
    const base = 660 * Math.pow(1.06, stepIdx);
    this.env("sine", base, base, 0.9, 0.12);
    this.env("sine", base * 1.5, base * 1.5, 1.1, 0.08, 0.07);
    this.env("sine", base * 2, base * 2, 1.3, 0.05, 0.14);
    this.noise(0.5, 0.03, 3600, 2, 0.02);
  }
  heartbeat(intensity: number) {
    const v = 0.1 + intensity * 0.16;
    this.env("sine", 58, 34, 0.16, v);
    this.env("sine", 52, 30, 0.14, v * 0.8, 0.22);
  }
  whisper() {
    this.noise(0.7, 0.05, 1400 + Math.random() * 900, 3);
    this.noise(0.5, 0.04, 800 + Math.random() * 500, 4, 0.18);
  }
  awaken() {
    this.env("sawtooth", 55, 110, 1.6, 0.09);
    this.env("sine", 220, 55, 1.6, 0.1, 0.1);
    this.noise(1.4, 0.06, 300, 0.7, 0.1);
  }
  sting() {
    this.env("sawtooth", 200, 36, 1.1, 0.2);
    this.env("sawtooth", 203, 34, 1.1, 0.14, 0.03);
    this.noise(1.0, 0.14, 260, 0.6);
  }
  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.env("sine", n, n, 1.6, 0.1, i * 0.16);
      this.env("triangle", n * 2, n * 2, 1.2, 0.04, i * 0.16);
    });
  }
}
