#!/usr/bin/env node
// The nav rail must fit the viewport and clear the profile chip at every TV size (web TV audit R1): at 1280x720
// Downloads was clipped off the top and the chip covered Requests and Calendar. Checked with every rail entry
// present, in the plain TV layout and with a smart-TV user agent (which also scales the stage).
//
//   node scripts/nav-rail-e2e.mjs [--no-build] [--dist dir]
import { boot, focusInfo } from "./e2e-common.mjs";

const { browser, base, check, finish } = await boot({ canDownload: true, playlists: 1, folders: true, watchlist: 1 });
const VIDAA =
  "Mozilla/5.0 (Linux; Large Screen) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36 VIDAA/6.0 Hisense";
const sizes = [
  [1920, 1080, undefined],
  [1280, 720, undefined],
  [1366, 768, undefined],
  [1280, 720, VIDAA],
  [1920, 1080, VIDAA],
];
for (const [width, height, userAgent] of sizes) {
  const label = `${width}x${height}${userAgent ? " VIDAA" : ""}`;
  const context = await browser.newContext({ viewport: { width, height }, ...(userAgent ? { userAgent } : {}) });
  await context.addInitScript(({ base, userId }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: base, userId, name: "E2E", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: base, userId }));
  }, { base, userId: "00000000-0000-4000-8000-000000000001" });
  const page = await context.newPage();
  await page.goto(`${base}/movies${userAgent ? "?platform=tv-vidaa" : ""}`);
  await page.waitForSelector(".app-nav-link", { timeout: 15000 });
  await page.waitForTimeout(1200);
  // The real account also shows Downloads (needs managed storage the headless browser lacks): add one entry.
  await page.evaluate(() => {
    const links = document.querySelectorAll(".app-nav-link:not(.app-user-identity)");
    const last = links[links.length - 1];
    if (links.length < 11) last.parentElement.insertBefore(last.cloneNode(true), last);
  });
  const m = await page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const links = [...document.querySelectorAll(".app-nav-link:not(.app-user-identity)")].map((e) => ({ label: e.getAttribute("aria-label") ?? e.textContent.trim(), ...r(e).toJSON() }));
    const chip = document.querySelector(".app-user-identity");
    return { links, chip: chip ? r(chip).toJSON() : null, vw: innerWidth, vh: innerHeight };
  });
  const clipped = m.links.filter((l) => l.top < -0.5 || l.bottom > m.vh + 0.5 || l.left < -0.5 || l.right > m.vw + 0.5);
  check(`${label}: all ${m.links.length} rail entries are on screen`, m.links.length >= 11 && clipped.length === 0, JSON.stringify(clipped.map((l) => l.label)));
  const last = Math.max(...m.links.map((l) => l.bottom));
  check(`${label}: the rail clears the profile tile`, !m.chip || last <= m.chip.top + 0.5, `rail bottom ${Math.round(last)} chip top ${Math.round(m.chip?.top ?? 0)}`);
  check(`${label}: the profile tile is on screen`, !m.chip || (m.chip.top >= 0 && m.chip.bottom <= m.vh + 0.5), JSON.stringify(m.chip));
  const first = Math.min(...m.links.map((l) => l.top));
  check(`${label}: the rail clears the top edge`, first >= 0, `rail top ${Math.round(first)}`);
  await context.close();
}
// R13: DOWN from the profile chip (the end of the rail) stays on the chip; it never jumps into the page.
for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const label = `${width}x${height}`;
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(({ base, userId }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: base, userId, name: "E2E", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: base, userId }));
  }, { base, userId: "00000000-0000-4000-8000-000000000001" });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".app-nav-link", { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator(".app-user-identity").focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(450);
  const info = await page.evaluate(() => ({ onChip: Boolean(document.activeElement?.closest(".app-user-identity")), inNav: Boolean(document.activeElement?.closest(".app-nav")) }));
  check(`${label}: DOWN on the profile chip stays on the chip`, info.onChip, JSON.stringify(await focusInfo(page)));
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(450);
  check(`${label}: UP from the chip returns to the last rail entry`, await page.evaluate(() => Boolean(document.activeElement?.closest(".app-nav"))));
  await context.close();
}
await finish();
