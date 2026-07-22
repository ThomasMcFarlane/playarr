/**
 * Samsung Tizen `webapis.avplay` adapter for Playarr's shared playback
 * contract. AVPlay owns a native video plane, so there is no HTML media
 * element to attach; the Tizen shell supplies the required
 * `<object type="application/avplayer">` surface instead.
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

export type TizenAvplayState = "NONE" | "IDLE" | "READY" | "PLAYING" | "PAUSED";

export type TizenAvplayDisplayMethod =
  | "PLAYER_DISPLAY_MODE_LETTER_BOX"
  | "PLAYER_DISPLAY_MODE_FULL_SCREEN"
  | "PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO";

export type TizenAvplayDrmType = "PLAYREADY" | "WIDEVINE_CDM" | "VERIMATRIX";
export type TizenAvplayDrmOperation =
  | "SetProperties"
  | "InstallLicense"
  | "ProcessInitiator"
  | "widevine_license_data";
export type TizenAvplayTrackType = "AUDIO" | "TEXT" | "VIDEO";

export interface TizenAvplayStreamInfo {
  index: number;
  type: TizenAvplayTrackType;
  extra_info: string;
}

export interface TizenAvplayListener {
  onbufferingstart?: () => void;
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  onstreamcompleted?: () => void;
  oncurrentplaytime?: (currentTime: number) => void;
  onerror?: (eventType: string) => void;
  onerrormsg?: (eventType: string, errorMessage: string) => void;
  onevent?: (eventType: string, eventData?: string) => void;
  onsubtitlechange?: (duration: number, text: string, data3: string, data4: string) => void;
  ondrmevent?: (drmEvent: string, drmData: unknown) => void;
}

export interface TizenAvplayApi {
  open(url: string): void;
  close(): void;
  prepare(): void;
  prepareAsync(successCallback?: () => void, errorCallback?: (error: unknown) => void): void;
  play(): void;
  stop(): void;
  pause(): void;
  seekTo(
    millisecond: number,
    successCallback?: () => void,
    errorCallback?: (error: unknown) => void
  ): void;
  jumpForward(
    millisecond: number,
    successCallback?: () => void,
    errorCallback?: (error: unknown) => void
  ): void;
  jumpBackward(
    millisecond: number,
    successCallback?: () => void,
    errorCallback?: (error: unknown) => void
  ): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod(method: TizenAvplayDisplayMethod): void;
  setTimeoutForBuffering(seconds: number): void;
  setListener(listener: TizenAvplayListener): void;
  setStreamingProperty(property: "COOKIE" | "USER_AGENT" | "ADAPTIVE_INFO", value: string): void;
  getStreamingProperty(property: string): string;
  setDrm(
    drmType: TizenAvplayDrmType,
    operation: TizenAvplayDrmOperation,
    parameter: string
  ): string | void;
  getState(): TizenAvplayState;
  getDuration(): number;
  getCurrentTime(): number;
  getTotalTrackInfo(): TizenAvplayStreamInfo[];
  getCurrentStreamInfo(): TizenAvplayStreamInfo[];
  setSelectTrack(trackType: "AUDIO" | "TEXT", trackIndex: number): void;
  setSilentSubtitle(silent: boolean): void;
  setExternalSubtitlePath(filePath: string): void;
  suspend(): void;
  restore(url?: string, resumeTime?: number, prepare?: boolean): void;
  restoreAsync?(
    url?: string,
    resumeTime?: number,
    prepare?: boolean,
    successCallback?: () => void,
    errorCallback?: (error: unknown) => void
  ): void;
}

export interface TizenAppCommonApi {
  AppCommonScreenSaverState: {
    SCREEN_SAVER_ON: string | number;
    SCREEN_SAVER_OFF: string | number;
  };
  setScreenSaver(
    state: string | number,
    successCallback?: (result?: unknown) => void,
    errorCallback?: (error: unknown) => void
  ): void;
}

export interface TizenFileHandle {
  writeBlob(blob: Blob): number | void;
  close(): void;
}

export interface TizenFilesystemApi {
  openFile(path: string, mode: "w", makeParents?: boolean): TizenFileHandle;
  toURI(path: string): string;
}

export interface TizenLifecycleDocument {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
  getElementById?(id: string): HTMLElement | null;
}

export interface TizenAvplayEngineOptions {
  /** AVPlay display coordinates always use Samsung's 1920x1080 reference canvas. */
  displayRect?: { x: number; y: number; width: number; height: number };
  /** Test/embedding override. Production resolves `webapis.avplay`. */
  avplay?: TizenAvplayApi;
  /** Test/embedding override. Production resolves `webapis.appcommon`. */
  appcommon?: TizenAppCommonApi;
  /** Test/embedding override. Production resolves `tizen.filesystem`. */
  filesystem?: TizenFilesystemApi;
  /** Resolve a remote/blob subtitle to an AVPlay-compatible absolute local path. */
  resolveExternalSubtitlePath?: (track: ExternalSubtitleTrack) => Promise<string>;
  /** Resolve a browser-only media URL (notably a downloaded `blob:` URL) for AVPlay. */
  resolveMediaSourceUrl?: (source: PlaybackSource) => Promise<string>;
  /** Test/embedding override for materialising browser Blob URLs. */
  fetchImpl?: typeof fetch;
  /** Defaults to the browser document; pass null to disable automatic suspend/restore. */
  lifecycleDocument?: TizenLifecycleDocument | null;
  /** Native AVPlay object whose visibility follows whether the source has video. */
  displayElement?: HTMLElement | null;
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

