/**
 * Playarr Cast protocol: shared types and message contracts for the
 * Chromecast custom-channel used between the Streamarr sender apps
 * (web / android-mobile / ios) and the Playarr Cast receiver.
 *
 * Namespace: "urn:x-cast:app.playarr.cast.v1"
 * Encoding: JSON, camelCase throughout (deliberately unlike the
 * snake_case Streamarr HTTP API).
 * Message cap: 64 KB. Never put manifests, playlists, artwork or
 * subtitle text on this channel.
 */

export const PLAYARR_CAST_NAMESPACE = "urn:x-cast:app.playarr.cast.v1" as const;
export const PLAYARR_CAST_PROTOCOL_VERSION = 1 as const;

/** 64 KiB, matching the Cast custom-channel message size cap. */
const MAX_MESSAGE_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Load request
// ---------------------------------------------------------------------------

export interface PlayarrCastLoadRequest {
  protocolVersion: typeof PLAYARR_CAST_PROTOCOL_VERSION;
  server: PlayarrCastServer;
  credentials: PlayarrCastCredentials;
  item: PlayarrCastItem;
  playback: PlayarrCastPlaybackIntent;
  sender: PlayarrCastSender;
  queue?: PlayarrCastQueueEntry[];
}

export interface PlayarrCastServer {
  baseUrl: string;
  peers?: PlayarrCastPeer[];
}

export interface PlayarrCastPeer {
  peerNodeId: string;
  url: string;
}

export interface PlayarrCastCredentials {
  deviceId: string;
  accessToken: string;
  accessTokenExpiresAt: number; // epoch ms
  refreshToken: string;
}

export type PlayarrCastItemKind = "movie" | "episode" | "track" | "other";

export interface PlayarrCastItem {
  mediaFileId: string;
  workId?: string;
  kind: PlayarrCastItemKind;
  title: string;
  subtitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  releaseDate?: string; // ISO 8601
  durationMs?: number;
}

export interface PlayarrCastPlaybackIntent {
  startPositionMs: number; // absolute source-timeline position, NOT engine time
  autoplay: boolean;
  preferredAudioTrackId?: string | null;
  preferredSubtitleTrackId?: string | null;
  preferredAudioLanguage?: string | null;
  preferredSubtitleLanguage?: string | null;
  qualityId?: string | null;
  maxBitrateBps?: number | null;
}

export type PlayarrCastSenderPlatform = "web" | "android-mobile" | "ios";

export interface PlayarrCastSender {
  platform: PlayarrCastSenderPlatform;
  appVersion: string;
  deviceName: string;
  language: string; // BCP-47
}

