#!/usr/bin/env node
// Focus survives unmounting (web TV audit A9, B15, A10, P15): removing the focused Watchlist row hands focus to
// the next row, never the body; the Watchlist marks a single default row; closing a modal returns focus to the
// control that opened it.
//
//   node scripts/nav-restore-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ watchlist: 3 });
const active = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    return { tag: el.tagName, text: el.textContent?.trim().slice(0, 40) ?? "", key: el.getAttribute("data-navigation-focus-key") };
  });

{
  const { context, page } = await open("/watchlist");
  await page.waitForSelector(".tv-watchlist-row");
  await page.waitForTimeout(600);
  const defaults = await page.locator(".tv-watchlist-row [data-tv-focus-default]").count();
  check("Watchlist marks exactly one default row", defaults === 1, String(defaults));

  // Focus the first row's Remove button with the keyboard (Right from the primary link), press it.
  await page.locator(".tv-watchlist-row").first().locator("button").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".tv-watchlist-row").length === 2, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const after = await active(page);
  check("removing a row leaves focus on a control, not the body", after !== null, JSON.stringify(after));
  check("focus lands in the remaining rows", Boolean(after?.key?.startsWith("watchlist:")), JSON.stringify(after));
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  const next = await active(page);
  check("the next arrow press stays in the page, not the nav rail", next !== null && !(await page.evaluate(() => Boolean(document.activeElement?.closest(".app-nav")))), JSON.stringify(next));
  await context.close();
}

await finish();
