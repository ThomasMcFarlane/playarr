/**
 * Playarr Cast receiver boot sequence.
 *
 * Order matters here: the custom namespace must be declared (and its
 * listener attached) BEFORE `context.start()`, `disableIdleTimeout` must be
 * set so an idle receiver page doesn't shut itself down mid-cast, the LOAD/
 * PRELOAD/SEEK interceptors must be registered before `start()` is called,
 * and `context.start(options)` itself is always the very last call in this
 * module.
 */
import { ApiClient, describeApiError, type PlaybackInfo } from "@streamarr-tv/api-client";
import {
  PLAYARR_CAST_NAMESPACE,
  PLAYARR_CAST_PROTOCOL_VERSION,
  encodePlayarrCastMessage,
  isPlayarrCastLoadRequest,
  type PlayarrCastErrorCode,
  type PlayarrCastItem,
  type PlayarrCastPlaybackIntent,
  type PlayarrCastQualityOption,
  type PlayarrCastQueueEntry,
  type PlayarrCastReadyMessage,
  type PlayarrCastStateMessage,
  type PlayarrCastTrackOption,
} from "@streamarr-tv/cast-protocol";
import { loadWorkArtworkBlobUrl } from "./artwork";
import { CastCredentialStore } from "./auth";
import { buildDeviceCapabilities } from "./capabilities";
import { CastMessageBus, type CastMessageChannel } from "./messages";
import {
  PlaybackNegotiator,
  type NegotiationOverrides,
} from "./negotiation";
import { ProgressReporter } from "./progress";
import {
  clearActiveSubtitleTrack,
  loadAndActivateSubtitleTrack,
  selectPreferredSubtitleTrack,
  type PlaybackSubtitleTrackOption,
} from "./subtitles";

// ---------------------------------------------------------------------------
// `cast` (declared by `@types/chromecast-caf-receiver`) is a plain global
// `const`, not an ambient `namespace` -- perfectly fine for VALUE positions
// (`new cast.framework.messages.Foo()`, `cast.framework.messages.Bar.BAZ`),
// but a bare `cast.framework.messages.Foo` cannot be used as a TYPE
// annotation directly (there is no namespace named `cast` to resolve a
// qualified type name against). `InstanceType<typeof ...>` sidesteps that:
// `typeof cast.framework.messages.Foo` is a normal type QUERY built from a
// value expression (always legal), and `InstanceType<>` recovers the
// instance type from that constructor's type.
// ---------------------------------------------------------------------------

type CafNetworkRequestInfo = InstanceType<typeof cast.framework.NetworkRequestInfo>;
type CafMediaInformation = InstanceType<typeof cast.framework.messages.MediaInformation>;
type CafMovieMediaMetadata = InstanceType<typeof cast.framework.messages.MovieMediaMetadata>;
type CafTvShowMediaMetadata = InstanceType<typeof cast.framework.messages.TvShowMediaMetadata>;
type CafGenericMediaMetadata = InstanceType<typeof cast.framework.messages.GenericMediaMetadata>;
type CafErrorData = InstanceType<typeof cast.framework.messages.ErrorData>;
type CafLoadRequestData = InstanceType<typeof cast.framework.messages.LoadRequestData>;
type CafSeekRequestData = InstanceType<typeof cast.framework.messages.SeekRequestData>;
type CafSenderConnectedEvent = InstanceType<typeof cast.framework.system.SenderConnectedEvent>;

// ---------------------------------------------------------------------------
// Module-level state. This is a single-page, single-cast-session app -- one
// receiver page load lives for exactly one Cast session -- so plain module
// scope (rather than a class) is the natural home for it.
// ---------------------------------------------------------------------------

let apiClient: ApiClient | null = null;
let credentialStore: CastCredentialStore | null = null;
let negotiator: PlaybackNegotiator | null = null;
let currentServerBaseUrl: string | null = null;
let currentItem: PlayarrCastItem | null = null;
let currentQueue: PlayarrCastQueueEntry[] = [];
let pendingSubtitlePreference: { trackId: string | null; language: string | null } | null = null;
let activeSubtitleTrackId: string | null = null;
let negotiatingNow = false;

