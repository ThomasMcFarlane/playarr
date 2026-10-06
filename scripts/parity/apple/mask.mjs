#!/usr/bin/env node
// Paints the system UI bands (status bar, home indicator) of every PNG in a directory with one flat
// colour, in place. Run on both the web reference and the native capture before diffing, so the
// bands never count as mismatch.
//   node mask.mjs <dir> [topPx] [bottomPx]      (defaults 141 and 102: 47pt and 34pt at 3x)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const [dir, top = "141", bottom = "102"] = process.argv.slice(2);
if (!dir) { console.error("usage: mask.mjs <dir> [topPx] [bottomPx]"); process.exit(2); }
for (const f of readdirSync(dir).filter((n) => n.endsWith(".png"))) {
  const p = join(dir, f);
  const png = PNG.sync.read(readFileSync(p));
  const paint = (y0, y1) => {
    for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 1)
      for (let x = 0; x < png.width; x += 1) png.data.writeUInt32BE(0xff00ffff, (y * png.width + x) * 4);
  };
  paint(0, Number(top));
  paint(png.height - Number(bottom), png.height);
  writeFileSync(p, PNG.sync.write(png));
}
