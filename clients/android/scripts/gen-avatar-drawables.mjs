#!/usr/bin/env node
// Regenerates app/src/main/res/drawable/avatar_preset_<id>.xml from the shared preset art
// (clients/shared/profile-avatars/presets.json), so Android draws exactly what the web client draws.
//   node clients/android/scripts/gen-avatar-drawables.mjs           write the drawables
//   node clients/android/scripts/gen-avatar-drawables.mjs --check   fail when one is stale
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.resolve(here, "../../shared/profile-avatars/presets.json"), "utf8"));
const outDir = path.resolve(here, "../app/src/main/res/drawable");

const n = (v) => Number(Number(v).toFixed(3)).toString();
function colour(value) {
  const hex = value.replace("#", "").toUpperCase();
  return "#" + (hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex);
}
function attrsOf(markup) {
  return Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}
function pathData(tag, a) {
  if (tag === "path") return a.d;
  if (tag === "circle") {
    const [cx, cy, r] = [a.cx, a.cy, a.r].map(Number);
    return `M${n(cx - r)},${n(cy)} a${n(r)},${n(r)} 0 1,1 ${n(2 * r)},0 a${n(r)},${n(r)} 0 1,1 ${n(-2 * r)},0 Z`;
  }
  if (tag === "rect") {
    const [x, y, w, h] = [a.x, a.y, a.width, a.height].map(Number);
    const r = Number(a.rx ?? 0);
    if (!r) return `M${n(x)},${n(y)} h${n(w)} v${n(h)} h${n(-w)} Z`;
    return `M${n(x + r)},${n(y)} H${n(x + w - r)} A${n(r)},${n(r)} 0 0,1 ${n(x + w)},${n(y + r)} V${n(y + h - r)} A${n(r)},${n(r)} 0 0,1 ${n(x + w - r)},${n(y + h)} H${n(x + r)} A${n(r)},${n(r)} 0 0,1 ${n(x)},${n(y + h - r)} V${n(y + r)} A${n(r)},${n(r)} 0 0,1 ${n(x + r)},${n(y)} Z`;
  }
  throw new Error(`unsupported element ${tag}`);
}

export function drawable(preset) {
  const paths = preset.art.map((markup) => {
    const tag = markup.match(/^<(\w+)/)[1];
    const a = attrsOf(markup);
    // SVG semantics, as the web renders it: no fill attribute means black fill; no stroke attribute means no stroke.
    const fill = a.fill === undefined ? "#000000" : a.fill === "none" ? null : colour(a.fill);
    const lines = [`        android:pathData="${pathData(tag, a)}"`];
    if (fill) lines.push(`        android:fillColor="${fill}"`);
    if (a.stroke) {
      lines.push(`        android:strokeColor="${colour(a.stroke)}"`);
      lines.push(`        android:strokeWidth="${a["stroke-width"] ?? 1}"`);
      if (a["stroke-linecap"]) lines.push(`        android:strokeLineCap="${a["stroke-linecap"]}"`);
      if (a["stroke-linejoin"]) lines.push(`        android:strokeLineJoin="${a["stroke-linejoin"]}"`);
    }
    return `    <path\n${lines.join("\n")} />`;
  });
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="100dp"
    android:height="100dp"
    android:viewportWidth="100"
    android:viewportHeight="100">
${paths.join("\n")}
</vector>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const stale = [];
  for (const preset of spec.presets) {
    const file = path.join(outDir, `avatar_preset_${preset.id}.xml`);
    const text = drawable(preset);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) stale.push(path.basename(file));
    } else {
      fs.writeFileSync(file, text);
    }
  }
  if (stale.length) {
    console.error(`stale drawables (run node clients/android/scripts/gen-avatar-drawables.mjs): ${stale.join(", ")}`);
    process.exit(1);
  }
}
