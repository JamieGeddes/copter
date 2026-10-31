/**
 * Synthesised helicopter sound: filtered noise chopped at the blade-pass frequency,
 * an engine drone and a faint turbine whine. Must be started from a user gesture.
 */
export class RotorAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private chopGain?: GainNode;
  private lfo?: OscillatorNode;
  private lfoDepth?: GainNode;
  /** Second chop for tandem rotors, slightly detuned so the two beat against each other. */
  private lfo2?: OscillatorNode;
  private lfo2Depth?: GainNode;
  private noiseFilter?: BiquadFilterNode;
  private drone?: OscillatorNode;
  private droneGain?: GainNode;
  private whine?: OscillatorNode;
  private whineGain?: GainNode;
  private muted = false;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // Looping brown-ish noise.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'lowpass';
    this.noiseFilter.frequency.value = 500;
    this.noiseFilter.Q.value = 0.8;

    this.chopGain = ctx.createGain();
    this.chopGain.gain.value = 0;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sawtooth';
    this.lfo.frequency.value = 0;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth).connect(this.chopGain.gain);
    this.lfo2 = ctx.createOscillator();
    this.lfo2.type = 'sawtooth';
    this.lfo2.frequency.value = 0;
    this.lfo2Depth = ctx.createGain();
    this.lfo2Depth.gain.value = 0;
    this.lfo2.connect(this.lfo2Depth).connect(this.chopGain.gain);

    noise.connect(this.noiseFilter).connect(this.chopGain).connect(this.master);

    this.drone = ctx.createOscillator();
    this.drone.type = 'sawtooth';
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 180;
    this.drone.connect(droneFilter).connect(this.droneGain).connect(this.master);

    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);

    noise.start();
    this.lfo.start();
    this.lfo2.start();
    this.drone.start();
    this.whine.start();
  }

  /** Shared context and output bus for other sounds. Undefined until `start`. */
  get context(): AudioContext | undefined {
    return this.ctx;
  }

  get output(): GainNode | undefined {
    return this.master;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * @param spool rotor speed 0..1
   * @param load collective effort 0..1 (climbing or manoeuvring makes it beat harder)
   * @param bladeRate blade passes per second at full rotor speed
   * @param twin tandem rotors: adds a second, detuned chop
   */
  update(spool: number, load: number, bladeRate = 10.5, twin = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.lfo || !this.chopGain || !this.lfoDepth || !this.noiseFilter || !this.drone || !this.droneGain || !this.whine || !this.whineGain) return;
    const t = ctx.currentTime;
    const k = 0.08;
    this.lfo.frequency.setTargetAtTime(Math.max(0.01, bladeRate * spool), t, k);
    const level = Math.min(1, spool * 1.2);
    this.chopGain.gain.setTargetAtTime(level * (0.35 + load * 0.15), t, k);
    this.lfoDepth.gain.setTargetAtTime(level * (0.25 + load * 0.2), t, k);
    if (this.lfo2 && this.lfo2Depth) {
      this.lfo2.frequency.setTargetAtTime(Math.max(0.01, bladeRate * spool * 1.035), t, k);
      this.lfo2Depth.gain.setTargetAtTime(twin ? level * (0.2 + load * 0.15) : 0, t, k);
    }
    this.noiseFilter.frequency.setTargetAtTime(280 + spool * 380 + load * 420, t, k);
    this.drone.frequency.setTargetAtTime(30 + spool * 28, t, k);
    this.droneGain.gain.setTargetAtTime(spool * 0.14, t, k);
    this.whine.frequency.setTargetAtTime(500 + spool * 1600, t, k);
    this.whineGain.gain.setTargetAtTime(spool * 0.012, t, k);
  }
}
