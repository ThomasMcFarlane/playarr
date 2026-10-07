#!/usr/bin/env node
// Calendar remote-navigation, scroll-into-view, edge-fade and availability-border checks, against the
// deterministic mock API (nav-perf/server.mjs). These pin the rules every TV client copies:
//   week:   LEFT/RIGHT between days, UP/DOWN between entries inside a day
//   month:  LEFT/RIGHT between neighbouring cells, UP/DOWN between weeks
//   agenda: UP/DOWN moves the selection (details follow focus, no SELECT)
//   the focused entry is always scrolled into view; every scroller shows the rail edge fade
//   where content continues; the entry's left border shows availability, not the media kind
//
//   node scripts/calendar-nav.mjs [--no-build] [--dist dir]
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
const server = await startServer({ distDir: DIST });
const base = `http://127.0.0.1:${server.port}`;
const dir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const exe = process.env.NAV_PERF_CHROMIUM || (full ? join(dir, full, "chrome-linux64/chrome") : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const USER_ID = "00000000-0000-4000-8000-000000000001";
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
  failed ||= !ok;
};

async function open(view, viewport, theme = "light") {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(({ base, userId, theme }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
    localStorage.setItem("playarr-theme", theme);
  }, { base, userId: USER_ID, theme });
  const page = await context.newPage();
  await page.goto(`${base}/calendar?view=${view}&date=2026-10-07&platform=tv-webos`);
  await page.waitForSelector(view === "month" ? ".calendar-chip" : ".calendar-entry", { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector(".calendar-scroll .skeleton"));
  await page.waitForTimeout(500);
  return { context, page };
}

const key = async (page, k, n = 1) => {
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press(k);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(450); // edge fades re-measure once a remote hold settles
};
const focusInfo = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    const day = el.closest(".calendar-day");
    const cell = el.closest(".calendar-month-cell");
    const scroller = el.closest(".calendar-edge-scroller, .calendar-list-scroll, .calendar-day");
    const s = scroller?.getBoundingClientRect();
    return {
      cls: el.className?.toString(),
      x: r.x, y: r.y, w: r.width, h: r.height,
      day: day?.getAttribute("aria-label") ?? null,
      cell: cell ? [...cell.parentElement.children].indexOf(cell) + ":" + [...cell.closest(".calendar-month-body").children].indexOf(cell.parentElement) : null,
      title: el.querySelector(".calendar-entry-title")?.textContent ?? el.textContent,
      inView: s ? r.top >= s.top - 1 && r.bottom <= s.bottom + 1 && r.left >= s.left - 1 && r.right <= s.right + 1 : true,
    };
  });
const focusFirst = async (page, selector) => {
  await page.evaluate((s) => document.querySelector(s)?.focus(), selector);
  await page.waitForTimeout(150);
  return focusInfo(page);
};

