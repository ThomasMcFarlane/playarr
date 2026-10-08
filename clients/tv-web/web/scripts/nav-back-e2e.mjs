#!/usr/bin/env node
// Keyboard-driven BACK checks (web TV audit A2, A4, A6, K8, P7). Every BACK key variant (Escape, Backspace,
// BrowserBack, Tizen 10009, webOS 461) must behave the same: leave a detail page one level, and close an open
// panel without also leaving the page underneath.
//
//   node scripts/nav-back-e2e.mjs [--no-build] [--dist dir]
import { BACK_KEYS, boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ playlists: 1, folders: true });
const path = (page) => new URL(page.url()).pathname + new URL(page.url()).search;

for (const [name, press] of BACK_KEYS) {
  // Detail page: one BACK returns to the library.
  {
    const { context, page } = await open("/movies");
    await page.waitForSelector("[data-library-index]");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/movies\/[0-9a-f-]+/, { timeout: 10_000 }).catch(() => {});
    const onDetail = /\/movies\/[0-9a-f-]+/.test(page.url());
    await page.waitForTimeout(600);
    await press(page);
    await page.waitForURL(/\/movies$/, { timeout: 5000 }).catch(() => {});
    check(`${name}: detail -> library`, onDetail && path(page) === "/movies", path(page));
    await context.close();
  }
  // Panel: one BACK closes only the Filters panel; the page underneath stays.
  {
    const { context, page } = await open("/movies");
    await page.waitForSelector("[data-library-index]");
    await page.locator("[data-shell-action-column] button").first().focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector(".drawer, [role=dialog]", { timeout: 5000 }).catch(() => {});
    const opened = (await page.locator("[role=dialog]").count()) > 0;
    await press(page);
    await page.waitForTimeout(600);
    const closed = (await page.locator("[role=dialog]:visible").count()) === 0;
    check(`${name}: Filters panel closes and the page stays`, opened && closed && path(page).startsWith("/movies") && !/\/movies\//.test(path(page)), `${opened} ${closed} ${path(page)}`);
    await context.close();
  }
  // Playlists detail: BACK goes up to the directory, not Home (A6).
  {
    const { context, page } = await open("/playlists?playlist=00000000-0000-4000-8000-000000000100");
    await page.waitForTimeout(800);
    await press(page);
    await page.waitForTimeout(600);
    check(`${name}: playlist detail -> Playlists`, path(page) === "/playlists", path(page));
    await context.close();
  }
  // Nested Folders: BACK goes up one directory, then to the root chooser, then out (A6).
  {
    const root = "00000000-0000-4000-8000-000000000200";
    const { context, page } = await open(`/folders?root=${root}&path=Sub%20A`);
    await page.waitForTimeout(800);
    await press(page);
    await page.waitForTimeout(600);
    const up = new URL(page.url()).searchParams;
    check(`${name}: folder level up`, new URL(page.url()).pathname === "/folders" && up.get("root") === root && !up.get("path"), path(page));
    await press(page);
    await page.waitForTimeout(600);
    const chooser = new URL(page.url()).searchParams;
    check(`${name}: folder root -> chooser`, new URL(page.url()).pathname === "/folders" && !chooser.get("root"), path(page));
    await context.close();
  }
}

await finish();
