#!/usr/bin/env node
// Deterministic Playwright captures of the web client: the pixel reference for native parity.
//
//   node capture-web.mjs --base http://127.0.0.1:18484 [--layouts tv,mobile] [--theme light|dark|both] [--screens home,search]
//                        [--out docs/parity/web] [--clock 2026-10-07T12:00:00Z]
//
// --base is a fixture server (scripts/fixtures/up.sh) that also serves the built web client
// (PLAYARR_WEB_ASSETS_DIR) or a Vite dev server proxying /api to it. Writes <out>/<layout>/<theme>/<id>.png
// (tv 1920x1080 at 1x, mobile 390x844 at 3x = 1170x2532; theme is light or dark) and <out>/manifest.json.
// Determinism: fixed clock (Date frozen), reduced motion, animations and transitions off, caret hidden,
// no artwork (the fixture serves none, so the web draws its title placeholder tiles), fixed locale and
// time zone, fixed fixture users and device ids.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, "screens.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const base = (opt("base", process.env.PLAYARR_FIXTURE_URL ?? "http://127.0.0.1:18484") ?? "").replace(/\/$/, "");
const layoutIds = opt("layouts", "tv,mobile").split(",");
const themeOpt = opt("theme", opt("color-scheme", "both"));
const themeIds = themeOpt === "both" ? spec.themes : themeOpt.split(",");
for (const t of themeIds) if (!spec.themes.includes(t)) throw new Error(`unknown theme ${t} (use ${spec.themes.join("|")}|both)`);
const only = (opt("screens", "") ?? "").split(",").filter(Boolean);
const out = resolve(opt("out", join(here, "../../docs/parity/web")));
const clock = new Date(opt("clock", spec.determinism.clock)).getTime();
// Platform profile (all optional, off by default): --safe-area top,bottom[,left,right] emulates the native
// system bars as CSS safe-area insets (CSS px = device dp), --font renders every text run with one font file
// (the web font stack resolves per host, native clients use their platform font). The theme is set by
// --theme (alias --color-scheme), which drives both prefers-color-scheme and the app's own theme storage.
// The committed shared references use neither --safe-area nor --font: the web's own font, no system bars.
const safeArea = (opt("safe-area", "") ?? "").split(",").filter(Boolean).map(Number);
const fontFile = opt("font", "");
const fontCss = fontFile
  ? `@font-face{font-family:"ParityFont";src:url(data:font/ttf;base64,${readFileSync(fontFile).toString("base64")});font-weight:100 900}:root{--font:"ParityFont",sans-serif!important}*,*::before,*::after{font-family:"ParityFont",sans-serif!important}`
  : "";
const PASSWORD = readFileSync(join(here, "../fixtures/catalog.mjs"), "utf8").match(/FIXTURE_PASSWORD = "([^"]+)"/)[1];
const deviceId = (n) => {
  // Stable, valid UUID-shaped device id per user.
  let h = 0x811c9dc5;
  const hex = [...`parity/${n}`].reduce((a, c) => (a + (((h = Math.imul(h ^ c.charCodeAt(0), 16777619)) >>> 0).toString(16).padStart(8, "0"))), "");
  const s = (hex + "0".repeat(32)).slice(0, 32);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
};