try {
  // ---- Week: LEFT/RIGHT between days, UP/DOWN inside a day ----
  {
    const { context, page } = await open("week", { width: 1920, height: 1080 });
    // Focus the first entry of the second day column (it has two entries in the mock).
    await page.evaluate(() => document.querySelectorAll(".calendar-day")[1].querySelector(".calendar-entry").focus());
    await page.waitForTimeout(150);
    const a = await focusInfo(page);
    await key(page, "ArrowDown");
    const down = await focusInfo(page);
    check("week: DOWN stays in the same day and moves to the next entry", down?.day === a.day && down.y > a.y && Math.abs(down.x - a.x) < 2, JSON.stringify({ a, down }));
    await key(page, "ArrowUp");
    const up = await focusInfo(page);
    check("week: UP returns to the previous entry in the day", up?.day === a.day && Math.abs(up.y - a.y) < 2, JSON.stringify({ a, up }));
    await key(page, "ArrowRight");
    const right = await focusInfo(page);
    check("week: RIGHT moves to the next day, not up or down inside the day", right?.day && right.day !== a.day && right.x > a.x, JSON.stringify({ a, right }));
    await key(page, "ArrowLeft");
    const left = await focusInfo(page);
    check("week: LEFT moves back to the previous day", left?.day === a.day, JSON.stringify({ a, left }));
    await context.close();
  }

  // ---- Week: the focused entry is always scrolled into view, with fades ----
  {
    const { context, page } = await open("week", { width: 1280, height: 420 });
    const tall = await page.evaluate(() => {
      const days = [...document.querySelectorAll(".calendar-day")];
      const best = days.reduce((a, d) => (d.querySelectorAll(".calendar-entry").length > a.querySelectorAll(".calendar-entry").length ? d : a));
      best.querySelector(".calendar-entry").focus();
      return days.indexOf(best);
    });
    await page.waitForTimeout(150);
    let ok = true;
    let last;
    for (let i = 0; i < 4; i += 1) {
      await key(page, "ArrowDown");
      last = await focusInfo(page);
      ok &&= last?.inView === true;
    }
    check("week: focus moved down a tall day stays scrolled into view", ok, JSON.stringify(last));
    const fade = await page.evaluate((index) => {
      const win = document.querySelectorAll(".calendar-day-window")[index];
      return { cls: win.className, up: getComputedStyle(win, "::before").opacity, down: getComputedStyle(win, "::after").opacity };
    }, tall);
    check("week: a day column scrolled to its end shows the top fade only", /can-scroll-up/.test(fade.cls) && Number(fade.up) > 0.5 && !/can-scroll-down/.test(fade.cls), JSON.stringify(fade));
    const track = await page.evaluate(() => {
      const win = document.querySelector(".calendar-edge-window-x");
      return { cls: win.className, right: getComputedStyle(win, "::after").opacity };
    });
    check("week: the day track fades where more days continue", /can-scroll-right/.test(track.cls) && Number(track.right) > 0.5, JSON.stringify(track));
    await context.close();
  }

  // ---- Month: LEFT/RIGHT between cells, UP/DOWN between weeks ----
  {
    const { context, page } = await open("month", { width: 1920, height: 1080 });
    await page.evaluate(() => document.querySelectorAll(".calendar-month-row")[1].querySelectorAll(".calendar-month-cell")[2].querySelector(".calendar-chip").focus());
    await page.waitForTimeout(150);
    const a = await focusInfo(page);
    await key(page, "ArrowRight");
    const r = await focusInfo(page);
    check("month: RIGHT moves to the neighbouring day cell", r && r.cell !== a.cell && r.x > a.x && Math.abs(r.y - a.y) < a.h * 3, JSON.stringify({ a, r }));
    await key(page, "ArrowLeft");
    const l = await focusInfo(page);
    check("month: LEFT returns to the previous day cell", l?.cell === a.cell, JSON.stringify({ a, l }));
    await key(page, "ArrowDown", 2);
    const d = await focusInfo(page);
    check("month: DOWN moves to a later week", d && d.y > a.y, JSON.stringify({ a, d }));
    await context.close();
  }
  // Narrow month grid: horizontal fade where the grid scrolls sideways.
  {
    const { context, page } = await open("month", { width: 600, height: 800 });
    await page.waitForTimeout(500);
    const fade = await page.evaluate(() => {
      const win = document.querySelector(".calendar-edge-window-x");
      return { cls: win.className, right: getComputedStyle(win, "::after").opacity };
    });
    check("month: a sideways-scrolling grid shows the right fade", /can-scroll-right/.test(fade.cls) && Number(fade.right) > 0.5, JSON.stringify(fade));
    await context.close();
  }

  // ---- Agenda: details follow focus; list and details fade; scroll into view ----
  {
    const { context, page } = await open("agenda", { width: 1920, height: 500 });
    const title = () => page.evaluate(() => document.querySelector(".calendar-details h2")?.textContent ?? null);
    const selected = () => page.evaluate(() => document.querySelector(".calendar-entry.is-selected .calendar-entry-title")?.textContent ?? null);
    await page.evaluate(() => document.querySelector(".calendar-entry").focus());
    await page.waitForTimeout(200);
    const first = await title();
    let changed = false;
    let ok = true;
    let info;
    for (let i = 0; i < 8; i += 1) {
      await key(page, "ArrowDown");
      info = await focusInfo(page);
      ok &&= info?.inView === true;
      const now = await title();
      const sel = await selected();
      changed ||= now !== first;
      ok &&= sel === info.title.split("\n")[0] || (sel && info.title.startsWith(sel));
    }
    check("agenda: DOWN changes the selected item and the details panel without SELECT", changed && ok, JSON.stringify({ first, now: await title(), selected: await selected(), info }));
    check("agenda: the focused entry stays scrolled into view", info?.inView === true, JSON.stringify(info));
    const fades = await page.evaluate(() => {
      const list = document.querySelector(".calendar-list-scroll").closest(".tv-scroll-edge-window");
      const pane = document.querySelector(".master-detail-pane-window");
      return {
        listCls: list.className, listUp: getComputedStyle(list, "::before").opacity, listDown: getComputedStyle(list, "::after").opacity,
        paneCls: pane.className,
      };
    });
    check("agenda: the list shows the bottom fade where it continues and the top fade once scrolled", /can-scroll-up/.test(fades.listCls) && /can-scroll-down/.test(fades.listCls) && Number(fades.listDown) > 0.5 && Number(fades.listUp) > 0.5, JSON.stringify(fades));
    await context.close();
  }
  // Details panel: a short viewport makes the details pane scroll, so it must fade too.
  {
    const { context, page } = await open("agenda", { width: 1920, height: 260 });
    const pane = await page.evaluate(() => {
      const win = document.querySelector(".master-detail-pane-window");
      const el = win.querySelector(".master-detail-pane");
      return { scrolls: el.scrollHeight > el.clientHeight, cls: win.className, down: getComputedStyle(win, "::after").opacity };
    });
    check("agenda: the details panel fades at the bottom where it continues", pane.scrolls && /can-scroll-down/.test(pane.cls) && Number(pane.down) > 0.5, JSON.stringify(pane));
    await context.close();
  }

  // ---- Dark theme: the edge fade is a real scrim in the page background, clearly visible ----
  {
    const { context, page } = await open("agenda", { width: 1920, height: 500 }, "dark");
    await page.waitForTimeout(500);
    const dark = await page.evaluate(() => {
      const win = document.querySelector(".calendar-list-scroll").closest(".tv-scroll-edge-window");
      const after = getComputedStyle(win, "::after");
      return { cls: win.className, opacity: Number(after.opacity), image: after.backgroundImage, height: parseFloat(after.height) };
    });
    check("dark: the bottom edge scrim is a background gradient at high opacity and at least 56px tall", /can-scroll-down/.test(dark.cls) && dark.opacity >= 0.9 && /linear-gradient/.test(dark.image) && dark.height >= 56, JSON.stringify(dark));
    await context.close();
  }

  // ---- Border colour: availability, never media kind or library ----
  for (const theme of ["light", "dark"]) {
    const { context, page } = await open("agenda", { width: 1920, height: 1080 }, theme);
    const m = await page.evaluate(() => {
      const probe = (name) => {
        const el = document.createElement("i");
        el.style.color = `var(${name})`;
        document.body.append(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      };
      const rows = [...document.querySelectorAll(".calendar-entry")].map((el) => ({
        cls: el.className,
        border: getComputedStyle(el).borderLeftColor,
        width: getComputedStyle(el).borderLeftWidth,
      }));
      return { success: probe("--success"), muted: probe("--ink-muted"), rows };
    });
    const have = m.rows.filter((r) => r.cls.includes("calendar-availability-available"));
    const lack = m.rows.filter((r) => r.cls.includes("calendar-availability-unavailable"));
    check(`border (${theme}): available entries use --success`, have.length > 0 && have.every((r) => r.border === m.success && r.width === "4px"), JSON.stringify({ m: m.success, have: have[0] }));
    check(`border (${theme}): unavailable entries use --ink-muted`, lack.length > 0 && lack.every((r) => r.border === m.muted), JSON.stringify({ m: m.muted, lack: lack[0] }));
    check(`border (${theme}): no media-kind colour classes remain`, m.rows.every((r) => !/calendar-kind-/.test(r.cls)), m.rows[0]?.cls);
    await context.close();
  }
} finally {
  await browser.close();
  server.close?.();
}
process.exit(failed ? 1 : 0);
