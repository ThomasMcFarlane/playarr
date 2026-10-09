#!/usr/bin/env node
// Single source of truth for the six preset profile avatars.
//
//   presets.json   ids, gradient stops and the SVG artwork (100x100 box), taken from the web client's
//                  `ProfileAvatar` (clients/tv-web/web/src/components/ProfileAvatar.tsx), which is the reference.
//   plates/<id>.svg  the full circular plate: web's `.profile-avatar` 145deg gradient, 34%/26% sheen, artwork at 86%.
//   plates/<id>.png  the same plate at 240 px for clients that cannot draw SVG (Roku). Needs rsvg-convert.
//
// Usage (from the repository root):
//   node clients/shared/profile-avatars/render.mjs           regenerate plates/
//   node clients/shared/profile-avatars/render.mjs --check   fail when plates/ or the web client drifted
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const spec = JSON.parse(fs.readFileSync(path.join(here, "presets.json"), "utf8"));
const PNG_SIZE = 240;

/** CSS `linear-gradient(145deg, ...)` on a square, as an SVG user-space gradient line. */
function gradientLine(size, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const half = ((Math.abs(size * dx) + Math.abs(size * dy)) / 2);
  const c = size / 2;
  return { x1: c - dx * half, y1: c - dy * half, x2: c + dx * half, y2: c + dy * half };
}

export function plateSvg(preset) {
  const size = spec.viewBox;
  const g = gradientLine(size, 145);
  const f = (n) => Number(n.toFixed(3));
  const inset = (size * (1 - spec.artScale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<defs>
<clipPath id="plate"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></clipPath>
<linearGradient id="fill" gradientUnits="userSpaceOnUse" x1="${f(g.x1)}" y1="${f(g.y1)}" x2="${f(g.x2)}" y2="${f(g.y2)}"><stop offset="0" stop-color="${preset.start}"/><stop offset="1" stop-color="${preset.end}"/></linearGradient>
<radialGradient id="sheen" gradientUnits="userSpaceOnUse" cx="${size * 0.34}" cy="${size * 0.26}" r="${f(size * 0.2677)}"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<g clip-path="url(#plate)">
<rect width="${size}" height="${size}" fill="url(#fill)"/>
<rect width="${size}" height="${size}" fill="url(#sheen)"/>
<g transform="translate(${inset} ${inset}) scale(${spec.artScale})">
${preset.art.join("\n")}
</g>
</g>
</svg>
`;
}

const outDir = path.join(here, "plates");
const check = process.argv.includes("--check");
const problems = [];

// The web client is the reference: every art element in presets.json must appear in its source, and vice versa.
const webSource = fs.readFileSync(path.join(repo, "clients/tv-web/web/src/components/ProfileAvatar.tsx"), "utf8");
const webLib = fs.readFileSync(path.join(repo, "clients/tv-web/web/src/lib/profileAvatar.ts"), "utf8");
const webPaths = new Set([...webSource.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]));
const jsonPaths = new Set(spec.presets.flatMap((p) => p.art.flatMap((el) => [...el.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]))));
for (const d of jsonPaths) if (!webPaths.has(d)) problems.push(`presets.json path not in web ProfileAvatar.tsx: ${d}`);
for (const d of webPaths) if (!jsonPaths.has(d)) problems.push(`web ProfileAvatar.tsx path not in presets.json: ${d}`);
for (const p of spec.presets) {
  if (!webLib.includes(`{ id: "${p.id}", start: "${p.start}", end: "${p.end}" }`)) {
    problems.push(`web PROFILE_AVATAR_PRESETS differs for ${p.id}`);
  }
}

const hasRsvg = spawnSync("rsvg-convert", ["--version"]).status === 0;
if (!check) fs.mkdirSync(outDir, { recursive: true });
for (const preset of spec.presets) {
  const svgPath = path.join(outDir, `${preset.id}.svg`);
  const svg = plateSvg(preset);
  if (check) {
    if (!fs.existsSync(svgPath) || fs.readFileSync(svgPath, "utf8") !== svg) problems.push(`stale ${path.relative(repo, svgPath)}`);
    continue;
  }
  fs.writeFileSync(svgPath, svg);
  if (!hasRsvg) {
    console.warn("rsvg-convert not found: PNG plates not regenerated");
    continue;
  }
  execFileSync("rsvg-convert", ["-w", String(PNG_SIZE), "-h", String(PNG_SIZE), "-o", path.join(outDir, `${preset.id}.png`), svgPath]);
}
if (check && spawnSync("rsvg-convert", ["--version"]).status === 0) {
  for (const preset of spec.presets) {
    const png = path.join(outDir, `${preset.id}.png`);
    if (!fs.existsSync(png)) problems.push(`missing ${path.relative(repo, png)}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(check ? "profile avatars in sync" : `wrote ${spec.presets.length} plates`);
