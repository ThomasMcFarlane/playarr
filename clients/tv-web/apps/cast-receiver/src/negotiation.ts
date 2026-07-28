/**
 * Owns playback negotiation state for the Playarr Cast receiver: wraps
 * `ApiClient.getPlaybackInfo` with the fixed negotiation capability profile
 * (`./capabilities`), tracks the current session id / mode / source offset /
 * url, and exposes `renegotiateAt` for every case that needs a brand new
 * server session rather than a raw player seek (seek on an on-demand HLS
 * session, a quality switch, or an audio-track switch) -- mirroring
 * `web/src/lib/usePlaybackEngine.ts`'s `seek`/`selectQuality`/
 * `selectAudioTrack`, which all re-negotiate instead of mutating the
 * existing session in place.
 *
 * `negotiate` and `renegotiateAt` both close whatever session preceded them
 * (best-effort, never blocking the new negotiation on it) before opening
 * the new one -- so casting a second, unrelated title while one is already
 * playing is just as safe as a seek/quality/audio switch mid-title.
 */
import type {
  ApiClient,
  PlaybackEventKind,
  PlaybackInfo,
  PlaybackInfoParams,
  PlaybackMode,
} from "@playarr-tv/api-client";
import type { PlayarrCastPlaybackIntent, PlayarrCastStopReason } from "@playarr-tv/cast-protocol";
import { NEGOTIATION_PLAYBACK_CAPABILITIES } from "./capabilities";

/** The two `ApiClient` methods this module actually needs -- narrowed so tests can supply a plain fake instead of a real `ApiClient`. */
export type PlaybackNegotiatorClient = Pick<ApiClient, "getPlaybackInfo" | "recordPlaybackEvent">;

/**
 * Same URL substring `usePlaybackEngine.ts`'s `isOnDemandHlsUrl` checks: a
 * freshly-spawned on-demand transcode session's manifest, as opposed to an
 * already-fully-rendered rendition or direct play. Only this shape needs a
 * full re-negotiation on seek (Ground Truth: "An on-demand HLS seek is a new
 * server session, not a media-element seek").
 */
export function isOnDemandSessionUrl(url: string): boolean {
  return url.includes("/api/v1/media/sessions/");
}

export interface NegotiationOverrides {
  /** Selector understood by the server's quality ladder; `"original"` (or omitted) means normal uncapped negotiation. */
  qualityId?: string | null;
  /** Explicit rendition profile name, when the caller already knows it (bypasses `qualityId`'s `"original"` special-casing). */
  profile?: string | null;
  forceTranscode?: boolean;
  /** Global ffprobe stream index of the source audio track to encode/direct-play. */
  audioStreamIndex?: number;
  ignoreSavedPreferences?: boolean;
  maxBitrateBps?: number | null;
}

/**
 * Maps this module's small, protocol-agnostic override shape onto the
 * server's actual `PlaybackInfoParams` query fields -- separated out as a
 * pure function so the mapping (in particular `qualityId`'s "original"
 * special-casing, mirrored from `usePlaybackEngine.ts`'s `selectQuality`)
 * is independently unit-testable.
 */
export function overridesToParams(overrides: NegotiationOverrides): Partial<PlaybackInfoParams> {
  const params: Partial<PlaybackInfoParams> = {};
  if (overrides.audioStreamIndex !== undefined) {
    params.audioStreamIndex = overrides.audioStreamIndex;
  }
  if (overrides.ignoreSavedPreferences !== undefined) {
    params.ignoreSavedPreferences = overrides.ignoreSavedPreferences;
  }
  if (overrides.maxBitrateBps !== undefined && overrides.maxBitrateBps !== null) {
    params.maxBitrateBps = overrides.maxBitrateBps;
  }
  if (overrides.profile) {
    params.profile = overrides.profile;
    params.forceTranscode = overrides.forceTranscode ?? true;
  } else if (overrides.qualityId && overrides.qualityId !== "original") {
    params.profile = overrides.qualityId;
    params.forceTranscode = overrides.forceTranscode ?? true;
  }
  return params;
}

function clampToMs(value: number): number {
  return Math.max(0, Math.round(value));
}

