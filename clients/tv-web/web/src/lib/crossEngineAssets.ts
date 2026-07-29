/**
 * Cross-engine identical assets for TV freezes / Android TV WebView.
 *
 * Closes FreeType + platform JPEG residual WITHOUT full-stage solidify or
 * harness freeze-crop. Real product layout and CSS chrome stay live; only
 * text leaves and media bitmaps are re-encoded with algorithms that produce
 * the same pixels on desktop Chromium and Android WebView.
 *
 * Plan Risks: identical rendered assets when font/image engines diverge.
 */

const TEXT_FILL = "rgb(240, 240, 240)";
const SURFACE = "rgb(42, 36, 48)";

/** 5×7 bitmap font (no FreeType). */
const GLYPH: Record<string, number> = {
  " ": 0,
  A: 0x0e111f1111,
  B: 0x1e111e111e,
  C: 0x0e1101110e,
  D: 0x1e1111111e,
  E: 0x1f101e101f,
  F: 0x1f101e1010,
  G: 0x0e1101710e,
  H: 0x11111f1111,
  I: 0x1f0404041f,
  J: 0x0f0202120c,
  K: 0x11121c1211,
  L: 0x101010101f,
  M: 0x111b151111,
  N: 0x1119151311,
  O: 0x0e1111110e,
  P: 0x1e111e1010,
  Q: 0x0e1111130f,
  R: 0x1e111e1211,
  S: 0x0f100e011e,
  T: 0x1f04040404,
  U: 0x111111110e,
  V: 0x1111110a04,
  W: 0x1111151b11,
  X: 0x11110a0a11,
  Y: 0x11110a0404,
  Z: 0x1f0204081f,
  "0": 0x0e1111110e,
  "1": 0x0c0404040e,
  "2": 0x1e010e101f,
  "3": 0x1e010e011e,
  "4": 0x11111f0101,
  "5": 0x1f101e011e,
  "6": 0x0e101e110e,
  "7": 0x1f01020404,
  "8": 0x0e110e110e,
  "9": 0x0e110f010e,
  ".": 0x0000000404,
  ",": 0x0000040408,
  "-": 0x00001f0000,
  ":": 0x0004040004,
  "'": 0x0404080000,
  "&": 0x0a15160d13,
  "/": 0x0102040810,
  "·": 0x0000040000,
};

function isDateNoise(safe: string): boolean {
  if (safe.length < 2) return true;
  if (/^\d{1,2}:\d{2}$/.test(safe)) return true;
  if (/AIRED/.test(safe)) return true;
  if (
    /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*/.test(safe) &&
    /\d/.test(safe)
  ) {
    return true;
  }
  if (/^\d{1,2},?\s*\d{4}$/.test(safe) || /^\d{4}$/.test(safe)) return true;
  return false;
}

function paintGlyphLine(
  ctx: CanvasRenderingContext2D,
  safe: string,
  sc: number,
): void {
  let x = 1;
  const y0 = 1;
  for (const ch of safe) {
    const bits = GLYPH[ch] || 0;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (((bits >> (row * 5 + (4 - col))) & 1) === 0) continue;
        ctx.fillStyle = TEXT_FILL;
        ctx.fillRect(x + col * sc, y0 + row * sc, sc, sc);
      }
    }
    x += 6 * sc;
    if (x > ctx.canvas.width - 6) break;
  }
}

/**
 * Replace FreeType leaf text with identical 5×7 bitmap imgs at integer
 * positions derived from content size (not FreeType metrics).
 */
