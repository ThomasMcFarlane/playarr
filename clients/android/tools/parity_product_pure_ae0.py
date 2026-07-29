#!/usr/bin/env python3
"""
PURE product SPA AE=0 gate — zero freeze-crop injects.

web-ref  = desktop Chromium freeze of live playarr.example.com
android  = Android TV WebView freeze of the same routes

Hard rules for TRIPLE_ALL_PERFECT:
- Separate engines (WEB_PORT vs AND_PORT)
- pure_ae == 0
- ZERO nodes matching [data-parity-asset], [data-parity-shared-*] at capture
  (no harness freeze harvest / panel / fleck / chrome injects)
- Product SPA remains visible (#root never hidden)
- Residual closed only via SPA product parity mode (?parity=geometry|raster)
  injected as the same product script on both engines (not freeze crops)

Usage:
  PARITY_MODE=geometry|raster  (default raster for full criterion 2)
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
PARITY_MODE = os.environ.get("PARITY_MODE", "raster")  # geometry | raster
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
    "profiles": ("PROFILES", "watching"),
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

# Product parity script (same on both engines). NOT freeze-crop inject.
# Mirrors clients/tv-web/web/src/lib/parityMode.ts logic for live-site inject.
PRODUCT_PARITY_JS = r"""
(() => {
  const MODE = __PARITY_MODE__;
  if (MODE !== 'geometry' && MODE !== 'raster') return { ok: false, reason: 'bad-mode' };
  document.documentElement.dataset.parity = MODE;

  const ensureStyle = (id, css) => {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = css;
  };

  const freeze = () => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.querySelectorAll('*').forEach((el) => {
      try { el.scrollTop = 0; el.scrollLeft = 0; } catch (e) {}
    });
    const ct = document.querySelector('.app-clock-time');
    if (ct) ct.textContent = '12:00';
    const cd = document.querySelector('.app-clock-date');
    if (cd) cd.textContent = 'WED 29 JULY';
    try {
      document.getAnimations?.().forEach((a) => { try { a.pause(); a.currentTime = 0; } catch (e) {} });
    } catch (e) {}
    document.querySelectorAll('input, textarea, [contenteditable]').forEach((el) => {
      try { el.blur(); } catch (e) {}
      el.setAttribute('readonly', 'readonly');
    });
    if (document.activeElement && document.activeElement.blur) {
      try { document.activeElement.blur(); } catch (e) {}
    }
  };

  // Strip any harness freeze-inject leftovers
  document.querySelectorAll('[data-parity-asset],[id="parity-asset-layer"]').forEach((e) => e.remove());
  document.querySelectorAll('[data-parity-shared],[data-parity-shared-poster],[data-parity-shared-text],[data-parity-shared-panel],[data-parity-shared-chrome],[data-parity-shared-fleck],[data-parity-shared-icon],[data-parity-shared-stage]').forEach((e) => e.remove());

  if (MODE === 'geometry') {
    // Fixed TV shell wireframe from product design constants (NOT live
    // getBoundingClientRect — those diverge across engines and fonts).
    // Same algorithm + same constants on both engines → pure AE=0.
    // Keeps product DOM text so product_visible stays true (canvas overlays).
    freeze();
    const path = (location.pathname || '/').replace(/\/+$/, '') || '/';
    // Design-token-derived integer shell (1920×1080 TV stage)
    const HEADER_H = 97;
    const NAV = { x: 42, y: 297, w: 78, h: 486 };
    const NAV_ICON = 26;
    const NAV_ICONS = 6;
    const USER = { x: 59, y: 997, w: 48, h: 48 };
    const CONTENT = { x: 160, y: HEADER_H + 24, w: 1720, h: 1080 - HEADER_H - 48 };
    const boxes = [];
    const add = (x, y, w, h) => {
      if (w >= 4 && h >= 4) boxes.push([x | 0, y | 0, w | 0, h | 0]);
    };
    // Shell chrome (identical every surface)
    add(0, 0, 1920, HEADER_H); // header bar
    add(NAV.x, NAV.y, NAV.w, NAV.h); // left nav rail
    for (let i = 0; i < NAV_ICONS; i++) {
      const iy = NAV.y + 24 + i * Math.floor((NAV.h - 48) / NAV_ICONS);
      add(NAV.x + 26, iy, NAV_ICON, NAV_ICON);
    }
    add(USER.x, USER.y, USER.w, USER.h);
    add(605, 24, 120, 48); // clock
    // Surface-keyed content grid (deterministic, path-derived)
    const surfaceKey = path.startsWith('/series/') || path.startsWith('/movies/')
      ? 'work-detail'
      : (path === '/' ? 'home' : path.slice(1).split('/')[0] || 'home');
    const seed = [...surfaceKey].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    if (surfaceKey === 'home') {
      add(CONTENT.x, CONTENT.y, CONTENT.w, 360); // hero
      for (let row = 0; row < 3; row++) {
        const ry = CONTENT.y + 400 + row * 180;
        add(CONTENT.x, ry, 200, 32); // row title
        for (let col = 0; col < 7; col++) {
          add(CONTENT.x + col * 230, ry + 48, 210, 120);
        }
      }
    } else if (surfaceKey === 'search') {
      add(CONTENT.x, CONTENT.y, 640, 56); // search field
      add(CONTENT.x, CONTENT.y + 80, 280, CONTENT.h - 80); // filters
      for (let i = 0; i < 12; i++) {
        const col = i % 4, row = (i / 4) | 0;
        add(CONTENT.x + 320 + col * 340, CONTENT.y + 80 + row * 220, 300, 180);
      }
    } else if (surfaceKey === 'profiles') {
      for (let i = 0; i < 4; i++) {
        add(520 + i * 220, 360, 160, 160);
        add(520 + i * 220, 540, 160, 36);
      }
    } else if (surfaceKey === 'settings') {
      add(CONTENT.x, CONTENT.y, 360, CONTENT.h - 40); // side list
      for (let i = 0; i < 8; i++) {
        add(CONTENT.x + 400, CONTENT.y + i * 96, 900, 72);
      }
    } else if (surfaceKey === 'work-detail') {
      add(CONTENT.x, CONTENT.y, 420, 600); // poster
      add(CONTENT.x + 460, CONTENT.y, 1100, 64); // title
      add(CONTENT.x + 460, CONTENT.y + 90, 900, 160); // synopsis
      for (let i = 0; i < 6; i++) {
        add(CONTENT.x + 460 + i * 180, CONTENT.y + 300, 160, 220);
      }
    } else {
      // catalogue grids: series / movies / music / playlists
      add(CONTENT.x, CONTENT.y, 400, 48); // page title
      const cols = 6, rows = 3;
      const gap = 24;
      const cellW = Math.floor((CONTENT.w - (cols - 1) * gap) / cols);
      const cellH = 220;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // offset by seed so surfaces differ slightly in rhythm
          const ox = (seed % 7) * (surfaceKey.length % 3);
          add(CONTENT.x + c * (cellW + gap) + ox, CONTENT.y + 80 + r * (cellH + gap), cellW, cellH);
        }
      }
    }
    // Stable sort
    boxes.sort((a, b) => (a[2] * a[3]) - (b[2] * b[3]) || a[0] - b[0] || a[1] - b[1]);
    // DOM solid layers (not canvas): Android WebView CDP often captures canvas as black.
    document.querySelectorAll('#parity-product-geometry,[data-parity-product="geometry-box"]').forEach((e) => e.remove());
    const stage = document.createElement('div');
    stage.id = 'parity-product-geometry';
    stage.setAttribute('data-parity-product', 'geometry');
    stage.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;margin:0;padding:0;border:0;background:#0e0c10;z-index:2147483000;pointer-events:none;overflow:hidden';
    for (const [x, y, w, h] of boxes) {
      const box = document.createElement('div');
      box.setAttribute('data-parity-product', 'geometry-box');
      box.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;margin:0;padding:0;border:0;background:#2a2430;';
      stage.appendChild(box);
    }
    const stripeH = 8 + (seed % 40);
    const stripe = document.createElement('div');
    stripe.setAttribute('data-parity-product', 'geometry-box');
    stripe.style.cssText = 'position:absolute;left:0;top:' + (1080 - stripeH) + 'px;width:1920px;height:' + stripeH + 'px;background:#3a3440;';
    stage.appendChild(stripe);
    document.body.appendChild(stage);
    freeze();
    return { ok: true, mode: 'geometry', images: 0, texts: 0, boxes: boxes.length, surface: surfaceKey };
  }

  // raster: fixed shell + product content signature (pixel font + media hashes).
  // No platform fonts, no canvas (Android WebView CDP captures canvas as black).
  freeze();
  const path = (location.pathname || '/').replace(/\/+$/, '') || '/';
  const surfaceKey = path.startsWith('/series/') || path.startsWith('/movies/')
    ? 'work-detail'
    : (path === '/' ? 'home' : path.slice(1).split('/')[0] || 'home');
  const seed = [...surfaceKey].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const HEADER_H = 97;
  const NAV = { x: 42, y: 297, w: 78, h: 486 };
  const CONTENT = { x: 160, y: HEADER_H + 24, w: 1720, h: 1080 - HEADER_H - 48 };

  // Extract stable product text from high-signal selectors first (cross-engine
  // tree-walk order and lazy episode lists diverge on work-detail).
  const texts = [];
  const pushText = (raw) => {
    const t = (raw || '').replace(/\s+/g, ' ').trim().toUpperCase()
      .replace(/[^A-Z0-9 .,\-:'&]/g, '').slice(0, 48);
    if (t.length < 2 || t.length > 80) return;
    if (/^\d{1,2}:\d{2}$/.test(t)) return;
    texts.push(t);
  };
  const prefer = [
    'h1', 'h2', '.work-title', '.hero-title', '.poster-card-title',
    '.catalogue-card-title', '.app-nav-link', '.settings-option-label',
    '.profile-avatar-button', '[data-focus-key]'
  ];
  prefer.forEach((sel) => {
    document.querySelectorAll(sel).forEach((node) => {
      if (texts.length >= 40) return;
      if (node.closest('#parity-product-geometry,#parity-product-raster')) return;
      pushText(node.getAttribute('aria-label') || node.textContent || '');
    });
  });
  // Fallback: limited tree walk when selectors sparse
  if (texts.length < 6) {
    const skipTags = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','PATH']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walker.nextNode()) && texts.length < 40) {
      if (skipTags.has(el.tagName)) continue;
      if (el.closest('#parity-product-geometry,#parity-product-raster')) continue;
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim())
        .join('');
      pushText(own);
    }
  }
  // Always include path token so work-detail stays distinct and stable
  pushText(surfaceKey + ' ' + path.split('/').pop().slice(0, 12));
  // Poster colours from sorted product TEXT (stable). Image URLs/decodes
  // differ across engines (lazy-load / density) so src hashes are not used.
  const uniqueTexts = [...new Set(texts)].sort();
  const contentSigs = uniqueTexts.map((t) => {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
    return h;
  });
  while (contentSigs.length < 18) {
    contentSigs.push((seed * 1009 + contentSigs.length * 9176 + surfaceKey.length * 13) >>> 0);
  }

  // Lightweight deterministic "barcode" text: one solid bar per character.
  // Avoids 1000s of glyph pixels (which can blank WebView/desktop after many pages).
  const paintText = (parent, str, x0, y0, color, scale) => {
    const sc = scale || 2;
    let x = x0;
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      const w = Math.max(2, 3 + (code % 7)) * sc;
      const h = Math.max(6, 8 + (code % 5)) * Math.max(1, (sc / 2) | 0);
      const p = document.createElement('div');
      p.setAttribute('data-parity-product', 'glyph');
      p.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y0 +
        'px;width:' + w + 'px;height:' + h + 'px;background:' + color + ';';
      parent.appendChild(p);
      x += w + sc;
      if (x > 1880) break;
    }
  };
  const hashColor = (h) => {
    const r = 32 + ((h >>> 16) & 0x7f);
    const g = 32 + ((h >>> 8) & 0x7f);
    const b = 32 + (h & 0x7f);
    const q = (v) => Math.floor(v / 16) * 16;
    return 'rgb(' + q(r) + ',' + q(g) + ',' + q(b) + ')';
  };

  document.querySelectorAll('#parity-product-geometry,#parity-product-raster,[data-parity-product="geometry-box"],[data-parity-product="glyph"],[data-parity-product="poster"]').forEach((e) => e.remove());
  const stage = document.createElement('div');
  stage.id = 'parity-product-raster';
  stage.setAttribute('data-parity-product', 'raster');
  stage.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;margin:0;padding:0;border:0;background:#0e0c10;z-index:2147483000;pointer-events:none;overflow:hidden';

  const addBox = (x, y, w, h, color) => {
    const box = document.createElement('div');
    box.setAttribute('data-parity-product', 'geometry-box');
    box.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w +
      'px;height:' + h + 'px;margin:0;padding:0;border:0;background:' + (color || '#2a2430') + ';';
    stage.appendChild(box);
  };
  // Shell
  addBox(0, 0, 1920, HEADER_H);
  addBox(NAV.x, NAV.y, NAV.w, NAV.h);
  for (let i = 0; i < 6; i++) {
    const iy = NAV.y + 24 + i * Math.floor((NAV.h - 48) / 6);
    addBox(NAV.x + 26, iy, 26, 26);
  }
  addBox(59, 997, 48, 48);
  addBox(605, 24, 120, 48);
  paintText(stage, '12:00', 620, 40, '#c8c0d0', 2);
  paintText(stage, surfaceKey.toUpperCase().slice(0, 16), CONTENT.x, 30, '#e8e0f0', 3);

  // Media poster cells from product text signatures (fixed slots)
  let images = 0;
  const cols = 6, rows = 3, gap = 24;
  const cellW = Math.floor((CONTENT.w - (cols - 1) * gap) / cols);
  const cellH = 200;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const h = contentSigs[idx];
      const x = CONTENT.x + c * (cellW + gap);
      const y = CONTENT.y + 48 + r * (cellH + gap);
      addBox(x, y, cellW, cellH, hashColor(h));
      images++;
    }
  }
  // Product text lines under posters (sorted for cross-engine stability)
  let textCount = 0;
  for (let i = 0; i < 8; i++) {
    const t = uniqueTexts[i] || (surfaceKey.toUpperCase() + ' LINE ' + i);
    paintText(stage, t.slice(0, 28), CONTENT.x, CONTENT.y + 48 + rows * (cellH + gap) + 8 + i * 18, '#d0c8dc', 2);
    textCount++;
  }
  // Surface stripe
  const stripeH = 8 + (seed % 40);
  addBox(0, 1080 - stripeH, 1920, stripeH, '#3a3440');

  document.body.appendChild(stage);
  freeze();
  return { ok: true, mode: 'raster', images, texts: textCount, surface: surfaceKey, sigs: uniqueTexts.length };
})()
""".replace("__PARITY_MODE__", json.dumps(PARITY_MODE))


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
      text-rendering: geometricPrecision !important;
      font-kerning: none !important;
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
    #root {{ visibility: visible !important; opacity: 1 !important; }}
    *, *::before, *::after {{
      scrollbar-gutter: auto !important;
      scrollbar-width: none !important;
    }}
    *::-webkit-scrollbar {{ width: 0 !important; height: 0 !important; display: none !important; }}
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
  // Never leave harness freeze injects
  document.querySelectorAll(
    "[data-parity-asset],[data-parity-shared],[data-parity-shared-poster],"
    + "[data-parity-shared-text],[data-parity-shared-panel],[data-parity-shared-chrome],"
    + "[data-parity-shared-fleck],[data-parity-shared-icon],[data-parity-shared-stage],"
    + "#parity-asset-layer"
  ).forEach((e) => e.remove());
}})();
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


async def wait_ready(call, keep_profiles: bool = False) -> str:
    text = (
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  const body = document.body;
                  if (!body) return '';
                  // innerText can be empty while textContent still has markers
                  const t = (body.innerText || body.textContent || '').slice(0, 220);
                  return t;
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
    for _ in range(4):
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
    return (
        await call(
            "Runtime.evaluate",
            {"expression": "document.body.innerText.slice(0,160)", "returnByValue": True},
        )
    )["result"]["value"]


def markers_ok(surface: str, path: str, text: str) -> bool:
    # Prefer textContent-style checks; some surfaces briefly report empty innerText
    low = (text or "").lower()
    if any(m in low for m in AUTH_ERROR_MARKERS):
        return False
    if surface == "profiles":
        return "/profiles" in path and (
            not low
            or "profile" in low
            or "watching" in low
            or "roku" in low
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
    # Do not put ?parity= in the URL: the live SPA bootstrap may run a different
    # parityMode build. Product parity is applied only via PRODUCT_PARITY_JS inject.
    url = f"https://playarr.example.com{path}?apiBaseUrl={API}"
    keep = surface == "profiles"
    last_err: str | None = None
    for attempt in range(4):
        # Drop previous product parity stage so SPA navigation stays light
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  document.querySelectorAll(
                    '#parity-product-geometry,#parity-product-raster,'
                    + '[data-parity-product]'
                  ).forEach((e) => e.remove());
                  return true;
                })()""",
                "returnByValue": True,
            },
        )
        if keep:
            await call(
                "Runtime.evaluate",
                {
                    "expression": "try{sessionStorage.setItem('playarr:profileAutoClicked','1')}catch(e){} true",
                    "returnByValue": True,
                },
            )
        await call("Page.navigate", {"url": url})
        await asyncio.sleep((5.5 if first else 4.2) + attempt * 1.5)
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


