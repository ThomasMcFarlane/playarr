// DEBUG BUILD ONLY (vite --mode debug-mirror). Never ship this in playarr.app or any released client.
//
// Posts a downscaled JPEG of the app plus layout/focus facts to the local dev receiver that serves this
// build, every ~2 s and on every focus change. The receiver origin is the page's own origin and the
// token comes from the launch URL (?mirrorToken=...), so nothing about the environment is baked in.
import { focusInfo, visibleText } from "./mirrorSnapshot";

// The production-bundle guard and test look for this string, so it must survive minification.
const MIRROR_SENTINEL = "PLAYARR_DEBUG_MIRROR_SENTINEL";
const TOKEN_KEY = "playarr.debugMirrorToken";
const INTERVAL_MS = 2000;
const TARGET_WIDTH = 640;

function readToken(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("mirrorToken");
    if (fromUrl) {
      window.sessionStorage.setItem(TOKEN_KEY, fromUrl);
      return fromUrl;
    }
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return new URLSearchParams(window.location.search).get("mirrorToken");
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function startDebugMirror(): void {
  const token = readToken();
  if (!token) return;
  const endpoint = `${window.location.origin}/__mirror/frame`;
  const errors: string[] = [];
  window.addEventListener("error", (e) => {
    errors.push(String(e.message).slice(0, 300));
    if (errors.length > 20) errors.shift();
  });
  window.addEventListener("unhandledrejection", (e) => {
    errors.push("rejection: " + String((e.reason && e.reason.message) || e.reason).slice(0, 300));
    if (errors.length > 20) errors.shift();
  });

  let fontCss: string | null = null;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      errors.push(`${level}: ${args.map((a) => String((a && (a as Error).message) || a)).join(" ").slice(0, 300)}`);
      if (errors.length > 20) errors.shift();
      original(...args);
    };
  }
  let busy = false;
  let pending = false;
  let timer = 0;
  let seq = 0;

  async function snapshot(reason: string): Promise<void> {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    const started = Date.now();
    let image: string | null = null;
    let captureError: string | null = null;
    try {
      const { toJpeg, getFontEmbedCSS } = await withTimeout(import("html-to-image"), 10000, "html-to-image import");
      const scale = Math.min(1, TARGET_WIDTH / Math.max(1, window.innerWidth));
      const bg = window.getComputedStyle(document.body).backgroundColor || "#000";
      // The browser itself renders the SVG foreignObject, so modern CSS (color-mix and so on) is drawn faithfully.
      if (fontCss === null) {
        // Embedding fonts on every frame is what made renders crawl on the TV: do it once.
        try {
          fontCss = await withTimeout(getFontEmbedCSS(document.body), 20000, "font embed");
        } catch (err) {
          fontCss = "";
          errors.push("font embed: " + String((err as Error).message).slice(0, 120));
        }
      }
      image = await withTimeout(
        toJpeg(document.body, {
          fontEmbedCSS: fontCss,
          // Cross-origin media (posters, video) would stall or taint the render: leave it out.
          filter: (node) => {
            if (node instanceof HTMLVideoElement) return false;
            if (node instanceof HTMLImageElement && node.src && !node.src.startsWith("data:")) {
              try {
                return new URL(node.src, window.location.href).origin === window.location.origin;
              } catch {
                return false;
              }
            }
            return true;
          },
          pixelRatio: scale,
          quality: 0.6,
          width: window.innerWidth,
          height: window.innerHeight,
          backgroundColor: bg,
          cacheBust: false,
          imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
        }),
        15000,
        "html-to-image render",
      );
    } catch (err) {
      captureError = String((err && (err as Error).message) || err).slice(0, 300);
    }
    const body = {
      sentinel: MIRROR_SENTINEL,
      seq: ++seq,
      reason,
      at: Date.now(),
      captureMs: Date.now() - started,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      screen: { w: window.screen.width, h: window.screen.height },
      route: window.location.pathname + window.location.hash,
      focus: focusInfo(),
      text: visibleText(),
      userAgent: navigator.userAgent,
      errors,
      captureError,
      image,
    };
    try {
      await fetch(`${endpoint}?t=${encodeURIComponent(token as string)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // receiver unreachable: try again on the next tick
    }
    busy = false;
    if (pending) {
      pending = false;
      void snapshot("queued");
    }
  }

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      await snapshot("interval");
      schedule();
    }, INTERVAL_MS);
  };
  document.addEventListener("focusin", () => void snapshot("focus"), true);
  void snapshot("start");
  schedule();
}
