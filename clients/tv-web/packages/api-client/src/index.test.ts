import { describe, expect, it, vi } from "vitest";
import {
  ApiClient,
  ApiError,
  buildCalendarQuery,
  PushUnsupportedError,
  SseParser,
  DEVICE_CODE_GRANT_TYPE,
  describeApiError,
  parsePinLockSeconds,
  parseHouseholdBlock,
  type ActivityActiveResponse,
  type ActivityFacetsResponse,
  type ActivityHistoryRequest,
  type ActivityHistoryResponse,
} from "./index";

/** Builds a `fetchImpl` matching openapi-fetch's `(input: Request) => Promise<Response>` contract. */
function mockFetch(handler: (request: Request) => Response | Promise<Response>) {
  return vi.fn(async (request: Request) => handler(request));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE_URL = "http://localhost:8484";

describe("ApiClient", () => {
  it("fetches the peer-group active-session envelope with origin metadata", async () => {
    const responseBody: ActivityActiveResponse = {
      sessions: [
        {
          session_id: "11111111-1111-4111-8111-111111111111",
          user_id: "22222222-2222-4222-8222-222222222222",
          device_id: "33333333-3333-4333-8333-333333333333",
          media_file_id: "44444444-4444-4444-8444-444444444444",
          work_id: "55555555-5555-4555-8555-555555555555",
          media_title: "Voyage",
          user_display_name: "Louise",
          play_method: "direct_play" as const,
          target_codec: "hevc",
          target_container: "mkv",
          client_platform: "web" as const,
          client_version: "1.4.2",
          started_at: "2026-07-29T08:30:00Z",
          bytes_streamed: 104857600,
          buffering_events: 0,
          buffering_ms_total: 0,
          peer_node_id: "66666666-6666-4666-8666-666666666666",
          peer_node_name: "Living room server",
          peer_node_is_self: true,
          source_instance_id: "77777777-7777-4777-8777-777777777777",
          source_instance_name: "Radarr",
          library_id: "88888888-8888-4888-8888-888888888888",
          library_name: "Films",
          duration_ms: 90000,
        },
      ],
      unavailable_nodes: [
        {
          peer_node_id: "99999999-9999-4999-8999-999999999999",
          peer_node_name: "Bedroom server",
          error: "request timed out",
        },
      ],
    };
    const getAccessToken = vi.fn(async () => "admin-token");
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(request.method).toBe("GET");
      expect(url.pathname).toBe("/api/v1/admin/playback/activity/active");
      expect(url.search).toBe("");
      expect(request.headers.get("Authorization")).toBe("Bearer admin-token");
      return jsonResponse(200, responseBody);
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken,
    });

    await expect(client.groupActiveSessions()).resolves.toEqual(responseBody);
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it("fetches complete activity library facets with admin authentication", async () => {
    const responseBody: ActivityFacetsResponse = {
      libraries: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          name: "Films",
        },
        {
          id: "99999999-9999-4999-8999-999999999999",
          name: "Standalone music",
        },
      ],
    };
    const getAccessToken = vi.fn(async () => "admin-token");
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(request.method).toBe("GET");
      expect(url.pathname).toBe("/api/v1/admin/playback/activity/facets");
      expect(url.search).toBe("");
      expect(request.headers.get("Authorization")).toBe("Bearer admin-token");
      return jsonResponse(200, responseBody);
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken,
    });

    await expect(client.getActivityFacets()).resolves.toEqual(responseBody);
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it("serialises every peer-group history filter as the exact POST JSON body", async () => {
    const requestBody: ActivityHistoryRequest = {
      user_ids: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ],
      play_methods: ["direct_play", "transcode"],
      title_terms: ["arrival", "matrix"],
      library_ids: ["33333333-3333-4333-8333-333333333333"],
      peer_node_ids: ["44444444-4444-4444-8444-444444444444"],
      stop_reasons: ["completed", "other", "in_progress"],
      from: "2026-07-01T00:00:00Z",
      to: "2026-07-29T23:59:59Z",
      min_duration_ms: 30000,
      max_duration_ms: 7200000,
      min_bytes_streamed: 1048576,
      max_bytes_streamed: 10737418240,
      limit: 75,
      cursor: "opaque-keyset-cursor",
    };
    const responseBody: ActivityHistoryResponse = {
      sessions: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          user_id: "11111111-1111-4111-8111-111111111111",
          device_id: "66666666-6666-4666-8666-666666666666",
          media_file_id: "77777777-7777-4777-8777-777777777777",
          started_at: "2026-07-20T18:42:00Z",
          ended_at: "2026-07-20T20:19:12Z",
          play_method: "transcode",
          source_codec: "hevc",
          source_container: "mkv",
          target_codec: "h264",
          target_container: "mp4",
          client_platform: "android-tv",
          client_version: "2.1.0",
          bytes_streamed: 734003200,
          buffering_events: 2,
          buffering_ms_total: 1500,
          stop_reason: "completed",
          peer_node_id: "44444444-4444-4444-8444-444444444444",
          peer_node_name: "Living room server",
          peer_node_is_self: false,
          source_instance_id: null,
          source_instance_name: null,
          library_id: "33333333-3333-4333-8333-333333333333",
          library_name: "Films",
          duration_ms: 5832000,
        },
      ],
      unavailable_nodes: [],
      has_more: true,
      next_cursor: "next-opaque-keyset-cursor",
      snapshot_to: "2026-07-29T23:59:59Z",
    };
    const fetchImpl = mockFetch(async (request) => {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).pathname).toBe(
        "/api/v1/admin/playback/activity/history"
      );
      expect(request.headers.get("Authorization")).toBe("Bearer admin-token");
      expect(request.headers.get("content-type")).toContain("application/json");
      await expect(request.json()).resolves.toEqual(requestBody);
      return jsonResponse(200, responseBody);
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "admin-token",
    });

    await expect(
      client.searchGroupSessionHistory(requestBody)
    ).resolves.toEqual(responseBody);
  });

  it("preserves a sparse peer-group history body without injecting defaults", async () => {
    const requestBody: ActivityHistoryRequest = {
      title_terms: ["dune"],
      stop_reasons: ["in_progress"],
    };
    const fetchImpl = mockFetch(async (request) => {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).pathname).toBe(
        "/api/v1/admin/playback/activity/history"
      );
      await expect(request.json()).resolves.toEqual(requestBody);
      return jsonResponse(200, {
        sessions: [],
        unavailable_nodes: [],
        has_more: false,
        next_cursor: null,
        snapshot_to: "2026-07-29T12:00:00Z",
      });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "admin-token",
    });

    await expect(
      client.searchGroupSessionHistory(requestBody)
    ).resolves.toEqual({
      sessions: [],
      unavailable_nodes: [],
      has_more: false,
      next_cursor: null,
      snapshot_to: "2026-07-29T12:00:00Z",
    });
  });

  it("browses the catalog and parses a real CatalogPageSchema response", async () => {
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/v1/catalog");
      expect(url.searchParams.get("kind")).toBe("movie");
      expect(url.searchParams.get("available_only")).toBe("true");
      expect(url.searchParams.get("sort")).toBe("date_added");
      expect(url.searchParams.get("order")).toBe("desc");
      expect(url.searchParams.get("limit")).toBe("10");
      return jsonResponse(200, {
        items: [
          {
            id: "3f8b3e2a-1111-4a11-9a11-000000000001",
            kind: "movie",
            external_refs: [],
            title: "Voyage",
            sort_title: "Voyage",
            images: [{ kind: "poster", url: "https://img.example/arrival.jpg" }],
            genres: ["sci-fi"],
            tags: [],
            added_at: "2024-01-01T00:00:00Z",
            monitored: true,
            availability: "available",
          },
        ],
        total: 1,
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const page = await client.browseCatalog({
      kind: "movie",
      available_only: true,
      sort: "date_added",
      order: "desc",
      limit: 10,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.title).toBe("Voyage");
    expect(page.total).toBe(1);
  });

  it("threads source_instance_id through to the query string", async () => {
    const instanceId = "9c1d2e3f-3333-4c33-9c33-000000000003";
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/v1/catalog");
      expect(url.searchParams.get("source_instance_id")).toBe(instanceId);
      return jsonResponse(200, { items: [], total: 0 });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    await client.browseCatalog({ source_instance_id: instanceId });
  });

  it("threads language filters through browse and the language facet endpoint", async () => {
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("audio_lang")).toBe("ja");
      expect(url.searchParams.get("subtitle_lang")).toBe("en,fr");
      if (url.pathname === "/api/v1/catalog/languages") {
        return jsonResponse(200, {
          audio: [{ code: "ja", name: "Japanese", count: 3 }],
          subtitle: [{ code: "en", name: "English", count: 2 }],
        });
      }
      expect(url.pathname).toBe("/api/v1/catalog");
      return jsonResponse(200, { items: [], total: 0 });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const params = { audio_lang: "ja", subtitle_lang: "en,fr" };
    await client.browseCatalog(params);
    const facets = await client.catalogLanguages({ kind: "movie", ...params });
    expect(facets.audio[0]?.code).toBe("ja");
    expect(facets.subtitle[0]?.count).toBe(2);
  });

  it("lists authenticated catalog kinds visible to the caller", async () => {
    const fetchImpl = mockFetch((request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/catalog/kinds");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      return jsonResponse(200, ["movie", "site"]);
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    await expect(client.listCatalogKinds()).resolves.toEqual(["movie", "site"]);
  });

  it("throws ApiError with the parsed body on a non-2xx response", async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 404, statusText: "Not Found" }));
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });

    await expect(client.getWork("does-not-exist")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    });
  });

  it("round-trips a movie's real, resolved media_file_id from WorkDetailSchema", async () => {
    const workId = "3f8b3e2a-1111-4a11-9a11-000000000001";
    const mediaFileId = "9c1d2e3f-2222-4b22-9b22-000000000002";
    const fetchImpl = mockFetch((request) => {
      expect(new URL(request.url).pathname).toBe(`/api/v1/catalog/${workId}`);
      return jsonResponse(200, {
        work: {
          id: workId,
          kind: "movie",
          external_refs: [],
          title: "Voyage",
          sort_title: "Voyage",
          images: [],
          genres: [],
          tags: [],
          added_at: "2024-01-01T00:00:00Z",
          monitored: true,
          availability: "available",
        },
        children: "Movie",
        media_file_id: mediaFileId,
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const detail = await client.getWork(workId);

    expect(detail.media_file_id).toBe(mediaFileId);
    expect(detail.children).toBe("Movie");
  });

  it("fetches a movie's authenticated cast and crew credits", async () => {
    const workId = "3f8b3e2a-1111-4a11-9a11-000000000001";
    const personId = "4f8b3e2a-1111-4a11-9a11-000000000001";
    const fetchImpl = mockFetch((request) => {
      expect(new URL(request.url).pathname).toBe(`/api/v1/catalog/${workId}/credits`);
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      return jsonResponse(200, {
        cast: [
          {
            id: "5f8b3e2a-1111-4a11-9a11-000000000001",
            person: {
              id: personId,
              name: "Sample Actress",
              headshot_url: "https://example.test/sample-actress.jpg",
            },
            character: "Sample Character Two",
          },
        ],
        crew: [],
      });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    const credits = await client.getWorkCredits(workId);

    expect(credits.cast[0]?.person.name).toBe("Sample Actress");
    expect(credits.cast[0]?.character).toBe("Sample Character Two");
    expect(credits.crew).toEqual([]);
  });

  it("fetches authenticated similar titles with the requested limit", async () => {
    const workId = "3f8b3e2a-1111-4a11-9a11-000000000001";
    const similarId = "3f8b3e2a-1111-4a11-9a11-000000000002";
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe(`/api/v1/catalog/${workId}/similar`);
      expect(url.searchParams.get("limit")).toBe("12");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      return jsonResponse(200, [
        {
          id: similarId,
          kind: "movie",
          external_refs: [],
          title: "Sample Movie 2049",
          sort_title: "Sample Movie 2049",
          images: [],
          genres: ["science fiction"],
          tags: [],
          added_at: "2024-01-01T00:00:00Z",
          monitored: true,
          availability: "available",
        },
      ]);
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    const similar = await client.getSimilarWorks(workId, 12);

    expect(similar).toHaveLength(1);
    expect(similar[0]?.id).toBe(similarId);
  });

  it("fetches authenticated Playarr Server-cached work artwork as a blob", async () => {
    const workId = "3f8b3e2a-1111-4a11-9a11-000000000001";
    const getAccessToken = vi.fn(async () => "access-token");
    const fetchImpl = mockFetch((request) => {
      expect(new URL(request.url).pathname).toBe(
        `/api/v1/artwork/work/${workId}/backdrop`
      );
      expect(request.headers.get("Authorization")).toBe("Bearer access-token");
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken });

    const artwork = await client.getWorkArtwork(workId, "backdrop");

    expect(artwork).toBeInstanceOf(Blob);
    expect(artwork.type).toBe("image/jpeg");
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it("fetches authenticated Playarr Server-cached album artwork as a blob", async () => {
    const artistWorkId = "3f8b3e2a-1111-4a11-9a11-000000000001";
    const albumId = "4f8b3e2a-1111-4a11-9a11-000000000002";
    const getAccessToken = vi.fn(async () => "access-token");
    const fetchImpl = mockFetch((request) => {
      expect(new URL(request.url).pathname).toBe(
        `/api/v1/artwork/album/${artistWorkId}/${albumId}/poster`
      );
      expect(request.headers.get("Authorization")).toBe("Bearer access-token");
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken });

    const artwork = await client.getAlbumArtwork(artistWorkId, albumId, "poster");

    expect(artwork).toBeInstanceOf(Blob);
    expect(artwork.type).toBe("image/jpeg");
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it("fetches an authenticated episode still as a blob", async () => {
    const seriesId = "3f8b3e2a-1111-4a11-9a11-000000000001";
    const episodeId = "4f8b3e2a-1111-4a11-9a11-000000000002";
    const getAccessToken = vi.fn(async () => "access-token");
    const fetchImpl = mockFetch((request) => {
      expect(new URL(request.url).pathname).toBe(
        `/api/v1/artwork/episode/${seriesId}/${episodeId}/thumb`
      );
      expect(request.headers.get("Authorization")).toBe("Bearer access-token");
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken });

    const artwork = await client.getEpisodeArtwork(seriesId, episodeId);

    expect(artwork).toBeInstanceOf(Blob);
    expect(artwork.type).toBe("image/jpeg");
  });

  it("resolves media_file_id to null for a series whose leaves live on its episodes instead", async () => {
    const workId = "3f8b3e2a-1111-4a11-9a11-000000000003";
    const episodeMediaFileId = "9c1d2e3f-2222-4b22-9b22-000000000004";
    const fetchImpl = mockFetch(() =>
      jsonResponse(200, {
        work: {
          id: workId,
          kind: "series",
          external_refs: [],
          title: "Test Series H",
          sort_title: "Test Series H",
          images: [],
          genres: [],
          tags: [],
          added_at: "2024-01-01T00:00:00Z",
          monitored: true,
          availability: "partially_available",
        },
        children: {
          Series: [
            {
              season: {
                id: "s1",
                series_work_id: workId,
                season_number: 1,
                monitored: true,
                availability: "partially_available",
              },
              episodes: [
                {
                  episode: {
                    id: "e1",
                    season_id: "s1",
                    episode_number: 1,
                    monitored: true,
                    availability: "available",
                  },
                  media_file_id: episodeMediaFileId,
                },
              ],
            },
          ],
        },
        media_file_id: null,
      })
    );

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const detail = await client.getWork(workId);

    expect(detail.media_file_id).toBeNull();
    if (typeof detail.children === "object" && "Series" in detail.children) {
      expect(detail.children.Series[0]?.episodes[0]?.media_file_id).toBe(episodeMediaFileId);
    } else {
      expect.unreachable("expected children to be the Series variant");
    }
  });

  it("requests a device code with the real DeviceCodeRequest/DeviceCodeResponseSchema shapes", async () => {
    const fetchImpl = mockFetch(async (request) => {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).pathname).toBe("/api/v1/oauth/device/code");
      expect(await request.json()).toEqual({ client_platform: "tv-webos" });
      return jsonResponse(200, {
        device_code: "devcode-123",
        user_code: "ABCD-EFGH",
        verification_uri: "https://playarr.example/link",
        verification_uri_complete: "https://playarr.example/link?code=ABCD-EFGH",
        expires_in: 1800,
        interval: 5,
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const response = await client.requestDeviceCode({ client_platform: "tv-webos" });

    expect(response.user_code).toBe("ABCD-EFGH");
    expect(response.interval).toBe(5);
  });

  it("approves a TV code with the viewer bearer token", async () => {
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/oauth/device/authorize");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      expect(await request.json()).toEqual({ user_code: "WXYZ-1234" });
      return new Response(null, { status: 204 });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    await client.authorizeDevice({ user_code: "WXYZ-1234" });
  });

  it("surfaces the RFC 8628 OAuthErrorBody on a 400 token response via ApiError.body", async () => {
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/oauth/token");
      expect(await request.json()).toEqual({
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: "devcode-123",
      });
      return jsonResponse(400, { error: "authorization_pending" });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });

    try {
      await client.requestDeviceToken({ grant_type: DEVICE_CODE_GRANT_TYPE, device_code: "devcode-123" });
      expect.unreachable("expected requestDeviceToken to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).body).toEqual({ error: "authorization_pending" });
    }
  });

  it("does NOT call getAccessToken or attach an Authorization header for unprotected operations (e.g. getVersion)", async () => {
    const getAccessToken = vi.fn(() => "test-token");
    const fetchImpl = mockFetch((request) => {
      expect(request.headers.has("Authorization")).toBe(false);
      return jsonResponse(200, {
        instance_name: "Test Playarr Server",
        server_version: "0.1.0",
        api_version: "0.1.0",
        build_sha: null,
        compatibility: [],
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken });

    const version = await client.getVersion();
    expect(version.instance_name).toBe("Test Playarr Server");
    expect(version.server_version).toBe("0.1.0");
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("exposes the same asynchronous access-token provider used by protected requests", async () => {
    const getAccessToken = vi.fn(async () => "centrally-refreshed-token");
    const client = new ApiClient({ baseUrl: BASE_URL, getAccessToken });

    await expect(client.getAccessToken({ forceRefresh: true })).resolves.toBe(
      "centrally-refreshed-token"
    );
    expect(getAccessToken).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("reads and updates authenticated Playarr Server system settings", async () => {
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/admin/system-settings");
      expect(request.headers.get("Authorization")).toBe("Bearer admin-token");
      if (request.method === "PUT") {
        expect(await request.json()).toEqual({ instance_name: "REGION-A" });
        return jsonResponse(200, { instance_name: "REGION-A" });
      }
      return jsonResponse(200, { instance_name: "Playarr Server" });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "admin-token",
    });

    await expect(client.getSystemSettings()).resolves.toEqual({ instance_name: "Playarr Server" });
    await expect(client.updateSystemSettings({ instance_name: "REGION-A" })).resolves.toEqual({
      instance_name: "REGION-A",
    });
  });

  it("reads server capabilities with admin authentication and optional refresh", async () => {
    const seen: string[] = [];
    const fetchImpl = mockFetch(async (request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/v1/admin/system/capabilities");
      expect(request.headers.get("Authorization")).toBe("Bearer admin-token");
      seen.push(url.searchParams.get("refresh") ?? "");
      return jsonResponse(200, {
        generated_at: "2026-10-03T00:00:00Z",
        cached: false,
        items: [],
      });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "admin-token",
    });

    await expect(client.getSystemCapabilities()).resolves.toMatchObject({ cached: false });
    await client.getSystemCapabilities({ refresh: true });
    expect(seen).toEqual(["false", "true"]);
  });

  it("reads and updates the signed-in profile avatar with authentication", async () => {
    const customPreference = {
      kind: "custom" as const,
      value: "data:image/jpeg;base64,YXZhdGFy",
    };
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/users/me/profile-avatar");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      if (request.method === "PUT") {
        await expect(request.json()).resolves.toEqual({ preference: customPreference });
      }
      return jsonResponse(200, { preference: customPreference });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    await expect(client.getProfileAvatar()).resolves.toEqual({
      preference: customPreference,
    });
    await expect(
      client.updateProfileAvatar({ preference: customPreference })
    ).resolves.toEqual({ preference: customPreference });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("logs in with the real LoginRequest shape and parses a real LoginResponse", async () => {
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/auth/login");
      expect(request.headers.has("Authorization")).toBe(false);
      expect(await request.json()).toEqual({
        device_id: "d1",
        device_name: "Playarr Server Web",
        client_platform: "web",
        client_version: "1.0.0",
      });
      return jsonResponse(200, {
        access_token: "at-1",
        refresh_token: "rt-1",
        token_type: "Bearer",
        expires_in: 3600,
        user_id: "00000000-0000-0000-0000-000000000009",
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const response = await client.login({
      device_id: "d1",
      device_name: "Playarr Server Web",
      client_platform: "web",
      client_version: "1.0.0",
    });

    expect(response.access_token).toBe("at-1");
    expect(response.user_id).toBe("00000000-0000-0000-0000-000000000009");
  });

  it("redeems a user invite without attaching an access token", async () => {
    const getAccessToken = vi.fn(() => "should-not-be-used");
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/auth/signup");
      expect(request.headers.has("Authorization")).toBe(false);
      expect(await request.json()).toEqual({
        invite_token: "one-use-token",
        username: "alice",
        display_name: "Alice",
        password: "secure password",
      });
      return jsonResponse(200, {
        id: "00000000-0000-0000-0000-000000000010",
        username: "alice",
        display_name: "Alice",
        email: null,
        is_admin: false,
        can_stream: true,
        library_allow: [],
        disabled: false,
        created_at: "2026-07-17T00:00:00Z",
        preferred_audio_language: "en",
      });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken });

    const user = await client.signup({
      invite_token: "one-use-token",
      username: "alice",
      display_name: "Alice",
      password: "secure password",
    });

    expect(user.username).toBe("alice");
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("attaches administrator authentication when issuing a user invite", async () => {
    const getAccessToken = vi.fn(() => "admin-token");
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/admin/user-invites");
      expect(request.headers.get("Authorization")).toBe("Bearer admin-token");
      await expect(request.json()).resolves.toEqual({
        can_stream: true,
        library_allow: ["11111111-1111-4111-8111-111111111111"],
        expires_at: "2026-07-25T12:00:00Z",
      });
      return jsonResponse(200, {
        invite_token: "one-use-token",
        expires_at: "2026-07-18T00:00:00Z",
      });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken });

    const invite = await client.createUserInvite({
      can_stream: true,
      library_allow: ["11111111-1111-4111-8111-111111111111"],
      expires_at: "2026-07-25T12:00:00Z",
    });

    expect(invite.invite_token).toBe("one-use-token");
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it("sends requester context and administrator-selected invite access", async () => {
    const libraryId = "22222222-2222-4222-8222-222222222222";
    const fetchImpl = mockFetch(async (request) => {
      const url = new URL(request.url);
      expect(request.headers.get("Authorization")).toBe("Bearer access-token");
      if (url.pathname === "/api/v1/users/me/user-invite-request") {
        await expect(request.json()).resolves.toEqual({ message: "For Sam — films, please." });
      } else {
        expect(url.pathname).toBe("/api/v1/admin/user-invite-requests/request-1");
        await expect(request.json()).resolves.toEqual({
          approved: true,
          can_stream: true,
          library_allow: [libraryId],
        });
      }
      return jsonResponse(200, {
        id: "request-1",
        user_id: "user-1",
        username: "requester",
        display_name: "Requester",
        message: "For Sam — films, please.",
        status: url.pathname.includes("admin") ? "approved" : "pending",
        requested_at: "2026-07-18T00:00:00Z",
        can_stream: true,
        library_allow: url.pathname.includes("admin") ? [libraryId] : [],
      });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "access-token",
    });

    const requested = await client.createUserInviteRequest({
      message: "For Sam — films, please.",
    });
    expect(requested.message).toBe("For Sam — films, please.");

    const approved = await client.reviewUserInviteRequest("request-1", {
      approved: true,
      can_stream: true,
      library_allow: [libraryId],
    });
    expect(approved.library_allow).toEqual([libraryId]);
  });

  it("registers a web push installation with viewer authentication", async () => {
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/users/me/push-registrations");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      await expect(request.json()).resolves.toEqual({
        token: "firebase-installation-id",
        platform: "web",
      });
      return new Response(null, { status: 204 });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    await expect(
      client.registerPush({ token: "firebase-installation-id", platform: "web" })
    ).resolves.toBeUndefined();
  });

  it("builds playback-info query params from PlaybackInfoParams (camelCase -> wire snake_case)", async () => {
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/v1/playback/media-file-1");
      expect(url.searchParams.get("containers")).toBe("mp4");
      expect(url.searchParams.get("video_codecs")).toBe("h264");
      expect(url.searchParams.get("max_bitrate_bps")).toBe("4000000");
      expect(url.searchParams.get("profile")).toBe("h264-720p-4mbps");
      expect(url.searchParams.get("force_transcode")).toBe("true");
      expect(url.searchParams.get("start_position_ms")).toBe("1234567");
      expect(url.searchParams.get("audio_stream_index")).toBe("4");
      return jsonResponse(200, {
        mode: "hls",
        url: "/api/v1/media/sessions/session-1/playlist.m3u8",
        session_id: "00000000-0000-0000-0000-000000000001",
        selected_quality_id: "h264-720p-4mbps",
        quality_options: [],
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const info = await client.getPlaybackInfo("media-file-1", {
      containers: "mp4",
      videoCodecs: "h264",
      maxBitrateBps: 4_000_000,
      profile: "h264-720p-4mbps",
      forceTranscode: true,
      startPositionMs: 1_234_567,
      audioStreamIndex: 4,
    });

    expect(info.mode).toBe("hls");
    expect(client.resolveUrl(info.url)).toBe(
      "http://localhost:8484/api/v1/media/sessions/session-1/playlist.m3u8"
    );
  });

  it("records an authenticated playback stop event", async () => {
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe(
        "/api/v1/playback/sessions/session-1/events"
      );
      expect(request.method).toBe("POST");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      expect(await request.json()).toEqual({
        kind: "stop",
        reason: "user_stopped",
        position_ms: 12_000,
      });
      return new Response(null, { status: 204 });
    });

    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: async () => "viewer-token",
    });
    await client.recordPlaybackEvent("session-1", {
      kind: "stop",
      reason: "user_stopped",
      position_ms: 12_000,
    });
  });

  it("posts a playback health report with streaming authentication", async () => {
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/playback/sessions/session-1/health");
      expect(request.method).toBe("POST");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      expect(await request.json()).toEqual({ measured: { dropped_frames: 3 } });
      return jsonResponse(200, { headline: "Playing well", findings: [], facts: [] });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });
    const report = await client.getPlaybackHealth("session-1", {
      measured: { dropped_frames: 3 },
    });
    expect(report.headline).toBe("Playing well");
  });

  it("times a bounded connection test and propagates cancellation", async () => {
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/v1/playback/connection-test");
      expect(url.searchParams.get("bytes")).toBe("2048");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      if (request.signal.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(new Uint8Array(2048), { status: 200 });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });
    const result = await client.runConnectionTest({ bytes: 2048 });
    expect(result.bytes).toBe(2048);
    expect(result.throughputBps).toBeGreaterThan(0);

    const controller = new AbortController();
    controller.abort();
    await expect(
      client.runConnectionTest({ bytes: 2048, signal: controller.signal })
    ).rejects.toThrow();
  });

  it("fetches real embedded media chapters with streaming authentication", async () => {
    const fetchImpl = mockFetch((request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/media/media-file-1/chapters");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      return jsonResponse(200, [
        { index: 0, title: "Opening", start_ms: 0, end_ms: 65_432 },
        { index: 1, start_ms: 65_432, end_ms: 120_000 },
      ]);
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    const chapters = await client.getMediaChapters("media-file-1");

    expect(chapters).toHaveLength(2);
    expect(chapters[1]?.title).toBeUndefined();
    expect(chapters[1]?.start_ms).toBe(65_432);
  });

  it("fetches persisted media runtime metadata with streaming authentication", async () => {
    const fetchImpl = mockFetch((request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/media/media-file-1/metadata");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      return jsonResponse(200, { duration_ms: 3_643_424 });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    const metadata = await client.getMediaMetadata("media-file-1");

    expect(metadata.duration_ms).toBe(3_643_424);
  });

  it("fetches an authenticated WebVTT subtitle with its source offset", async () => {
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/v1/media/media-file-1/subtitles/3");
      expect(url.searchParams.get("source_offset_ms")).toBe("65432");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      return new Response("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n", {
        status: 200,
        headers: { "content-type": "text/vtt" },
      });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    const subtitle = await client.getMediaSubtitle("media-file-1", 3, 65_432);

    expect(subtitle).toBeInstanceOf(Blob);
    expect(subtitle.type).toBe("text/vtt");
    expect(await subtitle.text()).toContain("WEBVTT");
  });

  it("fetches an authenticated episode thumbnail as a JPEG blob", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe(
        "/api/v1/media/media-file-1/thumbnail"
      );
      expect(url.searchParams.get("position_ms")).toBe("65432");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      return new Response(jpegBytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    const thumbnail = await client.getMediaThumbnail("media-file-1", 65_432);

    expect(thumbnail).toBeInstanceOf(Blob);
    expect(thumbnail.type).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await thumbnail.arrayBuffer()))).toEqual(
      Array.from(jpegBytes)
    );
  });

  it("gets and persists authenticated per-media playback choices", async () => {
    const requests: Request[] = [];
    const response = {
      quality_options: [
        {
          id: "original",
          label: "Original",
          profile: null,
          height: null,
          video_bitrate_bps: null,
        },
      ],
      audio_tracks: [],
      subtitle_tracks: [],
      preferences: {
        quality_id: "original",
        audio_track_id: null,
        subtitle_track_id: null,
      },
    };
    const fetchImpl = mockFetch(async (request) => {
      requests.push(request);
      expect(new URL(request.url).pathname).toBe(
        "/api/v1/media/media-file-1/playback-options"
      );
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      if (request.method === "PATCH") {
        expect(await request.json()).toEqual(response.preferences);
      }
      return jsonResponse(200, response);
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    expect((await client.getMediaPlaybackOptions("media-file-1")).preferences).toEqual(
      response.preferences
    );
    expect(
      (
        await client.updateMediaPlaybackOptions(
          "media-file-1",
          response.preferences
        )
      ).preferences
    ).toEqual(response.preferences);
    expect(requests.map((request) => request.method)).toEqual(["GET", "PATCH"]);
  });

  it("lists and updates authenticated watch progress with ergonomic field names", async () => {
    const requests: Request[] = [];
    const fetchImpl = mockFetch(async (request) => {
      requests.push(request);
      const url = new URL(request.url);
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");

      if (url.pathname === "/api/v1/playback/progress") {
        return jsonResponse(200, []);
      }

      expect(url.pathname).toBe("/api/v1/playback/media-file-1/progress");
      expect(request.method).toBe("PUT");
      expect(await request.json()).toEqual({
        position_ms: 45_000,
        duration_ms: 100_000,
        completed: false,
      });
      return jsonResponse(200, {
        media_file_id: "media-file-1",
        work_id: "work-1",
        position_ms: 45_000,
        duration_ms: 100_000,
        state: "part_watched",
        updated_at: "2026-07-16T00:00:00Z",
      });
    });

    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    expect(await client.listWatchProgress()).toEqual([]);
    const progress = await client.updateWatchProgress("media-file-1", {
      positionMs: 45_000,
      durationMs: 100_000,
      completed: false,
    });

    expect(progress.state).toBe("part_watched");
    expect(requests).toHaveLength(2);
  });

  it("gets and updates the signed-in user's player audio language", async () => {
    const requests: Request[] = [];
    const fetchImpl = mockFetch(async (request) => {
      requests.push(request);
      expect(new URL(request.url).pathname).toBe(
        "/api/v1/users/me/player-preferences"
      );
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      if (request.method === "GET") {
        return jsonResponse(200, { preferred_audio_language: "en" });
      }
      expect(await request.json()).toEqual({ preferred_audio_language: "fr" });
      return jsonResponse(200, { preferred_audio_language: "fr" });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    expect(await client.getPlayerPreferences()).toEqual({
      preferred_audio_language: "en",
    });
    expect(
      await client.updatePlayerPreferences({ preferred_audio_language: "fr" })
    ).toEqual({ preferred_audio_language: "fr" });
    expect(requests).toHaveLength(2);
  });

  it("fetches the signed-in user's own capability grants with viewer authentication", async () => {
    const requests: Request[] = [];
    const fetchImpl = mockFetch(async (request) => {
      requests.push(request);
      expect(new URL(request.url).pathname).toBe("/api/v1/users/me/capabilities");
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");
      return jsonResponse(200, { can_download: true });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    expect(await client.getSelfCapabilities()).toEqual({ can_download: true });
    expect(requests).toHaveLength(1);
  });

  it("lists profiles and manages profile PIN locks with viewer authentication", async () => {
    const requests: Request[] = [];
    const fetchImpl = mockFetch(async (request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      expect(request.headers.get("Authorization")).toBe("Bearer viewer-token");

      if (path === "/api/v1/users/profiles") {
        return jsonResponse(200, [
          {
            id: "profile-1",
            username: "alex",
            display_name: "Alex",
            is_current: true,
            pin_locked: false,
          },
        ]);
      }
      if (path === "/api/v1/users/me/profile-pin" && request.method === "GET") {
        return jsonResponse(200, { pin_locked: false });
      }
      if (path === "/api/v1/users/me/profile-pin" && request.method === "PATCH") {
        expect(await request.json()).toEqual({ pin: "1234" });
        return jsonResponse(200, { pin_locked: true });
      }
      expect(path).toBe("/api/v1/users/profiles/profile-1/verify-pin");
      expect(await request.json()).toEqual({ pin: "1234" });
      return jsonResponse(200, { verified: true });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "viewer-token",
    });

    expect(await client.listAvailableProfiles()).toHaveLength(1);
    expect(await client.getProfilePinSetting()).toEqual({ pin_locked: false });
    expect(await client.updateProfilePinSetting({ pin: "1234" })).toEqual({
      pin_locked: true,
    });
    expect(await client.verifyProfilePin("profile-1", { pin: "1234" })).toEqual({
      verified: true,
    });
    expect(requests).toHaveLength(4);
  });

  it("runs the authenticated peer-group operator flow", async () => {
    const requests: Request[] = [];
    const selfNode = {
      id: "peer-a",
      group_id: "group-1",
      name: "Home",
      addresses: [
        {
          url: "https://home.example.test",
          label: "Public",
          priority: 0,
          client_reachable: true,
        },
      ],
      public_key: "public-key",
      status: "active",
      is_self: true,
      joined_at: "2026-07-22T00:00:00Z",
      last_seen_at: null,
      last_sync_error: null,
      updated_at: "2026-07-22T00:00:00Z",
    } as const;
    const fetchImpl = mockFetch(async (request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      expect(request.headers.get("Authorization")).toBe("Bearer admin-token");

      if (path === "/api/v1/admin/peer-nodes/self") {
        expect(await request.json()).toEqual({
          name: "Home",
          addresses: selfNode.addresses,
        });
        return jsonResponse(200, selfNode);
      }
      if (path === "/api/v1/admin/peer-groups" && request.method === "POST") {
        expect(await request.json()).toEqual({ name: "Family" });
        return jsonResponse(200, {
          group: { id: "group-1", name: "Family", created_at: "2026-07-22T00:00:00Z" },
          self_node: selfNode,
        });
      }
      if (path === "/api/v1/admin/peer-groups/join-tokens") {
        return jsonResponse(200, {
          join_token: "single-use-token",
          expires_at: "2026-07-22T00:15:00Z",
        });
      }
      if (path === "/api/v1/admin/peer-groups/join") {
        expect(await request.json()).toEqual({
          seed_address: "https://home.example.test",
          join_token: "single-use-token",
        });
        return jsonResponse(200, {
          group: { id: "group-1", name: "Family", created_at: "2026-07-22T00:00:00Z" },
          members: [selfNode],
        });
      }
      if (path === "/api/v1/admin/peer-nodes") {
        return jsonResponse(200, [selfNode]);
      }
      if (path === "/api/v1/admin/peer-nodes/peer-a/sync-status") {
        return jsonResponse(200, {
          peer_node_id: "peer-a",
          name: "Home",
          status: null,
          detail: null,
          error: null,
          started_at: null,
          finished_at: null,
        });
      }
      expect(path).toBe("/api/v1/admin/peer-groups/self/address-bundle");
      return jsonResponse(200, {
        group_id: "group-1",
        group_name: "Family",
        addresses: [{ peer_node_id: "peer-a", url: "https://home.example.test" }],
      });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: () => "admin-token",
    });

    await expect(
      client.updateSelfPeerNode({ name: "Home", addresses: [...selfNode.addresses] })
    ).resolves.toMatchObject({ name: "Home" });
    await expect(client.foundPeerGroup({ name: "Family" })).resolves.toMatchObject({
      group: { id: "group-1" },
    });
    await expect(client.createPeerJoinToken()).resolves.toMatchObject({
      join_token: "single-use-token",
    });
    await expect(
      client.joinPeerGroup({
        seed_address: "https://home.example.test",
        join_token: "single-use-token",
      })
    ).resolves.toMatchObject({ members: [selfNode] });
    await expect(client.listPeerNodes()).resolves.toEqual([selfNode]);
    await expect(client.getPeerNodeSyncStatus("peer-a")).resolves.toMatchObject({
      peer_node_id: "peer-a",
    });
    await expect(client.getPeerAddressBundle()).resolves.toMatchObject({
      group_name: "Family",
    });
    expect(requests).toHaveLength(7);
  });
});

describe("discovery and watchlist", () => {
  it("sends bearer-authenticated discover, watchlist and resolve requests", async () => {
    const requests: Array<{ method: string; url: string; auth: string | null; body: string }> = [];
    const fetchImpl = mockFetch(async (request) => {
      requests.push({
        method: request.method,
        url: request.url,
        auth: request.headers.get("authorization"),
        body: await request.clone().text(),
      });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      if (request.url.includes("/api/v1/discover?")) {
        return jsonResponse(200, { titles: [], providers: [] });
      }
      return jsonResponse(200, { items: [], title: {}, in_watchlist: true, actions: [] });
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      getAccessToken: async () => "viewer-token",
    });
    await client.discover("heat", { scope: "games", limit: 5 });
    await client.listWatchlist();
    const snapshot = { kind: "movie" as const, title: "Orbit", external_refs: [] };
    await client.addToWatchlist(snapshot);
    await client.resolveTitle(snapshot);
    await client.requestTitle(snapshot);
    await client.removeFromWatchlist("tmdb:movie:949");
    expect(requests.map((r) => r.method)).toEqual(["GET", "GET", "POST", "POST", "POST", "DELETE"]);
    expect(requests.every((r) => r.auth === "Bearer viewer-token")).toBe(true);
    expect(requests[0].url).toContain("q=heat");
    expect(requests[0].url).toContain("scope=games");
    expect(requests[5].url).toContain("/api/v1/watchlist/tmdb%3Amovie%3A949");
  });
});

describe("describeApiError", () => {
  it("describes a 401 ApiError distinctly as a sign-in problem", () => {
    expect(describeApiError(new ApiError(401, "Unauthorized", undefined))).toMatch(/sign-in required/i);
  });

  it("describes a 403 ApiError distinctly as a permissions problem", () => {
    expect(describeApiError(new ApiError(403, "Forbidden", undefined))).toMatch(/permission/i);
  });

  it("falls back to the ApiError's own message for every other status", () => {
    const err = new ApiError(404, "Not Found", undefined);
    expect(describeApiError(err)).toBe(err.message);
  });

  it("falls back to a plain Error's message, and to String() for anything else", () => {
    expect(describeApiError(new Error("boom"))).toBe("boom");
    expect(describeApiError("just a string")).toBe("just a string");
  });
});

describe("release calendar client", () => {
  it("builds the calendar query from window, kinds and source", async () => {
    let seen = "";
    const fetchImpl = mockFetch((request) => {
      seen = request.url;
      return jsonResponse(200, { start: "2026-10-01", end: "2026-10-31", entries: [], sources: [] });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken: async () => "tok" });
    await client.getCalendar({
      start: "2026-10-01",
      end: "2026-10-31",
      kinds: ["episode", "movie"],
      sourceInstanceId: "abc",
    });
    const url = new URL(seen);
    expect(url.pathname).toBe("/api/v1/calendar");
    expect(url.searchParams.get("start")).toBe("2026-10-01");
    expect(url.searchParams.get("end")).toBe("2026-10-31");
    expect(url.searchParams.get("kind")).toBe("episode,movie");
    expect(url.searchParams.get("source_instance_id")).toBe("abc");
    expect(fetchImpl.mock.calls[0]![0].headers.get("Authorization")).toBe("Bearer tok");
  });

  it("omits the query string when no params are given", () => {
    expect(buildCalendarQuery()).toBe("");
    expect(buildCalendarQuery({ kinds: [] })).toBe("");
  });

  it("surfaces invalid_range as an ApiError", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(400, { code: "invalid_range" }));
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    await expect(client.getCalendar({ start: "a", end: "b" })).rejects.toMatchObject({ status: 400 });
  });

  it("manages the subscription feed", async () => {
    const calls: string[] = [];
    const fetchImpl = mockFetch((request) => {
      calls.push(`${request.method} ${new URL(request.url).pathname}`);
      if (request.method === "GET") return jsonResponse(200, { active: false });
      if (request.method === "POST") {
        return jsonResponse(201, { url: "https://x/feed/t.ics", token: "t", created_at: "2026-10-04T00:00:00Z" });
      }
      return new Response(null, { status: 204 });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    await expect(client.getCalendarFeed()).resolves.toEqual({ active: false });
    await expect(client.createCalendarFeed()).resolves.toMatchObject({ token: "t" });
    await expect(client.revokeCalendarFeed()).resolves.toBeUndefined();
    expect(calls).toEqual([
      "GET /api/v1/calendar/feed",
      "POST /api/v1/calendar/feed",
      "DELETE /api/v1/calendar/feed",
    ]);
  });

  it("fetches availability lag for a work", async () => {
    let path = "";
    const fetchImpl = mockFetch((request) => {
      path = new URL(request.url).pathname;
      return jsonResponse(200, {
        average_seconds: null,
        sample_count: 0,
        backfill_count: 1,
        unknown_count: 2,
        backfill_threshold_days: 30,
        average_grab_seconds: null,
        samples: [],
      });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const lag = await client.getAvailabilityLag("w-1");
    expect(path).toBe("/api/v1/catalog/w-1/availability-lag");
    expect(lag.average_seconds).toBeNull();
    expect(lag.backfill_count).toBe(1);
  });
});
describe("ApiClient portable user data", () => {
  it("sends the package as a bound, bearer-authenticated binary upload and never a user id", async () => {
    const seen: { url: URL; method: string; auth: string | null; type: string | null }[] = [];
    const fetchImpl = mockFetch(async (request) => {
      const url = new URL(request.url);
      seen.push({
        url,
        method: request.method,
        auth: request.headers.get("Authorization"),
        type: request.headers.get("Content-Type"),
      });
      if (url.pathname.endsWith("/preview")) {
        return jsonResponse(200, { package_sha256: "abc123" });
      }
      return jsonResponse(200, { completed: true });
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken: async () => "tok" });
    const file = new Blob([new Uint8Array([80, 75, 3, 4])]);

    const preview = await client.previewUserDataImport(file, {
      includePreferences: true,
      progressConflicts: "keep_existing",
    });
    expect(preview.package_sha256).toBe("abc123");
    await client.applyUserDataImport(file, preview.package_sha256, { progressConflicts: "newest" });

    expect(seen[0]!.url.pathname).toBe("/api/v1/users/me/data-imports/preview");
    expect(seen[0]!.url.searchParams.get("include_preferences")).toBe("true");
    expect(seen[0]!.url.searchParams.get("progress_conflicts")).toBe("keep_existing");
    expect(seen[1]!.url.pathname).toBe("/api/v1/users/me/data-imports");
    expect(seen[1]!.url.searchParams.get("package_sha256")).toBe("abc123");
    for (const call of seen) {
      expect(call.method).toBe("POST");
      expect(call.auth).toBe("Bearer tok");
      expect(call.type).toBe("application/zip");
      expect(call.url.search).not.toMatch(/user_id/);
    }
  });

  it("surfaces an expired export as an ApiError with status 410", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(410, { error: "gone", message: "expired" }));
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken: async () => "tok" });
    await expect(client.downloadUserDataExport("abc")).rejects.toMatchObject({ status: 410 });
  });
});

describe("household errors", () => {
  const blocked = (details: Record<string, unknown>) =>
    new ApiError(403, "Forbidden", {
      error: "household_blocked",
      message: "blocked",
      details,
    });

  it("parses a schedule block with the next start time", () => {
    const err = blocked({ reason: "outside_schedule", next_start_at: "2026-10-05T10:00:00Z" });
    expect(parseHouseholdBlock(err)).toEqual({
      reason: "outside_schedule",
      nextStartAt: "2026-10-05T10:00:00Z",
      resetsAt: undefined,
    });
    expect(describeApiError(err)).toContain("Back at");
  });

  it("parses an exhausted budget and describes when it resets", () => {
    const err = blocked({ reason: "budget_exhausted", resets_at: "2026-10-04T00:00:00Z" });
    expect(parseHouseholdBlock(err)?.reason).toBe("budget_exhausted");
    expect(describeApiError(err)).toContain("watch time is used up");
  });

  it("does not treat an ordinary 403 as a household block", () => {
    const err = new ApiError(403, "Forbidden", { error: "forbidden", message: "nope" });
    expect(parseHouseholdBlock(err)).toBeNull();
    expect(describeApiError(err)).toBe("nope");
  });

  it("reports PIN lockouts in minutes", () => {
    const err = new ApiError(429, "Too Many Requests", {
      error: "pin_locked",
      message: "locked",
      details: { retry_after_seconds: 90 },
    });
    expect(parsePinLockSeconds(err)).toBe(90);
    expect(describeApiError(err)).toBe("Too many incorrect PIN attempts. Try again in 2 minutes.");
    expect(parsePinLockSeconds(new ApiError(429, "x", { error: "other" }))).toBeNull();
  });
});

describe("remote push stream", () => {
  it("parses frames split across chunks and ignores keep-alive comments", () => {
    const parser = new SseParser();
    expect(parser.push("event: ready\ndata: {}\n\n: keep")).toEqual([{ event: "ready", data: "{}" }]);
    expect(parser.push("-alive\n\nevent: inbox\nid: 3\ndata: {\"seq\":3}\r\n\r\n")).toEqual([
      { event: "inbox", data: '{"seq":3}' },
    ]);
  });

  it("streams inbox events with Last-Event-ID and bearer auth", async () => {
    let seen: Request | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode("event: ready\ndata: {}\n\n"));
        controller.enqueue(
          enc.encode('event: inbox\nid: 5\ndata: {"id":"e","seq":5,"kind":"command","created_ms":0,"expires_ms":0}\n\n')
        );
        controller.close();
      },
    });
    const client = new ApiClient({
      baseUrl: "https://example.test",
      getAccessToken: async () => "tok",
      fetchImpl: mockFetch((request) => {
        seen = request;
        return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }),
    });
    const events: number[] = [];
    let opened = false;
    await client.streamRemoteInbox(4, { onOpen: () => (opened = true), onEvent: (e) => void events.push(e.seq) });
    expect(opened).toBe(true);
    expect(events).toEqual([5]);
    expect(seen?.headers.get("Last-Event-ID")).toBe("4");
    expect(seen?.headers.get("Authorization")).toBe("Bearer tok");
  });

  it("reports an unstreamable runtime so callers can long poll", async () => {
    const client = new ApiClient({
      baseUrl: "https://example.test",
      fetchImpl: mockFetch(
        () => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } })
      ),
    });
    await expect(client.streamRemoteInbox(0, { onEvent: () => undefined })).rejects.toBeInstanceOf(
      PushUnsupportedError
    );
  });
});
