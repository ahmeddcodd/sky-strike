// All SFX are synthesized with the Web Audio API — zero audio files in the bundle.
// The context is created/resumed on the first user gesture (mobile autoplay rules).

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  // background-music state (synthesized cinematic-military loop)
  private musicOn = false;
  private musicTimer: number | null = null;
  private musicDrone: OscillatorNode[] = [];
  private nextBeatTime = 0;
  private beat = 0;
  private intensity = 0; // rises with wave number

  /** Call from a user gesture (pointerdown) to unlock audio on mobile. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        // music rides its own quieter bus under master, so SFX and music
        // balance independently but both obey mute (master) + pause (context)
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.85;
        this.musicBus.connect(this.master);
        this.noiseBuffer = this.makeNoise();
      } catch {
        return; // no audio support — game stays silent
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get isMusicOn(): boolean {
    return this.musicOn;
  }

  get isMuted(): boolean {
    return this.muted;
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

  // ---------- background music (cinematic military) ----------
  // A tense synthesized bed: a sustained low drone (root + fifth) under a
  // martial drum pulse and slow minor brass-like swells. Notes are scheduled
  // with a lookahead clock (the standard Web Audio pattern) so timing stays
  // tight and survives tab throttling; no per-frame work.

  private static readonly BEAT = 60 / 84; // seconds per beat (~84 BPM, march tempo)

  /** Starts the music loop (idempotent). Call after unlock(), on game start. */
  startMusic(): void {
    if (this.musicOn || !this.ctx || !this.musicBus) return;
    this.musicOn = true;
    this.beat = 0;
    this.nextBeatTime = this.ctx.currentTime + 0.1;

    // sustained drone: A1 root + E2 fifth through a lowpass — the tense floor
    for (const [freq, type, gain] of [[55, "sawtooth", 0.06], [82.4, "triangle", 0.045]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 340;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      osc.connect(lp).connect(g).connect(this.musicBus);
      osc.start();
      this.musicDrone.push(osc);
    }

    // lookahead scheduler: wake ~every 40ms, schedule any beats within 0.2s
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 40);
  }

  /** Stops the music loop and frees its nodes (idempotent). */
  stopMusic(): void {
    this.musicOn = false;
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    const t = this.ctx ? this.ctx.currentTime : 0;
    for (const osc of this.musicDrone) {
      try {
        osc.stop(t + 0.1);
      } catch {
        // already stopped
      }
    }
    this.musicDrone = [];
  }

  /** Wave number nudges the arrangement busier (deterministic, cheap). */
  setMusicIntensity(wave: number): void {
    this.intensity = Math.min(1, Math.max(0, (wave - 1) / 6));
  }

  private scheduleMusic(): void {
    if (!this.ctx || !this.musicOn) return;
    const ahead = this.ctx.currentTime + 0.2;
    while (this.nextBeatTime < ahead) {
      this.playBeat(this.beat, this.nextBeatTime);
      this.beat = (this.beat + 1) % 16; // 4-bar phrase in 4/4
      this.nextBeatTime += AudioSystem.BEAT;
    }
  }

  /** One beat of the pattern at absolute time `t`. */
  private playBeat(beat: number, t: number): void {
    // martial kick on every beat; snare-ish backbeat on 2 and 4 of each bar
    this.kick(t);
    if (beat % 4 === 2) this.snare(t);
    // busier at higher waves: off-beat tick
    if (this.intensity > 0.3 && beat % 2 === 1) this.tick(t, 0.03 + this.intensity * 0.04);
    // brass-like minor swell at the top of each 4-bar phrase (and its half)
    if (beat === 0) this.brassSwell(t, [110, 130.8, 164.8]); // A minor
    else if (beat === 8) this.brassSwell(t, [98, 123.5, 146.8]); // G minor-ish for movement
  }

  private kick(t: number): void {
    if (!this.musicBus || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private snare(t: number): void {
    if (!this.musicBus || !this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "highpass";
    bp.frequency.value = 1400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(bp).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 0.5, 0.16);
  }

  private tick(t: number, gain: number): void {
    if (!this.musicBus || !this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 0.5, 0.06);
  }

  private brassSwell(t: number, chord: number[]): void {
    if (!this.musicBus || !this.ctx) return;
    const dur = AudioSystem.BEAT * 4; // one bar
    const peak = 0.05 + this.intensity * 0.03;
    for (const freq of chord) {
      // two slightly detuned saws per note for a fuller brass texture
      for (const detune of [-4, 4]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const lp = this.ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(500, t);
        lp.frequency.linearRampToValueAtTime(1200, t + dur * 0.4);
        lp.frequency.linearRampToValueAtTime(500, t + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak / chord.length, t + dur * 0.4); // slow attack
        g.gain.linearRampToValueAtTime(0.0001, t + dur); // slow release
        osc.connect(lp).connect(g).connect(this.musicBus);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      }
    }
  }
}
