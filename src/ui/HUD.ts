import { VFX } from "../game/Constants";

// DOM/CSS HUD overlay (deliberate deviation from spec §39's Babylon GUI:
// sharper text on high-DPI mobile, no fullscreen GUI texture, smaller bundle).

export interface GameOverStats {
  score: number;
  best: number;
  kills: number;
  wave: number;
  accuracy: number; // 0..1
  isNewBest: boolean;
}

export interface HpBarInfo {
  x: number;
  y: number;
  fraction: number; // 0..1
  width: number; // px
}

// winged jet badge over the title (top-view jet between speed bars)
const EMBLEM_SVG = `<svg viewBox="0 0 140 56">
  <defs>
    <linearGradient id="emJet" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#bfe4fa"/>
      <stop offset="1" stop-color="#5fb6e8"/>
    </linearGradient>
  </defs>
  <g fill="#7fc8ef" opacity="0.8">
    <path d="M4 31 h36 l-6 4 H12 Z"/>
    <path d="M16 24 h28 l-5 4 H22 Z"/>
    <path d="M28 17 h20 l-4 4 H33 Z"/>
    <path d="M136 31 h-36 l6 4 h22 Z"/>
    <path d="M124 24 h-28 l5 4 h18 Z"/>
    <path d="M112 17 h-20 l4 4 h11 Z"/>
  </g>
  <path fill="url(#emJet)" d="M70 2 C72 9 73 15 73 21 L102 38 L102 42 L73 33 L72 44 L81 50 L81 53 L70 49 L59 53 L59 50 L68 44 L67 33 L38 42 L38 38 L67 21 C67 15 68 9 70 2 Z"/>
</svg>`;

const CROSSHAIR_SVG = `<svg viewBox="0 0 56 56">
  <circle cx="28" cy="28" r="21" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2.4"/>
  <circle cx="28" cy="28" r="2.6" fill="#fff"/>
  <line x1="28" y1="1" x2="28" y2="10" stroke="#fff" stroke-width="2.4"/>
  <line x1="28" y1="46" x2="28" y2="55" stroke="#fff" stroke-width="2.4"/>
  <line x1="1" y1="28" x2="10" y2="28" stroke="#fff" stroke-width="2.4"/>
  <line x1="46" y1="28" x2="55" y2="28" stroke="#fff" stroke-width="2.4"/>
</svg>`;

const HITMARK_SVG = `<svg viewBox="0 0 56 56">
  <g stroke="#ffd75e" stroke-width="3.4" stroke-linecap="round">
    <line x1="16" y1="16" x2="23" y2="23"/><line x1="40" y1="16" x2="33" y2="23"/>
    <line x1="16" y1="40" x2="23" y2="33"/><line x1="40" y1="40" x2="33" y2="33"/>
  </g>
</svg>`;

const fmt = (n: number) => n.toLocaleString("en-US");

export class HUD {
  onStart: () => void = () => {};
  onRestart: () => void = () => {};

  private crosshairEl: HTMLDivElement;
  private topBar: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private playerHp: HTMLDivElement;
  private playerHpFill: HTMLDivElement;
  private playerBar: HTMLDivElement;
  private playerBarFill: HTMLDivElement;
  private powerPill: HTMLDivElement;
  private lastPillText: string | null = null;
  private podLabel: HTMLDivElement;
  private lastPodText: string | null = null;
  private vignetteEl: HTMLDivElement;
  private warningEl: HTMLDivElement;
  private startOverlay: HTMLDivElement;
  private startBest: HTMLDivElement;
  private overOverlay: HTMLDivElement;
  private overStats: HTMLDivElement;
  private overBest: HTMLDivElement;
  private controlHint: HTMLDivElement;
  private waveEl!: HTMLDivElement;
  private comboEl!: HTMLDivElement;
  private hpBars: { root: HTMLDivElement; fill: HTMLDivElement }[] = [];
  private popups: { el: HTMLDivElement; busy: boolean }[] = [];

  constructor(root: HTMLElement) {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] => {
      const node = document.createElement(tag);
      node.className = cls;
      parent.appendChild(node);
      return node;
    };

    // always-on subtle frame vignette (cinematic depth; below all other HUD)
    el("div", "frame-vignette", root);

    // top bar: hull bar + score (hidden while menus are up)
    const top = el("div", "hud-top hud-off", root);
    this.topBar = top;
    this.playerHp = el("div", "player-hp", top);
    el("div", "player-hp-label", this.playerHp).textContent = "HULL";
    const hpTrack = el("div", "hpbar fixed", this.playerHp);
    this.playerHpFill = el("div", "hpfill", hpTrack);
    this.waveEl = el("div", "wave-indicator", top);
    this.waveEl.textContent = "";

