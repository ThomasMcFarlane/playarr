#!/usr/bin/env node
// TV viewport regression check. Smart-TV browsers report very different CSS viewports (a 4K VIDAA set can
// report 1280x720 at devicePixelRatio 1.5, 960x540 at 2, or a full 3840x2160) and cannot scroll, so the TV layout
// must fit whatever it gets. For each viewport and each public TV user-agent string this asserts that:
//   - the sign-in link code sits fully inside the viewport and is centred, and
//   - every signed-in TV screen fits: no page scroll, and every navigation-rail control is on screen.
// The webOS and Tizen user agents run the same hosted `?platform=tv-vidaa` profile (their packaged builds share
// the stage-scaling code path), so the viewport maths is covered for all three.
// Uses the deterministic mock API of nav-perf.mjs and a stubbed hosted link broker, so no server is needed.
//
//   node scripts/tv-viewport.mjs [--no-build] [--dist dir] [--shots dir]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const DIST = opt("dist", join(root, "dist"));
const SHOTS = opt("shots", "");
if (!args.includes("--no-build") && !opt("dist", "")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Representative public user-agent strings for each TV browser family.
const AGENTS = {
  vidaa:
    "Mozilla/5.0 (Linux; Large Screen) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36 VIDAA/6.0 Hisense",
  webos:
    "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager",
  tizen:
    "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36",
};
// [family, width, height, devicePixelRatio]
const CASES = [
  ["vidaa", 1920, 1080, 1],
  ["vidaa", 1280, 720, 1],
  ["vidaa", 1280, 720, 1.5],
  ["vidaa", 960, 540, 2],
  ["vidaa", 1366, 768, 1],
  ["vidaa", 3840, 2160, 1],
  ["webos", 1920, 1080, 1],
  ["webos", 1280, 720, 1],
  ["tizen", 1920, 1080, 1],
  ["tizen", 3840, 2160, 1],
];
const SIGNED_IN_ROUTES = (movieId) => ({
  home: "/",
  movies: "/movies",
  film: `/movies/${movieId}`,
  search: "/search",
  settings: "/settings",
});

const server = await startServer({ distDir: DIST, movies: 12, series: 8, artists: 0 });
const base = `http://127.0.0.1:${server.port}`;
const dir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const exe = process.env.NAV_PERF_CHROMIUM || (full ? join(dir, full, "chrome-linux64/chrome") : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const USER_ID = "00000000-0000-4000-8000-000000000001";
const movieId = (await (await fetch(`${base}/api/v1/catalog?kind=movie&limit=1`)).json()).items[0].id;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const fail = (label, msg) => failures.push(`${label}: ${msg}`);

async function signInScreen([family, width, height, dpr]) {
  const label = `${family} ${width}x${height}@${dpr} sign-in`;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    userAgent: AGENTS[family],
  });
  await context.route("https://playarr.app/api/link/code", (route) =>
    route.fulfill({
      json: {
        device_code: "device",
        user_code: "ABCD-EFGH",
        verification_uri: "https://playarr.app/link",
        verification_uri_complete: "https://playarr.app/link?code=ABCD-EFGH",
        expires_in: 300,
        interval: 5,
      },
    })
  );
  const page = await context.newPage();
  await page.goto(`${base}/?platform=tv-vidaa`);
  await page.waitForSelector(".device-login-code", { timeout: 20000 });
  await page.waitForFunction(() => /\w/.test(document.querySelector(".device-login-code")?.textContent ?? ""));
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => {
    const el = document.querySelector(".device-login-code");
    const range = document.createRange();
    range.selectNodeContents(el);
    const b = range.getBoundingClientRect();
    const qr = document.querySelector(".device-login-qr")?.getBoundingClientRect();
    return {
      box: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      qr: qr && { left: qr.left, right: qr.right, top: qr.top, bottom: qr.bottom },
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  const inside = (b) => b.left >= -0.5 && b.top >= -0.5 && b.right <= m.vw + 0.5 && b.bottom <= m.vh + 0.5;
  if (!inside(m.box)) fail(label, `code box ${JSON.stringify(m.box)} is outside ${m.vw}x${m.vh}`);
  if (m.qr && !inside(m.qr)) fail(label, `QR box ${JSON.stringify(m.qr)} is outside ${m.vw}x${m.vh}`);
  const centre = (m.box.left + m.box.right) / 2;
  if (Math.abs(centre - m.vw / 2) > m.vw * 0.02) fail(label, `code centre ${Math.round(centre)} is not centred in ${m.vw}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `signin-${family}-${width}x${height}-${dpr}.png`) });
  await context.close();
}

async function signedInScreens([family, width, height, dpr]) {
  for (const [name, route] of Object.entries(SIGNED_IN_ROUTES(movieId))) {
    const label = `${family} ${width}x${height}@${dpr} ${name}`;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: dpr,
      userAgent: AGENTS[family],
    });
    await context.addInitScript(({ base, userId }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem(
        "playarr.profileSessions.v4",
        JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }])
      );
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
    }, { base, userId: USER_ID });
    const page = await context.newPage();
    await page.goto(`${base}${route}${route.includes("?") ? "&" : "?"}platform=tv-vidaa`);
    await page.waitForSelector(".app-nav", { timeout: 20000 });
    await page.waitForTimeout(900);
    const problems = await page.evaluate(() => {
      const out = [];
      const root = document.documentElement;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scroller = document.scrollingElement ?? root;
      if (scroller.scrollWidth > vw + 1) out.push(`page is ${scroller.scrollWidth}px wide in a ${vw}px viewport`);
      if (scroller.scrollHeight > vh + 1) out.push(`page is ${scroller.scrollHeight}px tall in a ${vh}px viewport`);
      for (const el of document.querySelectorAll(".app-nav a, .app-nav button")) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) {
          out.push(`nav control "${(el.textContent ?? "").trim().slice(0, 16)}" is off screen (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`);
        }
      }
      return out;
    });
    for (const p of problems) fail(label, p);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}-${family}-${width}x${height}-${dpr}.png`) });
    await context.close();
  }
}

for (const c of CASES) {
  await signInScreen(c);
  await signedInScreens(c);
}
console.log(`${failures.length ? "FAIL" : "PASS"}  TV viewports: ${CASES.map((c) => `${c[0]} ${c[1]}x${c[2]}@${c[3]}`).join(", ")}`);
for (const f of failures) console.log(`  - ${f}`);
await browser.close();
server.close?.();
process.exit(failures.length ? 1 : 0);
