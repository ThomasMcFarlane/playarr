#!/usr/bin/env node
// WCAG AAA contrast of the shared details panel against the ACTUAL pixels behind its text (key art and edge fade).
//   node scripts/details-contrast-e2e.mjs [--dist dir] [--theme light|dark] [--layout tv|desktop] [--titles 20]
//   node scripts/details-contrast-e2e.mjs --live https://server.example [--titles 20]   (LIVE_USER / LIVE_PASSWORD env)
//
// For each text box in the panel (eyebrow, title, metadata, description, pills, buttons) the text is made transparent,
// the page is screenshotted, and the pixels under the text rectangle are sampled (median and the worst 2nd percentile
// luminance). Contrast against the text colour must be at least 7:1, or 4.5:1 for large text (24 px, or 18.66 px bold).
// Default mode serves a worst-case busy art (black and white checks) for every title; --live uses the real artwork of
// the signed-in server (Home, Movies, Series, Calendar agenda) until the requested number of distinct titles is reached.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./chromium-launch.mjs";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const DIST = opt("dist", join(root, "dist"));
const LIVE = opt("live", "");
const TITLES = Number(opt("titles", "20"));
const THEMES = opt("theme", "") ? [opt("theme", "")] : ["dark", "light"];
const LAYOUTS = { tv: { width: 1920, height: 1080 }, desktop: { width: 1280, height: 720 } };
const layoutIds = opt("layout", "") ? [opt("layout", "")] : Object.keys(LAYOUTS);
const USER_ID = "00000000-0000-4000-8000-000000000001";
let failed = 0;
let checked = 0;
const check = (name, ok, detail = "") => {
  checked += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
};

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const BUSY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#fff"/><rect x="8" y="8" width="8" height="8" fill="#fff"/><rect x="8" width="8" height="8" fill="#000"/><rect y="8" width="8" height="8" fill="#000"/></pattern></defs><rect width="640" height="360" fill="url(#p)"/></svg>`;

const server = LIVE ? null : await startServer({ distDir: DIST, seasons: 2, seasonEpisodes: 4, canDownload: false });
const base = LIVE || `http://127.0.0.1:${server.port}`;
const browser = await launchChromium();

async function liveSession() {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.LIVE_USER, password: process.env.LIVE_PASSWORD, device_id: "5d0c6a52-7a51-4e57-9a43-0a9e47ad0004", device_name: "contrast e2e", client_platform: "web", client_version: "1.0" }),
  });
  if (!res.ok) throw new Error(`live sign-in failed (${res.status})`);
  const body = await res.json();
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? "r", tokenType: "Bearer", expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, userId: body.user?.id ?? USER_ID, name: body.user?.display_name ?? "Contrast" };
}
const live = LIVE ? await liveSession() : null;

/** Text rectangles and colours in the details panel. */
const collect = (page) => page.evaluate(() => {
  const panel = document.querySelector(".details-panel");
  if (!panel) return null;
  const out = [];
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // Computed colour is rgb()/rgba(), or color(srgb r g b / a) for a color-mix.
    const rgb = /rgba?\(([^)]+)\)/.exec(cs.color)?.[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    const srgb = /color\(srgb ([^)]+)\)/.exec(cs.color)?.[1].split(/[\s/]+/).filter(Boolean).map(Number);
    const m = rgb ?? (srgb ? [srgb[0] * 255, srgb[1] * 255, srgb[2] * 255, srgb[3] ?? 1] : [0, 0, 0]);
    out.push({
      text: node.textContent.trim().slice(0, 24),
      kind: el.closest("button, .btn") ? "button" : el.closest(".status-pill") ? "pill" : el.tagName.toLowerCase(),
      x: Math.floor(r.left), y: Math.floor(r.top), w: Math.ceil(r.width), h: Math.ceil(r.height),
      color: m.slice(0, 3), alpha: m[3] ?? 1,
      size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400,
    });
  }
  return { texts: out, title: panel.querySelector("h2")?.textContent ?? "" };
});

const HIDE = "(()=>{const s=document.createElement('style');s.id='contrast-hide';s.textContent='.details-panel *{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}.details-panel{text-shadow:none!important}.details-panel .btn svg,.details-panel .btn img{visibility:hidden!important}';document.head.appendChild(s)})()";

