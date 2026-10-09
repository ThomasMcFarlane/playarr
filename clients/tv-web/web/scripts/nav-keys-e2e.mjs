#!/usr/bin/env node
// Key-handling gaps (web TV audit A11, A22, A23): modifier chords are not spatial moves, a quick OK on a
// link without long-press props still opens it, and Enter in a text field is never redirected to a stale
// virtual card.
//
//   node scripts/nav-keys-e2e.mjs [--no-build] [--dist dir]
import { boot, focusInfo } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ playlists: 3 });
const path = (page) => new URL(page.url()).pathname + new URL(page.url()).search;

// A22: Alt+Arrow and Ctrl+Arrow pass through; a plain arrow still moves focus.
{
  const { context, page } = await open("/movies");
  await page.waitForSelector("[data-library-index]");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  const before = await focusInfo(page);
  for (const chord of ["Alt+ArrowRight", "Control+ArrowRight", "Control+ArrowDown", "Meta+ArrowRight"]) {
    await page.keyboard.press(chord);
    await page.waitForTimeout(450);
    const after = await focusInfo(page);
    check(`${chord} does not move focus`, JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
  }
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(450);
  const moved = await focusInfo(page);
  check("a plain ArrowRight still moves focus", JSON.stringify(moved) !== JSON.stringify(before), JSON.stringify(moved));
  await context.close();
}

// A11: OK straight after an arrow move opens a playlist search result.
{
  const { context, page } = await open(`/search?q=${encodeURIComponent("Test list")}`);
  await page.waitForSelector(".tv-search-result.is-playlist");
  await page.waitForTimeout(800);
  await page.locator(".tv-search-result.is-playlist").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/playlists/, { timeout: 5000 }).catch(() => {});
  check("quick OK opens the playlist result", path(page).startsWith("/playlists"), path(page));
  await context.close();
}

// A23: Enter in a text field right after an arrow move stays with the field.
{
  const { context, page } = await open(`/search?q=${encodeURIComponent("Test list")}`);
  await page.waitForSelector(".tv-search-result.is-playlist");
  await page.waitForTimeout(800);
  await page.locator(".tv-search-result.is-playlist").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => document.querySelector("input")?.focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const stillSearch = new URL(page.url()).pathname === "/search";
  check("Enter in the search field is not redirected to a card", stillSearch, path(page));
  await context.close();
}

await finish();
