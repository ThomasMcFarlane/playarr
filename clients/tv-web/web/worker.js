import * as QRCode from "qrcode/lib/core/qrcode.js";
import { handleRelayRequest, runCleanup } from "./relay.js";

const DOWNLOADS = new Map([
  ["/downloads/android/playarr-android.apk", "android/playarr-android.apk"],
  ["/downloads/android/playarr-android.json", "android/playarr-android.json"],
  ["/downloads/roku/playarr-roku.zip", "roku/playarr-roku.zip"],
  ["/downloads/webos/playarr-webos.ipk", "webos/playarr-webos.ipk"],
  ["/downloads/tizen/playarr-tizen.wgt", "tizen/playarr-tizen.wgt"],
  // Playarr Server release tarballs: stable "latest" aliases (overwritten on
  // every release) plus the manifest the Clients hub reads for the version
  // and checksums. Versioned, immutable copies are matched below.
  ["/downloads/server/latest.json", "server/latest.json"],
  ["/downloads/server/playarr-server-linux-amd64.tar.gz", "server/playarr-server-linux-amd64.tar.gz"],
  ["/downloads/server/playarr-server-linux-amd64.tar.gz.sha256", "server/playarr-server-linux-amd64.tar.gz.sha256"],
  ["/downloads/server/playarr-server-linux-arm64.tar.gz", "server/playarr-server-linux-arm64.tar.gz"],
  ["/downloads/server/playarr-server-linux-arm64.tar.gz.sha256", "server/playarr-server-linux-arm64.tar.gz.sha256"],
]);

// /downloads/server/playarr-server-<version>-linux-<arch>.tar.gz (and its
// .sha256, plus playarr-server-<version>-SHA256SUMS) is immutable per version.
const VERSIONED_SERVER_DOWNLOAD =
  /^\/downloads\/server\/(playarr-server-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?:linux-(?:amd64|arm64)\.tar\.gz(?:\.sha256)?|SHA256SUMS))$/;

const VERSIONED_ANDROID_DOWNLOAD =
  /^\/downloads\/android\/releases\/(\d+\.\d+\.\d+)\/(playarr-android\.apk|SHA256SUMS)$/;

const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LINK_CODE_TTL_MS = 5 * 60 * 1000;
const LINK_CLAIM_REDEMPTION_GRACE_MS = 30 * 1000;
const LINK_CODE_POLL_SECONDS = 2;
const LINK_CLIENT_PLATFORMS = new Set([
  "android-mobile",
  "android-tv",
  "ios",
  "web",
  "tv-webos",
  "tv-tizen",
  "tv-vidaa",
  "tv-roku",
  "tv-fire",
  "xbox",
]);

// Short, share-friendly copy for each /clients/:id page -- distinct from the
// longer on-page install descriptions, which assume you're already reading
// the page rather than deciding whether to click through to it. Kept here
// rather than imported from the React app: this worker has no i18n/React
// runtime, and social crawlers don't execute JS to pick up a client-side
// document.title change anyway, so this is deliberately English-only static
// copy rather than plumbing translation keys across two different runtimes.
const CLIENTS_SOCIAL_COPY = new Map([
  ["vidaa", {
    name: "Hisense VIDAA",
    description: "Install the Playarr launcher on compatible Hisense VIDAA smart TVs.",
  }],
  ["android", {
    name: "Android",
    description: "Watch Playarr on Android phones, tablets and Android TV.",
  }],
  ["apple", {
    name: "Apple",
    description: "A native Playarr app for iPhone, iPad and Apple TV is coming soon.",
  }],
  ["webos", {
    name: "LG webOS",
    description: "The complete Playarr TV experience on LG smart TVs.",
  }],
  ["tizen", {
    name: "Samsung Tizen",
    description: "The complete Playarr TV experience on Samsung smart TVs.",
  }],
  ["roku", {
    name: "Roku",
    description: "Sideload the Playarr channel on Roku televisions.",
  }],
  ["chromecast", {
    name: "Chromecast",
    description: "Casting Playarr to Chromecast built-in devices is coming soon.",
  }],
  ["xbox", {
    name: "Xbox",
    description: "A native Playarr client for Xbox Series X|S and Xbox One is coming soon.",
  }],
  ["harmony", {
    name: "HarmonyOS",
    description: "A native Playarr client for HarmonyOS is coming soon.",
  }],
  ["playstation", {
    name: "PlayStation",
    description: "A Playarr client for PlayStation consoles is being scoped.",
  }],
  ["firetv", {
    name: "Fire TV",
    description: "A native Playarr client for Amazon Fire TV is coming soon.",
  }],
]);