export class PlaybackNegotiator {
  private readonly client: PlaybackNegotiatorClient;
  private mediaFileId: string | null = null;
  private info: PlaybackInfo | null = null;

  constructor(client: PlaybackNegotiatorClient) {
    this.client = client;
  }

  get sessionId(): string | null {
    return this.info?.session_id ?? null;
  }

  get mode(): PlaybackMode | null {
    return this.info?.mode ?? null;
  }

  get sourceOffsetMs(): number {
    return this.info?.source_offset_ms ?? 0;
  }

  get url(): string | null {
    return this.info?.url ?? null;
  }

  /** The full response from the most recent (re)negotiation, or `null` before the first one. */
  get current(): PlaybackInfo | null {
    return this.info;
  }

  /** True only for a freshly-spawned on-demand transcode session -- see `isOnDemandSessionUrl`. */
  get isOnDemandSession(): boolean {
    return this.info !== null && this.info.mode === "hls" && isOnDemandSessionUrl(this.info.url);
  }

  private async closeCurrentSession(positionMs: number, reason: PlayarrCastStopReason): Promise<void> {
    const previous = this.info;
    if (!previous) return;
    this.info = null;
    const event: PlaybackEventKind = { kind: "stop", reason, position_ms: clampToMs(positionMs) };
    await this.client.recordPlaybackEvent(previous.session_id, event).catch(() => {
      // Best-effort -- an unreachable/already-restarted server must never
      // block handing the player a fresh session.
    });
  }

  /**
   * Initial negotiation for a freshly-loaded item (LOAD). Closes any
   * previously active session first (e.g. the sender cast a new title while
   * one was already playing) -- `previousPositionMs` is whatever position
   * was last known for that superseded session, defaulting to 0 when there
   * is nothing meaningful to report.
   */
  async negotiate(
    mediaFileId: string,
    intent: PlayarrCastPlaybackIntent,
    previousPositionMs = 0
  ): Promise<PlaybackInfo> {
    await this.closeCurrentSession(previousPositionMs, "user_stopped");

    this.mediaFileId = mediaFileId;
    const params: PlaybackInfoParams = {
      ...NEGOTIATION_PLAYBACK_CAPABILITIES,
      startPositionMs: clampToMs(intent.startPositionMs),
      ...overridesToParams({
        qualityId: intent.qualityId,
        maxBitrateBps: intent.maxBitrateBps,
      }),
    };
    const info = await this.client.getPlaybackInfo(mediaFileId, params);
    this.info = info;
    return info;
  }

  /**
   * Re-negotiates at a new absolute source-timeline position (seek /
   * quality switch / audio-track switch), closing the superseded session
   * first.
   */
  async renegotiateAt(sourcePositionMs: number, overrides: NegotiationOverrides = {}): Promise<PlaybackInfo> {
    if (!this.mediaFileId) {
      throw new Error("PlaybackNegotiator.renegotiateAt called before an initial negotiate()");
    }
    const clampedPositionMs = clampToMs(sourcePositionMs);
    await this.closeCurrentSession(clampedPositionMs, "user_stopped");

    const params: PlaybackInfoParams = {
      ...NEGOTIATION_PLAYBACK_CAPABILITIES,
      startPositionMs: clampedPositionMs,
      ...overridesToParams(overrides),
    };
    const info = await this.client.getPlaybackInfo(this.mediaFileId, params);
    this.info = info;
    return info;
  }

  /** Ends the current session without opening a new one (e.g. `session.end` from the sender, or an unrecoverable error). No-ops if nothing is active. */
  async endSession(positionMs: number, reason: PlayarrCastStopReason): Promise<void> {
    await this.closeCurrentSession(positionMs, reason);
  }

  /**
   * Clears the tracked session WITHOUT reporting a stop event -- for when a
   * caller (e.g. `progress.ts`'s own terminal flush, which already reports
   * the stop through its own dedup-guarded path) has already told the
   * server this session ended through a different path, so this negotiator
   * simply needs to stop treating it as active without a second, redundant
   * `recordPlaybackEvent` call.
   */
  clearSession(): void {
    this.info = null;
  }
}