    const scoreBox = el("div", "score-box", top);
    this.scoreEl = el("div", "score-value", scoreBox);
    this.scoreEl.textContent = "0";
    el("div", "score-label", scoreBox).textContent = "SCORE";
    this.comboEl = el("div", "combo", scoreBox);

    this.vignetteEl = el("div", "vignette", root);

    this.crosshairEl = el("div", "crosshair", root);
    this.crosshairEl.innerHTML = CROSSHAIR_SVG + `<div class="hitmark">${HITMARK_SVG}</div>`;

    this.warningEl = el("div", "warning", root);

    // pooled enemy health bars, projected over the jets each frame
    for (let i = 0; i < 16; i++) {
      const bar = el("div", "hpbar", root);
      const fill = el("div", "hpfill", bar);
      bar.style.display = "none";
      this.hpBars.push({ root: bar, fill });
    }

    // player's own on-jet bar (projected under the player jet)
    this.playerBar = el("div", "hpbar player", root);
    this.playerBarFill = el("div", "hpfill", this.playerBar);
    this.playerBar.style.display = "none";

    // active power-up pill + floating pod label (one of each is ever visible)
    this.powerPill = el("div", "powerup-pill", root);
    this.podLabel = el("div", "pod-label", root);

    for (let i = 0; i < VFX.POPUP_POOL; i++) {
      const popup = el("div", "popup", root);
      const entry = { el: popup, busy: false };
      popup.addEventListener("animationend", () => {
        entry.busy = false;
        popup.classList.remove("live");
      });
      this.popups.push(entry);
    }

    // start overlay
    this.startOverlay = el("div", "overlay menu", root);
    const menu = el("div", "menu-box", this.startOverlay);
    el("div", "menu-emblem", menu).innerHTML = EMBLEM_SVG;
    const title = el("div", "game-title", menu);
    title.innerHTML = "SKY STRIKE<small>3D</small>";
    el("div", "menu-tagline", menu).textContent = "ENDLESS ARCADE JET COMBAT";
    this.startBest = el("div", "best-banner", menu);
    el("div", "tap-hint", menu).textContent = "TAP TO START";
    this.controlHint = el("div", "control-hint", menu);
    this.controlHint.textContent = "DRAG TO AIM · HOLD TO FIRE";
    this.startOverlay.addEventListener("pointerdown", () => {
      if (this.startOverlay.classList.contains("hidden")) return;
      this.startOverlay.classList.add("hidden");
      this.onStart();
    });

