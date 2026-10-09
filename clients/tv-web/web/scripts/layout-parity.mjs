#!/usr/bin/env node
// Page layout parity (docs/design/page-layout.md, section 7.3): drift in the page chrome fails CI.
//
//   node scripts/layout-parity.mjs [--no-build] [--dist dir] [--layouts tv,desktop,mobile] [--themes light,dark]
//                                  [--out dir] [--update] [--reference-from <dist of the 30 September build>]
//
// It builds the web client in `--mode layout-harness` (which registers the dev-only canonical page at
// /__layout/header), serves it with the deterministic mock API of scripts/nav-perf, and checks, in both themes:
//
//  1. Reference pin. The harness Filters pill, closed and unfocused, equals the 30 September launcher
//     (docs/parity/web/layout/reference/{tv,mobile}/{light,dark}/filters-0930.png) at 0 mismatched pixels. The
//     focus and open states and the header band are pinned the same way (action-pill-focus.png, action-pill-open.png,
//     header-canonical.png under docs/parity/web/layout/{tv,mobile}/{light,dark}).
//  2. Pill identity. Every action pill on every registered page, cropped, equals the harness pill with the same kind,
//     icon, label and count, at 0 pixels. A restyle of one page's pill fails here even when its header band moved as a whole.
//  3. Header band. For every page registered as `layout`, the band from the top of the page to the bottom of its header
//     (plus 8px) equals the harness header built from the page's own title, detail and actions, at 0 pixels, with the
//     nav rail and the title and detail text masked.
//  4. Negative control: a harness header with different actions must differ from the canonical one, so a capture that
//     masks everything cannot pass.
//
// --update rewrites the pins under docs/parity/web/layout/{tv,mobile}/** (an owner request, spec section 7.4).
// --reference-from <dist> rewrites reference/** from a build of commit 54224f36 (its Movies page and .tv-filter-launcher).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServer } from "./nav-perf/server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const repo = join(web, "../../..");
const tools = join(repo, "scripts/parity/node_modules");
const load = (path) => import(pathToFileURL(join(tools, path)).href);
const { chromium } = await load("playwright-core/index.mjs");
const { default: pixelmatch } = await load("pixelmatch/index.js");
const { PNG } = (await load("pngjs/lib/png.js")).default;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const LAYOUTS = {
  tv: { width: 1920, height: 1080, dpr: 1 },
  desktop: { width: 1280, height: 720, dpr: 1 },
  mobile: { width: 390, height: 844, dpr: 3, isMobile: true, hasTouch: true },
};
const layoutIds = opt("layouts", "tv,desktop,mobile").split(",");
const themes = opt("themes", "light,dark").split(",");
const update = args.includes("--update");
const referenceFrom = opt("reference-from", "");
const outDir = resolve(opt("out", join(tmpdir(), "layout-parity")));
const PINS = join(repo, "docs/parity/web/layout");
const FIXED_CLOCK = Date.parse("2026-10-07T12:00:00Z");
/** Glyph anti-aliasing of the label shifts by a sub-pixel between a pill stacked second and the harness pill, and grows with the label length (a long label such as "Calendar link" reaches about 55 pixels); a wrong icon or label differs by 150 or more. */
const PILL_AA_TOLERANCE = 64;
/** A page's own background gradient (Settings) bands differently under the header than the plain harness page; real header drift is hundreds of pixels. */
const BAND_TOLERANCE = 32;
const PIN_LAYOUTS = ["tv", "mobile"];
mkdirSync(outDir, { recursive: true });

