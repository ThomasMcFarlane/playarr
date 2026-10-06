#!/usr/bin/env node
// Fixture-based playback test for the web player (TASKS 456, 256, 371).
//
//   node scripts/playback-e2e.mjs [--no-build] [--no-up] [--keep] [--headed]
//
// Brings up the fixture environment (scripts/fixtures, row 457) with generated
// clips long enough to outlive the player's read-ahead buffer and the built web
// client served by the fixture server itself, then drives one headless Chromium:
//
//   1. sign in as a fixture user through the real login form;
//   2. open a fixture film and press Play;
//   3. assert `video.currentTime` advances, the stream was set up exactly once
//      (the regression behind row 456: the engine was torn down and rebuilt on
//      every token-provider change, so Shaka fetched a segment and never played);
//   4. kill the fixture server (SIGKILL) mid-playback, wait for the inline
//      "Reconnecting" card, restart the server, and assert playback resumes
//      past the point where it stalled with the same `<video>` still mounted.
//
// Environment:
//   PLAYARR_FIXTURE_DIR        state directory (default <repo>/.fixtures/playback-e2e)
//   PLAYARR_FIXTURE_PORT       server port (default 18484); PLAYARR_FIXTURE_STUB_PORT, PLAYARR_FIXTURE_METRICS_PORT likewise
//   PLAYARR_SERVER_BIN         built playarr-server (with PLAYARR_FIXTURE_NO_BUILD=1 skips the cargo build)
//   PLAYARR_E2E_CHROMIUM       Chromium/Chrome executable (default: Playwright's own)
//   PLAYARR_E2E_CLIP_SECONDS   clip length in seconds (default 60)
//   PLAYARR_E2E_ARTIFACTS      screenshots and logs (default <fixture dir>/e2e-artifacts)
//
// Exit status 0 when every check passed. Run it inside a memory-capped scope on a shared host.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "../../..");
const fixtureScripts = join(repoRoot, "scripts/fixtures");
const { login } = await import(join(fixtureScripts, "api.mjs"));
const { FIXTURE_PASSWORD, MOVIES } = await import(join(fixtureScripts, "catalog.mjs"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const fixtureDir = process.env.PLAYARR_FIXTURE_DIR ?? join(repoRoot, ".fixtures/playback-e2e");
const port = process.env.PLAYARR_FIXTURE_PORT ?? "18484";
const base = `http://127.0.0.1:${port}`;
const artifacts = process.env.PLAYARR_E2E_ARTIFACTS ?? join(fixtureDir, "e2e-artifacts");
const clipSeconds = process.env.PLAYARR_E2E_CLIP_SECONDS ?? "60";
const distDir = join(webRoot, "dist");
const USER = "fx-viewer";
const FILM = MOVIES.find((m) => m.title === "Test Movie A") ?? MOVIES[0];

mkdirSync(artifacts, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
}
const step = (msg) => console.log(`==> ${msg}`);

function fixtureEnv() {
  return {
    ...process.env,
    PLAYARR_FIXTURE_DIR: fixtureDir,
    PLAYARR_FIXTURE_PORT: port,
    PLAYARR_FIXTURE_CLIP_SECONDS: clipSeconds,
    PLAYARR_WEB_ASSETS_DIR: distDir,
  };
}

function runScript(script, scriptArgs = []) {
  const r = spawnSync("bash", [join(fixtureScripts, script), ...scriptArgs], {
    env: fixtureEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`${script} ${scriptArgs.join(" ")} failed with status ${r.status}`);
  }
}

function serverPid() {
  const file = join(fixtureDir, "run/server.pid");
  return existsSync(file) ? Number(readFileSync(file, "utf8").trim()) : undefined;
}

async function killServer() {
  const pid = serverPid();
  if (!pid) throw new Error("fixture server pid file not found");
  process.kill(pid, "SIGKILL");
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error("fixture server did not exit");
}

async function waitFor(what, fn, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
}

if (!flag("no-build") && !flag("no-up")) {
  step("building the web client");
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: webRoot, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!flag("no-up")) {
  step(`bringing up the fixture environment in ${fixtureDir} (clips of ${clipSeconds} s)`);
  runScript("up.sh", ["--fresh"]);
}

let browser;
const network = [];
const logs = [];
let exitCode = 1;
try {
  const { api } = await login(base, USER, FIXTURE_PASSWORD);
  if (!api) throw new Error(`cannot sign in as ${USER} through the API`);
  const catalogue = await api.get("/api/v1/catalog?limit=100");
  const work = catalogue.items.find((w) => w.title === FILM.title);
  if (!work) throw new Error(`fixture film ${FILM.title} is not in the catalogue`);
  const detail = await api.get(`/api/v1/catalog/${work.id}`);
  const mediaFileId = detail.media_file_id;

  browser = await chromium.launch({
    executablePath: process.env.PLAYARR_E2E_CHROMIUM || undefined,
    headless: !flag("headed"),
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // Count the MediaSource objects the page creates: a healthy start creates one
  // (a second only if the engine is deliberately re-created).
  await context.addInitScript(() => {
    window.__mediaSources = 0;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      if (object instanceof MediaSource) window.__mediaSources += 1;
      return create(object);
    };
    // Remember that the reconnect card was shown at any time, even briefly.
    window.__reconnectSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="player-reconnecting"]')) window.__reconnectSeen = true;
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await context.newPage();
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  page.on("response", (r) => {
    if (r.url().startsWith(`${base}/api/`) && !/\/(version|household|capabilities|events|remote)/.test(r.url())) {
      network.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.request().method()} ${r.status()} ${r.url().replace(base, "").slice(0, 110)}`);
    }
  });
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(`${base}/api/`)) network.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.method()} FAILED ${r.url().replace(base, "").slice(0, 110)}`);
  });
  const segmentRequests = [];
  page.on("request", (r) => {
    if (/\/api\/v1\/media\/sessions\/.+\.(ts|m4s|mp4)$/.test(r.url())) segmentRequests.push(r.url());
  });

  const video = () =>
    page.evaluate(() => {
      const v = document.querySelector("video");
      return v
        ? {
            t: v.currentTime,
            paused: v.paused,
            readyState: v.readyState,
            ended: v.ended,
            error: v.error?.message ?? null,
            mediaSources: window.__mediaSources,
            reconnectCard: !!document.querySelector('[data-testid="player-reconnecting"]'),
            fatalCard: !!document.querySelector('.player-overlay[role="alert"]'),
          }
        : null;
    });

  step("signing in through the login form");
  await page.goto(`${base}/login`);
  await page.fill('input[name="server-url"]', base);
  await page.fill('input[name="username"]', USER);
  await page.fill('input[name="password"]', FIXTURE_PASSWORD);
  await page.keyboard.press("Enter");
  await waitFor("leaving the login page", () => !new URL(page.url()).pathname.startsWith("/login"), 30_000);
  check("fixture user can sign in through the web form", true);

  step(`opening ${FILM.title} and pressing Play`);
  await page.goto(`${base}/movies/${work.id}`);
  await page.locator(`a[href^="/player/"]`).first().click();
  await waitFor("the player route", () => page.url().includes("/player/"), 15_000);

  let started;
  try {
    started = await waitFor("currentTime to pass 2 s", async () => {
      const v = await video();
      return v && v.t >= 2 ? v : undefined;
    }, 45_000);
  } catch (error) {
    const v = await video();
    await page.screenshot({ path: join(artifacts, "start-stalled.png") });
    check("playback starts and currentTime advances", false, `${error.message}; video=${JSON.stringify(v)}; segments fetched=${segmentRequests.length}`);
    throw new Error("playback did not start");
  }
  const t1 = started.t;
  await sleep(2000);
  const t2 = (await video()).t;
  check("playback starts and currentTime advances", t2 > t1 + 1, `t1=${t1} t2=${t2}`);
  check("the stream is set up once (engine not rebuilt)", started.mediaSources <= 1, `MediaSource objects created: ${started.mediaSources}`);
  check("no media error and no error card while playing", started.error === null && !started.fatalCard, JSON.stringify(started));
  await page.screenshot({ path: join(artifacts, "playing.png") });

  step("killing the fixture server mid-playback");
  await killServer();
  const killedAt = await video();
  console.log(`    killed at currentTime=${killedAt.t.toFixed(2)}`);

  // The read-ahead buffer drains, the next segment cannot be fetched, Shaka
  // retries, then the player must show the inline reconnect card.
  let reconnectState;
  try {
    reconnectState = await waitFor("the reconnect card or an error card", async () => {
      const v = await video();
      return v && (v.reconnectCard || v.fatalCard) ? v : undefined;
    }, 240_000, 500);
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "no-reconnect-ui.png") });
    check("server killed: the player shows the reconnect UI", false, `${error.message}; video=${JSON.stringify(await video())}`);
    throw new Error("no reconnect UI");
  }
  await page.screenshot({ path: join(artifacts, "reconnecting.png") });
  const stalledAt = reconnectState.t;
  check("server killed: the player shows the inline reconnect card (not the error card)", reconnectState.reconnectCard && !reconnectState.fatalCard, JSON.stringify(reconnectState));
  check("the player (video element) stays mounted while reconnecting", reconnectState.readyState !== undefined && (await video()) !== null);

  step("restarting the fixture server");
  runScript("up.sh");
  let recovered;
  try {
    recovered = await waitFor("playback to resume past the stall point", async () => {
      const v = await video();
      return v && !v.reconnectCard && !v.fatalCard && !v.paused && v.t > stalledAt + 2 ? v : undefined;
    }, 120_000, 500);
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "not-recovered.png") });
    check("server restarted: playback recovers at the same position", false, `${error.message}; stalledAt=${stalledAt}; video=${JSON.stringify(await video())}`);
    throw new Error("playback did not recover");
  }
  await page.screenshot({ path: join(artifacts, "recovered.png") });
  check("server restarted: playback recovers and currentTime passes the stall point", recovered.t > stalledAt + 2, `stalledAt=${stalledAt} now=${recovered.t}`);
  check("the reconnect card is gone after recovery", !recovered.reconnectCard && !recovered.fatalCard);
  check("playback resumed near where it stalled (no restart from zero)", recovered.t > Math.max(0, stalledAt - 1), `stalledAt=${stalledAt} now=${recovered.t}`);
  exitCode = results.every((r) => r.ok) ? 0 : 1;
  console.log(`\nclient log lines: ${logs.length}`);
  writeFileSync(join(artifacts, "network.log"), network.join("\n") + "\n");
  writeFileSync(join(artifacts, "console.log"), logs.join("\n") + "\n");
  if (exitCode !== 0) console.log(logs.slice(-40).join("\n"));
} catch (error) {
  console.error(`\nERROR  ${error.message}`);
  try {
    writeFileSync(join(artifacts, "network.log"), network.join("\n") + "\n");
    writeFileSync(join(artifacts, "console.log"), logs.join("\n") + "\n");
  } catch {
    /* evidence only */
  }
  exitCode = 1;
} finally {
  await browser?.close();
  if (!flag("keep") && !flag("no-up")) {
    try {
      runScript("down.sh");
    } catch {
      /* already down */
    }
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; artefacts in ${artifacts}`);
process.exit(exitCode === 0 && failed.length === 0 ? 0 : 1);
