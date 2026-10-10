#!/usr/bin/env node
// ONE shared right-side panel (owner, 10 October 2026: "Holding Enter to open the right panel shows a differently
// designed right panel and a broken X close button. I TOLD YOU TO MAKE IT CONSISTENT EVERYWHERE").
//
// Opens every right-side panel (Filters on Movies, Series, Search and Calendar, the Calendar link, Create playlist,
// movie playback settings, the long-press Enter actions panel on a card and on an episode, its Add to Playlist view and
// its Download view, and the right-click menu) at 1920x1080 and 1280x720 in both themes, and asserts that each one:
//   - is the shared Drawer root (aside.tv-filter-drawer.drawer) with the same header / body structure,
//   - has the same close button: .drawer-close, same icon, a non-empty aria-label, same size and the same offset from
//     the panel's top-right corner, same border radius and colours,
//   - has the same header offset, header width and panel width,
//   - closes on Escape and returns focus to the opener (where the opener is still on the page).
// Compared against the Movies Filters panel of the same viewport and theme. Screenshots: --shots <dir>.
//
//   node scripts/drawer-consistency-e2e.mjs [--no-build] [--dist dir] [--shots dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { boot, opt } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 24, series: 12, canDownload: true, playlists: 3, playlistItems: 4 }, { realisticAuth: true });
const SHOTS = opt("shots", "");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TOL = 0.5;
const ONLY = opt("only", "");

const MEASURE = () => {
  const roots = [...document.querySelectorAll("aside[role='dialog']")];
  const panel = roots.at(-1);
  if (!panel) return null;
  const p = panel.getBoundingClientRect();
  const header = panel.querySelector(":scope > header.drawer-header");
  const body = panel.querySelector(":scope > .drawer-body");
  const close = panel.querySelector(":scope > header .drawer-close");
  const h = header?.getBoundingClientRect();
  const c = close?.getBoundingClientRect();
  const cs = close ? getComputedStyle(close) : null;
  return {
    root: `${panel.tagName.toLowerCase()}.${["tv-filter-drawer", "drawer"].filter((n) => panel.classList.contains(n)).join(".")}`,
    structure: Boolean(header && body && close),
    panelWidth: p.width,
    panelHeight: p.height,
    headerTop: h ? h.top - p.top : null,
    headerLeft: h ? h.left - p.left : null,
    headerWidth: h?.width ?? null,
    closeW: c?.width ?? null,
    closeH: c?.height ?? null,
    closeTop: c ? c.top - p.top : null,
    closeRight: c ? p.right - c.right : null,
    closeText: close?.textContent?.trim() ?? null,
    closeLabel: close?.getAttribute("aria-label") ?? "",
    closeRadius: cs?.borderRadius ?? null,
    closeBg: cs?.backgroundColor ?? null,
    closeColor: cs?.color ?? null,
    bodyPadLeft: body ? body.getBoundingClientRect().left - p.left : null,
  };
};

const hold = async (page, selector) => {
  await page.focus(selector);
  await page.keyboard.down("Enter");
  await page.waitForTimeout(900);
  await page.keyboard.up("Enter");
  await page.waitForTimeout(600);
};

const rightClickCard = async (page) => {
  await page.waitForSelector("a[href*='/movies/']", { timeout: 15000 });
  await page.click("a[href*='/movies/']", { button: "right" });
  await page.waitForSelector(".media-context-actions", { timeout: 8000 });
};