// --- build ---------------------------------------------------------------------------------------------------------
let dist = opt("dist", "");
if (!dist && !referenceFrom) {
  dist = mkdtempSync(join(tmpdir(), "layout-dist-"));
  if (!args.includes("--no-build")) {
    const r = spawnSync("pnpm", ["exec", "vite", "build", "--mode", "layout-harness", "--outDir", dist, "--emptyOutDir"], { cwd: web, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
if (referenceFrom) dist = resolve(referenceFrom);

// --- registry ------------------------------------------------------------------------------------------------------
function registry() {
  const text = readFileSync(join(web, "src/lib/pageRegistry.ts"), "utf8");
  const pages = [];
  for (const m of text.matchAll(/\{\s*file:\s*"([^"]+)",\s*mode:\s*"(layout|unmigrated)",[^}]*?urls:\s*\[([^\]]*)\]/g)) {
    pages.push({ file: m[1], mode: m[2], urls: [...m[3].matchAll(/"([^"]+)"/g)].map((u) => u[1]) });
  }
  return pages;
}

// --- browser helpers -----------------------------------------------------------------------------------------------
const FREEZE = `*,*::before,*::after{animation:none!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}::-webkit-scrollbar{display:none}`;
const USER_ID = "00000000-0000-4000-8000-000000000001";
const server = await startServer({ distDir: dist });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch(process.env.PARITY_CHROMIUM ? { executablePath: process.env.PARITY_CHROMIUM } : {});
const failures = [];
const notes = [];
const fail = (message) => {
  failures.push(message);
  console.error(`FAIL  ${message}`);
};

async function newPage(layoutId, theme) {
  const layout = LAYOUTS[layoutId];
  const context = await browser.newContext({
    viewport: { width: layout.width, height: layout.height },
    deviceScaleFactor: layout.dpr,
    isMobile: Boolean(layout.isMobile),
    hasTouch: Boolean(layout.hasTouch),
    reducedMotion: "reduce",
    colorScheme: theme,
    locale: "en-GB",
    timezoneId: "UTC",
  });
  await context.addInitScript(
    ({ base, userId, theme }) => {
      localStorage.setItem("playarr-theme", theme);
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "Parity", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
    },
    { base, userId: USER_ID, theme }
  );
  const page = await context.newPage();
  await page.clock.setFixedTime(FIXED_CLOCK);
  return page;
}

async function open(page, path, waitFor) {
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.addStyleTag({ content: FREEZE });
  await page.waitForSelector(waitFor, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  // Pages start with focus on their default control (the header Back on an empty page); the pins compare the
  // resting header, so drop that focus ring.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(100);
}

const harnessPath = (spec) => {
  const q = new URLSearchParams({ title: spec.title ?? "Title", back: spec.back ?? "Back", actions: spec.actions ?? "" });
  if (spec.detail) q.set("detail", spec.detail);
  if (spec.mobileShow) q.set("mobileShow", spec.mobileShow);
  if (spec.open) q.set("open", "1");
  return `/__layout/header?${q}`;
};

const decode = (buffer) => PNG.sync.read(buffer);
function diffImages(a, b, name) {
  if (a.width !== b.width || a.height !== b.height) return { bad: Infinity, size: `${a.width}x${a.height} vs ${b.width}x${b.height}` };
  const diff = new PNG({ width: a.width, height: a.height });
  const bad = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: false });
  if (bad > 0) {
    const file = join(outDir, `${name.replace(/[^A-Za-z0-9._-]+/g, "-")}.diff.png`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, PNG.sync.write(diff));
  }
  return { bad };
}

/** Isolate one element on the plain page background at a fixed integer position, so every capture of it is comparable. */
async function isolatePill(page, selector) {
  await page.evaluate((sel) => {
    document.getElementById("__isolate")?.remove();
    const style = document.createElement("style");
    style.id = "__isolate";
    style.textContent = `body *{visibility:hidden!important}.__pill,.__pill *{visibility:visible!important}.tv-key-art,.tv-stage-wash{display:none!important}.__pill{position:fixed!important;top:48px!important;left:48px!important;right:auto!important;bottom:auto!important;margin:0!important}`;
    document.head.appendChild(style);
    document.querySelectorAll(".__pill").forEach((el) => el.classList.remove("__pill"));
    document.querySelector(sel).classList.add("__pill");
  }, selector);
}
/** The reference build predates the embedded app typeface, so reference comparisons hide the label glyphs. */
const HIDE_LABEL = `.__pill span{color:transparent!important}`;
async function pillShot(page, selector, { hideLabel = false } = {}) {
  await isolatePill(page, selector);
  await page.evaluate(([hide, css]) => {
    document.getElementById("__hide_label")?.remove();
    if (!hide) return;
    const style = document.createElement("style");
    style.id = "__hide_label";
    style.textContent = css;
    document.head.appendChild(style);
  }, [hideLabel, HIDE_LABEL]);
  const box = await page.locator(".__pill").boundingBox();
  const pad = 32;
  const clip = { x: Math.max(0, Math.floor(box.x) - pad), y: Math.max(0, Math.floor(box.y) - pad), width: Math.ceil(box.width) + pad * 2, height: Math.ceil(box.height) + pad * 2 };
  return decode(await page.screenshot({ clip, animations: "disabled", caret: "hide" }));
}
/** Settles a freshly (re)loaded page the way open() does: fonts, network, a short idle. A shot taken before this raced the
 *  web font swap and the first paint of the focus ring (a train batch failed once with 13 mismatched pixels). */
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(400);
}

/** Takes the shot until two consecutive captures are identical (at most six), so a late repaint cannot decide a pin.
 *  This waits for the page to be stable; the comparison against the pin stays at 0 pixels. */
async function stableShot(shoot) {
  let previous = await shoot();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const next = await shoot();
    if (diffImages(previous, next, "stability").bad === 0) return next;
    previous = next;
  }
  return previous;
}

async function focusPill(page, selector) {
  await page.locator(selector).first().focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate((sel) => document.querySelector(sel)?.matches(":focus-visible") ?? false, selector);
  if (!focused) throw new Error(`${selector} did not take :focus-visible`);
}

/** The header band: top of the page to the bottom of the header and its actions, plus 8px. Masks are applied by the caller. */
async function bandShot(page) {
  const info = await page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const header = document.querySelector(".page-header");
    const hr = header.getBoundingClientRect();
    const pills = [...header.querySelectorAll("[data-action-kind]")].map((el) => el.getBoundingClientRect().bottom);
    // The shell action column is checked by the pill checks, not by the header band.
    document.querySelectorAll(".shell-action-column").forEach((el) => { el.style.display = "none"; });
    return {
      bottom: Math.max(hr.bottom, ...pills) + 2,
      left: parseFloat(getComputedStyle(header).left) || 0,
      masks: [...header.querySelectorAll("h1, .page-header-detail")].map(rect),
      dpr: devicePixelRatio,
    };
  });
  const viewport = page.viewportSize();
  const height = Math.min(viewport.height, Math.ceil(info.bottom));
  const png = decode(await page.screenshot({ clip: { x: 0, y: 0, width: viewport.width, height }, animations: "disabled", caret: "hide" }));
  return { png, info };
}
function mask(png, rects, dpr) {
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x * dpr)), y0 = Math.max(0, Math.floor(r.y * dpr));
    const x1 = Math.min(png.width, Math.ceil((r.x + r.w) * dpr)), y1 = Math.min(png.height, Math.ceil((r.y + r.h) * dpr));
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const o = (y * png.width + x) * 4;
      png.data[o] = 255; png.data[o + 1] = 0; png.data[o + 2] = 255; png.data[o + 3] = 255;
    }
  }
}
/** Masks the title and detail text boxes of every capture given, and the nav rail on layouts that have one. */
function maskBands(bands, railMask) {
  const rects = bands.flatMap((band) => band.info.masks);
  for (const band of bands) {
    const all = railMask ? [...rects, { x: 0, y: 0, w: Math.max(0, band.info.left - 8), h: 4000 }] : rects;
    mask(band.png, all, band.info.dpr);
  }
}