async function api(path, token, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}`);
  return res.json();
}
// A fresh login per page: access tokens last 15 minutes and refresh tokens rotate, so a shared
// session would go stale (and break later screens) on a slow or loaded host.
async function login(username) {
  {
    const r = await api("/api/v1/auth/login", null, {
      method: "POST",
      body: JSON.stringify({ username, password: PASSWORD, device_id: deviceId(username), device_name: `parity-${username}`, client_platform: "web", client_version: "parity" }),
    });
    // The profile's DISPLAY name (what the app shows after a restore), not the typed username.
    let displayName = username;
    try {
      const profiles = await api("/api/v1/users/profiles", r.access_token);
      displayName = profiles.find((p) => p.id === r.user_id)?.display_name?.trim() || username;
    } catch {}
    return { ...r, username, displayName };
  }
}

let catalogue;
async function resolveRoute(route, token) {
  catalogue ??= (await api("/api/v1/catalog?limit=100", token)).items; // same for every user: ids are shared
  let r = route;
  for (const m of route.matchAll(/\{(movie|series|file):([^}]+)\}/g)) {
    const work = catalogue.find((w) => w.title === m[2]);
    if (!work) throw new Error(`fixture title not found: ${m[2]}`);
    let v = work.id;
    if (m[1] === "file") {
      const d = await api(`/api/v1/catalog/${work.id}`, token);
      v = d.media_file_id ?? d.episodes?.[0]?.media_file_id ?? d.seasons?.[0]?.episodes?.[0]?.media_file_id;
    }
    r = r.replace(m[0], v);
  }
  return r;
}

const FREEZE_CSS = `*,*::before,*::after{animation:none!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}
::-webkit-scrollbar{display:none}`;

async function runStep(page, step, layout) {
  switch (step.type) {
    case "text":
      await page.locator(step.selector).first().fill(step.value);
      break;
    case "click":
      await page.locator(step.selector).first().click();
      break;
    case "pauseAt": {
      // Paused at a fixed frame: seek, pause and wait for the frame to be presented.
      // Nudge playback (headless has no user gesture) until the first frames are buffered. play() is
      // never awaited: it can stay pending until data arrives.
      await page.waitForFunction(
        () => {
          const v = document.querySelector("video");
          if (v?.paused) v.play().catch(() => {});
          return (v?.readyState ?? 0) >= 2;
        },
        null,
        { timeout: 100000, polling: 500 }
      );
      await page.evaluate(async (t) => {
        const v = document.querySelector("video");
        v.pause();
        if (Math.abs(v.currentTime - t) > 0.01) {
          await new Promise((res) => {
            v.addEventListener("seeked", res, { once: true });
            v.currentTime = t;
            setTimeout(res, 8000);
          });
        }
        v.pause();
      }, step.seconds ?? 2);
      await page.waitForTimeout(400);
      break;
    }
    case "waitGone":
      await page.getByText(step.text).first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
      break;
    case "wait":
      await page.waitForTimeout(step.ms ?? 500);
      break;
    case "revealControls": {
      const vp = page.viewportSize();
      await page.mouse.move(vp.width / 2, vp.height / 2);
      if (layout.dpr > 1) await page.touchscreen.tap(vp.width / 2, vp.height / 2);
      await page.waitForSelector(".player-controls", { state: "visible", timeout: 10000 }).catch(() => {});
      break;
    }
    case "openQualityMenu":
      for (let i = 0; i < 4; i += 1) {
        // Controls auto-hide on a timer; keep the pointer moving, then click.
        await page.mouse.move(40 + i * 7, 300 + i * 7);
        await page.locator(".player-quality:not(.player-track-selector) > button").first().click({ timeout: 6000, force: true }).catch(() => {});
        if (await page.locator(".player-quality-menu").count()) break;
      }
      await page.waitForSelector(".player-quality-menu", { timeout: 10000 });
      break;
    default:
      throw new Error(`unknown step ${step.type}`);
  }
}

const catalogueToken = (await login(spec.user)).access_token; // used once for placeholder lookup
const routes = new Map();
for (const sc of spec.screens) routes.set(sc.id, await resolveRoute(sc.route, catalogueToken)); // resolve all up front
const manifest = { base: "<fixture>", clock: new Date(clock).toISOString(), layouts: {}, screens: [] };
const STEP_TIMEOUT_MS = 120000;

// One fresh browser, context and login per attempt: a crashed or stalled page cannot affect another screen,
// and every screen starts from identical state.
async function captureOnce(layoutId, layout, theme, screen) {
  const user = screen.user ?? spec.user;
  const s = await login(user);
  const browser = await chromium.launch({ executablePath: process.env.PARITY_CHROMIUM || undefined, args: fontFile ? ["--font-render-hinting=none"] : [] });
  try {
    const context = await browser.newContext({
      viewport: { width: layout.width, height: layout.height },
      deviceScaleFactor: layout.dpr,
      isMobile: layoutId === "mobile",
      hasTouch: layoutId === "mobile",
      reducedMotion: "reduce",
      colorScheme: theme, // prefers-color-scheme emulation, as a system theme would set it
      locale: spec.determinism.locale,
      timezoneId: spec.determinism.timezone,
    });
    if (fontCss) {
      await context.addInitScript((css) => {
        const add = () => {
          if (document.getElementById("__parity_font")) return;
          const el = document.createElement("style");
          el.id = "__parity_font";
          el.textContent = css;
          (document.head || document.documentElement).appendChild(el);
        };
        if (document.documentElement) add();
        else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); add(); } }).observe(document, { childList: true });
      }, fontCss);
    }
    await context.addInitScript(
      ({ base, s, dev, theme }) => {
        try {
          localStorage.setItem("playarr-theme", theme); // the app's own explicit theme choice (lib/theme.tsx)
          localStorage.setItem("playarr:apiBaseUrl", base);
          const session = { accessToken: s.access_token, refreshToken: s.refresh_token, tokenType: "Bearer", expiresAt: Date.now() + s.expires_in * 1000 };
          localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "parity", apiBaseUrl: base, userId: s.user_id, name: s.displayName, deviceId: dev, session }]));
          localStorage.setItem("playarr.currentUserName", s.displayName);
          localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "parity", apiBaseUrl: base, userId: s.user_id }));
        } catch {}
      },
      { base, s, dev: deviceId(user), theme }
    );
    const page = await context.newPage();
    if (safeArea.length) {
      const [top = 0, bottom = 0, left = 0, right = 0] = safeArea;
      await (await context.newCDPSession(page)).send("Emulation.setSafeAreaInsetsOverride", { insets: { top, bottom, left, right } });
    }
    // Freeze Date only after the session is seeded with a real-time expiry (the server checks real time).
    if (screen.freezeClock !== false) await page.clock.setFixedTime(clock);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // Captures must not change fixture state (an unfinished film would appear in the home rails): swallow
    // playback progress and session event writes.
    await page.route(/\/api\/v1\/playback\/(progress|[^/]+\/progress|sessions\/[^/]+\/events)/, (route) =>
      route.request().method() === "GET" ? route.continue() : route.fulfill({ status: 204, body: "" })
    );
    await page.goto(base + routes.get(screen.id), { waitUntil: "load" });
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    for (const step of screen.steps ?? []) {
      await Promise.race([runStep(page, step, layout), new Promise((_, rej) => setTimeout(() => rej(new Error(`step ${step.type} timed out`)), STEP_TIMEOUT_MS))]);
    }
    // Wait for every <img> to decode so a slow host cannot capture a page before its hero or tile pictures.
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, layoutId, theme, `${screen.id}.png`), animations: "disabled", caret: "hide" });
    return errors.length;
  } finally {
    await browser.close().catch(() => {});
  }
}

let failures = 0;
for (const layoutId of layoutIds) {
  const layout = spec.layouts[layoutId];
  if (!layout) throw new Error(`unknown layout ${layoutId}`);
  manifest.layouts[layoutId] = { width: layout.width, height: layout.height, dpr: layout.dpr };
  for (const theme of themeIds) {
    mkdirSync(join(out, layoutId, theme), { recursive: true });
    for (const screen of spec.screens.filter((sc) => !only.length || only.includes(sc.id))) {
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const pageErrors = await captureOnce(layoutId, layout, theme, screen);
          manifest.screens.push({ layout: layoutId, theme, id: screen.id, route: screen.route, user: screen.user ?? spec.user, file: `${layoutId}/${theme}/${screen.id}.png`, pageErrors });
          console.log(`ok   ${layoutId}/${theme}/${screen.id}${attempt > 1 ? `  (attempt ${attempt})` : ""}`);
          lastError = undefined;
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (lastError) {
        failures += 1;
        console.error(`FAIL ${layoutId}/${theme}/${screen.id}: ${String(lastError.message).split("\n")[0]}`);
      }
    }
  }
}
// Merge with an earlier manifest so that re-capturing a few screens (--screens) keeps the others listed.
try {
  const prev = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  manifest.layouts = { ...prev.layouts, ...manifest.layouts };
  const key = (e) => `${e.layout}/${e.theme}/${e.id}`;
  const mine = new Set(manifest.screens.map(key));
  manifest.screens = [...prev.screens.filter((e) => !mine.has(key(e))), ...manifest.screens];
} catch {}
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.exit(failures ? 1 : 0);