const LEGAL_SOCIAL_COPY = new Map([
  ["/legal/privacy", {
    title: "Privacy policy",
    description: "How the Playarr Android app, web app, self-hosted server and public linking service handle data.",
  }],
  ["/legal/terms", {
    title: "Terms of use",
    description: "The conditions that apply when you use Playarr software and the public playarr.app service.",
  }],
  ["/legal/acceptable-use", {
    title: "Acceptable use",
    description: "The rules for using Playarr software and its public linking service.",
  }],
  ["/legal/licences", {
    title: "Licences and attribution",
    description: "Open-source licensing, required notices and third-party attribution for Playarr.",
  }],
  ["/legal/account-deletion", {
    title: "Account deletion",
    description: "How to request deletion of a Playarr account and its associated data.",
  }],
]);

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Rewrites <title> and the description/og/twitter <meta> tags in the shared
 * SPA shell to a specific client's copy, so sharing a /clients/:id link
 * shows that platform's name in the preview instead of the generic default
 * every route would otherwise fall back to -- a crawler never runs the
 * client-side JS that would set document.title for that route.
 *
 * Plain string substitution rather than HTMLRewriter: this worker has no
 * other dependency on the Workers-runtime-specific HTML parser, and a
 * regex swap of a handful of exact, self-authored tags in a template this
 * file also owns is simple to get right and, unlike HTMLRewriter, runs
 * anywhere -- including this project's plain-Node vitest suite, with no
 * Workers runtime polyfill needed just to test it.
 */
function renderPageMeta(html, titleText, descriptionText, canonicalPath, url) {
  const title = escapeHtml(titleText);
  const description = escapeHtml(descriptionText);
  const canonicalUrl = escapeHtml(new URL(canonicalPath, url).toString());

  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${description}$2`
    )
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${title}$2`)
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
      `$1${description}$2`
    )
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/, `$1${canonicalUrl}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, `$1${title}$2`)
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
      `$1${description}$2`
    );
}

function renderClientMeta(html, clientId, copy, url) {
  const title = `Playarr for ${copy.name}`;
  return renderPageMeta(html, title, copy.description, `/clients/${clientId}`, url);
}

/** The bare /clients index redirects to this client's own page client-side (see ClientsPage in Clients.tsx) -- a crawler never runs that redirect, so this is what it should see instead. */
const CLIENTS_INDEX_REDIRECT_TARGET = "vidaa";

async function clientPageResponse(clientId, url, env, request) {
  // Deliberately NOT env.ASSETS.fetch(new Request(new URL("/index.html", url), ...)):
  // an explicit, literal "/index.html" request is auto-redirected (307, to
  // "/") by Cloudflare's static-asset serving -- the same normalisation
  // that turns a request for "/cast/index.html" into a 307 to "/cast/". A
  // request for a path that *doesn't* correspond to a real file (which
  // "/clients", "/clients/roku", or "/clients/roku/" never do) instead
  // takes the SPA fallback and gets the real index.html content directly,
  // with no redirect -- so fetch the actual incoming path/method here, not
  // a hardcoded filename.
  const response = await env.ASSETS.fetch(new Request(url, { method: request.method }));
  const copy = CLIENTS_SOCIAL_COPY.get(clientId);
  if (!copy) return response;
  const html = await response.text();
  const headers = new Headers(response.headers);
  // The rewritten body below is neither the original length nor encoding.
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  return new Response(renderClientMeta(html, clientId, copy, url), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function legalPageResponse(pathname, copy, url, env, request) {
  const response = await env.ASSETS.fetch(new Request(url, { method: request.method }));
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  return new Response(
    renderPageMeta(html, `${copy.title} · Playarr`, copy.description, pathname, url),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    }
  );
}

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

/**
 * Playarr device-login QR tokens — lockstep with `@playarr-tv/device-auth`
 * `PLAYARR_QR_STYLE` and live `/login/qr` `.device-login-qr`:
 * black modules on white, margin 2, ECC M. Outer rounded white plate
 * (240 / r=18 / 12px edge + soft shadow) is applied by each client chrome;
 * this PNG is only the module field inside that plate (content 216 CSS px,
 * rendered at 2× → 432 px for crisp TV scale).
 */
const PLAYARR_QR_STYLE = {
  tileSize: 240,
  borderPx: 12,
  /** Content-box width of `.device-login-qr` after the 12px white border. */
  contentSize: 216,
  radiusPx: 18,
  marginModules: 2,
  errorCorrectionLevel: "M",
  dark: "#000000ff",
  light: "#ffffffff",
  renderScale: 2,
};

/**
 * Renders the device-link QR as a PNG for platforms whose native UI toolkit
 * can't display SVG (Roku's Poster node only accepts JPEG/PNG/WebP). Matches
 * the module field browsers draw inside `.device-login-qr`. Scoped to
 * `https://playarr.app/link?...` so this can't become a general-purpose QR
 * generator for arbitrary caller-supplied text.
 */
async function linkQrPng(value) {
  if (typeof value !== "string" || !value.startsWith("https://playarr.app/link?")) {
    return json({ error: "invalid_value" }, { status: 400 });
  }
  const width = PLAYARR_QR_STYLE.contentSize * PLAYARR_QR_STYLE.renderScale;
  const qr = QRCode.create(value, {
    errorCorrectionLevel: PLAYARR_QR_STYLE.errorCorrectionLevel,
  });
  const png = await renderQrPng(qr.modules, width, PLAYARR_QR_STYLE.marginModules);
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value);
}

