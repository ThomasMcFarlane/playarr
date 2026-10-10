#!/usr/bin/env node
// Guard (1.9981): Settings > Player default audio and subtitle language are the shared Select (not pill lists),
// opened and driven by arrow keys + OK only, Back closes the list, and the value persists across reload. Subtitle mode
// and the Appearance choices are SegmentedControls.
//   node scripts/settings-language-select-e2e.mjs [--no-build] [--dist dir] [--shots dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { boot, opt, BACK_KEYS } from "./e2e-common.mjs";

const shots = opt("shots", "");
if (shots) mkdirSync(shots, { recursive: true });
const { check, open, finish } = await boot({ movies: 6, series: 2, artists: 0, playlists: 3, playlistItems: 3 });
const back = BACK_KEYS[0][1];

for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const tag = `${width}x${height}`;
  const { context, page } = await open("/settings/player", { width, height, theme: "dark" });
  let audio = "en";
  await context.route("**/api/v1/users/me/player-preferences", async (route) => {
    const req = route.request();
    if (req.method() !== "GET") audio = JSON.parse(req.postData() ?? "{}").preferred_audio_language ?? audio;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ preferred_audio_language: audio }) });
  });
  await page.reload();
  await page.waitForTimeout(1000);

  check(`${tag}: no language pill lists left`, (await page.locator(".player-language-button, .player-default-button").count()) === 0);
  check(`${tag}: audio default is a Select field (subtitle language only when subtitles are on)`, (await page.locator(".ui-select-trigger").count()) >= 1);

  const audioField = page.locator(".ui-select-trigger").last();
  await audioField.focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  check(`${tag}: ArrowDown opens the list`, await page.locator(".ui-select-list").isVisible());
  check(`${tag}: no text input in list`, (await page.locator(".ui-select input").count()) === 0);
  if (shots) await page.screenshot({ path: join(shots, `player-open-${tag}.png`) });
  await back(page);
  await page.waitForTimeout(200);
  check(`${tag}: Back closes the list`, (await page.locator(".ui-select-list").count()) === 0);
  check(`${tag}: Back keeps the page`, page.url().includes("/settings/player"));

  await audioField.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check(`${tag}: list closed after choosing`, (await page.locator(".ui-select-list").count()) === 0);
  check(`${tag}: audio saved as Spanish`, audio === "es", audio);
  await page.reload();
  await page.waitForTimeout(1000);
  check(`${tag}: audio persists across reload`, (await page.locator(".ui-select-trigger", { hasText: "Spanish" }).count()) >= 1);
  if (shots) await page.screenshot({ path: join(shots, `player-${tag}.png`) });
  await context.close();
}

// Playlists filters drawer: Show and Order are SegmentedControls (no pressed-button grids), arrows move, Back closes.
for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const tag = `${width}x${height}`;
  const { context, page } = await open("/playlists?panel=filters", { width, height, theme: "dark" });
  await page.waitForTimeout(600);
  const drawer = page.locator("#playlist-filter-drawer");
  check(`${tag} playlists: no legacy choice grid`, (await drawer.locator(".tv-filter-choice-grid:not(.tv-segmented)").count()) === 0);
  const seg = drawer.locator('[role="group"] button[aria-pressed]');
  check(`${tag} playlists: 3 + 2 segmented buttons, no text input`, (await seg.count()) === 5 && (await drawer.locator("input").count()) === 0, String(await seg.count()));
  await seg.first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check(`${tag} playlists: arrows + OK choose a value`, (await page.evaluate(() => location.search)).includes("visibility=personal"));
  await back(page);
  await page.waitForTimeout(400);
  check(`${tag} playlists: Back closes the drawer`, !(await drawer.isVisible().catch(() => false)));
  await context.close();
}
await finish();
