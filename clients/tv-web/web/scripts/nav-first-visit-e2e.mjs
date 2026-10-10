#!/usr/bin/env node
// "Skeletons still show on the first visit to Playlists, Watchlist and the Library" (owner report, 10 October 2026,
// after #437 and #450 were live). The earlier e2e used 700 ms on the section lists only, waited 11 s on Home and
// never left Home early, so it passed while a real server (0.7 to 1.5 s per call) still showed skeletons. This one
// answers EVERY API read after 1 s, as a remote server does, and checks the three causes found on live:
//   A. a visit a few seconds after Home settled (the warm-up must not wait on idle time, run one section after
//      another, or stop when Home unmounts for the first section visited),
//   B. a live resync (stream reconnect) drops the warm-up's reads that were in flight; they must be asked for again,
//   C. browsing the Library fills the query cache with work details; the warmed sections must survive it,
//   D. with no warm-up at all the skeleton is replaced in place: no blank frame, the page element is not remounted.
// Runs at 1920x1080 dark and 1280x720 light, keyboard only.
//   node scripts/nav-first-visit-e2e.mjs [--no-build] [--dist dir] [--only A|B|C|D]
import { boot, opt, root } from "./e2e-common.mjs";
import { startServer } from "./nav-perf/server.mjs";
import { join } from "node:path";
const only = opt("only", "");
const { check, open, finish } = await boot({ movies: 10, series: 2, artists: 0 }, { realisticAuth: true });
const base = { distDir: opt("dist", join(root, "dist")), movies: 320, series: 40, artists: 20, onDeck: 0, playlists: 2, playlistItems: 4, watchlist: 4, latencyMs: 1000 };
const slow = await startServer(base);
const resyncing = await startServer({ ...base, resyncAfterMs: 4500 });

// What each section shows once it has real content (a skeleton, or the calendar's placeholder entries, do not count).
const SECTIONS = [
  { name: "calendar", href: "/calendar", content: ".calendar-entry:not(.calendar-entry-skeleton)" },
  { name: "playlists", href: "/playlists", content: ".tv-media-track, .tv-title-card, [data-tv-track-id]" },
  { name: "watchlist", href: "/watchlist", content: ".tv-watchlist-list" },
  { name: "series", href: "/series", content: ".tv-title-card" },
  { name: "music", href: "/music", content: ".tv-title-card" },
  { name: "movies", href: "/movies", content: ".tv-title-card" },
];

/** Records, per frame, whether the target page shows a skeleton, its content or nothing, and which page elements exist. */
const RECORD = ([href, content]) => {
  const w = window;
  w.__f = { frames: [], nodes: new Set(), id: 0 };
  const tick = () => {
    const main = document.querySelector(".app-main");
    const onTarget = location.pathname.startsWith(href);
    const page = main?.querySelector("[data-page-id]");
    if (page && onTarget) w.__f.nodes.add((page.__fid ??= ++w.__f.id));
    w.__f.frames.push({
      onTarget,
      skeleton: Boolean(main?.querySelector(".skeleton-state")),
      // The page being left stays on screen until the new one is mounted: that is not a blank frame.
      content: Boolean(main?.querySelector(content) || main?.querySelector(".tv-home-card")),
      hasPage: Boolean(page),
    });
    w.__f.raf = requestAnimationFrame(tick);
  };
  tick();
};
const stop = (page) => page.evaluate(() => { cancelAnimationFrame(window.__f.raf); const f = window.__f; return { frames: f.frames, nodes: f.nodes.size }; });

const homeReady = async (page) => {
  await page.waitForSelector(".tv-home-card", { timeout: 20000 });
  // Home takes initial focus once it has settled; wait for that so it cannot pull focus off the nav item mid-dwell.
  await page.waitForFunction(() => Boolean(document.activeElement?.closest?.(".tv-home-card")), null, { timeout: 20000 }).catch(() => undefined);
};
const backHome = async (page) => {
  await page.evaluate(() => document.querySelector(".app-nav a[href='/']")?.click());
  await homeReady(page);
  await page.waitForTimeout(300);
};
/** Focuses the nav item, dwells, presses Enter and records until the section's content is on screen. */
async function visit(page, section, dwellMs) {
  await page.evaluate((h) => document.querySelector(`.app-nav a[href='${h}']`)?.focus(), section.href);
  await page.waitForTimeout(dwellMs);
  await page.evaluate(RECORD, [section.href, section.content]);
  await page.keyboard.press("Enter");
  const reached = await page.waitForSelector(`[data-page-id] ${section.content.split(",")[0]}, ${section.content}`, { timeout: 30000 }).then(() => true, () => false);
  await page.waitForTimeout(500);
  const rec = await stop(page);
  return { reached, ...rec, onTarget: rec.frames.filter((f) => f.onTarget) };
}
const skeletonFrames = (r) => r.onTarget.filter((f) => f.skeleton).length;
const blankFrames = (r) => r.onTarget.filter((f) => !f.skeleton && !f.content).length;

