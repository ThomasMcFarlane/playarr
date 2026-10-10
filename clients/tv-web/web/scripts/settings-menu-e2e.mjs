#!/usr/bin/env node
// Owner bug 2026-10-10 (row 1.9980): "the menu items get cropped on the left" on Settings. For every vertical menu list
// (the Settings section list, and the Downloads, Requests and Watchlist row lists), the focused item's full glow extent must sit
// inside the scroller's clip rect, its text must not be clipped on the left, and the item's left edge must line up with the
// page content gutter (the panel padding, +-1px, for the row lists). Also asserts #445's top fade under the page header still works.
//   node scripts/settings-menu-e2e.mjs [--dist dist] [--no-build] [--device-test [--site url]] [--out dir]
// --device-test runs on the live web app as the PLAYARR_DEVICE_TEST_* account from ~/.secrets (never printed).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./chromium-launch.mjs";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const DIST = resolve(root, opt("dist", "dist"));
const DEVICE_TEST = args.includes("--device-test");
const OUT = opt("out", "");
if (OUT) mkdirSync(OUT, { recursive: true });
if (!DEVICE_TEST && !args.includes("--no-build") && !args.includes("--dist")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
let apiBase = "";
let s = { access_token: "t", refresh_token: "r", expires_in: 86400, user_id: "00000000-0000-4000-8000-000000000001" };
let server = null;
let base = "";
if (DEVICE_TEST) {
  const env = Object.fromEntries(readFileSync(join(homedir(), ".secrets"), "utf8").split("\n").filter((l) => /^PLAYARR_DEVICE_TEST_/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
  apiBase = env.PLAYARR_DEVICE_TEST_SERVER_URL.replace(/\/$/, "");
  const res = await fetch(`${apiBase}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: env.PLAYARR_DEVICE_TEST_USERNAME, password: env.PLAYARR_DEVICE_TEST_PASSWORD, device_id: "33333333-3333-4333-8333-333333333333", device_name: "settings-menu-check", client_platform: "web", client_version: "check" }) });
  s = await res.json();
  if (!s.access_token) { console.log(`FAIL  device-test login failed (${res.status})`); process.exit(1); }
  base = opt("site", "https://playarr.app");
} else {
  server = await startServer({ distDir: DIST, seasons: 2, seasonEpisodes: 4, canDownload: true, playlists: 3, folders: true, watchlist: 4 });
  base = `http://127.0.0.1:${server.port}`;
  apiBase = base;
}

// [route, item selector inside the menu list]. The scroller is the item's nearest vertical scroll container.
const MENUS = [
  ["/settings", ".settings-option"],
  ["/downloads", ".tv-download-row"],
  ["/requests", ".tv-download-row"],
  ["/watchlist", ".tv-watchlist-row"],
  ...["appearance", "profile-avatar", "language", "player", "server", "profile-lock", "invite", "request-latency", "remote", "your-data", "home"].map((x) => [`/settings/${x}`, ".settings-detail-scroll :is(button, a[href], input, select, [role=radio], [role=option]):not([disabled])"]),
];

const measure = ([itemSel, active]) => {
  const items = active ? [document.activeElement] : [...document.querySelectorAll(itemSel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (!items.length) return { count: 0 };
  const scrollerOf = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p; } for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== "visible") return p; } return document.documentElement; };
  const pick = [0, Math.floor(items.length / 2), items.length - 1];
  const out = [];
  for (const idx of [...new Set(pick)]) {
    const el = items[idx];
    if (!active) { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); }
    const sc = scrollerOf(el);
    const clip = sc.getBoundingClientRect();
    // The fixed nav rail paints over the left edge of the page: the visible clip starts at its right edge.
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:0;top:0;width:var(--tv-nav-clearance, 0px);height:0";
    document.body.appendChild(probe);
    const railRight = probe.getBoundingClientRect().width;
    probe.remove();
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // The full glow extent: every box-shadow's blur + spread + offset on each side, plus the outline.
    let L = 0;
    const shadows = (cs.boxShadow === "none" ? "" : cs.boxShadow).split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
    for (const sh of shadows) {
      if (/inset/.test(sh)) continue;
      const nums = (sh.replace(/(rgba?|color|oklab|oklch|color-mix)\((?:[^()]|\([^)]*\))*\)/g, "").match(/(?<![\w.])-?\d*\.?\d+(?:px)?/g) ?? []).map(parseFloat);
      const [ox = 0, , blur = 0, spread = 0] = nums;
      L = Math.max(L, blur + spread - ox);
    }
    const outline = cs.outlineStyle !== "none" ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || "0") : 0;
    L = Math.max(L, outline);
    const textEls = [...el.querySelectorAll("strong, span, h2, h3, p")].filter((t) => t.textContent.trim());
    const textLeft = Math.min(...textEls.map((t) => t.getBoundingClientRect().left), r.left);
    const title = document.querySelector(".page-header h1");
    // Row lists: the page gutter is the panel's padding from the (unwidened) column edge, which is the right padding too.
    const panel = el.closest(".tv-downloads-panel");
    let gutter = null;
    if (panel) { const pr = panel.getBoundingClientRect(); const room = parseFloat(getComputedStyle(panel).getPropertyValue("--list-glow-room")) || 0; gutter = pr.left + room + parseFloat(getComputedStyle(panel).paddingRight); }
    out.push({ idx, tag: el.className, itemLeft: r.left, textLeft, clipLeft: Math.max(clip.left, railRight), clipTop: clip.top, clipBottom: clip.bottom, glowLeft: r.left - L, glow: L, lift: new DOMMatrix(cs.transform === "none" ? undefined : cs.transform).m42, gutter, scrollerClass: sc.className });
  }
  return { count: items.length, out };
};

