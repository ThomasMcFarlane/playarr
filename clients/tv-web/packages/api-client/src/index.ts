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
 * The admin source-instance create/list/delete/sync operations require a
 * verified `Authorization: Bearer <access_token>` header (401 without one,
 * 403 if the caller isn't an admin) -- see the constructor's
 * `authMiddleware` below, which attaches that header to exactly those
 * operations and no others (catalog/playback/login/oauth stay
 * unauthenticated per the spec's own responses).
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

export type ClientPlatform = components["schemas"]["ClientPlatform"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type LoginResponse = components["schemas"]["LoginResponse"];
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

/** RFC 6749 §5.2 grant type Streamarr's `/api/v1/oauth/token` requires for the device flow. */
export const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export interface BrowseCatalogParams {
  kind?: WorkKind;
  genre?: string;
  tag?: string;
  /** `"title"` (default) or `"recent"`. */
  sort?: string;
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
 * `openapi-fetch` passes its middleware, paired with the HTTP method.
 * Admin-only (403, not just 401, for a non-admin caller) -- see
 * backend/crates/streamarr-api/src/admin.rs.
 */
const PROTECTED_OPERATIONS: ReadonlyArray<{ schemaPath: string; method: string }> = [
  { schemaPath: "/api/v1/admin/source-instances", method: "POST" },
  { schemaPath: "/api/v1/admin/source-instances", method: "GET" },
  { schemaPath: "/api/v1/admin/source-instances/{id}", method: "DELETE" },
  { schemaPath: "/api/v1/admin/source-instances/{id}/sync", method: "POST" },
];

function isProtectedOperation(schemaPath: string, method: string): boolean {
  return PROTECTED_OPERATIONS.some((op) => op.schemaPath === schemaPath && op.method === method);
}

/**
 * Human-readable summary of a caught error, distinguishing the two auth-
 * specific statuses the admin source-instance endpoints can return (401
 * missing/invalid token, 403 authenticated-but-not-admin) from every other
 * failure, so callers can surface a real, specific message instead of a
 * generic "something went wrong".
 */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Sign-in required -- could not obtain a valid access token.";
    if (err.status === 403) return "You do not have permission to do this.";
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
            genre: params.genre,
            tag: params.tag,
            sort: params.sort,
            limit: params.limit,
            offset: params.offset,
          },
        },
      })
    );
  }

  async searchCatalog(q: string, limit?: number): Promise<Work[]> {
    return this.unwrap(
      await this.raw.GET("/api/v1/catalog/search", { params: { query: { q, limit } } })
    );
  }

  async getWork(id: string): Promise<WorkDetail> {
    return this.unwrap(await this.raw.GET("/api/v1/catalog/{id}", { params: { path: { id } } }));
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
          },
        },
      })
    );
  }
}
