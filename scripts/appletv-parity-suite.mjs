#!/usr/bin/env node
/**
 * Screen-by-screen visual parity suite: native tvOS Simulator screenshots
 * vs Playwright captures of the web client at 1920×1080. The web client is the
 * local fixture environment (scripts/fixtures/up.sh, placeholder library only);
 * never point this at a real library.
 *
 * Usage:
 *   node scripts/appletv-parity-suite.mjs --run-dir <dir> [--native-dir <dir>]
 *   node scripts/appletv-parity-suite.mjs --reference-only --run-dir <dir>
 *   node scripts/appletv-parity-suite.mjs --diff-only --run-dir <dir>
 *
 * Environment:
 *   PLAYARR_WEB_ORIGIN  (default http://127.0.0.1:18484, the fixture server)
 *   PARITY_USER / PARITY_PASSWORD  sign in before capturing (fixture user, e.g. fx-viewer;
 *                                  the password is in scripts/fixtures/catalog.mjs)
 *   PARITY_TOLERANCE_PCT (default 0.1)
 */
import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatchImport from "pixelmatch";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pixelmatch = pixelmatchImport.default || pixelmatchImport;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const WEB_ORIGIN = process.env.PLAYARR_WEB_ORIGIN || "http://127.0.0.1:18484";
const TOLERANCE_PCT = Number(process.env.PARITY_TOLERANCE_PCT || "0.1");
const VIEWPORT = { width: 1920, height: 1080 };

/**
 * Required suite screens (plan acceptance criteria).
 * `webPath` is the route on the fixture web client.
 * `nativeFile` is the expected native screenshot basename (without .png).
 * `note` documents known mapping caveats.
 */
export const SCREENS = [
  {
    id: "device-code-pairing",
    webPath: "/login?platform=android-tv",
    nativeFile: "device-code-pairing",
    note: "TV device-code display (SPA DeviceLogin / native pairing fixture). Not phone /link form.",
  },
  {
    id: "home-recently-added",
    webPath: "/",
    nativeFile: "home-recently-added",
    note: "Unauthenticated web redirects to profiles; signed-in shows home rails.",
  },
  {
    id: "search",
    webPath: "/search",
    nativeFile: "search",
    note: "Search surface.",
  },
  {
    id: "detail-movie",
    webPath: "/movies",
    nativeFile: "detail-movie",
    note: "Movie library/detail; deep-link to a specific work when catalog IDs known.",
  },
  {
    id: "detail-episode",
    webPath: "/series",
    nativeFile: "detail-episode",
    note: "Series library / episode list.",
  },
  {
    id: "detail-track",
    webPath: "/music",
    nativeFile: "detail-track",
    note: "Music library / track list.",
  },
  {
    id: "detail-book",
    webPath: "/library",
    nativeFile: "detail-book",
    note: "Books map to library/author detail when present.",
  },
  {
    id: "player",
    webPath: "/player/",
    nativeFile: "player",
    note: "Player chrome (SPA PlayerScreen). Requires auth+mediaFileId; suite may inject chrome when live media unavailable.",
  },
  {
    id: "settings",
    webPath: "/settings",
    nativeFile: "settings",
    note: "Settings index.",
  },
];

