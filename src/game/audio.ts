// Synthesized sound: no asset files. Everything is Web Audio oscillators and noise.
// Safe to call anywhere: it does nothing until a user gesture unlocks the AudioContext, and in
// environments without Web Audio (tests, SSR).

export type SoundName =
  | "switch" | "tip" | "break" | "dig" | "load" | "dump" | "fill" | "win"
  | "chop" | "fell" | "hook" | "stack" | "deliver";

type Ctx = AudioContext;

export interface EngineState {
  /** 0..1 fraction of the machine's top speed. */
  speed: number;
  /** -1..1 */
  throttle: number;
  /** machine is mid-action (digging, sawing...) */
  working: boolean;
  /** heavier = lower rumble */
  weight: number;
  reversing: boolean;
}

export class GameAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private engine: { osc: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private nextBeep = 0;
  muted = false;

  /** Call from a keydown / click handler. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return; }
    const AC = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(ctx.destination);
      const osc = ctx.createOscillator(), sub = ctx.createOscillator();
      osc.type = "sawtooth"; sub.type = "square";
      const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 300;
      const gain = ctx.createGain(); gain.gain.value = 0;
      osc.connect(filter); sub.connect(filter); filter.connect(gain); gain.connect(this.master);
      osc.start(); sub.start();
      this.engine = { osc, sub, filter, gain };
      const len = ctx.sampleRate * 0.6, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch { this.ctx = null; }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.03);
  }

  /** Silence the engine (menu, help popup). */
  idle() {
    if (this.engine && this.ctx) this.engine.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  update(s: EngineState) {
    const { ctx, engine } = this;
    if (!ctx || !engine) return;
    const t = ctx.currentTime;
    const base = 34 + (1 - s.weight) * 26; // heavier machines idle lower
    const f = base + s.speed * 70 + Math.abs(s.throttle) * 12 + (s.working ? 18 : 0);
    engine.osc.frequency.setTargetAtTime(f, t, 0.08);
    engine.sub.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    engine.filter.frequency.setTargetAtTime(220 + s.speed * 500 + (s.working ? 150 : 0), t, 0.1);
    engine.gain.gain.setTargetAtTime(0.11 + s.speed * 0.07 + (s.working ? 0.05 : 0), t, 0.1);
    if (s.reversing && t > this.nextBeep) { this.nextBeep = t + 0.8; this.tone(1000, 0.2, "square", 0.05); }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff: number, delay = 0) {
    const { ctx, master, noiseBuf } = this;
    if (!ctx || !master || !noiseBuf) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02);
  }

  play(name: SoundName) {
    switch (name) {
      case "switch": this.tone(520, 0.08, "square", 0.08); this.tone(780, 0.1, "square", 0.08, undefined, 0.07); break;
      case "tip": this.noise(0.6, 0.5, 900); this.tone(120, 0.5, "sine", 0.4, 40); break;
      case "break": this.noise(0.5, 0.6, 2500); this.tone(90, 0.35, "sine", 0.5, 35); break; // rock thud + crack
      case "dig": this.noise(0.3, 0.35, 1200); this.tone(70, 0.2, "sine", 0.3, 40); break;
      case "load": this.noise(0.25, 0.3, 1500); this.tone(100, 0.25, "triangle", 0.3, 60); break;
      case "dump": this.noise(0.7, 0.4, 1800); break;
      case "fill": this.noise(0.35, 0.3, 700); this.tone(60, 0.3, "sine", 0.3, 35); break;
      case "chop": this.noise(0.12, 0.35, 3500); this.tone(180, 0.1, "square", 0.08, 90); break;
      case "fell": this.noise(0.9, 0.45, 1400); this.tone(80, 0.6, "sine", 0.5, 30, 0.35); break; // crash then thump
      case "hook": this.tone(260, 0.12, "square", 0.1, 160); this.noise(0.15, 0.25, 900); break;
      case "stack": this.tone(110, 0.3, "triangle", 0.4, 50); this.noise(0.3, 0.3, 1000); break;
      case "deliver": this.tone(660, 0.12, "triangle", 0.12); this.tone(880, 0.12, "triangle", 0.12, undefined, 0.1); this.tone(1320, 0.25, "triangle", 0.12, undefined, 0.2); break;
      case "win": [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, "triangle", 0.14, undefined, i * 0.13)); break;
    }
  }
}