    // game over overlay
    this.overOverlay = el("div", "overlay defeat hidden", root);
    const overBox = el("div", "over-box", this.overOverlay);
    el("div", "over-sub", overBox).textContent = "MISSION FAILED";
    el("div", "over-title", overBox).textContent = "GAME OVER";
    this.overStats = el("div", "stats", overBox);
    this.overBest = el("div", "best-banner", overBox);
    const restartBtn = el("button", "btn", overBox);
    restartBtn.textContent = "RESTART";
    restartBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.overOverlay.classList.add("hidden");
      this.onRestart();
    });
  }

  /** Shows/hides the in-game HUD chips (menus should sit on a clean scene). */
  setHudVisible(visible: boolean): void {
    this.topBar.classList.toggle("hud-off", !visible);
    if (!visible) this.warningEl.classList.remove("live"); // no stale WARNING behind overlays
  }

  setCrosshair(x: number, y: number): void {
    this.crosshairEl.style.left = `${x}px`;
    this.crosshairEl.style.top = `${y}px`;
  }

  setFiring(firing: boolean): void {
    this.crosshairEl.classList.toggle("firing", firing);
  }

  /** Mouse mode hides the OS cursor (the crosshair is the pointer); touch mode restores it. */
  setTouchMode(touch: boolean): void {
    this.controlHint.textContent = touch
      ? "DRAG TO AIM · HOLD TO FIRE"
      : "MOVE MOUSE TO AIM · HOLD TO FIRE";
    document.body.classList.toggle("mouse-mode", !touch);
  }

  hitMarker(): void {
    this.crosshairEl.classList.remove("hit");
    void this.crosshairEl.offsetWidth; // restart the CSS animation
    this.crosshairEl.classList.add("hit");
  }

  setScore(score: number): void {
    this.scoreEl.textContent = fmt(score);
    this.scoreEl.classList.remove("pop");
    void this.scoreEl.offsetWidth;
    this.scoreEl.classList.add("pop");
  }

  /** Both hull bars (top-left readout + on-jet) share this fraction. */
  setHealth(fraction: number, shake = false): void {
    const pct = `${(fraction * 100).toFixed(1)}%`;
    const tier = fraction > 0.55 ? "hpfill" : fraction > 0.28 ? "hpfill mid" : "hpfill low";
    this.playerHpFill.style.width = pct;
    this.playerHpFill.className = tier;
    this.playerBarFill.style.width = pct;
    this.playerBarFill.className = tier;
    if (shake) {
      this.playerHp.classList.remove("shake");
      void this.playerHp.offsetWidth;
      this.playerHp.classList.add("shake");
    }
  }

  /** Positions the on-jet hull bar (CSS px). */
  setPlayerBar(x: number, y: number, visible: boolean): void {
    if (!visible) {
      this.playerBar.style.display = "none";
      return;
    }
    this.playerBar.style.display = "block";
    this.playerBar.style.left = `${x}px`;
    this.playerBar.style.top = `${y}px`;
  }

  /** Active power-up readout, e.g. "HEAVY 7s". Null hides it. */
  setPowerUp(text: string | null): void {
    if (text === this.lastPillText) return;
    const appeared = !this.lastPillText && !!text;
    this.lastPillText = text;
    this.powerPill.textContent = text ?? "";
    this.powerPill.classList.toggle("show", !!text);
    if (appeared) {
      this.powerPill.classList.remove("pop");
      void this.powerPill.offsetWidth;
      this.powerPill.classList.add("pop");
    }
  }

  /** Label floating under the drifting power-up pod. Null text hides it. */
  setPodLabel(x: number, y: number, text: string | null, type: string): void {
    if (!text) {
      if (this.lastPodText !== null) {
        this.lastPodText = null;
        this.podLabel.classList.remove("show");
      }
      return;
    }
    if (text !== this.lastPodText) {
      this.lastPodText = text;
      this.podLabel.textContent = text;
      this.podLabel.className = `pod-label show ${type}`;
    }
    this.podLabel.style.left = `${x}px`;
    this.podLabel.style.top = `${y}px`;
  }

  flashDamage(): void {
    this.vignetteEl.classList.add("flash");
    window.setTimeout(() => this.vignetteEl.classList.remove("flash"), 130);
  }

  warning(text: string, gold = false): void {
    this.warningEl.textContent = text;
    this.warningEl.classList.toggle("gold", gold);
    this.warningEl.classList.remove("live");
    void this.warningEl.offsetWidth;
    this.warningEl.classList.add("live");
  }

  setWave(wave: number): void {
    this.waveEl.textContent = wave > 0 ? `WAVE ${wave}` : "";
  }

  setCombo(streak: number, multiplier: number): void {
    if (multiplier <= 1) {
      this.comboEl.textContent = "";
      return;
    }
    this.comboEl.textContent = `×${multiplier} COMBO (${streak})`;
    this.comboEl.classList.remove("pop");
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add("pop");
  }

  /** Positions one pooled bar per entry; hides the rest. Coords in CSS px. */
  updateHpBars(bars: HpBarInfo[]): void {
    for (let i = 0; i < this.hpBars.length; i++) {
      const slot = this.hpBars[i];
      const info = bars[i];
      if (!info) {
        slot.root.style.display = "none";
        continue;
      }
      slot.root.style.display = "block";
      slot.root.style.left = `${info.x}px`;
      slot.root.style.top = `${info.y}px`;
      slot.root.style.width = `${info.width}px`;
      slot.fill.style.width = `${(info.fraction * 100).toFixed(1)}%`;
      slot.fill.className =
        info.fraction > 0.55 ? "hpfill" : info.fraction > 0.28 ? "hpfill mid" : "hpfill low";
    }
  }

  popup(x: number, y: number, text: string): void {
    for (const entry of this.popups) {
      if (entry.busy) continue;
      entry.busy = true;
      entry.el.textContent = text;
      entry.el.style.left = `${x}px`;
      entry.el.style.top = `${y}px`;
      entry.el.classList.remove("live");
      void entry.el.offsetWidth;
      entry.el.classList.add("live");
      return;
    }
  }

  showStart(best: number): void {
    this.startBest.textContent = best > 0 ? `BEST ${fmt(best)}` : "";
    this.startOverlay.classList.remove("hidden");
  }

  showGameOver(stats: GameOverStats): void {
    this.overStats.innerHTML = "";
    const row = (k: string, v: string) => {
      const key = document.createElement("div");
      key.className = "k";
      key.textContent = k;
      const val = document.createElement("div");
      val.className = "v";
      val.textContent = v;
      this.overStats.append(key, val);
    };
    row("SCORE", fmt(stats.score));
    row("BEST", fmt(stats.best));
    row("WAVE", fmt(stats.wave));
    row("JETS DOWN", fmt(stats.kills));
    row("ACCURACY", `${Math.round(stats.accuracy * 100)}%`);
    this.overBest.textContent = stats.isNewBest ? "★ NEW BEST SCORE ★" : "";
    this.overOverlay.classList.remove("hidden");
  }
}
