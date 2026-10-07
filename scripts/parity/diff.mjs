#!/usr/bin/env node
// Pixel diff of candidate captures against the web reference, per theme, with an HTML report.
//
//   node diff.mjs --ref <dir> --cand <dir> --layout tv|mobile [--theme light|dark|both] [--out <dir>]
//                 [--screens id,id (ids missing from screens.json, such as home-scrolled, are compared too)] [--threshold 0.1] [--max 1] [--fail]
//                 [--mask-rect x,y,w,h[,screen-id]]... [--keep-rect x,y,w,h[,screen-id]]... [--chrome-only]
//                 [--no-manifest-masks]
//
// Both directories hold <layout>/<theme>/<screen-id>.png (what capture-web.mjs writes). The candidate
// directory may instead hold the legacy <layout>/<screen-id>.png, which is taken as the light theme.
// Candidate images of another size are compared on the larger canvas; the missing area counts as
// mismatch. Writes <out>/report.json, <out>/summary.md and <out>/report.html (reference, candidate and
// diff overlays per screen, one section per theme). Ignored regions: --mask-rect (CSS px of the layout, repeatable,
// optionally limited to one screen id) and the maskRects the reference manifest records for text that legitimately
// differs per fixture instance (for example the server address); both images are blanked there before comparing.
// --chrome-only (and --keep-rect) keep only the listed regions: everything outside them is blanked in both images, as
// for the player screens whose decoded video is a codec difference, not UI. --chrome-only uses `compareRegions`
// from screens.json for the layout; --keep-rect adds ad hoc regions. --fail exits 1 if any compared screen is over --max
// or missing a candidate.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const spec = JSON.parse(readFileSync(join(here, "screens.json"), "utf8"));
const layout = opt("layout", "mobile");
const ref = opt("ref", join(here, "../../docs/parity/web"));
const cand = opt("cand");
const themeOpt = opt("theme", "both");
const themes = themeOpt === "both" ? spec.themes : themeOpt.split(",");
if (!cand || !spec.layouts[layout] || themes.some((t) => !spec.themes.includes(t))) {
  console.error("usage: diff.mjs --ref <dir> --cand <dir> --layout tv|mobile [--theme light|dark|both] [--out dir] [--screens a,b] [--threshold 0.1] [--max 1] [--fail]");
  process.exit(2);
}
const out = resolve(opt("out", join(cand, `diff-${layout}`)));
const threshold = Number(opt("threshold", spec.tolerance.pixelmatchThreshold));
const maxPct = Number(opt("max", spec.tolerance.maxMismatchPercent));
const only = opt("screens", "")?.split(",").filter(Boolean);
const cliMasks = args.flatMap((a, i) => (a === "--mask-rect" && args[i + 1] ? [args[i + 1]] : [])).map((v) => {
  const [x, y, w, h, screen] = v.split(",");
  return { rect: [x, y, w, h].map(Number), screen };
});
const refManifest = (() => {
  if (args.includes("--no-manifest-masks")) return [];
  try {
    return JSON.parse(readFileSync(join(ref, "manifest.json"), "utf8")).screens ?? [];
  } catch {
    return [];
  }
})();
const keepMasks = args.flatMap((a, i) => (a === "--keep-rect" && args[i + 1] ? [args[i + 1]] : [])).map((v) => {
  const [x, y, w, h, screen] = v.split(",");
  return { rect: [x, y, w, h].map(Number), screen };
});
const chromeOnly = args.includes("--chrome-only");
const dpr = spec.layouts[layout].dpr;
function keepFor(screen) {
  const fromSpec = chromeOnly ? screen.compareRegions?.[layout] ?? [] : [];
  const fromCli = keepMasks.filter((m) => !m.screen || m.screen === screen.id).map((m) => m.rect);
  return [...fromSpec, ...fromCli];
}
// Blank everything outside the kept rectangles (CSS px).
function keepOnly(png, rects) {
  const keep = rects.map(([x, y, w, h]) => [Math.floor(x * dpr), Math.floor(y * dpr), Math.ceil((x + w) * dpr), Math.ceil((y + h) * dpr)]);
  for (let yy = 0; yy < png.height; yy += 1) {
    for (let xx = 0; xx < png.width; xx += 1) {
      if (keep.some(([x0, y0, x1, y1]) => xx >= x0 && xx < x1 && yy >= y0 && yy < y1)) continue;
      const o = (yy * png.width + xx) * 4;
      png.data[o] = 255; png.data[o + 1] = 0; png.data[o + 2] = 255; png.data[o + 3] = 255;
    }
  }
}
function masksFor(theme, id) {
  const fromManifest = refManifest
    .filter((e) => e.layout === layout && e.theme === theme && e.id === id)
    .flatMap((e) => e.maskRects ?? []);
  const fromCli = cliMasks.filter((m) => !m.screen || m.screen === id).map((m) => m.rect);
  return [...fromManifest, ...fromCli];
}
// Blank the rectangles (CSS px) to one opaque colour in an image, so they never count as mismatch.
function blank(png, rects) {
  for (const [x, y, w, h] of rects) {
    const x0 = Math.max(0, Math.floor(x * dpr));
    const y0 = Math.max(0, Math.floor(y * dpr));
    const x1 = Math.min(png.width, Math.ceil((x + w) * dpr));
    const y1 = Math.min(png.height, Math.ceil((y + h) * dpr));
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) {
        const o = (yy * png.width + xx) * 4;
        png.data[o] = 255; png.data[o + 1] = 0; png.data[o + 2] = 255; png.data[o + 3] = 255;
      }
    }
  }
}
// Ids named in --screens that screens.json does not list (the scrolled states a device capture adds, for example
// home-scrolled) are compared as they are: the reference and candidate directories just have to hold the same file name.
const screens = [
  ...spec.screens.filter((s) => !only.length || only.includes(s.id)),
  ...only.filter((id) => !spec.screens.some((s) => s.id === id)).map((id) => ({ id, title: id })),
];

