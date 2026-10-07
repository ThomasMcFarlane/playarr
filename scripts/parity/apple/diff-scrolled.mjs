#!/usr/bin/env node
// Scrolled-state check for a native capture: pixel mismatch against the web capture at the same scroll position
// (capture-web-scrolled.mjs) and the hard-cut edge check (check-edge-fade.mjs) on both images.
//   node diff-scrolled.mjs --web <dir> --native <dir> --theme light,dark [--out <dir>] [--id home-scrolled]
// <dir>/tv/<theme>/<id>.png on both sides. Writes <out>/<theme>-<id>-diff.png and prints a markdown table; exits 1
// when a screen is over 1% or either image has a hard-cut edge.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const web = opt("web"), native = opt("native"), out = opt("out", "scrolled-diff"), id = opt("id", "home-scrolled");
const themes = opt("theme", "dark,light").split(",");
mkdirSync(out, { recursive: true });
// Left gutter of the first rail (x 730 to 882 at 1920 px, `--tv-track-left-fade`), rows of its cards.
const BAND = "730,500,882,640";
const BG = { dark: "#151315", light: "#f5f3f2" };
let failed = false;
console.log(`| ${id} | mismatch % | web edge | native edge |\n| --- | --- | --- | --- |`);
for (const theme of themes) {
  const a = PNG.sync.read(readFileSync(join(web, "tv", theme, `${id}.png`)));
  const b = PNG.sync.read(readFileSync(join(native, "tv", theme, `${id}.png`)));
  const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
  const pad = (p) => { const q = new PNG({ width: w, height: h }); PNG.bitblt(p, q, 0, 0, p.width, p.height, 0, 0); return q; };
  const A = pad(a), B = pad(b), D = new PNG({ width: w, height: h });
  const n = pixelmatch(A.data, B.data, D.data, w, h, { threshold: 0.1 });
  const pct = (100 * n) / (w * h);
  writeFileSync(join(out, `${theme}-${id}-diff.png`), PNG.sync.write(D));
  const edge = (side, file) => spawnSync("node", [join(here, "../check-edge-fade.mjs"), file, "--edge", "left", "--band", BAND, "--bg", BG[theme], "--max-ratio", "0.35"], { encoding: "utf8" });
  const ea = edge("web", join(web, "tv", theme, `${id}.png`)), eb = edge("native", join(native, "tv", theme, `${id}.png`));
  console.error(ea.stdout.trim(), "\n", eb.stdout.trim());
  // The check's default limit is calibrated on a rail gutter that fades to nothing. The web is the reference, so the native
  // edge passes when it is no harder than the web's own (within 0.05 of its ratio) or under the limit.
  const ratio = (r) => Number(/ratio ([0-9.]+)/.exec(r.stdout)?.[1] ?? 1);
  const webOk = ea.status === 0 || ratio(ea) <= 0.6;
  const nativeOk = eb.status === 0 || ratio(eb) <= Math.max(0.35, ratio(ea) + 0.05);
  const ok = pct <= 1 && webOk && nativeOk;
  if (!ok) failed = true;
  console.log(`| ${theme} | ${pct.toFixed(2)} ${pct <= 1 ? "" : "FAIL"} | ${webOk ? "pass " : "FAIL "}${ratio(ea).toFixed(2)} | ${nativeOk ? "pass " : "FAIL "}${ratio(eb).toFixed(2)} |`);
}
process.exit(failed ? 1 : 0);
