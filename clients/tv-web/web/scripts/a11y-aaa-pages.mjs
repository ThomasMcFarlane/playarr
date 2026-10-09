#!/usr/bin/env node
// WCAG 2.2 AAA audit of the real pages. Serves the built bundle against the deterministic mock API
// (scripts/nav-perf/server.mjs) or, with --base, a fixture server (scripts/fixtures/up.sh with PLAYARR_WEB_ASSETS_DIR),
// opens every page and key state in both themes and runs axe-core with the A, AA and AAA rule tags
// (color-contrast-enhanced: 7:1, 4.5:1 large). It also probes two AAA criteria axe has no rule for:
//   2.5.5 target size (every visible pointer target is at least 44x44 CSS px; text links inside a sentence are exempt), and
//   2.4.13 focus appearance (Tab to each control: the indicator is at least 2px thick and 3:1 against the surface; media
//         cards use the owner-ruled lift and shadow and are listed separately).
//
//   node scripts/a11y-aaa-pages.mjs [--dist dist] [--base http://127.0.0.1:18484] [--only id] [--layouts tv1920,tv1280,mobile]
//                                   [--json out.json] [--baseline scripts/a11y-aaa-pages-baseline.json] [--update-baseline]
// With --baseline the run fails on any violation key the baseline does not list (shrink the baseline, never grow it).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import jpeg from "jpeg-js";
import { launchChromium } from "./chromium-launch.mjs";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const DIST = resolve(root, opt("dist", "dist"));
const BASE = opt("base", "");
const ONLY = opt("only", "");
const LAYOUTS = { tv1920: { width: 1920, height: 1080, userAgent: "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0" }, tv1280: { width: 1280, height: 720 }, mobile: { width: 390, height: 844, isMobile: true, hasTouch: true } };
const layoutNames = opt("layouts", "tv1920,tv1280,mobile").split(",");
const THEMES = ["light", "dark"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "wcag2aaa"];
const IGNORED = new Set(["landmark-one-main", "page-has-heading-one", "region", "landmark-unique", "bypass"]);
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

// Pages and states. {movie} / {series} / {artist} resolve to the first catalogue id of that kind.
const click = (selector) => ({ click: selector });
const PAGES = [
  { id: "home", route: "/" },
  { id: "movies", route: "/movies" },
  { id: "series", route: "/series" },
  { id: "music", route: "/music" },
  { id: "artist", route: "/music/{artist}" },
  { id: "film-detail", route: "/movies/{movie}" },
  { id: "series-detail", route: "/series/{series}" },
  { id: "search", route: "/search", steps: [{ type: "input[type=search], input[type=text]", text: "e" }] },
  { id: "search-empty", route: "/search", steps: [{ type: "input[type=search], input[type=text]", text: "zzzzqqq" }] },
  { id: "calendar-month", route: "/calendar?view=month" },
  { id: "calendar-week", route: "/calendar?view=week" },
  { id: "calendar-agenda", route: "/calendar?view=agenda" },
  { id: "playlists", route: "/playlists" },
  { id: "folders", route: "/folders" },
  { id: "downloads", route: "/downloads" },
  { id: "watchlist", route: "/watchlist" },
  { id: "requests", route: "/requests" },
  { id: "settings", route: "/settings" },
  ...["appearance", "profile-avatar", "language", "player", "server", "profile-lock", "invite", "request-latency", "remote", "your-data", "home"].map((s) => ({ id: `settings-${s}`, route: `/settings/${s}` })),
  { id: "profiles", route: "/profiles" },
  { id: "login", route: "/login", anonymous: true },
  { id: "login-qr", route: "/login/qr", anonymous: true },
  { id: "signup", route: "/signup", anonymous: true },
  { id: "link", route: "/link", anonymous: true },
  { id: "household", route: "/household" },
  { id: "clients", route: "/clients" },
  { id: "legal-privacy", route: "/legal/privacy", anonymous: true },
  { id: "not-found", route: "/no-such-page" },
  { id: "movies-filters-drawer", route: "/movies", steps: [click("button[aria-controls], .page-filters-button, .tv-filter-launcher")] },
  { id: "playlists-create-panel", route: "/playlists", steps: [click("button[aria-controls='create-panel']")] },
  { id: "player-controls", route: "/player/{file}", steps: [{ reveal: true }] },
  { id: "player-quality-menu", route: "/player/{file}", steps: [{ reveal: true }, click(".player-quality:not(.player-track-selector) > button")] },
  { id: "player-track-menu", route: "/player/{file}", steps: [{ reveal: true }, click(".player-track-selector > button")] },
  { id: "calendar-filters-panel", route: "/calendar?view=month", steps: [click("button[aria-controls]")] },
];