const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

const messageChannel: CastMessageChannel = {
  addListener(handler) {
    context.addCustomMessageListener(PLAYARR_CAST_NAMESPACE, (event) => handler(event.senderId, event.data));
  },
  send(senderId, message) {
    // Validates the 64KB custom-channel message cap (throws `RangeError`
    // past it); the object itself -- not this JSON string -- is what
    // actually goes to `sendCustomMessage`, since a JSON-typed namespace
    // (see `options.customNamespaces` below) serializes it for us.
    encodePlayarrCastMessage(message);
    context.sendCustomMessage(PLAYARR_CAST_NAMESPACE, senderId, message);
  },
};
const messageBus = new CastMessageBus(messageChannel);

const progress = new ProgressReporter({
  recordPlaybackEvent: (sessionId, event) =>
    apiClient ? apiClient.recordPlaybackEvent(sessionId, event) : Promise.resolve(),
});

// ---------------------------------------------------------------------------
// Server binding: (re)creates the ApiClient/credential store/negotiator the
// first time a LOAD names a server, and again if a later LOAD names a
// different one.
// ---------------------------------------------------------------------------

function ensureServerBinding(baseUrl: string): void {
  if (currentServerBaseUrl === baseUrl && apiClient && credentialStore && negotiator) return;

  credentialStore?.dispose();
  currentServerBaseUrl = baseUrl;

  // `store` is referenced by `client`'s `getAccessToken` closure before it
  // exists -- `storeRef` breaks that circularity without relying on
  // `client`/`store`'s declaration order being significant.
  const storeRef: { current: CastCredentialStore | null } = { current: null };
  const client = new ApiClient({
    baseUrl,
    getAccessToken: () => storeRef.current?.currentAccessToken(),
    defaultHeaders: {
      "X-Streamarr-Client-Platform": "cast",
      "X-Streamarr-Client-Version": __APP_VERSION__,
    },
  });
  const store = new CastCredentialStore(
    { refresh: (body) => client.refresh(body) },
    {
      onRotated: (credentials) => {
        messageChannel.send(undefined, {
          protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
          type: "auth.rotated",
          credentials,
        });
      },
      onRefreshFailed: () => {
        messageBus.sendError(
          undefined,
          "session_expired",
          "Could not refresh the Cast session's credentials."
        );
        void negotiator?.endSession(progress.positionMs, "error");
      },
    }
  );
  storeRef.current = store;

  apiClient = client;
  credentialStore = store;
  negotiator = new PlaybackNegotiator(client);
}

