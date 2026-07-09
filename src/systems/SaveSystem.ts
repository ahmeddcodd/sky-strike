import type { PlayablesSDK } from "./PlayablesSDK";

// Best score lives in YouTube cloud storage (per-user) via the Playables SDK.
// Outside Playables the SDK calls are no-ops, so the best score is in-memory
// for the session only — there is no local storage anywhere in the game.

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
    const raw = await this.playables.loadData();
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Partial<SaveData>;
      this.bestScore = typeof data.bestScore === "number" ? data.bestScore : 0;
    } catch {
      this.bestScore = 0;
    }
  }

  /** Returns true when the score is a new best (and persists it to the cloud). */
  submitScore(score: number): boolean {
    this.playables.sendScore(score);
    if (score <= this.bestScore) return false;
    this.bestScore = score;
    const data: SaveData = { bestScore: score };
    void this.playables.saveData(JSON.stringify(data));
    return true;
  }
}