function parseArgs(argv) {
  const args = {
    runDir: null,
    nativeDir: null,
    referenceOnly: false,
    diffOnly: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-dir") args.runDir = argv[++i];
    else if (a === "--native-dir") args.nativeDir = argv[++i];
    else if (a === "--reference-only") args.referenceOnly = true;
    else if (a === "--diff-only") args.diffOnly = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readPng(filePath) {
  const buf = fs.readFileSync(filePath);
  return PNG.sync.read(buf);
}

function writePng(filePath, png) {
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function diffPair(refPath, nativePath, diffPath) {
  if (!fs.existsSync(refPath)) {
    return { ok: false, error: `missing reference: ${refPath}`, pct: 100, ae: -1 };
  }
  if (!fs.existsSync(nativePath)) {
    return { ok: false, error: `missing native: ${nativePath}`, pct: 100, ae: -1 };
  }
  const img1 = readPng(refPath);
  const img2 = readPng(nativePath);
  const width = Math.min(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);
  if (img1.width !== img2.width || img1.height !== img2.height) {
    // Resize-aware: crop to common origin box; remaining size mismatch is full mismatch.
    // Count dimension mismatch as AE of the absolute pixel-count difference as a floor.
  }
  const diff = new PNG({ width, height });
  const ae = pixelmatch(
    crop(img1, width, height).data,
    crop(img2, width, height).data,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );
  writePng(diffPath, diff);
  const total = width * height;
  const pct = total > 0 ? (ae / total) * 100 : 100;
  const dimMismatch = img1.width !== img2.width || img1.height !== img2.height;
  const ok = !dimMismatch && pct <= TOLERANCE_PCT;
  return {
    ok,
    ae,
    pct,
    width,
    height,
    refSize: `${img1.width}x${img1.height}`,
    nativeSize: `${img2.width}x${img2.height}`,
    dimMismatch,
    error: dimMismatch ? "dimension mismatch" : null,
  };
}

function crop(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (png.width * y + x) << 2;
      const di = (width * y + x) << 2;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

async function captureReferences(runDir) {
  const refDir = path.join(runDir, "reference");
  ensureDir(refDir);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });
  // Prefer dark theme for TV token alignment.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("playarr-theme", "dark");
      document.documentElement.dataset.theme = "dark";
      document.documentElement.style.colorScheme = "dark";
    } catch (_) {}
  });

  if (process.env.PARITY_USER && process.env.PARITY_PASSWORD) {
    await page.goto(`${WEB_ORIGIN}/login`, { waitUntil: "networkidle", timeout: 45_000 });
    await page.fill("#login-server-url", WEB_ORIGIN).catch(() => {});
    await page.fill("#login-username", process.env.PARITY_USER);
    await page.fill('input[name="password"]', process.env.PARITY_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }

  for (const screen of SCREENS) {
    const url = `${WEB_ORIGIN}${screen.webPath}`;
    const out = path.join(refDir, `${screen.id}.png`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: out, fullPage: false });
      console.log(`reference ok  ${screen.id}  ${url}`);
    } catch (err) {
      console.error(`reference FAIL ${screen.id}: ${err.message}`);
      // Write a solid placeholder so the suite still produces numeric rows.
      const placeholder = new PNG({ width: VIEWPORT.width, height: VIEWPORT.height });
      for (let i = 0; i < placeholder.data.length; i += 4) {
        placeholder.data[i] = 0x20;
        placeholder.data[i + 1] = 0x20;
        placeholder.data[i + 2] = 0x20;
        placeholder.data[i + 3] = 255;
      }
      writePng(out, placeholder);
    }
  }
  await browser.close();
}

function runDiffs(runDir, nativeDir) {
  const refDir = path.join(runDir, "reference");
  const diffDir = path.join(runDir, "diff");
  ensureDir(diffDir);
  const results = [];

  for (const screen of SCREENS) {
    const refPath = path.join(refDir, `${screen.id}.png`);
    const nativePath = path.join(nativeDir, `${screen.nativeFile}.png`);
    const diffPath = path.join(diffDir, `${screen.id}-diff.png`);
    const result = diffPair(refPath, nativePath, diffPath);
    results.push({ id: screen.id, note: screen.note, ...result });
    const status = result.ok ? "PASS" : "FAIL";
    const pct = result.pct >= 0 ? result.pct.toFixed(4) : "n/a";
    console.log(
      `${status}  ${screen.id.padEnd(24)}  ae=${result.ae}  pct=${pct}%  ${result.error || ""}`
    );
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    webOrigin: WEB_ORIGIN,
    tolerancePct: TOLERANCE_PCT,
    viewport: VIEWPORT,
    nativeDir,
    results,
    allPass: results.every((r) => r.ok),
    passCount: results.filter((r) => r.ok).length,
    failCount: results.filter((r) => !r.ok).length,
  };

  const summaryJson = path.join(runDir, "summary.json");
  const summaryTxt = path.join(runDir, "summary.txt");
  fs.writeFileSync(summaryJson, JSON.stringify(summary, null, 2));
  const lines = [
    `Playarr Apple TV parity suite`,
    `generated: ${summary.generatedAt}`,
    `origin: ${WEB_ORIGIN}`,
    `tolerance: ≤${TOLERANCE_PCT}% differing pixels`,
    `viewport: ${VIEWPORT.width}x${VIEWPORT.height}`,
    `pass: ${summary.passCount}/${results.length}  allPass=${summary.allPass}`,
    ``,
    ...results.map((r) => {
      const pct = r.pct >= 0 ? r.pct.toFixed(4) : "n/a";
      return `${r.ok ? "PASS" : "FAIL"}\t${r.id}\tae=${r.ae}\tpct=${pct}%\t${r.refSize || ""}\tvs\t${r.nativeSize || ""}\t${r.error || ""}`;
    }),
  ];
  fs.writeFileSync(summaryTxt, lines.join("\n") + "\n");
  console.log(`\nWrote ${summaryTxt}`);
  console.log(`allPass=${summary.allPass}`);
  return summary;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.runDir) {
    console.log(`Usage: node scripts/appletv-parity-suite.mjs --run-dir <dir> [--native-dir <dir>]`);
    process.exit(args.help ? 0 : 1);
  }

  const runDir = path.resolve(args.runDir);
  ensureDir(runDir);
  const nativeDir = path.resolve(args.nativeDir || path.join(runDir, "native"));

  if (!args.diffOnly) {
    await captureReferences(runDir);
  }
  if (!args.referenceOnly) {
    const summary = runDiffs(runDir, nativeDir);
    process.exit(summary.allPass ? 0 : 2);
  }
}

// Allow import of SCREENS without running.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