function pngChunk(type, data = new Uint8Array()) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, pngCrc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

async function renderQrPng(modules, width, margin) {
  const scanlines = new Uint8Array((width + 1) * width);
  const moduleCount = modules.size + margin * 2;
  const scale = Math.floor(width / moduleCount);
  const symbolWidth = modules.size * scale;
  const symbolOffset = Math.floor((width - symbolWidth) / 2);

  scanlines.fill(255);
  for (let y = 0; y < width; y += 1) {
    const rowOffset = y * (width + 1);
    scanlines[rowOffset] = 0;
    const moduleY = Math.floor((y - symbolOffset) / scale);
    if (moduleY < 0 || moduleY >= modules.size) continue;
    for (let x = 0; x < width; x += 1) {
      const moduleX = Math.floor((x - symbolOffset) / scale);
      if (moduleX >= 0 && moduleX < modules.size && modules.get(moduleY, moduleX)) {
        scanlines[rowOffset + x + 1] = 0;
      }
    }
  }

  const compressed = new Uint8Array(
    await new Response(
      new Blob([scanlines]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, width);
  header.set([8, 0, 0, 0, 0], 8);

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND"),
  ];
  const png = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
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
  if (!LINK_CLIENT_PLATFORMS.has(body?.client_platform)) {
    return json({ error: "invalid_request" }, { status: 400 });
  }
  const clientPlatform = body.client_platform;
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
    if (!current) return json({ error: "not_found" }, { status: 404 });
    const now = Date.now();
    const isClaimRedemption =
      url.pathname === "/status" &&
      request.method === "GET" &&
      current.claim &&
      now < current.expires_at + LINK_CLAIM_REDEMPTION_GRACE_MS;
    if (current.expires_at <= now && !isClaimRedemption) {
      return json({ error: "not_found" }, { status: 404 });
    }
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
      await this.state.storage.setAlarm(
        current.expires_at + LINK_CLAIM_REDEMPTION_GRACE_MS
      );
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
  if (versioned) return `android/releases/${versioned[1]}/${versioned[2]}`;
  const server = pathname.match(VERSIONED_SERVER_DOWNLOAD);
  return server ? `server/releases/${server[2]}/${server[1]}` : undefined;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCleanup(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/relay/")) {
      return handleRelayRequest(request, env);
    }
    if (url.pathname.startsWith("/api/link/")) {
      const packagedLinkEndpoint =
        url.pathname === "/api/link/code" ||
        url.pathname.startsWith("/api/link/code/") ||
        url.pathname === "/api/link/qr";
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
      } else if (url.pathname === "/api/link/qr" && request.method === "GET") {
        response = await linkQrPng(url.searchParams.get("value"));
      } else {
        response = json({ error: "not_found" }, { status: 404 });
      }
      return packagedLinkEndpoint ? withLinkCors(response) : response;
    }
    if (url.pathname === "/clients") {
      return clientPageResponse(CLIENTS_INDEX_REDIRECT_TARGET, url, env, request);
    }
    if (url.pathname.startsWith("/clients/")) {
      // Strip a trailing slash ("/clients/roku/" -> "roku", not "roku/") so
      // it still matches a real id -- react-router itself already tolerates
      // the slash (confirmed via matchPath), so this only affects which
      // meta tags a crawler sees, not what a real visitor's browser renders.
      const clientId = url.pathname.slice("/clients/".length).replace(/\/+$/, "");
      return clientPageResponse(clientId, url, env, request);
    }
    const legalPath = url.pathname.replace(/\/+$/, "") || "/";
    const legalCopy = LEGAL_SOCIAL_COPY.get(legalPath);
    if (legalCopy) {
      return legalPageResponse(legalPath, legalCopy, url, env, request);
    }
    if (url.pathname === "/cast") {
      return new Response(null, {
        status: 301,
        headers: { Location: "/cast/" },
      });
    }
    if (url.pathname === "/cast/") {
      return env.ASSETS.fetch(new Request(new URL("/cast/index.html", url), request));
    }
    if (url.pathname.startsWith("/cast/") && /\.[^./]+$/.test(url.pathname)) {
      const response = await env.ASSETS.fetch(request);
      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.startsWith("text/html")) {
        return new Response("Not found", {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return response;
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
    const isTarball = filename.endsWith(".tar.gz");
    const isJson = filename.endsWith(".json");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set(
      "Cache-Control",
      VERSIONED_ANDROID_DOWNLOAD.test(url.pathname) ||
        VERSIONED_SERVER_DOWNLOAD.test(url.pathname)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300"
    );
    headers.set(
      "Content-Disposition",
      `${isApk || isIpk || isWgt || isZip || isTarball ? "attachment" : "inline"}; filename="${filename}"`
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
            : isTarball
              ? "application/gzip"
            : isJson
              ? "application/json; charset=utf-8"
              : "text/plain; charset=utf-8"
    );
    headers.set("ETag", object.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  },
};
