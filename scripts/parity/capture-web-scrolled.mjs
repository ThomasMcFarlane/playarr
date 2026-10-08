#!/usr/bin/env node
// Web counterpart of the scrolled device captures: Home with its first rail scrolled right by several cards, written as
// <out>/<layout>/<theme>/home-scrolled.png next to the static references, so a device capture can be compared with web at the
// same scroll position (and both run through check-edge-fade.mjs).
//   node capture-web-scrolled.mjs --base http://127.0.0.1:18484 --out <dir> [--theme light|dark|both] [--cards 4]
// Uses the fixture viewer (password from scripts/fixtures/catalog.mjs, default fixture-pass-0001) and the TV layout (1920x1080).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const base = opt("base", "http://127.0.0.1:18484");
const out = opt("out", "parity-out");
const themes = opt("theme", "both") === "both" ? ["light", "dark"] : [opt("theme", "dark")];
const cards = Number(opt("cards", "4"));
const layout = opt("layout", "tv"); // tv: focus moves right by <cards>; mobile: the first rail is scrolled so card <cards> is at the leading edge
const mobile = layout === "mobile";
const executablePath = process.env.PLAYARR_CHROMIUM ?? `${homedir()}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const browser = await chromium.launch(process.env.PARITY_CHROME_CHANNEL ? { channel: process.env.PARITY_CHROME_CHANNEL } : { executablePath });
for (const theme of themes) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: "reduce", colorScheme: theme }
    : { viewport: { width: 1920, height: 1080 }, colorScheme: theme });
  // Freeze the clock at the fixture instant like capture-web.mjs, so the header clock matches the native capture.
  const fixtureClock = readFileSync(new URL("../fixtures/catalog.mjs", import.meta.url), "utf8").match(/FIXTURE_CLOCK = "([^"]+)"/)[1];
  await ctx.clock.install({ time: new Date(fixtureClock) });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill("#login-server-url", base).catch(() => {});
  await page.fill("#login-username", "fx-viewer");
  await page.fill('input[name="password"]', process.env.PARITY_PASSWORD ?? "fixture-pass-0001");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.goto(`${base}/`);
  await page.waitForTimeout(3000);
  // Scroll the first rail the way the remote does: RIGHT moves focus card by card and the track follows.
  if (mobile) {
    await page.addStyleTag({ content: "*{scroll-behavior:auto!important;transition:none!important;animation:none!important}::-webkit-scrollbar{display:none}" });
    await page.evaluate((k) => { const el = document.querySelector(".tv-media-track-scroll"); const card = el?.children[k]; if (el && card) el.scrollLeft = card.offsetLeft - el.offsetLeft; }, cards);
  } else for (let i = 0; i < cards; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(400); }
  await page.waitForTimeout(900);
  mkdirSync(join(out, layout, theme), { recursive: true });
  // The track's final scroll offset, so a native capture can be placed at the same position (home-scrolled.json).
  const metrics = await page.evaluate(() =>
    [...document.querySelectorAll(".tv-media-track-scroll")].map((el) => ({ scrollLeft: Math.round(el.scrollLeft), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })));
  writeFileSync(join(out, layout, theme, "home-scrolled.json"), JSON.stringify(metrics, null, 1));
  await page.screenshot({ path: join(out, layout, theme, "home-scrolled.png"), animations: "disabled", caret: "hide" });
  await ctx.close();
}
await browser.close();