const read = (p) => PNG.sync.read(readFileSync(p));
function onCanvas(png, w, h) {
  if (png.width === w && png.height === h) return png.data;
  const data = Buffer.alloc(w * h * 4); // transparent: always differs from an opaque reference
  for (let y = 0; y < Math.min(h, png.height); y += 1) {
    png.data.copy(data, y * w * 4, y * png.width * 4, (y * png.width + Math.min(w, png.width)) * 4);
  }
  return data;
}
// A themed path, else (light only) the legacy unthemed candidate path.
const find = (root, theme, id) => {
  const themed = join(root, layout, theme, `${id}.png`);
  if (existsSync(themed)) return themed;
  const legacy = join(root, layout, `${id}.png`);
  return theme === "light" && root === cand && existsSync(legacy) ? legacy : themed;
};

mkdirSync(join(out, "img"), { recursive: true });
const report = { layout, threshold, maxMismatchPercent: maxPct, generatedFrom: { ref, cand }, themes: {} };
for (const theme of themes) {
  const rows = [];
  for (const s of screens) {
    const rp = find(ref, theme, s.id);
    const cp = find(cand, theme, s.id);
    const row = { id: s.id, title: s.title };
    if (!existsSync(rp) || !existsSync(cp)) {
      rows.push({ ...row, status: existsSync(rp) ? "missing-candidate" : "missing-reference", mismatchPercent: null });
      continue;
    }
    const a = read(rp);
    const b = read(cp);
    const kept = keepFor(s);
    if (kept.length) {
      keepOnly(a, kept);
      keepOnly(b, kept);
    }
    const masks = masksFor(theme, s.id);
    if (masks.length) {
      blank(a, masks);
      blank(b, masks);
    }
    const w = Math.max(a.width, b.width);
    const h = Math.max(a.height, b.height);
    const diff = new PNG({ width: w, height: h });
    const bad = pixelmatch(onCanvas(a, w, h), onCanvas(b, w, h), diff.data, w, h, { threshold, includeAA: false });
    const pct = (bad / (w * h)) * 100;
    const stem = `${layout}-${theme}-${s.id}`;
    copyFileSync(rp, join(out, "img", `${stem}-ref.png`));
    copyFileSync(cp, join(out, "img", `${stem}-cand.png`));
    writeFileSync(join(out, "img", `${stem}-diff.png`), PNG.sync.write(diff));
    rows.push({
      ...row,
      status: pct <= maxPct ? "pass" : "fail",
      mismatchPercent: Number(pct.toFixed(3)),
      mismatchedPixels: bad,
      reference: `${a.width}x${a.height}`,
      candidate: `${b.width}x${b.height}`,
      sizeMatch: a.width === b.width && a.height === b.height,
      ...(masks.length ? { maskedRects: masks.length } : {}),
      ...(kept.length ? { keptRegions: kept.length } : {}),
    });
  }
  report.themes[theme] = rows;
}
writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

