#!/usr/bin/env node
// "Watchlist: the first visit shows about two seconds of blank" (owner report, 10 October 2026). Reproduced with a
// server that answers every read after 1 s and a first visit with nothing cached (a cold load of /watchlist): the page
// body shows its skeleton at once, but the left nav stayed EMPTY until the library-kinds read answered, then every tile
// popped in together with the list. The nav had no placeholder state, so the first second of a first visit was a bare
// header next to an empty rail.
//
//   1. within 400 ms the nav already shows its full tile set (real tiles plus skeleton tiles for the entries that wait
//      on the answer), so the rail is never blank,
//   2. the skeleton tiles are not focusable, not links and hidden from assistive technology (checked on every frame),
//   3. the tiles that never wait (Search, Home, Playlists, Watchlist, Requests, Calendar) are real links straight away
//      and stay where they are when the answer arrives (no layout jump),
//   4. once the answer arrives no skeleton tile is left and the gated tiles are real links.
// Runs at 1920x1080 dark and 1280x720 light, keyboard only (the check never moves the pointer).
//   node scripts/nav-cold-start-e2e.mjs [--no-build] [--dist dir]
import { join } from "node:path";
import { boot, opt, root } from "./e2e-common.mjs";
import { startServer } from "./nav-perf/server.mjs";

const { check, open, finish } = await boot({ movies: 10, series: 2, artists: 0 });
const slow = await startServer({
  distDir: opt("dist", join(root, "dist")), movies: 320, series: 40, artists: 20, onDeck: 0,
  playlists: 2, playlistItems: 4, watchlist: 4, latencyMs: 1000,
});
const NEVER_WAIT = ["/search", "/", "/playlists", "/watchlist", "/requests", "/calendar"];

const RECORD = () => {
  const w = window;
  w.__nav = { frames: [], t0: performance.now() };
  const tick = () => {
    const nav = document.querySelector(".app-nav");
    const tiles = [...(nav?.querySelectorAll(".app-nav-link") ?? [])];
    w.__nav.frames.push({
      t: Math.round(performance.now() - w.__nav.t0),
      tiles: tiles.length,
      links: tiles.filter((e) => e.tagName === "A").length,
      placeholders: tiles.filter((e) => e.classList.contains("app-nav-link-placeholder")).length,
      inert: tiles
        .filter((e) => e.classList.contains("app-nav-link-placeholder"))
        .every((e) => e.getAttribute("aria-hidden") === "true" && e.tagName !== "A" && !e.hasAttribute("href") && !e.matches("a,button,input,[tabindex]:not([tabindex='-1'])")),
      rects: Object.fromEntries(tiles.filter((e) => e.tagName === "A").map((e) => [e.getAttribute("href"), e.getBoundingClientRect().toJSON()])),
    });
    w.__nav.raf = requestAnimationFrame(tick);
  };
  tick();
};

for (const [width, height, theme] of [[1920, 1080, "dark"], [1280, 720, "light"]]) {
  const label = `${width}x${height} ${theme}`;
  // A cold load of /watchlist: a fresh context, so no library kinds are cached and nothing is warm.
  const { context, page } = await open("/watchlist", { server: slow, width, height, theme, init: RECORD });
  await page.waitForTimeout(4500);
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__nav.raf); return window.__nav.frames; });
  const early = frames.filter((f) => f.t >= 400 && f.t <= 900);
  const final = frames[frames.length - 1];
  check(`${label}: ${early.length} frames between 400 and 900 ms were recorded`, early.length > 5, `${early.length}`);
  const sparse = early.filter((f) => f.tiles < final.tiles - 1);
  check(`${label}: nav shows its full tile set from 400 ms on (final ${final.tiles} tiles)`, sparse.length === 0, `${sparse.length} frames with fewer tiles, first: ${JSON.stringify(sparse[0] && { t: sparse[0].t, tiles: sparse[0].tiles })}`);
  check(`${label}: skeleton tiles stand in while the answer is pending`, early.some((f) => f.placeholders > 0), "no placeholder frame");
  check(`${label}: none is left once the answer arrived`, final.placeholders === 0 && final.links === final.tiles, JSON.stringify({ p: final.placeholders, l: final.links, t: final.tiles }));
  const first = early[0];
  const moved = NEVER_WAIT.filter((href) => !first?.rects[href] || Math.abs(first.rects[href].top - final.rects[href]?.top) > 1 || Math.abs(first.rects[href].left - final.rects[href]?.left) > 1);
  check(`${label}: tiles that never wait are real links in place from the start`, moved.length === 0, moved.map((h) => `${h} ${first?.rects[h] ? Math.round(first.rects[h].top) : "absent"} -> ${Math.round(final.rects[h]?.top)}`).join("; "));
  const pending = frames.filter((f) => f.placeholders > 0);
  check(`${label}: skeleton tiles are not links, not focusable, aria-hidden (${pending.length} frames)`, pending.length > 0 && pending.every((f) => f.inert), "a placeholder is interactive or not hidden");
  await context.close();
}
await finish();
