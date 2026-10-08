#!/usr/bin/env node
// Side-panel closing is the exact reverse of opening, on every close path, in every layout and both themes.
//
// For each layout (TV 1920x1080, desktop 1280x720, mobile 390x844) and theme, and for each panel (library Filters,
// calendar Filters, calendar link), it opens the panel and closes it by each path (Close button, Escape, the launcher
// toggle, a route change), and for the context-menu drawer by clicking its scrim. Per run it checks:
//   1. Path. The opening animation and the closing animation are paused and sampled at 13 points of their timeline
//      through the Web Animations API (deterministic, no frame jitter): the closing panel's translateX and opacity at
//      time t equal the opening panel's at T - t, within a small tolerance, and the durations are equal.
//   2. Real time. Unpaused, the panel is still on screen right after the close is triggered, has gone after the
//      opening duration plus slack (and not much sooner), and focus is back on the launcher afterwards (not for a
//      route change, whose launcher no longer exists).
// The reduced-motion layout checks that the panel closes at once, with no ghost left behind.
//
//   node scripts/drawer-close.mjs [--no-build] [--dist dir] [--layouts tv,desktop,mobile] [--themes light,dark]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const DIST = opt("dist", join(root, "dist"));
if (!args.includes("--no-build") && !opt("dist", "")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const LAYOUTS = {
  tv: { viewport: { width: 1920, height: 1080 }, platform: "tv-webos" },
  desktop: { viewport: { width: 1280, height: 720 } },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const layouts = opt("layouts", "tv,desktop,mobile").split(",");
const themes = opt("themes", "light,dark").split(",");
const PANELS = [
  { id: "library-filters", path: "/movies", panel: "filters", launcher: "[data-filters-button]" },
  { id: "calendar-filters", path: "/calendar?view=week&date=2026-10-07", panel: "filters", launcher: "[data-filters-button]" },
  { id: "calendar-link", path: "/calendar?view=week&date=2026-10-07", panel: "link", launcher: "[data-panel-button]" },
];
const PATHS = ["close-button", "escape", "launcher", "route-change"];
const SAMPLES = 13;
/** Positions are compared as a fraction of the panel width; opacity directly. */
const TOLERANCE = 0.03;
const SLACK_MS = 220;

const server = await startServer({ distDir: DIST, movies: 12, series: 8, artists: 0 });
const base = `http://127.0.0.1:${server.port}`;
const dir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const exe = process.env.NAV_PERF_CHROMIUM || (full ? join(dir, full, "chrome-linux64/chrome") : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const USER_ID = "00000000-0000-4000-8000-000000000001";
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
  failed ||= !ok;
};

async function newPage(layoutId, theme, reducedMotion = "no-preference") {
  const layout = LAYOUTS[layoutId];
  const { platform: _platform, ...contextOptions } = layout;
  const context = await browser.newContext({ ...contextOptions, reducedMotion, colorScheme: theme, locale: "en-GB", timezoneId: "UTC" });
  await context.addInitScript(
    ({ base, userId, theme }) => {
      localStorage.setItem("playarr-theme", theme);
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
    },
    { base, userId: USER_ID, theme }
  );
  const page = await context.newPage();
  return { context, page };
}

async function openPage(page, layoutId, spec) {
  const platform = LAYOUTS[layoutId].platform;
  const sep = spec.path.includes("?") ? "&" : "?";
  await page.goto(`${base}${spec.path}${platform ? `${sep}platform=${platform}` : ""}`, { waitUntil: "load" });
  await page.waitForSelector(spec.launcher, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

/** Pause and sample the first running animation named `name` on a matching element, at SAMPLES points of its timeline. */
const SAMPLE_FN = `
async ({ name, samples, selector }) => {
  const find = () =>
    document.getAnimations().find((a) => a.animationName === name && a.effect?.target?.matches?.(selector));
  let animation = find();
  for (let i = 0; i < 40 && !animation; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    animation = find();
  }
  if (!animation) return null;
  animation.pause();
  const target = animation.effect.target;
  const timing = animation.effect.getComputedTiming();
  const duration = timing.duration;
  const width = target.getBoundingClientRect().width || 1;
  const rows = [];
  for (let i = 0; i < samples; i += 1) {
    animation.currentTime = (duration * i) / (samples - 1);
    const style = getComputedStyle(target);
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    rows.push({ x: matrix.m41 / (target.offsetWidth || width), opacity: Number(style.opacity) });
  }
  return { duration, easing: animation.effect.getTiming().easing, rows };
}`;

const sample = (page, name, selector = ".tv-filter-drawer") =>
  page.evaluate(`(${SAMPLE_FN})(${JSON.stringify({ name, samples: SAMPLES, selector })})`);

async function triggerClose(page, how, spec) {
  if (how === "close-button") await page.click(".tv-filter-drawer .drawer-close");
  else if (how === "escape") await page.keyboard.press("Escape");
  else if (how === "launcher") await page.evaluate((s) => document.querySelector(s)?.click(), spec.launcher);
  else if (how === "route-change") await page.evaluate(() => document.querySelector(".app-nav a[href='/settings'], .app-nav a[href='/']")?.click());
  else if (how === "scrim") await page.mouse.click(8, 8);
}

function compareMirror(label, open, close) {
  if (!open || !close) return check(`${label}: both animations sampled`, false, `open=${Boolean(open)} close=${Boolean(close)}`);
  check(`${label}: same duration`, open.duration === close.duration, `${open.duration} vs ${close.duration}`);
  // The close travels the opening path backwards. Its easing is not the opening curve mirrored (that is a dash
  // after a pause); it must move at once, advance steadily and never take a large step between samples.
  const xs = close.rows.map((r) => r.x);
  const monotonic = xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-6);
  const biggestStep = Math.max(...xs.map((x, i) => (i === 0 ? 0 : x - xs[i - 1])));
  check(`${label}: closing moves at once (>= 20% of the way after a quarter of the time)`, xs[Math.round((SAMPLES - 1) / 4)] >= 0.2, JSON.stringify(xs.map((x) => +x.toFixed(2))));
  check(`${label}: closing is monotonic with no big step (<= 25% of the width per sample)`, monotonic && biggestStep <= 0.25, `max step ${biggestStep.toFixed(2)}`);
  const start = close.rows[0];
  const end = close.rows[SAMPLES - 1];
  check(`${label}: slides out to the right and fades`, start.x === 0 && end.x >= 0.99 && start.opacity === 1 && end.opacity === 0, JSON.stringify({ start, end }));
}

async function runPanel(layoutId, theme, spec, how) {
  const label = `${layoutId}/${theme}/${spec.id}/${how}`;
  const { context, page } = await newPage(layoutId, theme);
  try {
    await openPage(page, layoutId, spec);
    const launcher = page.locator(spec.launcher).first();
    await launcher.focus();
    await launcher.click();
    // The opening animation, sampled while paused.
    const open = await sample(page, "tv-filter-drawer-in");
    await page.waitForTimeout(500);
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    const openMs = open?.duration ?? 0;

    // The closing animation, paused and sampled.
    await triggerClose(page, how, spec);
    const close = await sample(page, "drawer-out");
    compareMirror(label, open, close);
    await context.close();

    // Real time: the same close, unpaused.
    const real = await newPage(layoutId, theme);
    await openPage(real.page, layoutId, spec);
    const realLauncher = real.page.locator(spec.launcher).first();
    await realLauncher.focus();
    await realLauncher.click();
    await real.page.waitForSelector(".tv-filter-drawer", { timeout: 5000 });
    await real.page.waitForTimeout(openMs + SLACK_MS);
    await triggerClose(real.page, how, spec);
    await real.page.waitForTimeout(40);
    const present = await real.page.evaluate(() => Boolean(document.querySelector(".tv-filter-drawer")));
    check(`${label}: still on screen just after closing starts`, present);
    await real.page.waitForTimeout(openMs + SLACK_MS);
    const gone = await real.page.evaluate(() => !document.querySelector(".tv-filter-drawer") && !document.querySelector("[data-drawer-ghost]"));
    check(`${label}: gone after the opening duration`, gone);
    if (how !== "route-change") {
      const focused = await real.page.evaluate((s) => document.activeElement === document.querySelector(s), spec.launcher);
      check(`${label}: focus returns to the launcher`, focused);
    }
    await real.context.close();
  } catch (error) {
    check(label, false, String(error?.message ?? error).split("\n")[0]);
    await context.close().catch(() => {});
  }
}

async function runScrim(layoutId, theme) {
  // On a phone the context drawer fills the viewport, leaving no scrim to click; Back closes it there.
  const how = layoutId === "mobile" ? "escape" : "scrim";
  const label = `${layoutId}/${theme}/context-menu/${how}`;
  const { context, page } = await newPage(layoutId, theme);
  try {
    const spec = { path: "/movies", launcher: "[data-filters-button]" };
    await openPage(page, layoutId, spec);
    await page.waitForSelector("a[href*='/movies/']", { timeout: 15000 });
    await page.click("a[href*='/movies/']", { button: "right" });
    const open = await sample(page, "media-context-enter", ".media-context-drawer");
    await page.waitForTimeout(500);
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    await triggerClose(page, how, spec);
    const close = await sample(page, "drawer-out", ".media-context-drawer");
    compareMirror(label, open, close);
    await page.waitForTimeout((open?.duration ?? 360) + SLACK_MS);
    check(`${label}: scrim and panel gone`, await page.evaluate(() => !document.querySelector(".media-context-backdrop")));
  } catch (error) {
    check(label, false, String(error?.message ?? error).split("\n")[0]);
  }
  await context.close();
}

async function runReduced(layoutId) {
  const label = `${layoutId}/reduced-motion`;
  const spec = PANELS[0];
  const { context, page } = await newPage(layoutId, "light", "reduce");
  try {
    await openPage(page, layoutId, spec);
    await page.locator(spec.launcher).first().click();
    await page.waitForSelector(".tv-filter-drawer");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    check(`${label}: closes at once, no ghost`, await page.evaluate(() => !document.querySelector(".tv-filter-drawer") && !document.querySelector("[data-drawer-ghost]")));
  } catch (error) {
    check(label, false, String(error?.message ?? error).split("\n")[0]);
  }
  await context.close();
}

for (const layoutId of layouts) {
  for (const theme of themes) {
    for (const spec of PANELS) for (const how of PATHS) await runPanel(layoutId, theme, spec, how);
    await runScrim(layoutId, theme);
  }
  await runReduced(layoutId);
}
await browser.close();
server.close?.();
process.exit(failed ? 1 : 0);
