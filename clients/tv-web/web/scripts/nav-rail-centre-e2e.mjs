#!/usr/bin/env node
// The shared rail stack (Home's rails, a show's seasons, a playlist and its sub-playlists) centres the focused rail exactly, whatever keys got it there.
//
// Owner bug (9 Oct 2026): on a series page, Down then Up overshot the rail until a Left/Right corrected it, because
// the centre target was computed from a rail position mid-glide. After every sequence below (single presses, a
// reverse press, double presses, rapid presses) the focused rail's centre must sit on the stack's centre within 2 px
// (or the stack is clamped at its first or last position).
//
//   node scripts/nav-rail-centre-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 40, series: 12, seasons: 4, seasonEpisodes: 10, playlists: 4, playlistItems: 12, nestedPlaylists: true });

const SEQUENCES = [
  ["Down", ["ArrowDown"], 0],
  ["Down, Up", ["ArrowDown", "ArrowUp"], 60],
  ["Down, Down, Up, Up", ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"], 60],
  ["Down, Up quickly", ["ArrowDown", "ArrowUp"], 25],
  // A reverse press inside the 320 ms window in which real focus trails the marker: the stale focus must not drag the
  // stack back to the rail the marker already left.
  ["Down, Up within the focus trail", ["ArrowDown", "ArrowUp"], 160],
  ["Down, Down, Up within the focus trail", ["ArrowDown", "ArrowDown", "ArrowUp"], 200],
  ["rapid zig-zag", ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowDown", "ArrowUp", "ArrowUp", "ArrowDown"], 40],
];

/** How far the focused track's centre is from the stack's centre, and whether the stack is clamped. */
const measure = (page, stackSelector) =>
  page.evaluate((selector) => {
    const stack = document.querySelector(selector);
    const active = document.querySelector("[data-remote-active]") ?? document.activeElement;
    const track = active?.closest?.(".tv-media-track");
    if (!stack || !track) return null;
    const s = stack.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    const max = stack.scrollHeight - stack.clientHeight;
    return {
      off: t.top + t.height / 2 - (s.top + s.height / 2),
      clamped: stack.scrollTop <= 0.5 || stack.scrollTop >= max - 0.5,
      track: track.dataset.tvTrackId,
    };
  }, stackSelector);

async function run(name, path, stackSelector, size) {
  for (const [label, keys, gap] of SEQUENCES) {
    const { context, page, errors } = await open(path, size);
    await page.waitForSelector(`${stackSelector} .tv-media-track`);
    await page.waitForTimeout(1500);
    // Park focus on a card inside the stack, then start from the first rail.
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(900);
    // Every frame's scroll offset, from the first key on, to catch a glide that leaves its destination and comes back.
    await page.evaluate((selector) => {
      const stack = document.querySelector(selector);
      const rec = (window.__rc = { frames: [], lastKey: null });
      addEventListener("keydown", () => { rec.lastKey = performance.now(); }, true);
      const tick = () => { rec.frames.push([performance.now(), stack.scrollTop]); rec.raf = requestAnimationFrame(tick); };
      tick();
    }, stackSelector);
    for (const key of keys) {
      await page.keyboard.press(key);
      if (gap) await page.waitForTimeout(gap);
      else await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1200);
    const rec = await page.evaluate(() => { cancelAnimationFrame(window.__rc.raf); return window.__rc; });
    // After the last key the stack only moves toward its final offset: never away from it, never past it (overshoot).
    const final = rec.frames.at(-1)[1];
    // The key's own glide begins once the page has handled it (a queued move, a slow frame): judge from 120 ms on. The
    // stale focus this guards against lands 320 ms after the key it trails.
    const after = rec.frames.filter(([t]) => t >= (rec.lastKey ?? 0) + 120).map(([, v]) => v);
    const dist = after.map((v) => Math.abs(v - final));
    const backwards = dist.filter((d, i) => i > 0 && d > dist[i - 1] + 2).length;
    const start = after[0];
    const passed = after.filter((v) => (start < final ? v > final + 2 : v < final - 2)).length;
    check(`${name} ${size.width}x${size.height}, ${label}: after the last key the stack never moves away from, or past, its destination`, backwards <= 1 && passed === 0, `${backwards} frames moving away, ${passed} past the destination`);
    const m = await measure(page, stackSelector);
    const ok = m !== null && (m.clamped || Math.abs(m.off) <= 2);
    check(`${name} ${size.width}x${size.height}, ${label}: focused rail centred (off ${m ? m.off.toFixed(1) : "?"} px, rail ${m?.track}${m?.clamped ? ", clamped" : ""})`, ok, JSON.stringify(m));
    check(`${name} ${size.width}x${size.height}, ${label}: no page errors`, errors.length === 0, errors.join(";"));
    await context.close();
  }
}

/**
 * Owner report (10 Oct 2026): "after navigating to a new track, when I navigate between items (LEFT/RIGHT along that
 * rail), it readjusts the track vertically." Down to a new rail, then Right x5 and Left x3: the stack's scroll offset and
 * transform are identical (within 0.5 px) on every frame from the moment the rail has been centred.
 */
async function hold(name, path, stackSelector, size, theme) {
  const { context, page, errors } = await open(path, { ...size, theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForSelector(`${stackSelector} .tv-media-track`);
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(1000);
  await page.evaluate((selector) => {
    const stack = document.querySelector(selector);
    const rec = (window.__hold = { frames: [] });
    const tick = () => {
      rec.frames.push([stack.scrollTop, getComputedStyle(stack).transform, stack.getBoundingClientRect().top]);
      rec.raf = requestAnimationFrame(tick);
    };
    tick();
  }, stackSelector);
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft", "ArrowLeft"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(600);
  const rec = await page.evaluate(() => { cancelAnimationFrame(window.__hold.raf); return window.__hold; });
  const tops = rec.frames.map((f) => f[0]);
  const spread = Math.max(...tops) - Math.min(...tops);
  const transforms = new Set(rec.frames.map((f) => f[1]));
  const rects = rec.frames.map((f) => f[2]);
  const rectSpread = Math.max(...rects) - Math.min(...rects);
  check(`${name} ${size.width}x${size.height} ${theme}: Right x5 and Left x3 never move the stack vertically (scroll spread ${spread.toFixed(2)} px over ${tops.length} frames)`, spread <= 0.5 && transforms.size === 1 && rectSpread <= 0.5, `scroll ${spread}, transforms ${[...transforms].join("|")}, rect ${rectSpread}`);
  check(`${name} ${size.width}x${size.height} ${theme}: no page errors`, errors.length === 0, errors.join(";"));
  await context.close();
}

/**
 * Owner answer (10 Oct 2026): the re-adjustment shows in a desktop browser, on the first Left/Right moves after landing on
 * a new rail. Two causes to rule out: (A) a stationary mouse pointer resting over the stack, which Chrome treats as
 * hovering whatever card scrolls under it, and (B) Right pressed while the vertical glide of the Down is still in flight.
 * Frames are recorded from the Down on: the stack only moves toward its final position (never back, never past), the
 * final position is the centre of the rail, and a card other than the focused one never lifts under the parked pointer.
 */
async function inflight(name, path, stackSelector, size, { gap, mouse }) {
  const label = `${name} ${size.width}x${size.height}, ${mouse ? "mouse parked, " : ""}Right ${gap} ms after Down`;
  const { context, page, errors } = await open(path, size);
  await page.waitForSelector(`${stackSelector} .tv-media-track`);
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  if (mouse) await page.mouse.move(size.width * 0.68, size.height * 0.5);
  await page.evaluate((selector) => {
    const stack = document.querySelector(selector);
    const rec = (window.__fl = { frames: [], lifted: 0 });
    const tick = () => {
      rec.frames.push(stack.scrollTop);
      rec.raf = requestAnimationFrame(tick);
    };
    tick();
  }, stackSelector);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(gap);
  for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(700);
  const rec = await page.evaluate(() => { cancelAnimationFrame(window.__fl.raf); return window.__fl; });
  // Settled: a lifted card that is neither the marker nor the focused one is a hover taking effect during keys.
  const liftedCards = await page.evaluate(() =>
    [...document.querySelectorAll(".tv-home-card, .tv-episode-card")].filter((card) => {
      const t = getComputedStyle(card).transform;
      return t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)" && !card.hasAttribute("data-remote-active") && !card.matches(":focus-visible");
    }).map((c) => `${String(c.className).replace(/media-card /, "")} hover=${c.matches(":hover")} focus=${c.matches(":focus-visible")} marker=${document.body.hasAttribute("data-remote-marker")}`)
  );
  rec.lifted = liftedCards.length;
  rec.liftedDetail = liftedCards.join("; ");
  const final = rec.frames.at(-1);
  const dist = rec.frames.map((v) => Math.abs(v - final));
  const away = dist.filter((d, i) => i > 0 && d > dist[i - 1] + 2).length;
  const settledAt = dist.findIndex((d, i) => dist.slice(i).every((x) => x <= 0.5));
  const m = await measure(page, stackSelector);
  check(`${label}: the stack moves only toward its final position (${away} frames away from it)`, away === 0, `${away} frames moving away from ${final}`);
  check(`${label}: it ends centred on the rail (off ${m ? m.off.toFixed(1) : "?"} px) and stays there`, m !== null && (m.clamped || Math.abs(m.off) <= 2) && settledAt >= 0, JSON.stringify(m));
  if (mouse) check(`${label}: a parked pointer lifts no card besides the focused one`, rec.lifted === 0, `${rec.lifted} lifted cards besides the focused one: ${rec.liftedDetail}`);
  check(`${label}: no page errors`, errors.length === 0, errors.join(";"));
  await context.close();
}

/** The active rail's heading changes colour only: its box inside its track is constant from the Down through 700 ms. */
async function headingCalm(name, path, stackSelector, size, theme) {
  const { context, page, errors } = await open(path, { ...size, theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForSelector(`${stackSelector} .tv-media-track`);
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const rec = (window.__hc = { frames: [], active: 0 });
    const tick = () => {
      const track = (document.querySelector("[data-remote-active]") ?? document.activeElement)?.closest?.(".tv-media-track");
      const h = track?.querySelector(".tv-media-track-heading h2");
      if (h) {
        const a = h.getBoundingClientRect();
        const t = track.getBoundingClientRect();
        rec.frames.push([a.top - t.top, a.left - t.left, a.width, a.height, track.className.includes("is-active") ? 1 : 0, track.dataset.tvTrackId]);
      }
      rec.raf = requestAnimationFrame(tick);
    };
    tick();
  });
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(900);
  const rec = await page.evaluate(() => { cancelAnimationFrame(window.__hc.raf); return window.__hc; });
  // From the frame the new rail owns the marker on: the heading box inside the track never changes.
  const firstOfNew = rec.frames.findIndex((f, i) => i > 0 && f[5] !== rec.frames[0][5]);
  const frames = rec.frames.slice(Math.max(0, firstOfNew));
  const spread = [0, 1, 2, 3].map((k) => Math.max(...frames.map((f) => f[k])) - Math.min(...frames.map((f) => f[k])));
  check(`${name} ${size.width}x${size.height} ${theme}: the active rail heading never moves or scales (spreads ${spread.map((v) => v.toFixed(2)).join(" / ")} px over ${frames.length} frames)`, frames.length > 10 && spread.every((v) => v <= 0.5), JSON.stringify(spread));
  if (name === "Home") check(`${name} ${size.width}x${size.height} ${theme}: the new rail became active (is-active)`, frames.some((f) => f[4] === 1));
  check(`${name} ${size.width}x${size.height} ${theme}: no page errors`, errors.length === 0, errors.join(";"));
  await context.close();
}

const probe = await open("/");
const seriesId = await probe.page.evaluate(async () => {
  const response = await fetch("/api/v1/catalog?kind=series&limit=1", { headers: { authorization: "Bearer t" } });
  return (await response.json()).items[0].id;
});
await probe.context.close();

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  await run("Home", "/", ".tv-home-rails", size);
  await run("Playlist", "/playlists?playlist=00000000-0000-4000-8000-000000000100", ".tv-rail-surface.is-vertical-tracks", size);
  await run("Series", `/series/${seriesId}`, ".tv-series-browser", size);
  for (const [name, path, sel] of [["Home", "/", ".tv-home-rails"], ["Series", `/series/${seriesId}`, ".tv-series-browser"]]) {
    for (const gap of [50, 100, 200, 300]) await inflight(name, path, sel, size, { gap, mouse: false });
    await inflight(name, path, sel, size, { gap: 700, mouse: true });
    await inflight(name, path, sel, size, { gap: 100, mouse: true });
  }
  for (const [name, path, sel] of [["Home", "/", ".tv-home-rails"], ["Series", `/series/${seriesId}`, ".tv-series-browser"]]) {
    await headingCalm(name, path, sel, size, "dark");
  }
  for (const theme of ["dark", "light"]) {
    await hold("Home", "/", ".tv-home-rails", size, theme);
    await hold("Series", `/series/${seriesId}`, ".tv-series-browser", size, theme);
  }
}
await finish();
