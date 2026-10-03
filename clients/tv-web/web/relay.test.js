import { describe, expect, it, vi } from "vitest";
import worker from "./worker.js";
import {
  acmeChallengeName,
  b64urlEncode,
  handleRelayRequest,
  isManagedComment,
  isPublicUnicastIpv4,
  relayComment,
  relayHostname,
  runCleanup,
  selectStaleRecords,
  serverIdForPublicKey,
  signChallenge,
  verifyChallenge,
} from "./relay.js";

const NOW = 1_800_000_000;
const SECRET = "test-hmac-secret";
const IP = "203.0.113.10";
const ENV = { RELAY_HMAC_SECRET: SECRET, RELAY_CF_API_TOKEN: "cf-token", RELAY_ZONE_ID: "zone123" };
const encoder = new TextEncoder();

async function newIdentity() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { pair, raw, serverId: await serverIdForPublicKey(raw) };
}

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

async function signedRequest(identity, method, path, bodyObject, { timestamp = NOW, ip = IP } = {}) {
  const body = bodyObject === undefined ? "" : JSON.stringify(bodyObject);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(body)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const message = encoder.encode(`playarr-relay-v1|${method}|${path}|${hash}|${timestamp}`);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, identity.pair.privateKey, message));
  return new Request(`https://playarr.app${path}`, {
    method,
    body: body || undefined,
    headers: {
      "CF-Connecting-IP": ip,
      "X-Playarr-Relay-Key": base64(identity.raw),
      "X-Playarr-Relay-Signature": base64(signature),
      "X-Playarr-Relay-Timestamp": String(timestamp),
    },
  });
}

/** In-memory Cloudflare DNS zone that records every API call. */
function fakeCloudflare(initial = []) {
  const records = [...initial];
  const calls = [];
  let nextId = 1;
  const fetchImpl = vi.fn(async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ method, path: url.pathname + url.search, body: init.body ? JSON.parse(init.body) : undefined });
    const idMatch = url.pathname.match(/dns_records\/(.+)$/);
    const ok = (result, extra = {}) =>
      new Response(JSON.stringify({ success: true, errors: [], result, ...extra }), { status: 200 });
    if (method === "GET") {
      let found = records.filter((record) => {
        const type = url.searchParams.get("type");
        const name = url.searchParams.get("name");
        const startsWith = url.searchParams.get("comment.startswith");
        return (
          (!type || record.type === type) &&
          (!name || record.name === name) &&
          (!startsWith || (record.comment ?? "").startsWith(startsWith))
        );
      });
      const perPage = Number(url.searchParams.get("per_page") ?? "100");
      const page = Number(url.searchParams.get("page") ?? "1");
      const totalPages = Math.max(1, Math.ceil(found.length / perPage));
      found = found.slice((page - 1) * perPage, page * perPage);
      return ok(found, { result_info: { page, total_pages: totalPages } });
    }
    if (method === "POST") {
      const body = JSON.parse(init.body);
      const record = { id: `rec${nextId++}`, created_on: new Date(NOW * 1000).toISOString(), ...body };
      records.push(record);
      return ok(record);
    }
    if (method === "PATCH") {
      const record = records.find((entry) => entry.id === idMatch[1]);
      Object.assign(record, JSON.parse(init.body));
      return ok(record);
    }
    if (method === "DELETE") {
      const index = records.findIndex((entry) => entry.id === idMatch[1]);
      records.splice(index, 1);
      return ok({ id: idMatch[1] });
    }
    throw new Error(`unexpected ${method}`);
  });
  return { records, calls, fetchImpl };
}

/** A fetch that answers both the Worker's callback and Cloudflare API calls. */
function dependencies(cloudflare, { callback = "echo" } = {}) {
  return {
    now: () => NOW,
    sleep: async () => {},
    deleteDelayMs: 0,
    fetch: async (input, init) => cloudflare.fetchImpl(input, init),
    connect: async (address) => {
      if (callback === "down") throw new TypeError("connect timeout");
      const received = [];
      const writable = new WritableStream({ write: (chunk) => void received.push(new TextDecoder().decode(chunk)) });
      const readable = new ReadableStream({
        async start(controller) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const token = received.join("").split("/.well-known/playarr-relay/")[1].split(" ")[0];
          const reply = (status, body, extra = "") =>
            `HTTP/1.1 ${status}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n${extra}\r\n${body}`;
          let text;
          if (callback === "echo") text = reply("200 OK", token);
          else if (callback === "wrong") text = reply("200 OK", "nope");
          else if (callback === "redirect") text = reply("308 Permanent Redirect", "", "Location: https://x\r\n");
          else text = reply("200 OK", token + "x".repeat(5000));
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      });
      return { readable, writable, close: async () => {}, address };
    },
  };
}

