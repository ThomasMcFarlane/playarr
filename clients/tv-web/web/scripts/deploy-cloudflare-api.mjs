import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const scriptName = "playarr-web";
// Zone that holds the DNS-only relay records, supplied by the deploy environment.
const relayZoneId = process.env.PLAYARR_RELAY_ZONE_ID;
// Runs the daily relay DNS cleanup (`scheduled` in worker.js).
const relayCleanupCron = "17 4 * * *";
const assetsDirectory = resolve("web/dist");
const workerBundle = resolve("web/dist-worker.mjs");

if (!existsSync(assetsDirectory)) throw new Error(`Missing assets: ${assetsDirectory}`);
if (!existsSync(workerBundle)) throw new Error(`Missing Worker bundle: ${workerBundle}`);
if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is required");
if (!relayZoneId) throw new Error("PLAYARR_RELAY_ZONE_ID is required");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function assetFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? assetFiles(path) : [path];
  });
}

const filesByHash = new Map();
const manifest = Object.fromEntries(
  assetFiles(assetsDirectory)
    // `_headers` is configuration, not a served asset: it is sent with the deployment metadata.
    .filter((filePath) => relative(assetsDirectory, filePath) !== "_headers")
    .sort()
    .map((filePath) => {
      const content = readFileSync(filePath);
      const extension = extname(filePath).slice(1);
      const hash = createHash("sha256")
        .update(content.toString("base64") + extension)
        .digest("hex")
        .slice(0, 32);
      const assetPath = `/${relative(assetsDirectory, filePath).split(sep).join("/")}`;
      filesByHash.set(hash, { content, filePath });
      return [assetPath, { hash, size: content.length }];
    }),
);

async function request(path, init = {}, bearer = apiToken) {
  let response;
  let networkError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch (error) {
      networkError = error;
      if (attempt === 4) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * 2 ** attempt));
      continue;
    }
    if (![409, 429].includes(response.status) && response.status < 500) break;
    if (attempt < 4) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * 2 ** attempt));
  }

  if (!response) throw networkError ?? new Error("Cloudflare API request did not complete");
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(`Cloudflare API ${response.status}: non-JSON response`);
  }
  if (!response.ok || payload.success !== true) {
    const errors = payload.errors
      ?.map((error) => `${error.code ?? "unknown"}: ${error.message}`)
      .join("; ");
    throw new Error(`Cloudflare API ${response.status}: ${errors || "request failed"}`);
  }
  return payload.result;
}

const session = await request(
  `/accounts/${accountId}/workers/scripts/${scriptName}/assets-upload-session`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest }),
  },
);

if (!session.jwt || !Array.isArray(session.buckets)) {
  throw new Error("Cloudflare did not return an asset upload session");
}

let completionJwt = session.buckets.length === 0 ? session.jwt : undefined;
for (const bucket of session.buckets) {
  const form = new FormData();
  for (const hash of bucket) {
    const file = filesByHash.get(hash);
    if (!file) throw new Error(`Cloudflare requested unknown asset hash ${hash}`);
    const type = mimeTypes.get(extname(file.filePath).toLowerCase()) ?? "application/octet-stream";
    form.append(hash, new Blob([file.content.toString("base64")], { type }), hash);
  }
  const result = await request(
    `/accounts/${accountId}/workers/assets/upload?base64=true`,
    { method: "POST", body: form },
    session.jwt,
  );
  if (result.jwt) completionJwt = result.jwt;
}

if (!completionJwt) throw new Error("Cloudflare did not return the asset completion token");

const metadata = {
  main_module: "worker.mjs",
  compatibility_date: "2026-07-17",
  compatibility_flags: ["nodejs_compat"],
  // The relay secrets (RELAY_HMAC_SECRET, RELAY_CF_API_TOKEN) are set once out
  // of band; a deploy must not drop them.
  keep_bindings: ["secret_text"],
  bindings: [
    { name: "RELAY_ZONE_ID", type: "plain_text", text: relayZoneId },
    { name: "ASSETS", type: "assets" },
    {
      name: "LINK_SESSIONS",
      type: "durable_object_namespace",
      class_name: "LinkSession",
    },
  ],
  assets: {
    jwt: completionJwt,
    config: {
      ...(existsSync(resolve(assetsDirectory, "_headers"))
        ? { _headers: readFileSync(resolve(assetsDirectory, "_headers"), "utf8") }
        : {}),
      not_found_handling: "single-page-application",
      run_worker_first: [
        "/api/*",
        "/cast",
        "/cast/*",
        "/clients",
        "/clients/*",
        "/downloads/*",
        "/legal/*",
      ],
    },
  },
};

const deployment = new FormData();
deployment.append(
  "metadata",
  new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  "metadata.json",
);
deployment.append(
  "worker.mjs",
  new Blob([readFileSync(workerBundle)], { type: "application/javascript+module" }),
  "worker.mjs",
);

const result = await request(`/accounts/${accountId}/workers/scripts/${scriptName}`, {
  method: "PUT",
  body: deployment,
});

await request(`/accounts/${accountId}/workers/scripts/${scriptName}/schedules`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify([{ cron: relayCleanupCron }]),
});

async function verifyPublicLegalPage() {
  const url = "https://playarr.app/legal/privacy";
  let lastResult = "no response";
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      const isPublicPolicy =
        response.status === 200 &&
        !response.headers.has("Location") &&
        body.includes("<title>Privacy policy · Playarr</title>");
      if (isPublicPolicy) return;
      lastResult = `HTTP ${response.status}, title=${body.match(/<title>([^<]*)<\/title>/)?.[1] ?? "missing"}`;
    } catch (error) {
      lastResult = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 10) await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
  }
  throw new Error(`Public privacy-policy verification failed: ${lastResult}`);
}

await verifyPublicLegalPage();

console.log(
  JSON.stringify({
    deployed: result.id ?? scriptName,
    modifiedOn: result.modified_on,
    assets: Object.keys(manifest).length,
  }),
);
