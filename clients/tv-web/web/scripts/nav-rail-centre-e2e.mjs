#!/usr/bin/env node
// The shared rail stack (Home's rails, a show's seasons, a playlist and its sub-playlists) centres the focused rail exactly, whatever keys got it there.
//
// Owner bug (9 Oct 2026): on a series page, Down then Up overshot the rail until a Left/Right corrected it, because
// the centre target was computed from a rail position mid-glide. After every sequence below (single presses, a
// reverse press, double presses, rapid presses) the focused rail's centre must sit on the stack's centre within 2 px
// (or the stack is clamped at its first or last position).
//
//   node scripts/nav-rail-centre-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 40, series: 12, seasons: 4, seasonEpisodes: 10, playlists: 4, playlistItems: 12, nestedPlaylists: true });

const SEQUENCES = [
  ["Down", ["ArrowDown"], 0],
  ["Down, Up", ["ArrowDown", "ArrowUp"], 60],
  ["Down, Down, Up, Up", ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"], 60],
  ["Down, Up quickly", ["ArrowDown", "ArrowUp"], 25],
  ["rapid zig-zag", ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowDown", "ArrowUp", "ArrowUp", "ArrowDown"], 40],
];

/** How far the focused track's centre is from the stack's centre, and whether the stack is clamped. */
const measure = (page, stackSelector) =>
  page.evaluate((selector) => {
    const stack = document.querySelector(selector);
    const active = document.querySelector("[data-remote-active]") ?? document.activeElement;
    const track = active?.closest?.(".tv-media-track");
    if (!stack || !track) return null;
    const s = stack.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    const max = stack.scrollHeight - stack.clientHeight;
    return {
      off: t.top + t.height / 2 - (s.top + s.height / 2),
      clamped: stack.scrollTop <= 0.5 || stack.scrollTop >= max - 0.5,
      track: track.dataset.tvTrackId,
    };
  }, stackSelector);

async function run(name, path, stackSelector, size) {
  for (const [label, keys, gap] of SEQUENCES) {
    const { context, page, errors } = await open(path, size);
    await page.waitForSelector(`${stackSelector} .tv-media-track`);
    await page.waitForTimeout(1500);
    // Park focus on a card inside the stack, then start from the first rail.
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(900);
    for (const key of keys) {
      await page.keyboard.press(key);
      if (gap) await page.waitForTimeout(gap);
      else await page.waitForTimeout(700);
    }
    await page.waitForTimeout(900);
    const m = await measure(page, stackSelector);
    const ok = m !== null && (m.clamped || Math.abs(m.off) <= 2);
    check(`${name} ${size.width}x${size.height}, ${label}: focused rail centred (off ${m ? m.off.toFixed(1) : "?"} px, rail ${m?.track}${m?.clamped ? ", clamped" : ""})`, ok, JSON.stringify(m));
    check(`${name} ${size.width}x${size.height}, ${label}: no page errors`, errors.length === 0, errors.join(";"));
    await context.close();
  }
}

const probe = await open("/");
const seriesId = await probe.page.evaluate(async () => {
  const response = await fetch("/api/v1/catalog?kind=series&limit=1", { headers: { authorization: "Bearer t" } });
  return (await response.json()).items[0].id;
});
await probe.context.close();

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  await run("Home", "/", ".tv-home-rails", size);
  await run("Playlist", "/playlists?playlist=00000000-0000-4000-8000-000000000100", ".tv-rail-surface.is-vertical-tracks", size);
  await run("Series", `/series/${seriesId}`, ".tv-series-browser", size);
}
await finish();