async function issue(identity, deps, ip = IP) {
  const response = await handleRelayRequest(
    await signedRequest(identity, "POST", "/api/relay/register", { ip }),
    ENV,
    deps
  );
  return response.json();
}

describe("IPv4 validation", () => {
  it.each([
    "10.0.0.1",
    "127.0.0.1",
    "100.64.0.1",
    "100.127.255.255",
    "169.254.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "0.0.0.0",
    "192.0.2.1",
    "198.18.0.1",
    "104.16.0.1",
    "172.67.1.1",
    "173.245.48.1",
    "1.2.3",
    "256.1.1.1",
    "01.2.3.4",
    "::1",
    "example.com",
  ])("rejects %s", (address) => {
    expect(isPublicUnicastIpv4(address)).toBe(false);
  });

  it.each(["203.0.113.10", "8.8.8.8", "100.63.255.255", "100.128.0.1", "172.15.0.1", "172.32.0.1", "203.0.113.20"])(
    "accepts %s",
    (address) => {
      expect(isPublicUnicastIpv4(address)).toBe(true);
    }
  );

  it("derives the deterministic hostnames", () => {
    expect(relayHostname(IP)).toBe("v4-203-0-113-10.relay.playarr.app");
    expect(acmeChallengeName(IP)).toBe("_acme-challenge.v4-203-0-113-10.relay.playarr.app");
  });
});

describe("stateless challenges", () => {
  const claims = { ip: IP, serverId: "abc", expiresAt: NOW + 120 };

  it("round-trips a signed challenge", async () => {
    const token = await signChallenge(SECRET, claims);
    expect(await verifyChallenge(SECRET, token, NOW)).toEqual(claims);
  });

  it("rejects expired, tampered and wrongly keyed tokens", async () => {
    const token = await signChallenge(SECRET, claims);
    expect(await verifyChallenge(SECRET, token, NOW + 120)).toBeNull();
    expect(await verifyChallenge("other-secret", token, NOW)).toBeNull();
    const [version, payload, mac] = token.split(".");
    const forged = b64urlEncode(encoder.encode(JSON.stringify({ ip: "8.8.8.8", sid: "abc", exp: NOW + 60 })));
    expect(await verifyChallenge(SECRET, `${version}.${forged}.${mac}`, NOW)).toBeNull();
    expect(await verifyChallenge(SECRET, `${version}.${payload}.${mac.slice(0, -2)}AA`, NOW)).toBeNull();
    expect(await verifyChallenge(SECRET, "garbage", NOW)).toBeNull();
  });

  it("refuses tokens that outlive the two minute ceiling", async () => {
    const token = await signChallenge(SECRET, { ...claims, expiresAt: NOW + 3600 });
    expect(await verifyChallenge(SECRET, token, NOW)).toBeNull();
  });
});

describe("comment ownership guard", () => {
  it("only recognises the playarr-relay prefix", () => {
    expect(isManagedComment(relayComment("abc", NOW))).toBe(true);
    expect(isManagedComment("manual record")).toBe(false);
    expect(isManagedComment(undefined)).toBe(false);
    expect(isManagedComment(" playarr-relay")).toBe(false);
  });
});