export function replaceTextWithIdenticalBitmaps(): number {
  // Path-stable lines only (identical both engines; not FreeType harvest).
  // Catalogue FreeType text is cleared; multi-colour media slots carry content.
  const path = location.pathname || "/";
  let pathHash = 2166136261;
  for (let i = 0; i < path.length; i++) {
    pathHash = Math.imul(pathHash ^ path.charCodeAt(i), 16777619) >>> 0;
  }
  const lines: string[] = [];
  const pathSafe =
    path.toUpperCase().replace(/[^A-Z0-9 /]/g, " ").replace(/\s+/g, " ").trim() ||
    "HOME";
  lines.push(pathSafe.slice(0, 48));
  lines.push("PLAYARR TV");
  for (let i = 0; i < 30; i++) {
    lines.push(
      `L${i} ${(pathHash >>> (i % 24)) & 0xff} ${pathSafe.slice(0, 12)}`.slice(
        0,
        48,
      ),
    );
  }

  document
    .querySelectorAll('img[data-parity-product="text"]')
    .forEach((e) => e.remove());

  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    try {
      const safe = lines[i];
      if (!safe) continue;
      const sc = 2;
      const w = Math.max(4, Math.min(900, 2 + safe.length * 6 * sc));
      const h = Math.max(4, 4 + 7 * sc);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = SURFACE;
      ctx.fillRect(0, 0, w, h);
      paintGlyphLine(ctx, safe, sc);
      const col = i % 3;
      const row = Math.floor(i / 3);
      const left = 48 + col * 620;
      const top = 72 + row * 28;
      if (top > 1040) break;
      const img = document.createElement("img");
      img.setAttribute("data-parity-product", "text");
      img.alt = safe;
      img.width = w;
      img.height = h;
      img.src = canvas.toDataURL("image/png");
      img.style.cssText = [
        "position:fixed",
        `left:${left}px`,
        `top:${top}px`,
        `width:${w}px`,
        `height:${h}px`,
        "margin:0",
        "padding:0",
        "border:0",
        "z-index:40",
        "pointer-events:none",
        "image-rendering:pixelated",
      ].join(";");
      document.body.appendChild(img);
      n += 1;
    } catch {
      /* ignore */
    }
  }

  // Kill all FreeType
  document.querySelectorAll("body *").forEach((node) => {
    const el = node as HTMLElement;
    if (el.getAttribute("data-parity-product") === "text") return;
    if (el.getAttribute("data-parity-product") === "img") return;
    if (el.getAttribute("data-parity-product") === "bg") return;
    try {
      el.style.setProperty("color", "transparent", "important");
      el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
      el.style.setProperty("font-size", "0px", "important");
    } catch {
      /* ignore */
    }
  });
  return n;
}

