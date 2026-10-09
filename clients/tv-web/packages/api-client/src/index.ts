/**
 * @playarr-tv/api-client
 *
 * Real typed client for the Playarr Server API. `src/generated/schema.ts` is
 * generated straight from `backend/openapi/playarr.yaml` by
 * `openapi-typescript` (run `pnpm run generate` to refresh it against the
 * spec); this file wraps that generated `paths`/`components` pair with
 * `openapi-fetch` (a thin typed fetch client) behind a small, ergonomic
 * `ApiClient` class covering the spec's operations: system health/ready/
 * version, trusted-network/credentialed login, the RFC 8628 OAuth
 * device-code + token endpoints, the *arr webhook receiver, catalog
 * browse/get/search, admin source-instance registration, and playback
 * negotiation.
 *
 * The admin source-instance/user operations require a verified
 * `Authorization: Bearer <access_token>` header (401 without one, 403 if
 * the caller isn't an admin); the catalog/playback operations require the
 * same header but check `can_stream` instead of `is_admin` (403 if the
 * caller lacks Playarr streaming access -- see
 * `backend/crates/playarr-api/src/auth_extractor.rs`'s `StreamingUser`).
 * Login/oauth stay unauthenticated per the spec's own responses -- see the
 * constructor's `authMiddleware` below, which attaches the header to
 * exactly `PROTECTED_OPERATIONS` and no others.
 *
 * Callers who want the raw `openapi-fetch` client (e.g. for an operation
 * this wrapper hasn't grown a convenience method for yet) can reach it via
 * `ApiClient.raw`.
 */
import createFetchClient, { type Client, type Middleware } from "openapi-fetch";
import type { components, paths } from "./generated/schema";
import { QueryCache, tagsForMutation } from "./queryCache";

export { QueryCache, tagsForMutation, type QueryInvalidation, type QueryTag } from "./queryCache";

export type { paths, components } from "./generated/schema";

// ---------------------------------------------------------------------------
// Wire types, aliased straight off the generated schema so there is exactly
// one source of truth for the shapes the real backend actually sends/expects.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Portable user data (export/import). Hand-written wire types: these routes
// carry binary bodies, so they go through `requestRaw` rather than the
// generated `paths` client. Shapes mirror `backend/openapi/playarr.yaml`.
// ---------------------------------------------------------------------------

/** `ready` frame body of `GET /api/v1/events` (docs/architecture/live-events.md). */
export interface LiveReadyEvent {
  seq: number;
  retention_ms: number;
  heartbeat_ms: number;
  max_age_ms: number;
  server_time_ms: number;
}

export type LiveChangeType =
  | "watch"
  | "library"
  | "calendar"
  | "playlist"
  | "watchlist"
  | "download"
  | "household"
  | "account"
  | "admin";

/** `change` frame body: a pointer to what moved, never the entity body. */
export interface LiveChangeEvent {
  seq: number;
  type: LiveChangeType | (string & {});
  entity: string;
  id?: string | null;
  changed: string[];
  /** Server commit time, epoch milliseconds. */
  at: number;
}

/** `resync` frame body: the cursor could not be honoured; refetch everything shown. */
export interface LiveResyncEvent {
  reason: string;
  seq: number;
}

export type UserDataExportStatus = "queued" | "running" | "ready" | "failed" | "expired";

export interface UserDataExportJob {
  id: string;
  status: UserDataExportStatus;
  created_at: string;
  expires_at: string | null;
  progress: { stage: string; done: number; total: number };
  counts: {
    watch_progress: number;
    playback_preferences: number;
    playlists: number;
    playlist_items: number;
    skipped: number;
  };
  size_bytes: number | null;
  download_url: string | null;
  error: string | null;
}

export interface UserDataExportList {
  scope: "own_account_only";
  exports: UserDataExportJob[];
}

export type UserDataProgressConflicts = "newest" | "keep_existing";

export interface UserDataImportOptions {
  includePreferences?: boolean;
  progressConflicts?: UserDataProgressConflicts;
}

export interface UserDataImportSample {
  section: string;
  title: string;
  outcome: string;
  playlist: string | null;
  candidates: string[];
}

export interface UserDataImportPreview {
  package_sha256: string;
  schema_version: number;
  generated_at: string;
  source_instance_name: string;
  summary: {
    watch_progress: {
      total: number;
      will_add: number;
      will_update: number;
      already_present: number;
      conflicts_kept: number;
      unmatched: number;
      ambiguous: number;
    };
    playlists: {
      total: number;
      new: number;
      existing: number;
      items_total: number;
      items_to_add: number;
      items_already_present: number;
      items_unmatched: number;
    };
    /** Absent when talking to a server that predates the watchlist section. */
    watchlist?: {
      total: number;
      will_add: number;
      already_present: number;
      unmatched: number;
    };
    preferred_audio_language_change: string | null;
    playback_preferences_not_applied: number;
    unmatched_total: number;
  };
  samples: UserDataImportSample[];
  warnings: string[];
}

export interface UserDataImportResult {
  completed: boolean;
  progress_added: number;
  progress_updated: number;
  progress_unchanged: number;
  progress_conflicts_kept: number;
  playlists_created: number;
  playlist_items_added: number;
  playlist_items_already_present: number;
  preferred_audio_language_updated: boolean;
  unmatched_total: number;
  failure: string | null;
  sections_not_attempted: string[];
}

/** A one-time, 15-minute link for another device (shown as a QR code). */
export interface UserDataTransferLink {
  /** Origin-relative; resolve with `ApiClient.resolveUrl` when `url` is absent. */
  path: string;
  /** Absolute URL built by the server from the address the request used. */
  url?: string;
  expires_at: string;
}

export type UserDataImportSessionStatus = "waiting" | "uploading" | "uploaded";

export interface UserDataImportSession {
  id: string;
  status: UserDataImportSessionStatus;
  /** Only present in the response that created the session. */
  upload_path: string | null;
  upload_url?: string | null;
  expires_at: string;
  size_bytes: number | null;
}

export type Work = components["schemas"]["Work"];
export type WorkKind = components["schemas"]["WorkKind"];
export type Availability = components["schemas"]["Availability"];
export type ImageAsset = components["schemas"]["ImageAsset"];
export type ImageKind = components["schemas"]["ImageKind"];
export type ExternalRef = components["schemas"]["ExternalRef"];
export type ExternalProvider = components["schemas"]["ExternalProvider"];
export type CatalogPage = components["schemas"]["CatalogPageSchema"];
export type LanguageFacetEntry = components["schemas"]["LanguageFacetEntry"];
export type LanguageFacets = components["schemas"]["LanguageFacetsResponse"];
export type WorkDetail = components["schemas"]["WorkDetailSchema"];
export type WorkChildren = components["schemas"]["WorkChildrenSchema"];
export type PersonResponse = components["schemas"]["PersonResponse"];
export type CreditResponse = components["schemas"]["CreditResponse"];
export type WorkCreditsResponse = components["schemas"]["WorkCreditsResponse"];
export type Season = components["schemas"]["Season"];
export type SeasonDetail = components["schemas"]["SeasonDetailSchema"];
export type Episode = components["schemas"]["Episode"];
/** Wraps an `Episode` with the resolved `MediaFile` id that plays it (`null` until one has synced). */
export type EpisodeDetail = components["schemas"]["EpisodeDetailSchema"];
export type Album = components["schemas"]["Album"];
export type AlbumDetail = components["schemas"]["AlbumDetailSchema"];
export type Track = components["schemas"]["Track"];
/** Wraps a `Track` with the resolved `MediaFile` id that plays it (`null` until one has synced). */
export type TrackDetail = components["schemas"]["TrackDetailSchema"];
export type Book = components["schemas"]["Book"];
/** Wraps a `Book` with the resolved `MediaFile` id that plays it (`null` until one has synced). */
export type BookDetail = components["schemas"]["BookDetailSchema"];

export type PlaybackInfo = components["schemas"]["PlaybackInfoResponse"];
export type PlaybackMode = components["schemas"]["PlaybackMode"];
export type PlaybackQualityOption = components["schemas"]["PlaybackQualityOption"];
export type PlaybackEventKind = components["schemas"]["PlaybackEventKind"];
export type ClientPlaybackReport = components["schemas"]["ClientPlaybackReport"];
export type PlaybackHealthReport = components["schemas"]["PlaybackHealthReport"];
export type HealthFact = components["schemas"]["HealthFact"];
export type HealthFinding = components["schemas"]["HealthFinding"];
export type HealthSeverity = components["schemas"]["HealthSeverity"];
export type HealthProvenance = components["schemas"]["HealthProvenance"];
export type PlaybackHealthExport = components["schemas"]["PlaybackHealthExport"];

/** Outcome of one bounded connection test request. */
export interface ConnectionTestResult {
  bytes: number;
  /** Time from request start until response headers arrived. */
  latencyMs: number;
  /** Download rate over the body transfer, bits per second. */
  throughputBps: number;
}
export type MediaChapter = components["schemas"]["MediaChapter"];
export type MediaMetadata = components["schemas"]["MediaMetadata"];
export type MediaPlaybackOptions =
  components["schemas"]["MediaPlaybackOptionsResponse"];
export type MediaPlaybackPreferences =
  components["schemas"]["MediaPlaybackPreferenceResponse"];
export type UpdateMediaPlaybackPreferencesRequest =
  components["schemas"]["UpdateMediaPlaybackPreferencesRequest"];
export type WatchProgress = components["schemas"]["WatchProgress"];

// Unsorted folders (docs/architecture/unsorted-folders.md).
export type FolderRoot = components["schemas"]["FolderRootResponse"];
export type FolderRootsResponse = components["schemas"]["FolderRootsResponse"];
export type FolderBrowseResponse = components["schemas"]["FolderBrowseResponse"];
export type FolderEntry = components["schemas"]["FolderEntryResponse"];
export type FolderBreadcrumb = components["schemas"]["FolderBreadcrumbResponse"];
export type FolderSort = components["schemas"]["FolderSort"];
export type FolderOrder = components["schemas"]["FolderOrder"];
export type FolderEntryFilter = components["schemas"]["FolderEntryFilter"];
export type AdminFolderRoot = components["schemas"]["AdminFolderRootResponse"];
export type AdminFolderRoots = components["schemas"]["AdminFolderRootsResponse"];
export type FolderScanSummary = components["schemas"]["ScanSummary"];
export type CreateFolderRootRequest = components["schemas"]["CreateFolderRootRequest"];
export type UpdateFolderRootRequest = components["schemas"]["UpdateFolderRootRequest"];

export interface BrowseFolderParams {
  /** Root-relative directory; empty or omitted is the root. */
  path?: string;
  q?: string;
  sort?: FolderSort;
  order?: FolderOrder;
  type?: FolderEntryFilter;
  limit?: number;
  offset?: number;
}
export type ResumePlan = components["schemas"]["ResumePlan"];
export type ResumeOption = components["schemas"]["ResumeOption"];
export type ResumeOptionKind = components["schemas"]["ResumeOptionKind"];
export type ResumeAskReason = components["schemas"]["ResumeAskReason"];
export type RemoteTarget = components["schemas"]["RemoteTargetResponse"];
export type RemotePairing = components["schemas"]["PairingResponse"];
export type RemoteCommandRequest = components["schemas"]["CommandRequest"];
export type RemoteCommandStatus = components["schemas"]["CommandStatusResponse"];
export type RemoteInboxEvent = components["schemas"]["InboxEvent"];
export type RemoteInbox = components["schemas"]["InboxResponse"];
export type RemotePlaybackSnapshot = components["schemas"]["PlaybackSnapshot"];
export type RemoteHandoff = components["schemas"]["HandoffResponse"];
export type RemoteCreateHandoffRequest = components["schemas"]["CreateHandoffRequest"];
export type WatchState = components["schemas"]["WatchState"];

/** One playback attempt from start to finish -- `playback_sessions` row shape, verbatim. */
export type PlaybackSession = components["schemas"]["PlaybackSession"];
/** One live session enriched with linked user/media context. */
export type ActiveSessionView = components["schemas"]["ActiveSessionView"];
/** One historical session enriched with linked user/media context. */
export type SessionHistoryView = components["schemas"]["SessionHistoryView"];
/** One peer-group live session enriched with its origin server and effective library. */
export type ActivityActiveSessionView = ActiveSessionView;
/** One peer-group historical session enriched with its origin server and effective library. */
export type ActivitySessionHistoryView = SessionHistoryView;
/** Partial-result metadata for a connected server that could not be queried. */
export type UnavailableActivityNode =
  components["schemas"]["UnavailableNodeView"];
/** Peer-group live sessions plus any connected servers omitted from the partial result. */
export type ActivityActiveResponse =
  components["schemas"]["PlaybackActivityActiveResponse"];
/** One complete effective-library choice for the Activity filter. */
export type ActivityLibraryFacet =
  components["schemas"]["PlaybackActivityLibraryFacet"];
/** Complete Activity filter choices independent of the current result page. */
export type ActivityFacetsResponse =
  components["schemas"]["PlaybackActivityFacetsResponse"];
/** Exact JSON body accepted by the peer-group activity history search. */
export type ActivityHistoryRequest = Partial<
  components["schemas"]["PlaybackActivityHistoryRequest"]
>;
/** Peer-group history page plus availability and pagination metadata. */
export type ActivityHistoryResponse =
  components["schemas"]["PlaybackActivityHistoryResponse"];
export type ActivityStopReasonFilter =
  components["schemas"]["PlaybackActivityStopReason"];
export type PlayMethod = components["schemas"]["PlayMethod"];
export type StopReason = components["schemas"]["StopReason"];
export type TranscodeReason = components["schemas"]["TranscodeReason"];