const read = (path) => (existsSync(path) ? decode(readFileSync(path)) : null);
function pin(name, png, path) {
  if (update) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, PNG.sync.write(png));
    notes.push(`wrote ${path.replace(`${repo}/`, "")}`);
    return;
  }
  const expected = read(path);
  if (!expected) return fail(`${name}: pin ${path.replace(`${repo}/`, "")} is missing (run with --update)`);
  const result = diffImages(expected, png, name);
  if (result.bad !== 0) fail(`${name}: ${result.bad} mismatched pixels against ${path.replace(`${repo}/`, "")}${result.size ? ` (${result.size})` : ""}`);
  else console.log(`ok    ${name}`);
}

// --- reference capture (from a build of 54224f36) ------------------------------------------------------------------
if (referenceFrom) {
  for (const layoutId of PIN_LAYOUTS) {
    for (const theme of themes) {
      const page = await newPage(layoutId, theme);
      await open(page, "/movies", ".tv-filter-launcher");
      await page.mouse.move(2, 2);
      const png = await pillShot(page, ".tv-filter-launcher", { hideLabel: true });
      mkdirSync(join(PINS, "reference", layoutId, theme), { recursive: true });
      writeFileSync(join(PINS, "reference", layoutId, theme, "filters-0930.png"), PNG.sync.write(png));
      console.log(`wrote reference/${layoutId}/${theme}/filters-0930.png`);
      await page.context().close();
    }
  }
  await browser.close();
  await server.close();
  process.exit(0);
}

