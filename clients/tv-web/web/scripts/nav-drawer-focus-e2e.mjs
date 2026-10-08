#!/usr/bin/env node
// Every right-side panel restores focus to the button that opened it (web TV audit R21). The shared Drawer owns
// this, so the check drives the Filters panel on Movies, Search and Calendar, and closes it by Escape and by the
// browser Back (which re-renders the page, so the launcher is a new element) in both themes.
//
//   node scripts/nav-drawer-focus-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot();
const PAGES = [
  { name: "Movies", path: "/movies" },
  { name: "Search", path: "/search?q=a" },
  { name: "Calendar", path: "/calendar?view=week&date=2026-10-07" },
];
const LAUNCHER = "[data-shell-action-column] [data-filters-button]";
const state = (page) =>
  page.evaluate((selector) => {
    const launcher = document.querySelector(selector);
    return {
      onLauncher: launcher !== null && document.activeElement === launcher,
      active: `${document.activeElement?.tagName ?? ""}.${String(document.activeElement?.className ?? "").slice(0, 40)}`,
      drawer: document.querySelectorAll("aside.drawer:not([data-drawer-ghost])").length,
    };
  }, LAUNCHER);

for (const theme of ["dark", "light"]) {
  for (const { name, path } of PAGES) {
    for (const how of ["Escape", "Back"]) {
      const { context, page } = await open(path, { theme });
      await page.waitForTimeout(1200);
      const label = `${name} (${theme}): ${how}`;
      await page.locator(LAUNCHER).focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(700);
      const opened = await state(page);
      check(`${label} opens the Filters drawer`, opened.drawer === 1, JSON.stringify(opened));
      if (how === "Escape") await page.keyboard.press("Escape");
      else await page.goBack();
      await page.waitForTimeout(1200);
      const closed = await state(page);
      check(`${label} closes it`, closed.drawer === 0, JSON.stringify(closed));
      check(`${label} returns focus to the Filters button`, closed.onLauncher, JSON.stringify(closed));
      await context.close();
    }
  }
}
await finish();
