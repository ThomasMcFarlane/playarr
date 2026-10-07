#!/usr/bin/env node
// Regression guard for "clicking the profile chip freezes the browser" (and /clients never finishing).
// Signs in against the deterministic mock API, clicks the profile chip in the left rail and asserts the
// profile page settles: the route is /profiles, the main thread stays responsive, and both the request
// count and the DOM mutation count stay under a small budget over a quiet window. Then follows the
// Clients link and asserts the same. Runs desktop and TV layouts in both themes.
//
//   node scripts/profile-chip-settle.mjs [--no-build] [--dist dir]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const distIdx = args.indexOf("--dist");
const DIST = distIdx >= 0 ? args[distIdx + 1] : join(root, "dist");
if (!args.includes("--no-build") && distIdx < 0) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const MAX_REQUESTS = 25;
const MAX_MUTATIONS = 400;
const QUIET_MS = 3000;
const USER_ID = "00000000-0000-4000-8000-000000000001";
const server = await startServer({ distDir: DIST });
const base = `http://127.0.0.1:${server.port}`;
const dir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const browser = await chromium.launch(
  process.env.NAV_PERF_CHROMIUM || full ? { executablePath: process.env.NAV_PERF_CHROMIUM || join(dir, full, "chrome-linux64/chrome") } : {}
);

const failures = [];
async function settle(page, label, reqs, action, expectPath) {
  await page.evaluate(() => {
    window.__mutations = 0;
    new MutationObserver((l) => { window.__mutations += l.length; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const before = reqs.n;
  await action();
  await page.waitForTimeout(QUIET_MS);
  const probe = await Promise.race([
    page.evaluate(() => ({ path: location.pathname, mutations: window.__mutations ?? 0 })),
    new Promise((r) => setTimeout(() => r(null), 5000)),
  ]);
  const requests = reqs.n - before;
  if (!probe) failures.push(`${label}: main thread unresponsive after the click`);
  else {
    if (probe.path !== expectPath) failures.push(`${label}: expected ${expectPath}, got ${probe.path}`);
    if (probe.mutations > MAX_MUTATIONS) failures.push(`${label}: ${probe.mutations} DOM mutations in ${QUIET_MS}ms (budget ${MAX_MUTATIONS})`);
  }
  if (requests > MAX_REQUESTS) failures.push(`${label}: ${requests} requests in ${QUIET_MS}ms (budget ${MAX_REQUESTS})`);
  console.log(`${label}: path=${probe?.path} mutations=${probe?.mutations} requests=${requests}`);
}

for (const layout of ["desktop", "tv"]) {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await context.addInitScript(({ base, userId, theme }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      localStorage.setItem("playarr-theme", theme);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
    }, { base, userId: USER_ID, theme });
    const page = await context.newPage();
    const reqs = { n: 0 };
    page.on("request", () => { reqs.n += 1; });
    await page.goto(`${base}/${layout === "tv" ? "?platform=tv-vidaa" : ""}`);
    await page.waitForSelector(".app-user-identity", { timeout: 20000 });
    await page.waitForTimeout(1500);
    const tag = `${layout}/${theme}`;
    await settle(page, `${tag} chip`, reqs, () => page.click(".app-user-identity", { timeout: 8000 }), "/profiles");
    await settle(page, `${tag} clients`, reqs, () => page.click('a[href="/clients"]', { timeout: 8000 }), "/clients");
    await context.close();
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`FAIL\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("OK: profile chip and Clients settle within budget");
