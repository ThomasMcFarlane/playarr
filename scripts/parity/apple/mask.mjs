#!/usr/bin/env node
// Paints the system UI bands (status bar, home indicator) of every PNG in a directory with one flat
// colour, in place. Run on both the web reference and the native capture before diffing, so the
// bands never count as mismatch.
//   node mask.mjs <dir> [topPx] [bottomPx] [screens.json]   (defaults 141 and 102: 47pt and 34pt at 3x)
// Per screen in screens.json, "mask" may be:
//   absent                          paint the two system bands (default)
//   false                           paint nothing
//   { "bands": false, "rects": [[x, y, w, h], ...], "why": "..." }
//                                   paint the listed device-pixel rectangles, and the bands unless
//                                   "bands" is false. Used for justified platform differences such as
//                                   the decoded video picture in the player screens.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const [dir, top = "141", bottom = "102", screensFile] = process.argv.slice(2);
if (!dir) { console.error("usage: mask.mjs <dir> [topPx] [bottomPx] [screens.json]"); process.exit(2); }
const rules = new Map(
  (screensFile ? JSON.parse(readFileSync(screensFile, "utf8")).screens : []).map((x) => [`${x.id}.png`, x.mask])
);
for (const f of readdirSync(dir).filter((n) => n.endsWith(".png"))) {
  const rule = rules.get(f);
  if (rule === false) continue;
  const p = join(dir, f);
  const png = PNG.sync.read(readFileSync(p));
  const paint = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 1)
      for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x += 1)
        png.data.writeUInt32BE(0xff00ffff, (y * png.width + x) * 4);
  };
  if (!rule || rule.bands !== false) {
    paint(0, 0, png.width, Number(top));
    paint(0, png.height - Number(bottom), png.width, png.height);
  }
  for (const [x, y, w, h] of rule?.rects ?? []) paint(x, y, x + w, y + h);
  writeFileSync(p, PNG.sync.write(png));
}
