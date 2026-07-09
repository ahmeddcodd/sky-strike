import { PLAYER, VFX } from "../game/Constants";

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

const HEART_SVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#ff5b6e" stroke="rgba(255,255,255,0.85)" stroke-width="1.4"/></svg>`;

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
  private scoreEl: HTMLDivElement;
  private hearts: HTMLDivElement;
  private heartItems: HTMLDivElement[] = [];
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

    // top bar: hearts + score
    const top = el("div", "hud-top", root);
    this.hearts = el("div", "hearts", top);
    for (let i = 0; i < PLAYER.MAX_HEALTH; i++) {
      const heart = el("div", "heart", this.hearts);
      heart.innerHTML = HEART_SVG;
      this.heartItems.push(heart);
    }
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
    this.startOverlay = el("div", "overlay", root);
    const title = el("div", "game-title", this.startOverlay);
    title.innerHTML = "SKY STRIKE<small>3D</small>";
    this.startBest = el("div", "best-banner", this.startOverlay);
    el("div", "tap-hint", this.startOverlay).textContent = "TAP TO START";
    this.controlHint = el("div", "control-hint", this.startOverlay);
    this.controlHint.textContent = "DRAG TO AIM · HOLD TO FIRE";
    this.startOverlay.addEventListener("pointerdown", () => {
      if (this.startOverlay.classList.contains("hidden")) return;
      this.startOverlay.classList.add("hidden");
      this.onStart();
    });

    // game over overlay
    this.overOverlay = el("div", "overlay hidden", root);
    el("div", "over-title", this.overOverlay).textContent = "GAME OVER";
    this.overStats = el("div", "stats", this.overOverlay);
    this.overBest = el("div", "best-banner", this.overOverlay);
    const restartBtn = el("button", "btn", this.overOverlay);
    restartBtn.textContent = "RESTART";
    restartBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.overOverlay.classList.add("hidden");
      this.onRestart();
    });
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

  setHealth(hp: number, shake = false): void {
    this.heartItems.forEach((heart, i) => heart.classList.toggle("lost", i >= hp));
    if (shake) {
      this.hearts.classList.remove("shake");
      void this.hearts.offsetWidth;
      this.hearts.classList.add("shake");
    }
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
