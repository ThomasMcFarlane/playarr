#!/usr/bin/env node
// Phone layout of the stage-style pages (row 209): the right-hand panel of Downloads, Watchlist and Requests is the
// whole page on a phone, not Home's 62% column; its content starts below the page header, and nothing is clipped by
// the viewport. Named nav-*-e2e so the web-layout-parity job picks it up with the other keyboard e2e scripts.
//
//   node scripts/nav-mobile-stage-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ playlists: 1 });

for (const [width, height] of [[390, 844], [600, 900]]) {
  for (const theme of ["dark", "light"]) {
    for (const route of ["/downloads", "/watchlist", "/requests"]) {
      const { context, page } = await open(route, { width, height, theme });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForSelector(".page-header", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const m = await page.evaluate(() => {
        const rect = (el) => (el ? el.getBoundingClientRect() : null);
        const panel = document.querySelector(".tv-library-grid-panel");
        const header = rect(document.querySelector(".page-header"));
        const content = document.querySelector(".tv-downloads-storage-panel");
        const first = rect(content);
        const p = rect(panel);
        return { vw: innerWidth, panel: p && { left: p.left, right: p.right }, headerBottom: header?.bottom ?? null, firstTop: first?.top ?? null, clipped: [...document.querySelectorAll(".tv-library-grid-panel *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).length };
      });
      const tag = `${width}px ${theme} ${route}`;
      check(`${tag}: panel spans the viewport`, m.panel !== null && m.panel.left <= 1 && m.panel.right >= m.vw - 1, JSON.stringify(m.panel));
      if (route === "/downloads") check(`${tag}: storage line starts below the header`, m.firstTop === null || m.firstTop >= m.headerBottom - 1, `first ${m.firstTop} header ${m.headerBottom}`);
      check(`${tag}: nothing runs off the right edge`, m.clipped === 0, `${m.clipped} elements`);
      await context.close();
    }
  }
}
await finish();
