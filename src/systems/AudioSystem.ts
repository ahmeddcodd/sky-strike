// All SFX are synthesized with the Web Audio API — zero audio files in the bundle.
// The context is created/resumed on the first user gesture (mobile autoplay rules).

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  // background-music state (synthesized energetic synthwave loop)
  private musicOn = false;
  private musicTimer: number | null = null;
  private musicPad: OscillatorNode[] = []; // sustained pad oscillators
  private nextStepTime = 0;
  private step = 0; // 16th-note index within a 16-step bar
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
        this.musicBus.gain.value = 0.7;
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

  // ---------- background music (energetic synthwave) ----------
  // A driving retro-arcade loop that matches the fast jet combat: four-on-the-
  // floor kick, off-beat bass pulse, crisp hats, and a bright arpeggiated lead
  // over a 4-bar minor progression, plus a warm sustained pad. Everything is
  // scheduled on a 16th-note lookahead clock (the standard Web Audio pattern)
  // so timing is tight and survives tab throttling; no per-frame work.

  private static readonly STEP = 60 / 128 / 4; // one 16th note at 128 BPM (~0.117s)

  // A minor progression: Am – F – C – G (one chord per bar). Bass roots (Hz),
  // and a pentatonic-ish lead scale per bar for the arpeggio to ride.
  private static readonly BASS = [55.0, 43.65, 65.41, 49.0]; // A1, F1, C2, G1
  private static readonly CHORDS = [
    [220.0, 261.63, 329.63], // Am  (A C E)
    [174.61, 220.0, 261.63], // F   (F A C)
    [261.63, 329.63, 392.0], // C   (C E G)
    [196.0, 246.94, 293.66], // G   (G B D)
  ];
  // arpeggio note pattern (indices into the current chord + octave), one per 16th
  private static readonly ARP = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 0, 2, 1, 2];

  /** Starts the music loop (idempotent). Call after unlock(), on game start. */
  startMusic(): void {
    if (this.musicOn || !this.ctx || !this.musicBus) return;
    this.musicOn = true;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;

    // warm sustained pad (root + fifth), gently detuned — the energetic bed
    for (const [freq, detune] of [[110, -5], [110, 6], [164.8, 0]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.value = 0.018;
      osc.connect(lp).connect(g).connect(this.musicBus);
      osc.start();
      this.musicPad.push(osc);
    }

    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 25);
  }

  /** Stops the music loop and frees its nodes (idempotent). */
  stopMusic(): void {
    this.musicOn = false;
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    const t = this.ctx ? this.ctx.currentTime : 0;
    for (const osc of this.musicPad) {
      try {
        osc.stop(t + 0.1);
      } catch {
        // already stopped
      }
    }
    this.musicPad = [];
  }

  /** Wave number nudges the arrangement busier (deterministic, cheap). */
  setMusicIntensity(wave: number): void {
    this.intensity = Math.min(1, Math.max(0, (wave - 1) / 6));
  }

  private scheduleMusic(): void {
    if (!this.ctx || !this.musicOn) return;
    const ahead = this.ctx.currentTime + 0.12;
    while (this.nextStepTime < ahead) {
      this.playStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % 64; // 4-bar loop, 16 steps/bar
      this.nextStepTime += AudioSystem.STEP;
    }
  }

  /** One 16th-note step of the groove at absolute time `t`. */
  private playStep(step: number, t: number): void {
    const inBar = step % 16;
    const bar = (step / 16) | 0; // 0..3 → which chord
    const chord = AudioSystem.CHORDS[bar];

    // four-on-the-floor kick (every quarter note)
    if (inBar % 4 === 0) this.mKick(t);
    // snappy backbeat on 2 and 4
    if (inBar === 4 || inBar === 12) this.mSnare(t);
    // driving off-beat bass on every 8th (the pump)
    if (inBar % 2 === 0) this.mBass(AudioSystem.BASS[bar], t, inBar % 4 === 0);
    // hi-hats: closed on every 16th, a touch louder on off-beats; open accent pre-downbeat
    this.mHat(t, inBar % 4 === 2 ? 0.05 : 0.03, inBar === 14 || inBar === 6);
    // bright arpeggio lead every 16th (the melody hook), octave up for sparkle
    const note = chord[AudioSystem.ARP[inBar]] * 2;
    this.mLead(note, t, inBar);
    // extra energy at higher waves: a second arp layer a fifth up on off-beats
    if (this.intensity > 0.35 && inBar % 2 === 1) {
      this.mLead(chord[AudioSystem.ARP[(inBar + 2) % 16]] * 3, t, inBar, 0.02);
    }
  }

  private mKick(t: number): void {
    if (!this.musicBus || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  private mSnare(t: number): void {
    if (!this.musicBus || !this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(bp).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 0.5, 0.15);
  }

  private mHat(t: number, gain: number, open: boolean): void {
    if (!this.musicBus || !this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 8000;
    const g = this.ctx.createGain();
    const dur = open ? 0.12 : 0.035;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  private mBass(freq: number, t: number, onBeat: boolean): void {
    if (!this.musicBus || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(onBeat ? 700 : 480, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(lp).connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private mLead(freq: number, t: number, inBar: number, gain = 0.05): void {
    if (!this.musicBus || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    const g = this.ctx.createGain();
    const accent = inBar % 4 === 0 ? 1.25 : 1; // punch the downbeats
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * accent, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + AudioSystem.STEP * 0.9);
    osc.connect(lp).connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + AudioSystem.STEP + 0.02);
  }
}
