#!/usr/bin/env node
// Repeatable remote-navigation perf harness for the real Playarr web screens.
//
//   node scripts/nav-perf.mjs                       # build, run all screens x {4,20,50}x throttle
//   node scripts/nav-perf.mjs --screens movies --throttle 20 --profile
//   node scripts/nav-perf.mjs --no-build --check     # fail (exit 1) when budgets are missed
//
// Serves dist/ plus a deterministic mock API (1,746 movies / 944 series by
// default), drives Chromium at 3840x2160 with CDP CPU throttling, fires remote
// key presses at a fixed cadence WITHOUT waiting for the page (so a slow
// handler builds a queue, like a held remote button), and records key ->
// next-frame latency (event.timeStamp to the first task after the following
// rAF) plus long tasks.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";
import { summariseCpuProfile, summariseTrace } from "./nav-perf/analyse.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const SCREENS = opt("screens", "home,movies,series,search").split(",");
const THROTTLES = opt("throttle", "4,20,50").split(",").map(Number);
const KEYS = Number(opt("keys", 60));
const INTERVAL_MS = Number(opt("interval", 100));
const RUNS = Number(opt("runs", 1));
const WARMUP = Number(opt("warmup", 8));
const WIDTH = Number(opt("width", 3840));
const HEIGHT = Number(opt("height", 2160));
const DPR = Number(opt("dpr", 1));
const DIST = opt("dist", join(root, "dist"));
const OUT = opt("out", join(root, "nav-perf-results"));
const PLATFORM = opt("platform", "web");
const BUDGET = { 4: 50, 20: 100, 50: 250 }; // p95 key->frame ms
const PREFIX = `http://127.0.0.1`;

if (!flag("no-build") && !opt("dist", "")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!existsSync(join(DIST, "index.html"))) throw new Error(`${DIST}/index.html missing; run without --no-build`);

const USER_ID = "00000000-0000-4000-8000-000000000001";

// Browse-like walks that stay inside the content (no excursions to the nav /
// alphabet); edge transitions are covered by the *-edges screens below.
const D = "ArrowDown", U = "ArrowUp", L = "ArrowLeft", R = "ArrowRight";
const GRID_KEYS = [D, D, R, D, D, L, D, D, R, U, D, L];
const RAIL_KEYS = [R, R, R, R, D, R, R, L, L, L, L, D, R, R, R, L, U, L, L, U];

const screenDefs = {
  home: { path: "/", ready: ".tv-stage, [data-tv-focusable], a[href^='/movies/'], a[href^='/series/']", keys: RAIL_KEYS },
  movies: { path: "/movies", ready: "[data-library-index]", keys: GRID_KEYS },
  "movies-edges": { path: "/movies", ready: "[data-library-index]", keys: [D, D, R, R, R, L, L, L, D, D, L, R, D, R, R, L, L, L] },
  floor: { path: "/__floor.html", ready: "#c a", keys: GRID_KEYS },
  series: { path: "/series", ready: "[data-library-index]", keys: GRID_KEYS },
  search: {
    path: "/search",
    ready: "input",
    keys: GRID_KEYS,
    async prepare(page) {
      await page.locator("input").first().fill("e");
      await page.waitForSelector("a[href^='/search/']", { timeout: 15_000 });
      await page.waitForTimeout(500);
    },
  },
};

