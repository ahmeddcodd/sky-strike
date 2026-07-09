// All SFX are synthesized with the Web Audio API — zero audio files in the bundle.
// The context is created/resumed on the first user gesture (mobile autoplay rules).

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  /** Call from a user gesture (pointerdown) to unlock audio on mobile. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this.makeNoise();
      } catch {
        return; // no audio support — game stays silent
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private noise(duration: number, filterType: BiquadFilterType, freq: number, gain: number, freqEnd?: number): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  private tone(type: OscillatorType, freq: number, duration: number, gain: number, freqEnd?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  shoot(): void {
    // short punchy noise burst, slightly detuned each shot so holding fire doesn't drone
    this.noise(0.09, "bandpass", 1400 + Math.random() * 500, 0.35, 500);
    this.tone("square", 210 + Math.random() * 40, 0.05, 0.06, 90);
  }

  hit(): void {
    this.tone("square", 1250 + Math.random() * 250, 0.05, 0.12, 700);
  }

  explosion(): void {
    this.noise(0.55, "lowpass", 2800, 0.7, 160);
    this.tone("sine", 95, 0.45, 0.5, 34);
  }

  playerDamage(): void {
    this.noise(0.3, "lowpass", 700, 0.55, 90);
    this.tone("sawtooth", 130, 0.35, 0.3, 55);
  }

  uiTap(): void {
    this.tone("triangle", 620, 0.07, 0.18, 880);
  }

  gameOver(): void {
    this.tone("sawtooth", 330, 0.55, 0.22, 82);
    this.noise(0.6, "lowpass", 1200, 0.3, 100);
  }

  waveStart(): void {
    // two-note alert riser
    this.tone("square", 392, 0.14, 0.14);
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(523, t + 0.16);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(0.14, t + 0.16);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.connect(g).connect(this.master);
      osc.start(t + 0.16);
      osc.stop(t + 0.5);
    }
  }

  /** Distant enemy gunfire crack — quieter than the player's guns. */
  enemyFire(): void {
    this.noise(0.08, "bandpass", 900 + Math.random() * 300, 0.12, 380);
  }

  /** Heavy-bullets / missile-launch variant of shoot(): lower and punchier. */
  shootHeavy(): void {
    this.noise(0.11, "bandpass", 800 + Math.random() * 300, 0.5, 260);
    this.tone("square", 150 + Math.random() * 30, 0.07, 0.1, 70);
  }

  /** Urgent two-tone missile warning, repeated three times. */
  missileAlarm(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      [880, 620].forEach((freq, j) => {
        const start = t + i * 0.28 + j * 0.13;
        const osc = this.ctx!.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, start);
        const g = this.ctx!.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.setValueAtTime(0.11, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
        osc.connect(g).connect(this.master!);
        osc.start(start);
        osc.stop(start + 0.15);
      });
    }
  }

  /** Bright ascending pickup arpeggio — distinct from waveClear's triad. */
  pickup(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [659, 831, 988, 1319].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, t + i * 0.06);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(0.1, t + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.22);
      osc.connect(g).connect(this.master!);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.26);
    });
  }

  /** Power-up wore off. */
  powerExpire(): void {
    this.tone("triangle", 700, 0.2, 0.14, 300);
  }

  waveClear(): void {
    // quick ascending triad chime
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [523, 659, 784].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t + i * 0.09);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(0.16, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.35);
      osc.connect(g).connect(this.master!);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.4);
    });
  }
}
