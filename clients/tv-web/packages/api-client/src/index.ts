/**
 * @streamarr-tv/api-client
 *
 * Real typed client for the Streamarr API. `src/generated/schema.ts` is
 * generated straight from `backend/openapi/streamarr.yaml` by
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
 * `backend/crates/streamarr-api/src/auth_extractor.rs`'s `StreamingUser`).
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

export type { paths, components } from "./generated/schema";

// ---------------------------------------------------------------------------
// Wire types, aliased straight off the generated schema so there is exactly
// one source of truth for the shapes the real backend actually sends/expects.
// ---------------------------------------------------------------------------

export type Work = components["schemas"]["Work"];
export type WorkKind = components["schemas"]["WorkKind"];
export type Availability = components["schemas"]["Availability"];
export type ImageAsset = components["schemas"]["ImageAsset"];
export type ImageKind = components["schemas"]["ImageKind"];
export type ExternalRef = components["schemas"]["ExternalRef"];
export type ExternalProvider = components["schemas"]["ExternalProvider"];
export type CatalogPage = components["schemas"]["CatalogPageSchema"];
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
export type MediaChapter = components["schemas"]["MediaChapter"];
export type MediaMetadata = components["schemas"]["MediaMetadata"];
export type MediaPlaybackOptions =
  components["schemas"]["MediaPlaybackOptionsResponse"];
export type MediaPlaybackPreferences =
  components["schemas"]["MediaPlaybackPreferenceResponse"];
export type UpdateMediaPlaybackPreferencesRequest =
  components["schemas"]["UpdateMediaPlaybackPreferencesRequest"];
export type WatchProgress = components["schemas"]["WatchProgress"];
export type WatchState = components["schemas"]["WatchState"];

/** One playback attempt from start to finish -- `playback_sessions` row shape, verbatim. */
export type PlaybackSession = components["schemas"]["PlaybackSession"];
/** One live session, enriched with a best-effort user/media display label. */
export type ActiveSessionView = components["schemas"]["ActiveSessionView"];
export type PlayMethod = components["schemas"]["PlayMethod"];
export type StopReason = components["schemas"]["StopReason"];
export type TranscodeReason = components["schemas"]["TranscodeReason"];

