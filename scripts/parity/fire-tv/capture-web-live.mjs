#!/usr/bin/env node
// Live web reference for the real-device parity run: the web TV layout (1920x1080) against a REAL server, signed in as
// the device test account, captured in the same run as the device so both show the same live data.
//
//   PLAYARR_PARITY_USER=... PLAYARR_PARITY_PASSWORD=... \
//   node capture-web-live.mjs --base https://server.example:8484 --web-dist <built web client> --out <dir> [--theme light|dark|both] [--screens home,movies] [--dump-dom]
//
// The real server does not serve the TV web client, so --web-dist (a `vite build` of clients/tv-web/web) is served from
// a local port (--port, default 18795) and pointed at the server, the way the hosted web app talks to any server.

// Writes <out>/tv/<theme>/<id>.png and <out>/manifest.json (maskRects for the clock and other live regions, in CSS px;
// diff.mjs ignores them in both images). Nothing from the real library is committed: the output directory belongs in
// a scratch location. Credentials come from the environment only and are never printed.
//
// The screens are the ones the device can reach with the remote. A title page is reached the way the remote reaches it:
// the first card of the library grid, so web and device open the same title by construction.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { existsSync, statSync } from "node:fs";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, "../screens.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const base = (opt("base", process.env.PLAYARR_PARITY_SERVER ?? "") ?? "").replace(/\/$/, "");
const user = process.env.PLAYARR_PARITY_USER;
const password = process.env.PLAYARR_PARITY_PASSWORD;
if (!base || !user || !password) {
  console.error("usage: PLAYARR_PARITY_USER=.. PLAYARR_PARITY_PASSWORD=.. node capture-web-live.mjs --base <server> --out <dir> [--theme light|dark|both] [--screens a,b]");
  process.exit(2);
}
const themeOpt = opt("theme", "both");
const themes = themeOpt === "both" ? spec.themes : themeOpt.split(",");
const dumpDom = args.includes("--dump-dom") || args.includes("--dump-all");
// --dump-all also records the elements below the fold (the detail pages stack their tracks vertically).
const dumpAll = args.includes("--dump-all");
const only = (opt("screens", "") ?? "").split(",").filter(Boolean);
const out = resolve(opt("out", "parity-live"));
const webDist = resolve(opt("web-dist", ""));
const port = Number(opt("port", "18795"));
if (!existsSync(join(webDist, "index.html"))) {
  console.error("--web-dist must be a built web client (it has no index.html)");
  process.exit(2);
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ttf": "font/ttf", ".json": "application/json", ".webmanifest": "application/manifest+json", ".mjs": "text/javascript" };
const staticServer = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = join(webDist, path);
  if (!file.startsWith(webDist) || !existsSync(file) || !statSync(file).isFile()) file = join(webDist, "index.html");
  const ext = file.slice(file.lastIndexOf("."));
  res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => staticServer.listen(port, "127.0.0.1", ok));
const appOrigin = `http://127.0.0.1:${port}`;
const layout = spec.layouts.tv;

// Elements that change between runs on a live server: the clock, and the version label.
// Live or device-local regions: the clock, the version, the signed-in avatar (chosen on the device) and the On deck thumbnail (a frame the server extracts, which the web shows late).
const LIVE_MASKS = [".app-clock-time", ".app-clock-date", ".app-user-version", ".app-user-avatar", '[data-navigation-focus-key^="home:primary:"] .tv-home-card-art'];

const SCREENS = [
  { id: "home", path: "/" },
  { id: "movies", path: "/movies" },
  { id: "series", path: "/series" },
  { id: "movies-filters", path: "/movies?panel=filters" },
  { id: "movies-list", path: "/movies?view=list" },
  { id: "movies-cover", path: "/movies?view=cover" },
  { id: "movies-small", path: "/movies?size=small" },
  { id: "movies-large", path: "/movies?size=large" },
  { id: "movies-cover-small", path: "/movies?view=cover&size=small" },
  { id: "movies-cover-large", path: "/movies?view=cover&size=large" },
  { id: "film-detail", path: "/movies", click: ".tv-title-card" },
  { id: "series-detail", path: "/series", click: ".tv-title-card" },
  { id: "calendar", path: "/calendar" },
  { id: "calendar-week", path: "/calendar?view=week" },
  { id: "calendar-month", path: "/calendar?view=month" },
  { id: "calendar-filters", path: "/calendar?panel=filters" },
  { id: "calendar-link", path: "/calendar?panel=link" },
  { id: "search", path: "/search", type: { selector: "input[type=search], input[type=text]", text: "fast" } },
  { id: "playlists", path: "/playlists" },
  { id: "music", path: "/music" },
  { id: "downloads", path: "/downloads" },
  { id: "watchlist", path: "/watchlist" },
  { id: "requests", path: "/requests" },
  { id: "settings", path: "/settings" },
  { id: "settings-avatar", path: "/settings/profile-avatar" },
  { id: "settings-language", path: "/settings/language" },
  { id: "settings-player", path: "/settings/player" },
  { id: "settings-server", path: "/settings/server" },
  { id: "settings-lock", path: "/settings/profile-lock" },
  { id: "settings-invite", path: "/settings/invite" },
  { id: "settings-remote", path: "/settings/remote" },
  { id: "settings-latency", path: "/settings/request-latency" },
  { id: "settings-your-data", path: "/settings/your-data" },
  { id: "profile-switcher", path: "/profiles", waitGone: "Loading profiles" },
];