function isInsecureServer(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === "http:" && location.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Streaming auth: appends `?playback_session_id=` (self-authenticating,
// never expires while the session lives) and, belt-and-braces, an
// `Authorization` header too (harmless once the CORS fix lands) to every
// manifest/segment request Shaka's underlying networking makes.
// ---------------------------------------------------------------------------

function appendPlaybackSessionId(url: string, sessionId: string | null): string {
  if (!sessionId) return url;
  try {
    const absolute = new URL(url, location.href);
    absolute.searchParams.set("playback_session_id", sessionId);
    return absolute.toString();
  } catch {
    return url;
  }
}

function applyStreamingAuth(requestInfo: CafNetworkRequestInfo): void {
  if (!requestInfo.url) return;
  requestInfo.url = appendPlaybackSessionId(requestInfo.url, negotiator?.sessionId ?? null);
  const token = credentialStore?.currentAccessToken();
  if (token) {
    requestInfo.headers = requestInfo.headers || {};
    requestInfo.headers["Authorization"] = `Bearer ${token}`;
  }
}

// A freshly-created on-demand transcode session's playlist does not exist on
// disk until ffmpeg actually starts writing it -- several seconds away for a
// real 4K source. This retry budget (identical to `player-shaka`'s own) is
// what makes CAF's internal Shaka player wait that out instead of exhausting
// its default retry budget and firing a fatal error within a couple of
// seconds.
const TRANSCODE_AWARE_RETRY = {
  timeout: 30_000,
  maxAttempts: 15,
  baseDelay: 1_000,
  backoffFactor: 1.3,
  fuzzFactor: 0.5,
};

const playbackConfig = new cast.framework.PlaybackConfig();
playbackConfig.manifestRequestHandler = applyStreamingAuth;
playbackConfig.segmentRequestHandler = applyStreamingAuth;
playbackConfig.shakaConfig = {
  streaming: { retryParameters: TRANSCODE_AWARE_RETRY },
  manifest: { retryParameters: TRANSCODE_AWARE_RETRY },
};

// ---------------------------------------------------------------------------
// Media metadata / MediaInformation construction
// ---------------------------------------------------------------------------

function buildMediaMetadata(
  item: PlayarrCastItem
): CafMovieMediaMetadata | CafTvShowMediaMetadata | CafGenericMediaMetadata {
  if (item.kind === "movie") {
    const metadata = new cast.framework.messages.MovieMediaMetadata();
    metadata.title = item.title;
    if (item.subtitle) metadata.subtitle = item.subtitle;
    if (item.releaseDate) metadata.releaseDate = item.releaseDate;
    return metadata;
  }
  if (item.kind === "episode") {
    const metadata = new cast.framework.messages.TvShowMediaMetadata();
    // Assumption (the sender-side naming convention lives outside this
    // component, in files this task doesn't own): `item.title` is always
    // this item's own display title -- the episode's own title here, same
    // as a movie's title above -- and `item.subtitle`, when present, is a
    // secondary line; for an episode specifically, that's the series name,
    // the one place `TvShowMediaMetadata` has a distinct slot for it.
    metadata.title = item.title;
    if (item.subtitle) metadata.seriesTitle = item.subtitle;
    if (item.seasonNumber !== undefined) metadata.season = item.seasonNumber;
    if (item.episodeNumber !== undefined) metadata.episode = item.episodeNumber;
    if (item.releaseDate) metadata.originalAirdate = item.releaseDate;
    return metadata;
  }
  const metadata = new cast.framework.messages.GenericMediaMetadata();
  metadata.title = item.title;
  if (item.subtitle) metadata.subtitle = item.subtitle;
  metadata.images = [];
  return metadata;
}

function applySourceToMediaInformation(media: CafMediaInformation, info: PlaybackInfo): void {
  if (!apiClient) throw new Error("No server is bound yet.");
  const resolvedUrl = apiClient.resolveUrl(info.url);
  media.contentId = resolvedUrl;
  media.contentUrl = resolvedUrl;
  media.contentType = info.mime_type;
}

async function buildMediaInformation(item: PlayarrCastItem, info: PlaybackInfo): Promise<CafMediaInformation> {
  if (!apiClient) throw new Error("No server is bound yet.");
  const client = apiClient;

  const media = new cast.framework.messages.MediaInformation();
  applySourceToMediaInformation(media, info);
  media.streamType = cast.framework.messages.StreamType.BUFFERED;
  if (info.duration_ms > 0) media.duration = info.duration_ms / 1000;

  const metadata = buildMediaMetadata(item);
  if (item.workId) {
    const blobUrl = await loadWorkArtworkBlobUrl(
      (workId, kind) => client.getWorkArtwork(workId, kind),
      item.workId
    );
    if (blobUrl) metadata.images = [new cast.framework.messages.Image(blobUrl)];
  }
  media.metadata = metadata;
  return media;
}

// ---------------------------------------------------------------------------
// Negotiation helpers shared by LOAD, SEEK, and every custom-channel message
// that needs a fresh server session (quality/audio-track switches, queue
// advance).
// ---------------------------------------------------------------------------

interface NegotiatedLoad {
  media: CafMediaInformation;
  currentTimeSec: number;
}

async function negotiateAndBuildMedia(
  item: PlayarrCastItem,
  playback: PlayarrCastPlaybackIntent,
  previousPositionMs: number
): Promise<NegotiatedLoad> {
  if (!negotiator) throw new Error("No server is bound yet.");
  negotiatingNow = true;
  try {
    const info = await negotiator.negotiate(item.mediaFileId, playback, previousPositionMs);
    progress.setSession(info.session_id, info.source_offset_ms);
    const media = await buildMediaInformation(item, info);
    currentItem = item;
    activeSubtitleTrackId = null;
    pendingSubtitlePreference = {
      trackId: playback.preferredSubtitleTrackId ?? null,
      language: playback.preferredSubtitleLanguage ?? null,
    };
    const currentTimeSec = Math.max(0, (playback.startPositionMs - info.source_offset_ms) / 1000);
    return { media, currentTimeSec };
  } finally {
    negotiatingNow = false;
  }
}

/** Re-negotiates a fresh server session and reloads the player against it -- used by seek/quality/audio-track switches, never a raw seek/track change on the existing session (Ground Truth). */
async function renegotiateAndReload(sourcePositionMs: number, overrides: NegotiationOverrides): Promise<void> {
  if (!negotiator) throw new Error("No server is bound yet.");
  negotiatingNow = true;
  try {
    const info = await negotiator.renegotiateAt(sourcePositionMs, overrides);
    progress.setSession(info.session_id, info.source_offset_ms);
    const media = playerManager.getMediaInformation();
    if (!media) return;
    applySourceToMediaInformation(media, info);
    const freshLoad = new cast.framework.messages.LoadRequestData();
    freshLoad.media = media;
    freshLoad.autoplay = true;
    freshLoad.currentTime = 0;
    await playerManager.load(freshLoad);
  } finally {
    negotiatingNow = false;
  }
}

// ---------------------------------------------------------------------------
// Subtitles: sideloaded only after PLAYER_LOAD_COMPLETE -- managers are
// empty until a load has actually completed.
// ---------------------------------------------------------------------------

async function applyPendingSubtitlePreference(): Promise<void> {
  const preference = pendingSubtitlePreference;
  pendingSubtitlePreference = null;
  if (!preference || !negotiator?.current || !apiClient || !currentItem) return;

  const option: PlaybackSubtitleTrackOption | undefined = selectPreferredSubtitleTrack(
    negotiator.current.subtitle_tracks,
    preference.trackId,
    preference.language
  );
  if (!option) return;

  const client = apiClient;
  const item = currentItem;
  await loadAndActivateSubtitleTrack(
    {
      getMediaSubtitle: (mediaFileId, streamIndex, sourceOffsetMs) =>
        client.getMediaSubtitle(mediaFileId, streamIndex, sourceOffsetMs),
      textTracksManager: playerManager.getTextTracksManager(),
    },
    item.mediaFileId,
    option,
    negotiator.sourceOffsetMs
  );
  activeSubtitleTrackId = option.id;
}

playerManager.addEventListener(cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, () => {
  void applyPendingSubtitlePreference();
});

// ---------------------------------------------------------------------------
// Progress / lifecycle reporting -- driven off the real PlayerManager events.
// ---------------------------------------------------------------------------

playerManager.addEventListener(cast.framework.events.EventType.TIME_UPDATE, () => {
  progress.setEngineTimeMs(playerManager.getCurrentTimeSec() * 1000);
  messageBus.broadcastState(buildStateMessage());
});
playerManager.addEventListener(cast.framework.events.EventType.PLAYING, () => {
  progress.onStateChange("playing");
});
playerManager.addEventListener(cast.framework.events.EventType.PAUSE, () => {
  progress.onStateChange("paused");
});
playerManager.addEventListener(cast.framework.events.EventType.ENDED, () => {
  progress.onStateChange("ended");
  negotiator?.clearSession();
});
playerManager.addEventListener(cast.framework.events.EventType.BUFFERING, (event) => {
  if (event.isBuffering) {
    progress.onStateChange("buffering");
    return;
  }
  const resumedState = playerManager.getPlayerState() === cast.framework.messages.PlayerState.PAUSED ? "paused" : "playing";
  progress.onStateChange(resumedState);
});
playerManager.addEventListener(cast.framework.events.EventType.ERROR, () => {
  progress.onStateChange("error");
  negotiator?.clearSession();
});

// ---------------------------------------------------------------------------
// Custom-channel ("state") reporting
// ---------------------------------------------------------------------------

function toTrackOption(
  track: { id: string; label: string; language?: string | null; is_default: boolean },
  forced: boolean
): PlayarrCastTrackOption {
  return {
    id: track.id,
    label: track.label,
    language: track.language ?? null,
    forced,
    isDefault: track.is_default,
  };
}

function toQualityOption(quality: {
  id: string;
  label: string;
  height?: number | null;
  video_bitrate_bps?: number | null;
}): PlayarrCastQualityOption {
  return {
    id: quality.id,
    label: quality.label,
    height: quality.height ?? null,
    videoBitrateBps: quality.video_bitrate_bps ?? null,
  };
}

function buildStateMessage(): PlayarrCastStateMessage {
  const info = negotiator?.current ?? null;
  return {
    protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
    type: "state",
    mediaFileId: currentItem?.mediaFileId ?? "",
    sessionId: negotiator?.sessionId ?? null,
    negotiating: negotiatingNow,
    mode: negotiator?.mode ?? null,
    sourceOffsetMs: negotiator?.sourceOffsetMs ?? 0,
    positionMs: progress.positionMs,
    durationMs: info?.duration_ms ?? 0,
    audioTracks: (info?.audio_tracks ?? []).map((track) => toTrackOption(track, false)),
    subtitleTracks: (info?.subtitle_tracks ?? []).map((track) => toTrackOption(track, track.forced)),
    qualityOptions: (info?.quality_options ?? []).map(toQualityOption),
    selectedAudioTrackId: info?.selected_audio_track_id ?? null,
    selectedSubtitleTrackId: activeSubtitleTrackId,
    selectedQualityId: info?.selected_quality_id ?? "original",
    queue: currentQueue,
  };
}

function sendReady(senderId?: string): void {
  const message: PlayarrCastReadyMessage = {
    protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
    type: "ready",
    receiverVersion: __APP_VERSION__,
    supportedProtocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
    deviceCapabilities: buildDeviceCapabilities(context),
  };
  messageChannel.send(senderId, message);
}

context.addEventListener(cast.framework.system.EventType.SENDER_CONNECTED, (event) => {
  sendReady((event as CafSenderConnectedEvent).senderId);
});

// ---------------------------------------------------------------------------
// Custom-channel message handlers (sender -> receiver)
// ---------------------------------------------------------------------------

messageBus.setHandlers({
  onAuthUpdate: (message) => {
    credentialStore?.setCredentials(message.credentials);
  },

  onSelectQuality: (message, senderId) => {
    void (async () => {
      try {
        await renegotiateAndReload(progress.positionMs, { qualityId: message.qualityId });
        messageBus.broadcastState(buildStateMessage());
        if (message.requestId) messageBus.sendAck(senderId, message.requestId, true);
      } catch (err) {
        messageBus.sendError(senderId, "negotiation_failed", describeApiError(err), {
          retryable: true,
          requestId: message.requestId,
        });
      }
    })();
  },

  onSelectTracks: (message, senderId) => {
    void (async () => {
      try {
        if (message.subtitleTrackId !== undefined) {
          const textTracksManager = playerManager.getTextTracksManager();
          if (message.subtitleTrackId === null) {
            clearActiveSubtitleTrack(textTracksManager);
            activeSubtitleTrackId = null;
          } else {
            const option = negotiator?.current?.subtitle_tracks.find(
              (track) => track.id === message.subtitleTrackId
            );
            if (option && apiClient && currentItem) {
              const client = apiClient;
              const item = currentItem;
              await loadAndActivateSubtitleTrack(
                {
                  getMediaSubtitle: (mediaFileId, streamIndex, sourceOffsetMs) =>
                    client.getMediaSubtitle(mediaFileId, streamIndex, sourceOffsetMs),
                  textTracksManager,
                },
                item.mediaFileId,
                option,
                negotiator?.sourceOffsetMs ?? 0
              );
              activeSubtitleTrackId = option.id;
            }
          }
        }

        if (message.audioTrackId !== undefined) {
          const option = negotiator?.current?.audio_tracks.find((track) => track.id === message.audioTrackId);
          if (option) {
            await renegotiateAndReload(progress.positionMs, { audioStreamIndex: option.stream_index });
          }
        }

        messageBus.broadcastState(buildStateMessage());
        if (message.requestId) messageBus.sendAck(senderId, message.requestId, true);
      } catch (err) {
        messageBus.sendError(senderId, "negotiation_failed", describeApiError(err), {
          retryable: true,
          requestId: message.requestId,
        });
      }
    })();
  },

  onSetQueue: (message, senderId) => {
    currentQueue = message.items;
    messageBus.broadcastState(buildStateMessage());
    if (message.requestId) messageBus.sendAck(senderId, message.requestId, true);
  },

  onPlayNext: (message, senderId) => {
    void (async () => {
      const next = currentQueue[0];
      if (!next) {
        if (message.requestId) messageBus.sendAck(senderId, message.requestId, false, "unknown", "Queue is empty.");
        return;
      }
      currentQueue = currentQueue.slice(1);

      const item: PlayarrCastItem = {
        mediaFileId: next.mediaFileId,
        workId: next.workId,
        kind: next.kind,
        title: next.title,
        subtitle: next.subtitle,
        seasonNumber: next.seasonNumber,
        episodeNumber: next.episodeNumber,
        durationMs: next.durationMs,
      };
      const playback: PlayarrCastPlaybackIntent = {
        startPositionMs: 0,
        autoplay: true,
        preferredAudioTrackId: null,
        preferredSubtitleTrackId: null,
        preferredAudioLanguage: null,
        preferredSubtitleLanguage: null,
        qualityId: null,
        maxBitrateBps: null,
      };

      try {
        const { media, currentTimeSec } = await negotiateAndBuildMedia(item, playback, progress.positionMs);
        const freshLoad = new cast.framework.messages.LoadRequestData();
        freshLoad.media = media;
        freshLoad.autoplay = true;
        freshLoad.currentTime = currentTimeSec;
        await playerManager.load(freshLoad);
        messageBus.broadcastState(buildStateMessage());
        if (message.requestId) messageBus.sendAck(senderId, message.requestId, true);
      } catch (err) {
        messageBus.sendError(senderId, "negotiation_failed", describeApiError(err), {
          retryable: true,
          requestId: message.requestId,
        });
      }
    })();
  },

  onStateRequest: (_message, senderId) => {
    messageChannel.send(senderId, buildStateMessage());
  },

  onEndSession: (message, senderId) => {
    void (async () => {
      await progress.flushTerminal({ kind: "stop", reason: message.reason });
      // `progress.flushTerminal` above already reported the stop -- clear
      // the negotiator's own bookkeeping without a second, redundant report.
      negotiator?.clearSession();
      if (message.requestId) messageBus.sendAck(senderId, message.requestId, true);
    })();
  },
});

// ---------------------------------------------------------------------------
// PRELOAD: a pure pass-through. LOAD's own interceptor has side effects
// (negotiation, session start); if no PRELOAD interceptor were registered,
// CAF would run the LOAD interceptor for PRELOAD messages too (per its own
// doc comment), spuriously negotiating/starting a session for a
// queue-lookahead item that may never actually play.
// ---------------------------------------------------------------------------

playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.PRELOAD,
  (preloadRequestData) => preloadRequestData
);

// ---------------------------------------------------------------------------
// LOAD
// ---------------------------------------------------------------------------

function failLoad(code: PlayarrCastErrorCode, message: string): CafErrorData {
  messageBus.sendError(undefined, code, message, { retryable: false });
  const error = new cast.framework.messages.ErrorData(cast.framework.messages.ErrorType.LOAD_FAILED);
  error.reason =
    code === "invalid_load_request" || code === "unsupported_protocol_version"
      ? cast.framework.messages.ErrorReason.INVALID_PARAMS
      : cast.framework.messages.ErrorReason.GENERIC_LOAD_ERROR;
  return error;
}

playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  async (loadRequestData): Promise<CafLoadRequestData | CafErrorData> => {
    const rawCustomData: unknown = loadRequestData.customData;
    if (!isPlayarrCastLoadRequest(rawCustomData)) {
      return failLoad("invalid_load_request", "Missing or invalid Playarr Cast load request customData.");
    }
    const request = rawCustomData;

    if (request.protocolVersion !== PLAYARR_CAST_PROTOCOL_VERSION) {
      return failLoad(
        "unsupported_protocol_version",
        `This receiver supports protocol version ${PLAYARR_CAST_PROTOCOL_VERSION}; sender sent ${request.protocolVersion}.`
      );
    }

    if (isInsecureServer(request.server.baseUrl)) {
      return failLoad(
        "insecure_server",
        "Refusing to load an insecure (http://) server from this secure (https://) receiver page."
      );
    }

    ensureServerBinding(request.server.baseUrl);
    credentialStore?.setCredentials(request.credentials);

    try {
      const previousPositionMs = progress.positionMs;
      const { media, currentTimeSec } = await negotiateAndBuildMedia(
        request.item,
        request.playback,
        previousPositionMs
      );
      loadRequestData.media = media;
      loadRequestData.autoplay = request.playback.autoplay;
      loadRequestData.currentTime = currentTimeSec;
      currentQueue = request.queue ?? [];
      messageBus.broadcastState(buildStateMessage());
      return loadRequestData;
    } catch (err) {
      return failLoad("negotiation_failed", describeApiError(err));
    }
  }
);

