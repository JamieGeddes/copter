import { RotorAudio } from './RotorAudio';

export type SfxName = 'gate' | 'objective' | 'complete' | 'fail' | 'attach' | 'rescued' | 'warning' | 'move' | 'select' | 'unload';

type Note = [frequency: number, start: number, duration: number];

const SEQUENCES: Record<SfxName, { notes: Note[]; type: OscillatorType; gain: number }> = {
  gate: { notes: [[880, 0, 0.08], [1320, 0.07, 0.12]], type: 'square', gain: 0.06 },
  objective: { notes: [[523, 0, 0.1], [659, 0.09, 0.1], [784, 0.18, 0.22]], type: 'square', gain: 0.07 },
  complete: {
    notes: [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.12], [1047, 0.36, 0.3], [784, 0.62, 0.1], [1047, 0.72, 0.45]],
    type: 'square',
    gain: 0.08,
  },
  fail: { notes: [[392, 0, 0.18], [330, 0.18, 0.18], [262, 0.36, 0.45]], type: 'triangle', gain: 0.12 },
  attach: { notes: [[660, 0, 0.05], [660, 0.08, 0.05]], type: 'square', gain: 0.05 },
  rescued: { notes: [[784, 0, 0.1], [988, 0.1, 0.1], [1175, 0.2, 0.2]], type: 'triangle', gain: 0.12 },
  warning: { notes: [[1000, 0, 0.12], [1000, 0.25, 0.12]], type: 'square', gain: 0.05 },
  move: { notes: [[660, 0, 0.04]], type: 'square', gain: 0.04 },
  select: { notes: [[660, 0, 0.05], [990, 0.05, 0.08]], type: 'square', gain: 0.05 },
  unload: { notes: [[587, 0, 0.08], [880, 0.08, 0.12]], type: 'triangle', gain: 0.1 },
};

/** Short chiptune cues plus a looping winch motor whine. */
export class Sfx {
  private readonly audio: RotorAudio;
  private winchOsc?: OscillatorNode;
  private winchGain?: GainNode;

  constructor(audio: RotorAudio) {
    this.audio = audio;
  }

  play(name: SfxName): void {
    const ctx = this.audio.context;
    const out = this.audio.output;
    if (!ctx || !out) return;
    const seq = SEQUENCES[name];
    const t0 = ctx.currentTime + 0.01;
    for (const [freq, start, dur] of seq.notes) {
      const osc = ctx.createOscillator();
      osc.type = seq.type;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + start);
      g.gain.linearRampToValueAtTime(seq.gain, t0 + start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(g).connect(out);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.05);
    }
  }

  /** Winch motor sound; `rate` is cable speed in m/s (0 to stop). */
  setWinch(rate: number): void {
    const ctx = this.audio.context;
    const out = this.audio.output;
    if (!ctx || !out) return;
    if (!this.winchOsc) {
      this.winchOsc = ctx.createOscillator();
      this.winchOsc.type = 'sawtooth';
      this.winchGain = ctx.createGain();
      this.winchGain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      this.winchOsc.connect(filter).connect(this.winchGain).connect(out);
      this.winchOsc.start();
    }
    const t = ctx.currentTime;
    this.winchOsc.frequency.setTargetAtTime(120 + Math.abs(rate) * 40, t, 0.05);
    this.winchGain!.gain.setTargetAtTime(rate !== 0 ? 0.05 : 0, t, 0.05);
  }
}
