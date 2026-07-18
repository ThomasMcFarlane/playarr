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
  type ExternalSubtitleTrack,
  type PlaybackAudioTrack,
  type PlaybackEngine,
  type PlaybackEngineState,
  type PlaybackSource,
  type PlaybackSubtitleTrack,
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

interface AuthTokenRequest {
  forceRefresh?: boolean;
}

function trackLanguageLabel(language: string): string {
  const normalized = language.trim();
  if (!normalized || normalized === "und") return "";
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(normalized) ?? normalized;
  } catch {
    return normalized;
  }
}

function joinTrackLabel(
  label: string | null,
  language: string,
  roles: string[],
  fallback: string
): string {
  const parts = [
    label?.trim() || trackLanguageLabel(language),
    ...roles.filter((role) => role && role !== "main"),
  ].filter(Boolean);
  return [...new Set(parts)].join(" · ") || fallback;
}

function audioTrackId(track: shaka.extern.AudioTrack): string {
  return JSON.stringify([
    track.language,
    track.label,
    track.roles,
    track.channelsCount,
    track.codecs,
    track.audioSamplingRate,
    track.spatialAudio,
  ]);
}

/** `PlaybackEngine` adapter over `shaka.Player` + a `<video>` element. */
export class ShakaPlaybackEngine extends BasePlaybackEngine implements PlaybackEngine {
  private player: shaka.Player | null = null;
  private mediaElement: HTMLMediaElement | null = null;
  private detachListeners: (() => void) | null = null;
  private authHeaderProvider:
    | ((request?: AuthTokenRequest) => string | undefined | Promise<string | undefined>)
    | null = null;
  private lastSource: PlaybackSource | null = null;
  private authRecoveryPromise: Promise<void> | null = null;
  private unauthorizedRecoveryAttempts = 0;
  private readonly externalSubtitleTrackIds = new Map<string, number>();
  private nativeDirect = false;

  private subtitleTrackId(track: shaka.extern.TextTrack): string {
    return (
      [...this.externalSubtitleTrackIds.entries()].find(
        ([, shakaTrackId]) => shakaTrackId === track.id
      )?.[0] ?? String(track.id)
    );
  }

  private getDurationSeconds(): number {
    if (!this.mediaElement) return this.state.durationSeconds;
    if (Number.isFinite(this.mediaElement.duration) && this.mediaElement.duration > 0) {
      return this.mediaElement.duration;
    }

    const seekRange = this.player?.seekRange();
    if (seekRange && Number.isFinite(seekRange.end) && seekRange.end > 0) {
      return seekRange.end;
    }

    // `durationchange` can transiently report NaN/0 while MSE swaps or
    // extends buffers. Keep the last useful duration instead of flashing the
    // controls back to 0:00 during buffering or a seek.
    return this.state.durationSeconds;
  }

  private syncTimelineState(): void {
    if (!this.mediaElement) return;
    const mediaCurrentTime = Number.isFinite(this.mediaElement.currentTime)
      ? this.mediaElement.currentTime
      : this.state.currentTimeSeconds;
    const currentTimeSeconds =
      this.state.state === "loading" &&
      this.state.currentTimeSeconds > 0 &&
      mediaCurrentTime === 0
        ? this.state.currentTimeSeconds
        : mediaCurrentTime;
    this.setState({
      currentTimeSeconds,
      durationSeconds: this.getDurationSeconds(),
      bufferedSeconds: getBufferedEndSeconds(this.mediaElement),
    });
  }

  private syncTrackState(): void {
    if (!this.player) return;
    if (this.nativeDirect) {
      this.setState({
        audioTracks: [],
        subtitleTracks: [],
        selectedAudioTrackId: null,
        selectedSubtitleTrackId: null,
      });
      return;
    }

    const audioTracks: PlaybackAudioTrack[] = this.player.getAudioTracks().map((track, index) => ({
      id: audioTrackId(track),
      label: joinTrackLabel(track.label, track.language, track.roles, `Audio ${index + 1}`),
      language: track.language && track.language !== "und" ? track.language : undefined,
      roles: [...track.roles],
      channelsCount: track.channelsCount ?? undefined,
      selected: track.active,
    }));
    const subtitlesVisible = this.player.isTextTrackVisible();
    const subtitleTracks: PlaybackSubtitleTrack[] = this.player
      .getTextTracks()
      .map((track, index) => ({
        id: this.subtitleTrackId(track),
        label: joinTrackLabel(
          track.label,
          track.language,
          track.roles,
          `Subtitles ${index + 1}`
        ),
        language: track.language && track.language !== "und" ? track.language : undefined,
        roles: [...track.roles],
        forced: track.forced,
        selected: subtitlesVisible && track.active,
      }));

    this.setState({
      audioTracks,
      subtitleTracks,
      selectedAudioTrackId: audioTracks.find((track) => track.selected)?.id ?? null,
      selectedSubtitleTrackId:
        subtitleTracks.find((track) => track.selected)?.id ?? null,
    });
  }

