const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const PLAYBACK_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const ISSUER = "playarr-google-play-review";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORK_ID = "77777777-7777-4777-8777-777777777777";
const MEDIA_FILE_ID = "33333333-3333-4333-8333-333333333333";
const PLAYBACK_SESSION_ID = "99999999-9999-4999-8999-999999999999";
const VIDEO_DURATION_MS = 596_410;

// Big Buck Bunny is an open movie published by the Blender Foundation under
// CC BY 3.0. Internet Archive publishes this seekable 427x240 MPEG-4
// rendition of the film. This fixed allow-listed URL is the only upstream
// media resource the review server can ever return or proxy.
const DEMO_VIDEO_URL =
  "https://archive.org/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4";

// The Android client deliberately uses a raster-only image pipeline. These
// fixed Wikimedia Commons files are frames/artwork from Big Buck Bunny and are
// licensed CC BY 3.0 by the Blender Foundation. Keeping the URLs allow-listed
// prevents the review server from becoming an arbitrary image proxy.
const DEMO_POSTER_URL =
  "https://upload.wikimedia.org/wikipedia/commons/c/c5/Big_buck_bunny_poster_big.jpg";
const DEMO_BACKDROP_URL =
  "https://upload.wikimedia.org/wikipedia/commons/5/5f/BBB-Bunny.png";

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const ALLOWED_WEB_ORIGINS = new Set(["https://playarr.app"]);
const CORS_METHODS = "GET, HEAD, POST, PUT, PATCH, OPTIONS";
const CORS_REQUEST_HEADERS = [
  "Accept",
  "Authorization",
  "Content-Type",
  "If-Modified-Since",
  "If-None-Match",
  "If-Range",
  "Range",
  "X-Playarr-Client-Platform",
  "X-Playarr-Client-Version",
];
const CORS_EXPOSE_HEADERS = [
  "Accept-Ranges",
  "Content-Length",
  "Content-Range",
  "Content-Type",
  "ETag",
  "Last-Modified",
].join(", ");
const ALLOWED_CORS_METHODS = new Set(CORS_METHODS.split(", ").map((method) => method.toLowerCase()));
const ALLOWED_CORS_HEADERS = new Set(CORS_REQUEST_HEADERS.map((header) => header.toLowerCase()));

