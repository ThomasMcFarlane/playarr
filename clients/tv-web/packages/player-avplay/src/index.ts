/**
 * @streamarr-tv/player-avplay
 *
 * Tizen `webapis.avplay` adapter implementing `PlaybackEngine`. AVPlay is a
 * native, event-driven player exposed to the web view -- unlike Shaka/MSE,
 * there's no `<video>` element in the loop; `setDisplayRect` positions a
 * native video plane behind (or in front of) the web content instead.
 *
 * Typed against `./tizen-avplay.d.ts`, a hand-written stand-in for the
 * Tizen SDK's own type declarations (no Tizen Studio/TV Simulator is
 * available in this environment to source real ones from).
 */

import {
  BasePlaybackEngine,
  type DrmConfig,
  type DrmSystemId,
  type PlaybackSource,
} from "@streamarr-tv/player-core";

function toAvplayDrmType(systemId: DrmSystemId): AVPlayDrmType | undefined {
  switch (systemId) {
    case "com.widevine.alpha":
      return "WIDEVINE_CDM";
    case "com.microsoft.playready":
      return "PLAYREADY";
    default:
      return undefined;
  }
}

function toPlaybackState(avplayState: AVPlayState): "idle" | "ready" | "playing" | "paused" | "ended" {
  switch (avplayState) {
    case "NONE":
    case "IDLE":
      return "idle";
    case "READY":
      return "ready";
    case "PLAYING":
      return "playing";
    case "PAUSED":
      return "paused";
  }
}

export interface TizenAvplayEngineOptions {
  /** Display plane rect in output pixels, e.g. the full 1920x1080 canvas. Defaults to full-screen 1080p. */
  displayRect?: { x: number; y: number; width: number; height: number };
}

/** `PlaybackEngine` adapter over Tizen's native `webapis.avplay`. */
export class TizenAvplayEngine extends BasePlaybackEngine {
  private readonly displayRect: { x: number; y: number; width: number; height: number };
  private currentTimeTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: TizenAvplayEngineOptions = {}) {
    super();
    this.displayRect = options.displayRect ?? { x: 0, y: 0, width: 1920, height: 1080 };
  }

  private applyDrm(drm: DrmConfig): void {
    const drmType = toAvplayDrmType(drm.systemId);
    if (!drmType) return;

    if (drm.systemId === "com.widevine.alpha" && drm.licenseServerUrl) {
      webapis.avplay.setStreamingProperty("WIDEVINE_LICENSE_SERVER_URL", drm.licenseServerUrl);
    }
    if (drm.systemId === "com.microsoft.playready" && drm.licenseServerUrl) {
      webapis.avplay.setStreamingProperty("PLAYREADY_LICENSE_SERVER_URL", drm.licenseServerUrl);
    }
    webapis.avplay.setDrm(drmType, JSON.stringify({ licenseServer: drm.licenseServerUrl ?? "" }));
  }

  private attachListener(): void {
    webapis.avplay.setListener({
      onbufferingstart: () => this.setState({ state: "buffering" }),
      onbufferingprogress: () => this.setState({ state: "buffering" }),
      onbufferingcomplete: () =>
        this.setState({ state: toPlaybackState(webapis.avplay.getState()) }),
      onstreamcompleted: () => this.setState({ state: "ended" }),
      oncurrentplaytime: (currentTime) =>
        this.setState({ currentTimeSeconds: currentTime / 1000 }),
      onerror: (eventType) =>
        this.setState({
          state: "error",
          error: { code: eventType, message: `AVPlay error: ${eventType}`, fatal: true },
        }),
    });
  }

  async load(source: PlaybackSource): Promise<void> {
    this.setState({ state: "loading" });

    webapis.avplay.open(source.url);
    this.attachListener();
    webapis.avplay.setDisplayRect(
      this.displayRect.x,
      this.displayRect.y,
      this.displayRect.width,
      this.displayRect.height
    );

    if (source.drm) {
      this.applyDrm(source.drm);
    }

    await new Promise<void>((resolve, reject) => {
      webapis.avplay.prepareAsync(
        () => resolve(),
        (error) => reject(error instanceof Error ? error : new Error(String(error)))
      );
    });

    this.setState({
      state: "ready",
      durationSeconds: webapis.avplay.getDuration() / 1000,
    });

    if (source.startPositionSeconds) {
      await this.seek(source.startPositionSeconds);
    }
  }

  async play(): Promise<void> {
    webapis.avplay.play();
    this.setState({ state: "playing" });
  }

  async pause(): Promise<void> {
    webapis.avplay.pause();
    this.setState({ state: "paused" });
  }

  async seek(positionSeconds: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      webapis.avplay.seekTo(
        Math.round(positionSeconds * 1000),
        () => resolve(),
        (error) => reject(error instanceof Error ? error : new Error(String(error)))
      );
    });
    this.setState({ currentTimeSeconds: positionSeconds });
  }

  setVolume(volume: number): void {
    // AVPlay does not expose per-instance volume control -- TV platform volume
    // is controlled via the physical remote / system volume API instead.
    // Tracked here only so `getState()` stays a faithful reflection of intent.
    this.setState({ volume });
  }

  setMuted(muted: boolean): void {
    this.setState({ muted });
  }

  async destroy(): Promise<void> {
    if (this.currentTimeTimer) clearInterval(this.currentTimeTimer);
    webapis.avplay.stop();
    webapis.avplay.close();
    this.setState({ state: "idle" });
  }
}
