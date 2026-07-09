// Wrapper around the YouTube Playables SDK (window.ytgame), loaded synchronously
// in index.html before this bundle. The SDK is a deliberate no-op when the game
// runs outside YouTube (local dev, plain browsers): `IN_PLAYABLES_ENV` is false
// or `window.ytgame` is absent, and every method here degrades to a safe no-op.
// No local storage — the best score persists only through YouTube cloud storage
// (game.loadData / game.saveData) when running inside Playables.

interface SdkError extends Error {
  errorType?: "UNKNOWN" | "API_UNAVAILABLE" | "INVALID_PARAMS" | "SIZE_LIMIT_EXCEEDED";
}

interface YTGame {
  IN_PLAYABLES_ENV: boolean;
  SDK_VERSION: string;
  game: {
    firstFrameReady(): void;
    gameReady(): void;
    saveData(data: string): Promise<void>;
    loadData(): Promise<string>;
  };
  system: {
    onPause(cb: () => void): void;
    onResume(cb: () => void): void;
    isAudioEnabled(): boolean;
    onAudioEnabledChange(cb: (enabled: boolean) => void): void;
  };
  engagement?: {
    sendScore(score: { value: number }): Promise<void>;
  };
  health?: {
    logError(): void;
    logWarning(): void;
  };
}

declare global {
  interface Window {
    ytgame?: YTGame;
  }
}

export class PlayablesSDK {
  private sdk: YTGame | undefined;
  private active = false; // true only inside the real Playables environment
  private firstFrameSent = false;
  private gameReadySent = false;

  onPause: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onAudioChange: ((enabled: boolean) => void) | null = null;

  init(): void {
    this.sdk = window.ytgame;
    this.active = this.sdk?.IN_PLAYABLES_ENV === true;
    if (!this.active) {
      if (import.meta.env.DEV) console.info("[Playables] not in Playables env — running standalone");
      return;
    }
    if (import.meta.env.DEV) console.info(`[Playables] SDK ${this.sdk!.SDK_VERSION}`);
    try {
      this.sdk!.system.onPause(() => this.onPause?.());
      this.sdk!.system.onResume(() => this.onResume?.());
      this.sdk!.system.onAudioEnabledChange((enabled) => this.onAudioChange?.(enabled));
    } catch (e) {
      this.logError(e, "event wiring failed");
    }
  }

  get audioEnabled(): boolean {
    if (!this.active) return true;
    try {
      return this.sdk!.system.isAudioEnabled();
    } catch {
      return true;
    }
  }

  firstFrameReady(): void {
    if (this.firstFrameSent) return;
    this.firstFrameSent = true;
    if (import.meta.env.DEV) console.info("[Playables] firstFrameReady");
    if (!this.active) return;
    try {
      this.sdk!.game.firstFrameReady();
    } catch (e) {
      this.logError(e, "firstFrameReady failed");
    }
  }

  gameReady(): void {
    if (this.gameReadySent) return;
    this.gameReadySent = true;
    if (import.meta.env.DEV) console.info("[Playables] gameReady");
    if (!this.active) return;
    try {
      this.sdk!.game.gameReady();
    } catch (e) {
      this.logError(e, "gameReady failed");
    }
  }

  /** Persists serialized data to YouTube cloud storage (per-user). No-op outside Playables. */
  async saveData(data: string): Promise<void> {
    if (!this.active) return;
    try {
      await this.sdk!.game.saveData(data);
    } catch (e) {
      // payload is a few bytes, so SIZE_LIMIT_EXCEEDED (3 MiB cap) shouldn't happen;
      // any failure just means the best score isn't persisted this run
      this.logError(e, "saveData failed");
    }
  }

  /** Loads serialized data from YouTube cloud storage. Returns null outside Playables or on failure. */
  async loadData(): Promise<string | null> {
    if (!this.active) return null;
    try {
      const data = await this.sdk!.game.loadData();
      return data || null;
    } catch (e) {
      this.logError(e, "loadData failed");
      return null;
    }
  }

  sendScore(value: number): void {
    if (!this.active) return;
    try {
      void this.sdk!.engagement?.sendScore({ value });
    } catch (e) {
      this.logError(e, "sendScore failed");
    }
  }

  private logError(e: unknown, context: string): void {
    const err = e as SdkError | undefined;
    if (import.meta.env.DEV) console.warn(`[Playables] ${context}`, err?.errorType ?? "", err);
    try {
      this.sdk?.health?.logError();
    } catch {
      // health logging is best-effort and rate-limited — never let it throw
    }
  }
}