const WORK = Object.freeze({
  id: WORK_ID,
  kind: "movie",
  external_refs: [],
  title: "Big Buck Bunny",
  sort_title: "Big Buck Bunny",
  overview:
    "An openly licensed Blender Foundation short film, included only so Google Play reviewers can verify Playarr's native catalogue and playback experience. Licensed CC BY 3.0. Attribution: (c) copyright Blender Foundation | www.bigbuckbunny.org.",
  images: [
    {
      kind: "poster",
      url: `/api/v1/artwork/work/${WORK_ID}/poster`,
      width: 1500,
      height: 2122,
    },
    {
      kind: "backdrop",
      url: `/api/v1/artwork/work/${WORK_ID}/backdrop`,
      width: 1280,
      height: 720,
    },
  ],
  genres: ["Animation", "Open movie"],
  tags: ["google-play-review", "cc-by-3.0"],
  release_date: "2008-04-10T00:00:00Z",
  added_at: "2026-08-29T00:00:00Z",
  monitored: false,
  availability: "available",
});

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function empty(status = 204, headers = {}) {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function error(code, status) {
  return json({ error: code }, status);
}

function corsHeaders(origin) {
  if (!origin || !ALLOWED_WEB_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
    Vary: "Origin",
  };
}

function withCors(response, origin) {
  const allowedHeaders = corsHeaders(origin);
  if (!allowedHeaders) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(allowedHeaders)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsPreflight(request) {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_WEB_ORIGINS.has(origin)) return error("cors_origin_not_allowed", 403);
  const method = request.headers.get("Access-Control-Request-Method")?.toLowerCase();
  if (!method || !ALLOWED_CORS_METHODS.has(method)) return error("cors_method_not_allowed", 405);
  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !ALLOWED_CORS_HEADERS.has(header))) {
    return error("cors_header_not_allowed", 403);
  }
  return empty(204, {
    "Access-Control-Allow-Headers": CORS_REQUEST_HEADERS.join(", "),
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  });
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlText(value) {
  return base64Url(new TextEncoder().encode(value));
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function signToken(claims, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlText(JSON.stringify({ iss: ISSUER, iat: now, exp: now + ttlSeconds, ...claims }));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${base64Url(await hmac(unsigned, secret))}`;
}

async function verifyToken(token, secret, expectedKind) {
  if (typeof token !== "string" || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;
  try {
    const expected = await hmac(`${parts[0]}.${parts[1]}`, secret);
    const actual = decodeBase64Url(parts[2]);
    if (actual.length !== expected.length) return null;
    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
    if (difference !== 0) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== ISSUER || claims.kind !== expectedKind || claims.exp <= now || claims.iat > now + 60) return null;
    return claims;
  } catch {
    return null;
  }
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
}

async function secureEqual(left, right) {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

function configurationReady(env) {
  return [env.REVIEW_USERNAME, env.REVIEW_PASSWORD, env.TOKEN_SIGNING_SECRET]
    .every((value) => typeof value === "string" && value.length >= 12);
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > 16_384) throw new Error("request_too_large");
  return request.json();
}

async function login(request, env) {
  if (!configurationReady(env)) return error("review_server_not_configured", 503);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return error("invalid_request", 400);
  }
  const valid = await Promise.all([
    secureEqual(body?.username ?? "", env.REVIEW_USERNAME),
    secureEqual(body?.password ?? "", env.REVIEW_PASSWORD),
  ]);
  if (!valid.every(Boolean)) return error("invalid_credentials", 401);

  const deviceId = typeof body.device_id === "string" ? body.device_id : "google-play-review-device";
  const [accessToken, refreshToken] = await Promise.all([
    signToken(
      { kind: "access", sub: USER_ID, device_id: deviceId, session_id: PLAYBACK_SESSION_ID },
      env.TOKEN_SIGNING_SECRET,
      ACCESS_TOKEN_TTL_SECONDS,
    ),
    signToken(
      { kind: "refresh", sub: USER_ID, device_id: deviceId },
      env.TOKEN_SIGNING_SECRET,
      REFRESH_TOKEN_TTL_SECONDS,
    ),
  ]);
  return json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    user_id: USER_ID,
    peer_addresses: null,
  });
}

async function refresh(request, env) {
  if (!configurationReady(env)) return error("review_server_not_configured", 503);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return error("invalid_request", 400);
  }
  const claims = await verifyToken(body?.refresh_token, env.TOKEN_SIGNING_SECRET, "refresh");
  if (!claims || (body?.device_id && body.device_id !== claims.device_id)) {
    return error("invalid_refresh_token", 401);
  }
  const [accessToken, refreshToken] = await Promise.all([
    signToken(
      { kind: "access", sub: USER_ID, device_id: claims.device_id, session_id: PLAYBACK_SESSION_ID },
      env.TOKEN_SIGNING_SECRET,
      ACCESS_TOKEN_TTL_SECONDS,
    ),
    signToken(
      { kind: "refresh", sub: USER_ID, device_id: claims.device_id },
      env.TOKEN_SIGNING_SECRET,
      REFRESH_TOKEN_TTL_SECONDS,
    ),
  ]);
  return json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  });
}

async function accessClaims(request, env) {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  return verifyToken(header.slice(7).trim(), env.TOKEN_SIGNING_SECRET, "access");
}

function workMatches(url) {
  const kind = url.searchParams.get("kind");
  if (kind && kind !== "movie") return false;
  const query = url.searchParams.get("q")?.trim().toLocaleLowerCase("en") ?? "";
  if (!query) return true;
  return [WORK.title, WORK.overview, ...WORK.genres].join(" ").toLocaleLowerCase("en").includes(query);
}

function cataloguePage(url) {
  const matching = workMatches(url) ? [WORK] : [];
  const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.max(0, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100);
  return { items: matching.slice(offset, offset + limit), total: matching.length };
}

function workDetail() {
  return {
    work: WORK,
    children: "Movie",
    media_file_id: MEDIA_FILE_ID,
    runtime_ms: VIDEO_DURATION_MS,
    available_on: [],
  };
}

function playbackOptions(preferences = {}) {
  const audioTrack = {
    id: "source-audio-1",
    stream_index: 1,
    label: "Original stereo",
    language: "eng",
    codec: "aac",
    channels: 2,
    is_default: true,
  };
  return {
    quality_options: [
      {
        id: "original",
        label: "Original",
        profile: null,
        height: 240,
        video_bitrate_bps: null,
      },
    ],
    audio_tracks: [audioTrack],
    subtitle_tracks: [],
    preferences: {
      quality_id: "original",
      audio_track_id: audioTrack.id,
      subtitle_track_id: null,
      ...preferences,
    },
  };
}

async function playbackInfo(env) {
  const playbackToken = await signToken(
    { kind: "playback", sub: USER_ID, media_file_id: MEDIA_FILE_ID },
    env.TOKEN_SIGNING_SECRET,
    PLAYBACK_TOKEN_TTL_SECONDS,
  );
  return {
    mode: "direct",
    url: `/api/v1/media/${MEDIA_FILE_ID}/stream?playback_session_id=${encodeURIComponent(playbackToken)}`,
    session_id: PLAYBACK_SESSION_ID,
    mime_type: "video/mp4",
    duration_ms: VIDEO_DURATION_MS,
    source_offset_ms: 0,
    audio_tracks: playbackOptions().audio_tracks,
    selected_audio_track_id: "source-audio-1",
    subtitle_tracks: [],
    selected_subtitle_track_id: null,
    selected_quality_id: "original",
    quality_options: playbackOptions().quality_options,
  };
}

function progress(body = {}) {
  const position = Math.max(0, Number(body.position_ms) || 0);
  const duration = Math.max(1, Number(body.duration_ms) || VIDEO_DURATION_MS);
  return {
    media_file_id: MEDIA_FILE_ID,
    work_id: WORK_ID,
    position_ms: position,
    duration_ms: duration,
    state: body.completed ? "watched" : position > 0 ? "part_watched" : "unseen",
    updated_at: position > 0 || body.completed ? new Date().toISOString() : null,
  };
}

async function streamAuthorised(request, url, env) {
  if (await accessClaims(request, env)) return true;
  const token = url.searchParams.get("playback_session_id");
  const claims = await verifyToken(token, env.TOKEN_SIGNING_SECRET, "playback");
  return claims?.sub === USER_ID && claims?.media_file_id === MEDIA_FILE_ID;
}

async function proxyVideo(request) {
  const headers = new Headers({
    Accept: "video/*",
    "User-Agent": "Playarr-Google-Play-Review/1.0 (https://playarr.app/legal/privacy)",
  });
  for (const name of ["Range", "If-Range", "If-None-Match", "If-Modified-Since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let upstream;
  try {
    upstream = await fetch(DEMO_VIDEO_URL, { method: request.method, headers, redirect: "follow" });
  } catch {
    return error("demo_video_unavailable", 502);
  }
  if (![200, 206, 304].includes(upstream.status)) return error("demo_video_unavailable", 502);
  const responseHeaders = new Headers();
  for (const name of ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "private, max-age=3600");
  responseHeaders.set("Content-Disposition", 'inline; filename="big-buck-bunny.mp4"');
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function artwork(kind) {
  const url = kind === "backdrop" ? DEMO_BACKDROP_URL : DEMO_POSTER_URL;
  let upstream;
  try {
    upstream = await fetch(url, {
      headers: {
        Accept: "image/jpeg,image/png,image/*",
        "User-Agent": "Playarr-Google-Play-Review/1.0 (https://playarr.app/legal/privacy)",
      },
      redirect: "follow",
    });
  } catch {
    return error("demo_artwork_unavailable", 502);
  }
  const contentType = upstream.headers.get("Content-Type") ?? "";
  if (upstream.status !== 200 || !/^image\/(?:jpeg|png)(?:;|$)/i.test(contentType)) {
    return error("demo_artwork_unavailable", 502);
  }
  const responseHeaders = new Headers();
  for (const name of ["Content-Length", "Content-Type", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "public, max-age=86400");
  responseHeaders.set("Content-Disposition", `inline; filename="big-buck-bunny-${kind}.${kind === "backdrop" ? "png" : "jpg"}"`);
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, {
    status: 200,
    headers: responseHeaders,
  });
}

async function authenticatedRoute(request, env, url) {
  if (!(await accessClaims(request, env))) return error("invalid_access_token", 401);
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/api/v1/catalog") return json(cataloguePage(url));
  if (request.method === "GET" && pathname === "/api/v1/catalog/kinds") return json(["movie"]);
  if (request.method === "GET" && pathname === "/api/v1/catalog/search") {
    return json({ items: workMatches(url) ? [WORK] : [], remote_only: [] });
  }
  if (request.method === "GET" && pathname === `/api/v1/catalog/${WORK_ID}`) return json(workDetail());
  if (request.method === "GET" && pathname === `/api/v1/catalog/${WORK_ID}/credits`) {
    return json({ cast: [], crew: [] });
  }
  if (request.method === "GET" && pathname === `/api/v1/catalog/${WORK_ID}/similar`) return json([]);
  if (request.method === "GET" && pathname === "/api/v1/views") return json([]);
  if (request.method === "GET" && pathname === "/api/v1/playlists") return json([]);
  if (request.method === "GET" && pathname === "/api/v1/playback/progress") return json([]);
  if (request.method === "GET" && pathname === `/api/v1/playback/${MEDIA_FILE_ID}/progress`) {
    return json(progress());
  }
  if (request.method === "PUT" && pathname === `/api/v1/playback/${MEDIA_FILE_ID}/progress`) {
    let body;
    try {
      body = await readJson(request);
    } catch {
      return error("invalid_request", 400);
    }
    return json(progress(body));
  }
  if (request.method === "GET" && pathname === `/api/v1/playback/${MEDIA_FILE_ID}`) {
    return json(await playbackInfo(env));
  }
  if (request.method === "POST" && pathname === `/api/v1/playback/sessions/${PLAYBACK_SESSION_ID}/events`) {
    return empty();
  }
  if (request.method === "GET" && pathname === `/api/v1/media/${MEDIA_FILE_ID}/chapters`) return json([]);
  if (request.method === "GET" && pathname === `/api/v1/media/${MEDIA_FILE_ID}/metadata`) {
    return json({ duration_ms: VIDEO_DURATION_MS });
  }
  if (["GET", "PATCH"].includes(request.method) && pathname === `/api/v1/media/${MEDIA_FILE_ID}/playback-options`) {
    if (request.method === "GET") return json(playbackOptions());
    let body;
    try {
      body = await readJson(request);
    } catch {
      return error("invalid_request", 400);
    }
    if (body?.quality_id !== "original") return error("invalid_playback_option", 400);
    return json(playbackOptions(body));
  }
  if (request.method === "GET" && pathname === "/api/v1/users/me/capabilities") {
    return json({ can_download: false });
  }
  if (request.method === "GET" && pathname === "/api/v1/users/profiles") {
    return json([{ id: USER_ID, username: env.REVIEW_USERNAME, display_name: "Google Play Reviewer", is_current: true, pin_locked: false }]);
  }
  if (request.method === "POST" && pathname === `/api/v1/users/profiles/${USER_ID}/verify-pin`) {
    return json({ verified: true });
  }
  if (["GET", "PATCH"].includes(request.method) && pathname === "/api/v1/users/me/profile-pin") {
    return json({ pin_locked: false });
  }
  if (["GET", "PATCH"].includes(request.method) && pathname === "/api/v1/users/me/player-preferences") {
    if (request.method === "GET") return json({ preferred_audio_language: "en" });
    let body;
    try {
      body = await readJson(request);
    } catch {
      return error("invalid_request", 400);
    }
    return json({ preferred_audio_language: body?.preferred_audio_language || "en" });
  }
  if (["GET", "PUT"].includes(request.method) && pathname === "/api/v1/users/me/profile-avatar") {
    if (request.method === "GET") return json({ preference: { kind: "preset", value: "astronaut" } });
    let body;
    try {
      body = await readJson(request);
    } catch {
      return error("invalid_request", 400);
    }
    return json({ preference: body?.preference ?? { kind: "preset", value: "astronaut" } });
  }
  if (request.method === "GET" && pathname === "/api/v1/users/me/user-invite-request") return json(null);
  if (request.method === "POST" && pathname === "/api/v1/users/me/push-registrations") return empty();
  const artworkMatch = pathname.match(new RegExp(`^/api/v1/artwork/work/${WORK_ID}/(poster|backdrop)$`));
  if (request.method === "GET" && artworkMatch) return artwork(artworkMatch[1]);

  const knownIdPath = pathname.includes(WORK_ID) || pathname.includes(MEDIA_FILE_ID) || pathname.includes(PLAYBACK_SESSION_ID);
  return error(knownIdPath ? "method_not_supported_by_review_server" : "not_found", knownIdPath ? 405 : 404);
}

async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/") {
    return json({
      service: "Playarr Google Play review server",
      purpose: "Isolated policy-review environment with one CC BY 3.0 demonstration video",
      registration: false,
    });
  }
  if (request.method === "GET" && ["/healthz", "/api/system/health", "/api/system/ready"].includes(pathname)) {
    return configurationReady(env) ? empty(200) : error("review_server_not_configured", 503);
  }
  if (request.method === "GET" && pathname === "/api/system/version") {
    return json({
      instance_name: "Google Play review",
      server_version: "review-1",
      api_version: "v1",
      build_sha: null,
      compatibility: [],
    });
  }
  if (request.method === "POST" && pathname === "/api/v1/auth/login") return login(request, env);
  if (request.method === "POST" && pathname === "/api/v1/auth/refresh") return refresh(request, env);
  if (pathname === "/api/v1/auth/signup") return error("registration_not_available", 404);

  const streamMatch = pathname.match(/^\/api\/v1\/media\/([^/]+)\/stream$/);
  if (["GET", "HEAD"].includes(request.method) && streamMatch) {
    if (streamMatch[1] !== MEDIA_FILE_ID) return error("not_found", 404);
    if (!(await streamAuthorised(request, url, env))) return error("invalid_playback_access", 401);
    return proxyVideo(request);
  }

  return authenticatedRoute(request, env, url);
}

export const reviewServerInternals = Object.freeze({
  DEMO_BACKDROP_URL,
  DEMO_POSTER_URL,
  DEMO_VIDEO_URL,
  MEDIA_FILE_ID,
  USER_ID,
  WORK_ID,
});

async function fetchRequest(request, env) {
  if (request.method === "OPTIONS") return corsPreflight(request);
  return withCors(await handle(request, env), request.headers.get("Origin"));
}

export default { fetch: fetchRequest };