  /**
   * Registers a callback awaited before every request Shaka's own
   * `NetworkingEngine` makes (manifest, segment, license, ...) -- whatever
   * it returns is attached as an `Authorization: Bearer <token>` header.
   * Streamarr's playback-adjacent routes (HLS manifest/segment serving in
   * particular) require this header -- see
   * `backend/crates/streamarr-api/src/auth_extractor.rs`'s `StreamingUser`
   * extractor.
   *
   * Safe to call before or after `attach()`/`load()`: the request filter
   * (registered once, in `attach()`) reads `authHeaderProvider` fresh on
   * every request rather than closing over a snapshot, so calling this
   * again later (e.g. after a token refresh) takes effect on the very next
   * request with no reload needed. Awaiting the shared session manager here
   * also lets playback keep using its existing buffer while an expiring token
   * is refreshed. Never calling this at all is also fine -- callers with no
   * auth requirement simply skip it.
   */
  setAuthHeaderProvider(
    provider: (
      request?: AuthTokenRequest
    ) => string | undefined | Promise<string | undefined>
  ): void {
    this.authHeaderProvider = provider;
  }

  private setShakaError(shakaError?: InstanceType<typeof shaka.util.Error>): void {
    const isBadHttpStatus = shakaError?.code === shaka.util.Error.Code.BAD_HTTP_STATUS;
    const httpStatus =
      isBadHttpStatus && typeof shakaError.data?.[1] === "number"
        ? shakaError.data[1]
        : undefined;
    const requestUri =
      isBadHttpStatus && typeof (shakaError.data?.[5] ?? shakaError.data?.[0]) === "string"
        ? (shakaError.data[5] ?? shakaError.data[0])
        : undefined;
    this.setState({
      state: "error",
      error: {
        code: shakaError ? String(shakaError.code) : "UNKNOWN",
        message: shakaError?.message ?? "Unknown Shaka Player error",
        fatal: shakaError?.severity === shaka.util.Error.Severity.CRITICAL,
        httpStatus,
        requestUri,
      },
    });
  }

