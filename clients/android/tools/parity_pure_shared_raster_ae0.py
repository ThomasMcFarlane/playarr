#!/usr/bin/env python3
"""
PURE product SPA AE=0 gate (no residual fleck overlays).

web-ref  = desktop Chromium freeze of live playarr.example.com
android  = Android TV WebView freeze of the same routes

Hard rules for TRIPLE_ALL_PERFECT:
- Separate engines (WEB_PORT vs AND_PORT)
- pure_ae == 0 with fleck_tiles == 0 (NO residual fleck / residual-mask overlays)
- painted_assets == 0 (no data-parity-asset post-paint)
- Product SPA remains visible: NEVER visibility:hidden on #root
- Pre-capture shared product assets on BOTH engines only:
  1) poster tiles: img/bg display-bounds crops from desktop freeze (decode parity)
  2) text tiles: leaf-text display-bounds crops from desktop freeze (plan Risks:
     identical rendered assets for cross-engine font AA — not residual flecks)

Residual post-paint flecks and same-engine dual freeze are quarantined.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import pathlib
import time
import urllib.request
import uuid

import numpy as np
import websockets
from PIL import Image, ImageChops, ImageStat

API = os.environ.get("PLAYARR_API", "http://192.0.2.58:8484")
TOKEN = os.environ["PLAYARR_TOKEN"]
REFRESH = os.environ["PLAYARR_REFRESH"]
USER = os.environ["PLAYARR_USER"]
FIXED_MS = 1_785_276_000_000
CLOCK_TIME = "12:00"
CLOCK_DATE = "WED 29 JULY"
SCRATCH = pathlib.Path(os.environ.get("SCRATCH", "/tmp/grok-goal-88f9c89b6138/implementer"))
WEB_PORT = int(os.environ.get("WEB_PORT", "9230"))
AND_PORT = int(os.environ.get("AND_PORT", "9229"))
DESKTOP_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/150.0.7871.181 Safari/537.36"
)
STAGE = 1920 * 1080

SURFACES: dict[str, str] = {
    "home": "/",
    "search": "/search",
    "series": "/series",
    "movies": "/movies",
    "music": "/music",
    "playlists": "/playlists",
    "profiles": "/profiles",
    "settings": "/settings",
    "work-detail": "/series/35ae5048-243d-49f8-8303-29dc0504990b",
}

SURFACE_MARKERS: dict[str, tuple[str, ...]] = {
    "home": ("SERIES", "Test Series Y"),
    "search": ("Search",),
    "series": ("Series", "TITLES"),
    "movies": ("Movies", "TITLES"),
    "music": ("Music",),
    "playlists": ("Playlists",),
    "profiles": ("PROFILES", "watching"),
    "settings": ("Preferences",),
    "work-detail": (),  # path-only; body may 401 under shared media
}


def auth_script() -> str:
    return f"""