describe("POST /api/relay/register", () => {
  it("is disabled until the secrets are configured", async () => {
    const identity = await newIdentity();
    const response = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", {}),
      { RELAY_ZONE_ID: "zone123" },
      dependencies(fakeCloudflare())
    );
    expect(response.status).toBe(503);
  });

  it("rejects unsigned, stale and tampered requests", async () => {
    const identity = await newIdentity();
    const deps = dependencies(fakeCloudflare());
    const unsigned = await handleRelayRequest(
      new Request("https://playarr.app/api/relay/register", { method: "POST", body: "{}" }),
      ENV,
      deps
    );
    expect(unsigned.status).toBe(401);
    const stale = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", {}, { timestamp: NOW - 600 }),
      ENV,
      deps
    );
    expect(stale.status).toBe(401);
    const request = await signedRequest(identity, "POST", "/api/relay/register", { ip: IP });
    const tampered = new Request(request, { body: JSON.stringify({ ip: "8.8.8.8" }) });
    expect((await handleRelayRequest(tampered, ENV, deps)).status).toBe(401);
  });

  it("issues a challenge for the connecting address by default", async () => {
    const identity = await newIdentity();
    const deps = dependencies(fakeCloudflare());
    const response = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", {}),
      ENV,
      deps
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ip: IP, hostname: "v4-203-0-113-10.relay.playarr.app", server_id: identity.serverId });
    expect(body.expires_at).toBe(NOW + 120);
    expect(await verifyChallenge(SECRET, body.challenge, NOW)).toEqual({
      ip: IP,
      serverId: identity.serverId,
      expiresAt: NOW + 120,
    });
  });

  it("refuses to issue a challenge for private addresses", async () => {
    const identity = await newIdentity();
    const response = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", {}, { ip: "10.1.2.3" }),
      ENV,
      dependencies(fakeCloudflare())
    );
    expect(response.status).toBe(400);
  });

  it("creates a DNS-only A record after a successful callback", async () => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare();
    const deps = dependencies(cloudflare);
    const { challenge } = await issue(identity, deps);
    const response = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", { challenge }),
      ENV,
      deps
    );
    expect(response.status).toBe(200);
    expect(cloudflare.records).toHaveLength(1);
    expect(cloudflare.records[0]).toMatchObject({
      type: "A",
      name: "v4-203-0-113-10.relay.playarr.app",
      content: IP,
      ttl: 300,
      proxied: false,
      comment: `playarr-relay server=${identity.serverId} seen=${NOW}`,
    });
    expect(cloudflare.records[0].tags).toBeUndefined();
    expect(cloudflare.calls.every((call) => call.path.startsWith("/client/v4/zones/zone123/"))).toBe(true);
  });

  it("is idempotent and only refreshes a stale heartbeat", async () => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare();
    const deps = dependencies(cloudflare);
    for (let round = 0; round < 2; round += 1) {
      const { challenge } = await issue(identity, deps);
      await handleRelayRequest(await signedRequest(identity, "POST", "/api/relay/register", { challenge }), ENV, deps);
    }
    expect(cloudflare.calls.filter((call) => call.method !== "GET")).toHaveLength(1);

    const later = { ...deps, now: () => NOW + 7 * 3600 };
    const issued = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", {}, { timestamp: NOW + 7 * 3600 }),
      ENV,
      later
    ).then((response) => response.json());
    await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", { challenge: issued.challenge }, { timestamp: NOW + 7 * 3600 }),
      ENV,
      later
    );
    expect(cloudflare.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(cloudflare.records[0].comment).toContain(`seen=${NOW + 7 * 3600}`);
  });

  it.each(["wrong", "redirect", "down", "oversize"])("does not touch DNS when the callback fails (%s)", async (mode) => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare();
    const { challenge } = await issue(identity, dependencies(cloudflare));
    const response = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", { challenge }),
      ENV,
      dependencies(cloudflare, { callback: mode })
    );
    expect(response.status).toBe(403);
    expect(cloudflare.calls).toHaveLength(0);
  });

  it("calls back over a raw TCP socket on 8484 with the token in the path", async () => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare();
    const deps = dependencies(cloudflare);
    const addresses = [];
    const spying = { ...deps, connect: async (address, ...rest) => (addresses.push(address), deps.connect(address, ...rest)) };
    const { challenge } = await issue(identity, spying);
    const response = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", { challenge }),
      ENV,
      spying
    );
    expect(response.status).toBe(200);
    expect(addresses[0]).toEqual({ hostname: IP, port: 8484 });
  });

  it("rejects a challenge issued to a different server key", async () => {
    const owner = await newIdentity();
    const other = await newIdentity();
    const deps = dependencies(fakeCloudflare());
    const { challenge } = await issue(owner, deps);
    const response = await handleRelayRequest(
      await signedRequest(other, "POST", "/api/relay/register", { challenge }),
      ENV,
      deps
    );
    expect(response.status).toBe(403);
  });

  it("never overwrites a record without the playarr-relay comment", async () => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare([
      { id: "manual1", type: "A", name: relayHostname(IP), content: "1.1.1.1", comment: "hand made", ttl: 300 },
    ]);
    const deps = dependencies(cloudflare);
    const { challenge } = await issue(identity, deps);
    const response = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", { challenge }),
      ENV,
      deps
    );
    expect(response.status).toBe(409);
    expect(cloudflare.calls.filter((call) => call.method !== "GET")).toHaveLength(0);
    expect(cloudflare.records[0].content).toBe("1.1.1.1");
  });

  it("reports a distinct status when the zone record quota is exhausted", async () => {
    const identity = await newIdentity();
    const deps = dependencies(fakeCloudflare());
    const { challenge } = await issue(identity, deps);
    const response = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", { challenge }),
      ENV,
      {
        ...deps,
        fetch: async (input, init) =>
          String(input).startsWith("http://") || (init?.method ?? "GET") === "GET"
            ? deps.fetch(input, init)
            : new Response(JSON.stringify({ success: false, errors: [{ code: 81045 }] }), { status: 400 }),
      }
    );
    expect(response.status).toBe(507);
  });

  it("retries once after a Cloudflare 429", async () => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare();
    const deps = dependencies(cloudflare);
    const { challenge } = await issue(identity, deps);
    let limited = false;
    const sleeps = [];
    const response = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/register", { challenge }),
      ENV,
      {
        ...deps,
        sleep: async (ms) => sleeps.push(ms),
        fetch: async (input, init) => {
          if (!String(input).startsWith("http://") && !limited) {
            limited = true;
            return new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
          }
          return deps.fetch(input, init);
        },
      }
    );
    expect(response.status).toBe(200);
    expect(sleeps).toEqual([2000]);
  });
});

