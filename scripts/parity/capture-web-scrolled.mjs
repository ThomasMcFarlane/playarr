#!/usr/bin/env node
// Web counterpart of the scrolled device captures: Home with its first rail scrolled right by several cards, written as
// <out>/<layout>/<theme>/home-scrolled.png next to the static references, so a device capture can be compared with web at the
// same scroll position (and both run through check-edge-fade.mjs).
//   node capture-web-scrolled.mjs --base http://127.0.0.1:18484 --out <dir> [--theme light|dark|both] [--cards 4]
// Uses the fixture viewer (password from scripts/fixtures/catalog.mjs, default fixture-pass-0001) and the TV layout (1920x1080).
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const base = opt("base", "http://127.0.0.1:18484");
const out = opt("out", "parity-out");
const themes = opt("theme", "both") === "both" ? ["light", "dark"] : [opt("theme", "dark")];
const cards = Number(opt("cards", "4"));
const executablePath = process.env.PLAYARR_CHROMIUM ?? `${homedir()}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath });
for (const theme of themes) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: theme });
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
  for (let i = 0; i < cards; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(400); }
  await page.waitForTimeout(900);
  mkdirSync(join(out, "tv", theme), { recursive: true });
  await page.screenshot({ path: join(out, "tv", theme, "home-scrolled.png"), animations: "disabled", caret: "hide" });
  await ctx.close();
}
await browser.close();
