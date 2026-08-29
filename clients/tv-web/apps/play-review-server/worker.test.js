import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import worker, { reviewServerInternals } from "./worker.js";

const ENV = {
  REVIEW_USERNAME: "google-play-reviewer",
  REVIEW_PASSWORD: "test-only-password",
  TOKEN_SIGNING_SECRET: "test-only-signing-secret-with-enough-entropy",
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function login(overrides = {}) {
  return worker.fetch(
    new Request("https://review.playarr.app/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: "review-device",
        device_name: "Review device",
        client_platform: "android-mobile",
        client_version: "0.1.0",
        username: ENV.REVIEW_USERNAME,
        password: ENV.REVIEW_PASSWORD,
        ...overrides,
      }),
    }),
    ENV,
  );
}

async function accessToken() {
  const response = await login();
  assert.equal(response.status, 200);
  return (await response.json()).access_token;
}

async function authorised(path, init = {}) {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return worker.fetch(new Request(`https://review.playarr.app${path}`, { ...init, headers }), ENV);
}

describe("review authentication", () => {
  it("fails closed when Worker secrets are missing", async () => {
    const response = await worker.fetch(new Request("https://review.playarr.app/api/system/health"), {});
    assert.equal(response.status, 503);
  });

  it("accepts only the configured reusable reviewer credentials", async () => {
    const accepted = await login();
    assert.equal(accepted.status, 200);
    const body = await accepted.json();
    assert.equal(body.user_id, reviewServerInternals.USER_ID);
    assert.equal(body.token_type, "Bearer");
    assert.match(body.access_token, /^[^.]+\.[^.]+\.[^.]+$/);
    assert.match(body.refresh_token, /^[^.]+\.[^.]+\.[^.]+$/);

    const denied = await login({ password: "wrong-password" });
    assert.equal(denied.status, 401);
  });

  it("refreshes a valid device-bound review session", async () => {
    const initial = await (await login()).json();
    const refreshed = await worker.fetch(
      new Request("https://review.playarr.app/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: initial.refresh_token, device_id: "review-device" }),
      }),
      ENV,
    );
    assert.equal(refreshed.status, 200);
    assert.equal((await refreshed.json()).token_type, "Bearer");
  });

  it("does not provide a registration endpoint", async () => {
    const response = await worker.fetch(
      new Request("https://review.playarr.app/api/v1/auth/signup", { method: "POST" }),
      ENV,
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "registration_not_available" });
  });
});

describe("single-item review catalogue", () => {
  it("requires a signed access token", async () => {
    const response = await worker.fetch(new Request("https://review.playarr.app/api/v1/catalog"), ENV);
    assert.equal(response.status, 401);
  });

  it("returns exactly one available movie and no other catalogue kinds", async () => {
    const movies = await authorised("/api/v1/catalog?kind=movie");
    assert.equal(movies.status, 200);
    const moviePage = await movies.json();
    assert.equal(moviePage.total, 1);
    assert.equal(moviePage.items.length, 1);
    assert.equal(moviePage.items[0].id, reviewServerInternals.WORK_ID);
    assert.match(moviePage.items[0].overview, /CC BY 3\.0/);

    const series = await authorised("/api/v1/catalog?kind=series");
    assert.deepEqual(await series.json(), { items: [], total: 0 });
  });

  it("returns a playable movie detail and filters search", async () => {
    const detail = await authorised(`/api/v1/catalog/${reviewServerInternals.WORK_ID}`);
    assert.deepEqual((await detail.json()).children, "Movie");

    const found = await authorised("/api/v1/catalog/search?q=bunny");
    assert.equal((await found.json()).items.length, 1);
    const missing = await authorised("/api/v1/catalog/search?q=private-library-title");
    assert.equal((await missing.json()).items.length, 0);
  });

  it("keeps downloads disabled and exposes only the synthetic profile", async () => {
    assert.deepEqual(await (await authorised("/api/v1/users/me/capabilities")).json(), { can_download: false });
    const profiles = await (await authorised("/api/v1/users/profiles")).json();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].id, reviewServerInternals.USER_ID);
  });
});

describe("single allow-listed video", () => {
  it("negotiates only the fixed demo media file", async () => {
    const response = await authorised(`/api/v1/playback/${reviewServerInternals.MEDIA_FILE_ID}`);
    assert.equal(response.status, 200);
    const playback = await response.json();
    assert.equal(playback.mode, "direct");
    assert.equal(playback.mime_type, "video/mp4");
    assert.match(playback.url, new RegExp(`^/api/v1/media/${reviewServerInternals.MEDIA_FILE_ID}/stream\\?`));

    const unknown = await authorised("/api/v1/playback/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(unknown.status, 404);
  });

  it("proxies byte ranges only after a signed playback negotiation", async () => {
    const playback = await (await authorised(`/api/v1/playback/${reviewServerInternals.MEDIA_FILE_ID}`)).json();
    let requestedUrl;
    let requestedHeaders;
    globalThis.fetch = async (url, init) => {
      requestedUrl = url;
      requestedHeaders = new Headers(init.headers);
      return new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": "bytes 0-3/4",
          "Content-Type": "video/mp4",
        },
      });
    };

    const response = await worker.fetch(
      new Request(new URL(playback.url, "https://review.playarr.app"), {
        headers: { Range: "bytes=0-3", Authorization: "Bearer must-not-reach-upstream" },
      }),
      ENV,
    );
    assert.equal(response.status, 206);
    assert.equal(requestedUrl, reviewServerInternals.DEMO_VIDEO_URL);
    assert.equal(requestedHeaders.get("Range"), "bytes=0-3");
    assert.equal(requestedHeaders.get("Accept"), "video/*");
    assert.match(requestedHeaders.get("User-Agent"), /^Playarr-Google-Play-Review\//);
    assert.equal(requestedHeaders.has("Authorization"), false);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 2, 3]);
  });

  it("rejects arbitrary media and invalid playback capabilities", async () => {
    const unknown = await worker.fetch(
      new Request("https://review.playarr.app/api/v1/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/stream"),
      ENV,
    );
    assert.equal(unknown.status, 404);

    const denied = await worker.fetch(
      new Request(`https://review.playarr.app/api/v1/media/${reviewServerInternals.MEDIA_FILE_ID}/stream?playback_session_id=invalid`),
      ENV,
    );
    assert.equal(denied.status, 401);
  });
});
