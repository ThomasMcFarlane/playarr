// A port-less public address connects to a server that listens on 8484 only (the default
// PLAYARR_HTTP_BIND_ADDR): the client tries the relay name on 443, falls back to :8484, signs in and
// remembers the port. A generic public address (never a real host) is mapped to loopback by Chromium's
// host resolver rules, so no DNS, hosts file or privileged port is involved; nothing listens on 443.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttps } from "node:https";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";
import { chromiumExecutable } from "./chromium-launch.mjs";
import { root, opt } from "./e2e-common.mjs";

const ADDRESS = "11.22.33.44";
const RELAY_HOST = "v4-11-22-33-44.relay.playarr.app";
const API_PORT = 8484;

if (!process.argv.includes("--no-build") && !opt("dist", "")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const dist = opt("dist", join(root, "dist"));

const dir = mkdtempSync(join(tmpdir(), "relay-port-"));
const cert = spawnSync(
  "openssl",
  ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${RELAY_HOST}`,
    "-addext", `subjectAltName=DNS:${RELAY_HOST},IP:127.0.0.1`, "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")],
  { stdio: "ignore" }
);
if (cert.status !== 0) throw new Error("openssl could not create the test certificate");
const tls = { key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) };

const mock = await startServer({ distDir: dist, movies: 6, series: 2, artists: 0 });
const forward = (req, res, extra = {}) => {
  const upstream = httpRequest({ host: "127.0.0.1", port: mock.port, method: req.method, path: req.url, headers: req.headers }, (u) => {
    res.writeHead(u.statusCode ?? 502, { ...u.headers, ...extra });
    u.pipe(res);
  });
  upstream.on("error", () => res.writeHead(502).end());
  req.pipe(upstream);
};

// The page: served over https so the client applies the relay normaliser (as on the hosted web client).
const pageServer = createHttps(tls, (req, res) => forward(req, res));
await new Promise((r) => pageServer.listen(0, "127.0.0.1", r));
const pageOrigin = `https://127.0.0.1:${pageServer.address().port}`;

// The Playarr Server: listens on 8484 ONLY.
const apiHits = [];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const apiServer = createHttps(tls, (req, res) => {
  apiHits.push(`${req.method} ${req.url.split("?")[0]}`);
  if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
  if (req.url.startsWith("/api/system/version")) {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return void res.end(JSON.stringify({ instance_name: "Test Server", server_version: "0.0.0" }));
  }
  forward(req, res, cors);
});
await new Promise((resolve, reject) => {
  apiServer.once("error", reject);
  apiServer.listen(API_PORT, "127.0.0.1", resolve);
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
};

const exe = chromiumExecutable();
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: [`--host-resolver-rules=MAP ${RELAY_HOST} 127.0.0.1`, "--ignore-certificate-errors"],
});
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const attempts = [];
  page.on("request", (r) => { if (r.url().includes(RELAY_HOST)) attempts.push(r.url()); });
  await page.goto(`${pageOrigin}/login`);
  await page.waitForSelector("#login-server-url");
  await page.fill("#login-server-url", ADDRESS);
  await page.fill('input[name="username"]', "tester");
  await page.fill('input[name="password"]', "secret-pass");
  const started = Date.now();
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
  const elapsed = Date.now() - started;

  check("signed in through the port-less address", !new URL(page.url()).pathname.startsWith("/login"), page.url());
  check("the server bound to 8484 only received the sign-in", apiHits.includes("POST /api/v1/auth/login"), JSON.stringify(apiHits));
  check("443 was tried first", attempts.some((u) => u.startsWith(`https://${RELAY_HOST}/`)), JSON.stringify(attempts));
  check("fell back within the probe timeout", elapsed < 12000, `${elapsed} ms`);
  const stored = await page.evaluate(() => localStorage.getItem("playarr:apiBaseUrl"));
  check("persisted the 8484 address", stored === `https://${RELAY_HOST}:${API_PORT}`, String(stored));
  const memory = await page.evaluate(() => localStorage.getItem("playarr:relayPort.v1"));
  check("remembered the working port", Boolean(memory && JSON.parse(memory)[RELAY_HOST] === "8484"), String(memory));

  // A later launch goes straight to 8484: no request to the port-less name.
  attempts.length = 0;
  await page.reload();
  await page.waitForTimeout(1500);
  check("later launch makes no 443 attempt", attempts.every((u) => u.startsWith(`https://${RELAY_HOST}:${API_PORT}/`)), JSON.stringify(attempts));
  await context.close();
} finally {
  await browser.close();
  apiServer.close();
  pageServer.close();
  await mock.close?.();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
