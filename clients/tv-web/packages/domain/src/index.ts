/**
 * @streamarr-tv/domain
 *
 * Shared TypeScript domain types for the Streamarr TV & web clients.
 * These mirror the canonical domain types owned by `streamarr-model` (the
 * backend Rust workspace's domain crate). This package is hand-written for
 * now; once the backend exposes an OpenAPI schema, `packages/api-client`
 * will generate its request/response types directly and this package will
 * likely narrow down to only the types that don't round-trip the API
 * (e.g. purely client-local state).
 */

/** Platforms a Streamarr client can run on. Used for session/device tagging. */
export type ClientPlatform =
  | "web"
  | "webos"
  | "tizen"
  | "vidaa"
  | "ios"
  | "android"
  | "roku";

/** Generic envelope wrapping every versioned API payload. */
export interface VersionEnvelope<TData> {
  /** Semantic version of the API contract that produced this payload, e.g. "1.4.0". */
  apiVersion: string;
  /** Monotonically increasing schema revision for this payload's shape. */
  schemaVersion: number;
  data: TData;
}

/** A page of results plus enough metadata to fetch adjacent pages. */
export interface PaginatedResult<TItem> {
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type WorkKind = "movie" | "series" | "season" | "episode" | "special";

export interface WorkArtwork {
  posterUrl?: string;
  backdropUrl?: string;
  thumbUrl?: string;
  logoUrl?: string;
}

/** A single piece of media metadata: a movie, a series, or an episode within one. */
export interface Work {
  id: string;
  kind: WorkKind;
  title: string;
  sortTitle: string;
  overview?: string;
  releaseYear?: number;
  runtimeSeconds?: number;
  genres: string[];
  /** Set for `season`/`episode` kinds: the series (or season) this belongs to. */
  parentWorkId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  artwork: WorkArtwork;
  createdAt: string;
  updatedAt: string;
}

export type MediaContainer = "mp4" | "mkv" | "webm" | "ts" | "hls" | "dash";

/** A concrete encoded/muxed file (or manifest) backing a `Work`, ready to stream. */
export interface MediaFile {
  id: string;
  workId: string;
  container: MediaContainer;
  videoCodec: string;
  audioCodec: string;
  resolutionWidth: number;
  resolutionHeight: number;
  bitrateKbps: number;
  durationSeconds: number;
  sizeBytes: number;
  drmProtected: boolean;
  /** Absolute or origin-relative URL to the playable manifest/file. */
  streamUrl: string;
  createdAt: string;
}

export type PlaybackSessionState =
  | "starting"
  | "buffering"
  | "playing"
  | "paused"
  | "ended"
  | "error";

/** Server-tracked record of a client's playback progress, used for resume-across-devices. */
export interface PlaybackSession {
  id: string;
  workId: string;
  mediaFileId: string;
  clientPlatform: ClientPlatform;
  deviceId: string;
  userId: string;
  positionSeconds: number;
  state: PlaybackSessionState;
  startedAt: string;
  updatedAt: string;
}

export type MediaRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "fulfilled";

/** A user-submitted request for a `Work` to be added to the library (surfaced in the web Admin UI). */
export interface MediaRequest {
  id: string;
  requestedByUserId: string;
  title: string;
  kind: WorkKind;
  releaseYear?: number;
  status: MediaRequestStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
}
