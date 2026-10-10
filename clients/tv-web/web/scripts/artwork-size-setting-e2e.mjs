#!/usr/bin/env node
// Guard (1.9964): the artwork size lives in Settings > Appearance and drives EVERY poster card (Home, Library, Search,
// "more like this") to the same size; the Filters panel no longer offers it; the choice persists across reload; the
// default (medium) is the canonical size card-size-e2e checks.
//   node scripts/artwork-size-setting-e2e.mjs [--no-build] [--dist dir] [--shots dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { boot, opt } from "./e2e-common.mjs";

const shots = opt("shots", "");
if (shots) mkdirSync(shots, { recursive: true });
const { check, open, finish } = await boot({ movies: 40, series: 12, artists: 4, playlists: 1, playlistItems: 6, watchlist: 4, folders: true });

const cardWidth = (page, sel) =>
  page.evaluate((selector) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
    return el ? el.getBoundingClientRect().width : null;
  }, sel);

for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const { context, page } = await open("/settings/appearance", { width, height, theme: "dark" });
  await page.waitForTimeout(800);
  const tag = `${width}x${height}`;
  await page.goto(new URL("/movies", page.url()).href);
  await page.waitForTimeout(900);
  const movie = await page.evaluate(() => document.querySelector(".tv-title-grid .tv-title-card")?.getAttribute("href")?.split("/").pop() ?? "");
  const surfaces = [
    ["Home", "/", ".tv-home-rails .tv-home-card"],
    ["Library", "/movies", ".tv-title-grid .tv-title-card"],
    ["Search", "/search?q=a", ".tv-search-result"],
    ["More like this", `/movies/${movie}`, "[data-tv-track-id=similar] a.media-card"],
  ];
  const widths = {};
  const folders = {};
  for (const size of ["medium", "small", "large"]) {
    await page.goto(new URL("/settings/appearance", page.url()).href);
    await page.waitForTimeout(700);
    const group = page.locator(".artwork-size-choice");
    check(`${tag}: settings shows 3 size buttons in one row`, (await group.locator("button").count()) === 3);
    await group.locator("button", { hasText: new RegExp(`^${size}$`, "i") }).click();
    await page.waitForTimeout(300);
    if (shots && width === 1920) await page.screenshot({ path: join(shots, `settings-${size}.png`) });
    const measured = [];
    for (const [name, path, sel] of surfaces) {
      await page.goto(new URL(path, page.url()).href);
      await page.waitForTimeout(1000);
      await page.addStyleTag({ content: '[class*="-card"], [class*="-art"], [class*="search-result"] { transform: none !important; transition: none !important; }' });
      measured.push([name, await cardWidth(page, sel)]);
      if (shots && width === 1920 && (name === "Library" || name === "Home")) await page.screenshot({ path: join(shots, `${name.toLowerCase()}-${size}.png`) });
    }
    await page.goto(new URL("/folders", page.url()).href);
    await page.waitForTimeout(1000);
    await page.addStyleTag({ content: '[class*="-card"] { transform: none !important; transition: none !important; }' });
    folders[size] = await cardWidth(page, ".folders-card");
    widths[size] = measured;
    const base = measured[1][1];
    check(`${tag} ${size}: Folders card ${folders[size]?.toFixed(1)} = Library ${base?.toFixed(1)}`, folders[size] !== null && base !== null && Math.abs(folders[size] - base) <= 1);
    for (const [name, w] of measured) check(`${tag} ${size}: ${name} card ${w?.toFixed(1)} = Library ${base?.toFixed(1)}`, w !== null && base !== null && Math.abs(w - base) <= 1);
  }
  const lib = (s) => widths[s][1][1];
  check(`${tag}: small < medium < large (${lib("small")?.toFixed(0)} < ${lib("medium")?.toFixed(0)} < ${lib("large")?.toFixed(0)})`, lib("small") < lib("medium") && lib("medium") < lib("large"));

  check(`${tag}: Folders cards scale with the size (${folders.small?.toFixed(0)} < ${folders.medium?.toFixed(0)} < ${folders.large?.toFixed(0)})`, folders.small !== null && folders.small < folders.medium && folders.medium < folders.large);

  // Persists across reload (large was chosen last).
  await page.goto(new URL("/movies", page.url()).href);
  await page.reload();
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: '[class*="-card"], [class*="-art"] { transform: none !important; transition: none !important; }' });
  const after = await cardWidth(page, ".tv-title-grid .tv-title-card");
  check(`${tag}: size persists across reload`, after !== null && Math.abs(after - lib("large")) <= 1);

  // Filters panel no longer shows it.
  await page.goto(new URL("/movies?panel=filters", page.url()).href);
  await page.waitForTimeout(900);
  const filterText = await page.evaluate(() => document.body.innerText.toLowerCase());
  check(`${tag}: Filters panel has no artwork size`, filterText.includes("sort") && !filterText.includes("artwork size"));

  // An old ?size= param is adopted once into the setting (fresh storage) and dropped from the URL.
  await page.evaluate(() => localStorage.removeItem("playarr-artwork-size"));
  await page.goto(new URL("/movies?size=small", page.url()).href);
  await page.waitForTimeout(1000);
  check(`${tag}: legacy ?size=small mapped once and removed`, (await page.evaluate(() => localStorage.getItem("playarr-artwork-size"))) === "small" && !page.url().includes("size="));
  await page.evaluate(() => localStorage.removeItem("playarr-artwork-size"));
  await page.goto(new URL("/folders?size=large", page.url()).href);
  await page.waitForTimeout(1000);
  check(`${tag}: legacy Folders ?size=large mapped once and removed`, (await page.evaluate(() => localStorage.getItem("playarr-artwork-size"))) === "large" && !page.url().includes("size="));
  await context.close();
}
await finish();
