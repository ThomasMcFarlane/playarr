#!/usr/bin/env node
// Layered Back (web TV audit A5, A7, A24): with a minimised player a drawer closes before the mini player;
// a custom-key drawer closes on Back even after focus left it; signed-out pages honour Back.
//
//   node scripts/nav-layers-e2e.mjs [--no-build] [--dist dir]
import { BACK_KEYS, USER_ID, boot } from "./e2e-common.mjs";

const { base, browser, check, open, finish } = await boot({ playlists: 1 });
const SESSION_KEY = "playarr.activePlayerSession.v1";
const hasSession = async (page) => (await page.locator(".player-page.is-minimised").count()) > 0;
const drawerCount = (page) => page.locator("[role=dialog]:visible").count();

// A5: drawer first, then the mini player.
for (const [name, press] of BACK_KEYS) {
  const { context, page } = await open("/movies");
  await page.waitForSelector("[data-library-index]");
  await page.route(/\/api\/v1\/playback\//, () => new Promise(() => {}));
  // Start a player route, then return to Movies in-app: the session stays as a minimised player.
  await page.evaluate(() => {
    history.pushState({ backTo: "/movies" }, "", "/player/mf-layer?title=x");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    history.pushState({}, "", "/movies");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForSelector("[data-library-index]");
  await page.waitForTimeout(900);
  check(`${name}: a minimised player session is active`, await hasSession(page));
  await page.locator("[data-shell-action-column] button").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("[role=dialog]", { timeout: 5000 }).catch(() => {});
  await press(page);
  await page.waitForTimeout(700);
  check(`${name}: first Back closes the drawer`, (await drawerCount(page)) === 0, String(await drawerCount(page)));
  check(`${name}: the mini player survives the drawer's Back`, await hasSession(page));
  await press(page);
  await page.waitForTimeout(500);
  check(`${name}: second Back closes the mini player`, !(await hasSession(page)));
  await context.close();
}

// A24: a custom-key drawer (Playlists create) closes on Back wherever focus is.
{
  const { context, page } = await open("/playlists");
  await page.waitForTimeout(900);
  await page.locator("[data-shell-action-column] button").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("[role=dialog]", { timeout: 5000 }).catch(() => {});
  const opened = (await drawerCount(page)) > 0;
  // Move focus out of the drawer into the page, then press Back.
  await page.evaluate(() => document.querySelector(".app-main a, .app-main button:not([role=dialog] *)")?.focus());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  check("Playlists: Back closes the drawer even when focus left it", opened && (await drawerCount(page)) === 0, `${opened} ${await drawerCount(page)}`);
  await context.close();
}

// A7: signed-out pages honour Back (history back).
for (const [name, press] of BACK_KEYS) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.waitForTimeout(600);
  await page.goto(`${base}/signup`);
  await page.waitForTimeout(900);
  await press(page);
  await page.waitForTimeout(700);
  check(`${name}: Back on Sign up goes back`, new URL(page.url()).pathname === "/login", page.url());
  await context.close();
}

await finish();
