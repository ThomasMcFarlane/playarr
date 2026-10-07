#!/usr/bin/env node
// Layout regression check for tablet widths: page titles, hero titles and settings labels must not sit under the
// navigation rail, collide with the clock, run off screen or be clipped, at every width from 600 to 1100 px (20 px
// steps) plus 1280 and 1920, on Home, Movies, Series, film detail, Search, Calendar and Settings, in both themes.
// 820x1180 (iPad Air portrait) is checked first and, with --shots <dir>, captured as screenshots.
// Uses the deterministic mock API of nav-perf.mjs, so no fixture server is needed.
//
//   node scripts/tablet-layout.mjs [--no-build] [--dist dir] [--shots dir] [--from 600 --to 1100 --step 20]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const DIST = opt("dist", join(root, "dist"));
const SHOTS = opt("shots", "");
if (!args.includes("--no-build") && !opt("dist", "")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const FROM = Number(opt("from", 600));
const TO = Number(opt("to", 1100));
const STEP = Number(opt("step", 20));
const WIDTHS = [];
for (let w = FROM; w <= TO; w += STEP) WIDTHS.push(w);
WIDTHS.push(1280, 1920);

const server = await startServer({ distDir: DIST, movies: 12, series: 8, artists: 0 });
const base = `http://127.0.0.1:${server.port}`;
const dir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const exe = process.env.NAV_PERF_CHROMIUM || (full ? join(dir, full, "chrome-linux64/chrome") : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const USER_ID = "00000000-0000-4000-8000-000000000001";
const movieId = (await (await fetch(`${base}/api/v1/catalog?kind=movie&limit=1`)).json()).items[0].id;
const ROUTES = {
  home: "/",
  movies: "/movies",
  series: "/series",
  film: `/movies/${movieId}`,
  search: "/search",
  calendar: "/calendar?view=month&date=2026-10-07",
  settings: "/settings",
};

// Runs in the page. Returns a list of problems (strings) for the current layout.
function inspect() {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const textRect = (e) => {
    const range = document.createRange();
    range.selectNodeContents(e);
    return range.getBoundingClientRect();
  };
  const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const problems = [];
  const rail = [...document.querySelectorAll(".app-nav-group")].filter(vis).map((e) => e.getBoundingClientRect());
  const clock = document.querySelector(".app-clock");
  const clockRect = clock && vis(clock) ? clock.getBoundingClientRect() : null;
  const titles = [...document.querySelectorAll("h1, h2, .page-header-title-block span, .tv-home-feature > p, .tv-detail-copy > p")].filter(vis);
  for (const e of titles) {
    const text = e.textContent.trim();
    if (!text) continue;
    const t = textRect(e);
    if (t.width < 1 || t.bottom < 0 || t.top > innerHeight) continue;
    const name = `${e.tagName.toLowerCase()} "${text.slice(0, 24)}"`;
    if (rail.some((g) => hit(t, g))) problems.push(`${name} overlaps the navigation rail`);
    if (clockRect && hit(t, clockRect)) problems.push(`${name} overlaps the clock`);
    if (t.left < -1 || t.right > innerWidth + 1) problems.push(`${name} runs off screen (${Math.round(t.left)}..${Math.round(t.right)})`);
  }
  if (innerWidth > 760) {
    for (const e of document.querySelectorAll(".settings-option-copy strong, .tv-library-heading h1")) {
      if (vis(e) && e.scrollWidth > e.clientWidth + 1) problems.push(`"${e.textContent.trim().slice(0, 24)}" is clipped with an ellipsis`);
    }
    const month = document.querySelector(".calendar-month-scroll");
    if (month && month.scrollWidth > month.clientWidth + 1) problems.push("calendar month grid is cut off (needs sideways scrolling)");
  }
  return problems;
}

const failures = [];
const affected = new Map();
async function run(width, height, theme, name, route, shotDir) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
  await context.addInitScript(({ base, userId, theme }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    localStorage.setItem("playarr-theme", theme);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
  }, { base, userId: USER_ID, theme });
  const page = await context.newPage();
  await page.goto(base + route);
  await page.waitForSelector(".app-nav", { timeout: 20000 });
  await page.waitForTimeout(900);
  const problems = await page.evaluate(inspect);
  if (shotDir) await page.screenshot({ path: join(shotDir, `${name}-${theme}-${width}x${height}.png`) });
  await context.close();
  for (const p of problems) {
    failures.push(`${width}x${height} ${theme} ${name}: ${p}`);
    const key = `${name}/${theme}`;
    affected.set(key, [...(affected.get(key) ?? []), width]);
  }
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
for (const theme of ["light", "dark"]) for (const [name, route] of Object.entries(ROUTES)) await run(820, 1180, theme, name, route, SHOTS);
console.log(`${failures.length ? "FAIL" : "PASS"}  820x1180 (iPad Air portrait): ${failures.length} problem(s)`);
const at820 = failures.length;
for (const theme of ["light", "dark"]) {
  for (const [name, route] of Object.entries(ROUTES)) {
    for (const width of WIDTHS) {
      if (width === 820) continue; // iPad height above; the sweep uses a short desktop-like window
      await run(width, 900, theme, name, route, "");
    }
  }
}
console.log(`${failures.length > at820 ? "FAIL" : "PASS"}  width sweep ${WIDTHS.join(",")}`);
for (const f of failures) console.log(`  - ${f}`);
for (const [key, widths] of affected) console.log(`  affected ${key}: ${[...new Set(widths)].join(", ")}`);
await browser.close();
server.close?.();
process.exit(failures.length ? 1 : 0);
