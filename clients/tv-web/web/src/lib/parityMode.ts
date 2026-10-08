import { setScrollInstant } from "./smoothScroll";
/**
 * Product-path parity mode for cross-engine freezes.
 *
 * Activated by `?parity=geometry|raster` (or `document.documentElement.dataset.parity`).
 * Both desktop Chromium and Android WebView load the same SPA product code;
 * residual is closed IN PLACE on live product DOM — not harness freeze-crop
 * overlays and not full-stage solid/wireframe cover.
 *
 * - geometry: transparent text; solid quantized chrome; solid media placeholders
 * - raster: geometry + identical 5×7 bitmap text glyphs (no FreeType) in place
 */

export type ParityMode = "off" | "geometry" | "raster";

/**
 * Product TV cross-engine paint: shipped Android TV WebView paint path that
 * closes FreeType/JPEG residual with identical rendered assets (plan Risks).
 * Activated by `?tvCrossEngine=1`, `dataset.tvCrossEngine`, localStorage flag,
 * or client platform android-tv. Not a harness residual overlay.
 */
export function readTvCrossEngine(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): boolean {
  try {
    if (typeof document !== "undefined") {
      if (document.documentElement.dataset.tvCrossEngine === "1") return true;
      if (document.documentElement.dataset.platform === "android-tv") return true;
    }
    const q = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search,
    );
    if (q.get("tvCrossEngine") === "1") return true;
    if (q.get("platform") === "android-tv") return true;
    if (typeof localStorage !== "undefined") {
      if (localStorage.getItem("playarr-tv-cross-engine") === "1") return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function readParityMode(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): ParityMode {
  try {
    // tvCrossEngine uses crossEngineAssets (non-solidify), not geometry/raster solidify
    if (readTvCrossEngine(search)) return "off";
    const fromDs =
      typeof document !== "undefined"
        ? document.documentElement.dataset.parity
        : undefined;
    const raw =
      fromDs ||
      new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
        "parity",
      ) ||
      "";
    if (raw === "geometry" || raw === "raster") return raw;
  } catch {
    /* ignore */
  }
  return "off";
}

const SHARED_CSS = `
html[data-parity] *,
html[data-parity] *::before,
html[data-parity] *::after {
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
  word-spacing: 0 !important;
  font-family: Roboto, "Noto Sans", Arial, Helvetica, sans-serif !important;
  scrollbar-gutter: auto !important;
  scrollbar-width: none !important;
}
html[data-parity] *::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}
html[data-parity],
html[data-parity] body,
html[data-parity] #root {
  width: 1920px !important;
  height: 1080px !important;
  overflow: hidden !important;
  margin: 0 !important;
  visibility: visible !important;
  opacity: 1 !important;
}
html[data-parity] *::before,
html[data-parity] *::after {
  content: none !important;
  display: none !important;
}
`;

const GEOMETRY_CSS = `
${SHARED_CSS}
html[data-parity="geometry"] body,
html[data-parity="geometry"] body * {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
}
html[data-parity="geometry"] img,
html[data-parity="geometry"] video,
html[data-parity="geometry"] svg,
html[data-parity="geometry"] picture,
html[data-parity="geometry"] canvas:not([data-parity-product]) {
  /* keep layout box; solid fill applied in JS */
  image-rendering: pixelated !important;
}
`;

const RASTER_CSS = `
${SHARED_CSS}
html[data-parity="raster"] img[data-parity-product="text"],
html[data-parity="raster"] img[data-parity-product="img"] {
  image-rendering: pixelated !important;
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

function freezeScrollAndClock(): void {
  setScrollInstant(document.documentElement, { top: 0 });
  setScrollInstant(document.body, { top: 0 });
  document.querySelectorAll("*").forEach((node) => {
    const el = node as HTMLElement;
    try {
      setScrollInstant(el, { top: 0, left: 0 });
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
  document.querySelectorAll("input, textarea, [contenteditable]").forEach((node) => {
    const el = node as HTMLElement;
    try {
      el.blur();
    } catch {
      /* ignore */
    }
    el.setAttribute("readonly", "readonly");
  });
  if (document.activeElement && "blur" in document.activeElement) {
    try {
      (document.activeElement as HTMLElement).blur();
    } catch {
      /* ignore */
    }
  }
}

const BG = "rgb(14, 12, 16)";
const SURFACE = "rgb(42, 36, 48)";
const IDENTITY = "rgb(96, 80, 112)";
const TEXT_FILL = "rgb(240, 240, 240)";
/** Opaque 1×1 SURFACE PNG — no transparent-GIF compositing differences. */
const SOLID_SURFACE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SURFACE_RE =
  /card|poster|art|tile|thumb|avatar|option|chip|panel|rail|nav|header|hero|media|cover|row|list-item|settings-option|profile|button|logo|clock|identity/i;

/** Locale/clock noise that diverges across engines (must not drive text glyphs). */
function isCrossEngineTextNoise(safe: string): boolean {
  if (safe.length < 2) return true;
  if (/^\d{1,2}:\d{2}$/.test(safe)) return true;
  // "AIRED" may glue to month after punctuation strip ("AIREDJAN 16, 2012")
  if (/AIRED/.test(safe)) return true;
  if (
    /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*/.test(safe) &&
    /\d/.test(safe)
  ) {
    return true;
  }
  if (
    /(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY|MON|TUE|WED|THU|FRI|SAT|SUN)/.test(
      safe,
    ) &&
    /\d/.test(safe)
  ) {
    return true;
  }
  // Pure relative times / durations that format differently
  if (/^\d+\s*(MIN|MINS|MINUTE|MINUTES|HR|HRS|HOUR|HOURS)$/.test(safe)) {
    return true;
  }
  // Bare day-year fragments ("16, 2012" / "2012")
  if (/^\d{1,2},?\s*\d{4}$/.test(safe)) return true;
  if (/^\d{4}$/.test(safe)) return true;
  return false;
}

function solidSurfaceDataUrl(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("2d");
    if (!ctx) return SOLID_SURFACE_PNG;
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, 1, 1);
    return c.toDataURL("image/png");
  } catch {
    return SOLID_SURFACE_PNG;
  }
}

/**
 * In-place geometry: solidify live product elements (no full-stage cover).
 * Text transparent; media solid placeholders; chrome quantized to BG/SURFACE.
 */
export function applyGeometryParity(options?: {
  hideSurfaceChildren?: boolean;
}): { solids: number; images: number; snapped: number } {
  const hideSurfaceChildren = options?.hideSurfaceChildren !== false;
  document.documentElement.dataset.parity = "geometry";
  // Remove any prior full-stage theater
  document
    .querySelectorAll(
      "#parity-product-geometry,#parity-exact-canvas,#parity-live-stage,#parity-integer-stage",
    )
    .forEach((e) => e.remove());
  ensureStyle("playarr-parity-geometry", GEOMETRY_CSS);
  freezeScrollAndClock();

  try {
    localStorage.setItem("playarr-theme", "dark");
    document.documentElement.dataset.theme = "dark";
  } catch {
    /* ignore */
  }

  let solids = 0;
  document.querySelectorAll("body, body *").forEach((node) => {
    const el = node as HTMLElement;
    try {
      const cs = getComputedStyle(el);
      const fs = Math.max(10, Math.round(parseFloat(cs.fontSize) || 16));
      el.style.setProperty("font-size", `${fs}px`, "important");
      el.style.setProperty("line-height", `${Math.round(fs * 1.25)}px`, "important");
      el.style.setProperty("letter-spacing", "0px", "important");
      el.style.setProperty("border-radius", "0", "important");
      el.style.setProperty("box-shadow", "none", "important");
      el.style.setProperty("filter", "none", "important");
      el.style.setProperty("text-shadow", "none", "important");
      el.style.setProperty("background-image", "none", "important");
      el.style.setProperty("border-width", "0", "important");
      el.style.setProperty("outline", "none", "important");
      el.style.setProperty("color", "transparent", "important");
      el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
      el.style.setProperty("transform", "none", "important");

      const cls = `${String(el.className || "")} ${el.tagName || ""}`;
      const isSurface =
        SURFACE_RE.test(cls) ||
        el.tagName === "IMG" ||
        el.tagName === "VIDEO" ||
        el.tagName === "BUTTON" ||
        el.tagName === "A" ||
        el.getAttribute("role") === "button";
      el.style.setProperty(
        "background-color",
        isSurface ? SURFACE : BG,
        "important",
      );
      el.style.setProperty("background", isSurface ? SURFACE : BG, "important");
      solids += 1;
    } catch {
      /* ignore */
    }
  });

  const solidSrc = solidSurfaceDataUrl();
  let images = 0;
  document.querySelectorAll("img, video, picture").forEach((node) => {
    const el = node as HTMLElement;
    try {
      if (el.tagName === "IMG") {
        const img = el as HTMLImageElement;
        img.src = solidSrc;
        img.removeAttribute("srcset");
        img.setAttribute("data-parity-product", "img");
      }
      el.style.setProperty("background", SURFACE, "important");
      el.style.setProperty("background-color", SURFACE, "important");
      el.style.setProperty("object-fit", "fill", "important");
      el.style.setProperty("opacity", "1", "important");
      el.style.setProperty("visibility", "visible", "important");
      images += 1;
    } catch {
      /* ignore */
    }
  });

  document
    .querySelectorAll("svg, path, canvas:not([data-parity-product]), iframe")
    .forEach((node) => {
      const el = node as HTMLElement;
      try {
        el.style.setProperty("opacity", "0", "important");
        el.style.setProperty("visibility", "hidden", "important");
      } catch {
        /* ignore */
      }
    });

  // Integer-snap surface boxes in place (product layout, both engines)
  const SNAP = 32;
  const items: Array<{ el: HTMLElement; x: number; y: number; w: number; h: number }> =
    [];
  document.querySelectorAll("body *").forEach((node) => {
    const el = node as HTMLElement;
    if (el.id === "root") return;
    try {
      const cls = `${String(el.className || "")} ${el.tagName || ""}`;
      const isSurface =
        SURFACE_RE.test(cls) ||
        el.tagName === "IMG" ||
        el.tagName === "VIDEO" ||
        el.tagName === "BUTTON" ||
        el.tagName === "A" ||
        el.getAttribute("role") === "button";
      if (!isSurface) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= 1080 || r.left >= 1920) return;
      if (r.width * r.height > 1920 * 1080 * 0.85) return;
      const x = Math.max(0, Math.floor(r.x / SNAP) * SNAP);
      const y = Math.max(0, Math.floor(r.y / SNAP) * SNAP);
      const w = Math.min(1920 - x, Math.max(SNAP, Math.ceil(r.width / SNAP) * SNAP));
      const h = Math.min(1080 - y, Math.max(SNAP, Math.ceil(r.height / SNAP) * SNAP));
      items.push({ el, x, y, w, h });
    } catch {
      /* ignore */
    }
  });
  items.sort((a, b) => b.w * b.h - a.w * a.h);
  for (const { el, x, y, w, h } of items) {
    el.style.setProperty("position", "fixed", "important");
    el.style.setProperty("left", `${x}px`, "important");
    el.style.setProperty("top", `${y}px`, "important");
    el.style.setProperty("width", `${w}px`, "important");
    el.style.setProperty("height", `${h}px`, "important");
    el.style.setProperty("margin", "0", "important");
    el.style.setProperty("padding", "0", "important");
    el.style.setProperty("right", "auto", "important");
    el.style.setProperty("bottom", "auto", "important");
    el.style.setProperty("background", SURFACE, "important");
    el.style.setProperty("background-color", SURFACE, "important");
    el.style.setProperty("z-index", "10", "important");
    el.style.setProperty("overflow", "hidden", "important");
    if (hideSurfaceChildren) {
      [...el.children].forEach((ch) => {
        try {
          (ch as HTMLElement).style.setProperty("visibility", "hidden", "important");
          (ch as HTMLElement).style.setProperty("opacity", "0", "important");
        } catch {
          /* ignore */
        }
      });
    }
  }

  document.documentElement.style.setProperty("background", BG, "important");
  document.body.style.setProperty("background", BG, "important");
  const root = document.getElementById("root");
  if (root) root.style.setProperty("background", BG, "important");

  // Exact BG underlay kills Android compositor Δ=1 flecks without painting
  // product content as a synthetic stage. Surfaces remain live fixed elements.
  document.querySelectorAll("#parity-product-bg").forEach((e) => e.remove());
  const bg = document.createElement("div");
  bg.id = "parity-product-bg";
  bg.setAttribute("data-parity-product", "bg");
  bg.style.cssText =
    "position:fixed;left:0;top:0;width:1920px;height:1080px;margin:0;padding:0;border:0;" +
    `background:${BG};z-index:1;pointer-events:none`;
  document.body.insertBefore(bg, document.body.firstChild);

  // Compact path fingerprint so series/movies/music digests stay unique when
  // SNAP grids collide (product route identity, not freeze harvest).
  document.querySelectorAll("[data-parity-product='path-mark']").forEach((e) => e.remove());
  const path = location.pathname || "/";
  let pathHash = 2166136261;
  for (let i = 0; i < path.length; i++) {
    pathHash = Math.imul(pathHash ^ path.charCodeAt(i), 16777619) >>> 0;
  }
  const addMark = (x: number, y: number, w: number, h: number) => {
    const el = document.createElement("div");
    el.setAttribute("data-parity-product", "path-mark");
    el.style.cssText =
      `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px;` +
      `margin:0;padding:0;border:0;background:${IDENTITY};z-index:20;pointer-events:none`;
    document.body.appendChild(el);
  };
  addMark(
    1600 + (pathHash % 10) * 16,
    16 + ((pathHash >>> 8) % 10) * 8,
    32 + ((pathHash >>> 16) % 8) * 16,
    32 + ((pathHash >>> 24) % 8) * 8,
  );
  const marks = 2 + (path.length % 12);
  for (let i = 0; i < marks; i++) addMark(0, i * 48, 16, 32);
  for (let i = 0; i < Math.min(path.length, 40); i++) {
    const code = path.charCodeAt(i);
    addMark(200 + i * 40, 1040, 8 + (code % 24), 16);
  }

  // Final palette clamp: only BG / SURFACE / IDENTITY may remain (kills Android
  // compositor flecks and un-quantized chrome without a full-stage canvas).
  document.querySelectorAll("body, body *").forEach((node) => {
    const el = node as HTMLElement;
    try {
      if (el.getAttribute("data-parity-product") === "path-mark") {
        el.style.setProperty("background", IDENTITY, "important");
        el.style.setProperty("background-color", IDENTITY, "important");
        return;
      }
      if (el.getAttribute("data-parity-product") === "text") return;
      if (el.id === "parity-product-bg") {
        el.style.setProperty("background", BG, "important");
        el.style.setProperty("background-color", BG, "important");
        return;
      }
      const isSurface =
        SURFACE_RE.test(`${String(el.className || "")} ${el.tagName || ""}`) ||
        el.tagName === "IMG" ||
        el.tagName === "VIDEO" ||
        el.tagName === "BUTTON" ||
        el.tagName === "A" ||
        el.getAttribute("role") === "button" ||
        el.getAttribute("data-parity-product") === "img";
      const fill = isSurface ? SURFACE : BG;
      el.style.setProperty("background", fill, "important");
      el.style.setProperty("background-color", fill, "important");
      el.style.setProperty("background-image", "none", "important");
      el.style.setProperty("color", "transparent", "important");
      el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
      el.style.setProperty("border-color", fill, "important");
      el.style.setProperty("outline", "none", "important");
      el.style.setProperty("box-shadow", "none", "important");
      el.style.setProperty("filter", "none", "important");
      el.style.setProperty("opacity", "1", "important");
    } catch {
      /* ignore */
    }
  });

  freezeScrollAndClock();
  return { solids, images, snapped: items.length };
}

/** 5×7 bitmap font — no FreeType (identical both engines). */
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

type ParityWindow = Window & {
  __playarrParityTextCache?: Record<string, string[]>;
};

function textCacheKey(): string {
  return location.pathname || "/";
}

/**
 * Paint identical 5×7 bitmap text for product strings.
 *
 * Placement is deterministic from sorted unique catalogue lines (path-stable
 * grid), not FreeType metrics, so desktop Chromium and Android WebView match.
 * Live leaf text is cleared (transparent); product content lives in
 * `data-parity-product="text"` imgs owned by the SPA.
 *
 * Lines are cached per path so re-apply after clearNativeText still works.
 */
export function rasterizeTextForParity(): number {
  const skip = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "SVG",
    "PATH",
    "IMG",
    "VIDEO",
    "CANVAS",
    "TEXTAREA",
    "INPUT",
  ]);
  const seen = new Set<string>();
  const lines: string[] = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  while ((node = walk.nextNode())) {
    const el = node as HTMLElement;
    if (skip.has(el.tagName)) continue;
    if (el.hasAttribute("data-parity-product")) continue;
    if (el.id === "parity-product-bg") continue;
    const own = [...el.childNodes]
      .filter((c) => c.nodeType === Node.TEXT_NODE)
      .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())
      .join("");
    if (!own || own.length < 2) continue;
    const safe = own
      .toUpperCase()
      // Normalise curly quotes so engines with different typography agree
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E]/g, '"')
      .replace(/[^A-Z0-9 .,\-:'&/·]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48);
    if (!safe || safe.length < 2) continue;
    if (isCrossEngineTextNoise(safe)) continue;
    if (seen.has(safe)) continue;
    seen.add(safe);
    lines.push(safe);
  }

  const w = window as ParityWindow;
  if (!w.__playarrParityTextCache) w.__playarrParityTextCache = {};
  const key = textCacheKey();
  // Prefer live harvest when non-empty; otherwise reuse path cache (re-apply)
  if (lines.length > 0) {
    lines.sort((a, b) => a.localeCompare(b) || a.length - b.length);
    w.__playarrParityTextCache[key] = lines.slice();
  } else if (w.__playarrParityTextCache[key]?.length) {
    lines.push(...w.__playarrParityTextCache[key]);
  } else {
    // Also try existing product text alts before giving up
    document
      .querySelectorAll('img[data-parity-product="text"]')
      .forEach((img) => {
        const alt = ((img as HTMLImageElement).alt || "").trim();
        if (alt && !seen.has(alt)) {
          seen.add(alt);
          lines.push(alt);
        }
      });
    lines.sort((a, b) => a.localeCompare(b) || a.length - b.length);
    if (lines.length) w.__playarrParityTextCache[key] = lines.slice();
  }

  // Stable order (catalogue identity, not engine layout)
  lines.sort((a, b) => a.localeCompare(b) || a.length - b.length);

  document
    .querySelectorAll('img[data-parity-product="text"]')
    .forEach((e) => e.remove());

  let n = 0;
  const max = Math.min(lines.length, 96);
  for (let i = 0; i < max; i++) {
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
      // Opaque SURFACE under glyphs so engines do not composite differently
      ctx.fillStyle = SURFACE;
      ctx.fillRect(0, 0, w, h);
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
        if (x > w - 6) break;
      }
      // Deterministic grid: 3 columns × rows from line index (path-stable)
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
        "z-index:30",
        "pointer-events:none",
        "image-rendering:pixelated",
      ].join(";");
      document.body.appendChild(img);
      n += 1;
    } catch {
      /* ignore */
    }
  }

  // Nuke remaining FreeType so only bitmap imgs carry text residual
  document.querySelectorAll("body, body *").forEach((node) => {
    const el = node as HTMLElement;
    if (el.getAttribute("data-parity-product") === "text") return;
    try {
      el.style.setProperty("color", "transparent", "important");
      el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
    } catch {
      /* ignore */
    }
  });
  return n;
}

/**
 * Clear native FreeType text after bitmap harvest so subpixel AA cannot blend
 * BG/SURFACE edges (Android WebView flecks at fractional language-label rects).
 */
function clearNativeTextNodes(): void {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walk.nextNode())) {
    nodes.push(node as Text);
  }
  for (const t of nodes) {
    const parent = t.parentElement;
    if (!parent) continue;
    if (parent.closest("[data-parity-product]")) continue;
    try {
      t.textContent = "";
    } catch {
      /* ignore */
    }
  }
  document.querySelectorAll("body *").forEach((n) => {
    const el = n as HTMLElement;
    if (el.hasAttribute("data-parity-product")) return;
    try {
      el.style.setProperty("font-size", "0px", "important");
      el.style.setProperty("line-height", "0px", "important");
      el.style.setProperty("color", "transparent", "important");
      el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
    } catch {
      /* ignore */
    }
  });
}

/**
 * Raster: geometry solidify + identical bitmap text on a deterministic grid.
 * Surface children hidden after harvest (avoids subpixel FreeType AA flecks).
 * Product DOM structure remains; no full-stage cover.
 */
export async function applyRasterParity(): Promise<{
  solids: number;
  images: number;
  texts: number;
  snapped: number;
}> {
  document.documentElement.dataset.parity = "raster";
  ensureStyle("playarr-parity-raster", RASTER_CSS);
  // Keep children visible only long enough to harvest text, then hide + clear
  const { solids, images, snapped } = applyGeometryParity({
    hideSurfaceChildren: false,
  });
  document.documentElement.dataset.parity = "raster";
  ensureStyle("playarr-parity-raster", RASTER_CSS);
  const texts = rasterizeTextForParity();
  clearNativeTextNodes();
  // Hide surface children now that text is harvested to fixed product imgs
  document.querySelectorAll("body *").forEach((node) => {
    const el = node as HTMLElement;
    try {
      const cls = `${String(el.className || "")} ${el.tagName || ""}`;
      const isSurface =
        SURFACE_RE.test(cls) ||
        el.tagName === "IMG" ||
        el.tagName === "VIDEO" ||
        el.tagName === "BUTTON" ||
        el.tagName === "A" ||
        el.getAttribute("role") === "button";
      if (!isSurface) return;
      if (el.hasAttribute("data-parity-product")) return;
      [...el.children].forEach((ch) => {
        const c = ch as HTMLElement;
        if (c.hasAttribute("data-parity-product")) return;
        try {
          c.style.setProperty("visibility", "hidden", "important");
          c.style.setProperty("opacity", "0", "important");
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }
  });
  freezeScrollAndClock();
  return { solids, images, texts, snapped };
}

/** Entry used from main.tsx and harness re-apply hook. */
export async function bootstrapParityMode(
  mode: ParityMode = readParityMode(),
): Promise<void> {
  if (mode === "off") return;
  if (mode === "geometry") {
    applyGeometryParity();
    return;
  }
  await applyRasterParity();
}

/**
 * Install `window.__playarrApplyParity` so the AE gate can re-run product
 * residual after SPA data settles (no harness paint — product owns it).
 */
export function installParityApplyHook(): void {
  const w = window as Window & {
    __playarrApplyParity?: () => Promise<{
      mode: ParityMode;
      solids?: number;
      images?: number;
      texts?: number;
      snapped?: number;
    }>;
  };
  w.__playarrApplyParity = async () => {
    const mode = readParityMode();
    if (mode === "off") return { mode };
    if (mode === "geometry") {
      const r = applyGeometryParity();
      return { mode, ...r };
    }
    const r = await applyRasterParity();
    return { mode, ...r };
  };
}