for (const [w, h, theme] of [[1920, 1080, "dark"], [1280, 720, "light"]]) {
  const size = `${w}x${h} ${theme}`;
  const bigScreen = theme === "dark";
  const session = async (server, init) => {
    const s = await open("/", { width: w, height: h, theme, server, init });
    if (theme === "light") await s.page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await homeReady(s.page);
    return s;
  };

  // ---- A. A visit a few seconds after Home settled, the sections one after another with a 400 ms nav dwell.
  if (!only || only === "A") {
    const { context, page } = await session(slow);
    await page.waitForTimeout(5000);
    for (const section of SECTIONS) {
      const r = await visit(page, section, 400);
      check(`A ${size}: ${section.name} shows content on the first frame (no skeleton, no blank)`, r.reached && skeletonFrames(r) === 0 && blankFrames(r) === 0, `skeleton ${skeletonFrames(r)}, blank ${blankFrames(r)}, reached ${r.reached}`);
      await backHome(page);
    }
    await context.close();
  }

  // ---- B. A live resync lands while the warm-up's reads are in flight.
  if (!only || only === "B") {
    const { context, page } = await session(resyncing);
    await page.waitForTimeout(13000);
    for (const section of SECTIONS.filter((s) => ["playlists", "watchlist", "movies", "calendar"].includes(s.name))) {
      const r = await visit(page, section, 400);
      check(`B ${size}: ${section.name} after a live resync shows content on the first frame`, r.reached && skeletonFrames(r) === 0 && blankFrames(r) === 0, `skeleton ${skeletonFrames(r)}, blank ${blankFrames(r)}, reached ${r.reached}`);
      await backHome(page);
    }
    await context.close();
  }

  // ---- C. Browse the Library (a work detail per focused card goes into the cache), then visit the other sections.
  if ((!only || only === "C") && bigScreen) {
    const { context, page } = await session(slow);
    await page.waitForTimeout(9000);
    await page.evaluate(() => document.querySelector(".app-nav a[href='/movies']")?.click());
    await page.waitForSelector(".tv-title-card", { timeout: 20000 });
    await page.locator(".tv-title-card").first().focus();
    for (let i = 0; i < 230; i += 1) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(2500);
    await backHome(page);
    for (const section of SECTIONS.filter((s) => s.name !== "movies")) {
      const r = await visit(page, section, 400);
      check(`C ${size}: ${section.name} after browsing the Library shows content on the first frame`, r.reached && skeletonFrames(r) === 0 && blankFrames(r) === 0, `skeleton ${skeletonFrames(r)}, blank ${blankFrames(r)}, reached ${r.reached}`);
      await backHome(page);
    }
    await context.close();
  }

  // ---- D. No warm-up at all (save-data): the skeleton is replaced in place, never by a blank frame or a new page element.
  if (!only || only === "D") {
    const saveData = () => Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
    const { context, page } = await session(slow, saveData);
    await page.waitForTimeout(1500);
    for (const section of SECTIONS.filter((s) => ["calendar", "playlists", "watchlist", "movies"].includes(s.name))) {
      const r = await visit(page, section, 0);
      check(`D ${size}: ${section.name} cold visit shows its skeleton, then content, with no blank frame`, r.reached && skeletonFrames(r) > 0 && blankFrames(r) === 0, `skeleton ${skeletonFrames(r)}, blank ${blankFrames(r)}, reached ${r.reached}`);
      check(`D ${size}: ${section.name} cold visit keeps one page element from skeleton to content`, r.nodes === 1, `${r.nodes} page elements`);
      await backHome(page);
    }
    await context.close();
  }
}
slow.close?.();
resyncing.close?.();
await finish();
