// Public screenshot manifest: sha256 of every public screenshot, rewritten only by the showcase capture scripts.
//   node scripts/showcase/manifest.mjs --write   # after a capture
//   node scripts/showcase/manifest.mjs --check   # CI: every public screenshot must match the manifest
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Public screenshot locations (keep in sync with scripts/ci/check-public-screenshots.sh).
export const PUBLIC_DIRS = [
  "docs/assets/readme/screenshots",
  "site/src/assets/screenshots",
  "site/public/screenshots",
  "clients/android/fastlane/metadata/android",
  "clients/ios/fastlane/screenshots",
  "clients/ios/fastlane/metadata",
  "clients/apple-tv/fastlane/screenshots",
];
const IMAGE = /\.(png|jpe?g|webp)$/i;
// Brand graphics in the store listing are not screenshots.
const BRAND = /\/(icon|featureGraphic|tvBanner)\.(png|jpe?g|webp)$/;
export const MANIFEST = "scripts/showcase/screenshots.sha256";

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (IMAGE.test(e.name) && !BRAND.test(p.split(path.sep).join("/"))) out.push(p.split(path.sep).join("/"));
  }
}
export function listPublic(root) {
  const out = [];
  for (const d of PUBLIC_DIRS) walk(path.join(root, d), out);
  return out.map((p) => path.relative(root, p).split(path.sep).join("/")).sort();
}
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export function render(root) {
  return listPublic(root).map((f) => `${sha(path.join(root, f))}  ${f}`).join("\n") + "\n";
}
export function writeManifest(root) {
  fs.writeFileSync(path.join(root, MANIFEST), render(root));
  console.log(`wrote ${MANIFEST}`);
}
export function checkManifest(root) {
  const want = fs.existsSync(path.join(root, MANIFEST)) ? fs.readFileSync(path.join(root, MANIFEST), "utf8") : "";
  const got = render(root);
  if (want === got) return [];
  const w = new Map(want.split("\n").filter(Boolean).map((l) => [l.slice(66), l.slice(0, 64)]));
  const g = new Map(got.split("\n").filter(Boolean).map((l) => [l.slice(66), l.slice(0, 64)]));
  const bad = [];
  for (const [f, h] of g) if (w.get(f) !== h) bad.push(`${f}: ${w.has(f) ? "changed" : "not in the manifest"} since the last showcase capture`);
  for (const f of w.keys()) if (!g.has(f)) bad.push(`${f}: in the manifest but missing`);
  return bad;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(process.argv[1]), "../..");
  if (process.argv.includes("--write")) writeManifest(root);
  else {
    const bad = checkManifest(root);
    if (bad.length) {
      console.error("Public screenshots must be produced by scripts/showcase (open-movie demo library), then `node scripts/showcase/manifest.mjs --write`:");
      for (const b of bad) console.error("  " + b);
      process.exit(1);
    }
    console.log("public screenshots match the showcase manifest");
  }
}
