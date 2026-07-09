export class ScoreSystem {
  score = 0;
  kills = 0;

  /** Registers a kill worth `base` points at the given combo multiplier; returns points gained. */
  addKill(base: number, multiplier: number): number {
    const gained = base * multiplier;
    this.score += gained;
    this.kills++;
    return gained;
  }

  /** Flat bonus (wave clears etc.) — combo-exempt. */
  addBonus(points: number): void {
    this.score += points;
  }

  reset(): void {
    this.score = 0;
    this.kills = 0;
  }
}