describe("/api/relay/acme-challenge", () => {
  const value = "x".repeat(43);
  const name = acmeChallengeName(IP);

  async function call(identity, deps, method, body, challengeFor = identity) {
    const { challenge } = await issue(challengeFor, deps);
    return handleRelayRequest(
      await signedRequest(identity, method, "/api/relay/acme-challenge", { challenge, ...body }),
      ENV,
      deps
    );
  }

  it("creates a short-lived DNS-only TXT record for the proven address", async () => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare();
    const response = await call(identity, dependencies(cloudflare), "POST", { name, value });
    expect(response.status).toBe(201);
    expect(cloudflare.records).toHaveLength(1);
    expect(cloudflare.records[0]).toMatchObject({
      type: "TXT",
      name,
      content: JSON.stringify(value),
      ttl: 60,
      proxied: false,
      comment: relayComment(identity.serverId, NOW),
    });
  });

  it("deletes only the matching managed TXT record", async () => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare([
      { id: "keep", type: "TXT", name, content: '"other"', comment: relayComment("abc", NOW) },
      { id: "manual", type: "TXT", name, content: JSON.stringify(value), comment: "not ours" },
      { id: "gone", type: "TXT", name, content: JSON.stringify(value), comment: relayComment("abc", NOW) },
    ]);
    const response = await call(identity, dependencies(cloudflare), "DELETE", { name, value });
    expect(response.status).toBe(200);
    expect(cloudflare.records.map((record) => record.id)).toEqual(["keep", "manual"]);
  });

  it("only allows the challenge name for the address that passed the callback", async () => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare();
    for (const forbidden of [
      "_acme-challenge.v4-8-8-8-8.relay.playarr.app",
      "_acme-challenge.playarr.app",
      "playarr.app",
      relayHostname(IP),
      `x.${name}`,
    ]) {
      const response = await call(identity, dependencies(cloudflare), "POST", { name: forbidden, value });
      expect(response.status).toBe(403);
    }
    expect(cloudflare.calls).toHaveLength(0);
  });

  it("re-runs the callback on every request and rejects bad values", async () => {
    const identity = await newIdentity();
    const cloudflare = fakeCloudflare();
    const failed = await handleRelayRequest(
      await signedRequest(identity, "POST", "/api/relay/acme-challenge", {
        challenge: (await issue(identity, dependencies(cloudflare))).challenge,
        name,
        value,
      }),
      ENV,
      dependencies(cloudflare, { callback: "down" })
    );
    expect(failed.status).toBe(403);
    const invalid = await call(identity, dependencies(cloudflare), "POST", { name, value: 'bad value"' });
    expect(invalid.status).toBe(400);
    expect(cloudflare.calls).toHaveLength(0);
  });

  it("rejects a challenge that was not issued to the signing key", async () => {
    const identity = await newIdentity();
    const other = await newIdentity();
    const cloudflare = fakeCloudflare();
    const response = await call(other, dependencies(cloudflare), "POST", { name, value }, identity);
    expect(response.status).toBe(403);
    expect(cloudflare.calls).toHaveLength(0);
  });
});

