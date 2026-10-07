#!/usr/bin/env node
// Masks the decoded video for the player screens, as the Android clients do: every pixel outside the chrome is copied
// from the reference into the candidate, so only the chrome (top buttons, scrubber and transport row, the quality
// panel with its blur) counts towards the mismatch. The unmasked candidate stays in the artifact.
// Usage: mask-video.mjs <ref-dir> <cand-dir> <out-dir> <id> [<id> ...]   (dirs hold <id>.png, 1920x1080)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
const { PNG } = require("pngjs");

const [refDir, candDir, outDir, ...ids] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

// Chrome rectangles in stage pixels: x, y, w, h.
const chrome = {
  "player-controls": [
    [1660, 20, 220, 90],
    [0, 900, 1920, 180],
  ],
  "player-quality-menu": [
    [1660, 20, 220, 90],
    [0, 900, 1920, 180],
    [1064, 530, 640, 428],
  ],
};

for (const id of ids) {
  const rects = chrome[id];
  const ref = PNG.sync.read(readFileSync(join(refDir, `${id}.png`)));
  const cand = PNG.sync.read(readFileSync(join(candDir, `${id}.png`)));
  if (!rects || ref.width !== cand.width || ref.height !== cand.height) {
    writeFileSync(join(outDir, `${id}.png`), readFileSync(join(candDir, `${id}.png`)));
    continue;
  }
  const out = new PNG({ width: cand.width, height: cand.height });
  for (let y = 0; y < cand.height; y++) {
    for (let x = 0; x < cand.width; x++) {
      const inChrome = rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
      const i = (y * cand.width + x) * 4;
      const src = inChrome ? cand.data : ref.data;
      for (let c = 0; c < 4; c++) out.data[i + c] = src[i + c];
    }
  }
  writeFileSync(join(outDir, `${id}.png`), PNG.sync.write(out));
}
