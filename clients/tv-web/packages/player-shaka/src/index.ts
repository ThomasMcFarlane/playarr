/**
 * @streamarr-tv/player-shaka
 *
 * Shaka Player adapter implementing `PlaybackEngine`. Used by the web app,
 * the webOS app shell, and the VIDAA fallback PWA -- anywhere with a real
 * `<video>` element and browser-native MSE + EME support (Tizen instead
 * uses `player-avplay`, since it plays through a native display plane).
 *
 * Shaka Player ships real TypeScript declarations (`dist/shaka-player.compiled.d.ts`,
 * generated from its Closure Compiler externs) resolved via its package.json
 * `types` field, so this adapter is typed against the actual `shaka.Player`
 * API rather than a hand-rolled surface.
 */
import shaka from "shaka-player";
import {
  BasePlaybackEngine,
  type DrmConfig,
  type PlaybackEngine,
  type PlaybackEngineState,
  type PlaybackSource,
} from "@streamarr-tv/player-core";

let polyfillsInstalled = false;

/** Shaka's browser-compatibility shims (idempotent, but only needs to run once per page). */
function ensurePolyfillsInstalled(): void {
  if (polyfillsInstalled) return;
  shaka.polyfill.installAll();
  polyfillsInstalled = true;
}

function buildDrmConfiguration(drm: DrmConfig): object | undefined {
  if (drm.systemId === "none" || !drm.licenseServerUrl) return undefined;

  return {
    servers: {
      [drm.systemId]: drm.licenseServerUrl,
    },
    ...(drm.certificateUrl
      ? { advanced: { [drm.systemId]: { serverCertificateUri: drm.certificateUrl } } }
      : {}),
    ...(drm.headers ? { headers: drm.headers } : {}),
  };
}

function getBufferedEndSeconds(mediaElement: HTMLMediaElement): number {
  const { buffered } = mediaElement;
  return buffered.length > 0 ? buffered.end(buffered.length - 1) : 0;
}

/** `PlaybackEngine` adapter over `shaka.Player` + a `<video>` element. */
export class ShakaPlaybackEngine extends BasePlaybackEngine implements PlaybackEngine {
  private player: shaka.Player | null = null;
  private mediaElement: HTMLMediaElement | null = null;
  private detachListeners: (() => void) | null = null;

  /** Attaches to a `<video>` element. Must be called once before `load()`. */
  attach(mediaElement: HTMLMediaElement): void {
    ensurePolyfillsInstalled();

    if (!shaka.Player.isBrowserSupported()) {
      throw new Error("This browser is not supported by Shaka Player (MSE/EME unavailable).");
    }

    this.mediaElement = mediaElement;
    this.player = new shaka.Player();
    void this.player.attach(mediaElement);

    const handleError = (event: Event) => {
      const shakaError = (event as unknown as { detail?: InstanceType<typeof shaka.util.Error> })
        .detail;
      this.setState({
        state: "error",
        error: {
          code: shakaError ? String(shakaError.code) : "UNKNOWN",
          message: shakaError?.message ?? "Unknown Shaka Player error",
          fatal: shakaError?.severity === shaka.util.Error.Severity.CRITICAL,
        },
      });
    };

    const handleBuffering = (event: Event) => {
      const buffering = (event as unknown as { buffering?: boolean }).buffering ?? true;
      this.setState({
        state: buffering ? "buffering" : this.mediaElement?.paused ? "paused" : "playing",
      });
    };

    const handleTimeUpdate = () => {
      if (!this.mediaElement) return;
      this.setState({
        currentTimeSeconds: this.mediaElement.currentTime,
        durationSeconds: Number.isFinite(this.mediaElement.duration) ? this.mediaElement.duration : 0,
        bufferedSeconds: getBufferedEndSeconds(this.mediaElement),
      });
    };
    const handlePlay = () => this.setState({ state: "playing" });
    const handlePause = () =>
      this.setState({ state: this.state.state === "ended" ? "ended" : "paused" });
    const handleEnded = () => this.setState({ state: "ended" });
    const handleVolumeChange = () => {
      if (!this.mediaElement) return;
      this.setState({ volume: this.mediaElement.volume, muted: this.mediaElement.muted });
    };

    this.player.addEventListener("error", handleError);
    this.player.addEventListener("buffering", handleBuffering);
    mediaElement.addEventListener("timeupdate", handleTimeUpdate);
    mediaElement.addEventListener("play", handlePlay);
    mediaElement.addEventListener("pause", handlePause);
    mediaElement.addEventListener("ended", handleEnded);
    mediaElement.addEventListener("volumechange", handleVolumeChange);

    this.detachListeners = () => {
      this.player?.removeEventListener("error", handleError);
      this.player?.removeEventListener("buffering", handleBuffering);
      mediaElement.removeEventListener("timeupdate", handleTimeUpdate);
      mediaElement.removeEventListener("play", handlePlay);
      mediaElement.removeEventListener("pause", handlePause);
      mediaElement.removeEventListener("ended", handleEnded);
      mediaElement.removeEventListener("volumechange", handleVolumeChange);
    };
  }

  async load(source: PlaybackSource): Promise<void> {
    if (!this.player || !this.mediaElement) {
      throw new Error("ShakaPlaybackEngine.attach(videoElement) must be called before load().");
    }

    this.setState({ state: "loading" });

    if (source.drm) {
      const drmConfig = buildDrmConfiguration(source.drm);
      if (drmConfig) this.player.configure({ drm: drmConfig });
    }

    await this.player.load(source.url, source.startPositionSeconds ?? null, source.mimeType);

    this.setState({
      state: "ready",
      durationSeconds: Number.isFinite(this.mediaElement.duration) ? this.mediaElement.duration : 0,
    });
  }

  async play(): Promise<void> {
    await this.mediaElement?.play();
  }

  async pause(): Promise<void> {
    this.mediaElement?.pause();
  }

  async seek(positionSeconds: number): Promise<void> {
    if (!this.mediaElement) return;
    this.mediaElement.currentTime = positionSeconds;
    this.setState({ currentTimeSeconds: positionSeconds });
  }

  setVolume(volume: number): void {
    if (this.mediaElement) this.mediaElement.volume = volume;
    this.setState({ volume });
  }

  setMuted(muted: boolean): void {
    if (this.mediaElement) this.mediaElement.muted = muted;
    this.setState({ muted });
  }

  async destroy(): Promise<void> {
    this.detachListeners?.();
    await this.player?.destroy();
    this.player = null;
    this.mediaElement = null;
    this.setState({ state: "idle" });
  }
}

/** Re-exported for convenience so consumers don't need a second dependency on player-core. */
export type { PlaybackEngine, PlaybackEngineState, PlaybackSource, DrmConfig };