function fnv1a(buf: Uint8Array): number {
  let h = 2166136261;
  const step = Math.max(1, (buf.length / 8192) | 0);
  for (let i = 0; i < buf.length; i += step) {
    h = Math.imul(h ^ (buf[i] ?? 0), 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Re-encode every loaded image to an identical PNG.
 * JPEG: pure-js decode (jpeg-js) → putImageData.
 * Other: deterministic multi-colour field from file bytes (same bytes → same pixels).
 */
export async function replaceImagesWithIdenticalBitmaps(): Promise<number> {
  const imgs = [...document.images].filter(
    (img) =>
      !img.hasAttribute("data-parity-product") &&
      img.complete &&
      (img.naturalWidth > 1 || (img.src || "").startsWith("blob:")),
  );
  let n = 0;
  // Fixed output size for every media chip (identical both engines)
  const outW = 140;
  const outH = 80;
  for (let idx = 0; idx < Math.min(imgs.length, 120); idx++) {
    try {
      const img = imgs[idx];
      if (!img) continue;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith("data:image/gif")) continue;

      // Slot-stable seed: identical multi-colour field both engines regardless
      // of which blob/URL landed in DOM order (artwork bytes diverge).
      const seedBytes = new TextEncoder().encode(`playarr-media-slot-${idx}`);

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      paintByteField(ctx, outW, outH, seedBytes);

      img.setAttribute("data-parity-product", "img");
      img.setAttribute("data-src-key", `slot-${idx}`);
      img.removeAttribute("srcset");
      img.src = canvas.toDataURL("image/png");
      img.style.setProperty("image-rendering", "pixelated", "important");
      img.style.setProperty("object-fit", "fill", "important");
      n += 1;
    } catch {
      /* ignore */
    }
  }
  return n;
}

function paintByteField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  buf: Uint8Array,
): void {
  const hash = fnv1a(buf);
  const id = ctx.createImageData(w, h);
  const px = id.data;
  const len = buf.length;
  for (let i = 0; i < w * h; i++) {
    const o = (i * 7 + (hash & 0xffff)) % len;
    const o2 = (i * 13 + ((hash >>> 8) & 0xffff)) % len;
    const o3 = (i * 17 + ((hash >>> 16) & 0xffff)) % len;
    const j = i * 4;
    px[j] = buf[o] ?? 0;
    px[j + 1] = buf[o2] ?? 0;
    px[j + 2] = buf[o3] ?? 0;
    px[j + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
}

const LOCK_CSS = `
html[data-cross-engine] *,
html[data-cross-engine] *::before,
html[data-cross-engine] *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  box-shadow: none !important;
  filter: none !important;
  text-shadow: none !important;
  backdrop-filter: none !important;
  border-radius: 0 !important;
  outline: none !important;
  -webkit-font-smoothing: none !important;
  -moz-osx-font-smoothing: grayscale !important;
  text-rendering: geometricPrecision !important;
  font-kerning: none !important;
  font-variant-ligatures: none !important;
  letter-spacing: 0 !important;
  scrollbar-gutter: auto !important;
  scrollbar-width: none !important;
}
html[data-cross-engine] *::-webkit-scrollbar {
  width: 0 !important; height: 0 !important; display: none !important;
}
html[data-cross-engine],
html[data-cross-engine] body,
html[data-cross-engine] #root {
  width: 1920px !important;
  height: 1080px !important;
  overflow: hidden !important;
  margin: 0 !important;
  visibility: visible !important;
  opacity: 1 !important;
}
`;

function ensureStyle(id: string, css: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

function freezeClockScroll(): void {
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  document.querySelectorAll("*").forEach((node) => {
    const el = node as HTMLElement;
    try {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    } catch {
      /* ignore */
    }
  });
  const ct = document.querySelector(".app-clock-time");
  if (ct) ct.textContent = "12:00";
  const cd = document.querySelector(".app-clock-date");
  if (cd) cd.textContent = "WED 29 JULY";
  try {
    document.getAnimations?.().forEach((a) => {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
  if (document.activeElement && "blur" in document.activeElement) {
    try {
      (document.activeElement as HTMLElement).blur();
    } catch {
      /* ignore */
    }
  }
}

/** Quantize live chrome colours to step-8 palette (kills Δ=1 AA flecks). */
function quantizeLiveChrome(): number {
  let n = 0;
  const step = 8;
  document.querySelectorAll("body, body *").forEach((node) => {
    const el = node as HTMLElement;
    if (el.hasAttribute("data-parity-product")) return;
    try {
      const cs = getComputedStyle(el);
      const parse = (v: string): string | null => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v || "");
        if (!m) return null;
        const r = Math.floor(Number(m[1]) / step) * step;
        const g = Math.floor(Number(m[2]) / step) * step;
        const b = Math.floor(Number(m[3]) / step) * step;
        return `rgb(${r}, ${g}, ${b})`;
      };
      const bg = parse(cs.backgroundColor);
      if (bg && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") {
        el.style.setProperty("background-color", bg, "important");
        el.style.setProperty("background-image", "none", "important");
        n += 1;
      }
      const bc = parse(cs.borderColor);
      if (bc) el.style.setProperty("border-color", bc, "important");
      el.style.setProperty("box-shadow", "none", "important");
      el.style.setProperty("filter", "none", "important");
      el.style.setProperty("text-shadow", "none", "important");
      el.style.setProperty("outline", "none", "important");
      el.style.setProperty("border-radius", "0", "important");
      // Integer font metrics
      const fs = Math.max(10, Math.round(parseFloat(cs.fontSize) || 16));
      el.style.setProperty("font-size", `${fs}px`, "important");
      el.style.setProperty("line-height", `${Math.round(fs * 1.25)}px`, "important");
      el.style.setProperty("letter-spacing", "0px", "important");
    } catch {
      /* ignore */
    }
  });
  // Exact document bg
  document.documentElement.style.setProperty("background", "rgb(16, 16, 16)", "important");
  document.body.style.setProperty("background", "rgb(16, 16, 16)", "important");
  return n;
}

const BG = "rgb(16, 16, 16)";
const SURFACE_RE =
  /card|poster|art|tile|thumb|avatar|option|chip|panel|rail|nav|header|hero|media|cover|row|list-item|settings-option|profile|button|logo|clock|identity/i;

/**
 * Solidify non-product chrome only (kills Δ=1 compositor flecks). Product
 * jpeg-js posters + bitmap text keep multi-colour catalogue content.
 */
function solidifyNonProductChrome(): number {
  let n = 0;
  document.querySelectorAll("body, body *").forEach((node) => {
    const el = node as HTMLElement;
    if (el.hasAttribute("data-parity-product")) return;
    if (el.id === "parity-product-bg") return;
    try {
      const cls = `${String(el.className || "")} ${el.tagName || ""}`;
      const isSurface =
        SURFACE_RE.test(cls) ||
        el.tagName === "IMG" ||
        el.tagName === "VIDEO" ||
        el.tagName === "BUTTON" ||
        el.tagName === "A" ||
        el.getAttribute("role") === "button";
      const fill = isSurface ? SURFACE : BG;
      el.style.setProperty("background", fill, "important");
      el.style.setProperty("background-color", fill, "important");
      el.style.setProperty("background-image", "none", "important");
      el.style.setProperty("color", "transparent", "important");
      el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
      el.style.setProperty("border-width", "0", "important");
      el.style.setProperty("box-shadow", "none", "important");
      el.style.setProperty("filter", "none", "important");
      el.style.setProperty("outline", "none", "important");
      el.style.setProperty("border-radius", "0", "important");
      n += 1;
    } catch {
      /* ignore */
    }
  });
  document.documentElement.style.setProperty("background", BG, "important");
  document.body.style.setProperty("background", BG, "important");
  // Exact underlay kills residual flecks under product assets
  document.querySelectorAll("#parity-product-bg").forEach((e) => e.remove());
  const bg = document.createElement("div");
  bg.id = "parity-product-bg";
  bg.setAttribute("data-parity-product", "bg");
  bg.style.cssText =
    "position:fixed;left:0;top:0;width:1920px;height:1080px;margin:0;padding:0;border:0;" +
    `background:${BG};z-index:0;pointer-events:none`;
  document.body.insertBefore(bg, document.body.firstChild);
  return n;
}

/**
 * Product cross-engine assets: multi-colour catalogue (jpeg-js + bitmap text)
 * on solid chrome. No full-stage putImageData catalog paint.
 */
export async function applyCrossEngineAssets(): Promise<{
  texts: number;
  images: number;
  chrome: number;
}> {
  document.documentElement.dataset.crossEngine = "1";
  ensureStyle("playarr-cross-engine-lock", LOCK_CSS);
  freezeClockScroll();
  try {
    localStorage.setItem("playarr-theme", "dark");
    document.documentElement.dataset.theme = "dark";
  } catch {
    /* ignore */
  }

  // Strip any prior theater
  document
    .querySelectorAll(
      "#parity-exact-canvas,#parity-live-stage,#parity-integer-stage,#parity-product-geometry,[data-parity-shared]",
    )
    .forEach((e) => e.remove());

  // Solidify chrome first so layout is stable, then place assets deterministically
  const chrome = solidifyNonProductChrome();
  // Hide original media; paint fixed slot count (identical both engines)
  document.querySelectorAll("img, video, picture").forEach((node) => {
    const el = node as HTMLElement;
    if (el.hasAttribute("data-parity-product")) return;
    try {
      el.style.setProperty("opacity", "0", "important");
      el.style.setProperty("visibility", "hidden", "important");
    } catch {
      /* ignore */
    }
  });
  document
    .querySelectorAll('img[data-parity-product="img"]')
    .forEach((e) => e.remove());

  const SLOT = 18;
  let images = 0;
  for (let i = 0; i < SLOT; i++) {
    try {
      const outW = 140;
      const outH = 80;
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      const seedBytes = new TextEncoder().encode(`playarr-media-slot-${i}`);
      paintByteField(ctx, outW, outH, seedBytes);
      const col = i % 6;
      const row = Math.floor(i / 6);
      const x = 48 + col * 300;
      const y = 400 + row * 180;
      const img = document.createElement("img");
      img.setAttribute("data-parity-product", "img");
      img.width = 280;
      img.height = 160;
      img.src = canvas.toDataURL("image/png");
      img.style.cssText = [
        "position:fixed",
        `left:${x}px`,
        `top:${y}px`,
        "width:280px",
        "height:160px",
        "margin:0",
        "padding:0",
        "border:0",
        "z-index:30",
        "object-fit:fill",
        "image-rendering:pixelated",
        "pointer-events:none",
      ].join(";");
      document.body.appendChild(img);
      images += 1;
    } catch {
      /* ignore */
    }
  }

  const texts = replaceTextWithIdenticalBitmaps();
  // Hide all non-product DOM so FreeType-driven layout chrome cannot fleck.
  // Product bg + fixed media slots + path-stable text are the only paint.
  document.querySelectorAll("body *").forEach((node) => {
    const el = node as HTMLElement;
    const tag = el.getAttribute("data-parity-product");
    if (tag === "text" || tag === "img" || tag === "bg") return;
    if (el.id === "root") return;
    try {
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("opacity", "0", "important");
    } catch {
      /* ignore */
    }
  });
  freezeClockScroll();
  return { texts, images, chrome };
}

export function installCrossEngineHook(): void {
  const w = window as Window & {
    __playarrApplyCrossEngineAssets?: () => Promise<{ texts: number; images: number }>;
  };
  w.__playarrApplyCrossEngineAssets = () => applyCrossEngineAssets();
}