const INSTRUMENT = `(() => {
  const s = (window.__navPerf = { samples: [], longTasks: [], pending: [], scheduled: false });
  addEventListener("keydown", (e) => {
    s.pending.push(e.timeStamp);
    if (s.scheduled) return;
    s.scheduled = true;
    requestAnimationFrame(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        const now = performance.now();
        for (const t of s.pending) s.samples.push(now - t);
        s.pending = [];
        s.scheduled = false;
      };
      ch.port2.postMessage(0);
    });
  }, true);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) s.longTasks.push(e.duration);
  }).observe({ type: "longtask", buffered: true });
})();`;

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function runOne(browser, base, name, throttle, { profile }) {
  const def = screenDefs[name];
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: DPR,
    reducedMotion: "no-preference",
  });
  await context.addInitScript(
    ({ base, userId }) => {
      try {
        localStorage.setItem("playarr:apiBaseUrl", base);
        const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
        const profile = { profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "nav-perf-device", session };
        if (!localStorage.getItem("playarr.profileSessions.v4")) {
          localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([profile]));
          localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
        }
      } catch {}
    },
    { base, userId: USER_ID }
  );
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}${def.path}${PLATFORM === "web" ? "" : `?platform=${PLATFORM}`}`);
  await page.waitForSelector(def.ready, { timeout: 30_000 });
  if (def.prepare) await def.prepare(page);
  if (opt("css", "")) await page.addStyleTag({ content: opt("css", "") }); // experiment: inject CSS overrides
  await page.waitForTimeout(1500);
  const cdp = await context.newCDPSession(page);
  // Land focus on the first card, then settle before measuring.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(800);

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  // Warm-up under throttle: first frames after enabling it are not representative.
  const press = (key) => {
    const base = { key, code: key, windowsVirtualKeyCode: { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key] };
    // Deliberately not awaited: a blocked main thread must queue keys.
    void cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }).catch(() => {});
    void cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }).catch(() => {});
  };
  for (let i = 0; i < WARMUP; i += 1) {
    press(def.keys[i % def.keys.length]);
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  await page.waitForTimeout(1500 * Math.max(1, throttle / 10));
  await page.evaluate(() => { window.__navPerf.samples.length = 0; window.__navPerf.longTasks.length = 0; });
  if (profile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
    await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.invalidationTracking", "blink", "cc", "gpu"] });
  }

  await cdp.send("Performance.enable");
  const metricsOf = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const metricsStart = await metricsOf();
  const sequence = Array.from({ length: KEYS }, (_, i) => def.keys[i % def.keys.length]);
  const sent = [];
  await new Promise((resolve) => {
    let i = 0;
    const timer = setInterval(() => {
      if (i >= sequence.length) {
        clearInterval(timer);
        return resolve();
      }
      const key = sequence[i++];
      press(key);
      sent.push(key);
    }, INTERVAL_MS);
  });
  // Drain: wait until every key has produced a sample.
  const deadline = Date.now() + 120_000;
  let samples;
  while (Date.now() < deadline) {
    samples = await page.evaluate(() => window.__navPerf.samples.slice());
    if (samples.length >= sequence.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const metricsEnd = await metricsOf();
  // Main-thread cost per key, converted to unthrottled-equivalent ms.
  const perKey = (name) => (((metricsEnd[name] - metricsStart[name]) * 1000) / sequence.length / throttle);
  const cost = {
    taskMs: perKey("TaskDuration"),
    scriptMs: perKey("ScriptDuration"),
    layoutMs: perKey("LayoutDuration"),
    styleMs: perKey("RecalcStyleDuration"),
  };
  let analysis = null;
  if (profile) {
    const trace = await browser.stopTracing();
    const { profile: cpu } = await cdp.send("Profiler.stop");
    analysis = { cpu: summariseCpuProfile(cpu), trace: summariseTrace(JSON.parse(trace.toString())) };
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, `${name}-${throttle}x.trace.json`), trace);
    await writeFile(join(OUT, `${name}-${throttle}x.cpuprofile`), JSON.stringify(cpu));
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  // Functional check: the element that holds (virtual or real) focus must be on screen.
  await page.waitForTimeout(700);
  if (flag("screenshot")) {
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, `${name}-${throttle}x.png`) });
  }
  const focusState = await page.evaluate(() => {
    const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
    if (!el || el === document.body) return { ok: false, reason: "no focused element" };
    const r = el.getBoundingClientRect();
    const ok = r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    return { ok, reason: ok ? "" : `focused element off-screen (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`, tag: el.className?.toString().slice(0, 40) };
  });
  const longTasks = await page.evaluate(() => window.__navPerf.longTasks.slice());
  const domNodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  await context.close();

  if (flag("dump")) console.log(`samples ${name} ${throttle}x:`, samples.map((v, i) => `${sequence[i].replace("Arrow", "")[0]}${v.toFixed(0)}`).join(" "));
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    screen: name,
    throttle,
    keys: sequence.length,
    sampled: samples.length,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    max: sorted[sorted.length - 1],
    longTasks50: longTasks.filter((d) => d > 50).length,
    longTasks100: longTasks.filter((d) => d > 100).length,
    domNodes,
    cost,
    focusState,
    errors,
    analysis,
  };
}

const server = await startServer({ distDir: DIST });
const base = `${PREFIX}:${server.port}`;
// GPU mode (default when a render node exists): full Chromium in new headless
// with ANGLE/Vulkan so raster + compositing run on the GPU like a TV SoC's.
// Software mode (--software) rasterises 4K frames on the CPU, which swamps the
// compositor commit and hides script cost; it is kept as a stress option.
function launchOptions() {
  const gpu = !flag("software") && existsSync("/dev/dri/renderD128");
  if (!gpu) return { args: [], mode: "software" };
  const dir = join(homedir(), ".cache/ms-playwright");
  const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
  const executablePath = process.env.NAV_PERF_CHROMIUM || (full ? join(dir, full, "chrome-linux64/chrome") : undefined);
  return {
    mode: "gpu",
    executablePath,
    args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
  };
}
const { mode, ...launch } = launchOptions();
console.log(`chromium mode: ${mode}`);
const browser = await chromium.launch(launch);
const results = [];
try {
  for (const screen of SCREENS) {
    for (const throttle of THROTTLES) {
      const runs = [];
      for (let r = 0; r < RUNS; r += 1) runs.push(await runOne(browser, base, screen, throttle, { profile: flag("profile") }));
      runs.sort((a, b) => a.p95 - b.p95);
      const res = runs[Math.floor(runs.length / 2)];
      results.push(res);
      console.log(
        `${screen.padEnd(7)} ${String(throttle).padStart(2)}x  p50 ${res.p50.toFixed(0).padStart(5)}  p95 ${res.p95.toFixed(0).padStart(5)}  max ${res.max.toFixed(0).padStart(5)}  long>50 ${String(res.longTasks50).padStart(3)}  long>100 ${String(res.longTasks100).padStart(3)}  dom ${res.domNodes}  cpu/key ${res.cost.taskMs.toFixed(2)}ms (script ${res.cost.scriptMs.toFixed(2)} layout ${res.cost.layoutMs.toFixed(2)} style ${res.cost.styleMs.toFixed(2)})  keys ${res.sampled}/${res.keys}${res.focusState.ok ? "" : `  FOCUS ${res.focusState.reason}`}${res.errors.length ? `  ERRORS ${res.errors[0]}` : ""}`
      );
      if (res.analysis) console.log(res.analysis.cpu.text + "\n" + res.analysis.trace.text);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (server.unknown.size) console.log("mock API: unimplemented endpoints hit:", [...server.unknown].join(", "));
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "latest.json"), JSON.stringify(results, null, 2));
console.log("\n| screen | throttle | p50 ms | p95 ms | long>100 ms |\n|---|---|---|---|---|");
for (const r of results) console.log(`| ${r.screen} | ${r.throttle}x | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.longTasks100} |`);
if (flag("check")) {
  const broken = results.filter((r) => !r.focusState.ok);
  if (broken.length) {
    console.error(`\nfunctional failures: ${broken.map((r) => `${r.screen}@${r.throttle}x ${r.focusState.reason}`).join("; ")}`);
    process.exit(1);
  }
  const failures = results.filter((r) => BUDGET[r.throttle] !== undefined && !(r.p95 <= BUDGET[r.throttle]));
  if (failures.length) {
    console.error(`\nbudget misses: ${failures.map((r) => `${r.screen}@${r.throttle}x p95 ${r.p95.toFixed(0)} > ${BUDGET[r.throttle]}`).join("; ")}`);
    process.exit(1);
  }
}
