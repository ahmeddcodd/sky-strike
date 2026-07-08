import { ENEMY } from "../game/Constants";

export class ScoreSystem {
  score = 0;
  kills = 0;

  /** Registers a kill and returns the points gained (combo multipliers hook in here later). */
  addKill(): number {
    const gained = ENEMY.SCORE;
    this.score += gained;
    this.kills++;
    return gained;
  }

  reset(): void {
    this.score = 0;
    this.kills = 0;
  }
}
