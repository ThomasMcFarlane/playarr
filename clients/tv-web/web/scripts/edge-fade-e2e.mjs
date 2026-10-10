#!/usr/bin/env node
// The one scroll-edge fade (docs/design/page-layout.md, spec Q6), checked on pixels in both themes:
//   node scripts/edge-fade-e2e.mjs [--dist dir] [--theme light|dark] [--out dir]
//  1. Profile. A probe scroller carrying the shared fade attributes is rendered and screenshotted; the coverage of its
//     content along the fade must be smooth (no step above 0.09 per pixel: no hard edge), monotonic, still visible at
//     the very edge (floor, so content can be seen going off screen) and full in the middle. The rail variant has a
//     clear left gutter (floor 0) and the same soft right fade. Both axes, both themes.
//  2. First paint. A Home rail that overflows already carries the fade the first time it is observed in the DOM,
//     and nothing in the page draws a fade through a pseudo-element box any more.
//  3. No box. In the real rail, the empty padding above the cards at the right edge is exactly the page background
//     (the mask touches content only, there is no overlay tint).
//  4. Unclipped shadow. The focused card's lift and soft shadow fit inside the scroller on every side, and the pixel
//     rows across the scroller's bottom edge show no cut (no step) under the focused card.
//  5. Page bodies under the header. Every vertical page scroller, scrolled, carries the top fade; where it extends under
//     the page header, nothing of it paints inside the header band (pixel compare with the scroller hidden). At rest
//     there is no fade. 1920x1080 and 1280x720.
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The same Playwright (and browser build) as the layout parity job.
const { chromium } = await import(pathToFileURL(join(root, "../../../scripts/parity/node_modules/playwright-core/index.mjs")).href);
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const DIST = opt("dist", join(root, "dist"));
const OUT = opt("out", "");
if (OUT) mkdirSync(OUT, { recursive: true });
const THEMES = opt("theme", "") ? [opt("theme", "")] : ["light", "dark"];
const USER_ID = "00000000-0000-4000-8000-000000000001";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
};

// PNG decode without a dependency: use the page itself (createImageBitmap) to read pixels.
const pixels = (page, png, rect) => page.evaluate(async ({ b64, rect }) => {
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height);
  return { w: bmp.width, h: bmp.height, data: Array.from(d.data) };
}, { b64: png.toString("base64"), rect });

const server = await startServer({ distDir: DIST, seasons: 3, seasonEpisodes: 14, canDownload: false, onDeck: 30, movies: 300, series: 80, watchlist: 40, playlists: 24, playlistItems: 10 });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch();

