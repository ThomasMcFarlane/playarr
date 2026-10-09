#!/usr/bin/env node
// Motion checks (owner ruling 8 October 2026): focus-driven scrolling is animated, not a snap.
// After one arrow press, the scroll position of every scroller is sampled each frame; a scroller that moved must
// move monotonically over several distinct frames (never one jump). Also checks a held key converges on the newest
// focus without a backlog, and that reduced motion jumps straight there.
//   node scripts/motion-e2e.mjs [--dist dir] [--width 1280] [--height 720] [--throttle 1]
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./chromium-launch.mjs";
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
const browser = await launchChromium();

async function open(path, { reducedMotion = "no-preference", origin = base } = {}) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, reducedMotion });
  await context.addInitScript(({ base, userId }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
  }, { base: origin, userId: USER_ID });
  const page = await context.newPage();
  await page.goto(`${origin}${path}`);
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

{ // Route transitions: the page body fades and rises in; the header and shell stay put; Back reverses it.
  const { context, page } = await open("/movies");
  await page.waitForSelector("[data-library-index]");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  const watch = () => page.evaluate(() => {
    window.__route = { frames: [], headerOpacity: [], navMoved: false, done: false };
    const nav = document.querySelector(".app-nav");
    const navTop = nav?.getBoundingClientRect().top;
    const start = performance.now();
    const tick = () => {
      const running = document.getAnimations().find((a) => a.animationName?.startsWith("route-enter"));
      if (running) {
        const target = running.effect.target;
        const cs = getComputedStyle(target);
        const matrix = cs.transform === "none" ? 0 : Number(cs.transform.match(/matrix.*\((.*)\)/)[1].split(",")[5]);
        window.__route.frames.push({ name: running.animationName, opacity: Number(cs.opacity), y: matrix });
      }
      const header = document.querySelector(".app-main .page-header");
      if (header) window.__route.headerOpacity.push(Number(getComputedStyle(header).opacity));
      if (nav && Math.abs(nav.getBoundingClientRect().top - navTop) > 0.5) window.__route.navMoved = true;
      if (performance.now() - start < 700) requestAnimationFrame(tick); else window.__route.done = true;
    };
    requestAnimationFrame(tick);
  });
  const result = () => page.evaluate(async () => { while (!window.__route.done) await new Promise((r) => setTimeout(r, 20)); return window.__route; });
  await watch();
  await page.keyboard.press("Enter");
  const forward = await result();
  const fo = forward.frames.map((f) => f.opacity);
  check("route: forward transition animates the page body (>= 4 distinct opacity steps, rising)", new Set(fo.map((v) => v.toFixed(2))).size >= 4 && fo.every((v, i) => i === 0 || v >= fo[i - 1] - 0.001), JSON.stringify(fo.map((v) => +v.toFixed(2))));
  check("route: forward rises (starts below, ends at rest)", forward.frames.length > 0 && forward.frames[0].y > 0 && forward.frames[0].name.includes("forward"), JSON.stringify(forward.frames[0]));
  check("route: header never fades and the nav rail never moves", forward.headerOpacity.every((v) => v === 1) && !forward.navMoved, JSON.stringify({ header: [...new Set(forward.headerOpacity)], nav: forward.navMoved }));
  await page.waitForTimeout(300);
  await watch();
  await page.goBack();
  const back = await result();
  const bo = back.frames.map((f) => f.opacity);
  check("route: Back plays the reverse direction (settles downwards)", back.frames.length > 0 && back.frames[0].y < 0 && back.frames[0].name.includes("back"), JSON.stringify(back.frames[0]));
  check("route: Back also eases (>= 4 distinct opacity steps)", new Set(bo.map((v) => v.toFixed(2))).size >= 4, JSON.stringify(bo.map((v) => +v.toFixed(2))));
  await context.close();
}
{ // Reduced motion: route change is instant.
  const { context, page } = await open("/movies", { reducedMotion: "reduce" });
  await page.waitForSelector("[data-library-index]");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  const seen = await page.evaluate(() => new Promise((resolve) => {
    const opacities = new Set();
    const start = performance.now();
    const tick = () => {
      for (const a of document.getAnimations()) if (a.animationName?.startsWith("route-enter")) opacities.add(getComputedStyle(a.effect.target).opacity);
      if (performance.now() - start < 400) requestAnimationFrame(tick); else resolve([...opacities]);
    };
    requestAnimationFrame(tick);
  }));
  check("route: reduced motion shows no mid-fade frames", seen.every((v) => Number(v) < 0.05 || Number(v) > 0.9), JSON.stringify(seen));
  await context.close();
}

