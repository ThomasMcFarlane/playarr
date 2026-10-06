/**
 * @playarr-tv/player-core
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
  /** HTTP response status when the playback failure came from a network request. */
  httpStatus?: number;
  /** Final request URI when the playback failure came from a network request. */
  requestUri?: string;
}

export interface PlaybackAudioTrack {
  id: string;
  label: string;
  language?: string;
  /** Upper-case codec name when the server reports it (for example `AAC`). */
  codec?: string;
  roles: string[];
  channelsCount?: number;
  selected: boolean;
}

export interface PlaybackSubtitleTrack {
  id: string;
  label: string;
  language?: string;
  roles: string[];
  forced: boolean;
  selected: boolean;
}

export interface ExternalSubtitleTrack {
  /** Caller-owned stable id, preserved by the playback adapter. */
  id: string;
  url: string;
  label: string;
  language?: string;
  forced?: boolean;
}

export interface PlaybackEngineState {
  state: PlaybackState;
  currentTimeSeconds: number;
  durationSeconds: number;
  bufferedSeconds: number;
  /** 0.0 - 1.0 */
  volume: number;
  muted: boolean;
  audioTracks: PlaybackAudioTrack[];
  subtitleTracks: PlaybackSubtitleTrack[];
  selectedAudioTrackId: string | null;
  /** `null` means subtitles are switched off. */
  selectedSubtitleTrackId: string | null;
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
  selectAudioTrack(trackId: string): Promise<void>;
  /** Adds authenticated WebVTT sidecars after the media source has loaded. */
  addExternalSubtitleTracks(tracks: ExternalSubtitleTrack[]): Promise<void>;
  /** Pass `null` to switch subtitles off. */
  selectSubtitleTrack(trackId: string | null): Promise<void>;
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
    audioTracks: [],
    subtitleTracks: [],
    selectedAudioTrackId: null,
    selectedSubtitleTrackId: null,
  };

  private readonly listeners = new Set<(state: PlaybackEngineState) => void>();

  abstract load(source: PlaybackSource): Promise<void>;
  abstract play(): Promise<void>;
  abstract pause(): Promise<void>;
  abstract seek(positionSeconds: number): Promise<void>;
  abstract setVolume(volume: number): void;
  abstract setMuted(muted: boolean): void;
  abstract selectAudioTrack(trackId: string): Promise<void>;
  abstract addExternalSubtitleTracks(tracks: ExternalSubtitleTrack[]): Promise<void>;
  abstract selectSubtitleTrack(trackId: string | null): Promise<void>;
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