/** Luminance samples (median and worst 2nd percentile) under each rectangle, from one screenshot. */
async function sample(page, texts) {
  await page.evaluate(HIDE);
  await page.waitForTimeout(60);
  const png = (await page.screenshot()).toString("base64");
  await page.evaluate(() => document.getElementById("contrast-hide")?.remove());
  return page.evaluate(async ({ png, texts }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return texts.map((t) => {
      const x = Math.max(0, t.x), y = Math.max(0, t.y);
      const w = Math.min(t.w, img.width - x), h = Math.min(t.h, img.height - y);
      const data = ctx.getImageData(x, y, Math.max(1, w), Math.max(1, h)).data;
      const ls = [];
      for (let i = 0; i < data.length; i += 4) ls.push(0.2126 * f(data[i]) + 0.7152 * f(data[i + 1]) + 0.0722 * f(data[i + 2]));
      ls.sort((a, b) => a - b);
      return { min: ls[Math.floor(ls.length * 0.02)], median: ls[Math.floor(ls.length / 2)], max: ls[Math.min(ls.length - 1, Math.ceil(ls.length * 0.98))] };
    });
  }, { png, texts });
}

async function measure(page, label, seen) {
  const got = await collect(page);
  if (!got || !got.title || seen.has(got.title)) return false;
  seen.add(got.title);
  const samples = await sample(page, got.texts);
  got.texts.forEach((t, i) => {
    const s = samples[i];
    const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
    const need = large ? 4.5 : 7;
    const lt = lum(t.color);
    // The worst background is the one closest to the text luminance: the darkest for dark text, the lightest for light.
    const worst = lt < s.median ? s.max : s.min;
    const atWorst = ratio(lt, worst);
    const atMedian = ratio(lt, s.median);
    check(`${label} "${got.title.slice(0, 18)}" ${t.kind} "${t.text}": ${need}:1`, atWorst >= need && atMedian >= need, `worst ${atWorst.toFixed(2)} median ${atMedian.toFixed(2)} (size ${t.size})`);
  });
  return true;
}

for (const theme of THEMES) {
  for (const id of layoutIds) {
    const { width, height } = LAYOUTS[id];
    const label = `${theme} ${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(({ base, userId, theme, live }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = live ?? { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      const uid = live?.userId ?? userId;
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId: uid, name: live?.name ?? "Perf", deviceId: "d", session: { accessToken: session.accessToken, refreshToken: session.refreshToken, tokenType: "Bearer", expiresAt: session.expiresAt } }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId: uid }));
      localStorage.setItem("playarr-theme", theme);
      document.documentElement.dataset.theme = theme;
    }, { base, userId: USER_ID, theme, live });
    const page = await context.newPage();
    if (!LIVE) await page.route("**/api/v1/artwork/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: BUSY_SVG }));

    const seen = new Set();
    const routes = [["/", ".tv-home-card"], ["/movies", ".tv-title-card"], ["/series", ".tv-title-card"], ["/calendar?view=agenda", ".calendar-entry"], ["/search?q=a", ".tv-search-result"]];
    for (const [route, ready] of routes) {
      if (seen.size >= TITLES) break;
      await page.goto(`${base}${route}`);
      try { await page.waitForSelector(ready, { timeout: 15000 }); } catch { continue; }
      await page.waitForTimeout(1500);
      const before = seen.size;
      for (let i = 0; i < 40 && seen.size - before < Math.ceil(TITLES / routes.length) + 2 && seen.size < TITLES; i += 1) {
        await page.waitForTimeout(900);
        await measure(page, `${label} ${route.split("?")[0]}`, seen);
        await page.keyboard.press(route.startsWith("/calendar") ? "ArrowDown" : "ArrowRight");
      }
    }
    check(`${label}: sampled ${seen.size} distinct titles`, seen.size >= Math.min(TITLES, LIVE ? 10 : 12), `got ${seen.size}`);
    await context.close();
  }
}

await browser.close();
server?.close?.();
console.log(`${checked - failed}/${checked} checks passed`);
process.exit(failed ? 1 : 0);
