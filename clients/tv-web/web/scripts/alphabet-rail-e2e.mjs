#!/usr/bin/env node
// Library alphabet rail (owner 2026-10-10): ONE column of letters, scrolling vertically with the shared edge fade when
// the 44px letters do not fit, and the focused letter always scrolled into view.
//   node scripts/alphabet-rail-e2e.mjs [--dist dir] [--out dir]
// Movies, Series and Music, at 1920x1080 and 1280x720, in both themes, driven by the keyboard.
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(pathToFileURL(join(root, "../../../scripts/parity/node_modules/playwright-core/index.mjs")).href);
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt("out", "");
if (OUT) mkdirSync(OUT, { recursive: true });
const USER_ID = "00000000-0000-4000-8000-000000000001";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
};

const server = await startServer({ distDir: opt("dist", join(root, "dist")), movies: 300, series: 80, artists: 60, onDeck: 0 });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch();

const railState = () => {
  const nav = document.querySelector(".tv-alphabet");
  if (!nav) return null;
  const buttons = [...nav.querySelectorAll("button")];
  const rails = nav.getBoundingClientRect();
  const lefts = new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().left)));
  const a = document.activeElement;
  const inRail = a && nav.contains(a);
  const r = inRail ? a.getBoundingClientRect() : null;
  return {
    count: buttons.length,
    columns: lefts.size,
    minHeight: Math.min(...buttons.map((b) => b.getBoundingClientRect().height)),
    minWidth: Math.min(...buttons.map((b) => b.getBoundingClientRect().width)),
    overflow: nav.scrollHeight - nav.clientHeight,
    scrollTop: nav.scrollTop,
    fadeAxis: nav.dataset.fadeAxis ?? null,
    fadeStart: nav.dataset.fadeStart !== undefined,
    fadeEnd: nav.dataset.fadeEnd !== undefined,
    mask: getComputedStyle(nav).webkitMaskImage || getComputedStyle(nav).maskImage,
    focused: inRail ? a.textContent : null,
    focusedInView: inRail ? r.top >= rails.top - 0.5 && r.bottom <= rails.bottom + 0.5 : null,
    inViewport: rails.left >= 0 && rails.right <= innerWidth && rails.top >= 0 && rails.bottom <= innerHeight,
  };
};

// A key moves focus and starts a smooth scroll: wait (up to 5 s, the host may be busy) until the focused letter changed,
// is in view and the scroll settled.
const step = async (page, key, before) => {
  await page.keyboard.press(key);
  let prev = null;
  let s = null;
  for (let k = 0; k < 50; k += 1) {
    await page.waitForTimeout(100);
    s = await page.evaluate(railState);
    if (s.focused !== before && s.focusedInView && prev !== null && s.scrollTop === prev) break;
    prev = s.scrollTop;
  }
  return s;
};

