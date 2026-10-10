#!/usr/bin/env node
// Keyboard-driven focus start, restore and reachability checks (web TV audit A1, A8, A19, R4, R10, R33, R22).
//
//   node scripts/nav-focus-e2e.mjs [--no-build] [--dist dir]
import { boot, focusInfo } from "./e2e-common.mjs";

const { base, check, open, finish } = await boot({ playlists: 1, folders: true, watchlist: 2, canDownload: true });
async function toNav(page) {
  for (let i = 0; i < 6 && !(await focusInfo(page))?.inNav; i += 1) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(250);
  }
}
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const PLAYLIST = "00000000-0000-4000-8000-000000000100";
const ROOT = "00000000-0000-4000-8000-000000000200";

// R4: movie detail opens on Play, both directly and after OK on a card; the first Down leaves Play.
{
  const { context, page } = await open("/movies");
  await page.waitForSelector("[data-library-index]");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/movies\/[0-9a-f-]+/, { timeout: 10_000 });
  await settle(page, 1200);
  const info = await focusInfo(page);
  check("movie detail opened with OK: focus starts on Play", /tv-detail-play/.test(info?.cls ?? ""), JSON.stringify(info));
  // A1: a long wait (the shell re-renders every minute) must not yank focus back from where the user put it.
  await toNav(page);
  check("movie detail: LEFT reaches the nav rail", (await focusInfo(page))?.inNav === true, JSON.stringify(await focusInfo(page)));
  await context.close();
}
{
  const { context, page } = await open("/movies");
  await page.waitForSelector("[data-library-index]");
  const href = await page.evaluate(() => document.querySelector("[data-library-index]").getAttribute("href"));
  await page.goto(`${base}${href}`);
  await settle(page, 1200);
  const info = await focusInfo(page);
  check("movie detail loaded directly: focus starts on Play", /tv-detail-play/.test(info?.cls ?? ""), JSON.stringify(info));
  await page.keyboard.press("ArrowDown");
  await settle(page, 900);
  const after = await focusInfo(page);
  check("movie detail: the first Down leaves Play for the content below", after !== null && !/tv-detail-play/.test(after.cls) && !after.inNav, JSON.stringify(after));
  await context.close();
}

// A1: the effect must not restart on the App's minute re-render. Move focus to the nav rail on a detail page opened
// with OK, advance the clock a minute, and focus must stay there.
{
  const { context, page } = await open("/movies");
  await page.clock.install();
  await page.clock.resume();
  await page.waitForSelector("[data-library-index]");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/movies\/[0-9a-f-]+/, { timeout: 10_000 });
  await settle(page, 1500);
  await toNav(page);
  const before = await focusInfo(page);
  await page.clock.fastForward(65_000);
  await settle(page, 600);
  const after = await focusInfo(page);
  check("detail page: focus on the nav rail survives the minute re-render", before?.inNav === true && after?.inNav === true, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  await context.close();
}

// A8, R10: every page starts with focus in the page, never null and never the nav rail.
const starts = [
  ["/playlists", "Playlists (empty directory)"],
  [`/playlists?playlist=${PLAYLIST}`, "a new playlist's detail"],
  ["/folders", "Folders (root chooser)"],
  ["/requests", "Requests"],
  ["/downloads", "Downloads"],
  ["/watchlist", "Watchlist"],
];
for (const [route, label] of starts) {
  const { context, page } = await open(route);
  await settle(page, 1200);
  const info = await focusInfo(page);
  check(`${label}: initial focus is in the page`, info !== null && !info.inNav, JSON.stringify(info));
  await page.keyboard.press("ArrowDown");
  await settle(page, 250);
  const down = await focusInfo(page);
  check(`${label}: the first arrow key keeps focus in the page`, down !== null && !down.inNav, JSON.stringify(down));
  await context.close();
}