describe("cleanup", () => {
  const day = 24 * 60 * 60;
  const managed = (seen, extra = {}) => ({
    comment: relayComment("abc", seen),
    name: "v4-1-2-3-4.relay.playarr.app",
    ...extra,
  });

  it("selects only stale managed records below relay.playarr.app", () => {
    const records = [
      { id: "old-a", type: "A", ...managed(NOW - 8 * day) },
      { id: "fresh-a", type: "A", ...managed(NOW - 6 * day) },
      { id: "old-txt", type: "TXT", ...managed(NOW - 2 * 3600) },
      { id: "fresh-txt", type: "TXT", ...managed(NOW - 600) },
      { id: "foreign", type: "A", name: "v4-1-2-3-4.relay.playarr.app", comment: "mine", content: "1.2.3.4" },
      { id: "outside", type: "A", ...managed(NOW - 30 * day, { name: "playarr.app" }) },
      { id: "mx", type: "MX", ...managed(NOW - 30 * day) },
      { id: "no-seen", type: "A", comment: "playarr-relay", name: "v4-1-2-3-4.relay.playarr.app" },
      {
        id: "txt-created",
        type: "TXT",
        comment: "playarr-relay server=abc",
        name: "_acme-challenge.v4-1-2-3-4.relay.playarr.app",
        created_on: new Date((NOW - 3 * 3600) * 1000).toISOString(),
      },
    ];
    expect(selectStaleRecords(records, NOW).map((record) => record.id)).toEqual(["old-a", "old-txt", "txt-created"]);
  });

  it("deletes stale records across pages and spares everything else", async () => {
    const records = [{ id: "manual", type: "A", name: "relay-ns1.playarr.app", content: "1.1.1.1" }];
    for (let index = 0; index < 130; index += 1) {
      records.push({
        id: `old${index}`,
        type: "A",
        name: `v4-9-9-9-${index}.relay.playarr.app`,
        content: `9.9.9.${index}`,
        comment: relayComment("abc", NOW - 9 * day),
      });
    }
    records.push({ id: "live", type: "A", name: "v4-8-8-8-8.relay.playarr.app", comment: relayComment("abc", NOW - day) });
    const cloudflare = fakeCloudflare(records);
    const result = await runCleanup(ENV, dependencies(cloudflare));
    expect(result).toEqual({ deleted: 130 });
    expect(cloudflare.records.map((record) => record.id)).toEqual(["manual", "live"]);
    expect(cloudflare.calls.filter((call) => call.method === "GET")).toHaveLength(2);
    expect(cloudflare.calls[0].path).toContain("comment.startswith=playarr-relay");
  });

  it("does nothing when the relay is not configured and runs from the cron trigger", async () => {
    expect(await runCleanup({}, {})).toEqual({ skipped: true });
    const waited = [];
    await worker.scheduled({}, {}, { waitUntil: (promise) => waited.push(promise) });
    await Promise.all(waited);
    expect(waited).toHaveLength(1);
  });
});

describe("routing", () => {
  it("serves /api/relay/ip and 404s unknown relay paths without touching assets", async () => {
    const assets = { fetch: vi.fn() };
    const env = { ...ENV, ASSETS: assets };
    const ip = await worker.fetch(
      new Request("https://playarr.app/api/relay/ip", { headers: { "CF-Connecting-IP": IP } }),
      env
    );
    expect(await ip.json()).toEqual({ ip: IP });
    const missing = await worker.fetch(new Request("https://playarr.app/api/relay/nope"), env);
    expect(missing.status).toBe(404);
    expect(assets.fetch).not.toHaveBeenCalled();
  });
});
