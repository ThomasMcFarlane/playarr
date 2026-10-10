#!/usr/bin/env node
// Calendar agenda, against the deterministic mock API (nav-perf/server.mjs):
//   1. Only the focused entry shows the pink ring and glow. Move focus to the details panel, the nav rail and the
//      action column: no agenda entry has a box-shadow or an outline, although one stays selected.
//   2. Day headings are sticky: after scrolling, the topmost heading is pinned to the scroller's top (+-1px), the
//      focused entry never sits under it, and the next heading pushes the pinned one up.
// At 1920 and 1280, in both themes. Set AGENDA_SHOTS=<dir> to also write screenshots.
//
//   node scripts/calendar-agenda-e2e.mjs [--no-build] [--dist dir]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
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
const SHOTS = process.env.AGENDA_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
  failed ||= !ok;
};

async function open(viewport, theme) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(({ base, userId, theme }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
    localStorage.setItem("playarr-theme", theme);
  }, { base, userId: USER_ID, theme });
  const page = await context.newPage();
  await page.goto(`${base}/calendar?view=agenda&date=2026-10-07&platform=tv-webos`);
  await page.waitForSelector(".calendar-entry", { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector(".calendar-scroll .skeleton, .tv-library-grid-panel .skeleton"));
  await page.waitForTimeout(500);
  return { context, page };
}

// What every agenda entry (and month/week chip) currently draws: a box-shadow or an outline means a ring or glow.
const decorated = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".calendar-entry:not(.calendar-entry-skeleton), .calendar-chip")]
      .map((el) => {
        const cs = getComputedStyle(el);
        return {
          title: el.textContent.trim().slice(0, 30),
          shadow: cs.boxShadow,
          outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
          focused: el === document.activeElement,
        };
      })
      .filter((e) => e.shadow !== "none" || e.outline)
  );

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
  for (const theme of ["light", "dark"]) {
    const label = `${viewport.width} ${theme}`;
    const { context, page } = await open(viewport, theme);
    const shot = (name) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${name}-${viewport.width}-${theme}.png`) }) : null);

    // 1. Ring only on focus.
    await page.keyboard.press("Tab").catch(() => {});
    await page.evaluate(() => document.querySelector(".calendar-entry").focus());
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(500);
    const focusedNow = await decorated(page);
    check(`${label}: the focused entry shows the glow and no other entry does`, focusedNow.length === 1 && focusedNow[0].focused && /rgb/.test(focusedNow[0].shadow), JSON.stringify(focusedNow));
    await shot("agenda-focused");
    const selectedBefore = await page.evaluate(() => document.querySelector(".calendar-entry.is-selected .calendar-entry-title")?.textContent ?? null);
    const targets = [
      ["details panel", ".calendar-details a, .calendar-details button, .tv-details-panel a, .tv-details-panel button"],
      ["nav rail", ".app-nav-link"],
      ["action column", ".tv-shell-action-column button, .tv-filter-launcher, .shell-action-column button, [data-shell-action] button"],
    ];
    for (const [name, selector] of targets) {
      const moved = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.focus();
        return document.activeElement === el;
      }, selector);
      if (!moved) {
        check(`${label}: focus moved to ${name}`, false, `no focusable ${selector}`);
        continue;
      }
      await page.waitForTimeout(500);
      const leftover = await decorated(page);
      const stillSelected = await page.evaluate(() => document.querySelector(".calendar-entry.is-selected .calendar-entry-title")?.textContent ?? null);
      check(`${label}: focus on the ${name} leaves no ring or glow on any agenda entry (selected stays "${selectedBefore}")`, leftover.length === 0 && stillSelected === selectedBefore, JSON.stringify({ leftover, stillSelected }));
      if (name === "details panel") await shot("agenda-unfocused");
    }

    // 2. Sticky day headings.
    await page.evaluate(() => document.querySelector(".calendar-entry").focus());
    const heads = await page.evaluate(() => document.querySelectorAll(".calendar-agenda-content .calendar-day > h3").length);
    check(`${label}: the agenda has several day headings`, heads >= 2, String(heads));
    const geometry = () =>
      page.evaluate(() => {
        const grid = document.querySelector(".tv-title-grid");
        const g = grid.getBoundingClientRect();
        const stickTop = g.top + parseFloat(getComputedStyle(document.querySelector(".calendar-agenda-content .calendar-day > h3")).top);
        const pinned = [...document.querySelectorAll(".calendar-agenda-content .calendar-day > h3")]
          .map((h) => ({ r: h.getBoundingClientRect(), text: h.textContent }))
          .filter((h) => h.r.top <= stickTop + 1.5 && h.r.bottom > stickTop);
        const head = pinned[pinned.length - 1];
        const next = [...document.querySelectorAll(".calendar-agenda-content .calendar-day > h3")].map((h) => h.getBoundingClientRect().top).find((t) => t > stickTop + 1.5);
        const f = document.activeElement?.closest(".calendar-entry")?.getBoundingClientRect();
        return {
          gridTop: stickTop,
          scrollTop: grid.scrollTop,
          head: head ? { top: head.r.top, bottom: head.r.bottom, text: head.text } : null,
          entryTop: f?.top ?? null,
          nextGap: next === undefined ? null : next - stickTop,
          bg: head ? getComputedStyle([...document.querySelectorAll(".calendar-agenda-content .calendar-day > h3")].find((h) => h.textContent === head.text)).backgroundColor : null,
        };
      });
    let pinnedOk = true;
    let clearOk = true;
    let seen = new Set();
    let detail = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(250);
      const g = await geometry();
      if (g.scrollTop > 40) {
        // A heading sits on the line (+-1px), is being pushed up by the next one, or the next one is about to take over (the gap between days).
        pinnedOk &&= g.head !== null ? g.head.top <= g.gridTop + 1 && (g.head.top >= g.gridTop - 1 || g.nextGap !== null) && g.bg !== "rgba(0, 0, 0, 0)" : g.nextGap !== null && g.nextGap < 120;
        clearOk &&= g.entryTop === null || g.head === null || g.entryTop >= g.head.bottom - 0.5;
        if (g.head) seen.add(g.head.text);
        if (!pinnedOk || !clearOk) detail.push(g);
      }
    }
    await page.waitForTimeout(600);
    await shot("agenda-sticky");
    check(`${label}: after scrolling the top day heading is pinned at its sticky line under the header area (+-1px) with a background`, pinnedOk, JSON.stringify(detail.slice(0, 2)));
    check(`${label}: the focused entry never sits under the pinned heading`, clearOk, JSON.stringify(detail.slice(0, 2)));
    check(`${label}: the pinned heading changes as later days scroll up (next heading pushes the previous one)`, seen.size >= 2, JSON.stringify([...seen]));
    await context.close();
  }
}
await browser.close();
await server.close?.();
process.exit(failed ? 1 : 0);
