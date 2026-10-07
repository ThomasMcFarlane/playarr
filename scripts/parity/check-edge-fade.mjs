#!/usr/bin/env node
// Fails on a hard-cut scroll edge. Every scroll container must fade where content continues (web: the rail gutter mask,
// the radial edge shadows, the dark-theme page-background scrim). In a scrolled capture, the outermost pixels of the
// scroll viewport must be clearly dimmer, or closer to the page background, than the content a little way inside.
//
//   node check-edge-fade.mjs <png> --edge left|right|top|bottom --band x0,y0,x1,y1 [--bg #151315] [--max-ratio 0.35]
//                            [--interior x0,y0,x1,y1 [--min-gutter 0.15]] [--cut-x startLineX]
//
// <band> is the scroll viewport's edge area in image pixels (x0,y0 top-left, x1,y1 bottom-right): for a rail, its card rows
// from the viewport's outer edge to the content start line. "Content strength" is the mean |pixel - bg| luminance of each
// line across the band (smoothed over 5 lines). The outermost 6 lines must have at most --max-ratio of the band's peak
// strength (0.35 default for rail gutters, which fade to nothing; use about 0.75 for the radial edge shadows). Exit 1 and
// print FAIL otherwise; prints the numbers either way. The checks are heuristics over luminance: they separate a fade from a
// cut well on bright artwork and on the light theme, and only weakly on the dark placeholder art of the fixture, so treat a
// PASS there as "no gross cut" and compare the scrolled capture with web by eye as well (docs/parity).
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
if (!file || !opt("edge") || !opt("band")) { console.error("usage: check-edge-fade.mjs <png> --edge left|right|top|bottom --band x0,y0,x1,y1 [--bg #151315] [--max-ratio 0.35]"); process.exit(2); }
const edge = opt("edge");
const [x0, y0, x1, y1] = opt("band").split(",").map(Number);
const bgHex = opt("bg", "#151315").replace("#", "");
const bg = [0, 2, 4].map((i) => parseInt(bgHex.slice(i, i + 2), 16));
const bgLum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
const maxRatio = Number(opt("max-ratio", "0.35"));
const png = PNG.sync.read(readFileSync(file));
const lum = (x, y) => { const i = (png.width * y + x) * 4; return 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]; };
const strength = (ax, ay, bx, by) => { let sum = 0, n = 0; for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) { sum += Math.abs(lum(x, y) - bgLum); n++; } return sum / Math.max(n, 1); };
const S = 6;
// Content strength per line across the band (columns for left/right, rows for top/bottom), smoothed over 5 lines.
const horizontal = edge === "left" || edge === "right";
const lines = horizontal ? x1 - x0 : y1 - y0;
const raw = Array.from({ length: lines }, (_, k) => (horizontal ? strength(x0 + k, y0, x0 + k + 1, y1) : strength(x0, y0 + k, x1, y0 + k + 1)));
const smooth = raw.map((_, k) => { const a = Math.max(0, k - 2), b = Math.min(lines, k + 3); return raw.slice(a, b).reduce((p, v) => p + v, 0) / (b - a); });
const peak = Math.max(...smooth);
const outer = edge === "left" || edge === "top" ? smooth.slice(0, S) : smooth.slice(-S);
const edgeStrength = outer.reduce((p, v) => p + v, 0) / outer.length;
const ratio = peak > 0 ? edgeStrength / peak : 1;
const interiorStrength = peak;
// Optional --interior x0,y0,x1,y1: the content area next to the band (the cards from the start line inwards). Cards that are
// cut dead at the start line leave the gutter empty, so the band must still carry at least --min-gutter (default 0.15) of the
// interior's peak strength: scrolled-past cards are visible, fading, in the gutter.
let gutterOk = true;
let gutterNote = "";
if (opt("interior")) {
  const [ix0, iy0, ix1, iy1] = opt("interior").split(",").map(Number);
  const interiorPeak = strength(ix0, iy0, ix1, iy1);
  const share = interiorPeak > 0 ? peak / interiorPeak : 1;
  gutterOk = share >= Number(opt("min-gutter", "0.15"));
  gutterNote = ` gutter carries ${(share * 100).toFixed(0)}% of the interior strength${gutterOk ? "" : " (cards are cut dead at the edge)"}`;
}
// Optional --cut-x X (left/right edges only): the content start line. A card cut dead at the start line shows as a vertical step
// there: the mean horizontal luminance gradient across the band's rows within 4 px of X must not exceed 3x the 90th percentile
// of the gradient across the band, nor 8 levels. (A card edge that happens to sit exactly on the line can trip it; rescroll.)
let cutOk = true;
let cutNote = "";
if (opt("cut-x") && horizontal) {
  const cx = Number(opt("cut-x"));
  const grad = (x) => { let sum = 0, n = 0; for (let y = y0; y < y1; y++) { sum += Math.abs(lum(x + 1, y) - lum(x, y)); n++; } return sum / Math.max(n, 1); };
  const xs = Array.from({ length: x1 - x0 - 1 }, (_, k) => x0 + k);
  const all = xs.map(grad).sort((a, b) => a - b);
  const p90 = all[Math.floor(all.length * 0.9)] || 0;
  const near = Math.max(...[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => grad(cx + d)));
  cutOk = !(near > 8 && near > 3 * Math.max(p90, 1));
  cutNote = ` step at the start line ${near.toFixed(1)} (p90 ${p90.toFixed(1)})${cutOk ? "" : " (a card is cut dead at the start line)"}`;
}
const ok = ratio <= maxRatio && gutterOk && cutOk;
console.log(`${ok ? "PASS" : "FAIL"} ${file} ${edge} edge strength ${edgeStrength.toFixed(1)} peak ${interiorStrength.toFixed(1)} ratio ${ratio.toFixed(2)} (max ${maxRatio})${gutterNote}${cutNote}`);
process.exit(ok ? 0 : 1);
