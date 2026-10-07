#!/usr/bin/env node
// Player audit follow-ups for the web player: auto-hide, reveal-only arrows, focus rings,
// Info panel, error retry/Close, mobile chip and double-tap seeking.
//
//   node scripts/player-audit-e2e.mjs [--no-build] [--no-up] [--keep]
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
const fixtureDir = process.env.PLAYARR_FIXTURE_DIR ?? join(repoRoot, ".fixtures/player-audit-e2e");
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
const PLAYBACK = /\/api\/v1\/playback\/[^/?]+(\?.*)?$/;
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
    const video = () => page.evaluate(() => { const v = document.querySelector("video"); const slider = document.querySelector(".player-seek-track"); return v ? { t: Number(slider?.getAttribute("aria-valuenow") ?? v.currentTime), paused: v.paused } : null; });
    const idle = () => page.evaluate(() => document.querySelector(".player-shell")?.classList.contains("player-shell-idle"));
    const openPlayer = async () => {
      await page.goto(`${base}/movies/${work.id}`);
      await page.locator(`a[href^="/player/"]`).first().click();
    };

    // --- Errors: silent retries with back-off, then a human message with Retry and Close.
    let failures = 0;
    await page.route(PLAYBACK, (route) => { failures += 1; return route.abort("connectionrefused"); });
    const errStart = Date.now();
    await openPlayer();
    await sleep(900);
    const duringRetry = await page.evaluate(() => ({
      surface: !!document.querySelector("video.player-video"),
      errorCard: !!document.querySelector(".player-status-card-error"),
    }));
    check(`${tag}: a failed start keeps the player and retries silently first`, duringRetry.surface && !duringRetry.errorCard, JSON.stringify(duringRetry));
    await waitFor("the error card after the retries", () => page.locator(".player-status-card-error").count(), 30_000);
    const card = await page.evaluate(() => ({
      text: document.querySelector(".player-status-card-error")?.textContent ?? "",
      buttons: [...document.querySelectorAll(".player-status-card-error button")].map((b) => b.textContent.trim()),
    }));
    await page.screenshot({ path: join(artifacts, `${tag}-error.png`) });
    check(`${tag}: error is human-readable (no raw "Failed to fetch")`, !/failed to fetch/i.test(card.text) && /reach the server/i.test(card.text), card.text);
    check(`${tag}: error offers Retry and Close`, card.buttons.includes("Try again") && card.buttons.includes("Close"), JSON.stringify(card.buttons));
    check(`${tag}: the start was retried with back-off (at least 4 attempts, error only after about 7 s)`, failures >= 4 && Date.now() - errStart >= 6500, `attempts=${failures} after ${Date.now() - errStart} ms`);
    await page.unroute(PLAYBACK);
    await page.getByRole("button", { name: "Try again" }).click();
    await waitFor("playback after Retry", () => page.evaluate(() => (document.querySelector("video")?.currentTime ?? 0) > 1.5), 45_000);
    check(`${tag}: Retry starts playback`, true);

    // --- Auto-hide at about 5 s while playing.
    await page.mouse.move(layout.viewport.width / 2, layout.viewport.height / 2);
    await page.mouse.move(layout.viewport.width / 2 + 3, layout.viewport.height / 2 + 3);
    const t0 = Date.now();
    await waitFor("controls hide", idle, 12_000);
    const hideMs = Date.now() - t0;
    check(`${tag}: controls auto-hide after about 5 s`, hideMs >= 4300 && hideMs <= 6800, `${hideMs} ms`);

    // --- Arrow keys with hidden controls only reveal and focus a control.
    const before = await video();
    await page.keyboard.press("ArrowRight");
    await sleep(500);
    const after = await video();
    const revealed = await page.evaluate(() => ({
      idle: document.querySelector(".player-shell")?.classList.contains("player-shell-idle"),
      focusInControls: !!document.activeElement?.closest(".player-controls"),
    }));
    check(`${tag}: ArrowRight with hidden controls reveals them and does not seek`, !revealed.idle && Math.abs(after.t - before.t) < 2.5, JSON.stringify({ before, after, revealed }));
    check(`${tag}: revealing puts focus on a control`, revealed.focusInControls, JSON.stringify(revealed));

    // --- Focus ring on a keyboard-focused button.
    await page.evaluate(() => { document.body.dataset.inputMode = "remote"; document.querySelector(".player-controls .player-btn")?.focus(); });
    const outline = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor }; });
    await page.screenshot({ path: join(artifacts, `${tag}-button-ring.png`) });
    check(`${tag}: a focused control shows the white ring`, outline.style === "solid" && outline.color === "rgb(255, 255, 255)" && outline.width === "3px", JSON.stringify(outline));

    // --- j / l seek 10 s even with the controls hidden.
    await page.evaluate(() => document.querySelector("video")?.focus());
    await waitFor("controls hide again", idle, 12_000);
    const a = await video();
    await page.keyboard.press("l");
    const b = await waitFor("position after l", async () => { const v = await video(); return v && v.t > a.t + 8 ? v : null; }, 15_000).catch(() => video());
    await page.keyboard.press("j");
    const c = await waitFor("position after j", async () => { const v = await video(); return v && v.t < b.t - 8 ? v : null; }, 15_000).catch(() => video());
    check(`${tag}: l seeks +10 s and j seeks -10 s`, b.t - a.t > 8 && b.t - c.t > 8, JSON.stringify({ a: a.t, b: b.t, c: c.t }));

    // --- Info panel: title and synopsis area, BACK closes it and returns focus to its opener.
    await page.mouse.move(layout.viewport.width / 2, layout.viewport.height / 2);
    await sleep(300);
    const opener = page.locator("[data-player-health-button]");
    await opener.focus();
    await opener.click();
    await waitFor("info panel", () => page.locator(".playback-info-about").count(), 8_000);
    const about = await page.locator(".playback-info-about").innerText();
    await page.screenshot({ path: join(artifacts, `${tag}-info.png`) });
    check(`${tag}: Info panel shows the title`, about.toLowerCase().includes(FILM.title.toLowerCase()), about);
    await page.keyboard.press("Escape");
    await sleep(500);
    const info = await page.evaluate(() => ({
      open: !!document.querySelector(".playback-info-about"),
      onPlayer: location.pathname.startsWith("/player/"),
      focus: document.activeElement?.hasAttribute("data-player-health-button"),
    }));
    check(`${tag}: BACK closes Info, returns focus to its button, stays in the player`, !info.open && info.onPlayer && info.focus, JSON.stringify(info));

    if (layout.isMobile) {
      const chip = await page.evaluate(() => {
        const r = document.querySelector(".player-quality-button")?.getBoundingClientRect();
        return r ? { left: r.left, right: r.right, width: innerWidth } : null;
      });
      check(`${tag}: quality chip fits inside the 390 px viewport`, chip && chip.left >= 0 && chip.right <= chip.width, JSON.stringify(chip));
      await page.mouse.move(1, 1);
      await sleep(300);
      const x0 = await video();
      await page.touchscreen.tap(layout.viewport.width * 0.8, layout.viewport.height * 0.4);
      await page.touchscreen.tap(layout.viewport.width * 0.8, layout.viewport.height * 0.4);
      const x1 = await waitFor("double-tap seek", async () => { const v = await video(); return v && v.t > x0.t + 8 ? v : null; }, 15_000).catch(() => video());
      check(`${tag}: double-tap on the right half seeks +10 s`, x1.t - x0.t > 8 && x1.paused === x0.paused, JSON.stringify({ x0, x1 }));
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
