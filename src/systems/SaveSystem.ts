import { SAVE_KEY } from "../game/Constants";
import type { PlayablesSDK } from "./PlayablesSDK";

interface SaveData {
  bestScore: number;
}

export class SaveSystem {
  bestScore = 0;
  private playables: PlayablesSDK;

  constructor(playables: PlayablesSDK) {
    this.playables = playables;
  }

  async load(): Promise<void> {
    const raw = await this.playables.loadData(SAVE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Partial<SaveData>;
      this.bestScore = typeof data.bestScore === "number" ? data.bestScore : 0;
    } catch {
      this.bestScore = 0;
    }
  }

  /** Returns true when the score is a new best (and persists it). */
  submitScore(score: number): boolean {
    this.playables.sendScore(score);
    if (score <= this.bestScore) return false;
    this.bestScore = score;
    const data: SaveData = { bestScore: score };
    void this.playables.saveData(SAVE_KEY, JSON.stringify(data));
    return true;
  }
}