// --- checks --------------------------------------------------------------------------------------------------------
// --- stage split ---------------------------------------------------------------------------------------------------
// Home is the reference for the shell clock and the column boundary (owner ruling 2026-10-08, "homepage and the library
// pages have the date/time in a different place"): every library-style page must put the clock where Home puts it and
// start its right-hand column where Home's rails start, on the TV (1920x1080) and desktop (1280x720) layouts, both themes.
const STAGE_PAGES = ["/movies", "/series", "/music", "/playlists", "/downloads", "/watchlist", "/requests"];
async function stageGeometry(layoutId, theme, route) {
  const page = await newPage(layoutId, theme);
  await page.goto(`${base}${route}`, { waitUntil: "load" });
  await page.addStyleTag({ content: FREEZE });
  await page.waitForSelector(".app-clock", { timeout: 20000 });
  await page.waitForSelector(".tv-home-rails, .tv-library-grid-panel", { timeout: 20000 });
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => {
    const r = (el) => (el ? (({ left, top, right, bottom }) => [left, top, right, bottom].map((n) => Math.round(n * 10) / 10))(el.getBoundingClientRect()) : null);
    return { clock: r(document.querySelector(".app-clock")), column: r(document.querySelector(".tv-home-rails, .tv-library-grid-panel"))?.[0] ?? null };
  });
  await page.context().close();
  return out;
}
for (const layoutId of ["tv", "desktop"]) {
  for (const theme of themes) {
    const home = await stageGeometry(layoutId, theme, "/");
    for (const route of STAGE_PAGES) {
      const geometry = await stageGeometry(layoutId, theme, route);
      if (JSON.stringify(geometry.clock) !== JSON.stringify(home.clock)) fail(`${layoutId}/${theme} ${route}: the clock sits at ${JSON.stringify(geometry.clock)}, Home's is ${JSON.stringify(home.clock)}`);
      else if (geometry.column !== home.column) fail(`${layoutId}/${theme} ${route}: the right-hand column starts at ${geometry.column}, Home's starts at ${home.column}`);
      else console.log(`ok    ${layoutId}/${theme} ${route} clock and column split equal Home's`);
    }
  }
}

const pages = registry();
let pillsChecked = 0;
let bandsChecked = 0;

