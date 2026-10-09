#!/usr/bin/env node
// Card captions sit on the page background (not on art) and need no backing box (owner rule: no boxes). For the
// focused card and a resting card on Home, the Library grid and the series grid, in both themes at two sizes:
//   1. no caption element, and no ancestor up to the track, has a background (a box, a bar),
//   2. WCAG AAA: the caption text colour against the worst pixels actually behind it (text made transparent, the
//      page screenshotted) is at least 7:1, or 4.5:1 for large text.
//   node scripts/nav-caption-contrast-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 40, series: 12, seasons: 2, artists: 0, onDeck: 3 });

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const CAPTIONS = ".tv-home-card > strong, .tv-home-card > small, .tv-title-card-copy strong, .tv-title-card-copy small";

async function inspect(page, label) {
  // Boxes: any non-transparent background on a caption or its ancestors up to the card.
  const boxes = await page.evaluate((sel) => {
    const bad = [];
    for (const el of document.querySelectorAll(sel)) {
      for (let n = el; n && !n.matches(".tv-home-card, .tv-title-card"); n = n.parentElement) {
        const c = getComputedStyle(n);
        const hasBg = c.backgroundImage !== "none" || !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(c.backgroundColor);
        if (hasBg) bad.push(`${n.tagName.toLowerCase()}.${String(n.className).split(" ")[0]} ${c.backgroundColor}`);
      }
    }
    return [...new Set(bad)].slice(0, 5);
  }, CAPTIONS);
  check(`${label}: no box or bar behind any caption`, boxes.length === 0, boxes.join("; "));
  // Contrast against the pixels behind the text.
  const items = await page.evaluate((sel) => {
    const out = [];
    document.querySelectorAll(sel).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom > innerHeight * 0.88 || r.top < 0 || r.right > innerWidth - 60 || r.left < 0) return; // the edge fades are their own, softer, treatment
      const cs = getComputedStyle(el);
      const m = /rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/.exec(cs.color);
      const parts = (m[1] ?? m[2]).split(/[,\s/]+/).filter(Boolean).map(Number);
      const rgb = m[1] ? parts : parts.map((v, k) => (k < 3 ? v * 255 : v));
      el.dataset.capIdx = String(i);
      const sel2 = Boolean(el.closest(".is-selected"));
      out.push({ i, sel: sel2, t: el.textContent.trim().slice(0, 20), rgb, a: rgb[3] ?? 1, size: parseFloat(cs.fontSize), bold: Number(cs.fontWeight) >= 700, x: Math.floor(r.left), y: Math.floor(r.top), w: Math.ceil(r.width), h: Math.ceil(r.height) });
    });
    const style = document.createElement("style");
    style.id = "cap-hide";
    style.textContent = `${sel.split(",").map((s) => s.trim()).join(", ")} { color: transparent !important; text-shadow: none !important; }`;
    document.head.append(style);
    return out;
  }, CAPTIONS);
  await page.waitForTimeout(150);
  const png = (await page.screenshot()).toString("base64");
  await page.evaluate(() => document.getElementById("cap-hide")?.remove());
  const res = await page.evaluate(async ({ png, items }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const scale = img.width / innerWidth;
    return items.map((it) => {
      const d = ctx.getImageData(Math.round(it.x * scale), Math.round(it.y * scale), Math.max(1, Math.round(it.w * scale)), Math.max(1, Math.round(it.h * scale))).data;
      let worst = null;
      const L = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ls = [];
      for (let k = 0; k < d.length; k += 4) ls.push(L(d[k], d[k + 1], d[k + 2]));
      ls.sort((a, b) => a - b);
      return { ...it, bgLo: ls[Math.floor(ls.length * 0.02)], bgHi: ls[Math.floor(ls.length * 0.98)], bgMed: ls[Math.floor(ls.length / 2)] };
    });
  }, { png, items });
  let worst = Infinity;
  let worstDetail = "";
  for (const it of res) {
    const text = lum(it.rgb);
    const large = it.size >= 24 || (it.bold && it.size >= 18.66);
    const need = large ? 4.5 : 7;
    const r = Math.min(ratio(text, it.bgLo), ratio(text, it.bgHi));
    if (r - need < worst) { worst = r - need; worstDetail = `${it.sel ? "selected" : "resting"} '${it.t}' y=${it.y} ${r.toFixed(2)}:1 needs ${need} (text ${it.rgb.slice(0, 3).map(Math.round)}, bg lum ${it.bgLo.toFixed(3)}..${it.bgHi.toFixed(3)})`; }
  }
  check(`${label}: caption text meets AAA over the real pixels (${res.length} captions)`, res.length > 0 && worst >= 0, worstDetail);
}

for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  for (const theme of ["dark", "light"]) {
    for (const [name, path, ready] of [["Home", "/", ".tv-home-card"], ["Library", "/movies", ".tv-title-card"], ["Series", "/series", ".tv-title-card"]]) {
      const { context, page } = await open(path, { width: w, height: h, theme });
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForSelector(ready, { timeout: 8000 });
      await page.waitForTimeout(800);
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(900);
      await page.screenshot({ path: `/home/Storage/Projects/repositories/.data/ThomasMcFarlane/playarr/scratch/20261010-post-425/shots/local-${name}-${w}-${theme}.png` });
      await inspect(page, `${name} ${w}x${h} ${theme}`);
      await context.close();
    }
  }
}
await finish();