let failed = 0;
const server = BASE ? null : await startServer({ distDir: DIST, seasons: 2, seasonEpisodes: 4, canDownload: true, playlists: 3, folders: true, watchlist: 4 });
const base = BASE || `http://127.0.0.1:${server.port}`;
const browser = await launchChromium();

async function session() {
  if (!BASE) return { access_token: "t", refresh_token: "r", expires_in: 86400, user_id: "00000000-0000-4000-8000-000000000001" };
  const password = readFileSync(join(root, "../../../scripts/fixtures/catalog.mjs"), "utf8").match(/FIXTURE_PASSWORD = "([^"]+)"/)[1];
  const res = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "fx-viewer", password, device_id: "11111111-1111-4111-8111-111111111111", device_name: "a11y", client_platform: "web", client_version: "a11y" }) });
  return res.json();
}
const s = await session();
const get = async (path) => (await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${s.access_token}` } })).json();
const firstOf = async (kind) => { try { return (await get(`/api/v1/catalog?kind=${kind}&limit=1`)).items?.[0]?.id ?? ""; } catch { return ""; } };
const ids = { movie: await firstOf("movie"), series: await firstOf("series"), artist: await firstOf("artist") };
try { const d = await get(`/api/v1/catalog/${ids.movie}`); ids.file = d.media_file_id ?? d.episodes?.[0]?.media_file_id ?? ""; } catch { ids.file = ""; }

const found = [];
const probes = [];
for (const layout of layoutNames) {
  const size = LAYOUTS[layout];
  for (const theme of THEMES) {
    const context = await browser.newContext({ ...(size.userAgent ? { userAgent: size.userAgent } : {}), viewport: { width: size.width, height: size.height }, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch, reducedMotion: "reduce", colorScheme: theme });
    await context.addInitScript(({ base, s, theme }) => {
      try {
        localStorage.setItem("playarr-theme", theme);
        localStorage.setItem("playarr:apiBaseUrl", base);
        if (!/^\/(login|signup|link|legal)/.test(location.pathname)) {
          const session = { accessToken: s.access_token, refreshToken: s.refresh_token, tokenType: "Bearer", expiresAt: Date.now() + s.expires_in * 1000 };
          localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "a11y", apiBaseUrl: base, userId: s.user_id, name: "Viewer", deviceId: "a11y-device", session }]));
          localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "a11y", apiBaseUrl: base, userId: s.user_id }));
        }
      } catch {}
    }, { base, s, theme });
    const page = await context.newPage();
    for (const def of PAGES) {
      if (ONLY && !def.id.includes(ONLY)) continue;
      const route = def.route.replace(/\{(movie|series|artist|file)\}/g, (_, k) => ids[k] || "missing");
      const label = `${def.id}|${theme}|${layout}`;
      await page.goto(`${base}${route}`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(500);
      for (const step of def.steps ?? []) {
        if (step.reveal) { const vp = page.viewportSize(); for (let i = 0; i < 3; i += 1) await page.mouse.move(vp.width / 2 + i * 9, vp.height / 2 + i * 7); await page.waitForSelector(".player-controls", { state: "visible", timeout: 8000 }).catch(() => {}); }
        if (step.click) await page.locator(step.click).first().click({ timeout: 4000 }).catch(() => {});
        if (step.type) await page.locator(step.type).first().fill(step.text).catch(() => {});
        await page.waitForTimeout(600);
      }
      await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
      await page.evaluate(axeSource);
      const result = await page.evaluate(async (tags) => {
        // eslint-disable-next-line no-undef
        const r = await axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"] });
        window.__axeIncomplete = r.incomplete.filter((v) => /^color-contrast/.test(v.id)).flatMap((v) => v.nodes.map((n) => ({ rule: v.id, target: n.target.join(" "), key: (n.any[0] ?? n.all[0] ?? n.none[0])?.data?.messageKey ?? "" })));
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, aaa: v.tags.includes("wcag2aaa"), nodes: v.nodes.map((n) => { const d = (n.any[0] ?? n.all[0] ?? n.none[0])?.data ?? {}; return { target: n.target.join(" "), html: n.html.slice(0, 140), fg: d.fgColor, bg: d.bgColor, ratio: d.contrastRatio, need: d.expectedContrastRatio, size: d.fontSize, weight: d.fontWeight }; }) }));
      }, TAGS);
      for (const v of result) {
        if (IGNORED.has(v.id)) continue;
        found.push({ key: `${label}|${v.id}`, page: def.id, theme, layout, rule: v.id, impact: v.impact, aaa: v.aaa, nodes: v.nodes.length, all: v.nodes });
      }
      // Text over images: axe cannot resolve an image background, so measure the pixels under the text instead.
      const incompletes = await page.evaluate(() => window.__axeIncomplete ?? []);
      const overImage = incompletes.filter((n) => /bgImage|imgNode|bgGradient|bgOverlap/.test(n.key)).slice(0, 40);
      if (overImage.length) {
        const style = await page.addStyleTag({ content: "*,*::before,*::after{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}" });
        const measured = [];
        for (const item of overImage) {
          const info = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return { x: r.x, y: r.y, w: r.width, h: r.height, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10), fg: el.__fg ?? null, id: sel };
          }, item.target).catch(() => null);
          if (!info || info.w < 2 || info.h < 2 || info.y + info.h < 0 || info.y > size.height) continue;
          measured.push({ ...item, ...info });
        }
        // Foreground colours were hidden by the style above: read them from a fresh, unhidden style context.
        await style.evaluate((n) => n.remove());
        for (const m of measured) {
          m.fg = await page.evaluate((sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).color : null; }, m.target);
          m.opacity = await page.evaluate((sel) => { let o = 1; for (let el = document.querySelector(sel); el; el = el.parentElement) o *= parseFloat(getComputedStyle(el).opacity); return o; }, m.target);
        }
        const hide = await page.addStyleTag({ content: "*,*::before,*::after{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}" });
        const bad = [];
        for (const m of measured) {
          const clip = { x: Math.max(0, m.x), y: Math.max(0, m.y), width: Math.min(m.w, size.width - Math.max(0, m.x)), height: Math.min(m.h, size.height - Math.max(0, m.y)) };
          if (clip.width < 2 || clip.height < 2) continue;
          const buf = await page.screenshot({ type: "jpeg", quality: 100, clip });
          const img = jpeg.decode(buf, { useTArray: true });
          const rgba = (m.fg.match(/[\d.]+/g) ?? [0, 0, 0, 1]).map(Number);
          const a = (rgba[3] ?? 1) * (m.opacity ?? 1);
          const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
          const ratios = [];
          for (let i = 0; i < img.data.length; i += 4 * 3) {
            const [pr, pg, pb] = [img.data[i], img.data[i + 1], img.data[i + 2]];
            const fr = rgba[0] * a + pr * (1 - a), fgc = rgba[1] * a + pg * (1 - a), fb = rgba[2] * a + pb * (1 - a);
            const l1 = lum(fr, fgc, fb), l2 = lum(pr, pg, pb);
            ratios.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
          }
          ratios.sort((x, y) => x - y);
          const p5 = ratios[Math.floor(ratios.length * 0.05)] ?? 21;
          const large = m.size >= 24 || (m.size >= 18.66 && m.weight >= 700);
          const need = large ? 4.5 : 7;
          if (p5 < need) bad.push({ target: m.target, fg: m.fg, ratio: Math.round(p5 * 100) / 100, need, size: m.size, weight: m.weight });
        }
        await hide.evaluate((n) => n.remove());
        if (bad.length) found.push({ key: `${label}|text-over-image`, page: def.id, theme, layout, rule: "text-over-image", impact: "serious", aaa: true, nodes: bad.length, all: bad });
      }
      // 2.5.5 target size and 2.4.13 focus appearance probes.
      const probe = await page.evaluate(() => {
        const small = [];
        const sel = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=menuitem],[role=option],[tabindex]:not([tabindex="-1"])';
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none" || el.closest("[hidden],[inert],[aria-hidden=true]")) continue;
          if (r.bottom < 0 || r.right < 0 || r.top > innerHeight * 3) continue;
          if (r.width >= 44 && r.height >= 44) continue;
          if (el.tagName === "A" && el.closest("p,li,span:not([class])") && cs.display === "inline") continue;
          small.push({ target: `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 3).join(".")}`, w: Math.round(r.width), h: Math.round(r.height), text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30) });
        }
        return small;
      });
      if (probe.length) probes.push({ key: `${label}|target-size-44`, page: def.id, theme, layout, rule: "target-size-44", aaa: true, nodes: probe.length, all: probe });
      if (layout !== "mobile") {
        await page.evaluate(() => { document.body.dataset.inputMode = "keyboard"; if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
        const weak = [];
        for (let i = 0; i < 30; i += 1) {
          await page.keyboard.press("Tab");
          const f = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const cs = getComputedStyle(el);
            const card = el.matches(".media-card, .tv-title-card, .tv-home-card, .tv-search-result, [class*='card']");
            const ow = parseFloat(cs.outlineWidth) || 0;
            const hasRing = cs.outlineStyle !== "none" && ow >= 2;
            const shadowRing = /\d+px 0px 0px \d+px/.test(cs.boxShadow) || /0px 0px 0px \d+px/.test(cs.boxShadow);
            const parse = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]; return m; };
            const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
            let bg = "rgb(255,255,255)";
            for (let p = el.parentElement; p; p = p.parentElement) { const b = getComputedStyle(p).backgroundColor; if (parse(b)[3] === undefined || parse(b)[3] > 0.9) { bg = b; break; } }
            const l1 = lum(cs.outlineColor), l2 = lum(bg);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            return { target: `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 3).join(".")}`, card, ring: hasRing, shadowRing, width: ow, ratio: Math.round(ratio * 100) / 100, text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30) };
          });
          if (!f) break;
          if (!f.ring && !f.shadowRing && !f.card) weak.push({ ...f, reason: "no focus ring of 2px or more" });
          else if (f.ring && f.ratio < 3) weak.push({ ...f, reason: `ring contrast ${f.ratio}:1` });
          else if (f.card && !f.ring) weak.push({ ...f, reason: "media card: lift and shadow only (owner ruling Q13)" });
        }
        if (weak.length) probes.push({ key: `${label}|focus-appearance`, page: def.id, theme, layout, rule: "focus-appearance", aaa: true, nodes: weak.length, all: weak });
      }
    }
    await context.close();
  }
}
await browser.close();
server?.close?.();

const all = [...found, ...probes];
const jsonOut = opt("json", "");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ids, layouts: layoutNames, found: all }, null, 1));
const byRule = new Map();
for (const f of all) { const e = byRule.get(f.rule) ?? { renders: 0, nodes: 0 }; e.renders += 1; e.nodes += f.nodes; byRule.set(f.rule, e); }
console.log(`a11y AAA pages: ${PAGES.length} pages x ${THEMES.length} themes x ${layoutNames.length} layouts`);
for (const [rule, e] of [...byRule].sort((a, b) => b[1].nodes - a[1].nodes)) console.log(`  ${rule}: ${e.nodes} node(s) in ${e.renders} render(s)`);
const baselinePath = opt("baseline", "");
// The two probes are reported but only axe rules gate: the target-size and card-focus findings are tracked in the baseline too.
const gating = all;
if (args.includes("--update-baseline") && baselinePath) {
  writeFileSync(resolve(root, baselinePath), JSON.stringify({ note: "Known AAA violations on the pages. Shrink only.", keys: gating.map((f) => f.key).sort() }, null, 1) + "\n");
  console.log(`baseline written: ${gating.length} entries`);
  process.exit(0);
}
let problems = [];
if (baselinePath) {
  const allowed = new Set(JSON.parse(readFileSync(resolve(root, baselinePath), "utf8")).keys);
  for (const f of gating) if (!allowed.has(f.key)) problems.push(`new violation ${f.key} (${f.nodes} node(s)) e.g. ${JSON.stringify(f.all[0]).slice(0, 220)}`);
} else problems = gating.map((f) => `${f.key} (${f.nodes} node(s)) e.g. ${JSON.stringify(f.all[0]).slice(0, 220)}`);
if (problems.length) { console.error(`\n${problems.length} problem(s):`); for (const p of problems.slice(0, 200)) console.error(`  - ${p}`); process.exit(1); }
console.log("a11y AAA pages passed");
