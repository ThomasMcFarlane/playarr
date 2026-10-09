#!/usr/bin/env node
// Home navigation speed (owner bug, 9 Oct 2026): moving between rails and between cards must feel instant.
//
//  - A rail change (ArrowUp/ArrowDown) starts gliding to the vertical centre in the key's own frame and settles
//    in about 200 ms. It never waits for real DOM focus (which trails the remote marker by 320 ms), a data
//    request (the mock answers detail requests after 900 ms to prove it) or a layout re-measure, and rapid
//    presses retarget the one running glide.
//  - The left panel (genre line, title, synopsis) shows the focused card within a frame of the key, from the card
//    data already loaded. It never blanks, never replays its enter animation and never renders an older card
//    after a newer one.
//
//   node scripts/nav-home-speed-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ detailDelayMs: 900, movies: 60, series: 30 });
/** Frames, not milliseconds, for "within a frame": a frame count does not stretch on a loaded CI runner. */
const START_MAX_FRAMES = 4;
const TEXT_MAX_FRAMES = 2;
/** Key to settled, wall clock. The glide is 180 ms; the rest is slack for a loaded runner. */
const SETTLE_MAX_MS = 330;

const INSTALL = () => {
  const rails = document.querySelector(".tv-home-rails");
  const s = (window.__home = { keys: [], scroll: [], text: [], blanks: 0, dimmed: 0, frame: 0 });
  const tick = () => {
    s.frame += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  let lastTop = rails.scrollTop;
  s.times = [];
  const sample = (t) => {
    s.times.push(t);
    if (Math.abs(rails.scrollTop - lastTop) > 0.01) {
      s.scroll.push({ t, top: rails.scrollTop, frame: s.frame });
      lastTop = rails.scrollTop;
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  const read = () => {
    const root = document.querySelector(".tv-home-feature");
    return { h: root?.querySelector("h2")?.textContent ?? "", p: root?.querySelector("p:not(.tv-provider)")?.textContent ?? "", node: root, opacity: root ? Number(getComputedStyle(root).opacity) : 0 };
  };
  let last = read();
  new MutationObserver(() => {
    const now = read();
    if (now.node !== last.node) s.remounts = (s.remounts ?? 0) + 1;
    if (now.h === last.h && now.p === last.p) return;
    if (!now.h || !now.p) s.blanks += 1;
    if (now.opacity < 0.99) s.dimmed += 1;
    s.text.push({ h: now.h, t: performance.now(), frame: s.frame });
    last = now;
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
  addEventListener(
    "keydown",
    (e) => {
      if (e.key.startsWith("Arrow")) s.keys.push({ key: e.key, t: performance.now(), frame: s.frame });
    },
    true
  );
};

const markedTitle = (page) =>
  page.evaluate(() => (document.querySelector("[data-remote-active]") ?? document.activeElement)?.querySelector?.("strong")?.textContent ?? null);

async function session(size, fn) {
  const { context, page, errors } = await open("/", size);
  await page.waitForSelector(".tv-home-card");
  await page.waitForTimeout(1200);
  // Enter remote mode with a first move, then let everything settle before measuring.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(900);
  await page.evaluate(INSTALL);
  await page.waitForTimeout(300);
  await fn(page);
  const data = await page.evaluate(() => window.__home);
  check(`${size.width}: no page errors`, errors.length === 0, errors.join(";"));
  await context.close();
  return data;
}

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  const tag = `${size.width}x${size.height}`;
  // Rail changes, one at a time, with the glide allowed to finish between presses.
  const rail = await session(size, async (page) => {
    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(900);
    }
  });
  const bursts = [];
  for (const k of rail.keys) {
    const next = rail.keys.find((x) => x.t > k.t)?.t ?? Infinity;
    const samples = rail.scroll.filter((s) => s.t >= k.t && s.t < Math.min(next, k.t + 450));
    if (!samples.length) continue;
    // A busy shared host stalls the page for hundreds of ms; a press whose window had a frame gap over 60 ms
    // measures the host, not the app, and is skipped (at least one press must be clean).
    const window = rail.times.filter((t) => t >= k.t && t <= k.t + 400);
    if (window.some((t, i) => i > 0 && t - window[i - 1] > 60)) continue;
    const startFrames = samples[0].frame - k.frame;
    const settledAt = samples[samples.length - 1].t - k.t;
    bursts.push({ startFrames, settledAt });
  }
  check(`${tag}: rail changes measured on a healthy page (${bursts.length} of ${rail.keys.length})`, bursts.length >= 1, JSON.stringify(bursts));
  const worstStart = Math.max(...bursts.map((b) => b.startFrames));
  const worstSettle = Math.max(...bursts.map((b) => b.settledAt));
  check(`${tag}: rail glide starts within ${START_MAX_FRAMES} frames of the key (worst ${worstStart})`, worstStart <= START_MAX_FRAMES, String(worstStart));
  check(`${tag}: rail settles within ${SETTLE_MAX_MS} ms of the key (worst ${Math.round(worstSettle)} ms)`, worstSettle <= SETTLE_MAX_MS, String(worstSettle));

  // Rapid rail presses retarget the one glide: it still converges on the newest rail within one glide of the last key.
  const rapid = await session(size, async (page) => {
    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowDown", "ArrowDown"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(700);
  });
  const last = rapid.keys[rapid.keys.length - 1];
  const tail = rapid.scroll[rapid.scroll.length - 1];
  const lastWindow = rapid.times.filter((t) => t >= last.t && t <= last.t + 450);
  const janky = lastWindow.some((t, i) => i > 0 && t - lastWindow[i - 1] > 60);
  check(`${tag}: rapid rail presses settle within ${SETTLE_MAX_MS} ms of the last key${janky ? " (host stalled, skipped)" : ""}`, janky || (tail && tail.t - last.t <= SETTLE_MAX_MS), `${tail ? Math.round(tail.t - last.t) : "none"}`);

  // Sideways moves: the panel follows within a frame, in order, never blank, never remounted.
  for (const [label, count, gap] of [["single presses", 6, 500], ["rapid taps", 14, 45]]) {
    let finalTitle = null;
    const data = await session(size, async (page) => {
      for (let i = 0; i < count; i += 1) {
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(gap);
      }
      await page.waitForTimeout(700);
      finalTitle = await markedTitle(page);
    });
    const lags = [];
    for (const change of data.text) {
      const key = [...data.keys].reverse().find((k) => k.t <= change.t);
      if (key) lags.push(change.frame - key.frame);
    }
    const worst = lags.length ? Math.max(...lags) : Infinity;
    check(`${tag} ${label}: ${lags.length} panel updates, worst key-to-text ${worst} frames (<= ${TEXT_MAX_FRAMES})`, lags.length > 0 && worst <= TEXT_MAX_FRAMES, String(worst));
    check(`${tag} ${label}: panel ends on the focused card`, data.text.length > 0 && data.text[data.text.length - 1].h === finalTitle, `${data.text[data.text.length - 1]?.h} vs ${finalTitle}`);
    // A newer card's text must never be followed by an older card's: the titles only move forward along the rail.
    const order = data.text.map((c) => c.h);
    const seen = new Set();
    let repeats = 0;
    for (const h of order) {
      if (seen.has(h)) repeats += 1;
      seen.add(h);
    }
    check(`${tag} ${label}: no older card rendered after a newer one`, repeats === 0, order.join(" | "));
    check(`${tag} ${label}: panel is never blank`, data.blanks === 0, String(data.blanks));
    check(`${tag} ${label}: panel does not replay its fade-in`, data.dimmed === 0, String(data.dimmed));
    check(`${tag} ${label}: panel is never remounted`, !data.remounts, String(data.remounts));
  }
}

await finish();