function runtimeWebApis(): TizenWebApis | undefined {
  return typeof webapis === "undefined" ? undefined : webapis;
}

function runtimeFilesystem(): TizenFilesystemApi | undefined {
  return typeof tizen === "undefined" ? undefined : tizen.filesystem;
}

function runtimeDocument(): TizenLifecycleDocument | null {
  return typeof document === "undefined" ? null : document;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function toAvplayDrmType(systemId: DrmSystemId): TizenAvplayDrmType | undefined {
  switch (systemId) {
    case "com.widevine.alpha":
      return "WIDEVINE_CDM";
    case "com.microsoft.playready":
      return "PLAYREADY";
    default:
      return undefined;
  }
}

function toPlaybackState(
  avplayState: TizenAvplayState
): "idle" | "ready" | "playing" | "paused" {
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

function drmHeaders(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined;
  const entries = Object.entries(headers);
  return entries.length > 0
    ? entries.map(([name, value]) => `${name}: ${value}`).join("\r\n")
    : undefined;
}

function subtitleFileName(trackId: string): string {
  const safeId = trackId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "subtitle";
  return `wgt-private-tmp/playarr-subtitles/${safeId}.smi`;
}

function parseWebVttTimestamp(value: string): number | undefined {
  const parts = value.trim().replace(",", ".").split(":");
  if (parts.length !== 2 && parts.length !== 3) return undefined;
  const seconds = Number(parts[parts.length - 1]);
  const minutes = Number(parts[parts.length - 2]);
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    hours < 0 ||
    minutes < 0 ||
    minutes >= 60 ||
    seconds < 0 ||
    seconds >= 60
  ) {
    return undefined;
  }
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function samiText(webVttText: string): string {
  return webVttText
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?!#\d+;|#x[\da-f]+;|[a-z][\w-]*;)/gi, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/**
 * Converts the WebVTT sidecars returned by Playarr into SAMI, one of the
 * external-subtitle formats Samsung documents for AVPlay.
 */
export function webVttToSami(input: string): string {
  const lines = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: Array<{ id: number; start: number; end: number; text: string }> = [];
  let cueId = 0;

  for (let index = 0; index < lines.length; ) {
    let timingLine = lines[index]?.trim() ?? "";
    if (!timingLine || timingLine === "WEBVTT" || timingLine.startsWith("NOTE")) {
      index += 1;
      if (timingLine.startsWith("NOTE")) {
        while (index < lines.length && lines[index]?.trim()) index += 1;
      }
      continue;
    }
    if (!timingLine.includes("-->")) {
      index += 1;
      timingLine = lines[index]?.trim() ?? "";
    }
    const match = timingLine.match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if (!match) {
      index += 1;
      continue;
    }
    const start = parseWebVttTimestamp(match[1] ?? "");
    const end = parseWebVttTimestamp(match[2] ?? "");
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index]?.trim()) {
      textLines.push(lines[index] ?? "");
      index += 1;
    }
    if (start === undefined || end === undefined || end <= start || textLines.length === 0) {
      continue;
    }
    cues.push({ id: cueId++, start, end, text: samiText(textLines.join("\n")) });
  }

  const events = new Map<
    number,
    { starts: Array<(typeof cues)[number]>; ends: number[] }
  >();
  for (const cue of cues) {
    const startEvent = events.get(cue.start) ?? { starts: [], ends: [] };
    startEvent.starts.push(cue);
    events.set(cue.start, startEvent);
    const endEvent = events.get(cue.end) ?? { starts: [], ends: [] };
    endEvent.ends.push(cue.id);
    events.set(cue.end, endEvent);
  }

  const active = new Map<number, string>();
  const syncLines: string[] = [];
  for (const [time, event] of Array.from(events.entries()).sort(([left], [right]) => left - right)) {
    for (const id of event.ends) active.delete(id);
    for (const cue of event.starts) active.set(cue.id, cue.text);
    const text = active.size > 0 ? Array.from(active.values()).join("<br>") : "&nbsp;";
    syncLines.push(`<SYNC Start=${time}><P Class=ENCC>${text}`);
  }

  return [
    "<SAMI>",
    "<HEAD>",
    '<STYLE TYPE="text/css">',
    "<!--",
    "P { font-family: sans-serif; text-align: center; color: white; background-color: black; }",
    ".ENCC { Name: English; lang: en-US; SAMIType: CC; }",
    "-->",
    "</STYLE>",
    "</HEAD>",
    "<BODY>",
    ...syncLines,
    "</BODY>",
    "</SAMI>",
  ].join("\n");
}

function mediaFileExtension(mimeType: string): string {
  switch (mimeType.toLowerCase().split(";", 1)[0]?.trim()) {
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/x-matroska":
      return "mkv";
    case "video/mp2t":
      return "ts";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/flac":
      return "flac";
    default:
      return "media";
  }
}

function mediaFileName(source: PlaybackSource): string {
  const sourceId = source.url.split("/").pop() ?? "download";
  const safeId = sourceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "download";
  return `wgt-private-tmp/playarr-media/${safeId}.${mediaFileExtension(source.mimeType)}`;
}

async function writeBlobToTizenFile(
  blob: Blob,
  path: string,
  filesystem: TizenFilesystemApi | undefined
): Promise<string> {
  if (!filesystem) {
    throw new Error(
      "Tizen filesystem access is unavailable; Samsung AVPlay cannot open browser Blob URLs"
    );
  }
  const handle = filesystem.openFile(path, "w", true);
  try {
    handle.writeBlob(blob);
  } finally {
    handle.close();
  }
  return filesystem.toURI(path);
}

async function writeBrowserBlobToTizenFile(
  url: string,
  path: string,
  filesystem: TizenFilesystemApi | undefined,
  fetchImpl: typeof fetch
): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Could not materialise AVPlay resource (${response.status})`);
  return writeBlobToTizenFile(await response.blob(), path, filesystem);
}

async function materializeExternalSubtitle(
  track: ExternalSubtitleTrack,
  filesystem: TizenFilesystemApi | undefined,
  fetchImpl: typeof fetch
): Promise<string> {
  const response = await fetchImpl(track.url);
  if (!response.ok) throw new Error(`Could not download AVPlay subtitle (${response.status})`);
  const sami = webVttToSami(await response.text());
  return writeBlobToTizenFile(
    new Blob([sami], { type: "application/x-sami" }),
    subtitleFileName(track.id),
    filesystem
  );
}

/** True only inside a Samsung TV runtime after `$WEBAPIS/webapis/webapis.js` loads. */
export function isTizenAvplayAvailable(): boolean {
  return Boolean(runtimeWebApis()?.avplay);
}

/** `PlaybackEngine` adapter over Samsung's native AVPlay state machine. */
export class TizenAvplayEngine extends BasePlaybackEngine {
  private readonly avplay: TizenAvplayApi;
  private readonly appcommon: TizenAppCommonApi | undefined;
  private readonly filesystem: TizenFilesystemApi | undefined;
  private readonly displayRect: { x: number; y: number; width: number; height: number };
  private readonly resolveExternalSubtitlePath: (
    track: ExternalSubtitleTrack
  ) => Promise<string>;
  private readonly resolveMediaSourceUrl: (source: PlaybackSource) => Promise<string>;
  private readonly lifecycleDocument: TizenLifecycleDocument | null;
  private readonly displayElement: HTMLElement | null;
  private readonly externalSubtitleSources = new Map<string, ExternalSubtitleTrack>();
  private readonly resolvedExternalSubtitlePaths = new Map<string, string>();
  private pendingPlaybackSessionId: string | null = null;
  private loadGeneration = 0;
  private trackSyncAttempts = 0;
  private tracksSynchronized = false;
  private initialAudioTrackApplied = false;
  private currentSourceHasVideo = true;
  private suspended = false;
  private destroyed = false;

  constructor(options: TizenAvplayEngineOptions = {}) {
    super();
    const runtime = runtimeWebApis();
    const avplay = options.avplay ?? runtime?.avplay;
    if (!avplay) {
      throw new Error(
        "Samsung AVPlay is unavailable; load $WEBAPIS/webapis/webapis.js before creating TizenAvplayEngine"
      );
    }

    this.avplay = avplay;
    this.appcommon = options.appcommon ?? runtime?.appcommon;
    this.filesystem = options.filesystem ?? runtimeFilesystem();
    const fetchImpl = options.fetchImpl ?? fetch;
    this.displayRect = options.displayRect ?? { x: 0, y: 0, width: 1920, height: 1080 };
    this.resolveExternalSubtitlePath =
      options.resolveExternalSubtitlePath ??
      ((track) => materializeExternalSubtitle(track, this.filesystem, fetchImpl));
    this.resolveMediaSourceUrl =
      options.resolveMediaSourceUrl ??
      ((source) =>
        source.url.startsWith("blob:")
          ? writeBrowserBlobToTizenFile(
              source.url,
              mediaFileName(source),
              this.filesystem,
              fetchImpl
            )
          : Promise.resolve(source.url));
    this.lifecycleDocument =
      options.lifecycleDocument === undefined ? runtimeDocument() : options.lifecycleDocument;
    this.displayElement =
      options.displayElement === undefined
        ? (this.lifecycleDocument?.getElementById?.("av-player") ?? null)
        : options.displayElement;
    this.setDisplayElementVisible(false);
    this.lifecycleDocument?.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  /**
   * Supplies one playback-session identifier for the next `load()` only.
   * AVPlay's COOKIE property is applied immediately after `open()` enters
   * IDLE and before `prepareAsync()`, so both manifest and segment requests
   * carry the session-scoped authorization cookie without exposing a bearer
   * token in a media URL.
   */
  setPlaybackSessionId(sessionId: string | null): void {
    this.pendingPlaybackSessionId = sessionId;
  }

  /** AVPlay does not expose transfer counters through its public TV API. */
  getBytesReceived(): number {
    return 0;
  }

  resetBytesReceived(): void {
    // Intentionally empty; see getBytesReceived().
  }

  private setDisplayElementVisible(visible: boolean): void {
    if (this.displayElement) {
      this.displayElement.style.visibility = visible ? "visible" : "hidden";
    }
  }

  private setScreenSaver(enabled: boolean): void {
    const appcommon = this.appcommon;
    if (!appcommon) return;
    const state = enabled
      ? appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON
      : appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF;
    try {
      appcommon.setScreenSaver(state, undefined, () => undefined);
    } catch {
      // Playback must remain usable if one model rejects AppCommon.
    }
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.destroyed || !this.lifecycleDocument) return;
    if (this.lifecycleDocument.hidden) {
      const state = this.safeAvplayState();
      if (state === "READY" || state === "PLAYING" || state === "PAUSED") {
        try {
          this.avplay.suspend();
          this.suspended = true;
          this.setScreenSaver(true);
        } catch {
          // Some models do not expose multitasking; the OS still backgrounds the app.
        }
      }
      return;
    }

    if (!this.suspended) return;
    this.suspended = false;
    const restoreSucceeded = () => {
      if (this.state.state === "playing" || this.state.state === "buffering") {
        this.setScreenSaver(false);
      }
    };
    const restoreFailed = (error: unknown) => this.reportFatalError("AVPLAY_RESTORE", error);
    try {
      if (this.avplay.restoreAsync) {
        this.avplay.restoreAsync(undefined, undefined, undefined, restoreSucceeded, restoreFailed);
      } else {
        this.avplay.restore();
        restoreSucceeded();
      }
    } catch (error) {
      restoreFailed(error);
    }
  };

  private safeAvplayState(): TizenAvplayState {
    try {
      return this.avplay.getState();
    } catch {
      return "NONE";
    }
  }

  private closeCurrentPlayer(): void {
    this.suspended = false;
    this.setScreenSaver(true);
    this.setDisplayElementVisible(false);
    const state = this.safeAvplayState();
    if (state === "NONE") return;
    try {
      this.avplay.stop();
    } catch {
      // close() is still valid even if stop() failed on a model-specific edge state.
    }
    try {
      this.avplay.close();
    } catch {
      // Best-effort teardown must not prevent a subsequent load attempt.
    }
  }

  private reportFatalError(code: string, error: unknown): Error {
    const normalized = toError(error);
    this.setScreenSaver(true);
    this.setDisplayElementVisible(false);
    this.setState({
      state: "error",
      error: { code, message: normalized.message, fatal: true },
    });
    return normalized;
  }

  private applyDrm(drm: DrmConfig): void {
    const drmType = toAvplayDrmType(drm.systemId);
    if (!drmType) return;

    const properties: Record<string, unknown> = {
      DeleteLicenseAfterUse: true,
    };
    if (drm.licenseServerUrl) properties.LicenseServer = drm.licenseServerUrl;
    const headers = drmHeaders(drm.headers);
    if (headers) properties.HttpHeader = headers;
    if (drmType === "WIDEVINE_CDM") {
      properties.AppSession = `playarr-${Date.now().toString(36)}`;
    }
    this.avplay.setDrm(drmType, "SetProperties", JSON.stringify(properties));
  }

  private attachListener(generation: number): void {
    const current = () => generation === this.loadGeneration && !this.destroyed;
    const fail = (eventType: string, message?: string) => {
      if (!current()) return;
      this.reportFatalError(eventType, message ?? `AVPlay error: ${eventType}`);
    };
    this.avplay.setListener({
      onbufferingstart: () => {
        if (current()) this.setState({ state: "buffering" });
      },
      onbufferingprogress: (percent) => {
        if (!current()) return;
        this.setState({
          state: "buffering",
          bufferedSeconds: Math.max(
            this.state.bufferedSeconds,
            (this.state.durationSeconds * Math.max(0, Math.min(100, percent))) / 100
          ),
        });
      },
      onbufferingcomplete: () => {
        if (current()) this.setState({ state: toPlaybackState(this.avplay.getState()) });
      },
      onstreamcompleted: () => {
        if (!current()) return;
        this.initialAudioTrackApplied = false;
        try {
          this.avplay.stop();
        } catch {
          // The logical ended state is still useful even if native stop fails.
        }
        this.setScreenSaver(true);
        this.setDisplayElementVisible(false);
        this.setState({
          state: "ended",
          currentTimeSeconds: this.state.durationSeconds,
          bufferedSeconds: this.state.durationSeconds,
        });
      },
      oncurrentplaytime: (currentTime) => {
        if (!current()) return;
        this.setState({ currentTimeSeconds: currentTime / 1000 });
        const hasVideo = this.trySyncTrackState();
        this.tryApplyInitialAudioTrack();
        if (hasVideo !== undefined && this.state.state === "playing") {
          this.setDisplayElementVisible(hasVideo);
        }
      },
      onerror: (eventType) => fail(eventType),
      onerrormsg: (eventType, message) => fail(eventType, message),
    });
  }

  private syncTrackState(): boolean {
    const streamInfo = this.avplay.getTotalTrackInfo();
    const currentStreamInfo = this.avplay.getCurrentStreamInfo();
    const currentAudioId =
      currentStreamInfo
        .filter((track) => track.type === "AUDIO")
        .map((track) => avplayTrackId("audio", track.index))[0] ?? null;
    const currentSubtitleId =
      currentStreamInfo
        .filter((track) => track.type === "TEXT")
        .map((track) => avplayTrackId("subtitle", track.index))[0] ?? null;
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
    const externalTracks: PlaybackSubtitleTrack[] = Array.from(
      this.externalSubtitleSources.values(),
      (track) => ({
        id: track.id,
        label: track.label,
        language: track.language,
        roles: [],
        forced: track.forced ?? false,
        selected: this.state.selectedSubtitleTrackId === track.id,
      })
    );
    const selectedExternalId = externalTracks.find((track) => track.selected)?.id ?? null;

    this.setState({
      audioTracks,
      subtitleTracks: [...subtitleTracks, ...externalTracks],
      selectedAudioTrackId: audioTracks.find((track) => track.selected)?.id ?? null,
      selectedSubtitleTrackId:
        selectedExternalId ?? subtitleTracks.find((track) => track.selected)?.id ?? null,
    });
    return streamInfo.some((track) => track.type === "VIDEO");
  }

  /**
   * Some Samsung firmware reports READY before track metadata is queryable.
   * Treat that as a transient capability gap and retry from early play-time
   * callbacks instead of turning a successfully prepared source into a fatal
   * load error.
   */
  private trySyncTrackState(): boolean | undefined {
    if (this.tracksSynchronized) return this.currentSourceHasVideo;
    if (this.trackSyncAttempts >= 8) return undefined;
    this.trackSyncAttempts += 1;
    try {
      const hasVideo = this.syncTrackState();
      this.currentSourceHasVideo = hasVideo;
      this.tracksSynchronized = true;
      return hasVideo;
    } catch {
      return undefined;
    }
  }

  /**
   * Samsung firmware can start a multi-audio stream silently until an AUDIO
   * track is explicitly selected after AVPlay reaches PLAYING.
   */
  private tryApplyInitialAudioTrack(): void {
    if (this.initialAudioTrackApplied || !this.tracksSynchronized) return;
    const audioTracks = this.state.audioTracks;
    if (audioTracks.length <= 1) {
      this.initialAudioTrackApplied = true;
      return;
    }
    if (this.safeAvplayState() !== "PLAYING") return;
    const selectedId = this.state.selectedAudioTrackId ?? audioTracks[0]?.id;
    if (!selectedId) return;
    const index = Number(selectedId.slice("audio:".length));
    if (!Number.isInteger(index)) return;
    try {
      this.avplay.setSelectTrack("AUDIO", index);
      this.initialAudioTrackApplied = true;
    } catch {
      // Retry from the next play-time callback on firmware that transitions
      // to PLAYING before accepting the first track selection.
    }
  }

  private prepare(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.avplay.prepareAsync(resolve, (error) => reject(toError(error)));
    });
  }

  async load(source: PlaybackSource): Promise<void> {
    if (this.destroyed) throw new Error("TizenAvplayEngine has been destroyed");
    const generation = ++this.loadGeneration;
    const playbackSessionId = this.pendingPlaybackSessionId;
    this.pendingPlaybackSessionId = null;
    this.closeCurrentPlayer();
    this.externalSubtitleSources.clear();
    this.resolvedExternalSubtitlePaths.clear();
    this.trackSyncAttempts = 0;
    this.tracksSynchronized = false;
    this.initialAudioTrackApplied = false;
    this.currentSourceHasVideo = !source.mimeType.toLowerCase().startsWith("audio/");
    this.setState({
      state: "loading",
      currentTimeSeconds: 0,
      durationSeconds: 0,
      bufferedSeconds: 0,
      audioTracks: [],
      subtitleTracks: [],
      selectedAudioTrackId: null,
      selectedSubtitleTrackId: null,
      error: undefined,
    });

    try {
      const resolvedSourceUrl = await this.resolveMediaSourceUrl(source);
      if (generation !== this.loadGeneration || this.destroyed) return;
      this.avplay.open(resolvedSourceUrl);
      this.attachListener(generation);
      if (playbackSessionId) {
        this.avplay.setStreamingProperty(
          "COOKIE",
          `streamarr_playback_session=${encodeURIComponent(playbackSessionId)}`
        );
      }
      this.avplay.setDisplayRect(
        this.displayRect.x,
        this.displayRect.y,
        this.displayRect.width,
        this.displayRect.height
      );
      this.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
      if (source.drm) this.applyDrm(source.drm);

      await this.prepare();
      if (generation !== this.loadGeneration || this.destroyed) return;

      this.setState({
        state: "ready",
        durationSeconds: this.avplay.getDuration() / 1000,
      });
      this.trySyncTrackState();
      if (source.startPositionSeconds && source.startPositionSeconds > 0) {
        await this.seek(source.startPositionSeconds);
      }
    } catch (error) {
      if (generation !== this.loadGeneration || this.destroyed) return;
      this.closeCurrentPlayer();
      throw this.reportFatalError("AVPLAY_LOAD", error);
    }
  }

  async play(): Promise<void> {
    if (this.destroyed) throw new Error("TizenAvplayEngine has been destroyed");
    try {
      let state = this.avplay.getState();
      if (state === "IDLE" && this.state.state === "ended") {
        await this.prepare();
        state = this.avplay.getState();
      }
      if (state !== "READY" && state !== "PLAYING" && state !== "PAUSED") return;
      if (state !== "PLAYING") this.avplay.play();
      this.trySyncTrackState();
      this.tryApplyInitialAudioTrack();
      this.setDisplayElementVisible(this.currentSourceHasVideo);
      this.setScreenSaver(false);
      this.setState({ state: "playing", error: undefined });
    } catch (error) {
      throw this.reportFatalError("AVPLAY_PLAY", error);
    }
  }

  async pause(): Promise<void> {
    if (this.destroyed) return;
    try {
      const state = this.avplay.getState();
      if (state === "PAUSED") return;
      if (state !== "PLAYING") return;
      this.avplay.pause();
      this.setScreenSaver(true);
      this.setState({ state: "paused" });
    } catch (error) {
      throw this.reportFatalError("AVPLAY_PAUSE", error);
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    if (this.destroyed || !Number.isFinite(positionSeconds)) return;
    const state = this.avplay.getState();
    if (state !== "READY" && state !== "PLAYING" && state !== "PAUSED") return;
    const durationMs = Math.round(Math.max(0, this.state.durationSeconds) * 1000);
    if (durationMs > 0 && durationMs <= 1) return;
    const requestedMs = Math.round(Math.max(0, positionSeconds) * 1000);
    const boundedMs =
      durationMs > 1
        ? Math.max(1, Math.min(durationMs - 1, requestedMs))
        : Math.max(1, requestedMs);
    await new Promise<void>((resolve, reject) => {
      this.avplay.seekTo(
        boundedMs,
        resolve,
        (error) => reject(toError(error))
      );
    }).catch((error) => {
      throw this.reportFatalError("AVPLAY_SEEK", error);
    });
    this.setState({ currentTimeSeconds: boundedMs / 1000 });
  }

  setVolume(volume: number): void {
    // AVPlay audio is controlled by the TV's system volume keys.
    this.setState({ volume: Math.max(0, Math.min(1, volume)) });
  }

  setMuted(muted: boolean): void {
    // The physical remote/system owns muting; retain intent for shared UI state.
    this.setState({ muted });
  }

  async selectAudioTrack(trackId: string): Promise<void> {
    const track = this.state.audioTracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    const index = Number(trackId.slice("audio:".length));
    if (!Number.isInteger(index)) return;
    this.avplay.setSelectTrack("AUDIO", index);
    this.initialAudioTrackApplied = true;
    this.setState({
      audioTracks: this.state.audioTracks.map((candidate) => ({
        ...candidate,
        selected: candidate.id === trackId,
      })),
      selectedAudioTrackId: trackId,
    });
  }

  async addExternalSubtitleTracks(tracks: ExternalSubtitleTrack[]): Promise<void> {
    for (const track of tracks) this.externalSubtitleSources.set(track.id, track);
    const externalTracks: PlaybackSubtitleTrack[] = Array.from(
      this.externalSubtitleSources.values(),
      (track) => ({
        id: track.id,
        label: track.label,
        language: track.language,
        roles: [],
        forced: track.forced ?? false,
        selected: this.state.selectedSubtitleTrackId === track.id,
      })
    );
    const embeddedTracks = this.state.subtitleTracks.filter(
      (track) => !this.externalSubtitleSources.has(track.id)
    );
    this.setState({ subtitleTracks: [...embeddedTracks, ...externalTracks] });
  }

  async selectSubtitleTrack(trackId: string | null): Promise<void> {
    if (trackId === null) {
      this.avplay.setSilentSubtitle(true);
      this.setState({
        subtitleTracks: this.state.subtitleTracks.map((track) => ({ ...track, selected: false })),
        selectedSubtitleTrackId: null,
      });
      return;
    }

    const track = this.state.subtitleTracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    const external = this.externalSubtitleSources.get(trackId);
    if (external) {
      let path = this.resolvedExternalSubtitlePaths.get(trackId);
      if (!path) {
        path = await this.resolveExternalSubtitlePath(external);
        this.resolvedExternalSubtitlePaths.set(trackId, path);
      }
      this.avplay.setExternalSubtitlePath(path);
    } else {
      const index = Number(trackId.slice("subtitle:".length));
      if (!Number.isInteger(index)) return;
      this.avplay.setSelectTrack("TEXT", index);
    }
    this.avplay.setSilentSubtitle(false);
    this.setState({
      subtitleTracks: this.state.subtitleTracks.map((candidate) => ({
        ...candidate,
        selected: candidate.id === trackId,
      })),
      selectedSubtitleTrackId: trackId,
    });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadGeneration += 1;
    this.pendingPlaybackSessionId = null;
    this.lifecycleDocument?.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.closeCurrentPlayer();
    this.externalSubtitleSources.clear();
    this.resolvedExternalSubtitlePaths.clear();
    this.setState({ state: "idle", error: undefined });
  }
}