// A19: Folders restores the folder just left, and the source after leaving it.
{
  const { context, page } = await open(`/folders?root=${ROOT}&path=Sub%20A`);
  await settle(page, 1000);
  await page.keyboard.press("Escape");
  await settle(page, 1000);
  let info = await focusInfo(page);
  check("Folders: going up lands on the folder just left", /Sub A/.test(info?.label ?? ""), JSON.stringify(info));
  await page.keyboard.press("Escape");
  await settle(page, 1000);
  info = await focusInfo(page);
  check("Folders: leaving the source lands on that source", /Root A/.test(info?.label ?? ""), JSON.stringify(info));
  await context.close();
}

// A19: Watchlist restores the row after opening a title and coming back.
{
  const { context, page } = await open("/watchlist");
  await settle(page, 1000);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await settle(page, 300);
  await page.keyboard.press("ArrowUp");
  await settle(page, 300);
  const before = await page.evaluate(() => (document.querySelector("[data-remote-active]") ?? document.activeElement)?.closest("[data-navigation-focus-key]")?.getAttribute("data-navigation-focus-key"));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  const left = !new URL(page.url()).pathname.startsWith("/watchlist");
  await page.keyboard.press("Escape");
  await page.waitForURL(/\/watchlist/, { timeout: 8000 }).catch(() => {});
  await settle(page, 1500);
  const after = await page.evaluate(() => (document.querySelector("[data-remote-active]") ?? document.activeElement)?.closest("[data-navigation-focus-key]")?.getAttribute("data-navigation-focus-key"));
  check("Watchlist: Back restores the row", left && Boolean(before) && before === after, `${before} -> ${after}`);
  await context.close();
}

// R33: the theme and language selects on the profile switcher are reachable and usable with the D-pad.
{
  const { context, page } = await open("/profiles");
  await settle(page, 1000);
  await page.keyboard.press("ArrowUp");
  await settle(page, 250);
  let info = await focusInfo(page);
  check("Profiles: UP reaches the theme select", /theme-dropdown-trigger/.test(info?.cls ?? ""), JSON.stringify(info));
  await page.keyboard.press("ArrowRight");
  await settle(page, 250);
  info = await focusInfo(page);
  check("Profiles: RIGHT reaches the language select", /language-dropdown-trigger/.test(info?.cls ?? "") && !/theme/.test(info?.cls ?? ""), JSON.stringify(info));
  await page.keyboard.press("ArrowLeft");
  await settle(page, 250);
  await page.keyboard.press("Enter");
  await settle(page, 300);
  const opened = await page.evaluate(() => Boolean(document.querySelector(".theme-dropdown-menu")));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await settle(page, 400);
  const closed = await page.evaluate(() => !document.querySelector(".theme-dropdown-menu"));
  check("Profiles: the theme select opens, picks an option with OK and closes", opened && closed, `${opened} ${closed}`);
  await page.keyboard.press("ArrowDown");
  await settle(page, 250);
  info = await focusInfo(page);
  check("Profiles: DOWN returns from the selects to the profiles", info !== null && !/dropdown-trigger/.test(info.cls), JSON.stringify(info));
  await context.close();
}

// A3, R22: the Calendar period picker holds focus.
{
  const { context, page } = await open("/calendar");
  await settle(page, 1500);
  await page.locator("[data-range-button]").focus();
  await page.keyboard.press("Enter");
  await settle(page, 400);
  let held = true;
  for (const key of [...Array(16).fill("ArrowDown"), "ArrowRight", "ArrowRight", "ArrowLeft", ...Array(16).fill("ArrowUp")]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(40);
    held &&= await page.evaluate(() => Boolean(document.activeElement?.closest(".period-picker-panel")));
  }
  check("Calendar period picker: arrows never leave the popover", held);
  await page.keyboard.press("Escape");
  await settle(page, 300);
  const info = await focusInfo(page);
  check("Calendar period picker: BACK closes it and returns to the range button", info?.cls?.includes("ui-btn") && (await page.evaluate(() => document.activeElement?.matches("[data-range-button]"))), JSON.stringify(info));
  await context.close();
}

await finish();
