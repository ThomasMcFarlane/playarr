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

  it("fetches authenticated Streamarr-cached work artwork as a blob", async () => {
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
      "http://localhost:8080/api/v1/media/sessions/session-1/playlist.m3u8"
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
