#!/usr/bin/env node
// WCAG 2.2 AAA accessibility audit and guard. Serves the static Storybook build (dist-storybook), loads every story in
// both themes at the chosen layouts and runs axe-core with the A, AA and AAA rule tags (including
// color-contrast-enhanced, 7:1 / 4.5:1 large). Fixtures only: nothing here reaches a network.
//
//   node scripts/a11y-aaa.mjs [--dir dist-storybook] [--only <id-substring>] [--layouts tv1920,tv1280,mobile]
//                             [--json out.json] [--baseline scripts/a11y-aaa-baseline.json] [--update-baseline]
//
// With --baseline the run FAILS on any violation (rule + story + theme + layout) that the baseline does not list, so
// new AAA violations cannot land. --update-baseline rewrites the file from the current run (shrink it, never grow it).
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
const layoutNames = opt("layouts", "tv1920,tv1280,mobile").split(",");
const THEMES = ["light", "dark"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "wcag2aaa"];
// Stories exist to demonstrate states; these rules are about whole-document structure that a single story cannot own.
const IGNORED = new Set(["region", "landmark-one-main", "page-has-heading-one", "landmark-unique", "landmark-no-duplicate-banner", "landmark-banner-is-top-level", "landmark-no-duplicate-contentinfo", "landmark-no-duplicate-main", "landmark-contentinfo-is-top-level", "landmark-main-is-top-level", "landmark-complementary-is-top-level", "bypass", "document-title", "html-has-lang"]);

if (!existsSync(join(DIR, "index.json"))) throw new Error(`No Storybook build at ${DIR}; run pnpm run build:storybook`);
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".map": "application/json" };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = normalize(join(DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIR)) return void res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return void res.writeHead(404).end("not found");
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8"));
const stories = Object.values(index.entries).filter((e) => e.type === "story" && e.id.includes(ONLY));
const pwDir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(pwDir) ? readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const exe = process.env.NAV_PERF_CHROMIUM || (full ? join(pwDir, full, "chrome-linux64/chrome") : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

const found = []; // {key, story, theme, layout, rule, impact, nodes, targets[], detail}
const renderFailures = [];
for (const layout of layoutNames) {
  const size = LAYOUTS[layout];
  if (!size) throw new Error(`Unknown layout ${layout}`);
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  for (const story of stories) {
    for (const theme of THEMES) {
      const url = `${base}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=theme:${theme}`;
      await page.goto(url, { waitUntil: "load" });
      try {
        await page.waitForFunction((t) => { const r = document.querySelector("#storybook-root"); return (r && r.childElementCount > 0 && document.documentElement.dataset.theme === t) || document.querySelector(".sb-show-errordisplay"); }, theme, { timeout: 40000 });
      } catch { renderFailures.push(`${story.id} [${theme}, ${layout}]: did not render`); continue; }
      // The theme attribute is set after the first paint: freeze transitions so axe reads settled colours, not mid-fade ones.
      await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
      await page.waitForTimeout(250);
      await page.evaluate(axeSource);
      const result = await page.evaluate(async (tags) => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            // eslint-disable-next-line no-undef
            const r = await axe.run("#storybook-root", { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
            return r.violations.map((v) => ({ id: v.id, impact: v.impact, tags: v.tags.filter((t) => t.startsWith("wcag2")), nodes: v.nodes.map((n) => { const d = (n.any[0] ?? n.all[0] ?? n.none[0])?.data ?? {}; return { target: n.target.join(" "), summary: (n.any[0]?.message ?? n.failureSummary ?? "").slice(0, 160), html: n.html.slice(0, 120), fg: d.fgColor, bg: d.bgColor, ratio: d.contrastRatio, need: d.expectedContrastRatio, size: d.fontSize, weight: d.fontWeight }; }) }));
          } catch (error) {
            if (attempt >= 20 || !String(error).includes("already running")) throw error;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }, TAGS);
      for (const v of result) {
        if (IGNORED.has(v.id)) continue;
        found.push({ key: `${story.id}|${theme}|${layout}|${v.id}`, story: story.id, theme, layout, rule: v.id, impact: v.impact, aaa: v.tags.includes("wcag2aaa"), nodes: v.nodes.length, sample: v.nodes.slice(0, 6), all: v.nodes });
      }
    }
  }
  await context.close();
}
await browser.close();
server.close();

const jsonOut = opt("json", "");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ stories: stories.length, layouts: layoutNames, found, renderFailures }, null, 1));
const byRule = new Map();
for (const f of found) { const e = byRule.get(f.rule) ?? { renders: 0, nodes: 0 }; e.renders += 1; e.nodes += f.nodes; byRule.set(f.rule, e); }
console.log(`a11y AAA: ${stories.length} stories x ${THEMES.length} themes x ${layoutNames.length} layouts`);
for (const [rule, e] of [...byRule].sort((a, b) => b[1].nodes - a[1].nodes)) console.log(`  ${rule}: ${e.nodes} node(s) in ${e.renders} render(s)`);
const baselinePath = opt("baseline", "");
if (args.includes("--update-baseline") && baselinePath) {
  writeFileSync(resolve(root, baselinePath), JSON.stringify({ note: "Known AAA violations that cannot be fixed without a redesign. Shrink only.", keys: found.map((f) => f.key).sort() }, null, 1) + "\n");
  console.log(`baseline written: ${found.length} entries`);
  process.exit(0);
}
let failures = [...renderFailures];
if (baselinePath) {
  const allowed = new Set(JSON.parse(readFileSync(resolve(root, baselinePath), "utf8")).keys);
  for (const f of found) if (!allowed.has(f.key)) failures.push(`new violation ${f.key} (${f.nodes} node(s)) e.g. ${f.sample[0]?.target}: ${f.sample[0]?.summary}`);
} else {
  failures = failures.concat(found.map((f) => `${f.key} (${f.nodes} node(s)) e.g. ${f.sample[0]?.target}`));
}
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures.slice(0, 200)) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("a11y AAA passed");