for (const theme of THEMES) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(({ base, userId, theme }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
    localStorage.setItem("playarr-theme", theme);
    // First paint: record the fade state the first time an overflowing rail is seen in the DOM.
    window.__firstSeen = null;
    new MutationObserver(() => {
      if (window.__firstSeen) return;
      const rail = [...document.querySelectorAll(".tv-media-track-scroll")].find((r) => r.scrollWidth > r.clientWidth + 8);
      if (rail) {
        window.__firstSeen = "pending";
        // The next animation frame runs just before the paint that first shows the populated rail.
        requestAnimationFrame(() => {
          window.__firstSeen = { end: rail.dataset.fadeEnd !== undefined, axis: rail.dataset.fadeAxis ?? null, mask: getComputedStyle(rail).webkitMaskImage };
        });
      }
    }).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = theme; });
  }, { base, userId: USER_ID, theme });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".tv-media-track-scroll .tv-home-card");
  await page.waitForTimeout(1500);

  // 2. First paint.
  const seen = await page.evaluate(() => window.__firstSeen ?? "none");
  check(`${theme}: overflowing rail has the fade the first time it is seen`, !!seen && seen.end && seen.axis === "x" && seen.mask !== "none", JSON.stringify(seen));
  const legacy = await page.evaluate(() => {
    const sel = [".tv-scroll-edge-window", ".tv-media-track-window.can-scroll-right", ".calendar-edge-window-x", "[class*='can-scroll-']"];
    return sel.filter((s) => document.querySelector(s));
  });
  check(`${theme}: no legacy fade implementation in the DOM`, legacy.length === 0, legacy.join(","));

  // 1. Profile, on a probe so the content under the fade is uniform.
  for (const variant of [
    { name: "default x", axis: "x", style: "", w: 600, h: 120 },
    { name: "rail x", axis: "x", style: "--edge-fade-start-size:150px;--edge-fade-start-floor:0;", w: 600, h: 120 },
    { name: "default y", axis: "y", style: "", w: 240, h: 500 },
  ]) {
    const probe = await page.evaluate(({ v }) => {
      document.getElementById("__probe")?.remove();
      const bgc = getComputedStyle(document.body).backgroundColor;
      const holder = document.createElement("div");
      holder.id = "__probe";
      holder.style.cssText = `position:fixed;left:200px;top:100px;z-index:99999;width:${v.w}px;height:${v.h}px;background:${bgc};`;
      const dark = document.documentElement.dataset.theme === "dark";
      const scroller = document.createElement("div");
      scroller.setAttribute("data-fade-axis", v.axis);
      scroller.setAttribute("data-fade-start", "");
      scroller.setAttribute("data-fade-end", "");
      scroller.style.cssText = `width:100%;height:100%;${v.style}`;
      const body = document.createElement("div");
      body.style.cssText = `width:${v.axis === "x" ? 3000 : v.w}px;height:${v.axis === "x" ? v.h : 3000}px;background:${dark ? "#fff" : "#000"};`;
      scroller.appendChild(body);
      holder.appendChild(scroller);
      document.body.appendChild(holder);
      return { dark };
    }, { v: variant });
    const shot = await page.screenshot({ clip: { x: 200, y: 100, width: variant.w, height: variant.h } });
    if (OUT) await page.screenshot({ path: join(OUT, `${theme}-probe-${variant.name.replace(" ", "-")}.png`), clip: { x: 200, y: 100, width: variant.w, height: variant.h } });
    const img = await pixels(page, shot);
    const idx = (x, y) => (y * img.w + x) * 4 + 1;
    const bg = probe.dark ? img.data[idx(img.w - 1, 0)] : img.data[idx(0, 0)];
    void bg;
    const contentG = probe.dark ? 255 : 0;
    const pageG = probe.dark ? 0x13 : 0xf5;
    const len = variant.axis === "x" ? img.w : img.h;
    const at = (i) => variant.axis === "x" ? img.data[idx(i, Math.floor(img.h / 2))] : img.data[idx(Math.floor(img.w / 2), i)];
    const cover = Array.from({ length: len }, (_, i) => Math.min(1, Math.max(0, (at(i) - pageG) / (contentG - pageG))));
    const step = Math.max(...cover.slice(1).map((c, i) => Math.abs(c - cover[i])));
    const startEdge = cover[0];
    const endEdge = cover[len - 1];
    const mid = cover[Math.floor(len / 2)];
    const label = `${theme}: ${variant.name}`;
    check(`${label}: no hard edge (max step ${step.toFixed(3)} <= 0.09)`, step <= 0.09, `step=${step}`);
    check(`${label}: end edge is soft, content still visible (coverage ${endEdge.toFixed(2)} in 0.15..0.55)`, endEdge >= 0.15 && endEdge <= 0.55, `end=${endEdge}`);
    check(`${label}: middle is full`, mid >= 0.97, `mid=${mid}`);
    if (variant.name === "rail x") check(`${label}: left gutter clears to nothing (${startEdge.toFixed(2)})`, startEdge <= 0.05, `start=${startEdge}`);
    else check(`${label}: start edge is soft (${startEdge.toFixed(2)} in 0.15..0.55)`, startEdge >= 0.15 && startEdge <= 0.55, `start=${startEdge}`);
    const bump = cover.slice(1, Math.min(len, 160)).some((c, i) => c + 0.02 < cover[i]);
    check(`${label}: start ramp is monotonic`, !bump);
    await page.evaluate(() => document.getElementById("__probe")?.remove());
  }

  // 3. No box in the real rail, 4. unclipped shadow.
  const geo = await page.evaluate(() => {
    const rail = document.querySelector(".tv-media-track-scroll");
    const r = rail.getBoundingClientRect();
    return { right: r.right, top: r.top, bottom: r.bottom, left: r.left, end: rail.dataset.fadeEnd !== undefined };
  });
  const bgShot = await page.screenshot({ clip: { x: geo.right - 40, y: geo.top + 2, width: 32, height: 6 } });
  const bgImg = await pixels(page, bgShot);
  // The same patch with the mask switched off: the fade must not have added any tint of its own.
  await page.addStyleTag({ content: "[data-fade-axis]{-webkit-mask-image:none!important;mask-image:none!important}" }).then(async (tag) => {
    globalThis.__noMask = tag;
  });
  const pageShot = await page.screenshot({ clip: { x: geo.right - 40, y: geo.top + 2, width: 32, height: 6 } });
  const pageImg = await pixels(page, pageShot);
  await globalThis.__noMask.evaluate((el) => el.remove());
  const avg = (img) => [0, 1, 2].map((c) => img.data.filter((_, i) => i % 4 === c).reduce((a, b) => a + b, 0) / (img.data.length / 4));
  const a = avg(bgImg); const b = avg(pageImg);
  check(`${theme}: rail right padding carries no overlay tint, no box (delta ${Math.max(...a.map((v, i) => Math.abs(v - b[i]))).toFixed(1)})`, a.every((v, i) => Math.abs(v - b[i]) <= 6), `rail=${a} page=${b}`);

  for (let i = 0; i < 4; i += 1) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(120); }
  await page.waitForTimeout(900);
  const focus = await page.evaluate(() => {
    const card = document.querySelector(".tv-media-track-scroll .tv-home-card.is-selected") ?? document.querySelector("[data-remote-active]");
    const rail = card?.closest(".tv-media-track-scroll");
    if (!card || !rail) return null;
    const art = card.querySelector(".tv-home-card-art") ?? card;
    const cs = getComputedStyle(art);
    const shadows = cs.boxShadow.split(/,(?![^(]*\))/).map((s) => s.trim()).map((s) => {
      const n = [...s.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
      return { x: n[0] ?? 0, y: n[1] ?? 0, blur: n[2] ?? 0, spread: n[3] ?? 0 };
    });
    const a = art.getBoundingClientRect();
    const s = rail.getBoundingClientRect();
    return {
      art: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
      rail: { left: s.left, right: s.right, top: s.top, bottom: s.bottom },
      shadows,
      transform: cs.transform,
      hasShadow: cs.boxShadow !== "none",
    };
  });
  check(`${theme}: a card is focused with a soft shadow`, !!focus && focus.hasShadow, JSON.stringify(focus));
  if (focus) {
    const down = Math.max(...focus.shadows.map((s) => s.y + s.blur + s.spread));
    const up = Math.max(...focus.shadows.map((s) => s.blur + s.spread - s.y), 0);
    check(`${theme}: shadow fits below the card (${down}px needed, ${(focus.rail.bottom - focus.art.bottom).toFixed(0)}px available)`, focus.rail.bottom - focus.art.bottom >= down, JSON.stringify(focus));
    check(`${theme}: lift and shadow fit above the card (${up}px needed, ${(focus.art.top - focus.rail.top).toFixed(0)}px available)`, focus.art.top - focus.rail.top >= up, JSON.stringify(focus));
    // Pixel check across the scroller's bottom edge under the card: no cut.
    const cx = Math.round((focus.art.left + focus.art.right) / 2);
    const y0 = Math.round(focus.rail.bottom) - 4;
    const strip = await page.screenshot({ clip: { x: cx - 3, y: y0, width: 6, height: 8 } });
    const sImg = await pixels(page, strip);
    const row = (r) => [0, 1, 2].map((c) => sImg.data[(r * sImg.w + 2) * 4 + c]);
    const above = row(3); const below = row(4);
    const cut = Math.max(...above.map((v, i) => Math.abs(v - below[i])));
    check(`${theme}: no cut across the scroller bottom edge (step ${cut})`, cut <= 3, `above=${above} below=${below}`);
    if (OUT) await page.screenshot({ path: join(OUT, `${theme}-home-rail.png`), clip: { x: 0, y: Math.max(0, focus.rail.top - 40), width: 1920, height: Math.min(1080, focus.rail.bottom - focus.rail.top + 80) } });
  }

  // Library grid: the bottom fade exists while content continues, and a vertical probe is checked above.
  await page.goto(`${base}/movies`);
  await page.waitForSelector(".tv-title-grid .tv-title-card");
  await page.waitForTimeout(1200);
  const grid = await page.evaluate(() => {
    const g = document.querySelector(".tv-title-grid");
    return { end: g.dataset.fadeEnd !== undefined, axis: g.dataset.fadeAxis, mask: getComputedStyle(g).webkitMaskImage !== "none" };
  });
  check(`${theme}: library grid has the bottom fade at first paint`, grid.end && grid.axis === "y" && grid.mask, JSON.stringify(grid));
  if (OUT) await page.screenshot({ path: join(OUT, `${theme}-library.png`) });

  // 5. Page bodies never render under the page header, and fade out below it once scrolled.
  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    for (const url of ["/settings", "/watchlist", "/playlists", "/movies"]) {
      const label = `${theme} ${size.width}: ${url}`;
      await page.goto(`${base}${url}`);
      await page.waitForTimeout(1200);
      const keys = await page.evaluate(() => [...document.querySelectorAll("[data-tv-scroll-container][data-tv-scroll-axis='vertical']:not(.app-main)")]
        .filter((e) => e.scrollHeight > e.clientHeight + 40).map((e, i) => { e.dataset.probeScroller = String(i); return i; }));
      if (url === "/settings") check(`${label}: has an overflowing scroller to test`, keys.length > 0, "none");
      for (const key of keys) {
        const sel = `[data-probe-scroller="${key}"]`;
        await page.evaluate((s) => { document.querySelector(s).scrollTop = 0; }, sel);
        await page.waitForTimeout(250);
        const rest = await page.evaluate((s) => { const e = document.querySelector(s); return { start: e.dataset.fadeStart !== undefined }; }, sel);
        check(`${label} #${key}: no top fade at rest`, !rest.start, JSON.stringify(rest));
        await page.evaluate((s) => { document.querySelector(s).scrollTop = 400; }, sel);
        await page.waitForFunction((s) => document.querySelector(s).dataset.fadeStart !== undefined, sel, { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(400);
        const m = await page.evaluate((s) => {
          const e = document.querySelector(s);
          const box = e.getBoundingClientRect();
          const header = e.closest("[data-page-id]")?.querySelector(".page-header");
          let clear = 0; let left = Infinity; let right = -Infinity;
          for (const part of header?.querySelectorAll("button, a, h1, .page-header-detail") ?? []) {
            const r = part.getBoundingClientRect();
            if (!r.width || !r.height || r.right <= box.left || r.left >= box.right || r.bottom <= box.top) continue;
            clear = Math.max(clear, r.bottom - box.top); left = Math.min(left, r.left); right = Math.max(right, r.right);
          }
          const cs = getComputedStyle(e);
          return { start: e.dataset.fadeStart !== undefined, mask: (cs.webkitMaskImage || cs.maskImage) !== "none", clear, left, right, top: box.top, boxLeft: box.left, boxRight: box.right };
        }, sel);
        check(`${label} #${key}: top fade present when scrolled`, m.start && m.mask, JSON.stringify(m));
        if (m.clear > 0) {
          const x = Math.max(0, Math.floor(Math.max(m.left, m.boxLeft)));
          const w = Math.max(1, Math.floor(Math.min(m.right, m.boxRight, size.width) - x));
          const y = Math.max(0, Math.floor(m.top));
          const h = Math.max(1, Math.floor(Math.min(m.clear, size.height - y)) - 1);
          await page.addStyleTag({ content: ".page-header,.app-clock,.page-header *{visibility:hidden!important}" }).then((tag) => { globalThis.__hide = tag; });
          const shown = await pixels(page, await page.screenshot({ clip: { x, y, width: w, height: h } }));
          await page.evaluate((s) => { document.querySelector(s).style.visibility = "hidden"; }, sel);
          const hidden = await pixels(page, await page.screenshot({ clip: { x, y, width: w, height: h } }));
          await page.evaluate((s) => { document.querySelector(s).style.visibility = ""; }, sel);
          await globalThis.__hide.evaluate((el) => el.remove());
          let worst = 0;
          for (let i = 0; i < shown.data.length; i += 1) worst = Math.max(worst, Math.abs(shown.data[i] - hidden.data[i]));
          check(`${label} #${key}: nothing of the body paints under the header (${w}x${h}px band, max diff ${worst})`, worst <= 2, `diff=${worst}`);
          if (OUT) await page.screenshot({ path: join(OUT, `${theme}-${size.width}-${url.replace("/", "")}-scrolled.png`) });
        }
      }
    }
  }
  // 6. Rails run to the true right edge. The scroller's clip box ends at the stage's right edge (no negative margin
  //    pulling it short), and the rightmost 24px of the row has no hard luminance step (cards fade out under the mask).
  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    let seriesHref = null;
    for (const url of ["/", "series"]) {
      const label = `${theme} ${size.width}: ${url === "/" ? "Home" : "Series detail"}`;
      if (url === "/") await page.goto(`${base}/`);
      else {
        await page.goto(`${base}/series`);
        await page.waitForSelector("a[href*='/series/']");
        seriesHref = await page.evaluate(() => document.querySelector("a[href*='/series/']").getAttribute("href"));
        await page.goto(`${base}${seriesHref}`);
      }
      await page.waitForSelector("[data-tv-scroll-axis=horizontal] a, [data-tv-scroll-axis=horizontal] button");
      await page.waitForTimeout(1800);
      const rails = await page.evaluate(() => [...document.querySelectorAll("[data-tv-scroll-axis=horizontal]")]
        .filter((r) => r.scrollWidth > r.clientWidth + 8 && r.getBoundingClientRect().width > 200)
        .map((r, i) => { r.dataset.probeRail = String(i); const b = r.getBoundingClientRect(); return { i, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; }));
      check(`${label}: has overflowing rails to test`, rails.length > 0, "none");
      for (const rail of rails.slice(0, 2)) {
        const stageRight = await page.evaluate(() => document.documentElement.clientWidth);
        check(`${label}: rail ${rail.i} clip box ends at the stage's right edge`, Math.abs(rail.right - stageRight) <= 1, `right=${rail.right} stage=${stageRight}`);
        // Pixel strip across the card row, rightmost 24px of the rail.
        const { y, cards } = await page.evaluate((i) => {
          const r = document.querySelector(`[data-probe-rail="${i}"]`);
          const all = [...r.querySelectorAll("a,button")].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 40);
          const b = all[0];
          return { y: Math.round(b.top + b.height * 0.4), cards: all.map((c) => [c.left, c.right]) };
        }, rail.i);
        const shot = await page.screenshot({ clip: { x: stageRight - 24, y, width: 24, height: 6 } });
        const px = await pixels(page, shot);
        const lum = [];
        for (let x = 0; x < px.w; x += 1) {
          let sum = 0;
          for (let row = 0; row < px.h; row += 1) { const o = (row * px.w + x) * 4; sum += 0.2126 * px.data[o] + 0.7152 * px.data[o + 1] + 0.0722 * px.data[o + 2]; }
          lum.push(sum / px.h);
        }
        let step = 0;
        // Steps across the gap between two cards are layout, not an edge: only count steps inside one card.
        const x0 = stageRight - 24;
        for (let x = 1; x < lum.length; x += 1) {
          if (!cards.some(([l, r]) => x0 + x - 1 > l + 1 && x0 + x < r - 1)) continue;
          step = Math.max(step, Math.abs(lum[x] - lum[x - 1]));
        }
        check(`${label}: rail ${rail.i} has no hard edge in the last 24px`, step <= 0.09 * 255, `max step ${step.toFixed(1)} lum=${lum.map((v) => v.toFixed(0)).join(",")}`);
        if (OUT) await page.screenshot({ path: join(OUT, `${theme}-${size.width}-${url === "/" ? "home" : "series"}-rail${rail.i}-right.png`), clip: { x: stageRight - 400, y: rail.top, width: 400, height: Math.min(300, rail.bottom - rail.top) } });
      }
    }
  }
  await context.close();
}

await browser.close();
await server.close?.();
console.log(failed === 0 ? "\nedge fade: all checks passed" : `\nedge fade: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
