#!/usr/bin/env node
// Vertical moves between stacked rails are geometric: UP/DOWN land on the card
// whose on-screen centre is closest to the focused card's centre, and the target
// rail never scrolls to a matching index or offset (only enough to unclip).
//   node scripts/rail-geometry-e2e.mjs [--dist dir] [--theme light|dark]
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const DIST = opt("dist", join(root, "dist"));
const THEMES = opt("theme", "") ? [opt("theme", "")] : ["dark", "light"];
const USER_ID = "00000000-0000-4000-8000-000000000001";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
};

const server = await startServer({ distDir: DIST });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch();

const state = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
  if (!el || el === document.body) return null;
  const r = el.getBoundingClientRect();
  const rail = el.closest("[data-tv-scroll-axis=horizontal]");
  const rails = [...document.querySelectorAll("[data-tv-scroll-axis=horizontal]")];
  return {
    cx: r.left + r.width / 2, top: r.top,
    railIndex: rails.indexOf(rail),
    scrolls: rails.map((x) => Math.round(x.scrollLeft)),
    visible: r.left >= -1 && r.right <= innerWidth + 1,
    cards: rail ? [...rail.querySelectorAll(".tv-home-card, a, button")].filter((c) => c.getBoundingClientRect().width > 0).length : 0,
  };
});
const centresOf = (page, railIndex) => page.evaluate((i) => {
  const rail = document.querySelectorAll("[data-tv-scroll-axis=horizontal]")[i];
  const rr = rail.getBoundingClientRect();
  return [...rail.querySelectorAll(".tv-home-card")].map((c) => {
    const r = c.getBoundingClientRect();
    return { cx: r.left + r.width / 2, inView: r.right > rr.left && r.left < rr.right };
  });
}, railIndex);

for (const theme of THEMES) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(({ base, userId, theme }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
    localStorage.setItem("playarr.theme", theme);
    document.documentElement.dataset.theme = theme;
  }, { base, userId: USER_ID, theme });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".tv-home-card");
  await page.waitForTimeout(1500);

  for (const direction of ["ArrowDown", "ArrowUp"]) {
    await page.reload();
    await page.waitForSelector(".tv-home-card");
    await page.waitForTimeout(1500);
    // Start on rail 0 for Down, rail 1 for Up; scroll that rail to the far right.
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    if (direction === "ArrowDown") await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(700);
    for (let i = 0; i < 12; i += 1) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(80); }
    await page.waitForTimeout(900);
    const before = await state(page);
    await page.keyboard.press(direction);
    await page.waitForTimeout(1200);
    const after = await state(page);
    const target = after.railIndex;
    const centres = (await centresOf(page, target)).filter((c) => c.inView);
    const best = Math.min(...centres.map((c) => Math.abs(c.cx - before.cx)));
    const label = `${theme} ${direction}`;
    check(`${label}: focus moved to the adjacent rail`, target === before.railIndex + (direction === "ArrowDown" ? 1 : -1), JSON.stringify({ before, after }));
    check(`${label}: landed on the card nearest the previous x`, Math.abs(after.cx - before.cx) <= best + 2, `dx=${Math.abs(after.cx - before.cx)} best=${best}`);
    check(`${label}: target rail did not scroll to a matching offset`, after.scrolls[target] === before.scrolls[target], `before=${before.scrolls} after=${after.scrolls}`);
    check(`${label}: focused card is on screen`, after.visible, JSON.stringify(after));
  }
  await context.close();
}
await browser.close();
server.close?.();
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