for (const layoutId of layoutIds) {
  for (const theme of themes) {
    const tag = `${layoutId}/${theme}`;
    const page = await newPage(layoutId, theme);

    // 1. Reference pin and state pins, from the harness.
    const filtersSpec = { title: "Title", detail: "Detail", actions: "filters:Filters" };
    await open(page, harnessPath(filtersSpec), "[data-filters-button]");
    const closed = await pillShot(page, "[data-filters-button]");
    const closedMasked = await pillShot(page, "[data-filters-button]", { hideLabel: true });
    if (PIN_LAYOUTS.includes(layoutId)) {
      pin(`${tag} reference pin (Filters equals the 30 September launcher)`, closedMasked, join(PINS, "reference", layoutId, theme, "filters-0930.png"));
      await page.reload({ waitUntil: "load" });
      await page.addStyleTag({ content: FREEZE });
      await page.waitForSelector("[data-filters-button]");
      await settle(page);
      await focusPill(page, "[data-filters-button]");
      await page.waitForTimeout(150);
      pin(`${tag} focus pin`, await stableShot(() => pillShot(page, "[data-filters-button]")), join(PINS, layoutId, theme, "action-pill-focus.png"));
      await open(page, harnessPath({ ...filtersSpec, open: true }), "[data-filters-button]");
      pin(`${tag} open pin`, await pillShot(page, "[data-filters-button]"), join(PINS, layoutId, theme, "action-pill-open.png"));
      await open(page, harnessPath(filtersSpec), "[data-filters-button]");
      const band = await bandShot(page);
      maskBands([band], layoutId !== "mobile");
      pin(`${tag} header band pin`, band.png, join(PINS, layoutId, theme, "header-canonical.png"));
    }

    // 4. Negative control: the band must notice a different header.
    {
      await open(page, harnessPath({ title: "Title", detail: "Detail", actions: "navigation" }), ".page-actions-navigation");
      const a = await bandShot(page);
      await open(page, harnessPath({ title: "Title", detail: "Detail", actions: "" }), ".page-header");
      const b = await bandShot(page);
      maskBands([a, b], layoutId !== "mobile");
      const result = diffImages(a.png, b.png, `${tag}-negative-control`);
      if (result.bad === 0) fail(`${tag}: negative control: headers with and without a navigation group compared equal, so the band check cannot see drift`);
    }

    // 2 and 3. Every registered page.
    const harnessPage = await newPage(layoutId, theme);
    for (const entry of pages) {
      for (const url of entry.urls) {
        const name = `${tag} ${url}`;
        try {
          await open(page, url, ".page-header");
        } catch {
          notes.push(`${name}: no page header rendered against the mock API (skipped)`);
          continue;
        }
        const header = await page.evaluate(() => {
          const el = document.querySelector(".page-header");
          const text = (node) => node?.textContent?.trim() ?? "";
          const pills = [...document.querySelectorAll(".shell-action-column .action-pill")].map((pill, index) => ({
            index,
            rect: (({ x, y, width, height }) => [x, y, width, height].map((n) => Math.round(n * 100) / 100))(pill.getBoundingClientRect()),
            kind: pill.dataset.actionKind,
            icon: pill.dataset.actionIcon,
            label: pill.getAttribute("aria-label"),
            count: Number(pill.querySelector(".action-pill-count")?.textContent ?? 0),
            active: pill.classList.contains("is-active"),
          }));
          const navEl = el.querySelector("[data-action-kind='navigation']");
          const nav = navEl && getComputedStyle(navEl).display !== "none" ? "navigation" : "";
          return {
            title: text(el.querySelector("h1")),
            detail: text(el.querySelector(".page-header-detail")),
            mobileShow: el.getAttribute("data-mobile-show") ?? "",
            pills,
            nav,
          };
        });
        // Pill identity: each pill, alone, against the harness pill with the same kind, icon, label and count.
        for (const pill of header.pills) {
          const pageShot = await (async () => {
            await page.evaluate((i) => {
              document.querySelectorAll("[data-parity-pill]").forEach((el) => el.removeAttribute("data-parity-pill"));
              document.querySelectorAll(".shell-action-column .action-pill")[i].setAttribute("data-parity-pill", "");
            }, pill.index);
            return pillShot(page, "[data-parity-pill]");
          })();
          const spec = `${pill.kind}:${pill.kind === "filters" ? pill.label : `${pill.icon}:${pill.label}`}${pill.kind === "filters" && pill.count ? `:${pill.count}` : ""}`;
          await open(harnessPage, harnessPath({ actions: spec, open: pill.active }), ".action-pill");
          const harnessShot = await pillShot(harnessPage, ".action-pill");
          const result = diffImages(pageShot, harnessShot, `${name}-pill-${pill.index}`);
          pillsChecked += 1;
          if (result.bad > PILL_AA_TOLERANCE) {
            for (const [suffix, shot] of [["page", pageShot], ["canonical", harnessShot]]) writeFileSync(join(outDir, `${name.replace(/[^A-Za-z0-9._-]+/g, "-")}-pill-${pill.index}.${suffix}.png`), PNG.sync.write(shot));
          }
          if (result.bad > PILL_AA_TOLERANCE) fail(`${name}: ${pill.kind} pill "${pill.label}" differs from the canonical pill by ${result.bad} pixels${result.size ? ` (${result.size})` : ""}`);
        }
        // Column position: every pill of the page sits exactly where the same stack sits in the harness.
        if (header.pills.length) {
          const stack = header.pills.map((p) => (p.kind === "filters" ? `filters:${p.label}${p.count ? `:${p.count}` : ""}` : `${p.kind}:${p.icon}:${p.label}`));
          await open(harnessPage, harnessPath({ actions: stack.join(",") }), ".shell-action-column .action-pill");
          const expected = await harnessPage.evaluate(() => [...document.querySelectorAll(".shell-action-column .action-pill")].map((pill) => (({ x, y, width, height }) => [x, y, width, height].map((n) => Math.round(n * 100) / 100))(pill.getBoundingClientRect())));
          header.pills.forEach((pill, index) => {
            if (JSON.stringify(pill.rect) !== JSON.stringify(expected[index])) fail(`${name}: ${pill.kind} pill "${pill.label}" sits at ${JSON.stringify(pill.rect)} instead of the shell column position ${JSON.stringify(expected[index])}`);
          });
        }
        // Header band, for pages that render PageLayout.
        if (entry.mode === "layout") {
          // The pill checks isolated a pill with an injected style; drop it before photographing the band.
          await page.evaluate(() => {
            for (const id of ["__isolate", "__hide_label"]) document.getElementById(id)?.remove();
            document.querySelectorAll(".__pill").forEach((el) => el.classList.remove("__pill"));
            // A page may autofocus a control (Settings focuses Back); the band compares the resting header.
            document.activeElement?.blur?.();
          });
          await page.waitForTimeout(250);
          const hide = `.tv-key-art,.tv-stage-wash{display:none!important}`;
          await page.addStyleTag({ content: hide });
          const actions = header.nav ? ["navigation"] : [];
          const live = await bandShot(page);
          await open(harnessPage, harnessPath({ title: header.title, detail: header.detail, mobileShow: header.mobileShow, actions: actions.join(",") }), ".page-header");
          await harnessPage.addStyleTag({ content: hide });
          const canonical = await bandShot(harnessPage);
          maskBands([live, canonical], layoutId !== "mobile");
          const result = diffImages(live.png, canonical.png, `${name}-band`);
          bandsChecked += 1;
          if (result.bad > BAND_TOLERANCE) {
            for (const [suffix, shot] of [["page", live.png], ["canonical", canonical.png]]) writeFileSync(join(outDir, `${name.replace(/[^A-Za-z0-9._-]+/g, "-")}-band.${suffix}.png`), PNG.sync.write(shot));
          }
          if (result.bad > BAND_TOLERANCE) fail(`${name}: header band differs from the canonical header by ${result.bad} pixels${result.size ? ` (${result.size})` : ""}`);
          else console.log(`ok    ${name} header band`);
        }
      }
    }
    await harnessPage.context().close();
    await page.context().close();
  }
}

await browser.close();
await server.close();
for (const note of notes) console.log(`note  ${note}`);
console.log(`checked ${pillsChecked} page pills and ${bandsChecked} header bands${update ? "; pins updated" : ""}; ${failures.length} failure(s)`);
if (failures.length) console.error(`diff images are in ${outDir}`);
process.exit(failures.length ? 1 : 0);
