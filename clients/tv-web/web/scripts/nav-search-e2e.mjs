#!/usr/bin/env node
// Search Filters lives in the shell action column like every other page (web TV audit R7, R21): no inline pill,
// the button opens the shared drawer, a chip filters, and BACK closes it with focus back on the button.
//
//   node scripts/nav-search-e2e.mjs [--no-build] [--dist dir]
import { boot, focusInfo } from "./e2e-common.mjs";

const { check, open, finish } = await boot();
const { context, page } = await open("/search?q=a");
await page.waitForTimeout(1500);

const inline = await page.locator(".tv-search-filter-toggle, .tv-search-filter-control").count();
check("Search: no inline Filters pill", inline === 0, String(inline));
const inColumn = await page.locator("[data-shell-action-column] [data-filters-button]").count();
check("Search: Filters is in the shell action column", inColumn === 1, String(inColumn));

await page.locator("[data-shell-action-column] [data-filters-button]").focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
check("Search: Filters opens the drawer", (await page.locator("#search-filters-drawer:visible").count()) === 1);
const chips = page.locator("#search-filters-drawer .tv-filter-choice-grid button");
check("Search: the drawer holds the type and library chips", (await chips.count()) >= 4, String(await chips.count()));
await chips.nth(1).focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
check("Search: a chip sets the type filter in the URL", /[?&]type=/.test(page.url()), page.url());
await page.keyboard.press("Escape");
await page.waitForTimeout(700);
check("Search: BACK closes the drawer", (await page.locator("#search-filters-drawer:visible").count()) === 0);
const info = await focusInfo(page);
check("Search: focus returns to the Filters button", /filters/i.test(`${info?.label} ${info?.cls}`), JSON.stringify(info));
check("Search: BACK stayed on Search", new URL(page.url()).pathname === "/search", page.url());
await context.close();
await finish();
