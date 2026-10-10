#!/usr/bin/env node
// "The library still jumps in view" (owner report, 10 October 2026, after #429 measured 0 flashes and CLS 0.002).
// CLS and the content-flash count ignore transforms, opacity and skeleton-to-content swaps, so they missed what the owner sees:
// the right-hand list sliding in 60 px from the right and fading in again when the route token expired. This guard records
// EVERY frame of the library region (panel rect, panel opacity, running animations, card rects, art state) while the library
// opens (cold load, first nav visit, revisit) and while Back returns to it, and fails on unexplained movement:
//   - the list panel never moves sideways once content has painted, and never runs an animation other than the route
//     transition's own `route-enter-*` (one start per navigation),
//   - once the panel is visible its opacity never drops again (no blank flash, no fade replay),
//   - cards that have painted keep their position (the focused card's own lift is excluded): after the route transition has settled no card moves by more than
//     0.5 px without a key press or a scroll, and no mounted card vanishes,
//   - art that has loaded never goes back to a placeholder or re-fades.
// Runs at 1920x1080 and 1280x720, both themes, keyboard only.
//   node scripts/nav-library-frames-e2e.mjs [--no-build] [--dist dir] [--only text]
import { join } from "node:path";
import { boot, opt, root } from "./e2e-common.mjs";
import { startServer } from "./nav-perf/server.mjs";
const only = opt("only", "");
const { check, open, finish } = await boot({ movies: 520, series: 40, artists: 0, seasons: 2, onDeck: 3, detailDelayMs: 350, listDelayMs: 250 }, { realisticAuth: true });
// A server whose lists answer after 2.5 s, so the loading skeleton is on screen when recording starts.
const slowServer = await startServer({ distDir: opt("dist", join(root, "dist")), movies: 520, series: 40, artists: 0, onDeck: 3, listDelayMs: 2500 });

const RECORD = () => {
  const w = window;
  w.__f = { t0: performance.now(), frames: [], marks: [] };
  const tick = () => {
    const panel = document.querySelector(".tv-library-grid-panel");
    const grid = document.querySelector(".tv-title-grid");
    const pr = panel?.getBoundingClientRect();
    const cards = {};
    for (const c of document.querySelectorAll(".tv-title-card[data-library-index]")) {
      const i = c.getAttribute("data-library-index");
      if (Number(i) > 14) continue;
      const r = c.getBoundingClientRect();
      const img = c.querySelector("img");
      if (c === document.activeElement || c.contains(document.activeElement) || c.classList.contains("is-selected")) continue; // the focused card has its own lift
      cards[i] = [r.x, r.y, r.width, img ? (img.complete && img.naturalWidth > 0 ? 1 : 0) : -1, img ? Number(getComputedStyle(img).opacity) : -1, c.getAnimations({ subtree: true }).some((a) => a instanceof CSSTransition) ? 1 : 0];
    }
    const sk = document.querySelector(".tv-library-grid-panel .skeleton-card")?.getBoundingClientRect();
    const c0 = document.querySelector(".tv-title-card[data-library-index='0']")?.getBoundingClientRect();
    w.__f.frames.push({ sk0: sk ? [sk.x, sk.y, sk.width] : null, c0: c0 ? [c0.x, c0.y, c0.width] : null,
      t: Math.round(performance.now() - w.__f.t0), path: location.pathname,
      panelX: pr ? pr.x : null, panelW: pr ? pr.width : null,
      panelOpacity: panel ? Number(getComputedStyle(panel).opacity) : null,
      anims: panel ? panel.getAnimations().map((a) => a.animationName ?? a.transitionProperty).filter(Boolean) : [],
      scroll: grid ? grid.scrollTop : null, count: document.querySelectorAll(".tv-title-grid .tv-title-card").length,
      route: document.getAnimations().some((a) => /^route-enter-/.test(a.animationName ?? "")),
      pageAnims: document.getAnimations().map((a) => (a.animationName ?? a.transitionProperty) + "@" + Math.round(a.currentTime) + ":" + (a.effect?.target?.className?.toString?.() ?? "").split(" ")[0]).filter((n) => !/tv-loader-spin|skeleton|shimmer/.test(n)).slice(0, 4),
      skeleton: Boolean(document.querySelector(".app-main .skeleton-state")), cards,
    });
    w.__f.raf = requestAnimationFrame(tick);
  };
  tick();
};
const mark = (page, l) => page.evaluate((l) => window.__f.marks.push({ l, t: Math.round(performance.now() - window.__f.t0) }), l);
const stop = (page) => page.evaluate(() => { cancelAnimationFrame(window.__f.raf); return window.__f; });
const SETTLE_MS = 400; // the 220 ms route transition plus its 80 ms token grace

