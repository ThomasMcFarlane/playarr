const DOWNLOADS = new Map([
  ["/downloads/android/playarr-android.apk", "android/playarr-android.apk"],
  ["/downloads/android/playarr-android.json", "android/playarr-android.json"],
  ["/downloads/roku/playarr-roku.zip", "roku/playarr-roku.zip"],
  ["/downloads/webos/playarr-webos.ipk", "webos/playarr-webos.ipk"],
  ["/downloads/tizen/playarr-tizen.wgt", "tizen/playarr-tizen.wgt"],
]);

const VERSIONED_ANDROID_DOWNLOAD =
  /^\/downloads\/android\/releases\/(\d+\.\d+\.\d+)\/(playarr-android\.apk|SHA256SUMS)$/;

const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const LINK_CODE_POLL_SECONDS = 2;
const LINK_CLIENT_PLATFORMS = new Set([
  "android-mobile",
  "android-tv",
  "tv-webos",
  "tv-tizen",
]);

function json(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function withLinkCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function linkCorsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomUserCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const compact = Array.from(bytes, (byte) => LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length]).join("");
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function normaliseUserCode(value) {
  const compact = String(value ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

function isHttpUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function linkObject(env, userCode) {
  const id = env.LINK_SESSIONS.idFromName(normaliseUserCode(userCode));
  return env.LINK_SESSIONS.get(id);
}

async function createLinkSession(request, env) {
  const body = await request.json().catch(() => ({}));
  const clientPlatform = LINK_CLIENT_PLATFORMS.has(body.client_platform)
    ? body.client_platform
    : "android-tv";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const userCode = randomUserCode();
    const deviceSecret = `${userCode.replace("-", "")}.${randomToken()}`;
    const expiresAt = Date.now() + LINK_CODE_TTL_MS;
    const response = await linkObject(env, userCode).fetch("https://link.internal/init", {
      method: "POST",
      body: JSON.stringify({ user_code: userCode, device_secret: deviceSecret, client_platform: clientPlatform, expires_at: expiresAt }),
    });
    if (response.status === 409) continue;
    if (!response.ok) return response;
    return json({
      device_code: deviceSecret,
      user_code: userCode,
      verification_uri: "https://playarr.app/link",
      verification_uri_complete: `https://playarr.app/link?user_code=${encodeURIComponent(userCode)}`,
      expires_in: LINK_CODE_TTL_MS / 1000,
      interval: LINK_CODE_POLL_SECONDS,
    });
  }
  return json({ error: "temporarily_unavailable" }, { status: 503 });
}

async function pollLinkSession(deviceSecret, env) {
  const compactCode = deviceSecret.split(".", 1)[0];
  if (!/^[A-Z2-9]{8}$/.test(compactCode)) return json({ error: "expired_token" }, { status: 404 });
  return linkObject(env, compactCode).fetch(
    `https://link.internal/status?device_secret=${encodeURIComponent(deviceSecret)}`
  );
}

async function inspectLinkSession(userCode, env) {
  const code = normaliseUserCode(userCode);
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return json({ error: "not_found" }, { status: 404 });
  return linkObject(env, code).fetch("https://link.internal/inspect");
}

async function authoriseLinkSession(request, env) {
  const body = await request.json().catch(() => null);
  const userCode = normaliseUserCode(body?.user_code);
  if (!body || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(userCode)) {
    return json({ error: "invalid_request" }, { status: 400 });
  }
  return linkObject(env, userCode).fetch("https://link.internal/authorize", {
    method: "POST",
    body: JSON.stringify({ ...body, user_code: userCode }),
  });
}

export class LinkSession {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const current = await this.state.storage.get("session");
    if (url.pathname === "/init" && request.method === "POST") {
      if (current && current.expires_at > Date.now()) return json({ error: "code_collision" }, { status: 409 });
      const session = await request.json();
      await this.state.storage.put("session", session);
      await this.state.storage.setAlarm(session.expires_at);
      return json({ ok: true }, { status: 201 });
    }
    if (!current || current.expires_at <= Date.now()) return json({ error: "not_found" }, { status: 404 });
    if (url.pathname === "/inspect" && request.method === "GET") {
      return json({
        client_platform: current.client_platform,
        expires_at: current.expires_at,
        linked: Boolean(current.claim),
      });
    }
    if (url.pathname === "/authorize" && request.method === "POST") {
      if (current.claim) return json({ error: "already_authorized" }, { status: 409 });
      const claim = await request.json();
      if (
        !isHttpUrl(claim.server_url) ||
        typeof claim.server_device_code !== "string" ||
        claim.server_device_code.length < 16 ||
        claim.server_device_code.length > 512 ||
        !Array.isArray(claim.server_urls) ||
        claim.server_urls.length > 32 ||
        claim.server_urls.some((value) => !isHttpUrl(value))
      ) {
        return json({ error: "invalid_request" }, { status: 400 });
      }
      await this.state.storage.put("session", { ...current, claim });
      return json({ linked: true });
    }
    if (url.pathname === "/status" && request.method === "GET") {
      if (url.searchParams.get("device_secret") !== current.device_secret) {
        return json({ error: "expired_token" }, { status: 404 });
      }
      return current.claim
        ? json(current.claim)
        : json({ error: "authorization_pending" }, { status: 202 });
    }
    return json({ error: "not_found" }, { status: 404 });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

function downloadKey(pathname) {
  const stableKey = DOWNLOADS.get(pathname);
  if (stableKey) return stableKey;
  const versioned = pathname.match(VERSIONED_ANDROID_DOWNLOAD);
  return versioned ? `android/releases/${versioned[1]}/${versioned[2]}` : undefined;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/link/")) {
      const packagedLinkEndpoint =
        url.pathname === "/api/link/code" ||
        url.pathname.startsWith("/api/link/code/");
      if (request.method === "OPTIONS") {
        return packagedLinkEndpoint
          ? linkCorsPreflight()
          : json({ error: "not_found" }, { status: 404 });
      }

      let response;
      if (url.pathname === "/api/link/code" && request.method === "POST") {
        response = await createLinkSession(request, env);
      } else if (url.pathname.startsWith("/api/link/code/") && request.method === "GET") {
        response = await pollLinkSession(
          decodeURIComponent(url.pathname.slice("/api/link/code/".length)),
          env
        );
      } else if (url.pathname === "/api/link/session" && request.method === "GET") {
        response = await inspectLinkSession(url.searchParams.get("user_code"), env);
      } else if (url.pathname === "/api/link/authorize" && request.method === "POST") {
        response = await authoriseLinkSession(request, env);
      } else {
        response = json({ error: "not_found" }, { status: 404 });
      }
      return packagedLinkEndpoint ? withLinkCors(response) : response;
    }
    const key = downloadKey(url.pathname);
    if (!key) return env.ASSETS.fetch(request);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const object = await env.CLIENT_DOWNLOADS.get(key);
    if (!object) {
      return new Response("This Playarr client package has not been published yet.", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const filename = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    const isApk = filename.endsWith(".apk");
    const isIpk = filename.endsWith(".ipk");
    const isWgt = filename.endsWith(".wgt");
    const isZip = filename.endsWith(".zip");
    const isJson = filename.endsWith(".json");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set(
      "Cache-Control",
      VERSIONED_ANDROID_DOWNLOAD.test(url.pathname)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300"
    );
    headers.set(
      "Content-Disposition",
      `${isApk || isIpk || isWgt || isZip ? "attachment" : "inline"}; filename="${filename}"`
    );
    headers.set("Content-Length", String(object.size));
    headers.set(
      "Content-Type",
      isApk
        ? "application/vnd.android.package-archive"
        : isIpk
          ? "application/octet-stream"
          : isWgt
            ? "application/widget"
            : isZip
              ? "application/zip"
            : isJson
              ? "application/json; charset=utf-8"
              : "text/plain; charset=utf-8"
    );
    headers.set("ETag", object.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  },
};
