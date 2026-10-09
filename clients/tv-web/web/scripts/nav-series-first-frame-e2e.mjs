#!/usr/bin/env node
// Opening a series from the Library paints its detail page complete in the first frame: no skeleton at all (movies
// never showed one), with the Resume button already in place. The series' resume plan is prefetched while the focus
// rests on the card, so by the time Enter is pressed it is in the query cache.
// The mock answers the resume plan after 700 ms, so without the prefetch the page holds a skeleton for that long.
// Keyboard only, 1920x1080 and 1280x720, both themes.
//   node scripts/nav-series-first-frame-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot(
  { movies: 24, series: 8, artists: 0, seasons: 2, detailDelayMs: 120, resumePlanDelayMs: 700 },
  { realisticAuth: true }
);

const RECORD = () => {
  const w = window;
  w.__f = { frames: [] };
  const tick = () => {
    const main = document.querySelector(".app-main") ?? document.body;
    w.__f.frames.push({
      skeleton: main.querySelectorAll("[class*='skeleton']").length,
      detail: Boolean(main.querySelector(".tv-detail-title")),
      resume: Boolean(main.querySelector("[data-resume-action]")),
    });
    w.__f.raf = requestAnimationFrame(tick);
  };
  tick();
};

// A throwaway visit first: the mock server and Chromium are cold on the very first detail open of a run, which shows a
// route-chunk skeleton that has nothing to do with the series data under test.
{
  const { context, page } = await open("/series", { width: 1280, height: 720 });
  await page.waitForSelector(".tv-title-card", { timeout: 8000 });
  await page.locator(".tv-title-card").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".tv-detail-title", { timeout: 8000 });
  await page.waitForTimeout(1500);
  await context.close();
}

for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  for (const theme of ["dark", "light"]) {
    const size = `${w}x${h} ${theme}`;
    const { context, page, errors } = await open("/series", { width: w, height: h, theme });
    if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.waitForSelector(".tv-title-card", { timeout: 8000 });
    await page.keyboard.press("ArrowRight");
    // Focus rests on the card: the detail and its resume plan are prefetched (the mock needs 120 ms and 700 ms).
    await page.waitForTimeout(2200);
    await page.evaluate(RECORD);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".tv-detail-title", { timeout: 8000 });
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.__f.raf);
      return window.__f.frames;
    });
    const first = frames.find((f) => f.detail);
    const skeletonFrames = frames.filter((f) => f.skeleton > 0).length;
    check(`series first frame ${size}: the detail page paints (${frames.length} frames recorded)`, Boolean(first));
    check(`series first frame ${size}: no skeleton frame while opening`, skeletonFrames === 0, `${skeletonFrames} frames with a skeleton`);
    check(`series first frame ${size}: the Resume button is in the first detail frame`, first?.resume === true, JSON.stringify(first));
    check(`series first frame ${size}: no page errors`, errors.length === 0, errors.join(";"));
    await context.close();
  }
}
await finish();