const browser = await launchChromium();
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`); };
for (const theme of ["light", "dark"]) {
  for (const vp of opt("sizes", "1920x1080,1280x720").split(",").map((x) => { const [width, height] = x.split("x").map(Number); return { width, height }; })) {
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
    for (const [route, sel] of MENUS) {
      const label = `${theme} ${vp.width} ${route}`;
      await page.goto(`${base}${route}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await page.keyboard.press("Shift");
      let m = await page.evaluate(measure, [sel, false]);
      if (route === "/settings" && m.count) {
        // Real keyboard focus (:focus-visible from the arrow keys), first, middle and last option.
        const out = [];
        await page.evaluate((q) => { const e = document.querySelector(q); e.scrollIntoView({ block: "start" }); e.focus({ preventScroll: true }); }, sel);
        await page.keyboard.press("Shift");
        let at = 0;
        for (const idx of [...new Set([0, Math.floor(m.count / 2), m.count - 1])]) {
          while (at < idx) { await page.keyboard.press("ArrowDown"); at++; await page.waitForTimeout(120); }
          await page.waitForTimeout(500);
          const k = await page.evaluate(measure, [sel, true]);
          const fv = await page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false);
          if (!fv) { check(`${label} item ${idx}: real keyboard focus is :focus-visible`, false, "not focus-visible"); continue; }
          if (k.out?.[0]) out.push({ ...k.out[0], idx });
        }
        m = { count: m.count, out };
      }
      if (!m.count) { console.log(`note  ${label}: no items for ${sel}`); continue; }
      for (const o of m.out) {
        const tag = `${label} item ${o.idx}/${m.count}`;
        check(`${tag}: full glow (${o.glow.toFixed(0)}px) inside the clip rect`, o.glowLeft >= o.clipLeft - 0.5, `glowLeft=${o.glowLeft} clipLeft=${o.clipLeft} scroller=${o.scrollerClass}`);
        if (route === "/settings") check(`${tag}: focus uses the shared card treatment (glow ${o.glow.toFixed(0)}px, lift ${o.lift}px)`, o.glow >= 40 && o.lift < 0, "plain outline, no card glow or lift");
        check(`${tag}: text not clipped on the left`, o.textLeft >= o.clipLeft, `textLeft=${o.textLeft} clipLeft=${o.clipLeft}`);
        if (o.gutter !== null) check(`${tag}: left edge on the page content gutter`, Math.abs(o.itemLeft - o.gutter) <= 1, `itemLeft=${o.itemLeft} gutter=${o.gutter}`);
      }
      if (OUT) await page.screenshot({ path: join(OUT, `${theme}-${vp.width}-${route.replace(/\W/g, "") || "root"}.png`) });
    }
    if (!DEVICE_TEST || true) {
      // #445: the settings list still fades under the header once scrolled.
      await page.goto(`${base}/settings`, { waitUntil: "load" });
      await page.waitForTimeout(1200);
      const fade = await page.evaluate(async () => {
        const e = document.querySelector(".settings-options-scroll");
        if (!e || e.scrollHeight <= e.clientHeight + 1) return { skip: true };
        e.scrollTop = 400;
        await new Promise((r) => setTimeout(r, 500));
        const cs = getComputedStyle(e);
        return { start: e.dataset.fadeStart !== undefined, mask: (cs.webkitMaskImage || cs.maskImage) !== "none" };
      });
      if (!fade.skip) check(`${theme} ${vp.width} /settings: top fade under the header when scrolled`, fade.start && fade.mask, JSON.stringify(fade));
    }
    await context.close();
  }
}
await browser.close();
server?.close?.();
console.log(failed ? `${failed} check(s) failed` : "settings menus are not cropped");
process.exit(failed ? 1 : 0);