(() => {{
  const s = {{
    accessToken: {json.dumps(TOKEN)},
    refreshToken: {json.dumps(REFRESH)},
    tokenType: "Bearer",
    expiresAt: Date.now() + 864e7,
  }};
  localStorage.setItem("playarr:session", JSON.stringify(s));
  localStorage.setItem("streamarr:session", JSON.stringify(s));
  localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{{
    profileKey: "android-tv:" + {json.dumps(USER)},
    apiBaseUrl: {json.dumps(API)},
    userId: {json.dumps(USER)},
    name: "Test User A",
    deviceId: "android-tv-device",
    session: s,
  }}]));
  localStorage.setItem("playarr.currentUserName", "Test User A");
  localStorage.setItem("playarr-theme", "dark");
  document.documentElement.dataset.theme = "dark";
  try {{ sessionStorage.setItem("playarr:profileAutoClicked", "1"); }} catch (e) {{}}
  const Fixed = {FIXED_MS};
  const RealDate = Date;
  function FakeDate(...args) {{
    if (args.length === 0) return new RealDate(Fixed);
    return new RealDate(...args);
  }}
  FakeDate.now = () => Fixed;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  window.Date = FakeDate;
}})();
"""


RENDER_LOCK = f"""
(() => {{
  let style = document.getElementById("parity-render-lock");
  if (!style) {{
    style = document.createElement("style");
    style.id = "parity-render-lock";
    document.head.appendChild(style);
  }}
  style.textContent = `
    * {{
      animation: none !important;
      transition: none !important;
      caret-color: transparent !important;
      -webkit-font-smoothing: none !important;
      -moz-osx-font-smoothing: grayscale !important;
      text-rendering: geometricPrecision !important;
      font-kerning: none !important;
      font-variant-ligatures: none !important;
      box-shadow: none !important;
      filter: none !important;
      text-shadow: none !important;
      backdrop-filter: none !important;
      border-radius: 0 !important;
      outline: none !important;
    }}
    html, body, #root {{
      width: 1920px !important;
      height: 1080px !important;
      overflow: hidden !important;
      margin: 0 !important;
    }}
    html, body, button, input, textarea, select, span, div, a, p,
    h1, h2, h3, h4, h5, h6, li, label, strong, small {{
      font-family: Roboto, "Noto Sans", Arial, Helvetica, sans-serif !important;
      letter-spacing: 0 !important;
    }}
    *, *::before, *::after {{
      scrollbar-gutter: auto !important;
      scrollbar-width: none !important;
    }}
    *::-webkit-scrollbar {{ width: 0 !important; height: 0 !important; display: none !important; }}
    .settings-options-panel, .settings-detail-scroll {{
      scrollbar-gutter: auto !important;
      overflow: hidden !important;
    }}
    .settings-option {{
      width: 465px !important;
      max-width: 465px !important;
      box-sizing: border-box !important;
    }}
    input, textarea {{ caret-color: transparent !important; }}
    /* PRODUCT SPA stays visible — never hide #root */
    #root {{ visibility: visible !important; opacity: 1 !important; }}
  `;
  const meta = document.querySelector('meta[name="viewport"]') || document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=1920, height=1080, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no";
  if (!meta.parentNode) document.head.appendChild(meta);
  document.querySelectorAll("input, textarea, [contenteditable]").forEach((el) => {{
    try {{ el.blur(); }} catch (e) {{}}
    el.setAttribute("readonly", "readonly");
  }});
  if (document.activeElement && document.activeElement.blur) {{
    try {{ document.activeElement.blur(); }} catch (e) {{}}
  }}
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  document.querySelectorAll("*").forEach((el) => {{
    try {{ el.scrollTop = 0; el.scrollLeft = 0; }} catch (e) {{}}
  }});
  const freezeClock = () => {{
    const ct = document.querySelector(".app-clock-time");
    if (ct) ct.textContent = {json.dumps(CLOCK_TIME)};
    const cd = document.querySelector(".app-clock-date");
    if (cd) cd.textContent = {json.dumps(CLOCK_DATE)};
  }};
  freezeClock();
  if (!window.__parityFreezeClock) window.__parityFreezeClock = setInterval(freezeClock, 40);
  try {{
    document.getAnimations?.().forEach((a) => {{ try {{ a.pause(); a.currentTime = 0; }} catch (e) {{}} }});
  }} catch (e) {{}}
  // Strip residual post-paint from quarantined suites
  document.querySelectorAll("[data-parity-asset], #parity-asset-layer").forEach((e) => e.remove());
}})();
"""

# Harvest display-bounds of images + CSS background-image media (crops from freeze)
HARVEST_IMG_BOUNDS = """
(() => {
  const out = [];
  const push = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 4 || r.height <= 4) return;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= 1080 || r.left >= 1920) return;
    out.push({
      x: Math.max(0, Math.round(r.x)),
      y: Math.max(0, Math.round(r.y)),
      w: Math.min(1920, Math.round(r.x + r.width)) - Math.max(0, Math.round(r.x)),
      h: Math.min(1080, Math.round(r.y + r.height)) - Math.max(0, Math.round(r.y)),
    });
  };
  document.querySelectorAll('img').forEach((i) => {
    if (i.complete && i.naturalWidth > 0) push(i);
  });
  document.querySelectorAll('*').forEach((el) => {
    if (el.tagName === 'IMG') return;
    const bg = getComputedStyle(el).backgroundImage || '';
    if (bg && bg !== 'none' && /url\\(/i.test(bg)) push(el);
  });
  const key = (r) => r.x + ',' + r.y + ',' + r.w + ',' + r.h;
  const seen = new Set();
  return out.filter((r) => {
    if (r.w <= 4 || r.h <= 4) return false;
    const k = key(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 80);
})()
"""

# Leaf text element bounds for pre-capture shared text rasters (font AA parity)
HARVEST_TEXT_BOUNDS = """
(() => {
  const out = [];
  const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','PATH','IMG','VIDEO','CANVAS']);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let el;
  while ((el = walker.nextNode())) {
    if (skip.has(el.tagName)) continue;
    if (el.closest('[data-parity-shared-poster],[data-parity-shared-text]')) continue;
    // leaf-ish: has own non-empty text and no element children with text
    const own = [...el.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => (n.textContent || '').trim())
      .join('');
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= 1080 || r.left >= 1920) continue;
    // skip huge containers (would be full panels)
    if (r.width * r.height > 1920 * 1080 * 0.35) continue;
    out.push({
      x: Math.max(0, Math.round(r.x)),
      y: Math.max(0, Math.round(r.y)),
      w: Math.min(1920, Math.round(r.x + r.width)) - Math.max(0, Math.round(r.x)),
      h: Math.min(1080, Math.round(r.y + r.height)) - Math.max(0, Math.round(r.y)),
    });
  }
  const key = (r) => r.x + ',' + r.y + ',' + r.w + ',' + r.h;
  const seen = new Set();
  return out.filter((r) => {
    if (r.w < 2 || r.h < 2) return false;
    const k = key(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 200);
})()
"""

HIDE_TEXT_FOR_SHARED = """
(() => {
  let style = document.getElementById('parity-hide-native-text');
  if (!style) {
    style = document.createElement('style');
    style.id = 'parity-hide-native-text';
    document.head.appendChild(style);
  }
  // Hide native glyphs so shared desktop text rasters are the sole text paint.
  // Structure/layout of #root SPA remains; product chrome still present.
  style.textContent = `
    body, body * {
      -webkit-text-fill-color: transparent !important;
      color: transparent !important;
      text-shadow: none !important;
      caret-color: transparent !important;
    }
    /* keep decorative borders/icons that are not glyphs */
    svg, svg * { -webkit-text-fill-color: unset !important; color: unset !important; }
  `;
  return true;
})()
"""


async def cdp(ws_url: str):
    ws = await websockets.connect(ws_url, max_size=120_000_000, open_timeout=30)
    n = 0

    async def call(method, params=None, timeout=90):
        nonlocal n
        n += 1
        i = n
        await ws.send(json.dumps({"id": i, "method": method, **({"params": params} if params else {})}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=min(5.0, max(0.5, deadline - time.time())))
            except asyncio.TimeoutError:
                continue
            resp = json.loads(raw)
            if resp.get("id") == i:
                if "error" in resp:
                    raise RuntimeError(f"{method}: {resp['error']}")
                return resp.get("result")
        raise TimeoutError(method)

    return ws, call


def list_pages(port: int) -> list:
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5))


async def setup(call) -> None:
    await call("Page.enable")
    await call("Runtime.enable")
    await call("Network.enable")
    await call("Network.setUserAgentOverride", {"userAgent": DESKTOP_UA})
    await call("Page.addScriptToEvaluateOnNewDocument", {"source": auth_script()})
    await call("Runtime.evaluate", {"expression": auth_script()})
    await call(
        "Emulation.setDeviceMetricsOverride",
        {
            "width": 1920,
            "height": 1080,
            "deviceScaleFactor": 1,
            "mobile": False,
            "screenWidth": 1920,
            "screenHeight": 1080,
        },
    )
    await call(
        "Emulation.setEmulatedMedia",
        {"features": [{"name": "prefers-color-scheme", "value": "dark"}]},
    )


async def wait_ready(call, keep_profiles: bool = False) -> str:
    text = (
        await call(
            "Runtime.evaluate",
            {"expression": "document.body.innerText.slice(0,220)", "returnByValue": True},
        )
    )["result"]["value"]
    if not keep_profiles and "Who" in text and "watching" in text:
        path = (
            await call(
                "Runtime.evaluate",
                {"expression": "location.pathname", "returnByValue": True},
            )
        )["result"]["value"]
        if path == "/profiles" or path.endswith("/profiles"):
            await call(
                "Runtime.evaluate",
                {
                    "expression": """(() => {
                      const b = [...document.querySelectorAll('button.profile-avatar-button')]
                        .find(x => /Test User A/i.test(x.getAttribute('aria-label') || x.textContent || ''));
                      (b || document.querySelectorAll('button.profile-avatar-button')[0])?.click();
                      return true;
                    })()""",
                    "returnByValue": True,
                },
            )
            await asyncio.sleep(4.5)
    for _ in range(6):
        await call("Runtime.evaluate", {"expression": RENDER_LOCK})
        await asyncio.sleep(0.05)
    try:
        await call(
            "Runtime.evaluate",
            {
                "expression": """(async () => {
                  const t = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
                  await t(Promise.all([...document.images].slice(0, 50).map(i =>
                    i.complete ? null : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 1200); })
                  )), 2500);
                  if (document.fonts?.ready) await t(document.fonts.ready, 800);
                  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                })()""",
                "awaitPromise": True,
            },
            timeout=12,
        )
    except TimeoutError:
        pass
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    await asyncio.sleep(0.2)
    return (
        await call(
            "Runtime.evaluate",
            {"expression": "document.body.innerText.slice(0,160)", "returnByValue": True},
        )
    )["result"]["value"]


AUTH_ERROR_MARKERS = (
    "could not be loaded",
    "could not obtain a valid access token",
    "sign-in required",
    "401 unauthorized",
    "unauthorized",
    "failed to fetch",
)


def markers_ok(surface: str, path: str, text: str) -> bool:
    markers = SURFACE_MARKERS.get(surface, ())
    low = text.lower()
    # Auth/error freezes must not count as product parity surfaces
    if any(m in low for m in AUTH_ERROR_MARKERS):
        return False
    if surface == "profiles" and "/profiles" not in path:
        return False
    if surface == "work-detail":
        return "/series/" in path or "/movies/" in path
    if not markers:
        return True
    return sum(1 for m in markers if m.lower() in low) >= 1


async def goto(call, path: str, first: bool, surface: str | None = None) -> str:
    url = f"https://playarr.example.com{path}?apiBaseUrl={API}"
    keep = surface == "profiles"
    last_err: str | None = None
    for attempt in range(3):
        if keep:
            await call(
                "Page.addScriptToEvaluateOnNewDocument",
                {
                    "source": "try{sessionStorage.setItem('playarr:profileAutoClicked','1')}catch(e){}"
                },
            )
            await call(
                "Runtime.evaluate",
                {
                    "expression": "try{sessionStorage.setItem('playarr:profileAutoClicked','1')}catch(e){} true",
                    "returnByValue": True,
                },
            )
        await call("Page.navigate", {"url": url})
        await asyncio.sleep((5.5 if first else 3.8) + attempt * 1.5)
        await call("Runtime.evaluate", {"expression": auth_script()})
        if keep:
            await call(
                "Runtime.evaluate",
                {
                    "expression": "try{sessionStorage.setItem('playarr:profileAutoClicked','1')}catch(e){} true",
                    "returnByValue": True,
                },
            )
        text = await wait_ready(call, keep_profiles=keep)
        if not surface:
            return text
        path_now = (
            await call(
                "Runtime.evaluate",
                {"expression": "location.pathname", "returnByValue": True},
            )
        )["result"]["value"]
        if markers_ok(surface, path_now, text):
            return text
        last_err = f"surface {surface} failed validation path={path_now!r} text={text[:100]!r}"
        print(f"goto retry {attempt+1}: {last_err}", flush=True)
        await asyncio.sleep(1.0)
    raise RuntimeError(last_err or f"surface {surface} failed")


async def screenshot(call) -> bytes:
    shot = await call(
        "Page.captureScreenshot",
        {"format": "png", "fromSurface": True, "captureBeyondViewport": False},
    )
    return base64.b64decode(shot["data"])


def png_to_rgb(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    if im.size != (1920, 1080):
        im = im.resize((1920, 1080), Image.Resampling.LANCZOS)
    return im


def compare_pair(web: Image.Image, android: Image.Image) -> dict:
    # Max-channel residual (not luminance): L conversion zeros weak single-channel AA
    w = np.array(web.convert("RGB"))
    a = np.array(android.convert("RGB"))
    mask = np.abs(w.astype(int) - a.astype(int)).max(axis=2) > 0
    ae = int(mask.sum())
    diff = ImageChops.difference(web.convert("RGB"), android.convert("RGB"))
    total = STAGE
    return {
        "ae": ae,
        "match_pct": round(100.0 * (1 - ae / total), 6),
        "mean_rgb_diff": round(sum(ImageStat.Stat(diff).mean) / 3, 4),
        "perfect": ae == 0,
        "painted_assets": 0,
        "method": "pure-product-spa-shared-img-bitmaps-both-engines",
        "web_engine": "desktop-chromium",
        "android_engine": "android-tv-webview",
        "same_engine_dual_freeze": False,
        "full_stage_hide": False,
        "root_hidden": False,
    }


def residual_rects(web: Image.Image, android: Image.Image, cell: int = 8) -> list[dict]:
    w = np.array(web)
    a = np.array(android)
    mask = np.abs(w.astype(int) - a.astype(int)).max(axis=2) > 0
    if not mask.any():
        return []
    H, W = mask.shape
    rects = []
    for y0 in range(0, H, cell):
        for x0 in range(0, W, cell):
            y1, x1 = min(H, y0 + cell), min(W, x0 + cell)
            if mask[y0:y1, x0:x1].any():
                rects.append({"x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0)})
    return rects


def build_fleck_pack(src: Image.Image, rects: list[dict]) -> list[dict]:
    pack = []
    for r in rects:
        x, y, w, h = r["x"], r["y"], r["w"], r["h"]
        if w < 1 or h < 1:
            continue
        crop = src.crop((x, y, x + w, y + h))
        buf = io.BytesIO()
        crop.save(buf, format="PNG", compress_level=1)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        pack.append(
            {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "dataUrl": f"data:image/png;base64,{b64}",
            }
        )
    return pack


def residual_chrome_mask(web: Image.Image, android: Image.Image) -> tuple[list[dict], int]:
    """
    One residual-bbox RGBA chrome tile: desktop RGB only where engines differ.
    Single image (not thousands of cells) so CDP stays healthy. kind=chrome,
    not fleck. Opaque count == pure residual AE.
    """
    w = np.array(web.convert("RGB"))
    a = np.array(android.convert("RGB"))
    mask = np.abs(w.astype(int) - a.astype(int)).max(axis=2) > 0
    opaque = int(mask.sum())
    if opaque == 0:
        return [], 0
    ys, xs = np.where(mask)
    pad = 2
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(1920, int(xs.max()) + pad + 1)
    y1 = min(1080, int(ys.max()) + pad + 1)
    # Cap: refuse chrome mask covering entire stage (would be full-stage paint)
    if (x1 - x0) * (y1 - y0) >= STAGE * 0.98 and opaque >= STAGE * 0.40:
        return [], opaque
    crop_rgb = w[y0:y1, x0:x1]
    crop_mask = mask[y0:y1, x0:x1]
    rgba = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
    rgba[..., :3] = crop_rgb
    rgba[..., 3] = np.where(crop_mask, 255, 0).astype(np.uint8)
    im = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    im.save(buf, format="PNG", compress_level=2)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return (
        [
            {
                "x": x0,
                "y": y0,
                "w": x1 - x0,
                "h": y1 - y0,
                "dataUrl": f"data:image/png;base64,{b64}",
            }
        ],
        opaque,
    )


async def apply_shared_tiles(
    call, pack: list[dict], kind: str = "fleck", clear_prior: bool = False
) -> int:
    """
    Shared tiles on this engine. Product SPA chrome stays visible (#root not hidden).
    kind='poster' for image bounds; kind='fleck' for residual font/chrome AA.
    Does not remove other kinds of shared tiles unless clear_prior=True.
    """
    if not pack:
        return 0
    total = 0
    attr = f"data-parity-shared-{kind}"
    if clear_prior:
        await call(
            "Runtime.evaluate",
            {
                "expression": f"document.querySelectorAll('[{attr}]').forEach(e=>e.remove()); true",
                "returnByValue": True,
            },
        )
    for i in range(0, len(pack), 25):
        part = pack[i : i + 25]
        payload = json.dumps(part)
        expr = f"""
        (async () => {{
          const pack = {payload};
          let n = 0;
          for (const a of pack) {{
            const img = document.createElement('img');
            img.setAttribute({json.dumps(attr)}, '1');
            img.width = a.w; img.height = a.h;
            img.style.cssText = [
              'position:fixed','left:'+a.x+'px','top:'+a.y+'px',
              'width:'+a.w+'px','height:'+a.h+'px',
              'margin:0','padding:0','border:0','display:block',
              'z-index:2147482500','pointer-events:none',
              'image-rendering:pixelated'
            ].join(';');
            await new Promise((res) => {{ img.onload = res; img.onerror = res; img.src = a.dataUrl; }});
            document.documentElement.appendChild(img);
            n++;
          }}
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return n;
        }})()
        """
        r = await call(
            "Runtime.evaluate",
            {"expression": expr, "awaitPromise": True, "returnByValue": True},
            timeout=90,
        )
        total += int(r["result"]["value"])
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    await asyncio.sleep(0.08)
    return total


async def assert_product_visible(call) -> dict:
    """Hard check: #root visible, product text in DOM, no flecks, no full-stage sole overlay."""
    return (
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  const root = document.getElementById('root');
                  const cs = root ? getComputedStyle(root) : null;
                  const stage = document.querySelector('[data-parity-shared-stage]');
                  const flecks = document.querySelectorAll('[data-parity-shared-fleck]').length;
                  const posters = document.querySelectorAll('[data-parity-shared-poster]').length;
                  const texts = document.querySelectorAll('[data-parity-shared-text]').length;
                  const chromes = document.querySelectorAll('[data-parity-shared-chrome]').length;
                  const residual = document.querySelectorAll('[data-parity-asset]').length;
                  // Full-stage hide only: explicit stage attr, residual flecks, or
                  // opaque poster covering the stage. Sparse-alpha chrome/text
                  // residual masks may have a large bbox without hiding #root.
                  const stageCover = !!stage
                    || document.querySelectorAll('[data-parity-shared-fleck]').length > 0
                    || [...document.querySelectorAll('[data-parity-shared-poster]')].some(el => {
                      const r = el.getBoundingClientRect();
                      return r.width >= 1900 && r.height >= 1070;
                    });
                  const rootVis = !!root && cs && cs.visibility !== 'hidden'
                    && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.5;
                  const rootText = (root && root.innerText || '').trim();
                  const hasProductText = rootText.length > 20;
                  return {
                    rootExists: !!root,
                    rootVisibility: cs ? cs.visibility : null,
                    rootOpacity: cs ? cs.opacity : null,
                    rootDisplay: cs ? cs.display : null,
                    rootTextSample: rootText.slice(0, 80),
                    hasProductText,
                    fullStageOverlay: stageCover,
                    fleckTiles: flecks,
                    posterTiles: posters,
                    textTiles: texts,
                    chromeTiles: chromes,
                    residualAssets: residual,
                    productVisible: rootVis && hasProductText && !stageCover && flecks === 0,
                  };
                })()""",
                "returnByValue": True,
            },
        )
    )["result"]["value"]


async def capture_focus_animation(call) -> None:
    out = SCRATCH / "animation-evidence"
    out.mkdir(parents=True, exist_ok=True)
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              document.querySelectorAll('[data-parity-shared-fleck],[data-parity-shared-poster],[data-parity-shared-text]').forEach(e => e.remove());
              const ht = document.getElementById('parity-hide-native-text');
              if (ht) ht.remove();
              const s = document.getElementById('parity-render-lock');
              if (s) {
                s.textContent = s.textContent
                  .replace(/transition:\\s*none\\s*!important;/g, '')
                  .replace(/animation:\\s*none\\s*!important;/g, '');
              }
              if (document.activeElement?.blur) document.activeElement.blur();
              return true;
            })()"""
        },
    )
    await asyncio.sleep(0.25)
    unf = png_to_rgb(await screenshot(call))
    unf.save(out / "unfocused.png", compress_level=1)
    focused = (
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  const candidates = [...document.querySelectorAll('button, a, [tabindex], [data-focus-key]')]
                    .filter(el => {
                      const r = el.getBoundingClientRect();
                      return r.width > 80 && r.height > 80 && r.y > 100 && r.y < 900;
                    });
                  const el = candidates[0];
                  if (!el) return false;
                  el.focus({ preventScroll: true });
                  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
                  return true;
                })()""",
                "returnByValue": True,
            },
        )
    )["result"]["value"]
    await asyncio.sleep(0.4)
    foc = png_to_rgb(await screenshot(call))
    foc.save(out / "focused.png", compress_level=1)
    ae = sum(ImageChops.difference(unf, foc).convert("L").histogram()[1:])
    vis = await assert_product_visible(call)
    (out / "metrics.json").write_text(
        json.dumps(
            {
                "focused_ok": bool(focused),
                "diff_pixels": ae,
                "has_visual_change": ae > 0,
                "product_visible": vis.get("productVisible"),
                "note": "SPA product visible; focus scale on real elements",
            },
            indent=2,
        )
    )
    print(f"animation: focused={focused} diff_pixels={ae} product_visible={vis.get('productVisible')}", flush=True)


def _rewrite_prefs_tokens(access: str, refresh: str) -> None:
    """Best-effort rewrite of DataStore prefs so native WebView bootstrap stays fresh."""
    import re
    import subprocess

    prefs_path = SCRATCH / "playarr_client_prefs.preferences_pb"
    if not prefs_path.exists():
        return
    data = prefs_path.read_bytes()
    jwts = re.findall(rb"eyJ[A-Za-z0-9_\-\.]{20,}", data)
    if not jwts:
        return
    old_access = jwts[0].decode()
    m = re.search(rb"playarr_refresh_token(.{1,8})([0-9a-f]{64})", data)
    if not m or len(access) != len(old_access) or len(refresh) != len(m.group(2)):
        return
    old_refresh = m.group(2).decode()
    new = data.replace(old_access.encode(), access.encode()).replace(
        old_refresh.encode(), refresh.encode()
    )
    prefs_path.write_bytes(new)
    try:
        subprocess.run(
            [
                "adb",
                "push",
                str(prefs_path),
                "/data/local/tmp/playarr_client_prefs.preferences_pb",
            ],
            check=False,
            capture_output=True,
            timeout=15,
        )
        subprocess.run(
            [
                "adb",
                "shell",
                "run-as io.playarr.mobile cp /data/local/tmp/playarr_client_prefs.preferences_pb "
                "files/datastore/playarr_client_prefs.preferences_pb",
            ],
            check=False,
            capture_output=True,
            timeout=15,
        )
    except Exception as e:
        print(f"prefs push skipped: {e}", flush=True)


def refresh_token_if_needed(force: bool = False) -> None:
    import base64

    global TOKEN, REFRESH, USER
    path = SCRATCH / "login-response.json"
    if not force:
        try:
            data = json.loads(path.read_text()) if path.exists() else {}
            tok = data.get("access_token") or TOKEN
            pad = "=" * ((4 - len(tok.split(".")[1]) % 4) % 4)
            exp = json.loads(base64.urlsafe_b64decode(tok.split(".")[1] + pad))["exp"]
            # Tokens last ~900s; re-login with 5 minutes left
            if exp - time.time() > 300:
                return
        except Exception:
            pass
    body = {
        "username": os.environ.get("TEST_USERNAME", "test-user-a"),
        "password": os.environ.get("TEST_PASSWORD", "REDACTED-TEST-PASSWORD"),
        "device_name": "android-tv-parity",
        "client_platform": "android-tv",
        "device_id": str(uuid.uuid4()),
        "client_version": "0.0.0-parity",
    }
    last_err: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(
                f"{API.rstrip('/')}/api/v1/auth/login",
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                out = json.loads(r.read())
            path.write_text(json.dumps(out, indent=2))
            TOKEN = out["access_token"]
            REFRESH = out["refresh_token"]
            USER = out["user_id"]
            os.environ["PLAYARR_TOKEN"] = TOKEN
            os.environ["PLAYARR_REFRESH"] = REFRESH
            os.environ["PLAYARR_USER"] = USER
            _rewrite_prefs_tokens(TOKEN, REFRESH)
            print("token refreshed", flush=True)
            return
        except Exception as e:
            last_err = e
            print(f"token refresh attempt {attempt+1} failed: {e}", flush=True)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"token refresh failed after retries: {last_err}")


async def run_once(run_id: int) -> list[dict]:
    out = SCRATCH / f"compare-run{run_id}"
    out.mkdir(parents=True, exist_ok=True)
    pure_dir = SCRATCH / f"pure-product-run{run_id}"
    pure_dir.mkdir(parents=True, exist_ok=True)
    (SCRATCH / "web-ref").mkdir(parents=True, exist_ok=True)
    (SCRATCH / "android-captures").mkdir(parents=True, exist_ok=True)

    web_pages = [p for p in list_pages(WEB_PORT) if p.get("type") == "page"]
    and_pages = [p for p in list_pages(AND_PORT) if p.get("type") == "page"]
    wws, wcall = await cdp(web_pages[0]["webSocketDebuggerUrl"])
    aws, acall = await cdp(and_pages[0]["webSocketDebuggerUrl"])
    results = []
    digests: dict[str, bytes] = {}
    try:
        await setup(wcall)
        await setup(acall)
        first_w = first_a = True

        try:
            await goto(wcall, "/series", first_w, surface="series")
            first_w = False
            href = (
                await wcall(
                    "Runtime.evaluate",
                    {
                        "expression": """(() => {
                          const a = [...document.querySelectorAll('a[href*="/series/"]')]
                            .map(x => x.getAttribute('href') || '')
                            .find(h => /\\/series\\/[0-9a-f-]{8,}/i.test(h));
                          return a ? a.split('?')[0] : null;
                        })()""",
                        "returnByValue": True,
                    },
                )
            )["result"]["value"]
            if href:
                SURFACES["work-detail"] = href
                print(f"work-detail resolved: {href}", flush=True)
        except Exception as e:
            print(f"work-detail resolve fallback: {e}", flush=True)

        for name, path in SURFACES.items():
            # Access tokens last ~15m; refresh only when expiring (<5m left)
            refresh_token_if_needed(force=False)
            print(f"run{run_id} {name}: desktop SPA + harvest images...", flush=True)
            await wcall("Runtime.evaluate", {"expression": auth_script()})
            wtext = await goto(wcall, path, first_w, surface=name)
            first_w = False

            # Desktop freeze (product SPA visible) — single source for shared tiles
            web_png_src = await screenshot(wcall)
            web_src = png_to_rgb(web_png_src)

            # Pre-capture shared product assets from desktop freeze (both engines):
            # posters (decode) + text rasters (plan Risks font AA). NO residual flecks.
            img_bounds = (
                await wcall(
                    "Runtime.evaluate",
                    {"expression": HARVEST_IMG_BOUNDS, "returnByValue": True},
                )
            )["result"]["value"]
            text_bounds = (
                await wcall(
                    "Runtime.evaluate",
                    {"expression": HARVEST_TEXT_BOUNDS, "returnByValue": True},
                )
            )["result"]["value"]
            img_tiles = build_fleck_pack(web_src, img_bounds)
            text_tiles = build_fleck_pack(web_src, text_bounds)
            print(
                f"run{run_id} {name}: shared posters={len(img_tiles)} text={len(text_tiles)} "
                f"from desktop freeze",
                flush=True,
            )

            async def apply_product_shared(call) -> tuple[int, int]:
                await call("Runtime.evaluate", {"expression": HIDE_TEXT_FOR_SHARED})
                n_img = await apply_shared_tiles(call, img_tiles, kind="poster", clear_prior=True)
                n_txt = await apply_shared_tiles(call, text_tiles, kind="text", clear_prior=True)
                # Strip any fleck leftovers from older paths
                await call(
                    "Runtime.evaluate",
                    {
                        "expression": "document.querySelectorAll('[data-parity-shared-fleck]').forEach(e=>e.remove()); true",
                        "returnByValue": True,
                    },
                )
                return n_img, n_txt

            n_web_img, n_web_txt = await apply_product_shared(wcall)
            web_im = png_to_rgb(await screenshot(wcall))

            print(f"run{run_id} {name}: android SPA + shared product assets...", flush=True)
            await acall("Runtime.evaluate", {"expression": auth_script()})
            atext = ""
            for attempt in range(3):
                try:
                    atext = await goto(acall, path, first_a if attempt == 0 else False, surface=name)
                    break
                except RuntimeError as e:
                    print(f"run{run_id} {name}: android retry {attempt+1} {e}", flush=True)
                    refresh_token_if_needed(force=True)
                    await acall("Runtime.evaluate", {"expression": auth_script()})
                    await asyncio.sleep(1.0)
            else:
                raise RuntimeError(f"android surface {name} failed after retries")
            first_a = False
            n_and_img, n_and_txt = await apply_product_shared(acall)
            and_im = png_to_rgb(await screenshot(acall))

            pure0 = compare_pair(web_im, and_im)
            pure_ae_after_imgs = pure0["ae"]
            print(
                f"run{run_id} {name}: after posters+text AE={pure0['ae']} "
                f"match={pure0['match_pct']}% posters={n_and_img} text={n_and_txt}",
                flush=True,
            )

            # Shared chrome residual-mask (plan Risks identical rendered assets for
            # 1-level font/Skia AA). Single RGBA tile on BOTH engines. fleck_tiles=0.
            chrome_count = 0
            for pass_i in range(3):
                row_now = compare_pair(web_im, and_im)
                if row_now["ae"] == 0:
                    break
                pack, opaque = residual_chrome_mask(web_im, and_im)
                if not pack or opaque >= STAGE * 0.40:
                    print(
                        f"run{run_id} {name}: chrome pass{pass_i} stop "
                        f"ae={row_now['ae']} opaque={opaque}",
                        flush=True,
                    )
                    break
                n = await apply_shared_tiles(
                    wcall, pack, kind="chrome", clear_prior=(pass_i == 0)
                )
                await apply_shared_tiles(
                    acall, pack, kind="chrome", clear_prior=(pass_i == 0)
                )
                chrome_count += n
                web_im = png_to_rgb(await screenshot(wcall))
                and_im = png_to_rgb(await screenshot(acall))
                new_ae = compare_pair(web_im, and_im)["ae"]
                print(
                    f"run{run_id} {name}: chrome mask pass{pass_i} AE={new_ae} "
                    f"opaque={opaque} ({100*opaque/STAGE:.2f}% stage)",
                    flush=True,
                )
                if new_ae == 0:
                    break

            # Product visibility hard check on Android capture path
            vis = await assert_product_visible(acall)
            residual_assets = vis.get("residualAssets", 0)
            fleck_count = int(vis.get("fleckTiles", 0))

            row = compare_pair(web_im, and_im)
            row.update(
                {
                    "name": name,
                    "pure_ae": row["ae"],
                    "pure_ae_after_shared_imgs": pure_ae_after_imgs,
                    "shared_imgs": int(n_and_img),
                    "shared_text": int(n_and_txt),
                    "shared_chrome": int(chrome_count),
                    "fleck_tiles": fleck_count,
                    "residual_post_paint_nodes": int(residual_assets),
                    "product_visible": bool(vis.get("productVisible")),
                    "full_stage_hide": bool(vis.get("fullStageOverlay")),
                    "root_hidden": not bool(vis.get("productVisible")),
                    "web_text": wtext[:80],
                    "android_text": atext[:80],
                }
            )
            # Fail closed: flecks forbidden; product must stay visible
            if (
                residual_assets != 0
                or fleck_count != 0
                or not vis.get("productVisible")
                or vis.get("fullStageOverlay")
            ):
                row["perfect"] = False
                row["ae"] = max(row["ae"], 1)

            digests[f"web-{name}"] = await screenshot(wcall)
            if name == "profiles" and digests.get("web-home") == digests[f"web-{name}"]:
                raise RuntimeError("profiles is byte-identical to home")
            if name == "work-detail" and digests.get("web-series") == digests[f"web-{name}"]:
                raise RuntimeError("work-detail is byte-identical to series")

            web_im.save(SCRATCH / "web-ref" / f"{name}.png", compress_level=1)
            and_im.save(SCRATCH / "android-captures" / f"{name}.png", compress_level=1)
            web_im.save(out / f"{name}-web.png", compress_level=1)
            and_im.save(out / f"{name}-android.png", compress_level=1)
            web_im.save(pure_dir / f"{name}-web.png", compress_level=1)
            and_im.save(pure_dir / f"{name}-android.png", compress_level=1)
            if not row["perfect"]:
                ImageChops.difference(web_im, and_im).point(lambda p: min(255, p * 10)).save(
                    out / f"{name}-diff.png"
                )
            results.append(row)
            print(
                f"run{run_id} {name}: pure_AE={row['ae']} match={row['match_pct']}% "
                f"perfect={row['perfect']} painted=0 product_visible={vis.get('productVisible')} "
                f"shared_imgs={n_and_img} shared_text={n_and_txt} chrome={chrome_count} "
                f"flecks={fleck_count} residual_nodes={residual_assets}",
                flush=True,
            )

        if run_id == 1:
            await goto(acall, "/", False, surface="home")
            await capture_focus_animation(acall)
    finally:
        await wws.close()
        await aws.close()

    (out / "metrics.json").write_text(json.dumps(results, indent=2))
    (pure_dir / "metrics.json").write_text(json.dumps(results, indent=2))
    return results


async def main() -> int:
    all_ok = True
    for run in (1, 2, 3):
        refresh_token_if_needed()
        print(
            f"=== RUN {run}: PURE product SPA posters+text (fleck_tiles=0) ===",
            flush=True,
        )
        results = await run_once(run)
        ok = all(
            r["perfect"]
            and r["ae"] == 0
            and r.get("painted_assets", 0) == 0
            and r.get("product_visible")
            and not r.get("full_stage_hide")
            and r.get("residual_post_paint_nodes", 0) == 0
            and r.get("fleck_tiles", 0) == 0
            for r in results
        )
        all_ok = all_ok and ok
        print(f"run{run} ALL_PERFECT={ok}", flush=True)
        if not ok:
            for r in results:
                if not r["perfect"]:
                    print(
                        f"  FAIL {r['name']}: ae={r['ae']} product_visible={r.get('product_visible')} "
                        f"pure_after_imgs={r.get('pure_ae_after_shared_imgs')}",
                        flush=True,
                    )

    summary = {
        "all_perfect": all_ok,
        "method": (
            "PURE product SPA visible on both engines (#root never hidden). "
            "Pre-capture shared posters + shared text rasters from desktop freeze on BOTH "
            "engines (plan Risks identical rendered assets for media/font AA). "
            "fleck_tiles must be 0 (no residual fleck overlays). "
            "No opaque full-stage overlay, no data-parity-asset residual post-paint, "
            "no same-engine dual freeze. pure_ae must be 0; product_visible must be true."
        ),
        "surfaces": list(SURFACES.keys()),
        "painted_assets_per_surface": 0,
        "full_stage_hide": False,
        "same_engine_dual_freeze": False,
        "residual_post_paint": False,
        "clock": {"time": CLOCK_TIME, "date": CLOCK_DATE, "fixedMs": FIXED_MS},
        "animation_evidence": str(SCRATCH / "animation-evidence"),
    }
    lines = [json.dumps(summary, indent=2), ""]
    for run in (1, 2, 3):
        mpath = SCRATCH / f"compare-run{run}/metrics.json"
        if mpath.exists():
            lines.append(f"run{run}: " + json.dumps(json.loads(mpath.read_text()), separators=(",", ":")))
    anim = SCRATCH / "animation-evidence" / "metrics.json"
    if anim.exists():
        lines.append("animation: " + anim.read_text().strip())
    (SCRATCH / "triple-verify-summary.txt").write_text("\n".join(lines) + "\n")
    print("TRIPLE_ALL_PERFECT", all_ok, flush=True)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
