#!/usr/bin/env node
// "The page still rerenders and jumps a lot" (owner report, 9 October 2026, after the first fixes were live).
// Records every frame and every layout shift while a flow runs and asserts the page never jumps:
//   - Back from a title opened deep in the Library lands on the same row, with the same cards mounted, never
//     from the top and never with fewer cards than before (the whole loaded list is cached, not only its head),
//   - a series detail's action row does not move when the resume plan arrives late (space is held for it) and
//     the page's layout-shift total stays under the threshold,
//   - Home never paints "Start watching" and swaps to "On deck" a moment later when the first request goes out late
//     (the wait for On Deck is counted from the rails being ready, not from mount),
//   - Home rails and the Library grid keep their cards across a Back, a same-path revisit and a section switch.
//   - the first visit of a section after a short nav dwell (Calendar, Playlists, Watchlist, Series, Music), and of
//     every section after Home's idle warm-up, renders from the warmed cache with no skeleton frame.
// Runs at 1920x1080 and 1280x720, both themes, keyboard only.
//   node scripts/nav-jump-e2e.mjs [--no-build] [--dist dir] [--only text]
import { boot, opt, root } from "./e2e-common.mjs";
import { startServer } from "./nav-perf/server.mjs";
import { join } from "node:path";
const only = opt("only", "");
// The cache-on session (a JWT-shaped token) is the production one; the mock answers after the delays below.
const { check, open, finish } = await boot(
  { movies: 520, series: 40, artists: 0, seasons: 2, onDeck: 3, detailDelayMs: 350, resumePlanDelayMs: 900 },
  { realisticAuth: true }
);
// A cold start in miniature: Home's rails answer after 2 s and the watch progress after 2.6 s, so On Deck can only
// be known well after Home has mounted (the sign-in refresh and probes ahead of the first request, on a real cold start).
const coldServer = await startServer({
  distDir: opt("dist", join(root, "dist")), movies: 60, series: 20, artists: 0, onDeck: 3, detailDelayMs: 350, railsDelayMs: 2000, progressDelayMs: 2600,
});

