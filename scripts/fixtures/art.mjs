#!/usr/bin/env node
// Generates placeholder posters and backdrops for the fixture catalogue with
// ffmpeg: a two-colour gradient, a few translucent shapes and the placeholder
// title. Nothing real is involved. Usage: node art.mjs <art-dir>
// Idempotent: an image that already exists is left alone.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SERIES, MOVIES } from "./catalog.mjs";

export const artKey = (kind, id) => `${kind}-${id}`;

// Hand-picked colour pairs (top-left, bottom-right) so the shelf looks varied.
const PALETTE = [
  ["0x8a3a5e", "0x14102b"],
  ["0x2f6f8f", "0x0d1b2e"],
  ["0x8a6a2a", "0x24160b"],
  ["0x4a8a5a", "0x0c2218"],
  ["0x6a4aa0", "0x170f33"],
];

const ffmpeg = process.env.PLAYARR_FFMPEG_BINARY ?? "ffmpeg";

// Some ffmpeg builds (for example the macOS runner's) have no drawtext filter: the art is then
// rendered without the title text, which is still a valid placeholder.
// Only probed where the unscoped path is used (CI runners); a scoped host build has drawtext.
const hasDrawtext = (() => {
  if (!process.env.PLAYARR_FIXTURE_NO_SCOPE) return true;
  const r = spawnSync(ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8", timeout: 20000 });
  return r.status === 0 && /\bdrawtext\b/.test(r.stdout);
})();

function run(args) {
  const base = ["-v", "error", "-y", "-threads", "2", ...args];
  const [cmd, cmdArgs] = process.env.PLAYARR_FIXTURE_NO_SCOPE
    ? [ffmpeg, base]
    : ["systemd-run", ["--user", "--scope", "--quiet", "-p", "MemoryHigh=1G", "-p", "MemoryMax=2G", "-p", "MemorySwapMax=0", "--", ffmpeg, ...base]];
  const r = spawnSync(cmd, cmdArgs, { stdio: ["ignore", "inherit", "inherit"], timeout: 60000 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}

// The gradients source picks a random start unless it is given a seed: pin it so the PNG is byte-identical.
function render(out, w, h, [c0, c1], title, caption, seed) {
  if (existsSync(out)) return;
  const fs = Math.round(w / 9.5);
  const circle = Math.round(h * 0.55);
  const vf = [
    `drawbox=x=${Math.round(w * 0.12 + ((seed * 17) % (w * 0.3)))}:y=${Math.round(h * 0.1)}:w=${circle}:h=${circle}:color=white@0.07:t=fill`,
    `drawbox=x=${Math.round(w * 0.4)}:y=${Math.round(h * 0.28)}:w=${Math.round(circle * 0.6)}:h=${Math.round(circle * 0.6)}:color=white@0.06:t=fill`,
    `drawbox=x=0:y=${Math.round(h * 0.7)}:w=${w}:h=${Math.round(h * 0.3)}:color=black@0.45:t=fill`,
    `drawtext=font='Sans':text='${title.toUpperCase()}':fontcolor=white:fontsize=${fs}:x=(w-text_w)/2:y=${Math.round(h * 0.76)}`,
    `drawtext=font='Sans':text='${caption}':fontcolor=white@0.6:fontsize=${Math.round(fs / 2.8)}:x=(w-text_w)/2:y=${Math.round(h * 0.76 + fs * 1.5)}`,
  ].filter((f) => hasDrawtext || !f.startsWith("drawtext")).join(",");
  run(["-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:d=1:n=2:seed=${seed + 1}`, "-frames:v", "1", "-vf", vf, out]);
}

export function generateArt(dir) {
  mkdirSync(dir, { recursive: true });
  // Art made by another version of this script or catalogue is regenerated (stale art differs between instances).
  const source = ["art.mjs", "catalog.mjs"].map((f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8")).join("\n");
  const stamp = createHash("sha1").update(source).digest("hex");
  const stampFile = join(dir, ".art-stamp");
  if (!existsSync(stampFile) || readFileSync(stampFile, "utf8") !== stamp) {
    for (const f of readdirSync(dir)) if (f.endsWith(".png")) rmSync(join(dir, f));
    writeFileSync(stampFile, stamp);
  }
  [...MOVIES.map((m) => ["movie", m]), ...SERIES.map((s) => ["series", s])].forEach(([kind, item], i) => {
    const colours = PALETTE[i % PALETTE.length];
    const key = artKey(kind, item.id);
    render(join(dir, `${key}-poster.png`), 600, 900, colours, item.title, "PLACEHOLDER ARTWORK", i);
    render(join(dir, `${key}-backdrop.png`), 1280, 720, colours, item.title, "PLACEHOLDER ARTWORK", i);
  });
}

if (process.argv[1] && process.argv[1].endsWith("art.mjs")) {
  if (!process.argv[2]) {
    console.error("usage: art.mjs <art-dir>");
    process.exit(2);
  }
  generateArt(process.argv[2]);
}