export type ClientPlatform = components["schemas"]["ClientPlatform"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type LoginResponse = components["schemas"]["LoginResponse"];
export type RefreshRequest = components["schemas"]["RefreshRequest"];
export type RefreshResponse = components["schemas"]["RefreshResponse"];
export type DeviceCodeRequest = components["schemas"]["DeviceCodeRequest"];
export type DeviceCodeResponse = components["schemas"]["DeviceCodeResponseSchema"];
export type DeviceTokenRequest = components["schemas"]["DeviceTokenRequest"];
export type TokenResponse = components["schemas"]["TokenResponseSchema"];
export type OAuthErrorBody = components["schemas"]["OAuthErrorBody"];

export type VersionEnvelope = components["schemas"]["VersionEnvelope"];
export type CompatibilityEntry = components["schemas"]["CompatibilityEntry"];

export type SourceKind = components["schemas"]["SourceKind"];
export type SourceInstanceRequest = components["schemas"]["SourceInstanceRequest"];
export type SourceInstanceResponse = components["schemas"]["SourceInstanceResponse"];
export type SourceInstanceSyncStatus = components["schemas"]["SourceInstanceSyncStatusResponse"];

export type TdarrConnectionRequest = components["schemas"]["TdarrConnectionRequest"];
export type TdarrConnectionResponse = components["schemas"]["TdarrConnectionResponse"];

export type CreateUserRequest = components["schemas"]["CreateUserRequest"];
export type UpdateUserRequest = components["schemas"]["UpdateUserRequest"];
export type UserResponse = components["schemas"]["UserResponse"];
export type PlayerPreferences = components["schemas"]["PlayerPreferencesResponse"];
export type UpdatePlayerPreferencesRequest =
  components["schemas"]["UpdatePlayerPreferencesRequest"];
export type AvailableProfile = components["schemas"]["AvailableProfileResponse"];
export type ProfilePinSetting = components["schemas"]["ProfilePinSettingResponse"];
export type UpdateProfilePinRequest = components["schemas"]["UpdateProfilePinRequest"];
export type VerifyProfilePinRequest = components["schemas"]["VerifyProfilePinRequest"];
export type VerifyProfilePinResponse = components["schemas"]["VerifyProfilePinResponse"];

export type ViewCriteriaDto = components["schemas"]["ViewCriteriaDto"];
export type LibraryViewRequest = components["schemas"]["LibraryViewRequest"];
export type LibraryViewResponse = components["schemas"]["LibraryViewResponse"];
export type ViewSummary = components["schemas"]["ViewSummary"];

export type PlaylistResponse = components["schemas"]["PlaylistResponse"];
export type CreatePlaylistRequest = components["schemas"]["CreatePlaylistRequest"];
export type UpdatePlaylistRequest = components["schemas"]["UpdatePlaylistRequest"];
export type PlaylistItemResponse = components["schemas"]["PlaylistItemResponse"];
export type AddPlaylistItemRequest = components["schemas"]["AddPlaylistItemRequest"];
export type ReorderPlaylistItemsRequest = components["schemas"]["ReorderPlaylistItemsRequest"];

/** RFC 6749 §5.2 grant type Streamarr's `/api/v1/oauth/token` requires for the device flow. */
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

export interface ApiClientConfig {
  /** API origin, e.g. "http://localhost:8080" (no trailing slash required). */
  baseUrl: string;
  /**
   * Called before each of the *protected* requests (the admin source-
   * instance create/list/delete/sync calls -- see `PROTECTED_OPERATIONS`
   * below); never called for catalog/playback/login/oauth, which stay
   * unauthenticated. Return undefined to send the request without a token
   * anyway (the server will 401 it).
   */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
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
 * -- see backend/crates/streamarr-api/src/admin.rs); the catalog/playback
 * operations are streaming-only (403 for a caller without `can_stream` --
 * see `auth_extractor.rs`'s `StreamingUser`). Both still 401 with no/an
 * invalid token.
 */
const PROTECTED_OPERATIONS: ReadonlyArray<{ schemaPath: string; method: string }> = [
  { schemaPath: "/api/v1/admin/playback/sessions/active", method: "GET" },
  { schemaPath: "/api/v1/admin/playback/sessions/history", method: "GET" },
  { schemaPath: "/api/v1/admin/playback/sessions/{session_id}/stop", method: "POST" },
  { schemaPath: "/api/v1/admin/source-instances", method: "POST" },
  { schemaPath: "/api/v1/admin/source-instances", method: "GET" },
  { schemaPath: "/api/v1/admin/source-instances/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/admin/source-instances/{id}/sync", method: "POST" },
  { schemaPath: "/api/v1/admin/source-instances/sync-status", method: "GET" },
  { schemaPath: "/api/v1/admin/tdarr", method: "POST" },
  { schemaPath: "/api/v1/admin/tdarr", method: "GET" },
  { schemaPath: "/api/v1/admin/tdarr", method: "DELETE" },
  { schemaPath: "/api/v1/admin/users", method: "POST" },
  { schemaPath: "/api/v1/admin/users", method: "GET" },
  { schemaPath: "/api/v1/admin/users/{id}", method: "PATCH" },
  { schemaPath: "/api/v1/admin/users/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/users/me/player-preferences", method: "GET" },
  { schemaPath: "/api/v1/users/me/player-preferences", method: "PATCH" },
  { schemaPath: "/api/v1/users/me/profile-pin", method: "GET" },
  { schemaPath: "/api/v1/users/me/profile-pin", method: "PATCH" },
  { schemaPath: "/api/v1/users/profiles", method: "GET" },
  { schemaPath: "/api/v1/users/profiles/{id}/verify-pin", method: "POST" },
  { schemaPath: "/api/v1/catalog", method: "GET" },
  { schemaPath: "/api/v1/catalog/kinds", method: "GET" },
  { schemaPath: "/api/v1/catalog/{id}", method: "GET" },
  { schemaPath: "/api/v1/catalog/{id}/credits", method: "GET" },
  { schemaPath: "/api/v1/catalog/{id}/similar", method: "GET" },
  { schemaPath: "/api/v1/catalog/search", method: "GET" },
  { schemaPath: "/api/v1/artwork/work/{work_id}/{kind}", method: "GET" },
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
  { schemaPath: "/api/v1/playback/progress", method: "GET" },
  { schemaPath: "/api/v1/playback/{media_file_id}/progress", method: "GET" },
  { schemaPath: "/api/v1/playback/{media_file_id}/progress", method: "PUT" },
  { schemaPath: "/api/v1/admin/views", method: "POST" },
  { schemaPath: "/api/v1/admin/views", method: "GET" },
  { schemaPath: "/api/v1/admin/views/{id}", method: "PUT" },
  { schemaPath: "/api/v1/admin/views/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/views", method: "GET" },
  { schemaPath: "/api/v1/views/{id}/resolve", method: "GET" },
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
];

function isProtectedOperation(schemaPath: string, method: string): boolean {
  return PROTECTED_OPERATIONS.some((op) => op.schemaPath === schemaPath && op.method === method);
}

/**
 * Human-readable summary of a caught error, distinguishing the two auth-
 * specific statuses `PROTECTED_OPERATIONS` can return (401 missing/invalid
 * token, 403 authenticated-but-lacking-the-required-grant) from every other
 * failure, so callers can surface a real, specific message instead of a
 * generic "something went wrong". A 403's body always carries a real,
 * specific `message` (see `backend/crates/streamarr-api/src/error.rs`'s
 * `ErrorBody` -- every `ApiError::new`/`forbidden()` call sets one), so
 * that's preferred over a generic fallback whenever it's present.
 */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
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
 * Typed client for the Streamarr API, backed by `openapi-fetch` +
 * generated `paths`/`components` types. Every method below is a thin,
 * faithful wrapper over one spec operation -- no field renaming beyond
 * grouping loose query params into an object, so the shapes here always
 * match `backend/openapi/streamarr.yaml` exactly.
 */
export class ApiClient {
  /** The underlying `openapi-fetch` client, for operations without a convenience method above. */
  readonly raw: Client<paths>;
  private readonly baseUrl: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl;
    this.raw = createFetchClient<paths>({
      baseUrl: config.baseUrl,
      fetch: config.fetchImpl,
      headers: config.defaultHeaders,
    });

    const authMiddleware: Middleware = {
      onRequest: async ({ request, schemaPath }) => {
        if (!isProtectedOperation(schemaPath, request.method)) return request;
        const token = await config.getAccessToken?.();
        if (token) {
          request.headers.set("Authorization", `Bearer ${token}`);
        }
        return request;
      },
    };
    this.raw.use(authMiddleware);
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

  /**
   * `POST /api/v1/auth/refresh` -- redeems a still-valid refresh token for
   * a fresh access token, without re-presenting credentials. The refresh
   * token itself is rotated (a new one comes back in the response) --
   * callers must persist the new one and stop using the old one, or the
   * next redemption is treated as reuse and the whole token family is
   * revoked server-side (see `backend/crates/streamarr-api/src/refresh.rs`).
   * Unauthenticated itself -- not one of `PROTECTED_OPERATIONS`.
   */
  async refresh(body: RefreshRequest): Promise<RefreshResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/auth/refresh", { body }));
  }

  // ---------------------------------------------------------------------
  // oauth (RFC 8628 device authorization grant)
  // ---------------------------------------------------------------------

  async requestDeviceCode(body: DeviceCodeRequest): Promise<DeviceCodeResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/oauth/device/code", { body }));
  }

  async requestDeviceToken(body: DeviceTokenRequest): Promise<TokenResponse> {
    return this.unwrap(await this.raw.POST("/api/v1/oauth/token", { body }));
  }

  // ---------------------------------------------------------------------
  // webhooks (*arr -> Streamarr; not called by any first-party client UI,
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
          },
        },
      })
    );
  }

  async listCatalogKinds(): Promise<WorkKind[]> {
    return this.unwrap(await this.raw.GET("/api/v1/catalog/kinds"));
  }

  async searchCatalog(q: string, limit?: number): Promise<Work[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/catalog/search", { params: { query: { q, limit } } })
    );
  }

  async getWork(id: string): Promise<WorkDetail> {
    return this.unwrap(await this.raw.GET("/api/v1/catalog/{id}", { params: { path: { id } } }));
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
   * Source artwork fetched and durably cached by Streamarr. A Blob keeps
   * bearer credentials out of image URLs; web clients can create a local
   * object URL for normal `<img>` rendering.
   */
  async getWorkArtwork(workId: string, kind: ImageKind): Promise<Blob> {
    return this.unwrap(
      await this.raw.GET("/api/v1/artwork/work/{work_id}/{kind}", {
        params: { path: { work_id: workId, kind } },
        parseAs: "blob",
      })
    ) as Blob;
  }

  // ---------------------------------------------------------------------
  // admin (source instances) -- registering the *arr apps Streamarr talks
  // to. Every operation here is admin-gated (401 with no/invalid token,
  // 403 for a valid-but-non-admin caller).
  // ---------------------------------------------------------------------

  async listSourceInstances(): Promise<SourceInstanceResponse[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/source-instances", {}));
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
  // admin (tdarr) -- Streamarr's single Tdarr connection (background
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
   * Registers (or updates in place) Streamarr's Tdarr connection. The
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
  // views (public/Playarr-facing) -- same gate as catalog browse: any
  // token with Playarr streaming access, or an admin account.
  // ---------------------------------------------------------------------

  /** Every view, minimal projection (no `criteria`), in the same display order `listAdminViews` returns. */
  async listViews(): Promise<ViewSummary[]> {
    return this.unwrap(await this.raw.GET("/api/v1/views", {}));
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
  // playlist as a non-admin) -- see backend/crates/streamarr-api/src/
  // playlists.rs's module doc comment.
  // ---------------------------------------------------------------------

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

  /** Every currently-active playback session, newest first. In-memory server-side state -- nothing here survives a restart. */
  async activeSessions(): Promise<ActiveSessionView[]> {
    return this.unwrap(await this.raw.GET("/api/v1/admin/playback/sessions/active", {}));
  }

  /** Filtered, paginated raw session history, newest first. `params.limit` is clamped to 500 server-side. */
  async sessionHistory(params: SessionHistoryParams = {}): Promise<PlaybackSession[]> {
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

  /** Embedded text subtitle converted and cached by Streamarr as WebVTT. */
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
   * credentials in an image URL.
   */
  async getMediaThumbnail(mediaFileId: string, positionMs?: number): Promise<Blob> {
    return this.unwrap(
      await this.raw.GET("/api/v1/media/{media_file_id}/thumbnail", {
        params: {
          path: { media_file_id: mediaFileId },
          query: { position_ms: positionMs },
        },
        parseAs: "blob",
      })
    ) as Blob;
  }

  /** Every durable progress row for the signed-in viewer, newest first. */
  async listWatchProgress(): Promise<WatchProgress[]> {
    return this.unwrap(await this.raw.GET("/api/v1/playback/progress"));
  }

  /** Resume position for one file; returns `state: "unseen"` before first playback. */
  async getWatchProgress(mediaFileId: string): Promise<WatchProgress> {
    return this.unwrap(
      await this.raw.GET("/api/v1/playback/{media_file_id}/progress", {
        params: { path: { media_file_id: mediaFileId } },
      })
    );
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
        },
      })
    );
  }
}
