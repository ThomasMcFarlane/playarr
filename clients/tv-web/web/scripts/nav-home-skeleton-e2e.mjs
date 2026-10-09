#!/usr/bin/env node
// Home's loading skeleton is the rail stack itself, so it sits where the loaded rails render: the same top and left, the
// same card size and gap, the same section spacing between rails (within 2 px), at 1920x1080 and 1280x720.
//
//   node scripts/nav-home-skeleton-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 40, series: 12, onDeck: 0, progressDelayMs: 3000 });
const TOLERANCE = 2;

const rects = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const stack = document.querySelector(".tv-home-rails");
    const tracks = [...stack.querySelectorAll(".tv-media-track")].slice(0, 3);
    return {
      stack: box(stack),
      tracks: tracks.map((t) => box(t)),
      heading: tracks.map((t) => box(t.querySelector(".tv-media-track-heading"))),
      cards: tracks.map((t) => [...t.querySelectorAll(".tv-home-card")].slice(1, 4).map(box)),
      art: tracks.map((t) => [...t.querySelectorAll(".tv-home-card-art")].slice(1, 4).map(box)),
      skeleton: Boolean(stack.querySelector(".is-skeleton")),
    };
  });

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  const tag = `${size.width}x${size.height}`;
  const { context, page } = await open("/", size);
  // The mock answers watch progress late, so Home is still loading right after navigation.
  await context.clearCookies();
  const loading = await (async () => {
    await page.reload();
    await page.waitForSelector(".tv-home-rails .is-skeleton", { timeout: 800 }).catch(() => null);
    await page.waitForTimeout(1100);
    return rects(page);
  })();
  check(`${tag}: skeleton shown while loading`, loading.skeleton, "no skeleton card");
  await page.waitForSelector(".tv-home-card:not(.is-skeleton)", { timeout: 12000 });
  await page.waitForTimeout(1500);
  const loaded = await rects(page);
  check(`${tag}: loaded rails shown`, !loaded.skeleton, "still a skeleton");
  const same = (name, a, b) => {
    const worst = Math.max(...a.flat(2).map((r, i) => Math.max(Math.abs(r.x - b.flat(2)[i].x), Math.abs(r.y - b.flat(2)[i].y), Math.abs(r.w - b.flat(2)[i].w), Math.abs(r.h - b.flat(2)[i].h))));
    check(`${tag}: skeleton ${name} match the loaded ones within ${TOLERANCE}px (worst ${worst.toFixed(1)})`, worst <= TOLERANCE, String(worst));
  };
  same("rail stack", [loading.stack], [loaded.stack]);
  same("tracks", loading.tracks, loaded.tracks);
  same("headings", loading.heading, loaded.heading);
  same("cards", loading.cards, loaded.cards);
  same("card art", loading.art, loaded.art);
  await context.close();
}
await finish();
