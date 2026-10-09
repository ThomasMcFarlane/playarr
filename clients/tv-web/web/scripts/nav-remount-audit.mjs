#!/usr/bin/env node
// Navigation remount/flash audit. Records, per frame, what the page shows, then derives mounts of the page root,
// content->blank->content flashes, skeleton kind and API request log. Prints JSON per flow (use --json file).
//   node scripts/nav-remount-audit.mjs [--no-build] [--dist dir] [--out file] [--delay ms]
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
import { boot, opt } from "./e2e-common.mjs";

export const RECORDER = () => {
  const w = window;
  w.__rec = { frames: [], mounts: [], t0: performance.now() };
  const main = () => document.querySelector(".app-main");
  const snap = () => {
    const m = main();
    if (!m) return null;
    const page = m.querySelector("[data-page-id]");
    const skeleton = m.querySelector(".skeleton-state");
    const cards = m.querySelectorAll(".tv-title-card, .tv-home-card, .tv-search-result, .calendar-entry:not(.calendar-entry-skeleton), [data-media-file-id]").length;
    const detailCopy = Boolean(m.querySelector(".tv-detail-copy"));
    return {
      t: Math.round(performance.now() - w.__rec.t0),
      path: location.pathname + location.search,
      pageId: page?.getAttribute("data-page-id") ?? null,
      pageNode: page ? (page.__aid ??= ++w.__aid) : 0,
      skeleton: skeleton ? [...skeleton.classList].find((c) => c.startsWith("is-")) : null,
      cards,
      detailCopy,
      text: (m.innerText ?? "").trim().length,
      scroll: m.scrollTop,
    };
  };
  w.__aid = 0;
  const tick = () => {
    const s = snap();
    if (s) w.__rec.frames.push(s);
    w.__raf = requestAnimationFrame(tick);
  };
  w.__raf = requestAnimationFrame(tick);
  new MutationObserver((list) => {
    for (const r of list) for (const n of r.removedNodes) {
      if (n.nodeType === 1 && (n.matches?.("[data-page-id]") || n.querySelector?.("[data-page-id]"))) {
        w.__rec.mounts.push({ t: Math.round(performance.now() - w.__rec.t0), removed: n.getAttribute?.("data-page-id") ?? "child" });
      }
    }
    for (const r of list) for (const n of r.addedNodes) {
      if (n.nodeType === 1 && (n.matches?.("[data-page-id]") || n.querySelector?.("[data-page-id]"))) {
        w.__rec.mounts.push({ t: Math.round(performance.now() - w.__rec.t0), added: n.getAttribute?.("data-page-id") ?? "child" });
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
};

export const STOP = () => {
  cancelAnimationFrame(window.__raf);
  return window.__rec;
};

/** Reduce frames to phases: content | skeleton:<kind> | blank, then count flashes. */
export function analyse(rec) {
  const phase = (f) => (f.skeleton ? `skeleton:${f.skeleton}` : f.cards > 0 || f.detailCopy || f.text > 120 ? "content" : "blank");
  const seq = [];
  for (const f of rec.frames) {
    const p = `${f.pageId ?? "-"}|${phase(f)}`;
    if (!seq.length || seq[seq.length - 1].p !== p) seq.push({ p, t: f.t, path: f.path });
  }
  // A flash: the same page id shows content, then skeleton/blank, then content again.
  let flashes = 0;
  const last = {};
  for (let i = 0; i < seq.length; i++) {
    const [id, ph] = seq[i].p.split("|");
    if (ph === "content") {
      const prev = last[id];
      if (prev !== undefined && prev.nonContentBetween) flashes++;
      last[id] = { i, nonContentBetween: false };
    } else if (last[id]) last[id].nonContentBetween = true;
  }
  const blanks = rec.frames.filter((f) => phase(f) === "blank").length;
  const pageNodes = new Set(rec.frames.map((f) => f.pageNode).filter(Boolean)).size;
  return { seq: seq.map((s) => `${s.t}:${s.p}`), flashes, blankFrames: blanks, pageNodes, mounts: rec.mounts.length, frames: rec.frames.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const delay = Number(opt("delay", "250"));
  const { open, finish } = await boot({ movies: 120, series: 40, artists: 0, detailDelayMs: delay, onDeck: 4, seasons: 3, watchlist: 0 }, { realisticAuth: !args.includes('--no-cache') });
  const results = [];
  const only = opt("only", "");
  const FLOWS = [
    // [name, startPath, steps(page, mode)]
    ["library-movies>detail>back", "/movies", "[data-library-index]", (p, m) => openFirst(p, m, ".tv-title-card"), "back"],
    ["library-series>detail>back", "/series", "[data-library-index]", (p, m) => openFirst(p, m, ".tv-title-card"), "back"],
    ["home>detail>back", "/", "[data-page-id]", (p, m) => openFirst(p, m, ".tv-home-card"), "back"],
    ["search>detail>back", "/search?q=a", ".tv-title-card, [data-search-result]", (p, m) => openFirst(p, m, ".tv-search-result"), "back"],
    ["calendar>detail", "/calendar", "[data-page-id='calendar']", (p, m) => openFirst(p, m, ".calendar-entry:not(.calendar-entry-skeleton) a, a.calendar-entry"), null],
    ["nav-sections", "/movies", "[data-library-index]", navSections, null],
  ];
  async function openFirst(page, mode, sel) {
    if (!(await page.locator(sel).count())) { console.log("   (no target for " + sel + ")"); return; }
    if (mode === "click") await page.locator(sel).first().click({ timeout: 4000 }).catch(() => page.locator(sel).first().evaluate((el) => el.click()));
    else {
      await page.locator(sel).first().focus();
      await page.keyboard.press("Enter");
    }
  }
  async function navSections(page, mode) {
    for (const href of ["/series", "/", "/movies", "/calendar"]) {
      if (mode === "click") await page.locator(`.app-nav a[href='${href}']`).first().click();
      else await page.evaluate((h) => document.querySelector(`.app-nav a[href='${h}']`)?.focus(), href), await page.keyboard.press("Enter");
      await page.waitForTimeout(1200);
    }
  }
  for (const [name, start, ready, act, back] of FLOWS) {
    if (only && !name.includes(only)) continue;
    for (const [w, h] of [[1920, 1080], [1280, 720]]) for (const theme of ["dark", "light"]) for (const mode of ["keyboard", "click"]) {
      const { context, page } = await open(start, { width: w, height: h, theme });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.waitForSelector(ready, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      const reqs = [];
      page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) reqs.push(`${Math.round(performance.now())}:${r.method()} ${u.pathname}${u.search}`); });
      await page.evaluate(RECORDER);
      await act(page, mode);
      await page.waitForTimeout(1500);
      let backReqs = 0;
      if (back) {
        reqs.push("--- back");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(1500);
      }
      const rec = await page.evaluate(STOP);
      const a = analyse(rec);
      const dup = Object.entries(reqs.reduce((m, r) => { const k = r.split(":").slice(1).join(":"); m[k] = (m[k] ?? 0) + 1; return m; }, {})).filter(([, n]) => n > 1);
      results.push({ flow: name, size: `${w}x${h}`, theme, mode, ...a, reqCount: reqs.length, dup, reqs });
      console.log(`${name} ${w} ${theme} ${mode}: flashes=${a.flashes} blank=${a.blankFrames} pageNodes=${a.pageNodes} pageMounts=${a.mounts} reqs=${reqs.length} dup=${JSON.stringify(dup)}\n   ${a.seq.join("  ")}`);
      await context.close();
    }
  }
  const o = opt("out", "");
  if (o) writeFileSync(o, JSON.stringify(results, null, 1));
  await finish();
}
