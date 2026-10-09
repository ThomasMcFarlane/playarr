#!/usr/bin/env node
// Headless check that every filterable page renders the Filters button through the
// shared PageHeader slot: identical component classes and identical bounding box on
// Movies, Series, Playlists and the Release Calendar (against the deterministic mock API).
//
//   node scripts/header-parity.mjs [--no-build] [--dist dir]
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
const USER_ID = "00000000-0000-4000-8000-000000000001";
const server = await startServer({ distDir: DIST });
const base = `http://127.0.0.1:${server.port}`;
const dir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const browser = await chromium.launch(
  process.env.NAV_PERF_CHROMIUM || full ? { executablePath: process.env.NAV_PERF_CHROMIUM || join(dir, full, "chrome-linux64/chrome") } : {}
);
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.addInitScript(({ base, userId }) => {
  localStorage.setItem("playarr:apiBaseUrl", base);
  const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
  localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }]));
  localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
}, { base, userId: USER_ID });
const page = await context.newPage();
const boxes = {};
const panelBoxes = {};
for (const [name, path] of [["movies", "/movies"], ["series", "/series"], ["playlists", "/playlists"], ["calendar", "/calendar"]]) {
  await page.goto(`${base}${path}`);
  await page.waitForSelector("[data-filters-button]", { timeout: 20000 });
  boxes[name] = await page.evaluate(() => {
    const r = document.querySelector("[data-filters-button]").getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cls: document.querySelector("[data-filters-button]").className };
  });
  panelBoxes[name] = await page.evaluate(() => {
    const el = document.querySelector(".page-header-stack > :not([data-filters-button])");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { right: Math.round(r.right), y: Math.round(r.y), h: Math.round(r.height), cls: el.className };
  });
}
await browser.close();
server.close?.();
let failed = false;
for (const name of ["series", "playlists", "calendar"]) {
  const a = boxes.movies;
  const b = boxes[name];
  // The shell action column stacks every action vertically with Filters last (owner ruling 8 October 2026), so a page that
  // also has Create or a calendar link puts Filters lower: the component, size and column (x) must match, and a page with
  // an extra action must put Filters below it, never above or beside.
  const ok = a.x === b.x && a.w === b.w && a.h === b.h && a.cls === b.cls && b.y >= a.y;
  console.log(`${ok ? "PASS" : "FAIL"}  Filters button on ${name} matches movies`, ok ? "" : JSON.stringify({ movies: a, [name]: b }));
  failed ||= !ok;
}
// The second header button (Playlists "Create" vs the Calendar's subscription link) must be the same
// component, height, vertical position and right edge: the owner flagged this twice.
{
  const a = panelBoxes.playlists;
  const b = panelBoxes.calendar;
  const ok = Boolean(a && b) && a.right === b.right && a.y === b.y && a.h === b.h && a.cls === b.cls;
  console.log(`${ok ? "PASS" : "FAIL"}  Calendar panel button matches Playlists Create`, ok ? "" : JSON.stringify({ playlists: a, calendar: b }));
  failed ||= !ok;
}
process.exit(failed || process.exitCode ? 1 : 0);
