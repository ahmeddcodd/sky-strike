// Thin wrapper around the YouTube Playables SDK (window.ytgame).
// Every call is guarded: when the SDK is absent (local dev, plain browsers)
// the wrapper degrades to no-ops and localStorage so the game runs anywhere.

interface YTGame {
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
  };
  audio: {
    getAudioEnabled(): boolean;
    onAudioEnabledChange(cb: (enabled: boolean) => void): void;
  };
  engagement?: {
    sendScore(score: { value: number }): Promise<void>;
  };
}

declare global {
  interface Window {
    ytgame?: YTGame;
  }
}

export class PlayablesSDK {
  private sdk: YTGame | undefined;
  private firstFrameSent = false;
  private gameReadySent = false;

  onPause: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onAudioChange: ((enabled: boolean) => void) | null = null;

  init(): void {
    this.sdk = window.ytgame;
    if (!this.sdk) {
      if (import.meta.env.DEV) console.info("[Playables] SDK not found — running standalone");
      return;
    }
    try {
      this.sdk.system.onPause(() => this.onPause?.());
      this.sdk.system.onResume(() => this.onResume?.());
      this.sdk.audio.onAudioEnabledChange((enabled) => this.onAudioChange?.(enabled));
    } catch (e) {
      console.warn("[Playables] event wiring failed", e);
    }
  }

  get audioEnabled(): boolean {
    try {
      return this.sdk ? this.sdk.audio.getAudioEnabled() : true;
    } catch {
      return true;
    }
  }

  firstFrameReady(): void {
    if (this.firstFrameSent) return;
    this.firstFrameSent = true;
    if (import.meta.env.DEV) console.info("[Playables] firstFrameReady");
    try {
      this.sdk?.game.firstFrameReady();
    } catch (e) {
      console.warn("[Playables] firstFrameReady failed", e);
    }
  }

  gameReady(): void {
    if (this.gameReadySent) return;
    this.gameReadySent = true;
    if (import.meta.env.DEV) console.info("[Playables] gameReady");
    try {
      this.sdk?.game.gameReady();
    } catch (e) {
      console.warn("[Playables] gameReady failed", e);
    }
  }

  async saveData(key: string, data: string): Promise<void> {
    if (this.sdk) {
      try {
        await this.sdk.game.saveData(data);
        return;
      } catch (e) {
        console.warn("[Playables] saveData failed, falling back", e);
      }
    }
    try {
      localStorage.setItem(key, data);
    } catch {
      // storage unavailable (private mode) — best score just won't persist
    }
  }

  async loadData(key: string): Promise<string | null> {
    if (this.sdk) {
      try {
        const data = await this.sdk.game.loadData();
        if (data) return data;
      } catch (e) {
        console.warn("[Playables] loadData failed, falling back", e);
      }
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  sendScore(value: number): void {
    try {
      void this.sdk?.engagement?.sendScore({ value });
    } catch {
      // engagement API optional
    }
  }
}
