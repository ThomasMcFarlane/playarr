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
  type ExternalSubtitleTrack,
  type PlaybackAudioTrack,
  type PlaybackSource,
  type PlaybackSubtitleTrack,
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

interface AvplayTrackMetadata {
  language?: string;
  track_lang?: string;
  title?: string;
  label?: string;
  channels?: number;
  channel?: number;
  role?: string;
  forced?: boolean;
}

function parseTrackMetadata(extraInfo: string): AvplayTrackMetadata {
  try {
    const parsed: unknown = JSON.parse(extraInfo);
    return parsed && typeof parsed === "object" ? (parsed as AvplayTrackMetadata) : {};
  } catch {
    return {};
  }
}

function avplayTrackId(type: "audio" | "subtitle", index: number): string {
  return `${type}:${index}`;
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

  private syncTrackState(): void {
    const streamInfo = webapis.avplay.getTotalTrackInfo();
    const currentStreamInfo = webapis.avplay.getCurrentStreamInfo();
    const currentAudioId =
      this.state.selectedAudioTrackId ??
      currentStreamInfo
        .filter((track) => track.type === "AUDIO")
        .map((track) => avplayTrackId("audio", track.index))[0] ??
      null;
    const currentSubtitleId =
      this.state.selectedSubtitleTrackId ??
      currentStreamInfo
        .filter((track) => track.type === "TEXT")
        .map((track) => avplayTrackId("subtitle", track.index))[0] ??
      null;
    const audioTracks: PlaybackAudioTrack[] = streamInfo
      .filter((track) => track.type === "AUDIO")
      .map((track, position) => {
        const metadata = parseTrackMetadata(track.extra_info);
        const id = avplayTrackId("audio", track.index);
        const language = metadata.language ?? metadata.track_lang;
        return {
          id,
          label: metadata.title ?? metadata.label ?? language ?? `Audio ${position + 1}`,
          language,
          roles: metadata.role ? [metadata.role] : [],
          channelsCount: metadata.channels ?? metadata.channel,
          selected: currentAudioId ? currentAudioId === id : position === 0,
        };
      });
    const subtitleTracks: PlaybackSubtitleTrack[] = streamInfo
      .filter((track) => track.type === "TEXT")
      .map((track, position) => {
        const metadata = parseTrackMetadata(track.extra_info);
        const id = avplayTrackId("subtitle", track.index);
        const language = metadata.language ?? metadata.track_lang;
        return {
          id,
          label: metadata.title ?? metadata.label ?? language ?? `Subtitles ${position + 1}`,
          language,
          roles: metadata.role ? [metadata.role] : [],
          forced: metadata.forced ?? false,
          selected: currentSubtitleId === id,
        };
      });

    this.setState({
      audioTracks,
      subtitleTracks,
      selectedAudioTrackId: audioTracks.find((track) => track.selected)?.id ?? null,
      selectedSubtitleTrackId:
        subtitleTracks.find((track) => track.selected)?.id ?? null,
    });
  }

  async load(source: PlaybackSource): Promise<void> {
    this.setState({
      state: "loading",
      audioTracks: [],
      subtitleTracks: [],
      selectedAudioTrackId: null,
      selectedSubtitleTrackId: null,
    });

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
    this.syncTrackState();

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

  async selectAudioTrack(trackId: string): Promise<void> {
    const track = this.state.audioTracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    const index = Number(trackId.slice("audio:".length));
    if (!Number.isInteger(index)) return;
    webapis.avplay.setSelectTrack("AUDIO", index);
    this.setState({
      audioTracks: this.state.audioTracks.map((candidate) => ({
        ...candidate,
        selected: candidate.id === trackId,
      })),
      selectedAudioTrackId: trackId,
    });
  }

  async addExternalSubtitleTracks(_tracks: ExternalSubtitleTrack[]): Promise<void> {
    // AVPlay cannot attach arbitrary WebVTT URLs to an already-open source.
    // Native embedded tracks remain available through `getTotalTrackInfo`.
  }

  async selectSubtitleTrack(trackId: string | null): Promise<void> {
    if (trackId === null) {
      webapis.avplay.setSilentSubtitle(true);
      this.setState({
        subtitleTracks: this.state.subtitleTracks.map((track) => ({
          ...track,
          selected: false,
        })),
        selectedSubtitleTrackId: null,
      });
      return;
    }

    const track = this.state.subtitleTracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    const index = Number(trackId.slice("subtitle:".length));
    if (!Number.isInteger(index)) return;
    webapis.avplay.setSelectTrack("TEXT", index);
    webapis.avplay.setSilentSubtitle(false);
    this.setState({
      subtitleTracks: this.state.subtitleTracks.map((candidate) => ({
        ...candidate,
        selected: candidate.id === trackId,
      })),
      selectedSubtitleTrackId: trackId,
    });
  }

  async destroy(): Promise<void> {
    if (this.currentTimeTimer) clearInterval(this.currentTimeTimer);
    webapis.avplay.stop();
    webapis.avplay.close();
    this.setState({ state: "idle" });
  }
}
