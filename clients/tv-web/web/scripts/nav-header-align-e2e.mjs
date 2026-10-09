#!/usr/bin/env node
// Page header layout guard (owner request 2026-10-10): on every page that has a header, at 1920 and 1280 px and in both
// themes, (1) the Back button's vertical centre equals the h1 line's centre (+-2 px), whatever sits under the title, and
// (2) the h1 does not intersect the shell clock. Runs against the deterministic mock API.
//
//   node scripts/nav-header-align-e2e.mjs [--no-build] [--dist dir]
import { boot, USER_ID } from "./e2e-common.mjs";

const { base, browser, check, finish } = await boot();

const PAGES = [
  "/calendar?view=week&date=2026-10-07",
  "/calendar?view=month&date=2026-10-07",
  "/calendar?view=agenda&date=2026-10-07",
  "/settings/appearance",
  "/settings/language",
  "/settings/server",
  "/playlists",
  "/playlists?playlist=00000000-0000-4000-8000-000000000100",
  "/search",
  "/search?q=a",
  "/movies",
  "/series",
  "/music",
  "/watchlist",
  "/requests",
  "/downloads",
  "/folders",
];
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
];

async function measure(path, viewport, theme, detailHref) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(
    ({ base, userId, theme }) => {
      try {
        localStorage.setItem("playarr:apiBaseUrl", base);
        const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
        localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: base, userId, name: "E2E", deviceId: "d", session }]));
        localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: base, userId }));
        localStorage.setItem("playarr-theme", theme);
      } catch {}
    },
    { base, userId: USER_ID, theme }
  );
  const page = await context.newPage();
  await page.goto(`${base}${detailHref ?? path}`);
  const header = await page.waitForSelector(".page-header h1", { timeout: 15000 }).catch(() => null);
  let result = { missing: true };
  if (header) {
    await page.waitForTimeout(900);
    result = await page.evaluate(() => {
      const h1 = document.querySelector(".page-header h1");
      const back = document.querySelector(".page-header .tv-page-back");
      const clock = document.querySelector(".app-clock");
      const r = (el) => el.getBoundingClientRect();
      const visible = (el) => el && getComputedStyle(el).display !== "none" && r(el).width > 0;
      const out = { title: h1.textContent };
      if (visible(back) && visible(h1)) {
        out.backCentre = r(back).top + r(back).height / 2;
        out.h1Centre = r(h1).top + r(h1).height / 2;
      }
      if (visible(clock) && visible(h1)) {
        const a = r(h1);
        const c = r(clock);
        out.overlap = a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
      }
      return out;
    });
  }
  await context.close();
  return result;
}

// One detail page: take the first library link from the Series page.
let detail = null;
{
  const context = await browser.newContext({ viewport: SIZES[0] });
  await context.addInitScript(
    ({ base, userId }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: base, userId, name: "E2E", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: base, userId }));
    },
    { base, userId: USER_ID }
  );
  const page = await context.newPage();
  await page.goto(`${base}/series`);
  await page.waitForSelector("a[href^='/series/']", { timeout: 15000 }).catch(() => null);
  detail = await page.evaluate(() => document.querySelector("a[href^='/series/']")?.getAttribute("href") ?? null);
  await context.close();
}
const pages = detail ? [...PAGES, detail] : PAGES;
check("a detail page is reachable for the header check", Boolean(detail));

for (const theme of ["dark", "light"]) {
  for (const viewport of SIZES) {
    for (const path of pages) {
      const m = await measure(path, viewport, theme);
      const label = `${path} @${viewport.width} ${theme}`;
      if (m.missing) {
        check(`${label}: has a header`, false, "no .page-header h1");
        continue;
      }
      if (m.backCentre !== undefined) {
        const delta = Math.abs(m.backCentre - m.h1Centre);
        check(`${label}: Back centre equals title centre`, delta <= 2, `delta ${delta.toFixed(1)}px (${m.title})`);
      }
      check(`${label}: title clear of the clock`, !m.overlap, `title "${m.title}" intersects the clock`);
    }
  }
}
await finish();
