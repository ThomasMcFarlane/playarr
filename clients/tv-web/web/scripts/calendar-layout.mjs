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
      await page.waitForSelector(".calendar-month-cell .calendar-line", { timeout: 15000 });
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
          for (const chip of cell.querySelectorAll(".calendar-line")) {
            const cs = getComputedStyle(chip);
            const boxed = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(cs[`border${side}Width`]) > 0) || cs.boxShadow !== "none";
            if (boxed) bad.push({ day, what: "entry has a box (background, border or shadow)" });
            if (!chip.querySelector(".calendar-dot")) bad.push({ day, what: "entry has no status dot" });
            else {
              // Non-text contrast of the dot (3:1) against the cell's effective background.
              const rgb = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
              const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
              let bg = null;
              for (let el = cell; el && !bg; el = el.parentElement) { const c = rgb(getComputedStyle(el).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] === 1)) bg = c; }
              const dot = rgb(getComputedStyle(chip.querySelector(".calendar-dot")).backgroundColor);
              if (bg && dot.length >= 3) {
                const [hi, lo] = [lum(dot), lum(bg)].sort((a, b) => b - a);
                if ((hi + 0.05) / (lo + 0.05) < 3) bad.push({ day, what: "dot contrast below 3:1" });
              }
            }
            if (!chip.getAttribute("aria-label")) bad.push({ day, what: "entry has no accessible name" });
            const r = chip.getBoundingClientRect();
            if (!inside(r)) bad.push({ day, what: "chip", cell: [c.top, c.bottom].map(Math.round), box: [r.top, r.bottom].map(Math.round) });
          }
        }
        // The day number shares the bottom row with "+N more" (or sits alone on it): both lie inside the cell.
        for (const cell of document.querySelectorAll(".calendar-month-cell")) {
          const c = cell.getBoundingClientRect();
          const r = cell.querySelector(".calendar-month-day")?.getBoundingClientRect();
          if (!r || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) bad.push({ what: "day number" });
        }
        // Every day with 2+ entries shows at least one chip.
        let noChip = 0;
        for (const cell of document.querySelectorAll(".calendar-month-cell")) {
          if (cell.querySelector(".calendar-more") && !cell.querySelector(".calendar-line")) noChip += 1;
        }
        const lines = [...document.querySelectorAll(".calendar-month-cell")].map((cell) => cell.querySelectorAll(".calendar-line").length);
        return { more, bad, noChip, maxLines: Math.max(...lines) };
      });
      await context.close();
      // At 1280x720 a busy day shows at least two entries.
      const ok = result.bad.length === 0 && result.noChip === 0 && (vp.width > 1280 || density !== "dense" || result.maxLines >= 2) && (density === "default" || result.more > 0);
      console.log(`${ok ? "PASS" : "FAIL"}  ${label} month ${theme} ${density}: ${result.more} "+N more" lines and every text entry (dot, no box) and day number fully inside their cells, an entry beside every "+N more", up to ${result.maxLines} entries a day`, ok ? "" : JSON.stringify({ noChip: result.noChip, bad: result.bad.slice(0, 3) }));
      failed ||= !ok;
    }
  }
}
// Gap to the shell action column: the calendar's month, week and agenda keep the same gap between their content and
// the column as the Movies grid (the shared page gutter), at 1920 and 1280.
for (const [vp, label] of [[{ width: 1920, height: 1080 }, "1920x1080"], [{ width: 1280, height: 720 }, "1280x720"]]) {
  const gaps = {};
  for (const [name, route, selector] of [["movies", "/movies", ".tv-title-card"], ["month", "/calendar?view=month&date=2026-10-07", ".calendar-month-body"], ["week", "/calendar?view=week&date=2026-10-07", ".calendar-week-scroll"], ["agenda", "/calendar?view=agenda&date=2026-10-07", ".calendar-entry"]]) {
    const context = await browser.newContext({ viewport: vp });
    await context.addInitScript(({ base: apiBase, userId }) => {
      localStorage.setItem("playarr:apiBaseUrl", apiBase);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: apiBase, userId, name: "P", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: apiBase, userId }));
    }, { base: denseBase, userId: USER_ID });
    const page = await context.newPage();
    await page.goto(`${denseBase}${route}`);
    await page.waitForSelector(selector, { timeout: 15000 });
    await page.waitForTimeout(1500);
    gaps[name] = await page.evaluate((sel) => {
      const column = document.querySelector(".shell-action-column")?.getBoundingClientRect();
      const rights = [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect().right).filter((x) => x <= innerWidth + 1);
      return column && rights.length ? column.left - Math.max(...rights) : null;
    }, selector);
    await context.close();
  }
  for (const name of ["month", "week", "agenda"]) {
    const ok = gaps.movies != null && gaps[name] != null && Math.abs(gaps[name] - gaps.movies) <= 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} ${name}: gap to the action column ${gaps[name]?.toFixed(1)}px equals Movies ${gaps.movies?.toFixed(1)}px (+-1)`);
    failed ||= !ok;
  }
}
await browser.close();
server.close?.();
denseServer.close?.();
process.exit(failed ? 1 : 0);
