#!/usr/bin/env node
// Opening and closing the Filters drawer must not move the library page at all (owner report, 8 October 2026:
// "opening/closing filters causes the library page to jump all over the place").
//
// For Movies and Series, in both themes at 1920x1080 and 1280x720, keyboard only: scroll the grid down a few rows,
// reach the Filters launcher, then record every animation frame across opening it (Enter) and closing it (Escape,
// then the launcher toggle). Across all frames the grid's scrollTop, the first visible card's rectangle, the grid,
// header and preview rectangles and the document width must not change, and the window must not scroll. Changing a
// filter value is allowed to move the grid and is not part of this test.
//
//   node scripts/nav-library-drawer-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 90, series: 60 });
const TOLERANCE_PX = 0.5;

const RECORD = () => {
  const frames = [];
  window.__frames = frames;
  window.__drawer = [];
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [b.left, b.top, b.width, b.height];
  };
  const tick = () => {
    const grid = document.querySelector(".tv-title-grid");
    const gridTop = grid?.getBoundingClientRect().top ?? 0;
    const first = [...document.querySelectorAll(".tv-title-card")].find((card) => {
      const b = card.getBoundingClientRect();
      return b.bottom > gridTop && b.top >= gridTop - 1;
    });
    frames.push({
      scrollTop: grid?.scrollTop ?? null,
      scrollLeft: grid?.scrollLeft ?? null,
      windowY: window.scrollY,
      width: document.documentElement.clientWidth,
      grid: rect(grid),
      first: first ? `${first.dataset.libraryIndex}:${rect(first).map((n) => n.toFixed(1)).join(",")}` : null,
      header: rect(document.querySelector(".page-header, .tv-page-header, header")),
      preview: rect(document.querySelector(".tv-library-preview")),
    });
    // The drawer as drawn: the live panel, or the closing ghost that replaces it.
    const panel = document.querySelector(".tv-filter-drawer");
    const b = panel?.getBoundingClientRect();
    window.__drawer.push({ t: performance.now(), present: Boolean(panel), left: b?.left ?? null, top: b?.top ?? null, width: b?.width ?? null, height: b?.height ?? null, opacity: panel ? Number(getComputedStyle(panel).opacity) : null });
    window.__raf = requestAnimationFrame(tick);
  };
  window.__raf = requestAnimationFrame(tick);
};

/** Distinct states across the frames, comparing rectangles within the tolerance. */
function movement(frames) {
  const base = frames[0];
  const moved = [];
  const differs = (a, b) =>
    Array.isArray(a) && Array.isArray(b) ? a.some((n, i) => Math.abs(n - b[i]) > TOLERANCE_PX) : a !== b;
  for (const key of ["scrollTop", "scrollLeft", "windowY", "width", "grid", "first", "header", "preview"]) {
    const bad = frames.filter((frame) => differs(frame[key], base[key]));
    if (bad.length) moved.push(`${key} (${bad.length} frames, e.g. ${JSON.stringify(base[key])} -> ${JSON.stringify(bad[0][key])})`);
  }
  return moved;
}

const onLauncher = (page) => page.evaluate(() => document.activeElement?.hasAttribute("data-filters-button") ?? false);

for (const kind of ["movies", "series"]) {
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    for (const theme of ["dark", "light"]) {
      const label = `${kind} ${width}x${height} ${theme}`;
      const { context, page, errors } = await open(`/${kind}`, { width, height, theme });
      try {
        await page.waitForSelector("[data-library-index]");
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
        // Scroll the grid down a few rows so a scroll reset or a jump to a card would show.
        for (let i = 0; i < 5; i += 1) {
          await page.keyboard.press("ArrowDown");
          await page.waitForTimeout(160);
        }
        await page.waitForTimeout(700);
        // Reach the launcher by keyboard: Right into the alphabet, then Up.
        for (let i = 0; i < 4; i += 1) {
          await page.keyboard.press("ArrowRight");
          await page.waitForTimeout(120);
        }
        for (let i = 0; i < 30 && !(await onLauncher(page)); i += 1) {
          await page.keyboard.press("ArrowUp");
          await page.waitForTimeout(120);
        }
        check(`${label}: launcher reached by keyboard`, await onLauncher(page));
        await page.waitForTimeout(800);
        await page.evaluate(RECORD);
        await page.keyboard.press("Enter");
        await page.waitForSelector(".tv-filter-drawer", { timeout: 5000 });
        await page.waitForTimeout(1000);
        await page.evaluate(() => { window.__mark = performance.now(); });
        // The close is checked on its own timeline, not the wall clock: pause the closing animation the moment it
        // starts and seek it to fixed points, so a loaded host cannot skew the sampled steps (it did: 0.43 of the width).
        await page.keyboard.press("Escape");
        const close = await page.evaluate(async () => {
          const find = () => document.getAnimations().find((a) => a.animationName === "drawer-out" && a.effect?.target?.matches?.(".tv-filter-drawer"));
          let animation = find();
          for (let i = 0; i < 40 && !animation; i += 1) {
            await new Promise((r) => requestAnimationFrame(r));
            animation = find();
          }
          if (!animation) return null;
          animation.pause();
          const target = animation.effect.target;
          const duration = animation.effect.getComputedTiming().duration;
          const rows = [];
          for (let i = 0; i <= 20; i += 1) {
            animation.currentTime = (duration * i) / 20;
            const b = target.getBoundingClientRect();
            rows.push({ t: (duration * i) / 20, left: b.left, top: b.top, width: b.width });
          }
          animation.finish();
          return rows;
        });
        check(`${label}: close animation found and sampled`, Boolean(close));
        if (close) {
          const lefts = close.map((d) => d.left);
          const width = close[0].width || 1;
          check(`${label}: close keeps the panel size and top`, close.every((d) => Math.abs(d.width - width) < 1 && Math.abs(d.top - close[0].top) < 1));
          const steps = lefts.map((l, i) => (i ? (l - lefts[i - 1]) / width : 0));
          check(`${label}: close slides right steadily, no step over 30% of the width`, lefts.every((l, i) => !i || l >= lefts[i - 1] - 0.5) && Math.max(...steps) <= 0.3, `max step ${Math.max(...steps).toFixed(2)}`);
          const at100 = close.find((d) => d.t >= 100);
          check(`${label}: close has visibly started after 100 ms`, !at100 || (at100.left - lefts[0]) / width >= 0.03, `${at100 ? ((at100.left - lefts[0]) / width).toFixed(3) : "-"}`);
        }
        await page.waitForTimeout(600);
        check(`${label}: drawer is gone after the close`, await page.evaluate(() => !document.querySelector(".tv-filter-drawer") && !document.querySelector("[data-drawer-ghost]")));
        // Toggle path: Enter on the launcher opens, Enter again closes.
        await page.keyboard.press("Enter");
        await page.waitForSelector(".tv-filter-drawer", { timeout: 5000 });
        await page.waitForTimeout(900);
        await page.evaluate(() => document.querySelector("[data-filters-button]")?.click());
        await page.waitForTimeout(1000);
        const frames = await page.evaluate(() => {
          cancelAnimationFrame(window.__raf);
          return window.__frames;
        });
        const moved = frames.length > 60 ? movement(frames) : [`only ${frames.length} frames recorded`];
        check(`${label}: ${frames.length} frames across open/close, grid scroll, grid, header and preview stay put`, moved.length === 0, moved.join("; "));
        check(`${label}: no page errors`, errors.length === 0, errors.join(";"));
      } catch (error) {
        check(label, false, String(error?.message ?? error).split("\n")[0]);
      }
      await context.close();
    }
  }
}

await finish();
