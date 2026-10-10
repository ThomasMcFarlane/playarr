#!/usr/bin/env node
// Owner rule 2026-10-10: "Subtitles must only ever be the small design, like media pages."
// Opens every routed page that has a header subtitle at 1920x1080 and 1280x720 and checks that the subtitle carries the
// shared .page-subtitle class and has the same computed font size, weight, colour, letter spacing and case as the
// media-page kicker (.tv-detail-kicker on a film page), in both themes. Runs against the deterministic mock API, or a
// fixture server with --base.
//
// It also checks the subtitle's place: directly under the title, left-aligned with it, the same distance below it on
// every page, with Back level with the title (a subtitle that sits beside the title on one page and under it on
// another, as Settings did, fails).
//
// It also checks the subtitle's place: directly under the title, left-aligned with it, the same distance below it on
// every page, with Back level with the title (a subtitle beside the title on one page and under it on another, as on
// Settings, fails). `--device-test [--site url]` runs the same checks on the live web app as the PLAYARR_DEVICE_TEST_*
// account from ~/.secrets (credentials are never printed).
//
//   node scripts/subtitle-style-e2e.mjs [--dist dist] [--no-build] [--base http://127.0.0.1:18484] [--device-test]
//   node scripts/subtitle-style-e2e.mjs --device-test [--site https://...]   (live: logs in as the PLAYARR_DEVICE_TEST_* account
//                                                                           from ~/.secrets; credentials are never printed)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./chromium-launch.mjs";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const DIST = resolve(root, opt("dist", "dist"));
const BASE = opt("base", "");
// --device-test: the live site (--site, default the production web app) with the PLAYARR_DEVICE_TEST_* account from ~/.secrets.
const DEVICE_TEST = args.includes("--device-test");
if (!BASE && !DEVICE_TEST && !args.includes("--no-build") && !args.includes("--dist")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
let apiBase = "";
let s = { access_token: "t", refresh_token: "r", expires_in: 86400, user_id: "00000000-0000-4000-8000-000000000001" };
let server = null;
let base = BASE;
if (DEVICE_TEST) {
  const env = Object.fromEntries(readFileSync(join(homedir(), ".secrets"), "utf8").split("\n").filter((l) => /^PLAYARR_DEVICE_TEST_/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
  apiBase = env.PLAYARR_DEVICE_TEST_SERVER_URL.replace(/\/$/, "");
  const res = await fetch(`${apiBase}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: env.PLAYARR_DEVICE_TEST_USERNAME, password: env.PLAYARR_DEVICE_TEST_PASSWORD, device_id: "22222222-2222-4222-8222-222222222222", device_name: "subtitle-check", client_platform: "web", client_version: "check" }) });
  s = await res.json();
  if (!s.access_token) { console.log(`FAIL  device-test login failed (${res.status})`); process.exit(1); }
  base = opt("site", "https://playarr.app");
} else if (!BASE) {
  server = await startServer({ distDir: DIST, seasons: 2, seasonEpisodes: 4, canDownload: true, playlists: 3, folders: true, watchlist: 4 });
  base = `http://127.0.0.1:${server.port}`;
}
if (!apiBase) apiBase = base;
const get = async (path) => { try { return await (await fetch(`${apiBase}${path}`, { headers: { authorization: `Bearer ${s.access_token}` } })).json(); } catch { return {}; } };
const firstOf = async (kind) => (await get(`/api/v1/catalog?kind=${kind}&limit=1`)).items?.[0]?.id ?? "";
const ids = { movie: await firstOf("movie"), series: await firstOf("series"), artist: await firstOf("artist") };

const PAGES = [
  ["movies", "/movies"], ["series", "/series"], ["music", "/music"], ["search", "/search?q=e"], ["playlists", "/playlists"],
  ["folders", "/folders"], ["downloads", "/downloads"], ["watchlist", "/watchlist"], ["requests", "/requests"],
  ["calendar", "/calendar?view=agenda"], ["settings", "/settings"],
  ...["appearance", "profile-avatar", "language", "player", "server", "profile-lock", "invite", "request-latency", "remote", "your-data", "home"].map((x) => [`settings-${x}`, `/settings/${x}`]),
  ["film-detail", `/movies/${ids.movie}`], ["series-detail", `/series/${ids.series}`], ["artist-detail", `/music/${ids.artist}`],
];
const PROPS = ["fontSize", "fontWeight", "color", "letterSpacing", "textTransform", "fontStyle"];
const read = (props) => {
  const el = document.querySelector(".page-header-detail, .page-subtitle");
  const kicker = document.querySelector(".tv-detail-kicker");
  const pick = (node) => node ? Object.fromEntries(props.map((p) => [p, getComputedStyle(node)[p]])) : null;
  const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom }; };
  const header = document.querySelector(".page-header");
  return { subtitle: pick(el), cls: el?.className ?? null, text: el?.textContent?.trim() ?? "", kicker: pick(kicker), geo: { sub: box(el), title: box(header?.querySelector("h1")), back: box(header?.querySelector(".tv-page-back")) } };
};

const browser = await launchChromium();
let failed = 0;
let reference = null;
for (const theme of ["light", "dark"]) {
  for (const vp of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const context = await browser.newContext({ viewport: vp, colorScheme: theme, reducedMotion: "reduce" });
    await context.addInitScript(({ apiBase, s, theme }) => {
      try {
        localStorage.setItem("playarr-theme", theme);
        localStorage.setItem("playarr:apiBaseUrl", apiBase);
        const session = { accessToken: s.access_token, refreshToken: s.refresh_token, tokenType: "Bearer", expiresAt: Date.now() + s.expires_in * 1000 };
        localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: apiBase, userId: s.user_id, name: "Viewer", deviceId: "e2e-device", session }]));
        localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: apiBase, userId: s.user_id }));
      } catch {}
    }, { apiBase, s, theme });
    const page = await context.newPage();
    const results = [];
    for (const [id, route] of PAGES) {
      await page.goto(`${base}${route}`, { waitUntil: "load" });
      await page.waitForSelector(".page-header", { timeout: 20000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      results.push([id, await page.evaluate(read, PROPS)]);
    }
    // The media-page kicker is the reference; take it from the film page of this run.
    const film = results.find(([id]) => id === "film-detail")?.[1];
    reference = film?.kicker ?? null;
    if (!reference) { console.log(`FAIL  ${theme} ${vp.width}: no media-page kicker found`); failed++; }
    const gaps = new Map();
    for (const [id, r] of results) {
      if (!r.subtitle) { if (/^(movies|series|music|search|playlists|folders|downloads|watchlist|requests|calendar)$/.test(id)) console.log(`note  ${theme} ${vp.width} ${id}: no subtitle on this page state`); continue; }
      const sameClass = /\bpage-subtitle\b/.test(r.cls ?? "");
      const diffs = reference ? PROPS.filter((p) => r.subtitle[p] !== reference[p]) : PROPS;
      // Place: under the title, left-aligned with it, Back level with the title; the gap is the same on every page.
      const g = r.geo;
      const gap = g.sub && g.title ? Math.round((g.sub.top - g.title.bottom) * 10) / 10 : null;
      gaps.set(id, gap);
      const placed = Boolean(g.sub && g.title && g.back) && Math.abs(g.sub.left - g.title.left) <= 1 && gap !== null && gap >= -1 && Math.abs(g.back.top - g.title.top) <= 1;
      const ok = sameClass && diffs.length === 0 && placed;
      if (!placed) diffs.push(`place(sub=${JSON.stringify(g.sub)},title=${JSON.stringify(g.title)},back=${JSON.stringify(g.back)})`);
      if (!ok) failed++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${theme} ${vp.width} ${id}: ${r.subtitle.fontSize} ${r.subtitle.color}${ok ? "" : ` class=${r.cls} diffs=${diffs.join(",")}`}`);
    }
    const distinct = [...new Set([...gaps.values()].filter((v) => v !== null).map((v) => Math.round(v)))];
    if (distinct.length > 1) { failed++; console.log(`FAIL  ${theme} ${vp.width}: the subtitle sits ${distinct.join(" / ")}px below the title on different pages: ${JSON.stringify([...gaps])}`); }
    await context.close();
  }
}
await browser.close();
server?.close?.();
console.log(failed ? `${failed} check(s) failed` : "all subtitles share the one small style");
process.exit(failed ? 1 : 0);