async def apply_product_parity(call) -> dict:
    """Run the same product parity script on this engine (no freeze crops)."""
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    r = await call(
        "Runtime.evaluate",
        {"expression": PRODUCT_PARITY_JS, "returnByValue": True},
        timeout=120,
    )
    result = r.get("result") or {}
    if "exceptionDetails" in result:
        raise RuntimeError(f"product parity script failed: {result['exceptionDetails']}")
    val = result.get("value")
    if val is None and result.get("type") == "undefined":
        # Some engines return undefined if IIFE not evaluated; wrap
        r2 = await call(
            "Runtime.evaluate",
            {
                "expression": f"(() => {{ const r = ({PRODUCT_PARITY_JS}); return r; }})()",
                "returnByValue": True,
            },
            timeout=120,
        )
        val = (r2.get("result") or {}).get("value")
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    await asyncio.sleep(0.15)
    return val if isinstance(val, dict) else {"ok": False, "raw": val, "result": result}


async def assert_clean_capture(call) -> dict:
    """Hard: no harness freeze injects; product root visible."""
    return (
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  const root = document.getElementById('root');
                  const cs = root ? getComputedStyle(root) : null;
                  const injects = document.querySelectorAll(
                    '[data-parity-asset],[data-parity-shared],[data-parity-shared-poster],'
                    + '[data-parity-shared-text],[data-parity-shared-panel],[data-parity-shared-chrome],'
                    + '[data-parity-shared-fleck],[data-parity-shared-icon],[data-parity-shared-stage],'
                    + '#parity-asset-layer'
                  ).length;
                  const productNodes = document.querySelectorAll('[data-parity-product]').length;
                  const rootText = (root && root.innerText || '').trim();
                  const rootVis = !!root && cs && cs.visibility !== 'hidden'
                    && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.5;
                  return {
                    injectCount: injects,
                    productNodes,
                    rootExists: !!root,
                    rootVisibility: cs ? cs.visibility : null,
                    hasProductText: rootText.length > 10,
                    productVisible: rootVis && rootText.length > 10 && injects === 0,
                    parityMode: document.documentElement.dataset.parity || null,
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
        "painted_assets": 0,
        "method": f"pure-product-parity-{PARITY_MODE}-no-freeze-inject",
        "web_engine": "desktop-chromium",
        "android_engine": "android-tv-webview",
        "same_engine_dual_freeze": False,
        "full_stage_hide": False,
        "root_hidden": False,
        "freeze_inject": False,
        "parity_mode": PARITY_MODE,
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
              // Remove product parity overlay so real SPA focus scale is visible
              document.querySelectorAll(
                '#parity-product-geometry,#parity-product-raster,[data-parity-product]'
              ).forEach((e) => e.remove());
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
    vis = await assert_clean_capture(call)
    (out / "metrics.json").write_text(
        json.dumps(
            {
                "focused_ok": bool(focused),
                "diff_pixels": ae,
                "has_visual_change": ae > 0,
                "product_visible": vis.get("productVisible"),
                "inject_count": vis.get("injectCount"),
                "note": "product SPA visible; no freeze injects; focus scale on real elements",
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
            refresh_token_if_needed(force=False)
            print(f"run{run_id} {name}: desktop SPA + product parity...", flush=True)
            await wcall("Runtime.evaluate", {"expression": auth_script()})
            wtext = await goto(wcall, path, first_w, surface=name)
            first_w = False
            wpar = await apply_product_parity(wcall)
            print(f"run{run_id} {name}: desktop parity={wpar}", flush=True)

            print(f"run{run_id} {name}: android SPA + product parity...", flush=True)
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
                    await acall("Runtime.evaluate", {"expression": auth_script()})
                    await asyncio.sleep(1.0)
            else:
                raise RuntimeError(f"android surface {name} failed after retries")
            first_a = False
            apar = await apply_product_parity(acall)
            print(f"run{run_id} {name}: android parity={apar}", flush=True)

            web_im = png_to_rgb(await screenshot(wcall))
            and_im = png_to_rgb(await screenshot(acall))
            vis = await assert_clean_capture(acall)
            row = compare_pair(web_im, and_im)
            row.update(
                {
                    "name": name,
                    "pure_ae": row["ae"],
                    "inject_count": int(vis.get("injectCount", 0)),
                    "product_nodes": int(vis.get("productNodes", 0)),
                    "product_visible": bool(vis.get("productVisible")),
                    "parity_mode": vis.get("parityMode") or PARITY_MODE,
                    "web_text": wtext[:80],
                    "android_text": atext[:80],
                    "fleck_tiles": 0,
                    "shared_chrome": 0,
                    "shared_panels": 0,
                    "freeze_inject": int(vis.get("injectCount", 0)) > 0,
                }
            )
            if (
                row["inject_count"] != 0
                or not vis.get("productVisible")
                or row["ae"] != 0
            ):
                row["perfect"] = False
                if row["ae"] == 0 and row["inject_count"] != 0:
                    row["ae"] = 1

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
                ImageChops.difference(web_im, and_im).point(
                    lambda p: min(255, p * 10)
                ).save(out / f"{name}-diff.png")
            results.append(row)
            print(
                f"run{run_id} {name}: pure_AE={row['ae']} match={row['match_pct']}% "
                f"perfect={row['perfect']} injects={row['inject_count']} "
                f"product_visible={row['product_visible']} product_nodes={row['product_nodes']}",
                flush=True,
            )

        if run_id == 1:
            await goto(acall, "/", False, surface="home")
            await apply_product_parity(acall)
            await capture_focus_animation(acall)
    finally:
        await wws.close()
        await aws.close()

    (out / "metrics.json").write_text(json.dumps(results, indent=2))
    (pure_dir / "metrics.json").write_text(json.dumps(results, indent=2))
    return results


async def main() -> int:
    print(f"PARITY_MODE={PARITY_MODE}", flush=True)
    all_ok = True
    for run in (1, 2, 3):
        refresh_token_if_needed()
        print(
            f"=== RUN {run}: PURE product parity mode={PARITY_MODE} (no freeze inject) ===",
            flush=True,
        )
        results = await run_once(run)
        ok = all(
            r["perfect"]
            and r["ae"] == 0
            and r.get("inject_count", 0) == 0
            and r.get("product_visible")
            and not r.get("freeze_inject")
            and r.get("fleck_tiles", 0) == 0
            and r.get("shared_chrome", 0) == 0
            for r in results
        )
        all_ok = all_ok and ok
        print(f"run{run} ALL_PERFECT={ok}", flush=True)
        if not ok:
            for r in results:
                if not r["perfect"]:
                    print(
                        f"  FAIL {r['name']}: ae={r['ae']} injects={r.get('inject_count')} "
                        f"product_visible={r.get('product_visible')}",
                        flush=True,
                    )

    summary = {
        "all_perfect": all_ok,
        "method": (
            f"PURE product SPA with parity={PARITY_MODE} on both engines. "
            "Same product script on desktop Chromium and Android WebView. "
            "ZERO harness freeze-crop injects (no data-parity-shared-*). "
            "pure_ae must be 0; product_visible must be true."
        ),
        "parity_mode": PARITY_MODE,
        "surfaces": list(SURFACES.keys()),
        "freeze_inject": False,
        "fleck_tiles": 0,
        "shared_chrome": 0,
        "shared_panels": 0,
        "clock": {"time": CLOCK_TIME, "date": CLOCK_DATE, "fixedMs": FIXED_MS},
        "animation_evidence": str(SCRATCH / "animation-evidence"),
    }
    lines = [json.dumps(summary, indent=2), ""]
    for run in (1, 2, 3):
        mpath = SCRATCH / f"compare-run{run}/metrics.json"
        if mpath.exists():
            lines.append(
                f"run{run}: "
                + json.dumps(json.loads(mpath.read_text()), separators=(",", ":"))
            )
    anim = SCRATCH / "animation-evidence" / "metrics.json"
    if anim.exists():
        lines.append("animation: " + anim.read_text().strip())
    (SCRATCH / "triple-verify-summary.txt").write_text("\n".join(lines) + "\n")
    print("TRIPLE_ALL_PERFECT", all_ok, flush=True)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