const fmt = (r) => (r.mismatchPercent === null ? "-" : `${r.mismatchPercent.toFixed(2)}%`);
const table = (rows) =>
  [
    `| Screen | Mismatch | Status | Reference | Candidate |`,
    `| --- | ---: | --- | --- | --- |`,
    ...rows.map((r) => `| ${r.id} | ${fmt(r)} | ${r.status} | ${r.reference ?? "-"} | ${r.candidate ?? "-"} |`),
  ].join("\n");
const md = themes.map((t) => `### ${layout} / ${t}\n\n${table(report.themes[t])}\n`).join("\n");
writeFileSync(join(out, "summary.md"), md);

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sectionFor = (theme, rows) =>
  `<h2 id="${theme}">${esc(layout)} / ${esc(theme)}</h2>
<table><tr><th>Screen</th><th>Mismatch</th><th>Status</th></tr>${rows.map((r) => `<tr><td><a href="#${theme}-${esc(r.id)}">${esc(r.id)}</a></td><td>${fmt(r)}</td><td>${esc(r.status)}</td></tr>`).join("")}</table>
${rows
  .map((r) =>
    r.mismatchPercent === null
      ? `<section id="${theme}-${esc(r.id)}"><h3>${esc(r.id)} <small>${esc(r.status)}</small></h3></section>`
      : `<section id="${theme}-${esc(r.id)}" class="${r.status}"><h3>${esc(r.id)} <small>${fmt(r)} mismatch, ${esc(r.status)}${r.sizeMatch ? "" : `, size ${esc(r.reference)} vs ${esc(r.candidate)}`}</small></h3>
<div class="row"><figure><figcaption>Reference (web)</figcaption><img loading="lazy" src="img/${layout}-${theme}-${r.id}-ref.png"></figure>
<figure><figcaption>Candidate</figcaption><img loading="lazy" src="img/${layout}-${theme}-${r.id}-cand.png"></figure>
<figure><figcaption>Diff</figcaption><img loading="lazy" src="img/${layout}-${theme}-${r.id}-diff.png"></figure></div></section>`
  )
  .join("\n")}`;
writeFileSync(
  join(out, "report.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parity report ${esc(layout)}</title>
<style>body{font:14px system-ui;margin:16px;background:#fafafa;color:#222}table{border-collapse:collapse}td,th{padding:4px 10px;border:1px solid #ccc;text-align:left}
section{margin:24px 0}.fail h3{color:#b00020}.pass h3{color:#0a6b2d}small{font-weight:400;color:#555}.row{display:flex;gap:12px;align-items:flex-start;overflow-x:auto}
figure{margin:0;flex:0 0 auto}figcaption{font-weight:600}img{max-height:560px;border:1px solid #ccc;background:#fff}</style>
<h1>Parity report: ${esc(layout)}</h1><p>pixelmatch threshold ${threshold}, pass at or below ${maxPct}% mismatch. Themes: ${themes.map((t) => `<a href="#${t}">${t}</a>`).join(", ")}.</p>
${themes.map((t) => sectionFor(t, report.themes[t])).join("\n")}
`
);
console.log(md);
console.log(`report: ${join(out, "report.html")}`);
if (args.includes("--fail") && themes.some((t) => report.themes[t].some((r) => r.status !== "pass"))) process.exit(1);
