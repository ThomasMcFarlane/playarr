/**
 * @streamarr-tv/player-core
 *
 * Platform-agnostic playback contract. `player-shaka` (web/webOS/VIDAA,
 * MSE + EME via Shaka Player) and `player-avplay` (Tizen's native
 * `webapis.avplay`) both implement `PlaybackEngine`, so `packages/ui-tv`'s
 * Player screen and app shells can depend on this interface only.
 */

export type PlaybackState =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "error";

export type DrmSystemId =
  | "com.widevine.alpha"
  | "com.microsoft.playready"
  | "com.apple.fps"
  | "none";

export interface DrmConfig {
  systemId: DrmSystemId;
  licenseServerUrl?: string;
  certificateUrl?: string;
  headers?: Record<string, string>;
}

export interface PlaybackSource {
  /** Manifest or direct media URL (HLS/DASH manifest, or a progressive MP4). */
  url: string;
  /** e.g. "application/dash+xml", "application/x-mpegURL", "video/mp4". */
  mimeType: string;
  drm?: DrmConfig;
  startPositionSeconds?: number;
}

export interface PlaybackError {
  code: string;
  message: string;
  /** Fatal errors mean the engine has entered `"error"` state and requires a fresh `load()`. */
  fatal: boolean;
}

export interface PlaybackEngineState {
  state: PlaybackState;
  currentTimeSeconds: number;
  durationSeconds: number;
  bufferedSeconds: number;
  /** 0.0 - 1.0 */
  volume: number;
  muted: boolean;
  error?: PlaybackError;
}

/**
 * Contract every platform playback adapter implements. All mutating methods
 * are async because on real TV runtimes (Tizen AVPlay in particular) even
 * "synchronous-looking" operations like `play()` are backed by an
 * event-driven native API.
 */
export interface PlaybackEngine {
  load(source: PlaybackSource): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionSeconds: number): Promise<void>;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  getState(): PlaybackEngineState;
  /** Releases underlying native/DOM resources. The engine instance is unusable after this resolves. */
  destroy(): Promise<void>;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  onStateChange(listener: (state: PlaybackEngineState) => void): () => void;
}

/** Shared starting point for adapters -- covers state bookkeeping/listener fan-out, not device I/O. */
export abstract class BasePlaybackEngine implements PlaybackEngine {
  protected state: PlaybackEngineState = {
    state: "idle",
    currentTimeSeconds: 0,
    durationSeconds: 0,
    bufferedSeconds: 0,
    volume: 1,
    muted: false,
  };

  private readonly listeners = new Set<(state: PlaybackEngineState) => void>();

  abstract load(source: PlaybackSource): Promise<void>;
  abstract play(): Promise<void>;
  abstract pause(): Promise<void>;
  abstract seek(positionSeconds: number): Promise<void>;
  abstract setVolume(volume: number): void;
  abstract setMuted(muted: boolean): void;
  abstract destroy(): Promise<void>;

  getState(): PlaybackEngineState {
    return this.state;
  }

  onStateChange(listener: (state: PlaybackEngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected setState(patch: Partial<PlaybackEngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}