for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  for (const theme of ["dark", "light"]) {
    for (const route of ["movies", "series", "music"]) {
      const tag = `${w}x${h} ${theme} /${route}`;
      const context = await browser.newContext({ viewport: { width: w, height: h } });
      await context.addInitScript(({ base, userId, theme }) => {
        localStorage.setItem("playarr:apiBaseUrl", base);
        const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
        localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
        localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
        localStorage.setItem("playarr-theme", theme);
        document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; });
      }, { base, userId: USER_ID, theme });
      const page = await context.newPage();
      await page.goto(`${base}/${route}`);
      await page.waitForSelector(".tv-alphabet button", { timeout: 10000 });
      await page.waitForTimeout(800);

      const first = await page.evaluate(railState);
      check(`${tag}: one column of letters`, first.columns === 1, `${first.columns} columns, ${first.count} letters`);
      check(`${tag}: every letter is at least 44x44`, first.minHeight >= 44 && first.minWidth >= 44, `${first.minWidth}x${first.minHeight}`);
      check(`${tag}: the rail sits inside the viewport`, first.inViewport);
      check(`${tag}: the column scrolls when the letters do not fit`, first.overflow > 0, `overflow ${first.overflow}`);
      // Owner 2026-10-10: the rail runs to the bottom of the stage like the library grid, and its bottom fade is the soft
      // mask with no straight line: no letter is cut by a clip edge above the screen bottom.
      const geo = await page.evaluate(() => {
        const n = document.querySelector(".tv-alphabet").getBoundingClientRect();
        const g = document.querySelector(".tv-title-grid").getBoundingClientRect();
        return { railBottom: n.bottom, gridBottom: g.bottom, railTop: n.top, railLeft: n.left, railRight: n.right };
      });
      check(`${tag}: the rail's bottom equals the grid's bottom`, Math.abs(geo.railBottom - geo.gridBottom) <= 2, JSON.stringify(geo));
      const shot = await page.screenshot({ clip: { x: geo.railLeft, y: geo.railTop, width: geo.railRight - geo.railLeft, height: geo.railBottom - geo.railTop } });
      const ink = await page.evaluate(async ({ b64, tops }) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        const lum = (x, y) => { const i = (y * bmp.width + x) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
        // Peak contrast of each 44px letter cell against the background beside it (the cell's padding column).
        return tops.map((top) => {
          let peak = 0;
          for (let y = Math.max(0, Math.round(top)); y < Math.min(bmp.height, Math.round(top) + 44); y += 1) {
            const bg = lum(1, y);
            for (let x = 8; x < bmp.width - 8; x += 1) peak = Math.max(peak, Math.abs(lum(x, y) - bg));
          }
          return peak;
        });
      }, { b64: shot.toString("base64"), tops: await page.evaluate(() => { const n = document.querySelector(".tv-alphabet").getBoundingClientRect(); return [...document.querySelectorAll(".tv-alphabet button")].map((b) => b.getBoundingClientRect().top - n.top); }) });
      const tops = await page.evaluate(() => { const n = document.querySelector(".tv-alphabet").getBoundingClientRect(); return [...document.querySelectorAll(".tv-alphabet button")].map((b) => b.getBoundingClientRect().top - n.top); });
      const visible = ink.map((peak, i) => ({ peak, top: tops[i] })).filter((l) => l.top >= 0 && l.top + 44 <= geo.railBottom - geo.railTop + 0.5);
      const lower = visible.slice(-5).map((l) => l.peak);
            check(`${tag}: the lowest letter is dimmer than the ones above (it fades toward the bottom edge)`, lower.at(-1) < Math.max(...lower) * 0.95, `peaks ${lower.map((v) => Math.round(v)).join(",")}`);
      // No hard stop in the mask: the gradient alpha never jumps by more than 0.3 (the eased ramp's steepest step is 0.24; a hard stop is 0.7 or more) between consecutive stops (the shared eased fade).
      const stops = first.mask ? [...first.mask.matchAll(/rgba?\(0, 0, 0(?:, ([\d.]+))?\)/g)].map((m) => (m[1] === undefined ? 1 : Number(m[1]))) : [];
      check(`${tag}: the fade mask has no hard stop (soft gradient, no straight line)`, stops.length >= 8 && stops.every((a, i) => i === 0 || Math.abs(a - stops[i - 1]) <= 0.3), JSON.stringify(stops));
      check(`${tag}: the bottom edge fade is present at first sight (no box, a mask)`, first.fadeAxis === "y" && first.fadeEnd && !first.fadeStart && first.mask && first.mask !== "none", JSON.stringify(first));

      // Keyboard only: focus the first letter, then walk down through all of them.
      await page.evaluate(() => document.querySelector(".tv-alphabet button")?.focus());
      let bad = 0;
      const misses = [];
      let last = await page.evaluate(railState);
      for (let i = 0; i < 26; i += 1) {
        const s = await step(page, "ArrowDown", last?.focused ?? "#");
        if (s.focused === null || !s.focusedInView) { bad += 1; misses.push(`${i}:${s.focused}:${s.focusedInView}:${s.scrollTop}`); }
        last = s;
      }
      check(`${tag}: the focused letter was in view after every key`, bad === 0 && last.focused === "Z", `${bad} misses (${misses.join(" ")}), focused ${last.focused}`);
      check(`${tag}: walking to the last letter scrolled the column, top fade on, bottom fade off (or within 8px of the end)`, last.scrollTop > 0 && last.fadeStart && (!last.fadeEnd || last.overflow - last.scrollTop <= 8) && last.columns === 1, JSON.stringify(last));
      if (OUT) await page.screenshot({ path: join(OUT, `alphabet-${route}-${w}-${theme}-end.png`) });

      for (let i = 0; i < 26; i += 1) {
        const s = await step(page, "ArrowUp", last.focused);
        if (s.focused === null || !s.focusedInView) { bad += 1; misses.push(`${i}:${s.focused}:${s.focusedInView}:${s.scrollTop}`); }
        last = s;
      }
      check(`${tag}: walking back up keeps the focused letter in view`, bad === 0 && (last.focused === "#" || last.focused === "A"), `${bad} misses (${misses.join(" ")}), focused ${last.focused}`);
      if (OUT) await page.screenshot({ path: join(OUT, `alphabet-${route}-${w}-${theme}-start.png`) });
      await context.close();
    }
  }
}
await browser.close();
await server.close?.();
console.log(failed === 0 ? "alphabet rail e2e: all passed" : `alphabet rail e2e: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
