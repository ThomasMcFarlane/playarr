#!/usr/bin/env node
// Player entry, BACK sequence, scrubber and scrim checks for the web player.
//
//   node scripts/player-entry-e2e.mjs [--no-build] [--no-up] [--keep]
//
// Uses the fixture environment (scripts/fixtures). Press Play with the playback
// negotiation held back and assert the player opens at once: no interstitial,
// the chrome and a buffering spinner only. Then check BACK closes the controls
// before exiting, a menu closes first and returns focus to its opener, SELECT
// on the scrubber toggles play/pause without a seek, focus survives repeated
// seeks, and the scrim rises from the bottom edge. Runs in a TV and a phone
// layout. Environment as for playback-e2e.mjs (PLAYARR_FIXTURE_DIR/PORT, ...).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
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
const fixtureDir = process.env.PLAYARR_FIXTURE_DIR ?? join(repoRoot, ".fixtures/player-entry-e2e");
const port = process.env.PLAYARR_FIXTURE_PORT ?? "18484";
const base = `http://127.0.0.1:${port}`;
const artifacts = process.env.PLAYARR_E2E_ARTIFACTS ?? join(fixtureDir, "e2e-artifacts");
const USER = "fx-viewer";
const FILM = MOVIES.find((m) => m.title === "Test Movie A") ?? MOVIES[0];
mkdirSync(artifacts, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
}
const env = {
  ...process.env,
  PLAYARR_FIXTURE_DIR: fixtureDir,
  PLAYARR_FIXTURE_PORT: port,
  PLAYARR_FIXTURE_CLIP_SECONDS: process.env.PLAYARR_E2E_CLIP_SECONDS ?? "120",
  PLAYARR_WEB_ASSETS_DIR: join(webRoot, "dist"),
};
const runScript = (script, a = []) => {
  const r = spawnSync("bash", [join(fixtureScripts, script), ...a], { env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${script} failed: ${r.stdout}${r.stderr}`);
};
async function waitFor(what, fn, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

if (!flag("no-build") && !flag("no-up")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: webRoot, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!flag("no-up")) runScript("up.sh", ["--fresh"]);

const layouts = [
  { name: "tv", viewport: { width: 1920, height: 1080 } },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
let browser;
try {
  const { api } = await login(base, USER, FIXTURE_PASSWORD);
  const catalogue = await api.get("/api/v1/catalog?limit=100");
  const work = catalogue.items.find((w) => w.title === FILM.title);
  browser = await chromium.launch({
    executablePath: process.env.PLAYARR_E2E_CHROMIUM || undefined,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  for (const layout of layouts) {
    const tag = layout.name;
    const context = await browser.newContext(layout);
    const page = await context.newPage();
    await page.goto(`${base}/login`);
    await page.fill('input[name="server-url"]', base);
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', FIXTURE_PASSWORD);
    await page.keyboard.press("Enter");
    await waitFor("sign-in", () => !new URL(page.url()).pathname.startsWith("/login"), 30_000);

    // Hold the negotiation back so the loading state lasts long enough to inspect.
    let release;
    const held = new Promise((r) => (release = r));
    await page.route(/\/api\/v1\/playback\/[^/?]+(\?.*)?$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${base}/movies/${work.id}`);
    await page.locator(`a[href^="/player/"]`).first().click();
    await waitFor("player route", () => page.url().includes("/player/"), 10_000);
    await sleep(500);
    const loading = await page.evaluate(() => ({
      shell: !!document.querySelector(".player-shell:not(.player-shell-placeholder)"),
      video: !!document.querySelector("video.player-video"),
      close: !!document.querySelector(".player-close"),
      spinner: !!document.querySelector(".player-overlay-loading .player-spinner"),
      interstitial: /preparing|one moment/i.test(document.body.innerText),
      placeholder: !!document.querySelector(".player-shell-placeholder"),
    }));
    await page.screenshot({ path: join(artifacts, `${tag}-loading.png`) });
    check(`${tag}: player mounts directly while negotiating (shell, video, close, spinner)`, loading.shell && loading.video && loading.close && loading.spinner, JSON.stringify(loading));
    check(`${tag}: no Preparing interstitial or placeholder page`, !loading.interstitial && !loading.placeholder, JSON.stringify(loading));
    release();
    await waitFor("playback", () => page.evaluate(() => (document.querySelector("video")?.currentTime ?? 0) > 2), 45_000);
    await page.unroute(/\/api\/v1\/playback\/[^/?]+(\?.*)?$/);

    // Scrubber: focus, repeated seeks keep focus, Enter toggles play/pause only.
    await page.mouse.move(layout.viewport.width / 2, layout.viewport.height / 2);
    await page.evaluate(() => {
      document.body.dataset.inputMode = "remote";
      document.querySelector(".player-seek-track")?.focus();
    });
    const track = () => page.evaluate(() => document.activeElement?.classList.contains("player-seek-track"));
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowRight");
      await sleep(400);
    }
    await sleep(1500);
    check(`${tag}: scrubber keeps focus through repeated seeks`, await track());
    const ring = await page.evaluate(() => {
      const el = document.querySelector(".player-seek-track");
      const thumb = el.querySelector(".player-seek-thumb");
      return { ring: getComputedStyle(el).boxShadow, thumb: getComputedStyle(thumb).width, opacity: getComputedStyle(thumb).opacity };
    });
    await page.screenshot({ path: join(artifacts, `${tag}-scrubber-focus.png`) });
    check(`${tag}: focused scrubber shows the white ring and an enlarged thumb`, ring.ring.includes("255, 255, 255") && ring.thumb === "24px" && ring.opacity === "1", JSON.stringify(ring));
    const before = await page.evaluate(() => ({ p: document.querySelector("video").paused, t: document.querySelector("video").currentTime }));
    await page.keyboard.press("Enter");
    await sleep(600);
    const after = await page.evaluate(() => ({ p: document.querySelector("video").paused, t: document.querySelector("video").currentTime }));
    check(`${tag}: SELECT on the scrubber toggles play/pause without seeking`, before.p !== after.p && Math.abs(after.t - before.t) < 1.5 && (await track()), JSON.stringify({ before, after }));
    await page.keyboard.press("Enter");
    await sleep(400);

    // Scrim rises from / recedes to the bottom edge.
    const scrim = async () => page.evaluate(() => {
      const el = document.querySelector(".player-scrim");
      const m = new DOMMatrix(getComputedStyle(el).transform);
      return { ty: m.m42, h: el.getBoundingClientRect().height, hidden: el.classList.contains("is-hidden") };
    });
    // BACK sequence: first BACK hides the controls, second leaves the player.
    const idle = () => page.evaluate(() => document.querySelector(".player-shell")?.classList.contains("player-shell-idle"));
    await page.mouse.move(layout.viewport.width / 2 + 5, layout.viewport.height / 2 + 5);
    await sleep(400);
    const shown = await scrim();
    await page.keyboard.press("Escape");
    await sleep(90);
    const mid = await scrim();
    await sleep(500);
    const hiddenState = await scrim();
    await page.screenshot({ path: join(artifacts, `${tag}-after-first-back.png`) });
    check(`${tag}: first BACK hides the controls and stays in the player`, (await idle()) && page.url().includes("/player/"), `url=${page.url()}`);
    check(`${tag}: scrim recedes downward (translateY 0 -> mid -> full height)`, shown.ty === 0 && mid.ty > 0 && mid.ty < hiddenState.ty && Math.abs(hiddenState.ty - hiddenState.h) < 2, JSON.stringify({ shown, mid, hiddenState }));
    await page.keyboard.press("Escape");
    await waitFor("leaving the player", () => !page.url().includes("/player/"), 5_000).then(
      () => check(`${tag}: second BACK exits playback`, true),
      () => check(`${tag}: second BACK exits playback`, false, page.url())
    );

    // A menu closes first (one level per press) and returns focus to its opener.
    await page.goto(`${base}/movies/${work.id}`);
    await page.locator(`a[href^="/player/"]`).first().click();
    await waitFor("playback again", () => page.evaluate(() => (document.querySelector("video")?.currentTime ?? 0) > 1), 45_000);
    await page.mouse.move(layout.viewport.width / 2, layout.viewport.height / 2);
    const opener = page.locator(".player-controls [aria-haspopup]").first();
    if (await opener.count()) {
      await opener.focus();
      await page.keyboard.press("ArrowUp");
      await sleep(400);
      await page.keyboard.press("Escape");
      await sleep(400);
      const state = await page.evaluate(() => ({
        route: location.pathname.startsWith("/player/"),
        idle: document.querySelector(".player-shell")?.classList.contains("player-shell-idle"),
        focusInControls: !!document.activeElement?.closest(".player-controls"),
      }));
      check(`${tag}: BACK closes an open menu first, keeping the controls and the player`, state.route && !state.idle && state.focusInControls, JSON.stringify(state));
    } else {
      console.log(`SKIP  ${tag}: no menu opener found`);
    }
    await context.close();
  }
} catch (error) {
  console.error(`ERROR ${error.message}`);
  check("script completed", false, error.message);
} finally {
  await browser?.close();
  if (!flag("keep") && !flag("no-up")) {
    try { runScript("down.sh"); } catch { /* already down */ }
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; artefacts in ${artifacts}`);
process.exit(failed.length ? 1 : 0);