// ---------------------------------------------------------------------------
// SEEK: re-negotiates (a new server session) rather than passing through
// unchanged when the current session is a freshly-spawned on-demand
// transcode -- Ground Truth: "An on-demand HLS seek is a new server
// session, not a media-element seek."
// ---------------------------------------------------------------------------

playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.SEEK,
  async (seekRequestData): Promise<CafSeekRequestData | CafErrorData> => {
    if (!negotiator?.isOnDemandSession) {
      // Direct play, or an already-fully-rendered rendition: the default
      // in-place seek is safe and sufficient.
      return seekRequestData;
    }

    const engineTimeSec =
      seekRequestData.relativeTime !== undefined
        ? playerManager.getCurrentTimeSec() + seekRequestData.relativeTime
        : (seekRequestData.currentTime ?? playerManager.getCurrentTimeSec());
    const targetSourceMs = engineTimeSec * 1000 + negotiator.sourceOffsetMs;

    try {
      await renegotiateAndReload(targetSourceMs, {});
      messageBus.broadcastState(buildStateMessage());
      // `renegotiateAndReload`'s own `playerManager.load()` call already
      // triggers a fresh MEDIA_STATUS broadcast to every sender -- that IS
      // this SEEK's real response. Returning `null` tells CAF not to ALSO
      // run its own default in-place seek against the now-superseded
      // manifest. The community `@types/chromecast-caf-receiver`
      // definitions model `MessageInterceptor`'s async arm as resolving to
      // `MessageType | ErrorData` only (no `null`), even though the SDK's
      // own `setMessageInterceptor` doc comment explicitly describes
      // exactly this case ("a promise of updated data ... or null") -- the
      // cast below bridges that (community-types-only) gap.
      return null as unknown as CafSeekRequestData;
    } catch (err) {
      messageBus.sendError(undefined, "negotiation_failed", describeApiError(err), { retryable: true });
      const error = new cast.framework.messages.ErrorData(cast.framework.messages.ErrorType.ERROR);
      error.reason = cast.framework.messages.ErrorReason.GENERIC_LOAD_ERROR;
      return error;
    }
  }
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const options = new cast.framework.CastReceiverOptions();
options.customNamespaces = {
  [PLAYARR_CAST_NAMESPACE]: cast.framework.system.MessageType.JSON,
};
options.disableIdleTimeout = true;
options.playbackConfig = playbackConfig;

context.start(options);