/** Judges the frames from `from` on (a navigation mark). Returns a list of human readable problems. */
function judge(rec, from, path = null) {
  const problems = [];
  const frames = rec.frames.filter((f) => f.t >= from && (!path || f.path === path));
  const first = frames.findIndex((f) => f.panelX !== null && f.count > 0);
  if (first < 0) return ["library never painted cards"];
  const fr = frames.slice(first);
  const x0 = fr.at(-1).panelX;
  const sideways = fr.filter((f) => Math.abs(f.panelX - x0) > 0.5);
  if (sideways.length) problems.push(`list panel off its final x in ${sideways.length} frames after content (x ${sideways[0].panelX.toFixed(1)} vs ${x0.toFixed(1)}, frame ${first + frames.indexOf(sideways[0]) - first})`);
  const names = new Set(fr.flatMap((f) => f.anims));
  const own = [...names].filter((n) => !/^route-enter-/.test(n));
  if (own.length) problems.push(`list panel ran animation(s) other than the route transition: ${own.join(",")}`);
  const routeStarts = fr.filter((f, i) => f.anims.some((n) => /^route-enter-/.test(n)) && (i === 0 || !fr[i - 1].anims.includes(f.anims.find((n) => /^route-enter-/.test(n))))).length;
  if (routeStarts > 1) problems.push(`route transition started ${routeStarts} times`);
  let peak = 0;
  for (const f of fr) {
    if (f.panelOpacity > peak) peak = f.panelOpacity;
    else if (peak >= 0.99 && f.panelOpacity < 0.99) { problems.push(`list panel faded out again after it was visible (opacity ${f.panelOpacity})`); break; }
  }
  const t0 = fr[0].t;
  for (let i = 1; i < fr.length; i += 1) {
    const a = fr[i - 1], b = fr[i];
    // Frames can be seconds apart on a loaded machine, so the route transition is judged by whether it is running, not by the clock.
    if (b.t - t0 < SETTLE_MS || a.route || b.route) continue;
    if (Math.abs((b.scroll ?? 0) - (a.scroll ?? 0)) > 0) continue;
    for (const [k, c] of Object.entries(b.cards)) {
      const p = a.cards[k];
      if (!p) continue;
      const lifting = c[5] === 1 || p[5] === 1; // a focus or hover lift (a CSS transition) is the card's own motion, not a jump
      if (!lifting && (Math.abs(c[0] - p[0]) > 0.5 || Math.abs(c[1] - p[1]) > 0.5 || Math.abs(c[2] - p[2]) > 0.5)) { problems.push(`card ${k} moved ${(c[0] - p[0]).toFixed(1)},${(c[1] - p[1]).toFixed(1)} at ${b.t}ms with no key press (panel animations: ${b.anims.join(",") || "none"}; page animations: ${b.pageAnims.join(",") || "none"}; ${b.skeleton ? "skeleton" : "content"} frame ${i} of ${fr.length}, content since ${t0}ms)`); break; }
      if (p[3] === 1 && c[3] === 0) { problems.push(`card ${k} art went back to a placeholder at ${b.t}ms`); break; }
      if (p[3] === 1 && c[3] === 1 && p[4] >= 0.99 && c[4] < 0.99) { problems.push(`card ${k} art re-faded at ${b.t}ms`); break; }
    }
    if (problems.length > 6) break;
  }
  // The skeleton's first card sits where the loaded first card lands (the focused card's lift is a few px).
  const sk = frames.filter((f) => f.sk0).at(-1), loaded = fr.at(-1).c0;
  if (sk && loaded) {
    const d = [sk.sk0[0] - loaded[0], sk.sk0[1] - loaded[1], sk.sk0[2] - loaded[2]];
    if (Math.abs(d[0]) > 8 || Math.abs(d[1]) > 8 || Math.abs(d[2]) > 8) problems.push(`skeleton card is ${d.map((v) => v.toFixed(0)).join(",")} px (x,y,width) off where the loaded card lands`);
  }
  let maxCount = 0;
  for (const f of fr) {
    if (f.count > maxCount) maxCount = f.count;
    else if (f.count < maxCount && !f.skeleton) { problems.push(`cards vanished: ${maxCount} then ${f.count} at ${f.t}ms`); break; }
  }
  return problems;
}

