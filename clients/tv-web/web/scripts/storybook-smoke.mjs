#!/usr/bin/env node
// Storybook render and accessibility smoke. Serves the static build (dist-storybook), then loads EVERY story in
// both themes at the TV 1920x1080 and mobile layouts and asserts that:
//   - the story renders (non-empty root, no Storybook error display, no uncaught page error), and
//   - axe-core finds no critical or serious violation other than the rules in KNOWN_RULES below.
// Fixtures only: nothing here reaches a network.
//
//   node scripts/storybook-smoke.mjs [--dir dist-storybook] [--only <id-substring>] [--layouts tv1920,mobile]
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const DIR = resolve(root, opt("dir", "dist-storybook"));
const ONLY = opt("only", "");
const LAYOUTS = {
  tv1920: { width: 1920, height: 1080 },
  tv1280: { width: 1280, height: 720 },
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const layoutNames = opt("layouts", "tv1920,mobile").split(",");
const THEMES = ["light", "dark"];

// Rules that fail today and are tracked, not ignored: each needs a task row before it is removed from here.
const KNOWN_RULES = new Set(["color-contrast"]);
const BLOCKING = new Set(["critical", "serious"]);

if (!existsSync(join(DIR, "index.json"))) throw new Error(`No Storybook build at ${DIR}; run pnpm run build:storybook`);
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".map": "application/json",
};
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = normalize(join(DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8"));
const stories = Object.values(index.entries).filter((e) => e.type === "story" && e.id.includes(ONLY));
if (stories.length === 0) throw new Error("No stories found in index.json");

const pwDir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(pwDir) ? readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const exe = process.env.NAV_PERF_CHROMIUM || (full ? join(pwDir, full, "chrome-linux64/chrome") : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

const failures = [];
const known = new Map();
let checked = 0;
for (const layout of layoutNames) {
  const size = LAYOUTS[layout];
  if (!size) throw new Error(`Unknown layout ${layout}`);
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith(base)) return;
    // Navigating to the next story cancels the previous page's in-flight requests; that is not a failure.
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    pageErrors.push(`request failed: ${request.url()}`);
  });
  for (const story of stories) {
    for (const theme of THEMES) {
      pageErrors.length = 0;
      const label = `${story.id} [${theme}, ${layout}]`;
      const url = `${base}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=theme:${theme}`;
      await page.goto(url, { waitUntil: "load" });
      try {
        await page.waitForFunction(
          (expected) => {
            const root = document.querySelector("#storybook-root");
            return (
              (root && root.childElementCount > 0 && document.documentElement.dataset.theme === expected) ||
              document.querySelector(".sb-show-errordisplay")
            );
          },
          theme,
          { timeout: 15000 },
        );
      } catch {
        failures.push(`${label}: did not render`);
        continue;
      }
      await page.waitForTimeout(150);
      const shown = await page.evaluate(() => {
        const err = document.querySelector(".sb-show-errordisplay");
        const visible = err && getComputedStyle(err).display !== "none";
        return { error: visible ? (document.querySelector("#error-message")?.textContent ?? "error display") : "", theme: document.documentElement.dataset.theme };
      });
      if (shown.error.includes("dynamically imported module")) {
        // A chunk fetch can fail while the machine is busy; load once more before calling it a failure.
        await page.goto(url, { waitUntil: "load" });
        await page.waitForTimeout(1000);
        shown.error = await page.evaluate(() => {
          const err = document.querySelector(".sb-show-errordisplay");
          return err && getComputedStyle(err).display !== "none" ? (document.querySelector("#error-message")?.textContent ?? "error display") : "";
        });
      }
      if (shown.error) {
        failures.push(`${label}: ${shown.error.trim().slice(0, 200)}`);
        continue;
      }
      if (shown.theme !== theme) failures.push(`${label}: theme attribute is ${shown.theme}`);
      if (pageErrors.length) failures.push(`${label}: ${pageErrors.join("; ").slice(0, 300)}`);
      await page.evaluate(axeSource);
      // Storybook's own a11y addon runs axe on every render; wait it out when it is still running.
      const result = await page.evaluate(async () => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            // eslint-disable-next-line no-undef
            const r = await axe.run("#storybook-root", { resultTypes: ["violations"] });
            return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }));
          } catch (error) {
            if (attempt >= 20 || !String(error).includes("already running")) throw error;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      });
      for (const v of result) {
        if (!BLOCKING.has(v.impact)) continue;
        if (KNOWN_RULES.has(v.id)) {
          known.set(v.id, (known.get(v.id) ?? 0) + 1);
          continue;
        }
        failures.push(`${label}: axe ${v.id} (${v.impact}, ${v.nodes} node(s)) at ${v.target}`);
      }
      checked += 1;
    }
  }
  await context.close();
}
await browser.close();
server.close();

console.log(`Storybook smoke: ${stories.length} stories x ${THEMES.length} themes x ${layoutNames.length} layouts, ${checked} renders checked`);
for (const [rule, count] of known) console.log(`  tracked axe rule ${rule}: ${count} render(s) affected (not failing)`);
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Storybook smoke passed");
