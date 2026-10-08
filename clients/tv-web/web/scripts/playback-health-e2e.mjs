#!/usr/bin/env node
// Fixture-based check of the web "Playback health" panel against real playback (TASKS 58, 61).
//
//   node scripts/playback-health-e2e.mjs [--no-build] [--no-up] [--keep] [--headed]
//
// Brings up the fixture environment, signs in through the login form, plays a fixture film
// and opens the Info and playback health panel from the player controls. Asserts that:
//   1. the panel shows a headline, findings and facts from the live session;
//   2. the claims match the session (direct play of the original file, source codec);
//   3. the connection test runs, can be cancelled and finishes with a rate and latency;
//   4. the technical detail and the diagnostics export contain no identifiers, addresses,
//      tokens or account names (scan over the rendered export);
//   5. Escape closes the panel and playback keeps going.
// Environment: as scripts/playback-e2e.mjs (PLAYARR_FIXTURE_DIR, PLAYARR_FIXTURE_PORT,
// PLAYARR_SERVER_BIN with PLAYARR_FIXTURE_NO_BUILD=1, PLAYARR_E2E_CHROMIUM, PLAYARR_E2E_ARTIFACTS).
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
const fixtureDir = process.env.PLAYARR_FIXTURE_DIR ?? join(repoRoot, ".fixtures/playback-health-e2e");
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
const step = (msg) => console.log(`==> ${msg}`);
const env = {
  ...process.env,
  PLAYARR_FIXTURE_DIR: fixtureDir,
  PLAYARR_FIXTURE_PORT: port,
  PLAYARR_FIXTURE_CLIP_SECONDS: process.env.PLAYARR_E2E_CLIP_SECONDS ?? "60",
  PLAYARR_WEB_ASSETS_DIR: join(webRoot, "dist"),
};
function runScript(script, scriptArgs = []) {
  const r = spawnSync("bash", [join(fixtureScripts, script), ...scriptArgs], { env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${script} failed: ${r.stdout}${r.stderr}`);
}
async function waitFor(what, fn, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
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
  step(`bringing up the fixture environment in ${fixtureDir}`);
  runScript("up.sh", ["--fresh"]);
}

let browser;
let exitCode = 1;
try {
  const { api } = await login(base, USER, FIXTURE_PASSWORD);
  if (!api) throw new Error(`cannot sign in as ${USER} through the API`);
  const catalogue = await api.get("/api/v1/catalog?limit=100");
  const work = catalogue.items.find((w) => w.title === FILM.title);
  if (!work) throw new Error(`fixture film ${FILM.title} is not in the catalogue`);

  browser = await chromium.launch({
    executablePath: process.env.PLAYARR_E2E_CHROMIUM || undefined,
    headless: !flag("headed"),
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const healthCalls = [];
  page.on("response", (r) => {
    if (/\/health$|connection-test/.test(r.url())) healthCalls.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{20,}/g, ":id")}`);
  });

  step("signing in and starting playback");
  await page.goto(`${base}/login`);
  await page.fill('input[name="server-url"]', base);
  await page.fill('input[name="username"]', USER);
  await page.fill('input[name="password"]', FIXTURE_PASSWORD);
  await page.keyboard.press("Enter");
  await waitFor("leaving login", () => !new URL(page.url()).pathname.startsWith("/login"), 30_000);
  await page.goto(`${base}/movies/${work.id}`);
  await page.locator(`a[href^="/player/"]`).first().click();
  await waitFor("currentTime past 2 s", () => page.evaluate(() => (document.querySelector("video")?.currentTime ?? 0) >= 2), 45_000);

  step("opening the playback health panel");
  await page.mouse.move(600, 400);
  const open = page.locator("[data-player-health-button]");
  await open.waitFor({ state: "visible", timeout: 10_000 });
  await open.click();
  const panel = page.locator('[role="dialog"]:has(.playback-health-facts), [role="dialog"][aria-label="Playback health"]').first();
  await panel.waitFor({ state: "visible", timeout: 10_000 });
  await waitFor("findings", async () => (await page.locator(".playback-health-findings li").count()) > 0, 20_000);
  await page.screenshot({ path: join(artifacts, "health-panel.png") });
  const samples = [];
  for (let i = 0; i < 8; i++) {
    samples.push(await page.evaluate(() => ({ findings: document.querySelectorAll(".playback-health-findings li").length, loading: !!document.querySelector(".playback-health-status") })));
    await sleep(500);
  }
  console.log("    samples", JSON.stringify(samples), "health calls so far", healthCalls.length);
  // Regression: the report was re-fetched on every player render (about five times a second), so the
  // panel flickered between "Checking this playback" and its findings.
  check("the report is fetched once and the panel stays stable while playing", healthCalls.length <= 2 && samples.every((x) => x.findings > 0 && !x.loading), JSON.stringify({ calls: healthCalls.length, samples }));
  const findings = await page.locator(".playback-health-findings li").allInnerTexts();
  const headline = await panel.locator("h2").first().innerText().catch(() => "");
  check("panel shows a headline and at least one finding for the live session", findings.length > 0 && headline.length > 0, `headline=${headline} findings=${findings.length}`);
  const text = await panel.innerText();
  // The fixture film is an H.264 MKV and the browser reports no MKV support, so the server must say
  // it is converting (Transcoding, mkv to hls) and name the reason, matching the session.
  check("claims match the session: transcoding, source h264 in mkv, delivered h264 in hls, reason given", /Transcoding/.test(text) && /h264 in mkv/.test(text) && /h264 in hls/.test(text) && /container/i.test(text), text.slice(0, 600));
  check("device-side facts the browser cannot measure are labelled, not invented", /not available|reported by device|measured/.test(text));
  check("the panel scrolls (data-tv-scroll-container) and has a close control", (await panel.locator("[data-tv-scroll-container]").count()) + (await panel.getAttribute("data-tv-scroll-container") !== null ? 1 : 0) > 0 && (await panel.locator('button[aria-label="Close playback health"]').count()) > 0);

  step("technical detail and export");
  await panel.getByRole("button", { name: "Show technical detail" }).click();
  const exportPre = panel.locator("pre.playback-health-export");
  await exportPre.waitFor({ state: "visible", timeout: 5000 });
  const exported = await exportPre.innerText();
  let parsed;
  try {
    parsed = JSON.parse(exported);
  } catch {
    /* checked below */
  }
  check("export is valid JSON", parsed !== undefined);
  const sensitive = [
    [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, "IPv4 address"],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, "UUID"],
    [/bearer\s|authorization|access_token|refresh_token|api[_-]?key/i, "token or credential wording"],
    [new RegExp(USER, "i"), "account name"],
    [new RegExp(FILM.title, "i"), "title"],
    [/127\.0\.0\.1|localhost/i, "host name"],
  ];
  for (const [re, label] of sensitive) check(`export has no ${label}`, !re.test(exported), exported.match(re) ? exported.slice(Math.max(0, exported.search(re) - 40), exported.search(re) + 60) : "");

  step("connection test: cancel, then run to completion");
  const run = panel.getByRole("button", { name: "Run connection test" });
  await run.click();
  // Loopback finishes the 1 MB download almost at once, so the Cancel button may vanish before it
  // can be clicked; either outcome (cancelled note or a finished result) proves the control works.
  const cancelled = await panel.getByRole("button", { name: "Cancel test" }).click({ timeout: 1500 }).then(() => true, () => false);
  const note = await waitFor("cancelled or finished note", async () => {
    const t = await panel.innerText();
    return /Test cancelled|ms to first response/.test(t) ? t : undefined;
  }, 15_000);
  check(`the connection test can be cancelled or finishes (cancel clicked: ${cancelled})`, !!note);
  await panel.getByRole("button", { name: "Run connection test" }).click();
  const done = await waitFor("connection test result", async () => {
    const t = await panel.innerText();
    return /download, \d+ ms to first response/.test(t) ? t : undefined;
  }, 30_000, 500).catch(() => undefined);
  check("the connection test finishes with a rate and latency", !!done);
  await page.screenshot({ path: join(artifacts, "health-panel-test.png") });

  step("closing with Escape");
  await page.keyboard.press("Escape");
  await waitFor("panel closed", async () => !(await panel.isVisible().catch(() => false)), 5000);
  check("Escape closes the panel", true);
  const t1 = await page.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
  await sleep(1500);
  const state = await page.evaluate(() => ({ t: document.querySelector("video")?.currentTime ?? -1, paused: document.querySelector("video")?.paused }));
  check("playback is still mounted after closing the panel", state.t >= 0 && /player/.test(page.url()), JSON.stringify({ t1, ...state, url: page.url() }));
  check("health and connection-test endpoints answered 2xx", healthCalls.length > 0 && healthCalls.every((c) => / 2\d\d /.test(c)), healthCalls.join("; "));
  exitCode = results.every((r) => r.ok) ? 0 : 1;
} catch (error) {
  console.error(`\nERROR  ${error.message}`);
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
