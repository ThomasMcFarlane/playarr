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
  await page.waitForFunction(() => !document.querySelector(".calendar-scroll .skeleton, .tv-library-grid-panel .skeleton"));
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
      day: day?.querySelector("time")?.getAttribute("datetime") ?? null,
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
      const el = document.querySelectorAll(".calendar-day-window")[index].querySelector(".calendar-edge-scroller");
      return { start: el.dataset.fadeStart !== undefined, end: el.dataset.fadeEnd !== undefined, mask: getComputedStyle(el).webkitMaskImage !== "none" };
    }, tall);
    check("week: a day column scrolled to its end shows the top fade only", fade.start && !fade.end && fade.mask, JSON.stringify(fade));
    const track = await page.evaluate(() => {
      const el = document.querySelector("[data-fade-axis='x']");
      return { end: el.dataset.fadeEnd !== undefined, mask: getComputedStyle(el).webkitMaskImage !== "none" };
    });
    check("week: the day track fades where more days continue", track.end && track.mask, JSON.stringify(track));
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
      const el = document.querySelector("[data-fade-axis='x']");
      return { end: el.dataset.fadeEnd !== undefined, mask: getComputedStyle(el).webkitMaskImage !== "none" };
    });
    check("month: a sideways-scrolling grid shows the right fade", fade.end && fade.mask, JSON.stringify(fade));
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
      const list = document.querySelector(".tv-title-grid");
      return { start: list.dataset.fadeStart !== undefined, end: list.dataset.fadeEnd !== undefined, mask: getComputedStyle(list).webkitMaskImage !== "none" };
    });
    check("agenda: the list shows the bottom fade where it continues and the top fade once scrolled", fades.start && fades.end && fades.mask, JSON.stringify(fades));
    await context.close();
  }
  // Layout parity: the agenda list is the Library's list container (same top, left, width and bottom, within 1 px).
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const rect = (page, selector) =>
      page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, bottom: r.bottom };
      }, selector);
    const { context, page } = await open("agenda", viewport);
    await page.waitForTimeout(1500);
    const agenda = { panel: await rect(page, ".tv-library-grid-panel"), grid: await rect(page, ".tv-title-grid-content"), firstRow: await rect(page, ".calendar-day") };
    await page.goto(`${base}/movies?platform=tv-webos`);
    await page.waitForSelector(".tv-title-card", { timeout: 15000 });
    await page.waitForTimeout(1500);
    const library = { panel: await rect(page, ".tv-library-grid-panel"), grid: await rect(page, ".tv-title-grid-content"), firstRow: await rect(page, ".tv-title-card") };
    const same = (a, b) => ["top", "left", "width", "bottom"].every((k) => Math.abs(a[k] - b[k]) <= 1);
    const label = `${viewport.width}x${viewport.height}`;
    check(`agenda list container rect equals the library's at ${label} (top, left, width, bottom, +-1px)`, same(agenda.panel, library.panel), JSON.stringify({ agenda: agenda.panel, library: library.panel }));
    check(`agenda list content box equals the library's at ${label}`, same({ ...agenda.grid, bottom: 0 }, { ...library.grid, bottom: 0 }), JSON.stringify({ agenda: agenda.grid, library: library.grid }));
    check(`agenda rows start at the library's left edge and top at ${label}`, Math.abs(agenda.firstRow.left - library.firstRow.left) <= 4 && Math.abs(agenda.firstRow.top - library.firstRow.top) <= 10, JSON.stringify({ agenda: agenda.firstRow, library: library.firstRow }));
    await context.close();
  }

  // ---- Dark theme: the same single mask, visible (content dims to the page background) ----
  {
    const { context, page } = await open("agenda", { width: 1920, height: 500 }, "dark");
    await page.waitForTimeout(500);
    const dark = await page.evaluate(() => {
      const el = document.querySelector(".tv-title-grid");
      return { end: el.dataset.fadeEnd !== undefined, mask: getComputedStyle(el).webkitMaskImage };
    });
    check("dark: the bottom edge is the shared mask gradient", dark.end && /linear-gradient/.test(dark.mask), JSON.stringify(dark));
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

  // ---- Audit K14/K18/K19/K21: one default-focus marker, scroll attributes, settled announcement, no fake grid ----
  {
    const { context, page } = await open("week", { width: 1920, height: 1080 });
    const week = await page.evaluate(() => ({
      defaults: document.querySelectorAll(".calendar-page [data-tv-focus-default]").length,
      cols: [...document.querySelectorAll(".calendar-day")].map((d) => [d.hasAttribute("data-tv-scroll-container"), d.getAttribute("data-navigation-scroll-key")]),
    }));
    check("calendar: one default-focus marker on a wide screen", week.defaults === 1, JSON.stringify(week));
    check("calendar: no second Previous/Today/Next group mounted on a wide screen", (await page.locator(".calendar-nav-inline").count()) === 0);
    check("week: every day column carries the scroll attributes and a key", week.cols.length > 0 && week.cols.every(([c, k]) => c && /^calendar:day:/.test(k ?? "")), JSON.stringify(week.cols));
    await context.close();
  }
  {
    const { context, page } = await open("month", { width: 1280, height: 800 });
    const roles = await page.evaluate(() => document.querySelectorAll("[role='grid'], [role='gridcell'], [role='row'], [role='columnheader']").length);
    check("month: no grid roles on cells nothing can focus", roles === 0, String(roles));
    await context.close();
  }
  {
    const { context, page } = await open("agenda", { width: 390, height: 844 });
    const phone = await page.evaluate(() => ({
      defaults: document.querySelectorAll(".calendar-page [data-tv-focus-default]").length,
      groups: document.querySelectorAll(".calendar-nav-inline").length,
      header: document.querySelectorAll(".page-actions-navigation").length,
    }));
    check("calendar: on a phone the navigation is mounted once, with one default marker", phone.defaults === 1 && phone.groups === 1 && phone.header === 0, JSON.stringify(phone));
    await context.close();
  }

  // ---- The date range is a real button in the shell action column (not the subtitle) and opens the month/year jump ----
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const tag = `${viewport.width}`;
    const { context, page } = await open("week", viewport);
    const where = await page.evaluate(() => {
      const b = document.querySelector("[data-range-button]");
      const filters = document.querySelector("[data-filters-button]");
      return {
        tag: b?.tagName, inColumn: Boolean(b && document.querySelector("[data-shell-action-column]")?.contains(b)),
        text: b?.textContent?.trim(), above: Boolean(b && filters && b.getBoundingClientRect().bottom <= filters.getBoundingClientRect().top),
        subtitle: document.querySelector(".page-header-detail")?.textContent ?? null,
        navInHeader: document.querySelectorAll(".page-header [data-action-kind='navigation'] button").length,
        fits: b ? b.querySelector("span").scrollWidth <= b.querySelector("span").clientWidth + 1 : false,
      };
    });
    check(`range button (${tag}): a real button in the shell action column above Filters`, where.tag === "BUTTON" && where.inColumn && where.above, JSON.stringify(where));
    check(`range button (${tag}): shows the compact range, the subtitle is empty and Previous/Today/Next stay in the header`, /^5\s?[\u2013-]\s?11\s?Oct$/.test(where.text ?? "") && !where.subtitle && where.navInHeader === 3 && where.fits, JSON.stringify(where));
    await page.locator("[data-range-button]").focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector(".period-picker-panel");
    await page.waitForTimeout(300);
    const panel = await page.evaluate(() => {
      const p = document.querySelector(".period-picker-panel").getBoundingClientRect();
      const b = document.querySelector("[data-range-button]").getBoundingClientRect();
      return { expanded: document.querySelector("[data-range-button]").getAttribute("aria-expanded"), inside: Boolean(document.activeElement?.closest(".period-picker-panel")), left: p.right <= b.left + 1, onScreen: p.left >= 0 && p.bottom <= innerHeight + 1 };
    });
    check(`range button (${tag}): Enter opens the month/year jump beside the button, focus inside`, panel.expanded === "true" && panel.inside && panel.left && panel.onScreen, JSON.stringify(panel));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({ date: new URL(location.href).searchParams.get("date"), open: Boolean(document.querySelector(".period-picker-panel")), focus: document.activeElement?.matches("[data-range-button]") }));
    check(`range button (${tag}): choosing a month changes the period, closes the jump and returns focus`, after.date && after.date !== "2026-10-07" && !after.open && after.focus, JSON.stringify(after));
    await context.close();
  }

  // ---- Audit K19: the range label announces once the period stops changing ----
  {
    const { context, page } = await open("week", { width: 1920, height: 1080 });
    const live = page.locator(".period-picker [aria-live='polite']");
    check("range label: the live region is outside the range button", (await page.locator("[data-range-button] [aria-live]").count()) === 0 && (await live.count()) === 1);
    const seen = [];
    await page.exposeFunction("__rangeSeen", (text) => seen.push(text));
    await page.evaluate(() => {
      new MutationObserver(() => window.__rangeSeen(document.querySelector(".period-picker [aria-live='polite']").textContent)).observe(
        document.querySelector(".period-picker [aria-live='polite']"),
        { childList: true, characterData: true, subtree: true },
      );
    });
    await page.evaluate(() => document.querySelector("[data-tv-focus-default]").nextElementSibling?.focus());
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1200);
    check("range label: six quick period steps announce once, with the final label", seen.length === 1, JSON.stringify(seen));
    await context.close();
  }
} finally {
  await browser.close();
  server.close?.();
}
process.exit(failed ? 1 : 0);