const kv = (page) => page.evaluate(() => document.querySelectorAll(".tv-title-grid .tv-title-card").length);
for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  for (const theme of ["dark", "light"]) {
    const size = `${w}x${h} ${theme}`;
    const light = (page) => theme === "light" ? page.evaluate(() => document.documentElement.setAttribute("data-theme", "light")) : null;

    if (!only || "cold-open".includes(only)) {
      const { context, page } = await open("/movies", { width: w, height: h, theme, server: slowServer });
      await light(page);
      await page.evaluate(RECORD);
      await page.waitForSelector(".tv-title-card", { timeout: 15000 });
      await page.waitForTimeout(2200);
      const rec = await stop(page);
      const p = judge(rec, 0);
      check(`library cold open ${size}: no unexplained movement, fade replay or slide`, p.length === 0, p.join("; "));
      await context.close();
    }

    if (!only || "nav-open".includes(only)) {
      const { context, page } = await open("/", { width: w, height: h, theme });
      await light(page);
      await page.waitForSelector(".tv-home-card", { timeout: 10000 });
      await page.waitForTimeout(500);
      for (const [name, href] of [["first visit", "/movies"], ["series", "/series"], ["revisit", "/movies"]]) {
        await page.evaluate(RECORD);
        await page.evaluate((hr) => document.querySelector(`.app-nav a[href='${hr}']`)?.focus(), href);
        await mark(page, "nav");
        await page.keyboard.press("Enter");
        // The occasional Enter that lands while the previous page still settles is pressed once more (not under test here).
        if (!(await page.waitForSelector(`[data-page-id] .tv-title-card`, { timeout: 4000 }).then(() => true, () => false)) && !(await page.evaluate((hr) => location.pathname === hr, href))) {
          await page.evaluate((hr) => document.querySelector(`.app-nav a[href='${hr}']`)?.focus(), href);
          await page.keyboard.press("Enter");
        }
        await page.waitForSelector(".tv-title-card", { timeout: 10000 });
        await page.waitForTimeout(2000);
        const rec = await stop(page);
        if (href === "/series") continue;
        const p = judge(rec, rec.marks[0].t, href);
        check(`library open from nav (${name}) ${size}: no unexplained movement, fade replay or slide`, p.length === 0, p.join("; "));
      }
      await context.close();
    }

    if (!only || "back".includes(only)) {
      for (const [name, downs] of [["shallow", 2], ["deep", 24]]) {
        const { context, page } = await open("/movies", { width: w, height: h, theme });
        await light(page);
        await page.waitForSelector(".tv-title-card", { timeout: 10000 });
        await page.waitForTimeout(800);
        await page.locator(".tv-title-card").first().focus();
        for (let i = 0; i < downs; i += 1) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(110); }
        await page.waitForTimeout(900);
        await page.keyboard.press("Enter");
        await page.waitForSelector(".tv-detail-title", { timeout: 8000 });
        await page.waitForTimeout(900);
        await page.evaluate(RECORD);
        await mark(page, "back");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".tv-title-grid", { timeout: 8000 });
        await page.waitForTimeout(2200);
        const rec = await stop(page);
        const p = judge(rec, rec.marks[0].t);
        check(`library Back from a ${name} title ${size}: no unexplained movement, fade replay or slide`, p.length === 0, p.join("; "));
        check(`library Back from a ${name} title ${size}: no skeleton frame`, rec.frames.every((f) => !f.skeleton), "skeleton frame on Back");
        await context.close();
      }
    }
  }
}
await finish();