/** Each panel: how to reach it from a fresh page. `opener` is the selector that must hold focus after Escape. */
const PANELS = [
  { id: "movies-filters", path: "/movies?panel=filters", urlOpened: true },
  { id: "series-filters", path: "/series?panel=filters", urlOpened: true },
  { id: "search-filters", path: "/search?q=a&panel=filters", urlOpened: true },
  { id: "calendar-filters", path: "/calendar?panel=filters", urlOpened: true },
  { id: "calendar-link", path: "/calendar?panel=link", urlOpened: true },
  { id: "playlist-create", path: "/playlists?panel=create", urlOpened: true },
  {
    id: "card-long-press-actions",
    path: "/movies",
    opener: "a[href*='/movies/']",
    async open(page) {
      await page.waitForSelector("a[href*='/movies/']", { timeout: 15000 });
      await hold(page, "a[href*='/movies/']");
    },
  },
  {
    id: "card-right-click-actions",
    path: "/movies",
    async open(page) {
      await rightClickCard(page);
    },
  },
  {
    id: "card-add-to-playlist",
    path: "/movies",
    async open(page) {
      await rightClickCard(page);
      await page.locator(".media-context-actions").getByRole("button", { name: /add to playlist/i }).first().click();
      await page.waitForTimeout(700);
    },
  },
  {
    id: "card-download-view",
    path: "/movies",
    async open(page) {
      await rightClickCard(page);
      await page.locator(".media-context-actions").getByRole("button", { name: /download/i }).first().click();
      await page.waitForSelector(".download-quality-drawer", { timeout: 8000 });
      await page.waitForTimeout(700);
    },
  },
  {
    id: "episode-long-press-actions",
    path: "/series",
    async open(page) {
      await page.waitForSelector("a[href*='/series/']", { timeout: 15000 });
      await page.click("a[href*='/series/']");
      await page.waitForSelector(".tv-episode-card", { timeout: 15000 });
      await hold(page, ".tv-episode-card");
    },
  },
  {
    id: "playlist-context-menu",
    path: "/playlists",
    async open(page) {
      await page.waitForSelector(".tv-playlist-directory-card", { timeout: 15000 });
      await page.click(".tv-playlist-directory-card", { button: "right" });
      await page.waitForSelector(".playlist-context-drawer", { timeout: 8000 });
    },
  },
  {
    id: "movie-playback-settings",
    path: "/movies",
    async open(page) {
      await page.waitForSelector("a[href*='/movies/']", { timeout: 15000 });
      await page.click("a[href*='/movies/']");
      await page.waitForSelector(".tv-detail-playback-settings", { timeout: 15000 });
      await page.click(".tv-detail-playback-settings");
      await page.waitForTimeout(700);
    },
  },
];

for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  for (const theme of ["dark", "light"]) {
    const ref = {};
    for (const spec of PANELS) {
      if (ONLY && spec.id !== "movies-filters" && !new RegExp(ONLY).test(spec.id)) continue;
      const label = `${spec.id} ${width}x${height} ${theme}`;
      const { context, page } = await open(spec.path, { width, height, theme });
      try {
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
        if (spec.open) await spec.open(page);
        await page.waitForSelector("aside[role='dialog']", { timeout: 8000 });
        await page.waitForTimeout(700);
        const m = await page.evaluate(MEASURE);
        check(`${label}: opens`, m !== null);
        if (!m) continue;
        if (SHOTS) await page.screenshot({ path: join(SHOTS, `${spec.id}-${width}-${theme}.png`) });
        if (spec.id === "movies-filters") Object.assign(ref, m);
        check(`${label}: root is aside.tv-filter-drawer.drawer`, m.root === "aside.tv-filter-drawer.drawer", m.root);
        check(`${label}: header, body and close button structure`, m.structure);
        check(`${label}: close icon is the shared "×"`, m.closeText === "×", String(m.closeText));
        check(`${label}: close has an aria-label`, m.closeLabel.length > 0);
        for (const key of ["panelWidth", "panelHeight", "headerTop", "headerLeft", "headerWidth", "closeW", "closeH", "closeTop", "closeRight", "bodyPadLeft"]) {
          check(`${label}: ${key} equals the shared panel (${ref[key]?.toFixed?.(1)})`, ref[key] !== undefined && Math.abs(m[key] - ref[key]) <= TOL, `${m[key]?.toFixed?.(1)} vs ${ref[key]?.toFixed?.(1)}`);
        }
        for (const key of ["closeRadius", "closeBg", "closeColor"]) {
          check(`${label}: ${key} equals the shared panel`, m[key] === ref[key], `${m[key]} vs ${ref[key]}`);
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(900);
        // A sub-view of the actions panel (Add to Playlist, Download) steps back to the actions first.
        if (await page.evaluate(() => Boolean(document.querySelector("aside[role='dialog']"))) && /add-to-playlist|download/.test(spec.id)) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(900);
        }
        const closed = await page.evaluate(() => !document.querySelector("aside[role='dialog']"));
        check(`${label}: Escape closes it`, closed);
        if (spec.opener) {
          const back = await page.evaluate((sel) => document.activeElement?.matches?.(sel) ?? false, spec.opener);
          check(`${label}: focus returns to the opener`, back);
        } else if (!spec.urlOpened) {
          const some = await page.evaluate(() => document.activeElement !== document.body);
          check(`${label}: focus is not lost to the page body`, some);
        }
      } catch (error) {
        check(label, false, String(error?.message ?? error).split("\n")[0]);
      } finally {
        await context.close();
      }
    }
  }
}
await finish();