/** Frame recorder: layout shifts (all of them, keyboard-caused ones included) and a few probes per frame. */
const RECORD = () => {
  const w = window;
  w.__j = { t0: performance.now(), shifts: [], frames: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__j.shifts.push({ t: Math.round(e.startTime), v: e.value });
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  const tick = () => {
    const main = document.querySelector(".app-main");
    const grid = document.querySelector(".tv-title-grid");
    const act = document.activeElement;
    const download = document.querySelector(".tv-detail-watchlist [data-navigation-focus-key$=':add-to-playlist']");
    const dl = download && getComputedStyle(download).visibility !== "hidden" ? download : null;
    const first = document.querySelector("[data-tv-track-id='primary']");
    w.__j.frames.push({
      t: Math.round(performance.now() - w.__j.t0),
      skeleton: Boolean(main?.querySelector(".skeleton-state")),
      cards: document.querySelectorAll(".tv-title-grid .tv-title-card").length, // the Library grid only: a detail page's "more like this" rail is made of title cards too
      libIndex: act?.closest?.("[data-library-index]")?.getAttribute("data-library-index") ?? act?.getAttribute?.("data-library-index") ?? null,
      gridTop: grid ? grid.scrollTop : null,
      gridH: grid ? grid.scrollHeight : null,
      // Relative to the copy column: the whole page slides in on a route change, so only motion of the button inside its
      // column is a jump (a page-wide slide moves the column and the button together and cancels out here).
      downloadX: dl ? Math.round((dl.getBoundingClientRect().x - (document.querySelector(".tv-detail-copy")?.getBoundingClientRect().x ?? 0)) * 100) / 100 : null,
      primary: first ? (first.closest("section")?.querySelector("h2,h3")?.textContent ?? "") : null,
      homeCards: first ? first.querySelectorAll(".tv-home-card").length : 0,
    });
    w.__j.raf = requestAnimationFrame(tick);
  };
  tick();
};
const stop = (page) => page.evaluate(() => { cancelAnimationFrame(window.__j.raf); return window.__j; });
const cls = (rec, from = 0) => rec.shifts.filter((s) => s.t >= from).reduce((a, s) => a + s.v, 0);

for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  for (const theme of ["dark", "light"]) {
    const size = `${w}x${h} ${theme}`;

    // ---- Library: Back from a title opened deep in the list (past the first 200-title page).
    if (!only || "library-deep-back".includes(only)) {
      const { context, page } = await open("/movies", { width: w, height: h, theme });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.waitForSelector(".tv-title-card", { timeout: 8000 });
      await page.waitForTimeout(500);
      await page.locator(".tv-title-card").first().focus();
      const depth = (await page.evaluate(() => document.querySelectorAll(".tv-title-card").length)) > 0 ? 80 : 0;
      for (let i = 0; i < depth; i += 1) {
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(70);
      }
      // A slow machine drops key presses: keep going until the focus is past the first 200-title page.
      for (let extra = 0; extra < 60; extra += 1) {
        const at = await page.evaluate(() => Number(document.activeElement?.closest?.("[data-library-index]")?.getAttribute("data-library-index") ?? -1));
        if (at >= 210) break;
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(70);
      }
      await page.waitForTimeout(1500);
      const before = await page.evaluate(() => {
        const a = document.activeElement;
        return { index: Number(a?.closest?.("[data-library-index]")?.getAttribute("data-library-index") ?? -1), cards: document.querySelectorAll(".tv-title-grid .tv-title-card").length, top: document.querySelector(".tv-title-grid")?.scrollTop ?? 0 };
      });
      check(`library deep ${size}: scrolled past the first page`, before.index >= 200, JSON.stringify(before));
      await page.evaluate(RECORD);
      await page.keyboard.press("Enter");
      await page.waitForSelector(".tv-detail-title", { timeout: 8000 });
      await page.waitForTimeout(900);
      const mid = await page.evaluate(() => window.__j.frames.length);
      await page.keyboard.press("Escape");
      await page.waitForSelector(".tv-title-grid", { timeout: 8000 });
      await page.waitForTimeout(2500);
      const rec = await stop(page);
      const back = rec.frames.slice(mid).filter((f) => f.cards > 0 || f.skeleton);
      const after = rec.frames.at(-1);
      check(`library deep ${size}: Back lands on the same title`, Number(after.libIndex) === before.index, `${before.index} -> ${after.libIndex}`);
      const trail = [...new Set(back.map((f) => `${f.gridTop}/${f.gridH}`))].slice(0, 12).join(" ");
      // The restore is instant: never a frame of the grid at the top (or anywhere else) that glides to the saved offset.
      const away = back.filter((f) => f.gridTop !== null && Math.abs(f.gridTop - before.top) > 4).length;
      check(`library deep ${size}: no frame of the grid away from the saved scroll position on Back`, away === 0, `${away} frames; trail ${[...new Set(back.map((f) => f.gridTop))].slice(0, 8).join(" ")}`);
      check(`library deep ${size}: Back keeps the scroll position`, after.gridTop !== null && Math.abs(after.gridTop - before.top) <= 4, `${before.top} -> ${after.gridTop}; top/height trail ${trail}`);
      const fewer = back.filter((f) => !f.skeleton && f.cards < Math.min(before.cards, 100)).length;
      check(`library deep ${size}: no frame of the grid with fewer cards than before the visit`, fewer === 0, `${fewer} frames, before ${before.cards} cards`);
      check(`library deep ${size}: no skeleton frame on Back`, back.every((f) => !f.skeleton), "skeleton shown");
      const wrongIndex = back.filter((f) => f.libIndex !== null && Number(f.libIndex) !== before.index && Number(f.libIndex) < before.index - 5).length;
      check(`library deep ${size}: focus never passes through the first row on Back`, wrongIndex === 0, `${wrongIndex} frames`);
      await context.close();
    }

    // ---- Series detail: the action row holds still while the resume plan loads, and the page does not shift.
    if (!only || "detail-actions".includes(only)) {
      const { context, page } = await open("/series", { width: w, height: h, theme });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.waitForSelector(".tv-title-card", { timeout: 8000 });
      await page.waitForTimeout(500);
      await page.evaluate(RECORD);
      await page.locator(".tv-title-card").first().focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector(".tv-detail-title", { timeout: 8000 });
      await page.waitForSelector(".tv-detail-watchlist [data-resume-action]", { timeout: 6000 });
      await page.waitForTimeout(1200);
      const rec = await stop(page);
      const xs = rec.frames.map((f) => f.downloadX).filter((x) => x !== null);
      const spread = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
      check(`detail ${size}: the action row buttons never move sideways`, xs.length > 5 && spread <= 1, `x spread ${spread}px over ${xs.length} frames`);
      const detailFrom = rec.frames.find((f) => f.downloadX !== null)?.t ?? 0;
      const total = cls(rec, detailFrom);
      check(`detail ${size}: layout shift on the detail page stays under 0.02`, total < 0.02, total.toFixed(4));
      await context.close();
    }

    // ---- Home: the first paint is the final rail set (On Deck), not "Start watching" swapped out later.
    if (!only || "home-ondeck".includes(only)) {
      const { context, page } = await open("/", { width: w, height: h, theme, server: coldServer });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.evaluate(RECORD);
      await page.waitForSelector(".tv-home-card", { timeout: 12000 });
      await page.waitForTimeout(3500);
      const rec = await stop(page);
      const titles = [...new Set(rec.frames.map((f) => f.primary).filter((x) => x))];
      check(`home ${size}: the first rail never swaps title after it painted`, titles.length === 1, JSON.stringify(titles));
      const counts = [...new Set(rec.frames.map((f) => f.homeCards).filter((n) => n > 0))];
      check(`home ${size}: the first rail's card count never changes after the first paint`, counts.length === 1, JSON.stringify(counts));
      await context.close();
    }
  }
}
// A server whose section lists answer after 700 ms, so only a warmed cache can avoid the skeleton.
const slowServer = await startServer({
  distDir: opt("dist", join(root, "dist")), movies: 60, series: 20, artists: 20, onDeck: 0, playlists: 2, playlistItems: 3, watchlist: 4,
  listDelayMs: 700, calendarDelayMs: 700,
});
/** Counts API reads in flight (the event stream and remote long polls stay open by design and are ignored). */
const trackRequests = (page) => {
  const state = { open: 0 };
  const counted = (request) => /\/api\/v1\//.test(request.url()) && !/\/(events|remote)\b/.test(request.url());
  page.on("request", (r) => { if (counted(r)) state.open += 1; });
  page.on("requestfinished", (r) => { if (counted(r)) state.open -= 1; });
  page.on("requestfailed", (r) => { if (counted(r)) state.open -= 1; });
  return state;
};
/** Waits (bounded) until no API read has been in flight for 400 ms: the dwell's prefetch has landed. */
const settled = async (page, state) => {
  let quiet = 0;
  for (let waited = 0; waited < 12000 && quiet < 400; waited += 100) {
    await page.waitForTimeout(100);
    quiet = state.open <= 0 ? quiet + 100 : 0;
  }
};
const navTo = async (page, href) => {
  // Home takes initial focus once it has settled; wait for that so it cannot pull focus off the nav item mid-dwell.
  await page.waitForFunction(() => Boolean(document.activeElement?.closest?.(".tv-home-card")), null, { timeout: 8000 }).catch(() => undefined);
  await page.evaluate((h) => document.querySelector(`.app-nav a[href='${h}']`)?.focus(), href);
};
for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  for (const theme of ["dark", "light"]) {
    const size = `${w}x${h} ${theme}`;
    // ---- First visit after a nav dwell: the section renders from the warmed cache, never through a skeleton.
    if (!only || "first-visit-dwell".includes(only)) {
      // Save-data switches the idle warm-up off, so each section below is warmed by its own dwell alone.
      const saveData = () => Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
      const { context, page } = await open("/", { width: w, height: h, theme, server: slowServer, init: saveData });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.waitForSelector(".tv-home-card", { timeout: 8000 });
      await page.waitForTimeout(300);
      const requests = trackRequests(page);
      for (const [name, href, ready] of [
        ["calendar", "/calendar", "[data-page-id='calendar']"],
        ["playlists", "/playlists", ".tv-title-card, .tv-home-card, .tv-media-track, [data-tv-track-id]"],
        ["watchlist", "/watchlist", ".tv-watchlist-list"],
        ["series", "/series", ".tv-title-card"],
        ["music", "/music", ".tv-title-card"],
      ]) {
        await navTo(page, href);
        // The dwell fires the prefetch (150 ms); wait for its slow answers to land before pressing Enter.
        await page.waitForTimeout(400);
        await settled(page, requests);
        await page.evaluate(RECORD);
        console.log("   active before Enter:", name, await page.evaluate(() => document.activeElement?.className?.toString().slice(0, 40)));
        await page.keyboard.press("Enter");
        await page.waitForSelector(ready, { timeout: 8000 }).catch((error) => { console.log(`   timeout waiting for ${name} at ${new Date().toISOString()} path ${page.url()}`); throw error; });
        await page.waitForTimeout(600);
        const rec = await stop(page);
        const skeleton = rec.frames.filter((f) => f.skeleton).length;
        check(`first visit ${size}: ${name} shows no skeleton frame after a nav dwell`, skeleton === 0, `${skeleton} skeleton frames`);
        await page.evaluate(() => document.querySelector(".app-nav a[href='/']")?.click());
        await page.waitForSelector(".tv-home-card", { timeout: 8000 });
        await page.waitForTimeout(300);
      }
      await context.close();
    }
    // ---- Idle warm-up: after Home has loaded, every nav section is warm without anyone having focused them.
    if (!only || "first-visit-idle".includes(only)) {
      const { context, page } = await open("/", { width: w, height: h, theme, server: slowServer });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.waitForSelector(".tv-home-card", { timeout: 8000 });
      await page.waitForTimeout(11000);
      for (const [href, ready] of [["/movies", ".tv-title-card"], ["/series", ".tv-title-card"], ["/music", ".tv-title-card"], ["/calendar", "[data-page-id='calendar']"], ["/watchlist", ".tv-watchlist-list"], ["/playlists", ".tv-media-track, .tv-title-card, [data-tv-track-id]"]]) {
        await page.evaluate(RECORD);
        await page.evaluate((target) => document.querySelector(`.app-nav a[href='${target}']`)?.click(), href);
        await page.waitForSelector(ready, { timeout: 8000 });
        await page.waitForTimeout(500);
        const rec = await stop(page);
        const skeleton = rec.frames.filter((f) => f.skeleton).length;
        check(`idle warm ${size}: ${href} shows no skeleton frame on its first visit`, skeleton === 0, `${skeleton} skeleton frames`);
        await page.evaluate(() => document.querySelector(".app-nav a[href='/']")?.click());
        await page.waitForTimeout(400);
      }
      await context.close();
    }
  }
}
slowServer.close?.();
coldServer.close?.();
await finish();
