#!/usr/bin/env node
// Pixel diff of reference vs candidate captures.
// usage: diff.mjs <screens.json> <reference-dir> <candidate-dir> <out-dir>
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const [screensFile, refDir, candDir, outDir] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(screensFile, "utf8"));
fs.mkdirSync(outDir, { recursive: true });
const rows = [];
for (const s of cfg.screens.filter((x) => !x.shared)) {
  const ref = path.join(refDir, `${s.id}.png`);
  const cand = path.join(candDir, `${s.id}.png`);
  if (!fs.existsSync(ref) || !fs.existsSync(cand)) {
    rows.push({ id: s.id, status: "missing", mismatchPct: null, note: s.missing ?? "no capture" });
    continue;
  }
  const a = PNG.sync.read(fs.readFileSync(ref));
  const b = PNG.sync.read(fs.readFileSync(cand));
  if (a.width !== b.width || a.height !== b.height) {
    rows.push({ id: s.id, status: "size-mismatch", mismatchPct: null, note: `${a.width}x${a.height} vs ${b.width}x${b.height}` });
    continue;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  fs.writeFileSync(path.join(outDir, `${s.id}.diff.png`), PNG.sync.write(diff));
  const pct = (n / (a.width * a.height)) * 100;
  rows.push({ id: s.id, status: pct <= 1 ? "pass" : "fail", mismatchPct: Number(pct.toFixed(2)), note: "" });
}
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(rows, null, 2));
const md = ["| Screen | Status | Mismatch % | Note |", "| --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.id} | ${r.status} | ${r.mismatchPct ?? "-"} | ${r.note} |`)].join("\n");
fs.writeFileSync(path.join(outDir, "summary.md"), md + "\n");
const cell = (dir, f, label) => `<figure><figcaption>${label}</figcaption><img src="${dir}/${f}"></figure>`;
const html = `<!doctype html><meta charset=utf-8><title>Apple parity</title><style>body{background:#111;color:#eee;font:14px sans-serif}figure{display:inline-block;margin:4px;width:31%}img{width:100%}</style>` +
  rows.map((r) => `<h2>${r.id}: ${r.status} ${r.mismatchPct ?? ""}%</h2>` +
    cell("../reference", `${r.id}.png`, "web") + cell("../native", `${r.id}.png`, "native") + cell("diff", `${r.id}.diff.png`, "diff")).join("");
fs.writeFileSync(path.join(outDir, "report.html"), html);
console.log(md);