  private recoverFromUnauthorized(
    shakaError: InstanceType<typeof shaka.util.Error>
  ): void {
    if (this.authRecoveryPromise || !this.authHeaderProvider) return;

    const source = this.lastSource;
    const resumePositionSeconds = this.mediaElement?.currentTime ?? this.state.currentTimeSeconds;
    const shouldResume =
      !this.mediaElement?.paused ||
      this.state.state === "playing" ||
      this.state.state === "buffering";
    this.setState({ state: "buffering", error: undefined });

    const recovery = (async () => {
      while (this.unauthorizedRecoveryAttempts < 5) {
        const attempt = ++this.unauthorizedRecoveryAttempts;
        if (attempt > 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1_000 * 2 ** (attempt - 2))
          );
        }

        try {
          await this.authHeaderProvider?.({ forceRefresh: true });
          if (!this.player) return;

          // An already-loaded MSE stream can resume without discarding its
          // buffer. Initial manifests and progressive sources need a fresh
          // load at the current playhead instead.
          if (this.player.retryStreaming(0)) return;
          if (!source) throw new Error("No playback source is available to retry.");
          await this.load({ ...source, startPositionSeconds: resumePositionSeconds });
          if (shouldResume) await this.play();
          return;
        } catch {
          // Keep the surface in buffering state and retry with exponential
          // backoff. A repeated 401 raised by the nested load is consumed by
          // this in-flight recovery rather than spawning a second loop.
        }
      }

      this.setShakaError(shakaError);
    })();

    this.authRecoveryPromise = recovery.finally(() => {
      this.authRecoveryPromise = null;
    });
  }

  /** Attaches to a `<video>` element. Must be called once before `load()`. */
  attach(mediaElement: HTMLMediaElement): void {
    ensurePolyfillsInstalled();

    if (!shaka.Player.isBrowserSupported()) {
      throw new Error("This browser is not supported by Shaka Player (MSE/EME unavailable).");
    }

    this.mediaElement = mediaElement;
    this.player = new shaka.Player();
    void this.player.attach(mediaElement);

    // Force MSE-based HLS parsing on every browser, Safari included. Safari
    // has real native HLS support and Shaka defaults to preferring it there
    // (`preferNativeHls`), but native HLS playback bypasses
    // `NetworkingEngine` entirely -- the browser's own network stack fetches
    // the manifest/segments directly, with no way for the request filter
    // below to run or attach a header. Forcing MSE playback everywhere keeps
    // auth-header injection (and error/state reporting) uniform across
    // browsers instead of silently 401ing only on Safari.
    //
    // `manifest.retryParameters` is widened well past Shaka's default (a
    // couple of quick attempts, gone in a few seconds total) because a
    // freshly-negotiated on-demand session's `playlist.m3u8` (see
    // `streamarr-transcode::spawn_on_demand_transcode`) does not exist on
    // disk until ffmpeg actually starts writing it -- multiple seconds away
    // for a real 4K source, confirmed live (~7-10s cold start). Confirmed
    // live without this: Shaka 404s on the manifest fetch, exhausts its
    // default retry budget in under two seconds, and fires a fatal `error`
    // event -- the exact "can't load/play anything" symptom, with no
    // negotiation error and no obviously-broken network request to explain
    // it. `streamarr-api`'s `serve_session_file_handler` doc comment already
    // assumed "real HLS players retry"; this is what actually makes that
    // true. `streaming.retryParameters` gets the same treatment for
    // segment requests, which hit the same not-written-yet race for
    // whichever segment is currently at the encode's leading edge.
    const transcodeAwareRetry = {
      timeout: 30_000,
      maxAttempts: 15,
      baseDelay: 1_000,
      backoffFactor: 1.3,
      fuzzFactor: 0.5,
    };
    this.player.configure({
      streaming: { preferNativeHls: false, retryParameters: transcodeAwareRetry },
      manifest: { retryParameters: transcodeAwareRetry },
    });

    // See `setAuthHeaderProvider` above -- reads `this.authHeaderProvider`
    // fresh on every request rather than a value captured at registration
    // time.
    this.player.getNetworkingEngine()?.registerRequestFilter(async (_type, request) => {
      const token = await this.authHeaderProvider?.();
      if (token) {
        request.headers["Authorization"] = `Bearer ${token}`;
      }
    });

    const handleError = (event: Event) => {
      const shakaError = (event as unknown as { detail?: InstanceType<typeof shaka.util.Error> })
        .detail;
      const httpStatus =
        shakaError?.code === shaka.util.Error.Code.BAD_HTTP_STATUS &&
        typeof shakaError.data?.[1] === "number"
          ? shakaError.data[1]
          : undefined;
      if (shakaError && httpStatus === 401) {
        this.recoverFromUnauthorized(shakaError);
        return;
      }
      this.setShakaError(shakaError);
    };

    const handleBuffering = (event: Event) => {
      const buffering = (event as unknown as { buffering?: boolean }).buffering ?? true;
      if (!buffering) this.unauthorizedRecoveryAttempts = 0;
      this.setState({
        state: buffering ? "buffering" : this.mediaElement?.paused ? "paused" : "playing",
      });
    };

    const handleTimelineChange = () => this.syncTimelineState();
    const handleTracksChange = () => this.syncTrackState();
    const handlePlay = () => {
      this.unauthorizedRecoveryAttempts = 0;
      this.setState({ state: "playing" });
    };
    const handlePause = () =>
      this.setState({ state: this.state.state === "ended" ? "ended" : "paused" });
    const handleEnded = () => this.setState({ state: "ended" });
    const handleWaiting = () => {
      if (this.nativeDirect) this.setState({ state: "buffering" });
    };
    const handleCanPlay = () => {
      if (!this.nativeDirect) return;
      this.syncTimelineState();
      this.setState({ state: mediaElement.paused ? "paused" : "playing" });
    };
    const handleNativeError = () => {
      if (!this.nativeDirect) return;
      const mediaError = mediaElement.error;
      this.setState({
        state: "error",
        error: {
          code: mediaError ? `MEDIA_${mediaError.code}` : "MEDIA_UNKNOWN",
          message: mediaError?.message || "The browser could not load this audio source.",
          fatal: true,
        },
      });
    };
    const handleVolumeChange = () => {
      if (!this.mediaElement) return;
      this.setState({ volume: this.mediaElement.volume, muted: this.mediaElement.muted });
    };

    this.player.addEventListener("error", handleError);
    this.player.addEventListener("buffering", handleBuffering);
    this.player.addEventListener("trackschanged", handleTracksChange);
    this.player.addEventListener("variantchanged", handleTracksChange);
    this.player.addEventListener("textchanged", handleTracksChange);
    this.player.addEventListener("texttrackvisibility", handleTracksChange);
    mediaElement.addEventListener("loadedmetadata", handleTimelineChange);
    mediaElement.addEventListener("durationchange", handleTimelineChange);
    mediaElement.addEventListener("timeupdate", handleTimelineChange);
    mediaElement.addEventListener("progress", handleTimelineChange);
    mediaElement.addEventListener("seeking", handleTimelineChange);
    mediaElement.addEventListener("seeked", handleTimelineChange);
    mediaElement.addEventListener("play", handlePlay);
    mediaElement.addEventListener("pause", handlePause);
    mediaElement.addEventListener("ended", handleEnded);
    mediaElement.addEventListener("waiting", handleWaiting);
    mediaElement.addEventListener("stalled", handleWaiting);
    mediaElement.addEventListener("canplay", handleCanPlay);
    mediaElement.addEventListener("error", handleNativeError);
    mediaElement.addEventListener("volumechange", handleVolumeChange);

    this.detachListeners = () => {
      this.player?.removeEventListener("error", handleError);
      this.player?.removeEventListener("buffering", handleBuffering);
      this.player?.removeEventListener("trackschanged", handleTracksChange);
      this.player?.removeEventListener("variantchanged", handleTracksChange);
      this.player?.removeEventListener("textchanged", handleTracksChange);
      this.player?.removeEventListener("texttrackvisibility", handleTracksChange);
      mediaElement.removeEventListener("loadedmetadata", handleTimelineChange);
      mediaElement.removeEventListener("durationchange", handleTimelineChange);
      mediaElement.removeEventListener("timeupdate", handleTimelineChange);
      mediaElement.removeEventListener("progress", handleTimelineChange);
      mediaElement.removeEventListener("seeking", handleTimelineChange);
      mediaElement.removeEventListener("seeked", handleTimelineChange);
      mediaElement.removeEventListener("play", handlePlay);
      mediaElement.removeEventListener("pause", handlePause);
      mediaElement.removeEventListener("ended", handleEnded);
      mediaElement.removeEventListener("waiting", handleWaiting);
      mediaElement.removeEventListener("stalled", handleWaiting);
      mediaElement.removeEventListener("canplay", handleCanPlay);
      mediaElement.removeEventListener("error", handleNativeError);
      mediaElement.removeEventListener("volumechange", handleVolumeChange);
    };
  }

  async load(source: PlaybackSource): Promise<void> {
    if (!this.player || !this.mediaElement) {
      throw new Error("ShakaPlaybackEngine.attach(videoElement) must be called before load().");
    }

    this.lastSource = source;
    this.externalSubtitleTrackIds.clear();
    this.setState({
      state: "loading",
      currentTimeSeconds: source.startPositionSeconds ?? this.state.currentTimeSeconds,
      durationSeconds: this.state.durationSeconds,
      bufferedSeconds: 0,
      audioTracks: [],
      subtitleTracks: [],
      selectedAudioTrackId: null,
      selectedSubtitleTrackId: null,
      error: undefined,
    });

    if (source.drm) {
      const drmConfig = buildDrmConfiguration(source.drm);
      if (drmConfig) this.player.configure({ drm: drmConfig });
    }

    const isDirectAudio = (source.mimeType.split(";", 1)[0] ?? "")
      .trim()
      .toLowerCase()
      .startsWith("audio/");

    if (isDirectAudio) {
      // Shaka deliberately switches progressive audio to its native
      // `src=` path. That path bypasses Shaka's NetworkingEngine (and its
      // bearer-header filter), so make the native behaviour explicit and
      // use the session-scoped URL returned by playback negotiation.
      await this.player.unload();
      this.nativeDirect = true;
      this.mediaElement.preload = "auto";
      this.mediaElement.src = source.url;
      this.mediaElement.load();

      await new Promise<void>((resolve, reject) => {
        if (!this.mediaElement) {
          reject(new Error("Media element detached while loading audio."));
          return;
        }
        const mediaElement = this.mediaElement;
        const cleanup = () => {
          mediaElement.removeEventListener("loadedmetadata", handleLoaded);
          mediaElement.removeEventListener("error", handleError);
        };
        const handleLoaded = () => {
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(
            new Error(
              mediaElement.error?.message || "The browser could not load this audio source."
            )
          );
        };

        if (mediaElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
          resolve();
          return;
        }
        mediaElement.addEventListener("loadedmetadata", handleLoaded, { once: true });
        mediaElement.addEventListener("error", handleError, { once: true });
      });
    } else {
      if (this.nativeDirect) {
        this.mediaElement.pause();
        this.mediaElement.removeAttribute("src");
        this.mediaElement.load();
      }
      this.nativeDirect = false;
      await this.player.load(source.url, source.startPositionSeconds ?? null, source.mimeType);
    }

    this.syncTimelineState();
    this.syncTrackState();
    this.setState({
      state: "ready",
      durationSeconds: this.getDurationSeconds(),
    });
    this.unauthorizedRecoveryAttempts = 0;
  }

  async play(): Promise<void> {
    await this.mediaElement?.play();
  }

  async pause(): Promise<void> {
    this.mediaElement?.pause();
  }

  async seek(positionSeconds: number): Promise<void> {
    if (!this.mediaElement) return;
    const durationSeconds = this.getDurationSeconds();
    const nextPosition = Math.min(
      durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY,
      Math.max(0, positionSeconds)
    );

    // Updating currentTime is Shaka's supported seek mechanism. Its internal
    // playhead/streaming engine observes the native `seeking` event, abandons
    // the old buffering target and requests the segment range around this
    // position. It does not change the element's paused state.
    this.setState({ currentTimeSeconds: nextPosition });
    this.mediaElement.currentTime = nextPosition;
  }

  setVolume(volume: number): void {
    if (this.mediaElement) this.mediaElement.volume = volume;
    this.setState({ volume });
  }

  setMuted(muted: boolean): void {
    if (this.mediaElement) this.mediaElement.muted = muted;
    this.setState({ muted });
  }

  async selectAudioTrack(trackId: string): Promise<void> {
    if (this.nativeDirect) return;
    const track = this.player
      ?.getAudioTracks()
      .find((candidate) => audioTrackId(candidate) === trackId);
    if (!track || !this.player) return;
    this.player.selectAudioTrack(track, 0);
    this.syncTrackState();
  }

  async addExternalSubtitleTracks(tracks: ExternalSubtitleTrack[]): Promise<void> {
    if (!this.player || this.nativeDirect) return;
    for (const track of tracks) {
      if (this.externalSubtitleTrackIds.has(track.id)) continue;
      const added = await this.player.addTextTrackAsync(
        track.url,
        track.language ?? "und",
        "subtitles",
        "text/vtt",
        "",
        track.label,
        track.forced ?? false
      );
      this.externalSubtitleTrackIds.set(track.id, added.id);
    }
    this.player.setTextTrackVisibility(false);
    this.syncTrackState();
  }

  async selectSubtitleTrack(trackId: string | null): Promise<void> {
    if (!this.player || this.nativeDirect) return;
    if (trackId === null) {
      this.player.setTextTrackVisibility(false);
      this.syncTrackState();
      return;
    }

    const track = this.player
      .getTextTracks()
      .find((candidate) => this.subtitleTrackId(candidate) === trackId);
    if (!track) return;
    this.player.selectTextTrack(track);
    this.player.setTextTrackVisibility(true);
    this.syncTrackState();
  }

  async destroy(): Promise<void> {
    this.detachListeners?.();
    if (this.nativeDirect && this.mediaElement) {
      this.mediaElement.pause();
      this.mediaElement.removeAttribute("src");
      this.mediaElement.load();
    }
    await this.player?.destroy();
    this.player = null;
    this.mediaElement = null;
    this.nativeDirect = false;
    this.lastSource = null;
    this.authRecoveryPromise = null;
    this.unauthorizedRecoveryAttempts = 0;
    this.externalSubtitleTrackIds.clear();
    this.setState({ state: "idle" });
  }
}

/** Re-exported for convenience so consumers don't need a second dependency on player-core. */
export type {
  PlaybackAudioTrack,
  ExternalSubtitleTrack,
  PlaybackEngine,
  PlaybackEngineState,
  PlaybackSource,
  PlaybackSubtitleTrack,
  DrmConfig,
};