export type ClientPlatform = components["schemas"]["ClientPlatform"];
export type HouseholdStatus = components["schemas"]["HouseholdStatusResponse"];
export type HouseholdSettings = components["schemas"]["HouseholdSettings"];
export type HouseholdControls = components["schemas"]["HouseholdControls"];
export type HouseholdApproval = components["schemas"]["Approval"];
export type HouseholdApprovalKind = components["schemas"]["ApprovalKind"];
export type CreateHouseholdApprovalRequest = components["schemas"]["CreateApprovalRequest"];
export type DecideHouseholdApprovalRequest = components["schemas"]["DecideApprovalRequest"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type LoginResponse = components["schemas"]["LoginResponse"];
export type RefreshRequest = components["schemas"]["RefreshRequest"];
export type RefreshResponse = components["schemas"]["RefreshResponse"];
export type UnlockRequest = components["schemas"]["UnlockRequest"];
export type DeviceCodeRequest = components["schemas"]["DeviceCodeRequest"];
export type DeviceCodeResponse = components["schemas"]["DeviceCodeResponseSchema"];
export type DeviceAuthorizationRequest = components["schemas"]["DeviceAuthorizationRequest"];
export type DeviceTokenRequest = components["schemas"]["DeviceTokenRequest"];
export type TokenResponse = components["schemas"]["TokenResponseSchema"];
export type OAuthErrorBody = components["schemas"]["OAuthErrorBody"];

export type VersionEnvelope = components["schemas"]["VersionEnvelope"];
export type CompatibilityEntry = components["schemas"]["CompatibilityEntry"];
export type SystemSettings = components["schemas"]["SystemSettings"];
export type UpdateSystemSettingsRequest =
  components["schemas"]["UpdateSystemSettingsRequest"];
export type CapabilitiesResponse = components["schemas"]["CapabilitiesResponse"];
export type CapabilityItem = components["schemas"]["CapabilityItem"];
export type CapabilityStatus = components["schemas"]["CapabilityStatus"];
export type CapabilityCategory = components["schemas"]["CapabilityCategory"];

export type BackupOverview = components["schemas"]["BackupOverview"];
export type BackupSummary = components["schemas"]["BackupSummary"];
export type BackupRunStatus = components["schemas"]["BackupRunStatus"];
export type BackupFailure = components["schemas"]["BackupFailure"];
export type BackupInventoryItem = components["schemas"]["BackupInventoryItem"];
export type BackupVerification = components["schemas"]["BackupVerification"];
export type StartedBackup = components["schemas"]["StartedBackup"];

export type SourceKind = components["schemas"]["SourceKind"];
export type SourceInstanceRequest = components["schemas"]["SourceInstanceRequest"];
export type SourceInstanceResponse = components["schemas"]["SourceInstanceResponse"];
export type SourceInstanceSyncStatus = components["schemas"]["SourceInstanceSyncStatusResponse"];
export type SourceFolderMappingsRequest = components["schemas"]["SourceFolderMappingsRequest"];
export type SourceMatrixResponse = components["schemas"]["SourceMatrixResponse"];
export type SourceMatrixFile = components["schemas"]["SourceMatrixFileResponse"];

export type TdarrConnectionRequest = components["schemas"]["TdarrConnectionRequest"];
export type TdarrConnectionResponse = components["schemas"]["TdarrConnectionResponse"];

export type CreateUserRequest = components["schemas"]["CreateUserRequest"];
export type SignupRequest = components["schemas"]["SignupRequest"];
export type CreateUserInvite = components["schemas"]["CreateUserInvite"];
export type CreateUserInviteRequest = components["schemas"]["CreateUserInviteRequest"];
export type UserInviteResponse = components["schemas"]["UserInviteResponse"];
export type UserInviteRequestResponse = components["schemas"]["UserInviteRequestResponse"];
export type UserInviteRequestStatus = components["schemas"]["UserInviteRequestStatus"];
export type ReviewUserInviteRequest = components["schemas"]["ReviewUserInviteRequest"];
export type PeerAddressBundle = components["schemas"]["PeerAddressBundle"];
export type PeerAddressEntry = components["schemas"]["PeerAddressEntry"];
export type PeerAddress = components["schemas"]["PeerAddress"];
export type PeerGroup = components["schemas"]["PeerGroup"];
export type PeerNode = components["schemas"]["PeerNode"];
export type PeerNodeStatus = components["schemas"]["PeerNodeStatus"];
export type FoundPeerGroupRequest = components["schemas"]["FoundPeerGroupRequest"];
export type FoundPeerGroupResponse = components["schemas"]["FoundPeerGroupResponse"];
export type JoinPeerGroupRequest = components["schemas"]["JoinPeerGroupRequest"];
export type JoinPeerGroupResponse = components["schemas"]["EnrollResponse"];
export type LeavePeerGroupResponse = components["schemas"]["LeavePeerGroupResponse"];
export type PeerJoinTokenResponse = components["schemas"]["PeerJoinTokenResponse"];
export type SelfPeerNodeRequest = components["schemas"]["SelfPeerNodeRequest"];
export type SelfPeerNodeResponse = components["schemas"]["SelfPeerNodeResponse"];
export type PeerSyncStatusResponse = components["schemas"]["PeerSyncStatusResponse"];
export type FirebaseWebConfig = components["schemas"]["FirebaseWebConfig"];
export type RegisterPushRequest = components["schemas"]["RegisterPushRequest"];
export type UpdateUserRequest = components["schemas"]["UpdateUserRequest"];
export type UserResponse = components["schemas"]["UserResponse"];
export type PlayerPreferences = components["schemas"]["PlayerPreferencesResponse"];
export type SelfCapabilities = components["schemas"]["SelfCapabilitiesResponse"];
export type UpdatePlayerPreferencesRequest =
  components["schemas"]["UpdatePlayerPreferencesRequest"];
export type ProfileAvatarPreference = components["schemas"]["ProfileAvatarPreference"];
export type ProfileAvatarSettingResponse =
  components["schemas"]["ProfileAvatarSettingResponse"];
export type UpdateProfileAvatarRequest =
  components["schemas"]["UpdateProfileAvatarRequest"];
export type AvailableProfile = components["schemas"]["AvailableProfileResponse"];
export type ProfilePinSetting = components["schemas"]["ProfilePinSettingResponse"];
export type UpdateProfilePinRequest = components["schemas"]["UpdateProfilePinRequest"];
export type VerifyProfilePinRequest = components["schemas"]["VerifyProfilePinRequest"];
export type VerifyProfilePinResponse = components["schemas"]["VerifyProfilePinResponse"];

export type ViewCriteriaDto = components["schemas"]["ViewCriteriaDto"];
export type LibraryViewRequest = components["schemas"]["LibraryViewRequest"];
export type LibraryViewResponse = components["schemas"]["LibraryViewResponse"];
export type ViewSummary = components["schemas"]["ViewSummary"];

export type HomeRail = components["schemas"]["HomeRailResponse"];
export type HomeRailsResponse = components["schemas"]["HomeRailsResponse"];
export type HomeRailKind = components["schemas"]["HomeRailKind"];
export type HomeRailConfig = components["schemas"]["HomeRailConfig"];
export type HomeRailDefinition = components["schemas"]["HomeRailDefinitionResponse"];
export type CreateHomeRailRequest = components["schemas"]["CreateHomeRailRequest"];
export type UpdateHomeRailRequest = components["schemas"]["UpdateHomeRailRequest"];
export type SeasonalRule = components["schemas"]["SeasonalRule"];
export type RailPreferences = components["schemas"]["RailPreferencesResponse"];
export type RailPreferencesRequest = components["schemas"]["RailPreferencesRequest"];

export type PlaylistResponse = components["schemas"]["PlaylistResponse"];
export type DiscoverResponse = components["schemas"]["DiscoverResponse"];
export type DiscoverTitle = components["schemas"]["DiscoverTitle"];
export type DiscoveryTitle = components["schemas"]["DiscoveryTitle"];
export type DiscoveryKind = components["schemas"]["DiscoveryKind"];
export type DiscoveryScope = components["schemas"]["DiscoveryScope"];
export type TitleSource = components["schemas"]["TitleSource"];
export type TitleAction = components["schemas"]["TitleAction"];
export type TitleSnapshot = components["schemas"]["TitleSnapshot"];
export type ProviderStatus = components["schemas"]["ProviderStatus"];
export type ResolvedTitle = components["schemas"]["ResolvedTitle"];
export type RequestResult = components["schemas"]["RequestResult"];
export type RequestView = components["schemas"]["RequestView"];
export type RequestStatus = components["schemas"]["RequestStatus"];
export type RequestBackend = components["schemas"]["RequestBackend"];
export type RequestSettings = components["schemas"]["RequestSettings"];
export type RequestIntegrationView = components["schemas"]["IntegrationView"];
export type RequestIntegrationInput = components["schemas"]["IntegrationInput"];
export type RequestIntegrationTestResult = components["schemas"]["IntegrationTestResult"];
export type RequestExternalUser = components["schemas"]["ExternalUser"];
export type RequestPullReport = components["schemas"]["PullReport"];
export type RequestOverlay = components["schemas"]["RequestOverlay"];
export type WatchlistEntry = components["schemas"]["WatchlistEntry"];
export type WatchlistResponse = components["schemas"]["WatchlistResponse"];
export type CreatePlaylistRequest = components["schemas"]["CreatePlaylistRequest"];
export type UpdatePlaylistRequest = components["schemas"]["UpdatePlaylistRequest"];
export type PlaylistItemResponse = components["schemas"]["PlaylistItemResponse"];
export type AddPlaylistItemRequest = components["schemas"]["AddPlaylistItemRequest"];
export type ReorderPlaylistItemsRequest = components["schemas"]["ReorderPlaylistItemsRequest"];

/** RFC 6749 §5.2 grant type Playarr Server's `/api/v1/oauth/token` requires for the device flow. */
export const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export interface BrowseCatalogParams {
  kind?: WorkKind;
  /** Return only works that own at least one synced, playable media file. */
  available_only?: boolean;
  /**
   * Restrict to works with at least one synced file from this source
   * instance -- the "library" filter (two source instances of the same
   * kind, e.g. two Radarr instances, browse as separate libraries).
   */
  source_instance_id?: string;
  genre?: string;
  tag?: string;
  /** `"title"` (default), `"date_added"`, or legacy `"recent"`. */
  sort?: string;
  /** `"asc"` or `"desc"`; the server applies this before pagination. */
  order?: string;
  limit?: number;
  offset?: number;
  /** Comma-separated audio languages (codes or English names); OR within the list. */
  audio_lang?: string;
  /** Comma-separated subtitle languages, embedded or sidecar; OR within the list. */
  subtitle_lang?: string;
  /** `"any"` (default) or `"all"` listed languages per filter. */
  lang_match?: string;
  /** `"any_file"` (default) or `"every_file"` for series. */
  lang_scope?: string;
}

export interface PlaybackInfoParams {
  /** Comma-separated container names the client can play, e.g. `"mp4"`. */
  containers?: string;
  /** Comma-separated video codecs the client can play, e.g. `"h264"`. */
  videoCodecs?: string;
  /** Comma-separated audio codecs the client can play; informational only today. */
  audioCodecs?: string;
  maxBitrateBps?: number;
  /** Target rendition profile name if a transcode is needed. */
  profile?: string;
  /** Force the requested rendition instead of direct-playing the source. */
  forceTranscode?: boolean;
  /** Begin a newly-created on-demand transcode at this absolute source timestamp. */
  startPositionMs?: number;
  /** Global ffprobe stream index of the source audio track to encode. */
  audioStreamIndex?: number;
  /** Ignore remembered per-media choices for this explicit request. */
  ignoreSavedPreferences?: boolean;
}

export interface WatchProgressUpdate {
  positionMs: number;
  durationMs: number;
  completed?: boolean;
  /**
   * ISO 8601/RFC3339 timestamp for when this update actually happened, for
   * an offline-buffered update replayed after reconnecting. Omit for a
   * normal live update -- the server falls back to `now()`.
   */
  occurredAt?: string;
}

// ---------------------------------------------------------------------------
// downloads -- offline media downloads. Hand-authored (not sourced from
// `components["schemas"]`): `backend/openapi/playarr.yaml` doesn't carry
// these operations yet at the time this client-side work was written, so
// these types/methods are typed directly off the agreed contract instead of
// waiting on a `pnpm run generate` refresh. Once the spec and generated
// schema catch up, these can be re-pointed at `components["schemas"]` with
// no call-site changes -- the shapes below are written to match exactly.
// ---------------------------------------------------------------------------

export type DownloadStatus =
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "expired"
  | "canceled";

export interface DownloadOption {
  id: string;
  label: string;
  profile: string | null;
  height: number | null;
  /** `null` only ever alongside `size_is_estimate: false` when the source's own `size_bytes` isn't known yet. */
  estimated_size_bytes: number | null;
  /** `false` for `"original"` (a real byte count from `MediaFile.size_bytes`); `true` for a named transcode profile estimated from bitrate * duration. */
  size_is_estimate: boolean;
}

export interface DownloadOptionsResponse {
  media_file_id: string;
  container: string;
  options: DownloadOption[];
}

export interface DownloadTicket {
  id: string;
  media_file_id: string;
  quality_id: string;
  status: DownloadStatus;
  container: string;
  size_bytes: number | null;
  requested_at: string;
  ready_at: string | null;
  expires_at: string | null;
  error_message: string | null;
}

export interface CreateDownloadRequest {
  media_file_id: string;
  quality_id: string;
}

// ---------------------------------------------------------------------------
// admin (http latency metrics) -- per-route request latency percentiles for
// the admin-only "Request latency" diagnostics page. Hand-authored (not
// sourced from `components["schemas"]`), same reason as the `downloads`
// types above: `backend/openapi/playarr.yaml` doesn't carry this operation
// yet at the time this client-side work was written, so this type/method is
// typed directly off the agreed contract instead of waiting on a
// `pnpm run generate` refresh. Once the spec and generated schema catch up,
// this can be re-pointed at `components["schemas"]` with no call-site
// changes -- the shape below is written to match exactly.
// ---------------------------------------------------------------------------

/** Wire shape of one row from `GET /api/v1/admin/metrics/http-latency`. */
interface HttpRouteLatencyResponse {
  method: string;
  route: string;
  sample_count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
}

/**
 * Per-route request latency percentiles, normalized to camelCase for
 * callers. `route` is the Axum route template (e.g. `"/api/v1/catalog/{id}"`),
 * not the raw path with real ids interpolated -- that's what keeps this
 * bounded-cardinality. Rows arrive sorted by `p95Ms` descending; nothing on
 * this client re-sorts them.
 */
export interface HttpRouteLatency {
  method: string;
  route: string;
  sampleCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function toHttpRouteLatency(raw: HttpRouteLatencyResponse): HttpRouteLatency {
  return {
    method: raw.method,
    route: raw.route,
    sampleCount: raw.sample_count,
    avgMs: raw.avg_ms,
    p50Ms: raw.p50_ms,
    p95Ms: raw.p95_ms,
    p99Ms: raw.p99_ms,
    maxMs: raw.max_ms,
  };
}

// ---------------------------------------------------------------------
// release calendar (TASKS 74-77)
//
// Hand-written until `backend/openapi/playarr.yaml` lands on main with the
// calendar schemas; the field names mirror that contract exactly.
// ---------------------------------------------------------------------

export type CalendarMediaKind = "episode" | "movie" | "album" | "book";
export type CalendarReleaseType = "air" | "cinema" | "digital" | "physical" | "release";
export type CalendarSourceState = "ok" | "unreachable" | "rejected" | "error";

export interface CalendarEntrySource {
  source_instance_id: string;
  source_name: string;
  source_kind: string;
  arr_id: number | string;
}

export interface CalendarEntry {
  id: string;
  media_kind: CalendarMediaKind;
  release_type: CalendarReleaseType;
  title: string;
  subtitle?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Exact release instant (ISO 8601) when the source provides one. */
  release_at?: string | null;
  monitored: boolean;
  has_file: boolean;
  poster_url?: string | null;
  work_id?: string | null;
  average_lag_seconds?: number | null;
  sources: CalendarEntrySource[];
  /**
   * Identity of the title for `requestTitle` and `addToWatchlist`; post it back
   * unchanged. Absent on servers that predate server-computed actions and for
   * entries with no external id.
   */
  snapshot?: TitleSnapshot | null;
  /** What the signed-in caller can do with this entry, computed by the server. */
  actions?: CalendarAction[];
  /** Episodes folded into this entry when `group=series_day` was requested. */
  members?: CalendarGroupMember[];
}

export type CalendarActionKind = "open" | "play" | "resume" | "request" | "watchlist";

/** One server-computed action; a disabled one carries a `reason` to show. */
export interface CalendarAction {
  action: CalendarActionKind;
  enabled: boolean;
  reason?: string | null;
  work_id?: string | null;
  media_file_id?: string | null;
  position_ms?: number | null;
  /** `watchlist`: already listed. `request`: already requested. */
  active?: boolean;
}

export interface CalendarGroupMember {
  id: string;
  subtitle?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  monitored: boolean;
  has_file: boolean;
}

export interface CalendarSourceStatus {
  source_instance_id: string;
  name: string;
  kind: string;
  status: CalendarSourceState;
  error?: string | null;
  entry_count: number;
}

export interface CalendarResponse {
  start: string;
  end: string;
  entries: CalendarEntry[];
  sources: CalendarSourceStatus[];
}

export interface CalendarParams {
  /** Inclusive UTC day, `YYYY-MM-DD`. */
  start?: string;
  /** Inclusive UTC day, `YYYY-MM-DD`; at most 92 days after `start`. */
  end?: string;
  kinds?: ReadonlyArray<CalendarMediaKind>;
  sourceInstanceId?: string;
  /** `series_day` folds same-day episodes of a series into one entry with `members`. */
  group?: "series_day";
}

export interface CalendarFeedStatus {
  active: boolean;
  created_at?: string | null;
  last_used_at?: string | null;
  /**
   * `POST /api/v1/calendar/feed` would return the existing link unchanged.
   * Absent on servers that predate re-showable links, where that POST always
   * replaces the link, so callers must not POST unless this is true.
   */
  link_available?: boolean;
}

/** Returned only when a feed token is created or regenerated. */
export interface CalendarFeedCreated {
  url: string;
  token: string;
  created_at: string;
}

export interface AvailabilityLagSample {
  season_number?: number | null;
  episode_number?: number | null;
  air_at: string;
  imported_at: string;
  lag_seconds: number;
}

export interface AvailabilityLag {
  average_seconds: number | null;
  sample_count: number;
  backfill_count: number;
  unknown_count: number;
  backfill_threshold_days: number;
  average_grab_seconds: number | null;
  samples: AvailabilityLagSample[];
}

export function buildCalendarQuery(params: CalendarParams = {}): string {
  const query = new URLSearchParams();
  if (params.start) query.set("start", params.start);
  if (params.end) query.set("end", params.end);
  if (params.kinds && params.kinds.length > 0) query.set("kind", params.kinds.join(","));
  if (params.sourceInstanceId) query.set("source_instance_id", params.sourceInstanceId);
  if (params.group) query.set("group", params.group);
  const text = query.toString();
  return text ? `?${text}` : "";
}

export interface SessionHistoryParams {
  userId?: string;
  /** ISO 8601 datetime, inclusive lower bound on `started_at`. */
  from?: string;
  /** ISO 8601 datetime, inclusive upper bound on `started_at`. */
  to?: string;
  /** Clamped to 500 server-side regardless of what's requested. */
  limit?: number;
  offset?: number;
}

export interface AccessTokenRequest {
  /** Bypass the normal expiry check after the server rejects the current token. */
  forceRefresh?: boolean;
  /**
   * With `forceRefresh`: the access token the server rejected, so the session
   * manager can skip the rotation when that token has already been replaced.
   */
  rejectedAccessToken?: string;
}

export interface ApiClientConfig {
  /** API origin, e.g. "http://localhost:8484" (no trailing slash required). */
  baseUrl: string;
  /**
   * Called before each of the *protected* requests (the admin source-
   * instance create/list/delete/sync calls -- see `PROTECTED_OPERATIONS`
   * below); never called for catalog/playback/login/oauth, which stay
   * unauthenticated. Return undefined to send the request without a token
   * anyway (the server will 401 it).
   */
  getAccessToken?: (
    request?: AccessTokenRequest
  ) => string | undefined | Promise<string | undefined>;
  /** Injectable for tests / non-browser runtimes (webOS/Tizen legacy engines). Defaults to global fetch. */
  fetchImpl?: (input: Request) => Promise<Response>;
  defaultHeaders?: Record<string, string>;
}

/** Thrown for any non-2xx response. Carries the parsed (typed, where the spec defines a body) error payload. */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;

  constructor(status: number, statusText: string, body: unknown) {
    super(`API request failed: ${status} ${statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
 * Operations the auth middleware actually guards -- `Authorization: Bearer
 * <token>` is attached to exactly these, identified by the same
 * `schemaPath` (the OpenAPI path template, curly braces and all)
 * `openapi-fetch` passes its middleware, paired with the HTTP method. The
 * `/api/v1/admin/*` operations are admin-only (403 for a non-admin caller
 * -- see backend/crates/playarr-api/src/admin.rs); the catalog/playback
 * operations are streaming-only (403 for a caller without `can_stream` --
 * see `auth_extractor.rs`'s `StreamingUser`). Both still 401 with no/an
 * invalid token.
 */
const PROTECTED_OPERATIONS: ReadonlyArray<{ schemaPath: string; method: string }> = [
  { schemaPath: "/api/v1/admin/playback/activity/active", method: "GET" },
  { schemaPath: "/api/v1/admin/playback/activity/facets", method: "GET" },
  { schemaPath: "/api/v1/admin/playback/activity/history", method: "POST" },
  { schemaPath: "/api/v1/admin/playback/sessions/active", method: "GET" },
  { schemaPath: "/api/v1/admin/playback/sessions/history", method: "GET" },
  { schemaPath: "/api/v1/admin/playback/sessions/{session_id}/stop", method: "POST" },
  { schemaPath: "/api/v1/admin/source-instances", method: "POST" },
  { schemaPath: "/api/v1/admin/source-instances", method: "GET" },
  { schemaPath: "/api/v1/admin/source-instances/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/admin/source-instances/{id}/folder-mappings", method: "PUT" },
  { schemaPath: "/api/v1/admin/source-instances/{id}/sync", method: "POST" },
  { schemaPath: "/api/v1/admin/source-instances/sync-status", method: "GET" },
  { schemaPath: "/api/v1/admin/library/source-matrix", method: "GET" },
  { schemaPath: "/api/v1/admin/system-settings", method: "GET" },
  { schemaPath: "/api/v1/admin/system-settings", method: "PUT" },
  { schemaPath: "/api/v1/admin/system/capabilities", method: "GET" },
  { schemaPath: "/api/v1/admin/backups", method: "GET" },
  { schemaPath: "/api/v1/admin/backups", method: "POST" },
  { schemaPath: "/api/v1/admin/backups/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/admin/backups/{id}/download", method: "GET" },
  { schemaPath: "/api/v1/admin/backups/{id}/verify", method: "POST" },
  { schemaPath: "/api/v1/admin/peer-groups", method: "POST" },
  { schemaPath: "/api/v1/admin/peer-groups/join", method: "POST" },
  { schemaPath: "/api/v1/admin/peer-groups/self", method: "DELETE" },
  { schemaPath: "/api/v1/admin/peer-groups/join-tokens", method: "POST" },
  { schemaPath: "/api/v1/admin/peer-groups/self/address-bundle", method: "GET" },
  { schemaPath: "/api/v1/admin/peer-nodes", method: "GET" },
  { schemaPath: "/api/v1/admin/peer-nodes/self", method: "PUT" },
  { schemaPath: "/api/v1/admin/peer-nodes/{id}/sync-status", method: "GET" },
  { schemaPath: "/api/v1/admin/tdarr", method: "POST" },
  { schemaPath: "/api/v1/admin/tdarr", method: "GET" },
  { schemaPath: "/api/v1/admin/tdarr", method: "DELETE" },
  { schemaPath: "/api/v1/admin/users", method: "POST" },
  { schemaPath: "/api/v1/admin/users", method: "GET" },
  { schemaPath: "/api/v1/admin/user-invites", method: "POST" },
  { schemaPath: "/api/v1/admin/user-invite-requests", method: "GET" },
  { schemaPath: "/api/v1/admin/user-invite-requests/{id}", method: "PATCH" },
  { schemaPath: "/api/v1/users/me/user-invite-request", method: "GET" },
  { schemaPath: "/api/v1/users/me/user-invite-request", method: "POST" },
  { schemaPath: "/api/v1/users/me/user-invite-request/generate", method: "POST" },
  { schemaPath: "/api/v1/notifications/config", method: "GET" },
  { schemaPath: "/api/v1/users/me/push-registrations", method: "POST" },
  { schemaPath: "/api/v1/admin/users/{id}", method: "PATCH" },
  { schemaPath: "/api/v1/admin/users/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/users/me/player-preferences", method: "GET" },
  { schemaPath: "/api/v1/users/me/player-preferences", method: "PATCH" },
  { schemaPath: "/api/v1/users/me/capabilities", method: "GET" },
  { schemaPath: "/api/v1/users/me/profile-avatar", method: "GET" },
  { schemaPath: "/api/v1/users/me/profile-avatar", method: "PUT" },
  { schemaPath: "/api/v1/users/me/profile-pin", method: "GET" },
  { schemaPath: "/api/v1/users/me/profile-pin", method: "PATCH" },
  { schemaPath: "/api/v1/users/profiles", method: "GET" },
  { schemaPath: "/api/v1/users/profiles/{id}/verify-pin", method: "POST" },
  { schemaPath: "/api/v1/auth/lock", method: "POST" },
  { schemaPath: "/api/v1/oauth/device/authorize", method: "POST" },
  { schemaPath: "/api/v1/household/status", method: "GET" },
  { schemaPath: "/api/v1/household/approvals", method: "GET" },
  { schemaPath: "/api/v1/household/approvals", method: "POST" },
  { schemaPath: "/api/v1/household/approvals/{id}/decision", method: "POST" },
  { schemaPath: "/api/v1/household/approvals/{id}/consume", method: "POST" },
  { schemaPath: "/api/v1/admin/users/{id}/household", method: "GET" },
  { schemaPath: "/api/v1/admin/users/{id}/household", method: "PUT" },
  { schemaPath: "/api/v1/folders/roots", method: "GET" },
  { schemaPath: "/api/v1/folders/roots/{root_id}/browse", method: "GET" },
  { schemaPath: "/api/v1/admin/folders/roots", method: "GET" },
  { schemaPath: "/api/v1/admin/folders/roots", method: "POST" },
  { schemaPath: "/api/v1/admin/folders/roots/{root_id}", method: "PATCH" },
  { schemaPath: "/api/v1/admin/folders/roots/{root_id}", method: "DELETE" },
  { schemaPath: "/api/v1/admin/folders/roots/{root_id}/scan", method: "POST" },
  { schemaPath: "/api/v1/admin/folders/discover", method: "POST" },
  { schemaPath: "/api/v1/catalog", method: "GET" },
  { schemaPath: "/api/v1/catalog/kinds", method: "GET" },
  { schemaPath: "/api/v1/catalog/{id}", method: "GET" },
  { schemaPath: "/api/v1/catalog/{id}/credits", method: "GET" },
  { schemaPath: "/api/v1/catalog/{id}/similar", method: "GET" },
  { schemaPath: "/api/v1/catalog/search", method: "GET" },
  { schemaPath: "/api/v1/catalog/languages", method: "GET" },
  {
    schemaPath: "/api/v1/artwork/album/{artist_work_id}/{album_id}/{kind}",
    method: "GET",
  },
  {
    schemaPath: "/api/v1/artwork/episode/{series_work_id}/{episode_id}/{kind}",
    method: "GET",
  },
  { schemaPath: "/api/v1/artwork/work/{work_id}/{kind}", method: "GET" },
  { schemaPath: "/api/v1/artwork/person/{person_id}", method: "GET" },
  { schemaPath: "/api/v1/media/{media_file_id}/chapters", method: "GET" },
  { schemaPath: "/api/v1/media/{media_file_id}/metadata", method: "GET" },
  {
    schemaPath: "/api/v1/media/{media_file_id}/playback-options",
    method: "GET",
  },
  {
    schemaPath: "/api/v1/media/{media_file_id}/playback-options",
    method: "PATCH",
  },
  {
    schemaPath: "/api/v1/media/{media_file_id}/subtitles/{stream_index}",
    method: "GET",
  },
  { schemaPath: "/api/v1/media/{media_file_id}/thumbnail", method: "GET" },
  { schemaPath: "/api/v1/playback/{media_file_id}", method: "GET" },
  { schemaPath: "/api/v1/playback/sessions/{session_id}/events", method: "POST" },
  { schemaPath: "/api/v1/playback/sessions/{session_id}/health", method: "POST" },
  { schemaPath: "/api/v1/playback/connection-test", method: "GET" },
  { schemaPath: "/api/v1/playback/progress", method: "GET" },
  { schemaPath: "/api/v1/playback/resume-plans", method: "GET" },
  { schemaPath: "/api/v1/catalog/{id}/resume-plan", method: "GET" },
  { schemaPath: "/api/v1/catalog/{id}/resume-plan/choice", method: "POST" },
  { schemaPath: "/api/v1/catalog/{id}/resume-plan/choices", method: "DELETE" },
  { schemaPath: "/api/v1/playback/{media_file_id}/progress", method: "GET" },
  { schemaPath: "/api/v1/playback/{media_file_id}/progress", method: "PUT" },
  { schemaPath: "/api/v1/admin/views", method: "POST" },
  { schemaPath: "/api/v1/admin/views", method: "GET" },
  { schemaPath: "/api/v1/admin/views/{id}", method: "PUT" },
  { schemaPath: "/api/v1/admin/views/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/views", method: "GET" },
  { schemaPath: "/api/v1/views/{id}/resolve", method: "GET" },
  { schemaPath: "/api/v1/home/rails", method: "GET" },
  { schemaPath: "/api/v1/home/rails/preferences", method: "GET" },
  { schemaPath: "/api/v1/home/rails/preferences", method: "PUT" },
  { schemaPath: "/api/v1/home/rails/preferences", method: "DELETE" },
  { schemaPath: "/api/v1/admin/home-rails", method: "GET" },
  { schemaPath: "/api/v1/admin/home-rails", method: "POST" },
  { schemaPath: "/api/v1/admin/home-rails/{id}", method: "PUT" },
  { schemaPath: "/api/v1/admin/home-rails/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/admin/home-rails/order", method: "PUT" },
  { schemaPath: "/api/v1/discover", method: "GET" },
  { schemaPath: "/api/v1/discover/resolve", method: "POST" },
  { schemaPath: "/api/v1/discover/request", method: "POST" },
  { schemaPath: "/api/v1/requests", method: "GET" },
  { schemaPath: "/api/v1/requests/webhook/{integration_id}", method: "POST" },
  { schemaPath: "/api/v1/admin/requests/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/admin/requests/{id}/decision", method: "POST" },
  { schemaPath: "/api/v1/admin/request-integrations", method: "GET" },
  { schemaPath: "/api/v1/admin/request-integrations", method: "POST" },
  { schemaPath: "/api/v1/admin/request-integrations/{id}", method: "PUT" },
  { schemaPath: "/api/v1/admin/request-integrations/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/admin/request-integrations/{id}/test", method: "POST" },
  { schemaPath: "/api/v1/admin/request-integrations/{id}/users", method: "GET" },
  { schemaPath: "/api/v1/admin/request-integrations/{id}/sync", method: "POST" },
  { schemaPath: "/api/v1/admin/request-settings", method: "GET" },
  { schemaPath: "/api/v1/admin/request-settings", method: "PUT" },
  { schemaPath: "/api/v1/watchlist", method: "GET" },
  { schemaPath: "/api/v1/watchlist", method: "POST" },
  { schemaPath: "/api/v1/watchlist/{title_key}", method: "DELETE" },
  { schemaPath: "/api/v1/playlists", method: "GET" },
  { schemaPath: "/api/v1/playlists", method: "POST" },
  { schemaPath: "/api/v1/admin/playlists", method: "GET" },
  { schemaPath: "/api/v1/playlists/{id}", method: "GET" },
  { schemaPath: "/api/v1/playlists/{id}", method: "PUT" },
  { schemaPath: "/api/v1/playlists/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/playlists/{id}/items", method: "GET" },
  { schemaPath: "/api/v1/playlists/{id}/items", method: "POST" },
  { schemaPath: "/api/v1/playlists/{id}/items/{item_id}", method: "DELETE" },
  { schemaPath: "/api/v1/playlists/{id}/items/order", method: "PUT" },
  { schemaPath: "/api/v1/openapi.json", method: "GET" },
  { schemaPath: "/api/v1/admin/users/{user_id}/impersonate", method: "POST" },
];

function bearerOf(request: Request): string | undefined {
  const header = request.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

function isProtectedOperation(schemaPath: string, method: string): boolean {
  return PROTECTED_OPERATIONS.some((op) => op.schemaPath === schemaPath && op.method === method);
}

/** Why the server refused a request for household/child-control reasons. */
export type HouseholdBlockReason =
  | "outside_schedule"
  | "budget_exhausted"
  | "rating_too_high"
  | "unrated"
  | "tag_blocked"
  | "folder_blocked";

export interface HouseholdBlock {
  reason: HouseholdBlockReason;
  /** Start of the next allowed window (`outside_schedule`). */
  nextStartAt?: string;
  /** When the daily budget resets (`budget_exhausted`). */
  resetsAt?: string;
}

interface ErrorBodyLike {
  error?: unknown;
  message?: unknown;
  details?: { reason?: unknown; next_start_at?: unknown; resets_at?: unknown; retry_after_seconds?: unknown };
}

/**
 * The household block carried by a `403 household_blocked`, or `null` for
 * any other error. Clients use it to show a "not available right now"
 * state instead of a generic permission error.
 */
export function parseHouseholdBlock(err: unknown): HouseholdBlock | null {
  if (!(err instanceof ApiError) || err.status !== 403) return null;
  const body = err.body as ErrorBodyLike | undefined;
  if (body?.error !== "household_blocked") return null;
  const reason = body.details?.reason;
  if (typeof reason !== "string") return null;
  return {
    reason: reason as HouseholdBlockReason,
    nextStartAt:
      typeof body.details?.next_start_at === "string" ? body.details.next_start_at : undefined,
    resetsAt: typeof body.details?.resets_at === "string" ? body.details.resets_at : undefined,
  };
}

/** Seconds until a `429 pin_locked` lifts, or `null` for any other error. */
export function parsePinLockSeconds(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  const body = err.body as ErrorBodyLike | undefined;
  if (body?.error !== "pin_locked") return null;
  const seconds = body.details?.retry_after_seconds;
  return typeof seconds === "number" ? seconds : 60;
}

function describeHouseholdError(err: ApiError): string | null {
  const block = parseHouseholdBlock(err);
  if (block) {
    switch (block.reason) {
      case "outside_schedule":
        return block.nextStartAt
          ? `Not available right now. Back at ${new Date(block.nextStartAt).toLocaleString()}.`
          : "Not available right now.";
      case "budget_exhausted":
        return block.resetsAt
          ? `Today's watch time is used up. It resets at ${new Date(block.resetsAt).toLocaleString()}.`
          : "Today's watch time is used up.";
      default:
        return "This title is not available for this profile.";
    }
  }
  const lock = parsePinLockSeconds(err);
  if (lock !== null) {
    const minutes = Math.max(1, Math.ceil(lock / 60));
    return `Too many incorrect PIN attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return null;
}

/**
 * Human-readable summary of a caught error, distinguishing the two auth-
 * specific statuses `PROTECTED_OPERATIONS` can return (401 missing/invalid
 * token, 403 authenticated-but-lacking-the-required-grant) from every other
 * failure, so callers can surface a real, specific message instead of a
 * generic "something went wrong". A 403's body always carries a real,
 * specific `message` (see `backend/crates/playarr-api/src/error.rs`'s
 * `ErrorBody` -- every `ApiError::new`/`forbidden()` call sets one), so
 * that's preferred over a generic fallback whenever it's present.
 */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    const household = describeHouseholdError(err);
    if (household) return household;
    if (err.status === 401) return "Sign-in required -- could not obtain a valid access token.";
    if (err.status === 403) {
      const body = err.body as { message?: unknown } | undefined;
      if (typeof body?.message === "string" && body.message.length > 0) {
        return body.message;
      }
      return "You do not have permission to do this.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Typed client for the Playarr Server API, backed by `openapi-fetch` +
 * generated `paths`/`components` types. Every method below is a thin,
 * faithful wrapper over one spec operation -- no field renaming beyond
 * grouping loose query params into an object, so the shapes here always
 * match `backend/openapi/playarr.yaml` exactly.
 */
/** The runtime cannot stream a response body; use long polling instead. */
export class PushUnsupportedError extends Error {
  constructor() {
    super("response streaming is not supported here");
    this.name = "PushUnsupportedError";
  }
}

/** Minimal server-sent-events frame parser (`event`, `data`; ids and comments are ignored). */
export class SseParser {
  private buffer = "";

  push(chunk: string): Array<{ event: string; data: string }> {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const frames: Array<{ event: string; data: string }> = [];
    for (;;) {
      const end = this.buffer.indexOf("\n\n");
      if (end < 0) break;
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length > 0 || event !== "message") frames.push({ event, data: data.join("\n") });
    }
    return frames;
  }
}

/**
 * Optional artwork sizing. `width` is the longest useful width in pixels (the server snaps it up
 * to a fixed set and never upscales); `version` is an opaque token derived from the artwork's
 * source, which makes the URL content-addressed so the response may be cached as immutable.
 */
export interface ArtworkSize {
  width?: number;
  version?: string;
}

export class ApiClient {
  /** The underlying `openapi-fetch` client, for operations without a convenience method above. */
  readonly raw: Client<paths>;
  private readonly baseUrl: string;
  private readonly accessTokenProvider: ApiClientConfig["getAccessToken"];
  private readonly rawFetch: (input: Request) => Promise<Response>;
  private readonly retryBodies = new WeakMap<Request, Request>();
  /**
   * Stale-while-revalidate cache and request de-duplication for this client's session. Off until
   * the owner of the client names the signed-in account with `queries.setScope(...)`; see
   * `queryCache.ts` for the privacy rules.
   */
  readonly queries = new QueryCache();

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl;
    this.accessTokenProvider = config.getAccessToken;
    this.rawFetch = config.fetchImpl ?? ((input: Request) => fetch(input));
    this.raw = createFetchClient<paths>({
      baseUrl: config.baseUrl,
      fetch: config.fetchImpl,
      headers: config.defaultHeaders,
    });

    const authMiddleware: Middleware = {
      onRequest: async ({ request, schemaPath }) => {
        if (!isProtectedOperation(schemaPath, request.method)) return request;
        const token = await this.getAccessToken();
        if (token) {
          request.headers.set("Authorization", `Bearer ${token}`);
          // A body can only be sent once; keep a copy so a 401 can be retried.
          if (request.body !== null) this.retryBodies.set(request, request.clone());
        }
        return request;
      },
      onResponse: async ({ request, response }) => {
        if (request.method !== "GET" && request.method !== "HEAD" && response.ok) {
          this.invalidateForWrite(new URL(request.url).pathname);
        }
        if (response.status !== 401) return undefined;
        const sent = bearerOf(request);
        if (!sent) return undefined;
        const replay = this.retryBodies.get(request) ?? request;
        this.retryBodies.delete(request);
        const fresh = await this.renewRejectedToken(sent);
        if (!fresh) return undefined;
        const headers = new Headers(replay.headers);
        headers.set("Authorization", `Bearer ${fresh}`);
        return this.rawFetch(new Request(replay, { headers }));
      },
    };
    this.raw.use(authMiddleware);
  }

  /** A write succeeded: forget the stored reads it makes stale (see `tagsForMutation`). */
  private invalidateForWrite(path: string): void {
    const tags = tagsForMutation(path);
    if (tags === undefined || tags.length > 0) this.queries.invalidate(tags);
  }

  /**
   * Resolves a valid access token through this client's configured session
   * manager. Playback engines use this same path before media requests so
   * API and streaming traffic cannot drift onto different token lifecycles.
   */
  async getAccessToken(request?: AccessTokenRequest): Promise<string | undefined> {
    return this.accessTokenProvider?.(request);
  }

  /**
   * The server answered 401 to `rejected`: ask the session manager for a
   * replacement once. Resolves to a *different* token or `undefined` (nothing
   * better available, including when renewal fails transiently -- the 401 is
   * then surfaced as-is and the stored session is left alone).
   */
  private async renewRejectedToken(rejected: string): Promise<string | undefined> {
    try {
      const fresh = await this.getAccessToken({ forceRefresh: true, rejectedAccessToken: rejected });
      return fresh && fresh !== rejected ? fresh : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Sends `build(token)` and, when the server rejects the bearer token with
   * 401, renews it once (single-flight in the session manager) and resends.
   */
  private async sendWithReauth(build: (token: string | undefined) => Request): Promise<Response> {
    const token = await this.getAccessToken();
    const response = await this.rawFetch(build(token));
    if (response.status !== 401 || !token) return response;
    const fresh = await this.renewRejectedToken(token);
    if (!fresh) return response;
    void response.body?.cancel().catch(() => undefined);
    return this.rawFetch(build(fresh));
  }

  /** Resolves a (possibly origin-relative) URL the server returned against this client's baseUrl. */
  resolveUrl(maybeRelativeUrl: string): string {
    return new URL(maybeRelativeUrl, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`).toString();
  }

  private assertOk<E>(result: { error?: E; response: Response }): void {
    if (!result.response.ok) {
      throw new ApiError(result.response.status, result.response.statusText, result.error);
    }
  }

  private unwrap<T, E>(result: { data?: T; error?: E; response: Response }): T {
    this.assertOk(result);
    return result.data as T;
  }

  /**
   * Manual typed-JSON request for an operation not (yet) present in the
   * generated `paths` type -- see the `downloads` section below. Attaches
   * the same bearer-token auth every `PROTECTED_OPERATIONS` request gets
   * from `authMiddleware`, just without going through `openapi-fetch`'s
   * `paths`-typed `raw` client.
   */
  private async requestJson<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    const response = await this.sendWithReauth((token) => {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      return new Request(this.resolveUrl(path), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    });
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = undefined;
      }
      throw new ApiError(response.status, response.statusText, errorBody);
    }
    if (method !== "GET") this.invalidateForWrite(path.split("?")[0] ?? path);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }


  /**
   * Opens the per-account live event stream (`GET /api/v1/events`). Returns the raw
   * response so the caller can read `response.body`; `EventSource` cannot send the
   * bearer header, hence fetch. Never throws on a non-2xx status: the caller decides
   * whether that means "unsupported" (older server) or "retry".
   */
  async openEventStream(options: { lastEventId?: string; signal?: AbortSignal } = {}): Promise<Response> {
    // An expired or server-rejected access token is renewed (once, silently)
    // before the stream is reported as failed.
    return this.sendWithReauth((token) => {
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (options.lastEventId) headers["Last-Event-ID"] = options.lastEventId;
      return new Request(this.resolveUrl("/api/v1/events"), { method: "GET", headers, signal: options.signal });
    });
  }

  /** Request with a raw (binary) body or response; same bearer auth as `requestJson`. */
  private async requestRaw(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Blob | ArrayBuffer
  ): Promise<Response> {
    const response = await this.sendWithReauth((token) => {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/zip";
      return new Request(this.resolveUrl(path), { method, headers, body });
    });
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = undefined;
      }
      throw new ApiError(response.status, response.statusText, errorBody);
    }
    return response;
  }

  // ---------------------------------------------------------------------
  // portable user data (the signed-in account's own data only)
  // ---------------------------------------------------------------------

  /** Starts (or returns the unfinished) export of the caller's own data. */
  async startUserDataExport(): Promise<UserDataExportJob> {
    return this.requestJson("POST", "/api/v1/users/me/data-exports");
  }

  async listUserDataExports(): Promise<UserDataExportList> {
    return this.requestJson("GET", "/api/v1/users/me/data-exports");
  }

  async getUserDataExport(id: string): Promise<UserDataExportJob> {
    return this.requestJson("GET", `/api/v1/users/me/data-exports/${encodeURIComponent(id)}`);
  }

  async deleteUserDataExport(id: string): Promise<void> {
    await this.requestJson("DELETE", `/api/v1/users/me/data-exports/${encodeURIComponent(id)}`);
  }

  /** Downloads a ready export package. */
  async downloadUserDataExport(id: string): Promise<Blob> {
    const response = await this.requestRaw(
      "GET",
      `/api/v1/users/me/data-exports/${encodeURIComponent(id)}/download`
    );
    return response.blob();
  }

  /** A one-time link to download a ready export on another device. */
  async createUserDataTransferLink(exportId: string): Promise<UserDataTransferLink> {
    return this.requestJson(
      "POST",
      `/api/v1/users/me/data-exports/${encodeURIComponent(exportId)}/transfer-link`
    );
  }

  /** Opens an import session whose one-time upload link another device uses. */
  async createUserDataImportSession(): Promise<UserDataImportSession> {
    return this.requestJson("POST", "/api/v1/users/me/data-import-sessions");
  }

  async getUserDataImportSession(id: string): Promise<UserDataImportSession> {
    return this.requestJson("GET", `/api/v1/users/me/data-import-sessions/${encodeURIComponent(id)}`);
  }

  async deleteUserDataImportSession(id: string): Promise<void> {
    await this.requestJson("DELETE", `/api/v1/users/me/data-import-sessions/${encodeURIComponent(id)}`);
  }

  /** Previews the package uploaded to a session; nothing is written. */
  async previewUserDataImportSession(
    id: string,
    options: UserDataImportOptions = {}
  ): Promise<UserDataImportPreview> {
    const response = await this.requestRaw(
      "POST",
      `/api/v1/users/me/data-import-sessions/${encodeURIComponent(id)}/preview?${this.importQuery(options)}`
    );
    return (await response.json()) as UserDataImportPreview;
  }

  /** Applies the previewed package of a session (bound by its SHA-256). */
  async applyUserDataImportSession(
    id: string,
    packageSha256: string,
    options: UserDataImportOptions = {}
  ): Promise<UserDataImportResult> {
    const query = new URLSearchParams(this.importQuery(options));
    query.set("package_sha256", packageSha256);
    const response = await this.requestRaw(
      "POST",
      `/api/v1/users/me/data-import-sessions/${encodeURIComponent(id)}/apply?${query.toString()}`
    );
    return (await response.json()) as UserDataImportResult;
  }

  private importQuery(options: UserDataImportOptions): string {
    const query = new URLSearchParams();
    if (options.includePreferences) query.set("include_preferences", "true");
    if (options.progressConflicts) query.set("progress_conflicts", options.progressConflicts);
    return query.toString();
  }

  /** Validates and matches a package without writing anything. */
  async previewUserDataImport(
    file: Blob,
    options: UserDataImportOptions = {}
  ): Promise<UserDataImportPreview> {
    const response = await this.requestRaw(
      "POST",
      `/api/v1/users/me/data-imports/preview?${this.importQuery(options)}`,
      file
    );
    return (await response.json()) as UserDataImportPreview;
  }

  /** Applies the exact package that was previewed (bound by its SHA-256). */
  async applyUserDataImport(
    file: Blob,
    packageSha256: string,
    options: UserDataImportOptions = {}
  ): Promise<UserDataImportResult> {
    const query = new URLSearchParams(this.importQuery(options));
    query.set("package_sha256", packageSha256);
    const response = await this.requestRaw(
      "POST",
      `/api/v1/users/me/data-imports?${query.toString()}`,
      file
    );
    return (await response.json()) as UserDataImportResult;
  }

  /** A package of everything the importer could not place, valid for a later import. */
  async downloadUnmatchedUserData(
    file: Blob,
    options: UserDataImportOptions = {}
  ): Promise<Blob> {
    const response = await this.requestRaw(
      "POST",
      `/api/v1/users/me/data-imports/unmatched?${this.importQuery(options)}`,
      file
    );
    return response.blob();
  }

  // ---------------------------------------------------------------------
  // system
  // ---------------------------------------------------------------------

  async getHealth(): Promise<void> {
    this.assertOk(await this.raw.GET("/api/system/health"));
  }

  async getReady(): Promise<void> {
    this.assertOk(await this.raw.GET("/api/system/ready"));
  }

  async getVersion(): Promise<VersionEnvelope> {
    return this.unwrap(await this.raw.GET("/api/system/version"));
  }

  async getSystemSettings(): Promise<SystemSettings> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/system-settings"));
  }

  /** `GET /api/v1/admin/system/capabilities`; `refresh` bypasses the server's short probe cache. */
  async getSystemCapabilities(options: { refresh?: boolean } = {}): Promise<CapabilitiesResponse> {
    return this.unwrap(
      await this.raw.GET("/api/v1/admin/system/capabilities", {
        params: { query: { refresh: options.refresh ?? false } },
      })
    );
  }

  /** `GET /api/v1/admin/backups`: configuration, current run, history and failures. */
  async getBackups(): Promise<BackupOverview> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/backups"));
  }

  /** `POST /api/v1/admin/backups`: starts a run in the background (409 if one is active). */
  async startBackup(): Promise<StartedBackup> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/backups"));
  }

  async verifyBackup(id: string): Promise<BackupVerification> {
    return this.unwrap(
      await this.raw.POST("/api/v1/admin/backups/{id}/verify", { params: { path: { id } } })
    );
  }

  async deleteBackup(id: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/admin/backups/{id}", { params: { path: { id } } })
    );
  }

  /** Downloads the encrypted archive as a Blob (the recovery key is needed to read it). */
  async downloadBackup(id: string): Promise<Blob> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.rawFetch(
      new Request(this.resolveUrl(`/api/v1/admin/backups/${encodeURIComponent(id)}/download`), {
        headers,
      })
    );
    if (!response.ok) throw new ApiError(response.status, response.statusText, undefined);
    return response.blob();
  }

  async updateSystemSettings(body: UpdateSystemSettingsRequest): Promise<SystemSettings> {
    return this.unwrap(await this.raw.PUT("/api/v1/admin/system-settings", { body }));
  }

  // ---------------------------------------------------------------------
  // auth
  // ---------------------------------------------------------------------

  /**
   * `POST /api/v1/auth/login`. In the default `AuthMode::TrustedNetwork`
   * server config, a call from a trusted source IP succeeds with no
   * credentials at all -- `username`/`password`/`pin`/`profile_user_id` are
   * only consulted under the other auth tiers (`FullAccount`/`ManagedProfiles`
   * respectively). Unauthenticated itself -- not one of `PROTECTED_OPERATIONS`.
   */
  async login(body: LoginRequest): Promise<LoginResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/auth/login", { body }));
  }

  /** Redeems an administrator-issued, one-use invitation into a Playarr account. */
  async signup(body: SignupRequest): Promise<UserResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/auth/signup", { body }));
  }

  /**
   * `POST /api/v1/auth/refresh` -- redeems a still-valid refresh token for
   * a fresh access token, without re-presenting credentials. The refresh
   * token itself is rotated (a new one comes back in the response) --
   * callers must persist the new one and stop using the old one, or the
   * next redemption is treated as reuse and the whole token family is
   * revoked server-side (see `backend/crates/playarr-api/src/refresh.rs`).
   * Unauthenticated itself -- not one of `PROTECTED_OPERATIONS`.
   */
  async refresh(body: RefreshRequest): Promise<RefreshResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/auth/refresh", { body }));
  }

  /**
   * `POST /api/v1/auth/unlock` -- presents a stored refresh token together
   * with the profile PIN. On success the server holds a device-bound unlock
   * lease for that profile and returns a rotated token pair. A PIN-locked
   * profile's refresh token cannot be redeemed through `refresh` without
   * such a lease (`403 pin_required`).
   */
  async unlockProfile(body: UnlockRequest): Promise<RefreshResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/auth/unlock", { body }));
  }

  /**
   * `POST /api/v1/auth/lock` -- clears this device's unlock lease for the
   * signed-in profile, so its stored refresh token needs the PIN again.
   */
  async lockProfile(): Promise<void> {
    await this.unwrap(await this.raw.POST("/api/v1/auth/lock", {}));
  }

  // ---------------------------------------------------------------------
  // oauth (RFC 8628 device authorization grant)
  // ---------------------------------------------------------------------

  async requestDeviceCode(body: DeviceCodeRequest): Promise<DeviceCodeResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/oauth/device/code", { body }));
  }

  /** Approves the TV code as the currently authenticated Playarr user. */
  async authorizeDevice(body: DeviceAuthorizationRequest): Promise<void> {
    this.assertOk(await this.raw.POST("/api/v1/oauth/device/authorize", { body }));
  }

  async requestDeviceToken(
    body: DeviceTokenRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<TokenResponse> {
    return this.unwrap(
      await this.raw.POST("/api/v1/oauth/token", {
        body,
        signal: options.signal,
      })
    );
  }

  // ---------------------------------------------------------------------
  // webhooks (*arr -> Playarr Server; not called by any first-party client UI,
  // included for completeness/spec coverage)
  // ---------------------------------------------------------------------

  async postWebhook(instanceId: string, payload: unknown): Promise<void> {
    this.assertOk(
      await this.raw.POST("/webhooks/{instance_id}", {
        params: { path: { instance_id: instanceId } },
        body: payload,
      })
    );
  }

  // ---------------------------------------------------------------------
  // catalog
  // ---------------------------------------------------------------------

  async browseCatalog(params: BrowseCatalogParams = {}): Promise<CatalogPage> {
    return this.unwrap(
      await this.raw.GET("/api/v1/catalog", {
        params: {
          query: {
            kind: params.kind,
            available_only: params.available_only,
            source_instance_id: params.source_instance_id,
            genre: params.genre,
            tag: params.tag,
            sort: params.sort,
            order: params.order,
            limit: params.limit,
            offset: params.offset,
            audio_lang: params.audio_lang,
            subtitle_lang: params.subtitle_lang,
            lang_match: params.lang_match,
            lang_scope: params.lang_scope,
          },
        },
      })
    );
  }

  /** Available audio and subtitle languages (with work counts) for the same filters as `browseCatalog`. */
  async catalogLanguages(params: BrowseCatalogParams = {}): Promise<LanguageFacets> {
    return this.unwrap(
      await this.raw.GET("/api/v1/catalog/languages", {
        params: {
          query: {
            kind: params.kind,
            available_only: params.available_only,
            source_instance_id: params.source_instance_id,
            genre: params.genre,
            tag: params.tag,
            audio_lang: params.audio_lang,
            subtitle_lang: params.subtitle_lang,
            lang_match: params.lang_match,
            lang_scope: params.lang_scope,
          },
        },
      })
    );
  }

  async listCatalogKinds(): Promise<WorkKind[]> {
    return this.unwrap(await this.raw.GET("/api/v1/catalog/kinds"));
  }

  /**
   * `/api/v1/catalog/search`'s real wire response is `{items, remote_only}`
   * (`SearchResponse` -- the partial-cache-node `RemoteOnlyWork` union,
   * `docs/architecture/peer-groups.md` §4.3), not a bare array; this method
   * still returns just `items` to preserve every existing caller's
   * `Work[]` contract unchanged. Surfacing `remote_only` in search results
   * is separate UI work, not part of this endpoint's client wrapper.
   */
  async searchCatalog(q: string, limit?: number, options: { availableOnly?: boolean } = {}): Promise<Work[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/catalog/search", {
        params: { query: { q, limit, available_only: options.availableOnly } },
      })
    ).items;
  }

  /** Root folders the caller may browse (path-free), optionally for one library kind. */
  async listFolderRoots(kind?: WorkKind): Promise<FolderRoot[]> {
    return this.unwrap(await this.raw.GET("/api/v1/folders/roots", { params: { query: { kind } } }))
      .roots;
  }

  /** One directory level of a folder root: sub-directories first, then media files. */
  async browseFolder(rootId: string, params: BrowseFolderParams = {}): Promise<FolderBrowseResponse> {
    return this.unwrap(
      await this.raw.GET("/api/v1/folders/roots/{root_id}/browse", {
        params: {
          path: { root_id: rootId },
          query: {
            path: params.path || undefined,
            q: params.q || undefined,
            sort: params.sort,
            order: params.order,
            type: params.type,
            limit: params.limit,
            offset: params.offset,
          },
        },
      })
    );
  }

  /** Admin: every root with its scan configuration and state. */
  async listAdminFolderRoots(): Promise<AdminFolderRoots> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/folders/roots", {}));
  }

  /** Admin: re-read root folders from every media-owning source. */
  async discoverFolderRoots(): Promise<AdminFolderRoots> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/folders/discover", {}));
  }

  async createFolderRoot(body: CreateFolderRootRequest): Promise<AdminFolderRoot> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/folders/roots", { body }));
  }

  async updateFolderRoot(rootId: string, body: UpdateFolderRootRequest): Promise<AdminFolderRoot> {
    return this.unwrap(
      await this.raw.PATCH("/api/v1/admin/folders/roots/{root_id}", {
        params: { path: { root_id: rootId } },
        body,
      })
    );
  }

  async deleteFolderRoot(rootId: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/admin/folders/roots/{root_id}", {
        params: { path: { root_id: rootId } },
      })
    );
  }

  async scanFolderRoot(rootId: string): Promise<FolderScanSummary> {
    return this.unwrap(
      await this.raw.POST("/api/v1/admin/folders/roots/{root_id}/scan", {
        params: { path: { root_id: rootId } },
      })
    );
  }

  /**
   * One work's detail. `signal` cancels the request (a card the remote has already left); `priority` is the
   * browser's fetch priority hint, so the focused card's detail is not queued behind background loads.
   */
  async getWork(id: string, options: { signal?: AbortSignal; priority?: "high" | "low" | "auto" } = {}): Promise<WorkDetail> {
    return this.unwrap(
      await this.raw.GET("/api/v1/catalog/{id}", {
        params: { path: { id } },
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.priority ? ({ priority: options.priority } as Record<string, unknown>) : {}),
      })
    );
  }

  /** Cast and crew for one work, in source billing/department order. */
  async getWorkCredits(id: string): Promise<WorkCreditsResponse> {
    return this.unwrap(
      await this.raw.GET("/api/v1/catalog/{id}/credits", {
        params: { path: { id } },
      })
    );
  }

  /** Available movies and series ranked by similarity to one work. */
  async getSimilarWorks(id: string, limit = 20): Promise<Work[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/catalog/{id}/similar", {
        params: {
          path: { id },
          query: { limit },
        },
      })
    );
  }

  /**
   * Source artwork fetched and durably cached by Playarr Server. A Blob keeps
   * bearer credentials out of image URLs; web clients can create a local
   * object URL for normal `<img>` rendering.
   */
  async getWorkArtwork(workId: string, kind: ImageKind, size: ArtworkSize = {}): Promise<Blob> {
    return this.unwrap(
      await this.raw.GET("/api/v1/artwork/work/{work_id}/{kind}", {
        params: { path: { work_id: workId, kind }, query: { w: size.width, v: size.version } },
        parseAs: "blob",
      })
    ) as Blob;
  }

  /**
   * A cast or crew headshot, resized by Playarr Server (the width snaps up to the nearest supported size) and cached
   * there, so a client never loads the metadata provider's full-size original from a third-party host.
   */
  async getPersonArtwork(personId: string, width = 240): Promise<Blob> {
    return this.unwrap(
      await this.raw.GET("/api/v1/artwork/person/{person_id}", {
        params: { path: { person_id: personId }, query: { w: width } },
        parseAs: "blob",
      })
    ) as Blob;
  }

  /**
   * Source album artwork fetched and durably cached by Playarr Server. The
   * artist work id keeps album lookup within the caller's visible library.
   */
  async getAlbumArtwork(
    artistWorkId: string,
    albumId: string,
    kind: ImageKind,
    size: ArtworkSize = {}
  ): Promise<Blob> {
    return this.unwrap(
      await this.raw.GET(
        "/api/v1/artwork/album/{artist_work_id}/{album_id}/{kind}",
        {
          params: {
            path: {
              artist_work_id: artistWorkId,
              album_id: albumId,
              kind,
            },
            query: { w: size.width, v: size.version },
          },
          parseAs: "blob",
        }
      )
    ) as Blob;
  }

  /**
   * An episode's own still (the source's screenshot), fetched and durably
   * cached by Playarr Server. Rejects with a 404 `ApiError` when the source
   * supplied none, so callers can fall back to a frame thumbnail.
   */
  async getEpisodeArtwork(
    seriesWorkId: string,
    episodeId: string,
    kind: ImageKind = "thumb",
    size: ArtworkSize = {}
  ): Promise<Blob> {
    return this.unwrap(
      await this.raw.GET(
        "/api/v1/artwork/episode/{series_work_id}/{episode_id}/{kind}",
        {
          params: {
            path: {
              series_work_id: seriesWorkId,
              episode_id: episodeId,
              kind,
            },
            query: { w: size.width, v: size.version },
          },
          parseAs: "blob",
        }
      )
    ) as Blob;
  }

  // ---------------------------------------------------------------------
  // admin (source instances) -- registering the *arr apps Playarr Server talks
  // to. Every operation here is admin-gated (401 with no/invalid token,
  // 403 for a valid-but-non-admin caller).
  // ---------------------------------------------------------------------

  async listSourceInstances(): Promise<SourceInstanceResponse[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/source-instances", {}));
  }

  async updateSourceFolderMappings(
    id: string,
    body: SourceFolderMappingsRequest
  ): Promise<SourceInstanceResponse> {
    return this.unwrap(
      await this.raw.PUT("/api/v1/admin/source-instances/{id}/folder-mappings", {
        params: { path: { id } },
        body,
      })
    );
  }

  async getSourceMatrix(): Promise<SourceMatrixResponse> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/library/source-matrix", {}));
  }

  /**
   * Registers a new *arr connection, or updates one in place when
   * `body.id` is set. The server confirms the instance is actually
   * reachable (a real HTTP call to it) before accepting -- expect this to
   * take a second or two, and to reject (502) a wrong URL/key immediately
   * rather than silently accepting it.
   */
  async createSourceInstance(body: SourceInstanceRequest): Promise<SourceInstanceResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/source-instances", { body }));
  }

  async deleteSourceInstance(id: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/admin/source-instances/{id}", { params: { path: { id } } })
    );
  }

  /**
   * Asks this source instance's reconciliation poller to do a full sync
   * right now, instead of waiting for its next scheduled pass. Fire-and-
   * forget: resolving means the request reached the poller, not that the
   * resulting sync has finished. 503s (surfaced via `describeApiError`) if
   * no poller is running yet for this instance -- normal for the first
   * ~10s after registration.
   */
  async syncSourceInstance(id: string): Promise<void> {
    this.assertOk(
      await this.raw.POST("/api/v1/admin/source-instances/{id}/sync", {
        params: { path: { id } },
      })
    );
  }

  /**
   * Every registered source instance's last-known reconciliation outcome
   * in one call -- backs the admin "Tasks" screen. `status` is `null` for
   * an instance whose poller hasn't reported anything yet (freshly
   * registered, no pass has started). Purely in-memory server-side state,
   * same caveat as `syncSourceInstance`: nothing here survives a restart.
   */
  async sourceInstanceSyncStatuses(): Promise<SourceInstanceSyncStatus[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/admin/source-instances/sync-status", {})
    );
  }

  // ---------------------------------------------------------------------
  // admin (tdarr) -- Playarr Server's single Tdarr connection (background
  // transcode pipeline). Unlike source instances, this is a singleton --
  // no `{id}` path segment, `createTdarrConnection` always registers-or-
  // replaces the one connection. Admin-gated, same as source instances.
  // ---------------------------------------------------------------------

  /** `undefined` if no Tdarr connection has been registered yet (a 404). */
  async getTdarrConnection(): Promise<TdarrConnectionResponse | undefined> {
    const result = await this.raw.GET("/api/v1/admin/tdarr", {});
    if (result.response.status === 404) return undefined;
    return this.unwrap(result);
  }

  /**
   * Registers (or updates in place) Playarr Server's Tdarr connection. The
   * server confirms Tdarr is actually reachable (a real `get-nodes` call)
   * before accepting -- expect this to take a second or two, and to
   * reject (502) a wrong URL/key immediately rather than silently
   * accepting it.
   */
  async createTdarrConnection(body: TdarrConnectionRequest): Promise<TdarrConnectionResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/tdarr", { body }));
  }

  async deleteTdarrConnection(): Promise<void> {
    this.assertOk(await this.raw.DELETE("/api/v1/admin/tdarr", {}));
  }

  // ---------------------------------------------------------------------
  // admin (users) -- provisioning real username/password accounts. Every
  // operation here is admin-gated (401 with no/invalid token, 403 for a
  // valid-but-non-admin caller), same as the source-instance operations
  // above.
  // ---------------------------------------------------------------------

  async listUsers(): Promise<UserResponse[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/users", {}));
  }

  /** Provisions a new account. 409s if `body.username` is already taken. */
  async createUser(body: CreateUserRequest): Promise<UserResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/users", { body }));
  }

  /** Issues a one-use invitation with the administrator-selected expiry. */
  async createUserInvite(body: CreateUserInvite): Promise<UserInviteResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/user-invites", { body }));
  }

  async listUserInviteRequests(): Promise<UserInviteRequestResponse[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/user-invite-requests", {}));
  }

  async reviewUserInviteRequest(
    id: string,
    body: ReviewUserInviteRequest
  ): Promise<UserInviteRequestResponse> {
    return this.unwrap(
      await this.raw.PATCH("/api/v1/admin/user-invite-requests/{id}", {
        params: { path: { id } },
        body,
      })
    );
  }

  async getMyUserInviteRequest(): Promise<UserInviteRequestResponse | null> {
    return this.unwrap(await this.raw.GET("/api/v1/users/me/user-invite-request", {}));
  }

  async createUserInviteRequest(
    body: CreateUserInviteRequest
  ): Promise<UserInviteRequestResponse> {
    return this.unwrap(
      await this.raw.POST("/api/v1/users/me/user-invite-request", { body })
    );
  }

  async generateApprovedUserInvite(): Promise<UserInviteResponse> {
    return this.unwrap(
      await this.raw.POST("/api/v1/users/me/user-invite-request/generate", {})
    );
  }

  async getPushConfig(): Promise<FirebaseWebConfig> {
    return this.unwrap(await this.raw.GET("/api/v1/notifications/config", {}));
  }

  async registerPush(body: RegisterPushRequest): Promise<void> {
    this.assertOk(await this.raw.POST("/api/v1/users/me/push-registrations", { body }));
  }

  /** All-optional patch -- only fields set in `body` are changed. */
  async updateUser(id: string, body: UpdateUserRequest): Promise<UserResponse> {
    return this.unwrap(
      await this.raw.PATCH("/api/v1/admin/users/{id}", { params: { path: { id } }, body })
    );
  }

  async deleteUser(id: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/admin/users/{id}", { params: { path: { id } } })
    );
  }

  /**
   * The signed-in user's own capability grants (currently just
   * `can_download`) -- the client-side counterpart to the server's
   * `can_download` enforcement, used to decide whether to show download
   * UI at all rather than just letting the underlying request 403.
   */
  async getSelfCapabilities(): Promise<SelfCapabilities> {
    return this.unwrap(await this.raw.GET("/api/v1/users/me/capabilities", {}));
  }

  /** The signed-in user's persisted player defaults. */
  async getPlayerPreferences(): Promise<PlayerPreferences> {
    return this.unwrap(
      await this.raw.GET("/api/v1/users/me/player-preferences", {})
    );
  }

  /** Updates the signed-in user's persisted player defaults. */
  async updatePlayerPreferences(
    body: UpdatePlayerPreferencesRequest
  ): Promise<PlayerPreferences> {
    return this.unwrap(
      await this.raw.PATCH("/api/v1/users/me/player-preferences", { body })
    );
  }

  /** The signed-in user's profile avatar, shared by every client device. */
  async getProfileAvatar(): Promise<ProfileAvatarSettingResponse> {
    return this.unwrap(await this.raw.GET("/api/v1/users/me/profile-avatar", {}));
  }

  /** Replaces the signed-in user's server-backed profile avatar. */
  async updateProfileAvatar(
    body: UpdateProfileAvatarRequest
  ): Promise<ProfileAvatarSettingResponse> {
    return this.unwrap(await this.raw.PUT("/api/v1/users/me/profile-avatar", { body }));
  }

  /** Profiles available to the signed-in viewer, including browser-switch lock state. */
  async listAvailableProfiles(): Promise<AvailableProfile[]> {
    return this.unwrap(await this.raw.GET("/api/v1/users/profiles", {}));
  }

  /** Whether the signed-in profile currently requires a PIN before switching into it. */
  async getProfilePinSetting(): Promise<ProfilePinSetting> {
    return this.unwrap(await this.raw.GET("/api/v1/users/me/profile-pin", {}));
  }

  /** Sets an exactly four-digit PIN, or removes the profile lock with `pin: null`. */
  async updateProfilePinSetting(body: UpdateProfilePinRequest): Promise<ProfilePinSetting> {
    return this.unwrap(await this.raw.PATCH("/api/v1/users/me/profile-pin", { body }));
  }

  /** The signed-in profile's household state: schedule, remaining time, offline validity. */
  async getHouseholdStatus(): Promise<HouseholdStatus> {
    return this.queries.fetch(
      "household:status",
      async () => this.unwrap(await this.raw.GET("/api/v1/household/status", {})),
      { tags: ["household"], ttlMs: 5_000 }
    );
  }

  /** Own requests plus requests from profiles this user guards. */
  async listHouseholdApprovals(): Promise<HouseholdApproval[]> {
    return this.unwrap(await this.raw.GET("/api/v1/household/approvals", {}));
  }

  async createHouseholdApproval(
    body: CreateHouseholdApprovalRequest
  ): Promise<HouseholdApproval> {
    return this.unwrap(await this.raw.POST("/api/v1/household/approvals", { body }));
  }

  /** Guardian decision; approving needs the guardian's own profile PIN. */
  async decideHouseholdApproval(
    id: string,
    body: DecideHouseholdApprovalRequest
  ): Promise<HouseholdApproval> {
    return this.unwrap(
      await this.raw.POST("/api/v1/household/approvals/{id}/decision", {
        params: { path: { id } },
        body,
      })
    );
  }

  /** Admin: a profile's rating, schedule, budget and guardian settings. */
  async getUserHousehold(id: string): Promise<HouseholdSettings> {
    return this.unwrap(
      await this.raw.GET("/api/v1/admin/users/{id}/household", { params: { path: { id } } })
    );
  }

  async putUserHousehold(id: string, body: HouseholdSettings): Promise<HouseholdSettings> {
    return this.unwrap(
      await this.raw.PUT("/api/v1/admin/users/{id}/household", {
        params: { path: { id } },
        body,
      })
    );
  }

  /** Verifies a locked target profile before the browser activates its saved session. */
  async verifyProfilePin(
    id: string,
    body: VerifyProfilePinRequest
  ): Promise<VerifyProfilePinResponse> {
    return this.unwrap(
      await this.raw.POST("/api/v1/users/profiles/{id}/verify-pin", {
        params: { path: { id } },
        body,
      })
    );
  }

  // ---------------------------------------------------------------------
  // admin (peer groups) -- `docs/architecture/peer-groups.md` §3.4/§6.1.
  // These cover the complete operator flow: stage this node's profile,
  // found or join a group, inspect membership, and mint the one-use token
  // another node needs in order to join.
  // ---------------------------------------------------------------------

  async updateSelfPeerNode(body: SelfPeerNodeRequest): Promise<SelfPeerNodeResponse> {
    return this.unwrap(
      await this.raw.PUT("/api/v1/admin/peer-nodes/self", { body })
    );
  }

  async foundPeerGroup(body: FoundPeerGroupRequest): Promise<FoundPeerGroupResponse> {
    return this.unwrap(
      await this.raw.POST("/api/v1/admin/peer-groups", { body })
    );
  }

  async joinPeerGroup(body: JoinPeerGroupRequest): Promise<JoinPeerGroupResponse> {
    return this.unwrap(
      await this.raw.POST("/api/v1/admin/peer-groups/join", { body })
    );
  }

  async leavePeerGroup(): Promise<LeavePeerGroupResponse> {
    return this.unwrap(
      await this.raw.DELETE("/api/v1/admin/peer-groups/self", {})
    );
  }

  async createPeerJoinToken(): Promise<PeerJoinTokenResponse> {
    return this.unwrap(
      await this.raw.POST("/api/v1/admin/peer-groups/join-tokens", {})
    );
  }

  async listPeerNodes(): Promise<PeerNode[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/peer-nodes", {}));
  }

  async getPeerNodeSyncStatus(id: string): Promise<PeerSyncStatusResponse> {
    return this.unwrap(
      await this.raw.GET("/api/v1/admin/peer-nodes/{id}/sync-status", {
        params: { path: { id } },
      })
    );
  }

  async getPeerAddressBundle(): Promise<PeerAddressBundle> {
    return this.unwrap(
      await this.raw.GET("/api/v1/admin/peer-groups/self/address-bundle", {})
    );
  }

  // ---------------------------------------------------------------------
  // admin (views) -- "Views": named, saved filter+sort presets over the
  // catalog, surfaced to Playarr as browsable shelves. Admin-gated create/
  // list/update/delete (401 no token, 403 non-admin); the public list/
  // resolve pair below is streaming-or-admin-gated instead, same as catalog.
  // ---------------------------------------------------------------------

  /** Every view, full projection (including `criteria`), in display order (defaults first). */
  async listAdminViews(): Promise<LibraryViewResponse[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/views", {}));
  }

  async createView(body: LibraryViewRequest): Promise<LibraryViewResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/views", { body }));
  }

  /** Renames/retunes a view in place -- `is_default`/`default_order` are preserved server-side. */
  async updateView(id: string, body: LibraryViewRequest): Promise<LibraryViewResponse> {
    return this.unwrap(
      await this.raw.PUT("/api/v1/admin/views/{id}", { params: { path: { id } }, body })
    );
  }

  /** 409s if `id` is a seeded default view -- see `LibraryViewResponse.is_default`. */
  async deleteView(id: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/admin/views/{id}", { params: { path: { id } } })
    );
  }

  // ---------------------------------------------------------------------
  // home rails -- server-computed, per-user Home shelves (recently added/
  // released, top unwatched, rediscover, seasonal, custom). Empty rails are
  // omitted by the server; titles are localised to `lang` (en | th | ja).
  // ---------------------------------------------------------------------

  async getHomeRails(
    params: { lang?: string; library?: "movie" | "series" | "artist"; on?: string } = {}
  ): Promise<HomeRailsResponse> {
    return this.unwrap(
      await this.raw.GET("/api/v1/home/rails", {
        params: { query: { lang: params.lang, library: params.library, on: params.on } },
      })
    );
  }

  /** The rails the admin enabled, in the caller's order, with the caller's hidden flags. */
  async getRailPreferences(lang?: string): Promise<RailPreferences> {
    return this.unwrap(
      await this.raw.GET("/api/v1/home/rails/preferences", { params: { query: { lang } } })
    );
  }

  async saveRailPreferences(body: RailPreferencesRequest): Promise<RailPreferences> {
    return this.unwrap(await this.raw.PUT("/api/v1/home/rails/preferences", { body }));
  }

  async resetRailPreferences(): Promise<void> {
    this.assertOk(await this.raw.DELETE("/api/v1/home/rails/preferences", {}));
  }

  /** Admin: every rail definition in display order. */
  async listAdminHomeRails(): Promise<HomeRailDefinition[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/home-rails", {}));
  }

  async createHomeRail(body: CreateHomeRailRequest): Promise<HomeRailDefinition> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/home-rails", { body }));
  }

  async updateHomeRail(id: string, body: UpdateHomeRailRequest): Promise<HomeRailDefinition> {
    return this.unwrap(
      await this.raw.PUT("/api/v1/admin/home-rails/{id}", { params: { path: { id } }, body })
    );
  }

  /** 409s for a default rail -- disable it instead. */
  async deleteHomeRail(id: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/admin/home-rails/{id}", { params: { path: { id } } })
    );
  }

  async reorderHomeRails(ids: string[]): Promise<HomeRailDefinition[]> {
    return this.unwrap(await this.raw.PUT("/api/v1/admin/home-rails/order", { body: { ids } }));
  }

  // ---------------------------------------------------------------------
  // views (public/Playarr-facing) -- same gate as catalog browse: any
  // token with Playarr streaming access, or an admin account.
  // ---------------------------------------------------------------------

  /** Every view, minimal projection (no `criteria`), in the same display order `listAdminViews` returns. */
  async listViews(): Promise<ViewSummary[]> {
    return this.queries.fetch(
      "views:list",
      async () => this.unwrap(await this.raw.GET("/api/v1/views", {})),
      { tags: ["views", "catalog"], ttlMs: 5_000 }
    );
  }

  /** Runs a saved view's filter+sort against the live catalog; response shape matches `browseCatalog`. */
  async resolveView(id: string, params: { limit?: number; offset?: number } = {}): Promise<CatalogPage> {
    return this.unwrap(
      await this.raw.GET("/api/v1/views/{id}/resolve", {
        params: { path: { id }, query: { limit: params.limit, offset: params.offset } },
      })
    );
  }

  // ---------------------------------------------------------------------
  // playlists -- user + System playlists, streaming-or-admin-gated (same
  // as views' public pair): 401 no/invalid token, 403 lacking both grants.
  // Per-playlist read/write access is enforced server-side (404 for a
  // personal playlist the caller doesn't own, 403 writing a System
  // playlist as a non-admin) -- see backend/crates/playarr-api/src/
  // playlists.rs's module doc comment.
  // ---------------------------------------------------------------------

  /** Unified discovery: merged, source-attributed titles plus a status per provider. */
  async discover(
    q: string,
    options: { scope?: DiscoveryScope; kind?: DiscoveryKind; limit?: number } = {}
  ): Promise<DiscoverResponse> {
    return this.unwrap(
      await this.raw.GET("/api/v1/discover", { params: { query: { q, ...options } } })
    );
  }

  /** Re-resolve one title for the caller: library match, watchlist membership and actions. */
  async resolveTitle(body: TitleSnapshot): Promise<ResolvedTitle> {
    return this.unwrap(await this.raw.POST("/api/v1/discover/resolve", { body }));
  }

  /** Ask the configured request provider (Radarr/Sonarr) to add and search for a title. */
  /** `GET /api/v1/requests`: own requests; administrators get all unless `mine`. */
  async listRequests(mine?: boolean): Promise<RequestView[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/requests", { params: { query: { mine } } })
    );
  }

  async decideRequest(
    id: string,
    decision: "approve" | "decline",
    reason?: string
  ): Promise<RequestView> {
    return this.unwrap(
      await this.raw.POST("/api/v1/admin/requests/{id}/decision", {
        params: { path: { id } },
        body: { decision, reason },
      })
    );
  }

  async removeRequest(id: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/admin/requests/{id}", { params: { path: { id } } })
    );
  }

  async listRequestIntegrations(): Promise<RequestIntegrationView[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/request-integrations", {}));
  }

  async createRequestIntegration(
    body: RequestIntegrationInput
  ): Promise<RequestIntegrationView> {
    return this.unwrap(await this.raw.POST("/api/v1/admin/request-integrations", { body }));
  }

  async updateRequestIntegration(
    id: string,
    body: RequestIntegrationInput
  ): Promise<RequestIntegrationView> {
    return this.unwrap(
      await this.raw.PUT("/api/v1/admin/request-integrations/{id}", {
        params: { path: { id } },
        body,
      })
    );
  }

  async deleteRequestIntegration(id: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/admin/request-integrations/{id}", {
        params: { path: { id } },
      })
    );
  }

  async testRequestIntegration(id: string): Promise<RequestIntegrationTestResult> {
    return this.unwrap(
      await this.raw.POST("/api/v1/admin/request-integrations/{id}/test", {
        params: { path: { id } },
      })
    );
  }

  async requestIntegrationUsers(id: string): Promise<RequestExternalUser[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/admin/request-integrations/{id}/users", {
        params: { path: { id } },
      })
    );
  }

  async syncRequestIntegration(id: string): Promise<RequestPullReport> {
    return this.unwrap(
      await this.raw.POST("/api/v1/admin/request-integrations/{id}/sync", {
        params: { path: { id } },
      })
    );
  }

  async getRequestSettings(): Promise<RequestSettings> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/request-settings", {}));
  }

  async putRequestSettings(body: RequestSettings): Promise<RequestSettings> {
    return this.unwrap(await this.raw.PUT("/api/v1/admin/request-settings", { body }));
  }

  async requestTitle(body: TitleSnapshot): Promise<RequestResult> {
    return this.unwrap(await this.raw.POST("/api/v1/discover/request", { body }));
  }

  async listWatchlist(): Promise<WatchlistResponse> {
    return this.unwrap(await this.raw.GET("/api/v1/watchlist", {}));
  }

  async addToWatchlist(body: TitleSnapshot): Promise<ResolvedTitle> {
    return this.unwrap(await this.raw.POST("/api/v1/watchlist", { body }));
  }

  async removeFromWatchlist(titleKey: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/watchlist/{title_key}", {
        params: { path: { title_key: titleKey } },
      })
    );
  }

  /** Every playlist visible to the caller: their own personal playlists plus every System playlist. */
  async listPlaylists(): Promise<PlaylistResponse[]> {
    return this.unwrap(await this.raw.GET("/api/v1/playlists", {}));
  }

  /** Admin-only: every playlist regardless of owner (System + every user's personal ones). */
  async listAdminPlaylists(): Promise<PlaylistResponse[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/playlists", {}));
  }

  async createPlaylist(body: CreatePlaylistRequest): Promise<PlaylistResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/playlists", { body }));
  }

  async getPlaylist(id: string): Promise<PlaylistResponse> {
    return this.unwrap(await this.raw.GET("/api/v1/playlists/{id}", { params: { path: { id } } }));
  }

  async updatePlaylist(id: string, body: UpdatePlaylistRequest): Promise<PlaylistResponse> {
    return this.unwrap(
      await this.raw.PUT("/api/v1/playlists/{id}", { params: { path: { id } }, body })
    );
  }

  /** Cascades to any nested child playlists and their items server-side. */
  async deletePlaylist(id: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/playlists/{id}", { params: { path: { id } } })
    );
  }

  async listPlaylistItems(id: string): Promise<PlaylistItemResponse[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/playlists/{id}/items", { params: { path: { id } } })
    );
  }

  async addPlaylistItem(id: string, body: AddPlaylistItemRequest): Promise<PlaylistItemResponse> {
    return this.unwrap(
      await this.raw.POST("/api/v1/playlists/{id}/items", { params: { path: { id } }, body })
    );
  }

  async removePlaylistItem(id: string, itemId: string): Promise<void> {
    this.assertOk(
      await this.raw.DELETE("/api/v1/playlists/{id}/items/{item_id}", {
        params: { path: { id, item_id: itemId } },
      })
    );
  }

  /** Replaces the full item ordering; returns the items in their new order. */
  async reorderPlaylistItems(
    id: string,
    body: ReorderPlaylistItemsRequest
  ): Promise<PlaylistItemResponse[]> {
    return this.unwrap(
      await this.raw.PUT("/api/v1/playlists/{id}/items/order", { params: { path: { id } }, body })
    );
  }

  // ---------------------------------------------------------------------
  // admin (playback activity) -- live + historical playback-session
  // diagnostics backing the admin Activity page. Admin-gated (401 no/
  // invalid token, 403 non-admin), same as the other `/api/v1/admin/*`
  // operations above.
  // ---------------------------------------------------------------------

  /** Every active playback session across reachable connected servers, with partial-result metadata. */
  async groupActiveSessions(): Promise<ActivityActiveResponse> {
    return this.unwrap(
      await this.raw.GET("/api/v1/admin/playback/activity/active", {})
    );
  }

  /** Complete effective-library choices, independent of the currently loaded Activity rows. */
  async getActivityFacets(): Promise<ActivityFacetsResponse> {
    return this.unwrap(
      await this.raw.GET("/api/v1/admin/playback/activity/facets", {})
    );
  }

  /** Searches playback history across reachable connected servers. Continue with the opaque `next_cursor`; non-zero offsets are rejected. */
  async searchGroupSessionHistory(
    body: ActivityHistoryRequest
  ): Promise<ActivityHistoryResponse> {
    return this.unwrap(
      await this.raw.POST("/api/v1/admin/playback/activity/history", {
        // The OpenAPI document correctly omits a `required` list because
        // serde supplies every missing field from `Default`. openapi-typescript
        // nevertheless promotes properties carrying `default` values to
        // required, so keep that generator-specific assertion at this one
        // boundary while preserving the sparse JSON body callers supplied.
        body: body as components["schemas"]["PlaybackActivityHistoryRequest"],
      })
    );
  }

  /** Every currently-active playback session, newest first. In-memory server-side state -- nothing here survives a restart. */
  async activeSessions(): Promise<ActiveSessionView[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/playback/sessions/active", {}));
  }

  /** Filtered, paginated and enriched session history, newest first. `params.limit` is clamped to 500 server-side. */
  async sessionHistory(params: SessionHistoryParams = {}): Promise<SessionHistoryView[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/admin/playback/sessions/history", {
        params: {
          query: {
            user_id: params.userId,
            from: params.from,
            to: params.to,
            limit: params.limit,
            offset: params.offset,
          },
        },
      })
    );
  }

  /** Force-stops a live playback session (e.g. an in-progress transcode an operator wants to cancel). A no-op, not an error, if it already ended on its own. */
  async stopSession(sessionId: string): Promise<void> {
    this.assertOk(
      await this.raw.POST("/api/v1/admin/playback/sessions/{session_id}/stop", {
        params: { path: { session_id: sessionId } },
      })
    );
  }

  // ---------------------------------------------------------------------
  // playback
  // ---------------------------------------------------------------------

  /** Direct-play URL or HLS manifest URL for a given MediaFile, given this client's playback capabilities. */
  async getPlaybackInfo(mediaFileId: string, params: PlaybackInfoParams = {}): Promise<PlaybackInfo> {
    return this.unwrap(
      await this.raw.GET("/api/v1/playback/{media_file_id}", {
        params: {
          path: { media_file_id: mediaFileId },
          query: {
            containers: params.containers,
            video_codecs: params.videoCodecs,
            audio_codecs: params.audioCodecs,
            max_bitrate_bps: params.maxBitrateBps,
            profile: params.profile,
            force_transcode: params.forceTranscode,
            start_position_ms: params.startPositionMs,
            audio_stream_index: params.audioStreamIndex,
            ignore_saved_preferences: params.ignoreSavedPreferences,
          },
        },
      })
    );
  }

  /** Records playback lifecycle and closes the server session on Stop/Error. */
  async recordPlaybackEvent(sessionId: string, event: PlaybackEventKind): Promise<void> {
    this.assertOk(
      await this.raw.POST("/api/v1/playback/sessions/{session_id}/events", {
        params: { path: { session_id: sessionId } },
        body: event,
      })
    );
  }

  /**
   * Explains how an active session is being played. `report` carries what the
   * client reports (capabilities) and measures (player telemetry); every
   * field is optional and unknown values must be omitted, never guessed.
   */
  async getPlaybackHealth(
    sessionId: string,
    report: ClientPlaybackReport
  ): Promise<PlaybackHealthReport> {
    return this.unwrap(
      await this.raw.POST("/api/v1/playback/sessions/{session_id}/health", {
        params: { path: { session_id: sessionId } },
        body: report,
      })
    );
  }

  /**
   * One bounded download (default 1 MiB, server cap 4 MiB) timed for latency
   * and throughput. Aborting `signal` cancels the transfer immediately.
   */
  async runConnectionTest(options: {
    bytes?: number;
    signal?: AbortSignal;
  } = {}): Promise<ConnectionTestResult> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const bytes = options.bytes ?? 1024 * 1024;
    const request = new Request(
      this.resolveUrl(`/api/v1/playback/connection-test?bytes=${Math.floor(bytes)}`),
      { method: "GET", headers, cache: "no-store", signal: options.signal }
    );
    const started = performance.now();
    const response = await this.rawFetch(request);
    const headersAt = performance.now();
    if (!response.ok) {
      throw new ApiError(response.status, response.statusText, undefined);
    }
    const body = await response.arrayBuffer();
    const finished = performance.now();
    const seconds = Math.max((finished - headersAt) / 1000, 0.001);
    return {
      bytes: body.byteLength,
      latencyMs: Math.round(headersAt - started),
      throughputBps: Math.round((body.byteLength * 8) / seconds),
    };
  }

  /** Real chapters embedded in the source media container; empty when the file has none. */
  async getMediaChapters(mediaFileId: string): Promise<MediaChapter[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/media/{media_file_id}/chapters", {
        params: { path: { media_file_id: mediaFileId } },
      })
    );
  }

  /** Fixed source-container runtime, persisted after at most one lazy ffprobe for older files. */
  async getMediaMetadata(mediaFileId: string): Promise<MediaMetadata> {
    return this.unwrap(
      await this.raw.GET("/api/v1/media/{media_file_id}/metadata", {
        params: { path: { media_file_id: mediaFileId } },
      })
    );
  }

  /** Playback choices plus this viewer's remembered selections for one file. */
  async getMediaPlaybackOptions(mediaFileId: string): Promise<MediaPlaybackOptions> {
    return this.unwrap(
      await this.raw.GET("/api/v1/media/{media_file_id}/playback-options", {
        params: { path: { media_file_id: mediaFileId } },
      })
    );
  }

  /** Validates and persists this viewer's selections for one media file. */
  async updateMediaPlaybackOptions(
    mediaFileId: string,
    body: UpdateMediaPlaybackPreferencesRequest
  ): Promise<MediaPlaybackOptions> {
    return this.unwrap(
      await this.raw.PATCH("/api/v1/media/{media_file_id}/playback-options", {
        params: { path: { media_file_id: mediaFileId } },
        body,
      })
    );
  }

  /** Embedded text subtitle converted and cached by Playarr Server as WebVTT. */
  async getMediaSubtitle(
    mediaFileId: string,
    streamIndex: number,
    sourceOffsetMs = 0
  ): Promise<Blob> {
    return this.unwrap(
      await this.raw.GET("/api/v1/media/{media_file_id}/subtitles/{stream_index}", {
        params: {
          path: { media_file_id: mediaFileId, stream_index: streamIndex },
          query: { source_offset_ms: sourceOffsetMs },
        },
        parseAs: "blob",
      })
    ) as Blob;
  }

  /**
   * A real frame extracted from the media file. Returned as a Blob so web
   * clients can create a short-lived object URL without putting bearer
   * credentials in an image URL. `null` means the file has nothing to extract
   * (for example audio without cover art): an expected miss, not an error.
   */
  async getMediaThumbnail(mediaFileId: string, positionMs?: number): Promise<Blob | null> {
    const result = await this.raw.GET("/api/v1/media/{media_file_id}/thumbnail", {
      params: {
        path: { media_file_id: mediaFileId },
        query: { position_ms: positionMs },
      },
      parseAs: "blob",
    });
    if (result.response.status === 204) return null;
    return this.unwrap(result) as Blob;
  }

  /** Every durable progress row for the signed-in viewer, newest first. */
  async listWatchProgress(): Promise<WatchProgress[]> {
    // Concurrent callers share one request; nothing is kept afterwards, so watch state is never stale.
    return this.queries.fetch(
      "progress:list",
      async () => this.unwrap(await this.raw.GET("/api/v1/playback/progress")),
      { tags: ["progress"] }
    );
  }

  /**
   * Smart Start/Resume (docs/architecture/smart-resume.md): what a Start or
   * Resume press should play for this series, or the options to offer.
   */
  async getResumePlan(seriesWorkId: string): Promise<ResumePlan> {
    return this.unwrap(
      await this.raw.GET("/api/v1/catalog/{id}/resume-plan", {
        params: { path: { id: seriesWorkId } },
      })
    );
  }

  /** Reports the option the viewer picked; the server records declined gaps. */
  async recordResumeChoice(
    seriesWorkId: string,
    option: Pick<ResumeOption, "kind" | "episode_id">
  ): Promise<ResumePlan> {
    return this.unwrap(
      await this.raw.POST("/api/v1/catalog/{id}/resume-plan/choice", {
        params: { path: { id: seriesWorkId } },
        body: { kind: option.kind, episode_id: option.episode_id },
      })
    );
  }

  /** Forgets every recorded Resume answer for a series ("ask again"). */
  async clearResumeChoices(seriesWorkId: string): Promise<{ removed: number }> {
    return this.unwrap(
      await this.raw.DELETE("/api/v1/catalog/{id}/resume-plan/choices", {
        params: { path: { id: seriesWorkId } },
      })
    );
  }

  /** Resume plans for the series the viewer has history in, newest first. */
  async listResumePlans(): Promise<ResumePlan[]> {
    return this.unwrap(await this.raw.GET("/api/v1/playback/resume-plans"));
  }

  /** Resume position for one file; returns `state: "unseen"` before first playback. */
  async getWatchProgress(mediaFileId: string): Promise<WatchProgress> {
    return this.unwrap(
      await this.raw.GET("/api/v1/playback/{media_file_id}/progress", {
        params: { path: { media_file_id: mediaFileId } },
      })
    );
  }

  // ---------------------------------------------------------------------
  // phone remote and playback handoff (docs/architecture/remote-control.md)
  // ---------------------------------------------------------------------

  /** Registers this device as a remotely controllable target with advertised capabilities. */
  async registerRemoteTarget(body: {
    name: string;
    platform?: string;
    capabilities: string[];
  }): Promise<RemoteTarget> {
    return this.requestJson("PUT", "/api/v1/remote/target", body);
  }

  async unregisterRemoteTarget(): Promise<void> {
    await this.requestJson("DELETE", "/api/v1/remote/target");
  }

  async listRemoteTargets(): Promise<RemoteTarget[]> {
    return this.requestJson("GET", "/api/v1/remote/targets");
  }

  /** Reports what this target is playing (fresh state is used for handoff). */
  async reportRemoteState(state: Record<string, unknown>): Promise<void> {
    await this.requestJson("PUT", "/api/v1/remote/target/state", { state });
  }

  async requestRemotePairing(body: {
    targetDeviceId: string;
    scopes?: string[];
    controllerName?: string;
  }): Promise<RemotePairing> {
    return this.requestJson("POST", "/api/v1/remote/pairings", {
      target_device_id: body.targetDeviceId,
      scopes: body.scopes,
      controller_name: body.controllerName,
    });
  }

  async listRemotePairings(): Promise<RemotePairing[]> {
    return this.requestJson("GET", "/api/v1/remote/pairings");
  }

  async getRemotePairing(id: string): Promise<RemotePairing> {
    return this.requestJson("GET", `/api/v1/remote/pairings/${encodeURIComponent(id)}`);
  }

  async approveRemotePairing(id: string, scopes?: string[]): Promise<RemotePairing> {
    return this.requestJson(
      "POST",
      `/api/v1/remote/pairings/${encodeURIComponent(id)}/approve`,
      { scopes }
    );
  }

  async denyRemotePairing(id: string): Promise<RemotePairing> {
    return this.requestJson("POST", `/api/v1/remote/pairings/${encodeURIComponent(id)}/deny`);
  }

  /** Renames a live pairing's controller label (any device of the account may). */
  async renameRemotePairing(id: string, name: string): Promise<RemotePairing> {
    return this.requestJson("PATCH", `/api/v1/remote/pairings/${encodeURIComponent(id)}`, { name });
  }

  async revokeRemotePairing(id: string): Promise<void> {
    await this.requestJson("DELETE", `/api/v1/remote/pairings/${encodeURIComponent(id)}`);
  }

  async sendRemoteCommand(
    pairingId: string,
    command: RemoteCommandRequest
  ): Promise<{ command_id: string; seq: number }> {
    return this.requestJson(
      "POST",
      `/api/v1/remote/pairings/${encodeURIComponent(pairingId)}/commands`,
      command
    );
  }

  async getRemoteCommandStatus(commandId: string): Promise<RemoteCommandStatus> {
    return this.requestJson("GET", `/api/v1/remote/commands/${encodeURIComponent(commandId)}`);
  }

  /** Long-polls this target's inbox for up to `wait` seconds (server caps at 25). */
  async pollRemoteInbox(after: number, wait: number, signal?: AbortSignal): Promise<RemoteInbox> {
    return this.requestJson(
      "GET",
      `/api/v1/remote/inbox?after=${Math.max(0, Math.trunc(after))}&wait=${Math.trunc(wait)}`,
      undefined,
      signal
    );
  }

  /**
   * Opens the server-sent-events push stream for this target's inbox and
   * resolves when the server closes it (it does every few minutes so the
   * access token is renewed). `Authorization` is a header, so this uses
   * `fetch` streaming rather than `EventSource`. Throws `ApiError` for HTTP
   * failures and `PushUnsupportedError` when the runtime cannot stream a
   * response body, so callers can fall back to {@link pollRemoteInbox}.
   */
  async streamRemoteInbox(
    after: number,
    handlers: { onOpen?: () => void; onEvent: (event: RemoteInboxEvent) => Promise<void> | void },
    signal?: AbortSignal
  ): Promise<void> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (after > 0) headers["Last-Event-ID"] = String(Math.trunc(after));
    const response = await this.rawFetch(
      new Request(this.resolveUrl("/api/v1/remote/stream"), { method: "GET", headers, signal })
    );
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = undefined;
      }
      throw new ApiError(response.status, response.statusText, errorBody);
    }
    // An older server (or a proxy) answers unknown paths with its HTML app shell.
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/event-stream") ||
      !response.body ||
      typeof response.body.getReader !== "function"
    ) {
      throw new PushUnsupportedError();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    handlers.onOpen?.();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          if (frame.event !== "inbox") continue;
          let event: RemoteInboxEvent;
          try {
            event = JSON.parse(frame.data) as RemoteInboxEvent;
          } catch {
            continue;
          }
          await handlers.onEvent(event);
        }
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }

  async ackRemoteEvent(
    eventId: string,
    status: "ok" | "failed" | "unsupported",
    detail?: string
  ): Promise<void> {
    await this.requestJson("POST", `/api/v1/remote/events/${encodeURIComponent(eventId)}/ack`, {
      status,
      detail,
    });
  }

  async createRemoteHandoff(body: RemoteCreateHandoffRequest): Promise<RemoteHandoff> {
    return this.requestJson("POST", "/api/v1/remote/handoffs", body);
  }

  /** `waitSeconds` long-polls while the handoff is still pending (server caps at 25). */
  async getRemoteHandoff(id: string, waitSeconds = 0, signal?: AbortSignal): Promise<RemoteHandoff> {
    const wait = waitSeconds > 0 ? `?wait=${Math.trunc(waitSeconds)}` : "";
    return this.requestJson(
      "GET",
      `/api/v1/remote/handoffs/${encodeURIComponent(id)}${wait}`,
      undefined,
      signal
    );
  }

  async ackRemoteHandoff(
    id: string,
    body: { status: "playing" | "failed"; position_ms?: number; reason?: string }
  ): Promise<RemoteHandoff> {
    return this.requestJson("POST", `/api/v1/remote/handoffs/${encodeURIComponent(id)}/ack`, body);
  }

  async cancelRemoteHandoff(id: string): Promise<RemoteHandoff> {
    return this.requestJson("POST", `/api/v1/remote/handoffs/${encodeURIComponent(id)}/cancel`);
  }

  /** Persists a heartbeat, pause/stop position, or completed playback. */
  async updateWatchProgress(
    mediaFileId: string,
    update: WatchProgressUpdate
  ): Promise<WatchProgress> {
    return this.unwrap(
      await this.raw.PUT("/api/v1/playback/{media_file_id}/progress", {
        params: { path: { media_file_id: mediaFileId } },
        body: {
          position_ms: update.positionMs,
          duration_ms: update.durationMs,
          completed: update.completed,
          occurred_at: update.occurredAt,
        },
      })
    );
  }

  // ---------------------------------------------------------------------
  // downloads -- offline media downloads. Same bearer-token gate as every
  // other protected operation, plus `Policy.can_download` and the normal
  // per-item library-ACL check on the underlying `media_file_id` -- 403 if
  // either is missing, 404 (not 403) for an unknown/inaccessible id. See
  // this file's "downloads" types section above for why these go through
  // `requestJson` instead of the generated `paths`-typed `raw` client.
  // ---------------------------------------------------------------------

  /**
   * Downloadable quality choices for one media file. The `"original"`
   * option always has `size_is_estimate: false` and a real byte count;
   * every named transcode profile is `size_is_estimate: true`, estimated
   * from bitrate * duration.
   */
  async getDownloadOptions(mediaFileId: string): Promise<DownloadOptionsResponse> {
    return this.requestJson(
      "GET",
      `/api/v1/media/${encodeURIComponent(mediaFileId)}/download-options`
    );
  }

  /**
   * Creates a download ticket. `quality_id: "original"` comes back
   * immediately `"ready"`; a named profile comes back `"queued"` and
   * transitions to `"ready"` asynchronously -- poll `getDownload`.
   */
  async createDownload(body: CreateDownloadRequest): Promise<DownloadTicket> {
    return this.requestJson("POST", "/api/v1/downloads", body);
  }

  /** Every download ticket belonging to the caller. */
  async listDownloads(): Promise<DownloadTicket[]> {
    return this.requestJson("GET", "/api/v1/downloads");
  }

  /** Polls one download ticket's current status. */
  async getDownload(id: string): Promise<DownloadTicket> {
    return this.requestJson("GET", `/api/v1/downloads/${encodeURIComponent(id)}`);
  }

  /** Cancels/deletes a download ticket (and its stored file, server-side). */
  async cancelDownload(id: string): Promise<void> {
    await this.requestJson("DELETE", `/api/v1/downloads/${encodeURIComponent(id)}`);
  }

  /**
   * Base-URL-qualified URL for the range-resumable authenticated file
   * download (`Content-Disposition: attachment`; 206 on a `Range` request;
   * 409 not ready, 410 expired/canceled). Returned as a URL rather than a
   * convenience method because the real download engine (`lib/downloadEngine.ts`)
   * needs raw, streamed, `Range`-chunked `Response` bodies -- not a fully
   * buffered `Blob` -- so it issues these `fetch()` calls itself, attaching
   * `Authorization` via `getAccessToken()` the same way this client does.
   */
  downloadFileUrl(id: string): string {
    return this.resolveUrl(`/api/v1/downloads/${encodeURIComponent(id)}/file`);
  }

  // ---------------------------------------------------------------------
  // admin (http latency metrics) -- `AdminUser`-gated (401 unauthenticated,
  // 403 non-admin), identical gating to `sync_status_handler` in `admin.rs`.
  // See this file's "admin (http latency metrics)" types section above for
  // why this goes through `requestJson` instead of the generated
  // `paths`-typed `raw` client.
  // ---------------------------------------------------------------------

  /**
   * Per-route request latency percentiles (avg/p50/p95/p99/max, sample
   * count), sorted by `p95Ms` descending. Backs the admin "Request latency"
   * diagnostics page -- a non-admin caller gets a 403 `ApiError`, which
   * callers treat as "not an admin", not a real failure.
   */
  async getHttpLatencyMetrics(): Promise<HttpRouteLatency[]> {
    const rows = await this.requestJson<HttpRouteLatencyResponse[]>(
      "GET",
      "/api/v1/admin/metrics/http-latency"
    );
    return rows.map(toHttpRouteLatency);
  }

  // ---------------------------------------------------------------------
  // release calendar
  // ---------------------------------------------------------------------

  /** `GET /api/v1/calendar`; defaults to today..today+30 server-side. */
  async getCalendar(params: CalendarParams = {}): Promise<CalendarResponse> {
    return this.requestJson<CalendarResponse>("GET", `/api/v1/calendar${buildCalendarQuery(params)}`);
  }

  async getCalendarFeed(): Promise<CalendarFeedStatus> {
    return this.requestJson<CalendarFeedStatus>("GET", "/api/v1/calendar/feed");
  }

  /**
   * `POST /api/v1/calendar/feed`: returns the existing link (200) or creates one (201).
   * With `rotate`, replaces it and the previous URL stops working. Servers that
   * predate `rotate` ignore it and always replace, so only call this without
   * `rotate` when `getCalendarFeed()` reported `link_available`.
   */
  async createCalendarFeed(options: { rotate?: boolean } = {}): Promise<CalendarFeedCreated> {
    return this.requestJson<CalendarFeedCreated>(
      "POST",
      `/api/v1/calendar/feed${options.rotate ? "?rotate=true" : ""}`
    );
  }

  async revokeCalendarFeed(): Promise<void> {
    await this.requestJson<void>("DELETE", "/api/v1/calendar/feed");
  }

  /** `GET /api/v1/catalog/{id}/availability-lag`. */
  async getAvailabilityLag(workId: string): Promise<AvailabilityLag> {
    return this.requestJson<AvailabilityLag>(
      "GET",
      `/api/v1/catalog/${encodeURIComponent(workId)}/availability-lag`
    );
  }
}
