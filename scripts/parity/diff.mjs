#!/usr/bin/env node
// Pixel diff of candidate captures against the web reference, with an HTML report.
//
//   node diff.mjs --ref <dir> --cand <dir> --layout tv|mobile [--out <dir>]
//                 [--screens id,id] [--threshold 0.1] [--max 1] [--fail]
//
// Both directories hold <layout>/<screen-id>.png (what capture-web.mjs writes). Candidate
// images of another size are compared on the larger canvas; the missing area counts as
// mismatch. Writes <out>/report.json, <out>/summary.md and <out>/report.html with
// reference, candidate and diff overlays per screen. --fail exits 1 if any screen is over --max.
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
if (!cand || !spec.layouts[layout]) {
  console.error("usage: diff.mjs --ref <dir> --cand <dir> --layout tv|mobile [--out dir] [--screens a,b] [--threshold 0.1] [--max 1] [--fail]");
  process.exit(2);
}
const out = resolve(opt("out", join(cand, `diff-${layout}`)));
const threshold = Number(opt("threshold", spec.tolerance.pixelmatchThreshold));
const maxPct = Number(opt("max", spec.tolerance.maxMismatchPercent));
const only = opt("screens", "")?.split(",").filter(Boolean);
const screens = spec.screens.filter((s) => !only.length || only.includes(s.id));

const read = (p) => PNG.sync.read(readFileSync(p));
function onCanvas(png, w, h) {
  if (png.width === w && png.height === h) return png.data;
  const data = Buffer.alloc(w * h * 4); // transparent: always differs from an opaque reference
  for (let y = 0; y < Math.min(h, png.height); y += 1) {
    png.data.copy(data, y * w * 4, y * png.width * 4, (y * png.width + Math.min(w, png.width)) * 4);
  }
  return data;
}

mkdirSync(join(out, "img"), { recursive: true });
const rows = [];
for (const s of screens) {
  const rp = join(ref, layout, `${s.id}.png`);
  const cp = join(cand, layout, `${s.id}.png`);
  const row = { id: s.id, title: s.title };
  if (!existsSync(rp) || !existsSync(cp)) {
    rows.push({ ...row, status: existsSync(rp) ? "missing-candidate" : "missing-reference", mismatchPercent: null });
    continue;
  }
  const a = read(rp);
  const b = read(cp);
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const diff = new PNG({ width: w, height: h });
  const bad = pixelmatch(onCanvas(a, w, h), onCanvas(b, w, h), diff.data, w, h, { threshold, includeAA: false });
  const pct = (bad / (w * h)) * 100;
  copyFileSync(rp, join(out, "img", `${layout}-${s.id}-ref.png`));
  copyFileSync(cp, join(out, "img", `${layout}-${s.id}-cand.png`));
  writeFileSync(join(out, "img", `${layout}-${s.id}-diff.png`), PNG.sync.write(diff));
  rows.push({
    ...row,
    status: pct <= maxPct ? "pass" : "fail",
    mismatchPercent: Number(pct.toFixed(3)),
    mismatchedPixels: bad,
    reference: `${a.width}x${a.height}`,
    candidate: `${b.width}x${b.height}`,
    sizeMatch: a.width === b.width && a.height === b.height,
  });
}

const report = { layout, threshold, maxMismatchPercent: maxPct, generatedFrom: { ref, cand }, screens: rows };
writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

const fmt = (r) => (r.mismatchPercent === null ? "-" : `${r.mismatchPercent.toFixed(2)}%`);
const md = [
  `| Screen | Mismatch | Status | Reference | Candidate |`,
  `| --- | ---: | --- | --- | --- |`,
  ...rows.map((r) => `| ${r.id} | ${fmt(r)} | ${r.status} | ${r.reference ?? "-"} | ${r.candidate ?? "-"} |`),
].join("\n");
writeFileSync(join(out, "summary.md"), `${md}\n`);

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const cards = rows
  .map((r) =>
    r.mismatchPercent === null
      ? `<section><h2>${esc(r.id)} <small>${esc(r.status)}</small></h2></section>`
      : `<section class="${r.status}"><h2>${esc(r.id)} <small>${fmt(r)} mismatch, ${esc(r.status)}${r.sizeMatch ? "" : `, size ${esc(r.reference)} vs ${esc(r.candidate)}`}</small></h2>
<div class="row"><figure><figcaption>Reference (web)</figcaption><img loading="lazy" src="img/${layout}-${r.id}-ref.png"></figure>
<figure><figcaption>Candidate</figcaption><img loading="lazy" src="img/${layout}-${r.id}-cand.png"></figure>
<figure><figcaption>Diff</figcaption><img loading="lazy" src="img/${layout}-${r.id}-diff.png"></figure></div></section>`
  )
  .join("\n");
writeFileSync(
  join(out, "report.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parity report ${esc(layout)}</title>
<style>body{font:14px system-ui;margin:16px;background:#fafafa;color:#222}table{border-collapse:collapse}td,th{padding:4px 10px;border:1px solid #ccc;text-align:left}
section{margin:24px 0}.fail h2{color:#b00020}.pass h2{color:#0a6b2d}small{font-weight:400;color:#555}.row{display:flex;gap:12px;align-items:flex-start;overflow-x:auto}
figure{margin:0;flex:0 0 auto}figcaption{font-weight:600}img{max-height:560px;border:1px solid #ccc;background:#fff}</style>
<h1>Parity report: ${esc(layout)}</h1><p>pixelmatch threshold ${threshold}, pass at or below ${maxPct}% mismatch.</p>
<table><tr><th>Screen</th><th>Mismatch</th><th>Status</th></tr>${rows.map((r) => `<tr><td><a href="#${esc(r.id)}">${esc(r.id)}</a></td><td>${fmt(r)}</td><td>${esc(r.status)}</td></tr>`).join("")}</table>
${cards.replace(/<section/g, (m, i) => m)}
`
);
console.log(md);
console.log(`\nreport: ${join(out, "report.html")}`);
if (args.includes("--fail") && rows.some((r) => r.status !== "pass")) process.exit(1);
