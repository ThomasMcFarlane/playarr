import * as QRCode from "qrcode/lib/core/qrcode.js";
import { handleRelayRequest, runCleanup } from "./relay.js";

// Every client download is served from GitHub Releases only: the single
// all-platform release (tag vX.Y.Z, .github/workflows/release.yml) or, for
// Android and the server, a per-platform one (android-v*, backend-v*). The
// stable /downloads/... paths resolve the newest stable release that carries
// the asset and redirect to it (small JSON manifests are proxied); versioned
// paths redirect to the vX.Y.Z release when it has the asset and to the
// per-platform tag otherwise. A path with no published asset is a 404.
const RELEASES_REPO = "ThomasMcFarlane/playarr";
const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases`;
const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=50`;

// Stable TV package paths and their versioned asset names in a vX.Y.Z release.
const LATEST_TV_DOWNLOADS = new Map([
  ["/downloads/roku/playarr-roku.zip", (version) => `playarr-roku-${version}.zip`],
  ["/downloads/webos/playarr-webos.ipk", (version) => `playarr-webos-${version}.ipk`],
  ["/downloads/tizen/playarr-tizen.wgt", (version) => `playarr-tizen-${version}.wgt`],
]);

const LATEST_ANDROID_DOWNLOADS = new Map([
  ["/downloads/android/playarr-android.apk", "playarr-android.apk"],
  ["/downloads/android/playarr-android.json", "playarr-android.json"],
]);

const LATEST_SERVER_DOWNLOAD =
  /^\/downloads\/server\/(latest\.json|playarr-server-linux-(?:amd64|arm64)\.tar\.gz(?:\.sha256)?)$/;

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

const ANDROID_TAG = /^(?:android-)?v(\d+\.\d+\.\d+)$/;
const SERVER_TAG = /^(?:backend-)?v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/;
const UNIFIED_TAG = /^v(\d+\.\d+\.\d+)$/;

// The newest stable release whose tag matches `family` and which carries the
// asset `assetFor(version)`. Releases are listed newest first. A release
// listed without its assets (never the case for the GitHub API) is assumed to
// carry it, and the asset is still probed before redirecting.
async function latestRelease(family, assetFor) {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "playarr-downloads" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) return undefined;
  const releases = await response.json();
  for (const release of releases) {
    if (release.draft || release.prerelease || typeof release.tag_name !== "string") continue;
    const match = release.tag_name.match(family);
    if (!match) continue;
    const asset = assetFor(match[1]);
    if (Array.isArray(release.assets) && !release.assets.some((item) => item?.name === asset)) continue;
    return { tag: release.tag_name, asset };
  }
  return undefined;
}

// Returns a download target for a GitHub Releases download path, or undefined
// when the path is not one: either `candidates` (versioned paths: tags tried in
// order) or `resolve` (stable paths: the newest matching release).
function releaseDownload(pathname) {
  const tvAsset = LATEST_TV_DOWNLOADS.get(pathname);
  if (tvAsset) return { resolve: () => latestRelease(UNIFIED_TAG, tvAsset) };
  const androidAsset = LATEST_ANDROID_DOWNLOADS.get(pathname);
  if (androidAsset) return { resolve: () => latestRelease(ANDROID_TAG, () => androidAsset) };
  const androidVersioned = pathname.match(VERSIONED_ANDROID_DOWNLOAD);
  if (androidVersioned) {
    const [, version, asset] = androidVersioned;
    return {
      immutable: true,
      candidates: [`v${version}`, `android-v${version}`].map((tag) => ({ tag, asset })),
    };
  }
  const serverVersioned = pathname.match(VERSIONED_SERVER_DOWNLOAD);
  if (serverVersioned) {
    const [, asset, version] = serverVersioned;
    return {
      immutable: true,
      candidates: [`v${version}`, `backend-v${version}`].map((tag) => ({ tag, asset })),
    };
  }
  const serverLatest = pathname.match(LATEST_SERVER_DOWNLOAD);
  if (serverLatest) {
    const name = serverLatest[1];
    return {
      resolve: () =>
        latestRelease(SERVER_TAG, (version) =>
          name === "latest.json" ? name : name.replace("playarr-server-", `playarr-server-${version}-`)
        ),
    };
  }
  return undefined;
}

// Resolves a GitHub Release response for the path, or undefined when no
// matching release or asset exists (or GitHub cannot be reached).
async function serveReleaseDownload(request, target) {
  try {
    const candidates = target.candidates ?? [await target.resolve()].filter(Boolean);
    const cacheControl = target.immutable ? "public, max-age=86400" : "public, max-age=300";
    for (const { tag, asset } of candidates) {
      const location = `${RELEASES_URL}/download/${tag}/${asset}`;
      // Small JSON manifests are proxied so browsers and the Android updater read
      // them same-origin; everything else is a redirect to the release asset.
      if (asset.endsWith(".json")) {
        const upstream = await fetch(location, { cf: { cacheTtl: 300, cacheEverything: true } });
        if (!upstream.ok) continue;
        return new Response(request.method === "HEAD" ? null : upstream.body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": cacheControl,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      // Confirm the asset exists without following the redirect to storage.
      const probe = await fetch(location, {
        method: "HEAD",
        redirect: "manual",
        cf: { cacheTtl: 300, cacheEverything: true },
      });
      if (probe.status === 404 || probe.status >= 500) continue;
      return new Response(null, {
        status: 302,
        headers: { Location: location, "Cache-Control": cacheControl },
      });
    }
    return undefined;
  } catch {
    return undefined;
  }
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

    const releaseTarget = releaseDownload(url.pathname);
    if (!releaseTarget) return env.ASSETS.fetch(request);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const release = await serveReleaseDownload(request, releaseTarget);
    if (release) return release;
    return new Response("This Playarr client package has not been published yet.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  },
};