const deviceId = "6e0a7d8c-5b1f-4c23-9d34-1a2b3c4d5e6f";
async function api(path, token, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}`);
  return res.json();
}
async function login() {
  const r = await api("/api/v1/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ username: user, password, device_id: deviceId, device_name: "parity-web", client_platform: "web", client_version: "parity" }),
  });
  let displayName = user;
  try {
    const profiles = await api("/api/v1/users/profiles", r.access_token);
    displayName = profiles.find((p) => p.id === r.user_id)?.display_name?.trim() || user;
  } catch {}
  return { ...r, displayName };
}

const FREEZE_CSS = `*,*::before,*::after{animation:none!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}::-webkit-scrollbar{display:none}`;

async function capture(theme, screen) {
  const s = await login();
  const browser = await chromium.launch({ ...(process.env.PARITY_CHROME_CHANNEL ? { channel: process.env.PARITY_CHROME_CHANNEL } : {}), executablePath: process.env.PARITY_CHROMIUM || undefined });
  try {
    const context = await browser.newContext({
      userAgent: layout.userAgent,
      viewport: { width: layout.width, height: layout.height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: theme,
      locale: spec.determinism.locale,
      timezoneId: process.env.PARITY_TZ || spec.determinism.timezone, // set PARITY_TZ to the device's time zone so release times read the same
    });
    await context.addInitScript(
      ({ base, s, dev, theme }) => {
        try {
          localStorage.setItem("playarr-theme", theme);
          localStorage.setItem("playarr:apiBaseUrl", base);
          const session = { accessToken: s.access_token, refreshToken: s.refresh_token, tokenType: "Bearer", expiresAt: Date.now() + s.expires_in * 1000 };
          localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "parity", apiBaseUrl: base, userId: s.user_id, name: s.displayName, deviceId: dev, session }]));
          localStorage.setItem("playarr.currentUserName", s.displayName);
          localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "parity", apiBaseUrl: base, userId: s.user_id }));
        } catch {}
      },
      { base, s, dev: deviceId, theme }
    );
    const page = await context.newPage();
    // A capture must not change the account's watch state.
    await page.route(/\/api\/v1\/playback\/(progress|[^/]+\/progress|sessions\/[^/]+\/events)/, (route) =>
      route.request().method() === "GET" ? route.continue() : route.fulfill({ status: 204, body: "" })
    );
    await page.goto(appOrigin + screen.path, { waitUntil: "load" });
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.locator(".tv-compact-loading, .tv-orbit-loader").first().waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
    // Skeleton loaders keep the final geometry, so a capture taken while one shows looks plausible but is empty.
    await page.locator(".skeleton-set").first().waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
    if (screen.waitGone) await page.getByText(screen.waitGone).first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    if (screen.type) {
      await page.locator(screen.type.selector).first().fill(screen.type.text);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    if (screen.click) {
      await page.locator(screen.click).first().click();
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
    // Lazy artwork tiles on screen show their title until the image arrives: wait for every visible tile to hold a loaded image.
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('[class*="card-art"], [class*="poster"], [class*="tile-art"]')]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 40 && r.height > 40 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
            })
            .every((el) => {
              const img = el.tagName === "IMG" ? el : el.querySelector("img");
              return !el.textContent?.trim() || (img && img.complete && img.naturalWidth > 0);
            }),
        null,
        { timeout: 20000 }
      )
      .catch(() => {});
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(out, "tv", theme, `${screen.id}.png`), animations: "disabled", caret: "hide" });
    if (dumpDom) {
      const dom = await page.evaluate((all) => {
        const rows = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1 || (!all && (r.bottom < 0 || r.top > innerHeight))) continue;
          const cs = getComputedStyle(el);
          const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 60);
          const painted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderTopWidth !== "0px" || cs.backgroundImage !== "none";
          if (!own && !painted && el.tagName !== "IMG" && el.tagName !== "svg") continue;
          rows.push({
            tag: el.tagName.toLowerCase(), cls: String(el.getAttribute("class") ?? "").slice(0, 80), text: own,
            x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
            font: own ? `${cs.fontSize}/${cs.fontWeight}/${cs.letterSpacing}/${cs.fontFamily.slice(0, 30)}` : undefined,
            color: own ? cs.color : undefined, bg: cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : undefined,
            radius: cs.borderTopLeftRadius !== "0px" ? cs.borderTopLeftRadius : undefined, opacity: cs.opacity !== "1" ? cs.opacity : undefined,
          });
        }
        return rows;
      }, dumpAll);
      mkdirSync(join(out, "tv", theme, "dom"), { recursive: true });
      writeFileSync(join(out, "tv", theme, "dom", `${screen.id}.json`), JSON.stringify(dom));
    }
    const maskRects = [];
    for (const selector of LIVE_MASKS) {
      for (const handle of await page.locator(selector).all()) {
        const box = await handle.boundingBox();
        if (box) maskRects.push([box.x - 2, box.y - 2, box.width + 4, box.height + 4].map((v) => Math.round(v * 100) / 100));
      }
    }
    return maskRects;
  } finally {
    await browser.close().catch(() => {});
  }
}

const manifest = { base: "<live>", layouts: { tv: { width: layout.width, height: layout.height, dpr: 1 } }, screens: [] };
let failures = 0;
for (const theme of themes) {
  mkdirSync(join(out, "tv", theme), { recursive: true });
  for (const screen of SCREENS.filter((sc) => !only.length || only.includes(sc.id))) {
    try {
      const maskRects = await capture(theme, screen);
      manifest.screens.push({ layout: "tv", theme, id: screen.id, route: screen.path, user: "device-test", file: `tv/${theme}/${screen.id}.png`, ...(maskRects.length ? { maskRects } : {}) });
      console.log(`ok   tv/${theme}/${screen.id}`);
    } catch (e) {
      failures += 1;
      console.error(`FAIL tv/${theme}/${screen.id}: ${String(e.message).split("\n")[0]}`);
    }
  }
}
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
staticServer.close();
process.exit(failures ? 1 : 0);