export interface PlayarrCastQueueEntry {
  mediaFileId: string;
  workId?: string;
  kind: PlayarrCastItemKind;
  title: string;
  subtitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type PlayarrCastSenderMessage =
  | PlayarrCastAuthUpdateMessage
  | PlayarrCastSelectTracksMessage
  | PlayarrCastSelectQualityMessage
  | PlayarrCastSetQueueMessage
  | PlayarrCastPlayNextMessage
  | PlayarrCastRequestStateMessage
  | PlayarrCastEndSessionMessage;

export type PlayarrCastReceiverMessage =
  | PlayarrCastReadyMessage
  | PlayarrCastStateMessage
  | PlayarrCastAuthRotatedMessage
  | PlayarrCastErrorMessage
  | PlayarrCastAckMessage;

export type PlayarrCastMessage = PlayarrCastSenderMessage | PlayarrCastReceiverMessage;

interface PlayarrCastEnvelope {
  protocolVersion: typeof PLAYARR_CAST_PROTOCOL_VERSION;
  requestId?: string;
}

export interface PlayarrCastAuthUpdateMessage extends PlayarrCastEnvelope {
  type: "auth.update";
  credentials: PlayarrCastCredentials;
}

export interface PlayarrCastSelectTracksMessage extends PlayarrCastEnvelope {
  type: "tracks.select";
  audioTrackId?: string;
  subtitleTrackId?: string | null;
}

export interface PlayarrCastSelectQualityMessage extends PlayarrCastEnvelope {
  type: "quality.select";
  qualityId: string;
}

export interface PlayarrCastSetQueueMessage extends PlayarrCastEnvelope {
  type: "queue.set";
  items: PlayarrCastQueueEntry[];
}

export interface PlayarrCastPlayNextMessage extends PlayarrCastEnvelope {
  type: "queue.playNext";
}

export interface PlayarrCastRequestStateMessage extends PlayarrCastEnvelope {
  type: "state.request";
}

export interface PlayarrCastEndSessionMessage extends PlayarrCastEnvelope {
  type: "session.end";
  reason: PlayarrCastStopReason;
}

export type PlayarrCastStopReason =
  | "completed"
  | "user_stopped"
  | "error"
  | "device_disconnected";

export interface PlayarrCastReadyMessage extends PlayarrCastEnvelope {
  type: "ready";
  receiverVersion: string;
  supportedProtocolVersion: number;
  deviceCapabilities: PlayarrCastDeviceCapabilities;
}

export interface PlayarrCastDeviceCapabilities {
  supportsH264: boolean;
  supportsHevc: boolean;
  supportsVp9: boolean;
  supportsAv1: boolean;
  supports4k: boolean;
  supportsHdr: boolean;
}

export interface PlayarrCastStateMessage extends PlayarrCastEnvelope {
  type: "state";
  mediaFileId: string;
  sessionId: string | null;
  negotiating: boolean;
  mode: "direct" | "hls" | null;
  sourceOffsetMs: number;
  positionMs: number;
  durationMs: number;
  audioTracks: PlayarrCastTrackOption[];
  subtitleTracks: PlayarrCastTrackOption[];
  qualityOptions: PlayarrCastQualityOption[];
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  selectedQualityId: string;
  queue: PlayarrCastQueueEntry[];
}

export interface PlayarrCastTrackOption {
  id: string;
  label: string;
  language: string | null;
  forced: boolean;
  isDefault: boolean;
}

export interface PlayarrCastQualityOption {
  id: string;
  label: string;
  height: number | null;
  videoBitrateBps: number | null;
}

export interface PlayarrCastAuthRotatedMessage extends PlayarrCastEnvelope {
  type: "auth.rotated";
  credentials: PlayarrCastCredentials;
}

export interface PlayarrCastErrorMessage extends PlayarrCastEnvelope {
  type: "error";
  code: PlayarrCastErrorCode;
  message: string;
  apiStatus?: number;
  retryable: boolean;
}

export type PlayarrCastErrorCode =
  | "unsupported_protocol_version"
  | "invalid_load_request"
  | "server_unreachable"
  | "insecure_server"
  | "auth_failed"
  | "negotiation_failed"
  | "playback_failed"
  | "session_expired"
  | "unknown";

export interface PlayarrCastAckMessage extends PlayarrCastEnvelope {
  type: "ack";
  requestId: string;
  ok: boolean;
  code?: PlayarrCastErrorCode;
  message?: string;
}

// ---------------------------------------------------------------------------
// Internal defensive helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isOptionalNumber(v: unknown): v is number | undefined {
  return v === undefined || isNumber(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isOptionalNullableString(v: unknown): v is string | null | undefined {
  return v === undefined || v === null || typeof v === "string";
}

function isOptionalNullableNumber(v: unknown): v is number | null | undefined {
  return v === undefined || v === null || isNumber(v);
}

function hasProtocolVersion(v: Record<string, unknown>): boolean {
  return v["protocolVersion"] === PLAYARR_CAST_PROTOCOL_VERSION;
}

const ITEM_KINDS: readonly PlayarrCastItemKind[] = ["movie", "episode", "track", "other"];

function isPlayarrCastItemKind(v: unknown): v is PlayarrCastItemKind {
  return typeof v === "string" && (ITEM_KINDS as readonly string[]).includes(v);
}

function isPlayarrCastPeer(v: unknown): v is PlayarrCastPeer {
  return isRecord(v) && isString(v["peerNodeId"]) && isString(v["url"]);
}

function isPlayarrCastServer(v: unknown): v is PlayarrCastServer {
  if (!isRecord(v) || !isString(v["baseUrl"])) return false;
  const peers = v["peers"];
  if (peers === undefined) return true;
  return Array.isArray(peers) && peers.every(isPlayarrCastPeer);
}

function isPlayarrCastCredentials(v: unknown): v is PlayarrCastCredentials {
  return (
    isRecord(v) &&
    isString(v["deviceId"]) &&
    isString(v["accessToken"]) &&
    isNumber(v["accessTokenExpiresAt"]) &&
    isString(v["refreshToken"])
  );
}

function isPlayarrCastItem(v: unknown): v is PlayarrCastItem {
  if (!isRecord(v)) return false;
  return (
    isString(v["mediaFileId"]) &&
    isOptionalString(v["workId"]) &&
    isPlayarrCastItemKind(v["kind"]) &&
    isString(v["title"]) &&
    isOptionalString(v["subtitle"]) &&
    isOptionalNumber(v["seasonNumber"]) &&
    isOptionalNumber(v["episodeNumber"]) &&
    isOptionalString(v["releaseDate"]) &&
    isOptionalNumber(v["durationMs"])
  );
}

function isPlayarrCastPlaybackIntent(v: unknown): v is PlayarrCastPlaybackIntent {
  if (!isRecord(v)) return false;
  return (
    isNumber(v["startPositionMs"]) &&
    isBoolean(v["autoplay"]) &&
    isOptionalNullableString(v["preferredAudioTrackId"]) &&
    isOptionalNullableString(v["preferredSubtitleTrackId"]) &&
    isOptionalNullableString(v["preferredAudioLanguage"]) &&
    isOptionalNullableString(v["preferredSubtitleLanguage"]) &&
    isOptionalNullableString(v["qualityId"]) &&
    isOptionalNullableNumber(v["maxBitrateBps"])
  );
}

const SENDER_PLATFORMS: readonly PlayarrCastSenderPlatform[] = ["web", "android-mobile", "ios"];

function isPlayarrCastSender(v: unknown): v is PlayarrCastSender {
  if (!isRecord(v)) return false;
  const platform = v["platform"];
  return (
    typeof platform === "string" &&
    (SENDER_PLATFORMS as readonly string[]).includes(platform) &&
    isString(v["appVersion"]) &&
    isString(v["deviceName"]) &&
    isString(v["language"])
  );
}

function isPlayarrCastQueueEntry(v: unknown): v is PlayarrCastQueueEntry {
  if (!isRecord(v)) return false;
  return (
    isString(v["mediaFileId"]) &&
    isOptionalString(v["workId"]) &&
    isPlayarrCastItemKind(v["kind"]) &&
    isString(v["title"]) &&
    isOptionalString(v["subtitle"]) &&
    isOptionalNumber(v["seasonNumber"]) &&
    isOptionalNumber(v["episodeNumber"]) &&
    isOptionalNumber(v["durationMs"])
  );
}

/**
 * Total, defensive type guard for a Cast LOAD request payload.
 */
export function isPlayarrCastLoadRequest(v: unknown): v is PlayarrCastLoadRequest {
  if (!isRecord(v) || !hasProtocolVersion(v)) return false;

  if (!isPlayarrCastServer(v["server"])) return false;
  if (!isPlayarrCastCredentials(v["credentials"])) return false;
  if (!isPlayarrCastItem(v["item"])) return false;
  if (!isPlayarrCastPlaybackIntent(v["playback"])) return false;
  if (!isPlayarrCastSender(v["sender"])) return false;

  const queue = v["queue"];
  if (queue !== undefined) {
    if (!Array.isArray(queue) || !queue.every(isPlayarrCastQueueEntry)) return false;
  }

  return true;
}

function isPlayarrCastDeviceCapabilities(v: unknown): v is PlayarrCastDeviceCapabilities {
  return (
    isRecord(v) &&
    isBoolean(v["supportsH264"]) &&
    isBoolean(v["supportsHevc"]) &&
    isBoolean(v["supportsVp9"]) &&
    isBoolean(v["supportsAv1"]) &&
    isBoolean(v["supports4k"]) &&
    isBoolean(v["supportsHdr"])
  );
}

function isPlayarrCastTrackOption(v: unknown): v is PlayarrCastTrackOption {
  return (
    isRecord(v) &&
    isString(v["id"]) &&
    isString(v["label"]) &&
    isNullableString(v["language"]) &&
    isBoolean(v["forced"]) &&
    isBoolean(v["isDefault"])
  );
}

function isPlayarrCastQualityOption(v: unknown): v is PlayarrCastQualityOption {
  if (!isRecord(v)) return false;
  const height = v["height"];
  const videoBitrateBps = v["videoBitrateBps"];
  return (
    isString(v["id"]) &&
    isString(v["label"]) &&
    (height === null || isNumber(height)) &&
    (videoBitrateBps === null || isNumber(videoBitrateBps))
  );
}

const ERROR_CODES: readonly PlayarrCastErrorCode[] = [
  "unsupported_protocol_version",
  "invalid_load_request",
  "server_unreachable",
  "insecure_server",
  "auth_failed",
  "negotiation_failed",
  "playback_failed",
  "session_expired",
  "unknown",
];

function isPlayarrCastErrorCode(v: unknown): v is PlayarrCastErrorCode {
  return typeof v === "string" && (ERROR_CODES as readonly string[]).includes(v);
}

function isOptionalPlayarrCastErrorCode(v: unknown): v is PlayarrCastErrorCode | undefined {
  return v === undefined || isPlayarrCastErrorCode(v);
}

const STOP_REASONS: readonly PlayarrCastStopReason[] = [
  "completed",
  "user_stopped",
  "error",
  "device_disconnected",
];

function isPlayarrCastStopReason(v: unknown): v is PlayarrCastStopReason {
  return typeof v === "string" && (STOP_REASONS as readonly string[]).includes(v);
}

/**
 * Total, defensive type guard for messages sent sender -> receiver.
 */
export function isPlayarrCastSenderMessage(v: unknown): v is PlayarrCastSenderMessage {
  if (!isRecord(v) || !hasProtocolVersion(v)) return false;
  if (!isOptionalString(v["requestId"])) return false;

  switch (v["type"]) {
    case "auth.update":
      return isPlayarrCastCredentials(v["credentials"]);
    case "tracks.select":
      return (
        isOptionalString(v["audioTrackId"]) &&
        isOptionalNullableString(v["subtitleTrackId"])
      );
    case "quality.select":
      return isString(v["qualityId"]);
    case "queue.set": {
      const items = v["items"];
      return Array.isArray(items) && items.every(isPlayarrCastQueueEntry);
    }
    case "queue.playNext":
      return true;
    case "state.request":
      return true;
    case "session.end":
      return isPlayarrCastStopReason(v["reason"]);
    default:
      return false;
  }
}

/**
 * Total, defensive type guard for messages sent receiver -> sender.
 */
export function isPlayarrCastReceiverMessage(v: unknown): v is PlayarrCastReceiverMessage {
  if (!isRecord(v) || !hasProtocolVersion(v)) return false;
  if (!isOptionalString(v["requestId"])) return false;

  switch (v["type"]) {
    case "ready":
      return (
        isString(v["receiverVersion"]) &&
        isNumber(v["supportedProtocolVersion"]) &&
        isPlayarrCastDeviceCapabilities(v["deviceCapabilities"])
      );
    case "state": {
      const mode = v["mode"];
      const sessionId = v["sessionId"];
      const selectedAudioTrackId = v["selectedAudioTrackId"];
      const selectedSubtitleTrackId = v["selectedSubtitleTrackId"];
      const audioTracks = v["audioTracks"];
      const subtitleTracks = v["subtitleTracks"];
      const qualityOptions = v["qualityOptions"];
      const queue = v["queue"];
      return (
        isString(v["mediaFileId"]) &&
        (sessionId === null || isString(sessionId)) &&
        isBoolean(v["negotiating"]) &&
        (mode === null || mode === "direct" || mode === "hls") &&
        isNumber(v["sourceOffsetMs"]) &&
        isNumber(v["positionMs"]) &&
        isNumber(v["durationMs"]) &&
        Array.isArray(audioTracks) &&
        audioTracks.every(isPlayarrCastTrackOption) &&
        Array.isArray(subtitleTracks) &&
        subtitleTracks.every(isPlayarrCastTrackOption) &&
        Array.isArray(qualityOptions) &&
        qualityOptions.every(isPlayarrCastQualityOption) &&
        (selectedAudioTrackId === null || isString(selectedAudioTrackId)) &&
        (selectedSubtitleTrackId === null || isString(selectedSubtitleTrackId)) &&
        isString(v["selectedQualityId"]) &&
        Array.isArray(queue) &&
        queue.every(isPlayarrCastQueueEntry)
      );
    }
    case "auth.rotated":
      return isPlayarrCastCredentials(v["credentials"]);
    case "error":
      return (
        isPlayarrCastErrorCode(v["code"]) &&
        isString(v["message"]) &&
        isOptionalNumber(v["apiStatus"]) &&
        isBoolean(v["retryable"])
      );
    case "ack":
      return (
        isString(v["requestId"]) &&
        isBoolean(v["ok"]) &&
        isOptionalPlayarrCastErrorCode(v["code"]) &&
        isOptionalString(v["message"])
      );
    default:
      return false;
  }
}

/**
 * Parses a Playarr Cast message from either a JSON string (the shape
 * delivered to Cast custom-channel message listeners) or an
 * already-parsed object (the shape accepted by `sendMessage` on the
 * sending side). Never throws: returns `undefined` for anything
 * unparseable, any unknown `type`, or a `protocolVersion` mismatch.
 */
export function parsePlayarrCastMessage(raw: unknown): PlayarrCastMessage | undefined {
  let candidate: unknown = raw;

  if (isString(raw)) {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  if (isPlayarrCastSenderMessage(candidate)) {
    return candidate;
  }
  if (isPlayarrCastReceiverMessage(candidate)) {
    return candidate;
  }
  return undefined;
}

/**
 * Encodes a Playarr Cast message to a JSON string, throwing a
 * `RangeError` if the UTF-8 encoded size exceeds the 64 KB custom
 * channel message cap.
 */
export function encodePlayarrCastMessage(message: PlayarrCastMessage): string {
  const encoded = JSON.stringify(message);
  const byteLength = new TextEncoder().encode(encoded).length;
  if (byteLength > MAX_MESSAGE_BYTES) {
    throw new RangeError(
      `Playarr Cast message exceeds ${MAX_MESSAGE_BYTES} byte limit (got ${byteLength} bytes)`,
    );
  }
  return encoded;
}
