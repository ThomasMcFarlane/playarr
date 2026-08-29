import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const reviewUsername = process.env.PLAY_REVIEW_USERNAME;
const reviewPassword = process.env.PLAY_REVIEW_PASSWORD;
const signingSecret = process.env.PLAY_REVIEW_TOKEN_SIGNING_SECRET;
const scriptName = "playarr-google-play-review";
const hostname = "review.playarr.app";
const workerPath = fileURLToPath(new URL("../worker.js", import.meta.url));

for (const [name, value, minimumLength] of [
  ["CLOUDFLARE_ACCOUNT_ID", accountId, 1],
  ["CLOUDFLARE_API_TOKEN", apiToken, 1],
  ["PLAY_REVIEW_USERNAME", reviewUsername, 12],
  ["PLAY_REVIEW_PASSWORD", reviewPassword, 20],
  ["PLAY_REVIEW_TOKEN_SIGNING_SECRET", signingSecret, 32],
]) {
  if (typeof value !== "string" || value.length < minimumLength) {
    throw new Error(`${name} is required and must be at least ${minimumLength} characters`);
  }
}

async function cloudflareRequest(path, init = {}) {
  let response;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiToken}`, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (![409, 429].includes(response.status) && response.status < 500) break;
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare API ${response.status}: non-JSON response`);
  }
  if (!response.ok || payload.success !== true) {
    const details = payload.errors?.map((entry) => `${entry.code ?? "unknown"}: ${entry.message}`).join("; ");
    throw new Error(`Cloudflare API ${response.status}: ${details || "request failed"}`);
  }
  return payload.result;
}

const metadata = {
  main_module: "worker.js",
  compatibility_date: "2026-08-29",
  bindings: [
    { name: "REVIEW_USERNAME", type: "secret_text", text: reviewUsername },
    { name: "REVIEW_PASSWORD", type: "secret_text", text: reviewPassword },
    { name: "TOKEN_SIGNING_SECRET", type: "secret_text", text: signingSecret },
  ],
};
const upload = new FormData();
upload.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
upload.append(
  "worker.js",
  new Blob([readFileSync(workerPath)], { type: "application/javascript+module" }),
  "worker.js",
);

const deployed = await cloudflareRequest(`/accounts/${accountId}/workers/scripts/${scriptName}`, {
  method: "PUT",
  body: upload,
});

const domains = await cloudflareRequest(`/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`);
const existing = domains.find((domain) => domain.hostname === hostname);
if (existing && existing.service !== scriptName) {
  throw new Error(`${hostname} is already attached to a different Worker`);
}
if (!existing) {
  await cloudflareRequest(`/accounts/${accountId}/workers/domains`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostname, service: scriptName, zone_name: "playarr.app" }),
  });
}

async function verifyDeployment() {
  let lastError = "no response";
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const health = await fetch(`https://${hostname}/api/system/health`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (health.status !== 200) throw new Error(`health returned HTTP ${health.status}`);
      const login = await fetch(`https://${hostname}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: "deployment-verification",
          device_name: "Deployment verification",
          client_platform: "android-mobile",
          client_version: "verification",
          username: reviewUsername,
          password: reviewPassword,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (login.status !== 200) throw new Error(`login returned HTTP ${login.status}`);
      const session = await login.json();
      const catalogue = await fetch(`https://${hostname}/api/v1/catalog?kind=movie`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(15_000),
      });
      const page = await catalogue.json();
      if (catalogue.status !== 200 || page.total !== 1 || page.items?.length !== 1) {
        throw new Error("catalogue did not return exactly one review title");
      }
      const playback = await fetch(`https://${hostname}/api/v1/playback/33333333-3333-4333-8333-333333333333`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(15_000),
      });
      const source = await playback.json();
      if (playback.status !== 200 || source.mode !== "direct" || !source.url) {
        throw new Error("playback negotiation failed");
      }
      const video = await fetch(new URL(source.url, `https://${hostname}`), {
        headers: { Range: "bytes=0-1023" },
        signal: AbortSignal.timeout(30_000),
      });
      if (![200, 206].includes(video.status) || !video.headers.get("Content-Type")?.startsWith("video/")) {
        throw new Error(`video probe returned HTTP ${video.status}`);
      }
      await video.body?.cancel();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw new Error(`Review server verification failed: ${lastError}`);
}

await verifyDeployment();
console.log(JSON.stringify({ deployed: deployed.id ?? scriptName, hostname, verified: true }));
