import { COMBO } from "../game/Constants";

// Chain-kill multiplier (spec §22): kills within the window build a streak;
// the streak lapses on timeout and resets when the player takes damage.

export class ComboSystem {
  streak = 0;

  /** Fired whenever the streak or multiplier changes (drives the HUD). */
  onChange: (streak: number, multiplier: number) => void = () => {};

  private timer = 0;

  get multiplier(): number {
    if (this.streak >= COMBO.TIER_X5) return 5;
    if (this.streak >= COMBO.TIER_X3) return 3;
    if (this.streak >= COMBO.TIER_X2) return 2;
    return 1;
  }

  /** Registers a kill; returns the multiplier to apply to its score. */
  kill(): number {
    this.streak++;
    this.timer = COMBO.WINDOW;
    this.onChange(this.streak, this.multiplier);
    return this.multiplier;
  }

  reset(): void {
    if (this.streak === 0) return;
    this.streak = 0;
    this.timer = 0;
    this.onChange(0, 1);
  }

  update(dt: number): void {
    if (this.streak === 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.reset();
  }
}
