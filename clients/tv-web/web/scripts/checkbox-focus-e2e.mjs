#!/usr/bin/env node
// A focused checkbox must not trap keyboard/D-pad focus: arrows leave it, Space toggles it.
//
//   node scripts/checkbox-focus-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ playlists: 1 });
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const active = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return { type: a?.type ?? "", tag: a?.tagName ?? "", inNav: Boolean(a?.closest?.("nav, [data-nav-rail]")) };
  });

for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const tag = `${width}`;
  for (const route of ["/settings/your-data", "/settings/remote", "/calendar"]) {
    const { context, page } = await open(route, { width, height });
    await settle(page, 1200);
    if (route === "/calendar") {
      const filters = page.getByRole("button", { name: /filter/i }).first();
      if (await filters.count()) await filters.click();
      await settle(page);
    }
    const box = page.locator('input[type="checkbox"]').first();
    if (!(await box.count())) {
      check(`${tag} ${route}: checkbox present`, false);
      await context.close();
      continue;
    }
    await box.focus();
    const before = await box.isChecked();
    await page.keyboard.press("Space");
    await settle(page, 200);
    check(`${tag} ${route}: Space toggles`, (await box.isChecked()) !== before);
    await page.keyboard.press("Space");
    let left = false;
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) {
      await box.focus();
      await page.keyboard.press(key);
      await settle(page, 400);
      const now = await active(page);
      const moved = now.type !== "checkbox";
      // A direction with no neighbour may legitimately stay put, so only Left on Settings is asserted alone.
      if (key === "ArrowLeft" && route.startsWith("/settings")) {
        check(`${tag} ${route}: ArrowLeft reaches the Settings menu`, moved, JSON.stringify(now));
      }
      // Neighbours: Remote has controls below; Your data has selects above (its Preview button below is disabled until a file is chosen).
      if ((route.endsWith("remote") && key === "ArrowDown") || (route.endsWith("your-data") && key === "ArrowUp")) {
        check(`${tag} ${route}: ${key} reaches the neighbouring control`, moved, JSON.stringify(now));
      }
      left = left || moved;
    }
    if (route.startsWith("/settings")) {
      await box.focus();
      const url = page.url();
      await page.keyboard.press("Escape");
      await settle(page, 700);
      check(`${tag} ${route}: Back leaves the page from the checkbox`, page.url() !== url, page.url());
    }
    check(`${tag} ${route}: an arrow key leaves the checkbox (not trapped)`, left);
  }
}
await finish();
