// Captures the public web screenshots (README, site) from a running showcase (up.sh) and a served web client.
//
//   node scripts/showcase/capture-web.mjs --web http://127.0.0.1:18813 --admin http://127.0.0.1:18810 \
//        --password-file <path> [--only readme,site]
//
// Serve the built web client first: (cd clients/tv-web/web && pnpm exec vite preview --host 127.0.0.1 --port 18813 --strictPort).
// Needs Chromium: PLAYARR_CHROMIUM=/path/to/chrome, else the Playwright-managed browser is used.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { writeManifest } from "./manifest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "clients/tv-web/web/package.json"));
const { chromium } = require("playwright-core");

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const WEB = args.web ?? "http://127.0.0.1:18813";
const SERVER = args.admin ?? "http://127.0.0.1:18810";
const password = fs.readFileSync(args["password-file"], "utf8").trim();
const only = (args.only ?? "readme,site").split(",");
const README = path.join(root, "docs/assets/readme/screenshots");
const SITE = path.join(root, "site/src/assets/screenshots");

async function api(method, p, body, token) {
  const res = await fetch(`${SERVER}/api/v1${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  return res.json();
}
const login = await api("POST", "/auth/login", { username: "demo", password, device_id: "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b", device_name: "Showcase capture", client_platform: "web", client_version: "1.0.0" });
const catalog = (await api("GET", "/catalog?limit=100", undefined, login.access_token)).items;
const id = (title) => catalog.find((i) => i.title === title).id;

const browser = await chromium.launch({ executablePath: process.env.PLAYARR_CHROMIUM || undefined, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });

async function session(width, height, { scale = 1, mobile = false, query = "" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: "dark", isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login${query}`, { waitUntil: "load" });
  await page.fill('input[name="server-url"]', SERVER);
  await page.fill('input[name="username"]', "demo");
  await page.fill('input[name="password"]', password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  return page;
}
const shoot = async (page, route, file, settle = 6000, origin = WEB) => {
  await page.goto(origin + route, { waitUntil: "load" });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: file });
  console.log("wrote", path.relative(root, file));
};

if (only.includes("readme")) {
  let p = await session(1600, 1000, { scale: 1.5 });
  await shoot(p, "/", path.join(README, "web-home.png"));
  await shoot(p, "/movies", path.join(README, "web-movies-library.png"));
  await shoot(p, `/series/${id("Caminandes")}`, path.join(README, "web-series-detail.png"));
  await p.context().close();
  p = await session(1600, 1000, { scale: 1.25 });
  await shoot(p, `/movies/${id("Tears of Steel")}`, path.join(README, "web-movie-detail.png"));
  await p.context().close();
  p = await session(1920, 1080, { query: "?platform=tv-webos" });
  await shoot(p, `/movies/${id("Big Buck Bunny")}`, path.join(README, "tv-movie-detail.png"));
  await p.context().close();
  p = await session(390, 844, { scale: 2, mobile: true });
  await shoot(p, `/movies/${id("Tears of Steel")}`, path.join(README, "web-mobile-detail.png"));
  await shoot(p, "/", path.join(README, "web-mobile-home.png"), 7000);
  await p.context().close();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5, colorScheme: "dark" });
  const a = await ctx.newPage();
  await a.goto(`${SERVER}/login`, { waitUntil: "load" });
  await a.locator("input").nth(0).fill("demo");
  await a.locator("input[type=password]").fill(password);
  await a.locator("button[type=submit]").click();
  await a.waitForTimeout(3500);
  await shoot(a, "/library", path.join(README, "admin-library.png"), 5000, SERVER);
  await ctx.close();
}

if (only.includes("site")) {
  const p = await session(1920, 1080);
  await shoot(p, "/movies", path.join(SITE, "playarr-movies-library.png"));
  await shoot(p, `/series/${id("Caminandes")}`, path.join(SITE, "playarr-series-detail.png"));
  await shoot(p, `/movies/${id("Tears of Steel")}`, path.join(SITE, "playarr-movie-detail.png"));
  await p.context().close();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
  const a = await ctx.newPage();
  await a.goto(`${SERVER}/login`, { waitUntil: "load" });
  await a.locator("input").nth(0).fill("demo");
  await a.locator("input[type=password]").fill(password);
  await a.locator("button[type=submit]").click();
  await a.waitForTimeout(3500);
  await a.goto(`${SERVER}/`, { waitUntil: "load" });
  await a.waitForTimeout(3500);
  await a.screenshot({ path: path.join(SITE, "playarr-server-admin.png") });
  console.log("wrote site/src/assets/screenshots/playarr-server-admin.png");
  await ctx.close();
}
await browser.close();
writeManifest(root);
