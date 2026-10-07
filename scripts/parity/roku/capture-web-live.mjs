#!/usr/bin/env node
// Live web reference for the Roku: the web TV client (1920x1080, the Android TV identity) against a REAL server, signed in as the
// account the device itself uses, so the Roku capture and this capture show the same data.
//
//   PLAYARR_DEVICE_TEST_USERNAME=<user> PLAYARR_DEVICE_TEST_PASSWORD=<password> \
//     node scripts/parity/roku/capture-web-live.mjs --base https://<server> --out <dir> [--theme light|dark|both] [--screens a,b]
//
// Writes <out>/tv/<theme>/<id>.png in the layout scripts/parity/diff.mjs reads (diff the Roku capture against it with the same
// --mask-rect for the clock). Unlike capture-web.mjs nothing is frozen: the clock and rails are live, so mask them identically on
// both sides. The credentials come from the environment and are never printed or written.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const base = (opt("base", "") ?? "").replace(/\/$/, "");
const out = resolve(opt("out", ""));
const themeOpt = opt("theme", "both");
const themes = themeOpt === "both" ? ["light", "dark"] : [themeOpt];
const only = (opt("screens", "") ?? "").split(",").filter(Boolean);
const username = process.env.PLAYARR_DEVICE_TEST_USERNAME;
const password = process.env.PLAYARR_DEVICE_TEST_PASSWORD;
if (!base || !opt("out") || !username || !password) {
  console.error("usage: PLAYARR_DEVICE_TEST_USERNAME=.. PLAYARR_DEVICE_TEST_PASSWORD=.. capture-web-live.mjs --base <url> --out <dir> [--theme ..] [--screens ..]");
  process.exit(2);
}
const UA = "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0";
const DEVICE = "6f1f2d2e-0b7e-4d6e-9d52-0a9e47ad0042";

async function api(path, token, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}`);
  return res.json();
}
async function login() {
  const r = await api("/api/v1/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ username, password, device_id: DEVICE, device_name: "roku-parity-web", client_platform: "web", client_version: "parity" }),
  });
  let displayName = username;
  try {
    const profiles = await api("/api/v1/users/profiles", r.access_token);
    displayName = profiles.find((p) => p.id === r.user_id)?.display_name?.trim() || username;
  } catch {}
  return { ...r, displayName };
}

// The first film and first series in the A-Z library order the Roku shows.
const first = async (kind, token) => {
  const items = (await api(`/api/v1/catalog?kind=${kind}&available_only=true&limit=200`, token)).items ?? [];
  const key = (t) => (/^[0-9]/.test(t) ? "0" + t : t.toLowerCase());
  return items.sort((a, b) => key(a.title).localeCompare(key(b.title), "en", { numeric: true }))[0];
};
const seed = await login();
const film = await first("movie", seed.access_token);
const series = await first("series", seed.access_token);

const screens = [
  { id: "home", route: "/" },
  { id: "movies", route: "/movies" },
  { id: "series", route: "/series" },
  { id: "film-detail", route: `/movies/${film?.id}` },
  { id: "series-detail", route: `/series/${series?.id}` },
  { id: "search", route: "/search" },
  { id: "calendar", route: "/calendar" },
  { id: "watchlist", route: "/watchlist" },
  { id: "requests", route: "/requests" },
  { id: "settings", route: "/settings" },
  { id: "settings-avatar", route: "/settings/profile-avatar" },
  { id: "settings-language", route: "/settings/language" },
  { id: "settings-player", route: "/settings/player" },
  { id: "settings-server", route: "/settings/server" },
  { id: "settings-lock", route: "/settings/profile-lock" },
  { id: "settings-invite", route: "/settings/invite" },
  { id: "settings-remote", route: "/settings/remote" },
  { id: "settings-latency", route: "/settings/request-latency" },
  { id: "settings-your-data", route: "/settings/your-data" },
  { id: "profile-switcher", route: "/profiles" },
];

const browser = await chromium.launch({ executablePath: process.env.PARITY_CHROMIUM || undefined });
let failures = 0;
try {
  for (const theme of themes) {
    mkdirSync(join(out, "tv", theme), { recursive: true });
    for (const screen of screens.filter((s) => !only.length || only.includes(s.id))) {
      try {
        const s = await login();
        const context = await browser.newContext({ userAgent: UA, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: theme, locale: "en-GB" });
        await context.addInitScript(({ base, s, dev, theme }) => {
          try {
            localStorage.setItem("playarr-theme", theme);
            localStorage.setItem("playarr:apiBaseUrl", base);
            const session = { accessToken: s.access_token, refreshToken: s.refresh_token, tokenType: "Bearer", expiresAt: Date.now() + s.expires_in * 1000 };
            localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "parity", apiBaseUrl: base, userId: s.user_id, name: s.displayName, deviceId: dev, session }]));
            localStorage.setItem("playarr.currentUserName", s.displayName);
            localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "parity", apiBaseUrl: base, userId: s.user_id }));
          } catch {}
        }, { base, s, dev: DEVICE, theme });
        const page = await context.newPage();
        await page.route(/\/api\/v1\/playback\/(progress|[^/]+\/progress|sessions\/[^/]+\/events)/, (route) =>
          route.request().method() === "GET" ? route.continue() : route.fulfill({ status: 204, body: "" })
        );
        await page.goto(base + screen.route, { waitUntil: "load" });
        await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}::-webkit-scrollbar{display:none}" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(out, "tv", theme, `${screen.id}.png`), animations: "disabled", caret: "hide" });
        await context.close();
        console.log(`ok   tv/${theme}/${screen.id}`);
      } catch (e) {
        failures += 1;
        console.error(`FAIL tv/${theme}/${screen.id}: ${String(e.message).split("\n")[0]}`);
      }
    }
  }
} finally {
  await browser.close().catch(() => {});
}
process.exit(failures ? 1 : 0);
