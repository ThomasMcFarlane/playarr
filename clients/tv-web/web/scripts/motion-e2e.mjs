#!/usr/bin/env node
// Motion checks (owner ruling 8 October 2026): focus-driven scrolling is animated, not a snap.
// After one arrow press, the scroll position of every scroller is sampled each frame; a scroller that moved must
// move monotonically over several distinct frames (never one jump). Also checks a held key converges on the newest
// focus without a backlog, and that reduced motion jumps straight there.
//   node scripts/motion-e2e.mjs [--dist dir] [--width 1280] [--height 720] [--throttle 1]
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const DIST = opt("dist", join(root, "dist"));
const WIDTH = Number(opt("width", 1280));
const HEIGHT = Number(opt("height", 720));
const THROTTLE = Number(opt("throttle", 1));
const USER_ID = "00000000-0000-4000-8000-000000000001";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
};

const server = await startServer({ distDir: DIST, seasons: 3, seasonEpisodes: 14, canDownload: false });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch();

async function open(path, { reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, reducedMotion });
  await context.addInitScript(({ base, userId }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
  }, { base, userId: USER_ID });
  const page = await context.newPage();
  await page.goto(`${base}${path}`);
  if (THROTTLE > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  return { context, page };
}

// Per-frame scroll positions of every scroller for `ms` after the key press.
async function sampleKey(page, key, ms = 700) {
  await page.evaluate(() => {
    const scrollers = () => [document.scrollingElement, ...document.querySelectorAll("*")].filter((el) => el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1));
    const list = scrollers();
    window.__motion = { list, series: list.map((el) => [[el.scrollTop, el.scrollLeft]]), done: false };
    const start = performance.now();
    const tick = () => {
      const m = window.__motion;
      list.forEach((el, i) => m.series[i].push([el.scrollTop, el.scrollLeft]));
      if (performance.now() - start < 700) requestAnimationFrame(tick); else m.done = true;
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press(key);
  await page.waitForFunction(() => window.__motion.done);
  return page.evaluate(() => window.__motion.series.map((s, i) => ({
    name: (window.__motion.list[i].className || window.__motion.list[i].tagName).toString().slice(0, 40),
    top: s.map((p) => p[0]), left: s.map((p) => p[1]),
  })));
}

const monotonic = (values) => values.every((v, i) => i === 0 || v >= values[i - 1] - 0.01) || values.every((v, i) => i === 0 || v <= values[i - 1] + 0.01);
const distinct = (values) => new Set(values.map((v) => Math.round(v * 2) / 2)).size;
const moved = (values) => Math.abs(values[values.length - 1] - values[0]) > 8;

// Press `key` up to `tries` times; report the first press that scrolled something, as an animation verdict.
async function animatedScroll(page, key, axis, tries) {
  for (let i = 0; i < tries; i += 1) {
    const result = await sampleKey(page, key);
    const hit = result.find((s) => moved(s[axis]));
    if (hit) return { ok: monotonic(hit[axis]) && distinct(hit[axis]) >= 4, hit, axis };
    await page.waitForTimeout(150);
  }
  return null;
}

const verdict = (label, r) => check(label, r?.ok === true, r ? `${r.hit.name} ${r.axis}: ${JSON.stringify([...new Set(r.hit[r.axis].map((v) => Math.round(v)))])}` : "no scroll happened");

{ // Home: vertical page move between rails, then a rail move.
  const { context, page } = await open("/");
  await page.waitForSelector(".tv-home-card");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  verdict("home: vertical page scroll between rails is animated", await animatedScroll(page, "ArrowDown", "top", 6));
  await page.waitForTimeout(500);
  verdict("home: rail scroll sideways is animated", await animatedScroll(page, "ArrowRight", "left", 14));
  await context.close();
}
{ // Library grid.
  const { context, page } = await open("/movies");
  await page.waitForSelector("[data-library-index]");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  verdict("movies: grid scroll is animated", await animatedScroll(page, "ArrowDown", "top", 8));
  await context.close();
}
{ // Held key: ten fast presses converge on the newest focus, and the focused card stays on screen.
  const { context, page } = await open("/movies");
  await page.waitForSelector("[data-library-index]");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  for (let i = 0; i < 12; i += 1) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(33); }
  const started = Date.now();
  await page.waitForFunction(() => {
    const g = document.querySelector(".tv-title-grid");
    window.__last = window.__last ?? [];
    window.__last.push(g.scrollTop);
    const l = window.__last;
    return l.length > 4 && l.slice(-4).every((v) => v === l[l.length - 1]);
  }, null, { polling: 50, timeout: 3000 });
  const settledMs = Date.now() - started;
  check("held key: scroll settles within 400 ms of the last press", settledMs < 400, `${settledMs} ms`);
  const onScreen = await page.evaluate(() => {
    const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight + 1;
  });
  check("held key: focused card ends on screen", onScreen);
  await context.close();
}
{ // Reduced motion: jumps straight there (no intermediate frames).
  const { context, page } = await open("/movies", { reducedMotion: "reduce" });
  await page.waitForSelector("[data-library-index]");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  let r = null;
  for (let i = 0; i < 8 && !r; i += 1) {
    const result = await sampleKey(page, "ArrowDown");
    const hit = result.find((s) => moved(s.top));
    if (hit) r = hit;
  }
  check("reduced motion: scroll is not animated", r !== null && distinct(r.top) <= 2, r ? JSON.stringify([...new Set(r.top.map(Math.round))]) : "no scroll");
  await context.close();
}

await browser.close();
server.close?.();
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
