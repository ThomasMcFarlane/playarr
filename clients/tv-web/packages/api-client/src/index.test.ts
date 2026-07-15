import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, DEVICE_CODE_GRANT_TYPE, describeApiError } from "./index";

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

const BASE_URL = "http://localhost:8080";

describe("ApiClient", () => {
  it("browses the catalog and parses a real CatalogPageSchema response", async () => {
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/v1/catalog");
      expect(url.searchParams.get("kind")).toBe("movie");
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
    const page = await client.browseCatalog({ kind: "movie", limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.title).toBe("Voyage");
    expect(page.total).toBe(1);
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
        verification_uri: "https://streamarr.example/link",
        verification_uri_complete: "https://streamarr.example/link?code=ABCD-EFGH",
        expires_in: 1800,
        interval: 5,
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const response = await client.requestDeviceCode({ client_platform: "tv-webos" });

    expect(response.user_code).toBe("ABCD-EFGH");
    expect(response.interval).toBe(5);
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
        server_version: "0.1.0",
        api_version: "0.1.0",
        build_sha: null,
        compatibility: [],
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken });

    const version = await client.getVersion();
    expect(version.server_version).toBe("0.1.0");
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("does NOT attach an Authorization header to the unauthenticated GET /api/v1/requests list either", async () => {
    const fetchImpl = mockFetch((request) => {
      expect(request.method).toBe("GET");
      expect(request.headers.has("Authorization")).toBe(false);
      return jsonResponse(200, []);
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken: () => "test-token" });
    await client.listRequests();
  });

  it.each([
    ["submitRequest", (client: ApiClient) => client.submitRequest({ kind: "movie", target: { target_kind: "existing_work", work_id: "w1" } })],
    ["approveRequest", (client: ApiClient) => client.approveRequest("req-1", {})],
    ["rejectRequest", (client: ApiClient) => client.rejectRequest("req-1", {})],
  ] as const)("attaches the bearer token from getAccessToken to the protected %s call", async (_name, call) => {
    const fetchImpl = mockFetch((request) => {
      expect(request.headers.get("Authorization")).toBe("Bearer test-token");
      return jsonResponse(200, {
        id: "req-1",
        requested_by: "00000000-0000-0000-0000-000000000001",
        kind: "movie",
        target: { target_kind: "existing_work", work_id: "w1" },
        status: "pending",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken: () => "test-token" });
    await call(client);
  });

  it("submits a SubmitRequestBody with no requested_by field (server derives it from the token)", async () => {
    const fetchImpl = mockFetch(async (request) => {
      const body = (await request.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("requested_by");
      expect(body).toEqual({ kind: "movie", target: { target_kind: "existing_work", work_id: "w1" } });
      return jsonResponse(201, {
        id: "req-1",
        requested_by: "00000000-0000-0000-0000-000000000001",
        kind: "movie",
        target: { target_kind: "existing_work", work_id: "w1" },
        status: "pending",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken: () => "test-token" });
    await client.submitRequest({ kind: "movie", target: { target_kind: "existing_work", work_id: "w1" } });
  });

  it("decides a request with a DecideRequestBody carrying no decided_by field", async () => {
    const fetchImpl = mockFetch(async (request) => {
      const body = (await request.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("decided_by");
      return jsonResponse(200, {
        id: "req-1",
        requested_by: "00000000-0000-0000-0000-000000000001",
        decided_by: "00000000-0000-0000-0000-000000000002",
        kind: "movie",
        target: { target_kind: "existing_work", work_id: "w1" },
        status: "approved",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken: () => "test-token" });
    const updated = await client.approveRequest("req-1", { reason: "looks good" });
    expect(updated.status).toBe("approved");
  });

  it.each([
    ["submitRequest", 401, (client: ApiClient) => client.submitRequest({ kind: "movie", target: { target_kind: "existing_work", work_id: "w1" } })],
    ["approveRequest", 403, (client: ApiClient) => client.approveRequest("req-1", {})],
    ["rejectRequest", 401, (client: ApiClient) => client.rejectRequest("req-1", {})],
  ] as const)(
    "surfaces a %s call's %i response as a distinct ApiError instead of failing silently",
    async (_name, status, call) => {
      const fetchImpl = mockFetch(() => new Response(null, { status, statusText: "unauthorized" }));
      const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, getAccessToken: () => "test-token" });

      await expect(call(client)).rejects.toMatchObject({ name: "ApiError", status });
    }
  );

  it("logs in with the real LoginRequest shape and parses a real LoginResponse", async () => {
    const fetchImpl = mockFetch(async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/auth/login");
      expect(request.headers.has("Authorization")).toBe(false);
      expect(await request.json()).toEqual({
        device_id: "d1",
        device_name: "Streamarr Web",
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
      device_name: "Streamarr Web",
      client_platform: "web",
      client_version: "1.0.0",
    });

    expect(response.access_token).toBe("at-1");
    expect(response.user_id).toBe("00000000-0000-0000-0000-000000000009");
  });

  it("builds playback-info query params from PlaybackInfoParams (camelCase -> wire snake_case)", async () => {
    const fetchImpl = mockFetch((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/v1/playback/media-file-1");
      expect(url.searchParams.get("containers")).toBe("mp4");
      expect(url.searchParams.get("video_codecs")).toBe("h264");
      expect(url.searchParams.get("max_bitrate_bps")).toBe("4000000");
      return jsonResponse(200, { mode: "direct", url: "/api/v1/media/media-file-1/stream" });
    });

    const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl });
    const info = await client.getPlaybackInfo("media-file-1", {
      containers: "mp4",
      videoCodecs: "h264",
      maxBitrateBps: 4_000_000,
    });

    expect(info.mode).toBe("direct");
    expect(client.resolveUrl(info.url)).toBe("http://localhost:8080/api/v1/media/media-file-1/stream");
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
