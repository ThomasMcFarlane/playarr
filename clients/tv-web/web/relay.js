// Playarr relay "phone-home": publishes `v4-A-B-C-D.relay.playarr.app` DNS-only
// records for Playarr Servers that prove they control the public IPv4 address.
//
// Cloudflare only holds DNS. No playback or API traffic passes through this
// Worker; the single request it makes to a server is a short unauthenticated
// callback that returns a signed, two-minute challenge. State is DNS itself:
// there is no Durable Object, KV or database here.
//
// Trust model (see docs/deployment/playarr-relay.md):
//   * The server signs each request with its existing Ed25519 node identity.
//     The server id is the first 128 bits of SHA-256 over its public key, so it
//     is verifiable without storage and stable for as long as the key is.
//   * IP control is proven by the callback, not by the signature.
//   * A record can only ever point at the IP that passed the callback, and a
//     record whose comment does not start with `playarr-relay` is never touched.

export const RELAY_ZONE_NAME = "playarr.app";
export const RELAY_DOMAIN = "relay.playarr.app";
export const RELAY_COMMENT_PREFIX = "playarr-relay";
export const RELAY_CALLBACK_PORT = 8484;
export const CHALLENGE_TTL_SECONDS = 120;
export const REQUEST_MAX_SKEW_SECONDS = 120;
export const A_RECORD_TTL = 300;
export const TXT_RECORD_TTL = 60;
export const A_RECORD_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const TXT_RECORD_MAX_AGE_SECONDS = 60 * 60;
// A record's `seen` stamp is only rewritten when it is older than this, so an
// hourly heartbeat costs one DNS read and no write most of the time.
export const SEEN_REFRESH_SECONDS = 6 * 60 * 60;
export const CALLBACK_TIMEOUT_MS = 5000;
const MAX_DELETES_PER_RUN = 500;
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

const encoder = new TextEncoder();

// ---------------------------------------------------------------- encoding

export function b64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function b64Decode(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes) {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

// -------------------------------------------------------------- IP handling

export function parseIpv4(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function toInt(octets) {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function cidr(text) {
  const [address, length] = text.split("/");
  const bits = Number(length);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (toInt(parseIpv4(address)) & mask) >>> 0, mask };
}

// Everything that is not public unicast, plus Cloudflare's own ranges (the
// Worker must never be tricked into calling back into Cloudflare).
const NON_PUBLIC_RANGES = [
  "0.0.0.0/8", // "this" network
  "10.0.0.0/8", // private
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local
  "172.16.0.0/12", // private
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // documentation
  "192.88.99.0/24", // deprecated 6to4 relay
  "192.168.0.0/16", // private
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // documentation
  "203.0.113.0/24", // documentation
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved, including limited broadcast
  // Cloudflare (https://www.cloudflare.com/ips-v4)
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
].map(cidr);

export function isPublicUnicastIpv4(text) {
  const octets = parseIpv4(text);
  if (!octets) return false;
  const value = toInt(octets);
  return !NON_PUBLIC_RANGES.some(({ network, mask }) => ((value & mask) >>> 0) === network);
}

export function relayHostname(ip) {
  return `v4-${ip.split(".").join("-")}.${RELAY_DOMAIN}`;
}

export function acmeChallengeName(ip) {
  return `_acme-challenge.${relayHostname(ip)}`;
}

// ---------------------------------------------------------------- identity

export async function serverIdForPublicKey(publicKeyBytes) {
  return (await sha256Hex(publicKeyBytes)).slice(0, 32);
}

function canonicalRequest(method, path, bodyHash, timestamp) {
  return `playarr-relay-v1|${method}|${path}|${bodyHash}|${timestamp}`;
}

/**
 * Verifies the Ed25519 request signature. Returns `{ serverId }` or `null`.
 * `bodyText` is the exact request body that was signed.
 */
export async function verifySignedRequest(request, bodyText, nowSeconds) {
  const key = b64Decode(request.headers.get("X-Playarr-Relay-Key"));
  const signature = b64Decode(request.headers.get("X-Playarr-Relay-Signature"));
  const timestampText = request.headers.get("X-Playarr-Relay-Timestamp") ?? "";
  if (!key || key.length !== 32 || !signature || signature.length !== 64) return null;
  if (!/^[0-9]{1,12}$/.test(timestampText)) return null;
  const timestamp = Number(timestampText);
  if (Math.abs(nowSeconds - timestamp) > REQUEST_MAX_SKEW_SECONDS) return null;
  const path = new URL(request.url).pathname;
  const bodyHash = await sha256Hex(encoder.encode(bodyText));
  const message = encoder.encode(canonicalRequest(request.method, path, bodyHash, timestamp));
  try {
    const publicKey = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    const valid = await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, message);
    return valid ? { serverId: await serverIdForPublicKey(key) } : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- challenges

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

/** Stateless challenge: `v1.<payload>.<mac>` binding ip, server id and expiry. */
export async function signChallenge(secret, { ip, serverId, expiresAt }) {
  const payload = b64urlEncode(encoder.encode(JSON.stringify({ ip, sid: serverId, exp: expiresAt })));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), encoder.encode(`v1.${payload}`));
  return `v1.${payload}.${b64urlEncode(new Uint8Array(mac))}`;
}

/** Returns `{ ip, serverId, expiresAt }` for a valid, unexpired token, else `null`. */
export async function verifyChallenge(secret, token, nowSeconds) {
  if (typeof token !== "string" || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const mac = b64urlDecode(parts[2]);
  if (!mac) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, ["verify"]),
    mac,
    encoder.encode(`v1.${parts[1]}`)
  );
  if (!valid) return null;
  const raw = b64urlDecode(parts[1]);
  if (!raw) return null;
  let claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (
    typeof claims?.ip !== "string" ||
    typeof claims?.sid !== "string" ||
    !Number.isInteger(claims?.exp) ||
    claims.exp <= nowSeconds ||
    claims.exp > nowSeconds + CHALLENGE_TTL_SECONDS
  ) {
    return null;
  }
  return { ip: claims.ip, serverId: claims.sid, expiresAt: claims.exp };
}

