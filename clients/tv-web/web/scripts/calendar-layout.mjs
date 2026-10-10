#!/usr/bin/env node
// Layout-shift check for the Calendar: the skeleton shown while loading must
// occupy exactly the same boxes as the loaded view (month grid / week track / agenda
// stage with the Library list panel), at TV 1920x1080, 1280x720 and phone 390x844. Uses the mock API with a
// delayed calendar response so both states can be measured.
//
//   node scripts/calendar-layout.mjs [--no-build] [--dist dir]
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
const server = await startServer({ distDir: DIST, calendarDelayMs: 1800 });
const base = `http://127.0.0.1:${server.port}`;
// A second mock with no response delay and up to seven entries per day, for the "+N more" fit check below.
const denseServer = await startServer({ distDir: DIST, calendarPerDay: 7 });
const denseBase = `http://127.0.0.1:${denseServer.port}`;
const dir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const exe = process.env.NAV_PERF_CHROMIUM || (full ? join(dir, full, "chrome-linux64/chrome") : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const USER_ID = "00000000-0000-4000-8000-000000000001";

const REGIONS = {
  month: [".calendar-scroll", ".calendar-month-body", ".calendar-month-cell"],
  week: [".calendar-scroll", ".calendar-week-scroll", ".calendar-day"],
  agenda: [".tv-library-grid-panel", ".tv-title-grid"],
};
let failed = false;
for (const [vp, label, mobile] of [[{ width: 1920, height: 1080 }, "1920x1080", false], [{ width: 1280, height: 720 }, "1280x720", false], [{ width: 390, height: 844 }, "390x844", true]]) {
  for (const view of ["month", "week", "agenda"]) {
    const context = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(({ base, userId }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
    }, { base, userId: USER_ID });
    const page = await context.newPage();
    await page.goto(`${base}/calendar?view=${view}&date=2026-10-07`);
    await page.waitForSelector(".calendar-scroll .skeleton, .tv-library-grid-panel .skeleton", { timeout: 15000 });
    const measure = () =>
      page.evaluate((selectors) => {
        const round = (n) => Math.round(n * 10) / 10;
        return selectors.map((selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { selector, x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
        });
      }, REGIONS[view]);
    if (view === "agenda") await page.waitForTimeout(900); // the stage entrance animation settles
    const loading = await measure();
    await page.waitForFunction(() => !document.querySelector(".calendar-scroll .skeleton, .tv-library-grid-panel .skeleton"), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const loaded = await measure();
    await context.close();
    const same = JSON.stringify(loading) === JSON.stringify(loaded);
    console.log(`${same ? "PASS" : "FAIL"}  ${label} ${view}: skeleton boxes match loaded boxes`, same ? "" : JSON.stringify({ loading, loaded }));
    failed ||= !same;
  }
}

// "+N more" fit: in the month view the "+N more" button must lie fully inside its day cell (never clipped by the
// cell's overflow) at every TV size, in both themes, with few entries per day (mock default, up to 4) and many (up to 7).
for (const [vp, label] of [[{ width: 1920, height: 1080 }, "1920x1080"], [{ width: 1366, height: 768 }, "1366x768"], [{ width: 1280, height: 720 }, "1280x720"]]) {
  for (const theme of ["dark", "light"]) {
    for (const [origin, density] of [[base, "default"], [denseBase, "dense"]]) {
      const context = await browser.newContext({ viewport: vp, colorScheme: theme });
      await context.addInitScript(({ base: apiBase, userId }) => {
        localStorage.setItem("playarr:apiBaseUrl", apiBase);
        const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
        localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: apiBase, userId, name: "P", deviceId: "d", session }]));
        localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: apiBase, userId }));
      }, { base: origin, userId: USER_ID });
      const page = await context.newPage();
      await page.goto(`${origin}/calendar?view=month&date=2026-10-07`);
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.waitForSelector(".calendar-month-cell .calendar-chip", { timeout: 15000 });
      await page.waitForFunction(() => !document.querySelector(".calendar-scroll .skeleton"), null, { timeout: 15000 });
      await page.waitForTimeout(400);
      const result = await page.evaluate(() => {
        const bad = [];
        let more = 0;
        for (const cell of document.querySelectorAll(".calendar-month-cell")) {
          const c = cell.getBoundingClientRect();
          const inside = (r) => r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5;
          const day = cell.querySelector("time")?.getAttribute("datetime");
          const btn = cell.querySelector(".calendar-more");
          if (btn) {
            more += 1;
            const r = btn.getBoundingClientRect();
            if (!inside(r)) bad.push({ day, what: "more", cell: [c.top, c.bottom].map(Math.round), box: [r.top, r.bottom].map(Math.round) });
          }
          for (const chip of cell.querySelectorAll(".calendar-chip")) {
            const r = chip.getBoundingClientRect();
            if (!inside(r)) bad.push({ day, what: "chip", cell: [c.top, c.bottom].map(Math.round), box: [r.top, r.bottom].map(Math.round) });
          }
        }
        return { more, bad };
      });
      await context.close();
      const ok = result.bad.length === 0 && (density === "default" || result.more > 0);
      console.log(`${ok ? "PASS" : "FAIL"}  ${label} month ${theme} ${density}: ${result.more} "+N more" lines and every chip fully inside their cells`, ok ? "" : JSON.stringify(result.bad.slice(0, 3)));
      failed ||= !ok;
    }
  }
}
await browser.close();
server.close?.();
denseServer.close?.();
process.exit(failed ? 1 : 0);