// A small artist library: the frame-rate check judges the motion, not the software raster of 120 promoted 3D layers.
const cfServer = await startServer({ distDir: DIST, artists: 24, canDownload: false });
const cfBase = `http://127.0.0.1:${cfServer.port}`;
{ // Library cover flow (owner feedback 9 October 2026: a little too fast / jolty). One velocity-preserving glide, poses continuous.
  const { context, page } = await open("/music?view=cover-flow", { origin: cfBase });
  await page.waitForSelector(".is-cover-flow .tv-title-card");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(900);
  const pitch = await page.evaluate(() => {
    const c = document.querySelectorAll(".is-cover-flow .tv-title-card");
    return c[1].offsetLeft - c[0].offsetLeft;
  });
  // Per-frame scrollLeft, the pose (rotateY) of the cover arriving at centre, and the frame time. `presses` are
  // [delayMs, key] after recording starts. Returns the frames plus the performance.now() of every keydown.
  const flow = async (presses, ms) => {
    await page.evaluate((ms) => {
      const g = document.querySelector(".is-cover-flow .tv-title-grid");
      const cards = g.querySelectorAll(".tv-title-card");
      const first = cards[0];
      const pitch = cards[1].offsetLeft - first.offsetLeft;
      const centred = Math.round((g.scrollLeft + g.clientWidth / 2 - (first.offsetLeft + first.offsetWidth / 2)) / pitch);
      const target = g.querySelector(`[data-library-index="${centred + 1}"]`);
      const rec = { frames: [], keys: [], stamps: [], done: false };
      window.__cf = rec;
      if (!window.__cfKeys) { window.__cfKeys = true; window.addEventListener("keydown", () => window.__cf.keys.push(performance.now()), { capture: true }); }
      const t0 = performance.now();
      let last = t0;
      const tick = (now) => {
        const m = /rotateY\((-?[\d.]+)deg\)/.exec(target.style.transform);
        rec.frames.push({ t: now, dt: now - last, left: g.scrollLeft, rot: m ? Number(m[1]) : null });
        last = now;
        if (now - t0 < ms) requestAnimationFrame(tick); else rec.done = true;
      };
      requestAnimationFrame(tick);
      // Timestamps only, no reads: the frame rate is judged without the recorder's own style and scroll reads.
      const stamp = (now) => { rec.stamps.push(now); if (now - t0 < ms) requestAnimationFrame(stamp); };
      requestAnimationFrame(stamp);
    }, ms);
    for (const [delay, key] of presses) {
      if (delay) await page.waitForTimeout(delay);
      await page.keyboard.press(key);
    }
    await page.waitForFunction(() => window.__cf.done, null, { timeout: 20000 });
    return page.evaluate(() => window.__cf);
  };
  const steps = (frames) => frames.slice(1).map((f, i) => f.left - frames[i].left);
  const startOf = (frames) => frames.findIndex((f, i) => i > 0 && f.left !== frames[0].left);
  const settleMs = (frames) => {
    const endLeft = frames[frames.length - 1].left;
    const first = startOf(frames);
    const reached = frames.findIndex((f, i) => i >= first && Math.abs(f.left - endLeft) < 0.5);
    return first < 0 || reached < 0 ? Infinity : frames[reached].t - frames[first - 1].t;
  };

  // 1. One step: monotonic, calm duration, no frame jump, pose follows the scroll continuously.
  // The fps case judges the motion's own cost. The static decoration (reflection, soft shadow, dimming filter, artwork)
  // is software-rastered on a CPU-only runner and holds a headless browser near 15 to 30 fps whatever the motion does,
  // so it is switched off while frames are timed; the geometry, poses and scrolling are untouched.
  await page.addStyleTag({ content: ".is-cover-flow .tv-title-card-art { -webkit-box-reflect: none !important; box-shadow: none !important; } .is-cover-flow .tv-title-card-art img { display: none !important; } .is-cover-flow .tv-title-card { filter: none !important; }" });
  const one = await flow([[0, "ArrowRight"]], 1000);
  const oneSteps = steps(one.frames);
  const travel = one.frames[one.frames.length - 1].left - one.frames[0].left;
  const oneMs = settleMs(one.frames);
  check("coverflow: one step travels one card", Math.abs(travel - pitch) <= 3, `${travel} vs pitch ${pitch}`);
  check("coverflow: position is monotonic per step", oneSteps.every((d) => d >= -0.01), JSON.stringify(oneSteps.map((d) => +d.toFixed(1))));
  check("coverflow: step takes 300-480 ms (calm, not sluggish)", oneMs >= 300 && oneMs <= 480, `${Math.round(oneMs)} ms`);
  // The ease-out peaks at 2x travel/duration. Frame timestamps and the engine's write can fall on either side of a
  // recorder callback on a slow host, so judge windows of at least 80 ms, not single frames.
  let worst = 0;
  for (let i = 0; i < one.frames.length; i += 1) {
    const j = one.frames.findIndex((f, k) => k > i && f.t - one.frames[i].t >= 80);
    if (j < 0) break;
    const w = one.frames[j].t - one.frames[i].t;
    worst = Math.max(worst, (one.frames[j].left - one.frames[i].left) / travel / (w / 380));
  }
  check("coverflow: no frame-to-frame jump (peak speed over any 80 ms window <= 2.4x the mean)", worst <= 2.4, `${worst.toFixed(2)}x`);
  const rots = one.frames.map((f) => f.rot).filter((v) => v !== null);
  check("coverflow: neighbour rotation interpolates continuously (>= 4 distinct values, monotonic)", new Set(rots.map((v) => v.toFixed(2))).size >= 4 && monotonic(rots), JSON.stringify(rots.map((v) => +v.toFixed(1))));
  await page.waitForTimeout(700);

  // 2. Rapid presses retarget from the current position and speed: no reset, no velocity jump.
  const rapid = await flow([[0, "ArrowRight"], [110, "ArrowRight"], [110, "ArrowRight"]], 1400);
  const rs = steps(rapid.frames);
  check("coverflow: rapid presses never move backwards (no reset to the start)", rs.every((d) => d >= -0.01), JSON.stringify(rs.map((d) => +d.toFixed(1))));
  const rapidTravel = rapid.frames[rapid.frames.length - 1].left - rapid.frames[0].left;
  check("coverflow: three presses travel three cards", Math.abs(rapidTravel - 3 * pitch) <= 6, `${rapidTravel} vs ${3 * pitch}`);
  let jump = 0;
  for (const key of rapid.keys.slice(-2)) {
    const at = rapid.frames.findIndex((f) => f.t >= key);
    const lefts = (from, to) => {
      const a = rapid.frames.findLast((f) => f.t <= from) ?? rapid.frames[0];
      const b = rapid.frames.find((f) => f.t >= to) ?? rapid.frames[rapid.frames.length - 1];
      return (b.left - a.left) / Math.max(1, b.t - a.t);
    };
    if (at < 0) continue;
    const before = lefts(key - 120, key);
    const after = lefts(key, key + 120);
    jump = Math.max(jump, before > 0.02 ? after / before : 1);
  }
  // Continuing from the current speed raises it by at most ~1.7x (the glide accelerates into the longer remaining
  // travel); restarting the old 150 ms ease from the current position opens at about 8x.
  check("coverflow: a retarget keeps its speed (no restart: after/before <= 3)", jump <= 3, `${jump.toFixed(2)}x`);
  await page.waitForTimeout(700);

  // 3. Held key: ten fast presses converge on the newest target quickly and never run backwards.
  const held = await flow(Array.from({ length: 10 }, (_, i) => [i ? 55 : 0, "ArrowRight"]), 1800);
  const hs = steps(held.frames);
  const lastKey = held.keys[held.keys.length - 1];
  const endLeft = held.frames[held.frames.length - 1].left;
  const settled = held.frames.find((f) => f.t >= lastKey && Math.abs(f.left - endLeft) < 0.5);
  check("coverflow: held key never moves backwards", hs.every((d) => d >= -0.01), JSON.stringify(hs.map((d) => +d.toFixed(1))));
  check("coverflow: held key settles within 400 ms of the last press", settled !== undefined && settled.t - lastKey <= 400, settled ? `${Math.round(settled.t - lastKey)} ms` : "never settled");
  check("coverflow: held key travels ten cards", Math.abs(endLeft - held.frames[0].left - 10 * pitch) <= 10, `${endLeft - held.frames[0].left} vs ${10 * pitch}`);
  // Frame rate over the whole held run (the longest motion, about 100 frames): median frame time while it moves.
  const heldDts = held.stamps.slice(1).map((t, i) => t - held.stamps[i]).filter((_, i) => held.stamps[i] >= held.keys[0] && held.stamps[i] <= lastKey + 300).sort((a, b) => a - b);
  const medianDt = heldDts[Math.floor(heldDts.length / 2)] ?? Infinity;
  check("coverflow: >= 55 fps while moving at 1x CPU", THROTTLE > 1 || 1000 / medianDt >= 55, `${(1000 / medianDt).toFixed(1)} fps (median frame ${medianDt.toFixed(1)} ms over ${heldDts.length} frames)`);
  await context.close();
}
{ // Cover flow, reduced motion: the covers jump straight to the settled pose.
  const { context, page } = await open("/music?view=cover-flow", { reducedMotion: "reduce", origin: cfBase });
  await page.waitForSelector(".is-cover-flow .tv-title-card");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  const press = page.keyboard.press("ArrowRight");
  const lefts = await page.evaluate(() => new Promise((resolve) => {
    const g = document.querySelector(".is-cover-flow .tv-title-grid");
    const seen = new Set([g.scrollLeft]);
    const t0 = performance.now();
    const tick = () => { seen.add(g.scrollLeft); if (performance.now() - t0 < 500) requestAnimationFrame(tick); else resolve([...seen]); };
    requestAnimationFrame(tick);
  }));
  await press;
  check("coverflow: reduced motion shows at most the start and end positions", lefts.length <= 2, JSON.stringify(lefts));
  await context.close();
}

await browser.close();
server.close?.();
cfServer.close?.();
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