// ------------------------------------------------------------ comment guard

export function relayComment(serverId, seen) {
  return `${RELAY_COMMENT_PREFIX} server=${serverId} seen=${seen}`;
}

export function isManagedComment(comment) {
  return typeof comment === "string" && comment.startsWith(RELAY_COMMENT_PREFIX);
}

export function parseSeen(comment) {
  const match = typeof comment === "string" ? comment.match(/(?:^| )seen=([0-9]{1,12})(?: |$)/) : null;
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------- Cloudflare

class CloudflareError extends Error {
  constructor(status, codes, message) {
    super(message);
    this.status = status;
    this.codes = codes;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Minimal DNS client scoped to one zone. Honours 429 `Retry-After` once. */
export function cloudflareDns(env, deps = {}) {
  const doFetch = deps.fetch ?? ((...args) => fetch(...args));
  const wait = deps.sleep ?? sleep;
  async function call(method, path, body) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await doFetch(`${CLOUDFLARE_API}/zones/${env.RELAY_ZONE_ID}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${env.RELAY_CF_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        await wait(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5, 30) * 1000);
        continue;
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // fall through to the generic error below
      }
      if (!response.ok || payload?.success !== true) {
        const codes = (payload?.errors ?? []).map((error) => error.code);
        throw new CloudflareError(response.status, codes, `Cloudflare DNS API ${method} ${path} failed with ${response.status}`);
      }
      return payload;
    }
    throw new CloudflareError(429, [], "Cloudflare DNS API rate limit");
  }
  return {
    async find(type, name) {
      const query = new URLSearchParams({ type, name, per_page: "50" });
      return (await call("GET", `/dns_records?${query}`)).result ?? [];
    },
    async create(record) {
      return (await call("POST", "/dns_records", { ...record, proxied: false })).result;
    },
    async patch(id, fields) {
      return (await call("PATCH", `/dns_records/${id}`, fields)).result;
    },
    async remove(id) {
      await call("DELETE", `/dns_records/${id}`);
    },
    /** Every managed record in the zone, following pagination. */
    async listManaged() {
      const records = [];
      for (let page = 1; page <= 100; page += 1) {
        const query = new URLSearchParams({
          "comment.startswith": RELAY_COMMENT_PREFIX,
          per_page: "100",
          page: String(page),
        });
        const payload = await call("GET", `/dns_records?${query}`);
        records.push(...(payload.result ?? []));
        const totalPages = payload.result_info?.total_pages ?? 1;
        if (page >= totalPages) break;
      }
      return records;
    },
  };
}

// ------------------------------------------------------------------ cleanup

/**
 * Pure selection of records the daily cleanup deletes: managed A records not
 * seen for seven days and managed TXT records older than one hour, both only
 * below `relay.playarr.app`.
 */
export function selectStaleRecords(records, nowSeconds) {
  return records.filter((record) => {
    if (!isManagedComment(record.comment)) return false;
    if (typeof record.name !== "string" || !record.name.endsWith(`.${RELAY_DOMAIN}`)) return false;
    if (record.type === "A") {
      const seen = parseSeen(record.comment);
      return seen !== null && nowSeconds - seen > A_RECORD_MAX_AGE_SECONDS;
    }
    if (record.type === "TXT") {
      const stamp = parseSeen(record.comment) ?? Math.floor(Date.parse(record.created_on ?? "") / 1000);
      return Number.isFinite(stamp) && nowSeconds - stamp > TXT_RECORD_MAX_AGE_SECONDS;
    }
    return false;
  });
}

export async function runCleanup(env, deps = {}) {
  if (!relayConfigured(env)) return { skipped: true };
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const wait = deps.sleep ?? sleep;
  const dns = cloudflareDns(env, deps);
  const stale = selectStaleRecords(await dns.listManaged(), now()).slice(0, MAX_DELETES_PER_RUN);
  let deleted = 0;
  for (const record of stale) {
    try {
      await dns.remove(record.id);
      deleted += 1;
    } catch (error) {
      if (!(error instanceof CloudflareError && error.status === 404)) throw error;
    }
    // Stay well under Cloudflare's 1,200 requests per five minutes.
    await wait(deps.deleteDelayMs ?? 300);
  }
  return { deleted };
}

// ----------------------------------------------------------------- handlers

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function relayConfigured(env) {
  return Boolean(env?.RELAY_HMAC_SECRET && env?.RELAY_CF_API_TOKEN && env?.RELAY_ZONE_ID);
}

const CALLBACK_MAX_RESPONSE_BYTES = 4096;

async function defaultConnect(address, options) {
  // Resolved at runtime: `cloudflare:sockets` only exists inside workerd.
  const { connect } = await import("cloudflare:sockets");
  return connect(address, options);
}

/** Reads until EOF; returns null when the size cap is hit first. */
async function readCapped(readable, maxBytes) {
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Plain-HTTP callback over a raw TCP socket: Workers `fetch` refuses bare IP
 * hostnames (error 1003), so the request is written by hand. Redirects are
 * never followed and the response is capped at 4 KiB.
 */
export async function verifyCallback(ip, token, deps = {}) {
  const connect = deps.connect ?? defaultConnect;
  const timeoutMs = deps.callbackTimeoutMs ?? CALLBACK_TIMEOUT_MS;
  let socket;
  let timer;
  try {
    const exchange = (async () => {
      socket = await connect({ hostname: ip, port: RELAY_CALLBACK_PORT }, { secureTransport: "off", allowHalfOpen: false });
      const writer = socket.writable.getWriter();
      await writer.write(
        encoder.encode(
          `GET /.well-known/playarr-relay/${token} HTTP/1.1\r\nHost: ${ip}:${RELAY_CALLBACK_PORT}\r\n` +
            "Accept: text/plain\r\nConnection: close\r\n\r\n"
        )
      );
      writer.releaseLock();
      return readCapped(socket.readable, CALLBACK_MAX_RESPONSE_BYTES);
    })();
    exchange.catch(() => {});
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const bytes = await Promise.race([exchange, timeout]);
    if (!bytes) return false;
    const text = new TextDecoder().decode(bytes);
    const split = text.indexOf("\r\n\r\n");
    if (split < 0) return false;
    const statusLine = text.slice(0, text.indexOf("\r\n"));
    if (!/^HTTP\/1\.[01] 200(?: |$)/.test(statusLine)) return false;
    return text.slice(split + 4).trim() === token;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    try {
      socket?.close().catch(() => {});
    } catch {
      // already closed
    }
  }
}

async function readSignedJson(request, nowSeconds) {
  const bodyText = request.method === "GET" ? "" : await request.text();
  if (bodyText.length > 4096) return { error: json({ error: "payload_too_large" }, 413) };
  const identity = await verifySignedRequest(request, bodyText, nowSeconds);
  if (!identity) return { error: json({ error: "invalid_signature" }, 401) };
  let body = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      return { error: json({ error: "invalid_request" }, 400) };
    }
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: json({ error: "invalid_request" }, 400) };
  }
  return { identity, body };
}

function claimedIp(request, body) {
  const ip = body.ip ?? request.headers.get("CF-Connecting-IP");
  return typeof ip === "string" && isPublicUnicastIpv4(ip) ? ip : null;
}

/**
 * Shared by register and ACME: no challenge issues one; a challenge is
 * verified, bound to the caller and re-checked by calling the server back.
 */
async function proveIpControl(request, env, deps, now, identity, body) {
  const claims = await verifyChallenge(env.RELAY_HMAC_SECRET, body.challenge, now);
  if (!claims || claims.serverId !== identity.serverId) return { error: json({ error: "invalid_challenge" }, 403) };
  if (!isPublicUnicastIpv4(claims.ip)) return { error: json({ error: "invalid_ip" }, 400) };
  if (!(await verifyCallback(claims.ip, body.challenge, deps))) {
    return { error: json({ error: "callback_failed" }, 403) };
  }
  return { ip: claims.ip };
}

async function issueChallenge(request, env, now, identity, body) {
  const ip = claimedIp(request, body);
  if (!ip) return json({ error: "invalid_ip", message: "A public unicast IPv4 address is required" }, 400);
  const expiresAt = now + CHALLENGE_TTL_SECONDS;
  return json({
    ip,
    server_id: identity.serverId,
    hostname: relayHostname(ip),
    challenge: await signChallenge(env.RELAY_HMAC_SECRET, { ip, serverId: identity.serverId, expiresAt }),
    expires_at: expiresAt,
    callback_port: RELAY_CALLBACK_PORT,
  });
}

function quotaOr502(error) {
  if (error instanceof CloudflareError) {
    // 81045 is "record quota exceeded"; surface it distinctly so operators notice.
    if (error.codes.includes(81045)) return json({ error: "dns_quota_exceeded" }, 507);
    return json({ error: "dns_unavailable" }, 502);
  }
  throw error;
}

async function register(request, env, deps, now) {
  const parsed = await readSignedJson(request, now);
  if (parsed.error) return parsed.error;
  const { identity, body } = parsed;
  if (body.challenge === undefined) return issueChallenge(request, env, now, identity, body);

  const proof = await proveIpControl(request, env, deps, now, identity, body);
  if (proof.error) return proof.error;
  const hostname = relayHostname(proof.ip);
  const dns = cloudflareDns(env, deps);
  try {
    const existing = await dns.find("A", hostname);
    const foreign = existing.filter((record) => !isManagedComment(record.comment));
    if (foreign.length > 0) return json({ error: "name_not_managed" }, 409);
    const comment = relayComment(identity.serverId, now);
    const current = existing[0];
    if (!current) {
      await dns.create({ type: "A", name: hostname, content: proof.ip, ttl: A_RECORD_TTL, comment });
    } else {
      const seen = parseSeen(current.comment);
      const sameOwner = current.comment.includes(`server=${identity.serverId}`);
      const stale = seen === null || now - seen > SEEN_REFRESH_SECONDS;
      if (current.content !== proof.ip || !sameOwner || stale || current.ttl !== A_RECORD_TTL) {
        await dns.patch(current.id, { content: proof.ip, ttl: A_RECORD_TTL, proxied: false, comment });
      }
    }
  } catch (error) {
    return quotaOr502(error);
  }
  return json({ hostname, ip: proof.ip, ttl: A_RECORD_TTL, server_id: identity.serverId });
}

const ACME_VALUE = /^[A-Za-z0-9_-]{20,128}$/;

async function acmeChallenge(request, env, deps, now) {
  const parsed = await readSignedJson(request, now);
  if (parsed.error) return parsed.error;
  const { identity, body } = parsed;
  const proof = await proveIpControl(request, env, deps, now, identity, body);
  if (proof.error) return proof.error;
  const name = acmeChallengeName(proof.ip);
  if (body.name !== name) return json({ error: "name_not_allowed" }, 403);
  if (typeof body.value !== "string" || !ACME_VALUE.test(body.value)) {
    return json({ error: "invalid_value" }, 400);
  }
  const dns = cloudflareDns(env, deps);
  const quoted = JSON.stringify(body.value);
  try {
    const existing = (await dns.find("TXT", name)).filter((record) => isManagedComment(record.comment));
    const match = existing.find((record) => record.content === quoted || record.content === body.value);
    if (request.method === "POST") {
      if (!match) {
        await dns.create({
          type: "TXT",
          name,
          content: quoted,
          ttl: TXT_RECORD_TTL,
          comment: relayComment(identity.serverId, now),
        });
      }
      return json({ name, created: true }, 201);
    }
    if (match) await dns.remove(match.id);
    return json({ name, deleted: Boolean(match) });
  } catch (error) {
    return quotaOr502(error);
  }
}

/**
 * Entry point for `/api/relay/*`. `deps` lets tests inject `fetch`, `now`
 * (seconds) and `sleep`.
 */
export async function handleRelayRequest(request, env, deps = {}) {
  const url = new URL(request.url);
  const now = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
  if (!relayConfigured(env)) return json({ error: "relay_not_configured" }, 503);

  if (url.pathname === "/api/relay/ip" && request.method === "GET") {
    return json({ ip: request.headers.get("CF-Connecting-IP") });
  }
  if (url.pathname === "/api/relay/register" && request.method === "POST") {
    return register(request, env, deps, now);
  }
  if (
    url.pathname === "/api/relay/acme-challenge" &&
    (request.method === "POST" || request.method === "DELETE")
  ) {
    return acmeChallenge(request, env, deps, now);
  }
  return json({ error: "not_found" }, 404);
}
