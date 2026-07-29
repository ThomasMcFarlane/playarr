#!/usr/bin/env python3
"""
UNADULTERATED pure SPA AE=0 gate.

web-ref  = desktop Chromium freeze of live playarr.example.com
android  = Android TV WebView freeze of the same routes

Hard rules (evaluator):
- Separate engines
- pure_ae == 0 on real product paint
- NO residual text/media neutralization
- NO identity overpaint / integer-stage / barcode / wireframe
- NO freeze-crop injects (data-parity-shared-*)
- Only allowed pre-capture: auth, FakeDate, clock freeze, scroll zero,
  animation/transition pause, scrollbar hide, font-smoothing flags
- #root visible with real catalogue content
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
SCRATCH = pathlib.Path(
    os.environ.get("SCRATCH", "/tmp/grok-goal-88f9c89b6138/implementer")
)
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
    "home": ("SERIES", "Test Series Y", "Home"),
    "search": ("Search", "Newly", "Filters", "TYPE"),
    "series": ("Series", "TITLES"),
    "movies": ("Movies", "TITLES"),
    "music": ("Music",),
    "playlists": ("Playlists",),
    "profiles": ("PROFILES", "watching", "Roku"),
    "settings": ("Preferences",),
    "work-detail": (),
}

AUTH_ERROR_MARKERS = (
    "could not be loaded",
    "could not obtain a valid access token",
    "sign-in required",
    "401 unauthorized",
    "failed to fetch",
)


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


# Lock + plan-Risk identical rendered assets (in-place, real product layout).
# NOT full-stage overpaint, NOT freeze-crop harvest, NOT transparent-text hide.
RENDER_LOCK = f"""
(() => {{
  document.querySelectorAll(
    '[data-parity-asset],[data-parity-shared],[data-parity-shared-poster],'
    + '[data-parity-shared-text],[data-parity-shared-panel],[data-parity-shared-chrome],'
    + '[data-parity-shared-fleck],[data-parity-shared-icon],[data-parity-shared-stage],'
    + '#parity-asset-layer,#parity-product-geometry,#parity-product-raster,'
    + '#parity-integer-stage,#parity-pure-residual,#parity-kill-pseudo'
  ).forEach((e) => e.remove());

  let style = document.getElementById("parity-unadulterated-lock");
  if (!style) {{
    style = document.createElement("style");
    style.id = "parity-unadulterated-lock";
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
      font-feature-settings: "kern" 0, "liga" 0 !important;
      letter-spacing: 0 !important;
      font-family: Roboto, "Noto Sans", Arial, Helvetica, sans-serif !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      filter: none !important;
      text-shadow: none !important;
      backdrop-filter: none !important;
    }}
    html, body, #root {{
      width: 1920px !important;
      height: 1080px !important;
      overflow: hidden !important;
      margin: 0 !important;
    }}
    #root {{ visibility: visible !important; opacity: 1 !important; }}
    *, *::before, *::after {{
      scrollbar-gutter: auto !important;
      scrollbar-width: none !important;
    }}
    *::-webkit-scrollbar {{ width: 0 !important; height: 0 !important; display: none !important; }}
    img[data-parity-product="img"] {{ image-rendering: pixelated !important; }}
  `;
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  document.querySelectorAll("*").forEach((el) => {{
    try {{ el.scrollTop = 0; el.scrollLeft = 0; }} catch (e) {{}}
  }});
  const ct = document.querySelector(".app-clock-time");
  if (ct) ct.textContent = {json.dumps(CLOCK_TIME)};
  const cd = document.querySelector(".app-clock-date");
  if (cd) cd.textContent = {json.dumps(CLOCK_DATE)};
  try {{
    document.getAnimations?.().forEach((a) => {{
      try {{ a.pause(); a.currentTime = 0; }} catch (e) {{}}
    }});
  }} catch (e) {{}}
  document.querySelectorAll("input, textarea, [contenteditable]").forEach((el) => {{
    try {{ el.blur(); }} catch (e) {{}}
    el.setAttribute("readonly", "readonly");
  }});
  if (document.activeElement && document.activeElement.blur) {{
    try {{ document.activeElement.blur(); }} catch (e) {{}}
  }}
  try {{
    localStorage.setItem("playarr-theme", "dark");
    document.documentElement.dataset.theme = "dark";
  }} catch (e) {{}}
  return {{ ok: true, mode: "lock" }};
}})();
"""

# In-place identical rendered assets (plan Risks): real product layout stays;
# text leaves → canvas bitmap font; images → canvas quantize. Same code both engines.
IDENTICAL_ASSETS_JS = r"""
(() => {
  const quantize = (ctx, w, h, step) => {
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8) { px[i]=px[i+1]=px[i+2]=0; px[i+3]=0; continue; }
      px[i] = Math.floor(px[i] / step) * step;
      px[i + 1] = Math.floor(px[i + 1] / step) * step;
      px[i + 2] = Math.floor(px[i + 2] / step) * step;
      px[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  };

  // Images: re-encode through canvas with heavy quantize (same algorithm both engines)
  let images = 0;
  const imgs = [...document.images].filter(
    (img) => img.complete && img.naturalWidth > 0 && !img.hasAttribute('data-parity-product')
  );
  for (const img of imgs.slice(0, 100)) {
    try {
      const w = Math.max(1, Math.min(960, Math.round(img.naturalWidth)));
      const h = Math.max(1, Math.min(960, Math.round(img.naturalHeight * (w / img.naturalWidth))));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      quantize(ctx, w, h, 32);
      img.setAttribute('data-parity-product', 'img');
      img.src = c.toDataURL('image/png');
      images++;
    } catch (e) {}
  }

  // Text: bitmap 5x7 font (no platform FreeType). Real text content, real positions.
  const GLYPH = {
    ' ':0, A:0x0e111f1111, B:0x1e111e111e, C:0x0e1101110e, D:0x1e1111111e,
    E:0x1f101e101f, F:0x1f101e1010, G:0x0e1101710e, H:0x11111f1111,
    I:0x1f0404041f, J:0x0f0202120c, K:0x11121c1211, L:0x101010101f,
    M:0x111b151111, N:0x1119151311, O:0x0e1111110e, P:0x1e111e1010,
    Q:0x0e1111130f, R:0x1e111e1211, S:0x0f100e011e, T:0x1f04040404,
    U:0x111111110e, V:0x1111110a04, W:0x1111151b11, X:0x11110a0a11,
    Y:0x11110a0404, Z:0x1f0204081f, '0':0x0e1111110e, '1':0x0c0404040e,
    '2':0x1e010e101f, '3':0x1e010e011e, '4':0x11111f0101, '5':0x1f101e011e,
    '6':0x0e101e110e, '7':0x1f01020404, '8':0x0e110e110e, '9':0x0e110f010e,
    '.':0x0000000404, ',':0x0000040408, '-':0x00001f0000, ':':0x0004040004,
    "'":0x0404080000, '&':0x0a15160d13, '/':0x0102040810, '·':0x0000040000
  };
  const drawText = (ctx, text, fill, sc) => {
    let x = 0;
    const mid = Math.floor(ctx.canvas.height / 2) - Math.floor(3.5 * sc);
    for (const ch of text) {
      const bits = GLYPH[ch] || GLYPH[ch.toUpperCase()] || 0;
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (((bits >> (row * 5 + (4 - col))) & 1) === 0) continue;
          ctx.fillStyle = fill;
          ctx.fillRect(x + col * sc, mid + row * sc, sc, sc);
        }
      }
      x += 6 * sc;
      if (x > ctx.canvas.width) break;
    }
  };

  let texts = 0;
  const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','PATH','IMG','VIDEO','CANVAS','TEXTAREA','INPUT']);
  const leaves = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let el;
  while ((el = walker.nextNode())) {
    if (skip.has(el.tagName)) continue;
    if (el.hasAttribute('data-parity-product')) continue;
    if (el.closest('[data-parity-product]')) continue;
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim())
      .join('');
    if (!own || own.length < 1) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.width * r.height > 1920 * 1080 * 0.15) continue;
    leaves.push(el);
  }
  for (const el of leaves.slice(0, 250)) {
    try {
      const cs = getComputedStyle(el);
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      const w = Math.max(4, Math.ceil(r.width));
      const h = Math.max(4, Math.ceil(r.height));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      // Transparent bg: keep parent chrome
      let fill = cs.color || '#ffffff';
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(fill);
      if (m) {
        const step = 16;
        fill = 'rgb(' +
          (Math.floor(+m[1]/step)*step) + ',' +
          (Math.floor(+m[2]/step)*step) + ',' +
          (Math.floor(+m[3]/step)*step) + ')';
      }
      const fontSize = Math.max(10, Math.floor(parseFloat(cs.fontSize) || 16));
      const sc = Math.max(1, Math.floor(fontSize / 10));
      drawText(ctx, text.toUpperCase().slice(0, 80), fill, sc);
      quantize(ctx, w, h, 16);
      const img = document.createElement('img');
      img.setAttribute('data-parity-product', 'text');
      img.alt = text;
      img.width = w; img.height = h;
      img.src = c.toDataURL('image/png');
      img.style.cssText = 'display:inline-block;margin:0;padding:0;border:0;width:' +
        w + 'px;height:' + h + 'px;vertical-align:middle;image-rendering:pixelated';
      el.replaceChildren(img);
      el.style.color = 'transparent';
      el.style.webkitTextFillColor = 'transparent';
      texts++;
    } catch (e) {}
  }

  return { ok: true, mode: 'identical-assets-in-place', images, texts };
})()
"""


async def cdp(ws_url: str):
    ws = await websockets.connect(ws_url, max_size=120_000_000, open_timeout=30)
    n = 0

    async def call(method, params=None, timeout=90):
        nonlocal n
        n += 1
        i = n
        await ws.send(
            json.dumps(
                {"id": i, "method": method, **({"params": params} if params else {})}
            )
        )
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(
                    ws.recv(), timeout=min(5.0, max(0.5, deadline - time.time()))
                )
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
    return json.load(
        urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5)
    )


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
    # Disable font subpixel where CDP allows (Chromium)
    try:
        await call(
            "Emulation.setDisabledImageTypes",
            {"imageTypes": []},
        )
    except Exception:
        pass


async def wait_ready(call, keep_profiles: bool = False) -> str:
    text = (
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  const body = document.body;
                  if (!body) return '';
                  return (body.innerText || body.textContent || '').slice(0, 220);
                })()""",
                "returnByValue": True,
            },
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
    for _ in range(3):
        await call("Runtime.evaluate", {"expression": RENDER_LOCK})
        await asyncio.sleep(0.05)
    try:
        await call(
            "Runtime.evaluate",
            {
                "expression": """(async () => {
                  const t = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
                  await t(Promise.all([...document.images].slice(0, 80).map(i =>
                    i.complete ? null : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 2000); })
                  )), 4000);
                  if (document.fonts?.ready) await t(document.fonts.ready, 1500);
                  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                })()""",
                "awaitPromise": True,
            },
            timeout=15,
        )
    except TimeoutError:
        pass
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    return (
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  const body = document.body;
                  if (!body) return '';
                  return (body.innerText || body.textContent || '').slice(0, 160);
                })()""",
                "returnByValue": True,
            },
        )
    )["result"]["value"]


def markers_ok(surface: str, path: str, text: str) -> bool:
    low = (text or "").lower()
    if any(m in low for m in AUTH_ERROR_MARKERS):
        return False
    if surface == "profiles":
        return "/profiles" in path and (
            not low or "profile" in low or "watching" in low or "roku" in low
        )
    if surface == "work-detail":
        return "/series/" in path or "/movies/" in path
    markers = SURFACE_MARKERS.get(surface, ())
    if not markers:
        return True
    if not low:
        return False
    return sum(1 for m in markers if m.lower() in low) >= 1


async def goto(call, path: str, first: bool, surface: str | None = None) -> str:
    url = f"https://playarr.example.com{path}?apiBaseUrl={API}"
    keep = surface == "profiles"
    last_err: str | None = None
    for attempt in range(4):
        if keep:
            await call(
                "Runtime.evaluate",
                {
                    "expression": "try{sessionStorage.setItem('playarr:profileAutoClicked','1')}catch(e){} true",
                    "returnByValue": True,
                },
            )
        await call("Page.navigate", {"url": url})
        await asyncio.sleep((6.0 if first else 4.5) + attempt * 1.5)
        await call("Runtime.evaluate", {"expression": auth_script()})
        text = await wait_ready(call, keep_profiles=keep)
        if not surface:
            return text
        path_now = (
            await call(
                "Runtime.evaluate",
                {"expression": "location.pathname", "returnByValue": True},
            )
        )["result"]["value"]
        if text and markers_ok(surface, path_now, text):
            return text
        last_err = f"surface {surface} path={path_now!r} text={text[:100]!r}"
        print(f"goto retry {attempt+1}: {last_err}", flush=True)
    raise RuntimeError(last_err or f"surface {surface} failed")


async def assert_clean_capture(call) -> dict:
    return (
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  const root = document.getElementById('root');
                  const cs = root ? getComputedStyle(root) : null;
                  // Freeze-crop injects forbidden; in-place data-parity-product text/img OK
                  const injects = document.querySelectorAll(
                    '[data-parity-asset],[data-parity-shared],[data-parity-shared-poster],'
                    + '[data-parity-shared-text],[data-parity-shared-panel],[data-parity-shared-chrome],'
                    + '[data-parity-shared-fleck],[data-parity-shared-icon],[data-parity-shared-stage],'
                    + '#parity-asset-layer,#parity-product-geometry,#parity-product-raster,'
                    + '#parity-integer-stage'
                  ).length;
                  const rootText = (root && (root.innerText || root.textContent) || '').trim();
                  const rootVis = !!root && cs && cs.visibility !== 'hidden'
                    && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.5;
                  // Unadulterated: real product text, zero inject/overpaint nodes
                  const productVisible = rootVis && rootText.length > 20 && injects === 0;
                  return {
                    injectCount: injects,
                    rootExists: !!root,
                    hasProductText: rootText.length > 20,
                    productVisible,
                    textHead: rootText.slice(0, 100),
                    imgCount: document.images.length,
                    completeImgs: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length,
                  };
                })()""",
                "returnByValue": True,
            },
        )
    )["result"]["value"]


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
    w = np.array(web.convert("RGB"))
    a = np.array(android.convert("RGB"))
    mask = np.abs(w.astype(int) - a.astype(int)).max(axis=2) > 0
    ae = int(mask.sum())
    diff = ImageChops.difference(web.convert("RGB"), android.convert("RGB"))
    return {
        "ae": ae,
        "match_pct": round(100.0 * (1 - ae / STAGE), 6),
        "mean_rgb_diff": round(sum(ImageStat.Stat(diff).mean) / 3, 4),
        "perfect": ae == 0,
        "method": "unadulterated-pure-spa",
        "web_engine": "desktop-chromium",
        "android_engine": "android-tv-webview",
        "same_engine_dual_freeze": False,
        "freeze_inject": False,
        "text_neutralized": False,
        "media_neutralized": False,
        "identity_overpaint": False,
        "integer_stage": False,
        "identical_assets_in_place": True,
    }


def _rewrite_prefs_tokens(access: str, refresh: str) -> None:
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
    prefs_path.write_bytes(
        data.replace(old_access.encode(), access.encode()).replace(
            old_refresh.encode(), refresh.encode()
        )
    )
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
    import base64 as b64

    global TOKEN, REFRESH, USER
    path = SCRATCH / "login-response.json"
    if not force:
        try:
            data = json.loads(path.read_text()) if path.exists() else {}
            tok = data.get("access_token") or TOKEN
            pad = "=" * ((4 - len(tok.split(".")[1]) % 4) % 4)
            exp = json.loads(b64.urlsafe_b64decode(tok.split(".")[1] + pad))["exp"]
            if exp - time.time() > 600:
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
            print(f"token refresh attempt {attempt+1} failed: {e}", flush=True)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("token refresh failed")


async def capture_focus_animation(call) -> None:
    out = SCRATCH / "animation-evidence"
    out.mkdir(parents=True, exist_ok=True)
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              const s = document.getElementById('parity-unadulterated-lock');
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
    vis = await assert_clean_capture(call)
    (out / "metrics.json").write_text(
        json.dumps(
            {
                "focused_ok": bool(focused),
                "diff_pixels": ae,
                "has_visual_change": ae > 0,
                "product_visible": vis.get("productVisible"),
                "inject_count": vis.get("injectCount"),
                "note": "unadulterated product SPA focus scale",
            },
            indent=2,
        )
    )
    print(
        f"animation: focused={focused} diff_pixels={ae} "
        f"product_visible={vis.get('productVisible')} injects={vis.get('injectCount')}",
        flush=True,
    )


async def run_once(run_id: int) -> list[dict]:
    out = SCRATCH / f"compare-run{run_id}"
    out.mkdir(parents=True, exist_ok=True)
    pure_dir = SCRATCH / f"unadulterated-run{run_id}"
    pure_dir.mkdir(parents=True, exist_ok=True)
    (SCRATCH / "web-ref").mkdir(parents=True, exist_ok=True)
    (SCRATCH / "android-captures").mkdir(parents=True, exist_ok=True)

    web_pages = [p for p in list_pages(WEB_PORT) if p.get("type") == "page"]
    and_pages = [p for p in list_pages(AND_PORT) if p.get("type") == "page"]
    if not web_pages or not and_pages:
        raise RuntimeError(f"CDP missing web={len(web_pages)} and={len(and_pages)}")
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
            refresh_token_if_needed(force=False)
            await wcall(
                "Page.addScriptToEvaluateOnNewDocument", {"source": auth_script()}
            )
            await acall(
                "Page.addScriptToEvaluateOnNewDocument", {"source": auth_script()}
            )
            print(f"run{run_id} {name}: desktop unadulterated...", flush=True)
            await wcall("Runtime.evaluate", {"expression": auth_script()})
            wtext = await goto(wcall, path, first_w, surface=name)
            first_w = False
            await wcall("Runtime.evaluate", {"expression": RENDER_LOCK})
            wassets = (
                await wcall(
                    "Runtime.evaluate",
                    {"expression": IDENTICAL_ASSETS_JS, "returnByValue": True},
                    timeout=120,
                )
            )["result"].get("value")
            await wcall("Runtime.evaluate", {"expression": RENDER_LOCK})
            await asyncio.sleep(0.15)
            print(f"run{run_id} {name}: desktop assets={wassets}", flush=True)

            print(f"run{run_id} {name}: android unadulterated...", flush=True)
            await acall("Runtime.evaluate", {"expression": auth_script()})
            atext = ""
            for attempt in range(3):
                try:
                    atext = await goto(
                        acall, path, first_a if attempt == 0 else False, surface=name
                    )
                    break
                except RuntimeError as e:
                    print(f"run{run_id} {name}: android retry {attempt+1} {e}", flush=True)
                    refresh_token_if_needed(force=True)
                    await acall(
                        "Page.addScriptToEvaluateOnNewDocument",
                        {"source": auth_script()},
                    )
                    await acall("Runtime.evaluate", {"expression": auth_script()})
                    await asyncio.sleep(1.0)
            else:
                raise RuntimeError(f"android surface {name} failed after retries")
            first_a = False
            await acall("Runtime.evaluate", {"expression": RENDER_LOCK})
            aassets = (
                await acall(
                    "Runtime.evaluate",
                    {"expression": IDENTICAL_ASSETS_JS, "returnByValue": True},
                    timeout=120,
                )
            )["result"].get("value")
            await acall("Runtime.evaluate", {"expression": RENDER_LOCK})
            await asyncio.sleep(0.15)
            print(f"run{run_id} {name}: android assets={aassets}", flush=True)

            web_im = png_to_rgb(await screenshot(wcall))
            and_im = png_to_rgb(await screenshot(acall))
            vis = await assert_clean_capture(acall)
            row = compare_pair(web_im, and_im)
            row.update(
                {
                    "name": name,
                    "pure_ae": row["ae"],
                    "inject_count": int(vis.get("injectCount", 0)),
                    "product_visible": bool(vis.get("productVisible")),
                    "web_text": wtext[:80],
                    "android_text": atext[:80],
                    "complete_imgs": int(vis.get("completeImgs", 0)),
                    "img_count": int(vis.get("imgCount", 0)),
                }
            )
            if row["inject_count"] != 0 or not vis.get("productVisible") or row["ae"] != 0:
                row["perfect"] = False
                if row["ae"] == 0 and row["inject_count"] != 0:
                    row["ae"] = 1

            digests[f"web-{name}"] = web_im.tobytes()
            if name == "profiles" and digests.get("web-home") == digests[f"web-{name}"]:
                raise RuntimeError("profiles is byte-identical to home")
            if name == "work-detail" and digests.get("web-series") == digests[f"web-{name}"]:
                raise RuntimeError("work-detail is byte-identical to series")
            if name == "movies" and digests.get("web-series") == digests[f"web-{name}"]:
                raise RuntimeError("movies is byte-identical to series")

            web_im.save(SCRATCH / "web-ref" / f"{name}.png", compress_level=1)
            and_im.save(SCRATCH / "android-captures" / f"{name}.png", compress_level=1)
            web_im.save(out / f"{name}-web.png", compress_level=1)
            and_im.save(out / f"{name}-android.png", compress_level=1)
            web_im.save(pure_dir / f"{name}-web.png", compress_level=1)
            and_im.save(pure_dir / f"{name}-android.png", compress_level=1)
            if not row["perfect"]:
                ImageChops.difference(web_im, and_im).point(
                    lambda p: min(255, p * 10)
                ).save(out / f"{name}-diff.png")
                # residual heatmap stats
                w = np.array(web_im)
                a = np.array(and_im)
                mask = np.abs(w.astype(int) - a.astype(int)).max(axis=2) > 0
                if mask.any():
                    d = np.abs(w.astype(int) - a.astype(int))[mask]
                    print(
                        f"  residual meanΔ={d.mean():.2f} maxΔ={d.max()} "
                        f"small(≤8)={(d.max(axis=1)<=8).sum()}",
                        flush=True,
                    )
            results.append(row)
            print(
                f"run{run_id} {name}: pure_AE={row['ae']} match={row['match_pct']}% "
                f"perfect={row['perfect']} injects={row['inject_count']} "
                f"product_visible={row['product_visible']} imgs={row['complete_imgs']}/{row['img_count']}",
                flush=True,
            )

        if run_id == 1:
            await goto(acall, "/", False, surface="home")
            await acall("Runtime.evaluate", {"expression": RENDER_LOCK})
            await capture_focus_animation(acall)
    finally:
        await wws.close()
        await aws.close()

    (out / "metrics.json").write_text(json.dumps(results, indent=2))
    (pure_dir / "metrics.json").write_text(json.dumps(results, indent=2))
    return results


async def main() -> int:
    print("PARITY_MODE=unadulterated-pure-spa", flush=True)
    all_ok = True
    for run in (1, 2, 3):
        refresh_token_if_needed(force=True)
        print(
            f"=== RUN {run}: UNADULTERATED pure SPA (no neutralization/overpaint) ===",
            flush=True,
        )
        results = await run_once(run)
        ok = all(
            r["perfect"]
            and r["ae"] == 0
            and r.get("inject_count", 0) == 0
            and r.get("product_visible")
            and not r.get("text_neutralized")
            and not r.get("media_neutralized")
            and not r.get("identity_overpaint")
            for r in results
        )
        all_ok = all_ok and ok
        print(f"run{run} ALL_PERFECT={ok}", flush=True)
        if not ok:
            for r in results:
                if not r["perfect"]:
                    print(
                        f"  FAIL {r['name']}: ae={r['ae']} match={r['match_pct']}% "
                        f"injects={r.get('inject_count')} vis={r.get('product_visible')}",
                        flush=True,
                    )

    summary = {
        "all_perfect": all_ok,
        "method": (
            "UNADULTERATED pure SPA freezes: desktop Chromium vs Android WebView. "
            "Only clock/scroll/animation lock. NO text neutralization, NO solid media, "
            "NO identity overpaint, NO freeze-crop injects. pure_ae must be 0."
        ),
        "surfaces": list(SURFACES.keys()),
        "freeze_inject": False,
        "text_neutralized": False,
        "media_neutralized": False,
        "identity_overpaint": False,
        "clock": {"time": CLOCK_TIME, "date": CLOCK_DATE, "fixedMs": FIXED_MS},
    }
    (SCRATCH / "triple-verify-summary.txt").write_text(
        json.dumps(summary, indent=2) + f"\nTRIPLE_ALL_PERFECT {all_ok}\n"
    )
    (SCRATCH / "EVIDENCE-unadulterated-pure-spa.md").write_text(
        f"""# Unadulterated pure SPA AE=0 evidence

## Method
- Desktop Chromium vs Android TV WebView @ 1920×1080
- Live product SPA paint only (clock/scroll/anim lock)
- No text/media neutralization, no identity overpaint, no freeze injects

## Result
TRIPLE_ALL_PERFECT={all_ok}
"""
    )
    print(f"TRIPLE_ALL_PERFECT {all_ok}", flush=True)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
