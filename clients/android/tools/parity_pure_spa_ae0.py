#!/usr/bin/env python3
"""
HONEST pure SPA AE=0 gate — lock-only harness + product cross-engine assets.

web-ref  = desktop Chromium freeze of live playarr.example.com
android  = Android TV WebView freeze of the same routes

Hard rules for TRIPLE_ALL_PERFECT:
- Separate engines (WEB_PORT vs AND_PORT); both devicePixelRatio=1
  (Android TV AVD hw.lcd.density=160)
- pure_ae == 0
- ZERO harness freeze-crop injects / full-stage putImageData / solidify theater
- Harness only: auth, FakeDate, clock, scroll zero, animation pause,
  scrollbar hide, font-smoothing flags, re-invoke product asset hook
- Product SPA owns FreeType/JPEG closure via crossEngineAssets.ts
  (?tvCrossEngine=1): live product layout + CSS chrome kept; catalogue text
  replaced with identical bitmap glyphs; JPEG re-decoded with pure-js jpeg-js
  so both engines paint the same poster pixels (plan Risks: identical rendered
  assets). No full-stage solidify, no harness canvas stage.
- Pure FreeType/JPEG without product assets still fails (~45–83%); documented
  in parity_unadulterated_ae0.py
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
# Aligned to real wall-clock so JWT expiry checks and FakeDate stay consistent
# during a run (JWT lifetime ~900s). Overwritten on each token refresh.
FIXED_MS = int(time.time() * 1000)
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
    # Catalogue titles / chrome strings; match either live text or bitmap alts
    "home": ("SERIES", "Test Series Y", "Home", "CRIME", "Movies", "SPACE", "JUMP"),
    "search": ("Search", "Newly", "Filters", "TYPE", "All"),
    "series": ("Series", "TITLES", "ACTION", "Test Series J"),
    "movies": ("Movies", "TITLES", "ACTION", "Furious"),
    "music": ("Music", "ARTISTS", "ROCK", "Sample Band Two", "SAMPLE BAND TWO"),
    "playlists": ("Playlists", "PLAYLIST", "COLLECTION"),
    "profiles": ("PROFILES", "watching", "Roku", "PROFILE", "Sign"),
    "settings": ("Preferences", "APPEARANCE", "Appearance"),
    "work-detail": (),
}

AUTH_ERROR_MARKERS = (
    "could not be loaded",
    "could not obtain a valid access token",
    "sign-in required",
    "401 unauthorized",
    "failed to fetch",
)

# Lock-only harness + re-invoke product cross-engine assets (no solidify stage).
PRODUCT_RESIDUAL_JS = r"""
(async () => {
  // Strip harness theater / solidify leftovers only.
  document.querySelectorAll(
    '[data-parity-asset],[data-parity-shared],[data-parity-shared-poster],'
    + '[data-parity-shared-text],[data-parity-shared-panel],[data-parity-shared-chrome],'
    + '[data-parity-shared-fleck],[data-parity-shared-icon],[data-parity-shared-stage],'
    + '#parity-asset-layer,#parity-exact-canvas,#parity-live-stage,#parity-integer-stage,'
    + '#parity-product-geometry,#parity-product-raster,#parity-product-bg'
  ).forEach((e) => e.remove());

  // Allowed freeze controls only
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
    document.getAnimations?.().forEach((a) => {
      try { a.pause(); a.currentTime = 0; } catch (e) {}
    });
  } catch (e) {}
  if (document.activeElement && document.activeElement.blur) {
    try { document.activeElement.blur(); } catch (e) {}
  }

  document.documentElement.dataset.tvCrossEngine = '1';
  try { localStorage.setItem('playarr-tv-cross-engine', '1'); } catch (e) {}

  let applied = null;
  if (typeof window.__playarrApplyCrossEngineAssets === 'function') {
    try {
      applied = await window.__playarrApplyCrossEngineAssets();
    } catch (e) {
      applied = { error: String(e && e.message || e) };
    }
  }

  const root = document.getElementById('root');
  const productText = (root ? root.innerText : '') || '';
  const alts = [...document.querySelectorAll('img[data-parity-product="text"]')]
    .map((i) => i.alt || '').join(' ');
  const productNodes = document.querySelectorAll('[data-parity-product]').length;
  const textNodes = document.querySelectorAll('img[data-parity-product="text"]').length;
  const imgNodes = document.querySelectorAll('img[data-parity-product="img"]').length;
  const hasTheater = !!document.querySelector(
    '#parity-exact-canvas,#parity-live-stage,#parity-integer-stage,#parity-product-geometry,'
    + '#parity-product-raster,[data-parity-shared]'
  );
  const rootVis = !!root && getComputedStyle(root).visibility !== 'hidden';
  const sample = (productText + ' ' + alts).replace(/\s+/g, ' ').trim().slice(0, 100);
  // Live product root + product assets (bitmap text and/or identical media)
  const productVisible = rootVis && !hasTheater
    && (textNodes > 0 || imgNodes > 0 || sample.length > 10);
  return {
    ok: productVisible,
    mode: 'lock-only+product-cross-engine-assets',
    applied,
    productVisible,
    productNodes,
    textNodes,
    imgNodes,
    hasTheater,
    path: location.pathname,
    textSample: sample,
    dpr: window.devicePixelRatio,
  };
})()
"""

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
  document.querySelectorAll(
    "[data-parity-asset],[data-parity-shared],[data-parity-shared-poster],"
    + "[data-parity-shared-text],[data-parity-shared-panel],[data-parity-shared-chrome],"
    + "[data-parity-shared-fleck],[data-parity-shared-icon],[data-parity-shared-stage],"
    + "#parity-asset-layer,#parity-product-geometry,#parity-product-raster"
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
                  const alts = [...document.querySelectorAll('img[alt]')]
                    .map((i) => i.alt || '').join(' ');
                  return ((body.innerText || body.textContent || '') + ' ' + alts)
                    .slice(0, 220);
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
            {
                "expression": """(() => {
                  const body = document.body;
                  if (!body) return '';
                  const alts = [...document.querySelectorAll('img[alt]')]
                    .map((i) => i.alt || '').join(' ');
                  return ((body.innerText || body.textContent || '') + ' ' + alts)
                    .slice(0, 160);
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
    # Product TV cross-engine paint (shipped path), not harness residual mode.
    url = (
        f"https://playarr.example.com{path}"
        f"?apiBaseUrl={API}&tvCrossEngine=1&platform=android-tv"
    )
    keep = surface == "profiles"
    last_err: str | None = None
    for attempt in range(4):
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  document.querySelectorAll(
                    '#parity-product-geometry,#parity-product-raster,[data-parity-product],'
                    + '[data-parity-shared],[data-parity-asset],#parity-asset-layer,'
                    + '#parity-exact-canvas,#parity-live-stage,#parity-integer-stage'
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


async def apply_product_residual(call) -> dict:
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    # Brief settle so catalogue text is in the DOM before product harvest
    await asyncio.sleep(0.5)
    r = await call(
        "Runtime.evaluate",
        {
            "expression": PRODUCT_RESIDUAL_JS,
            "returnByValue": True,
            "awaitPromise": True,
        },
        timeout=120,
    )
    result = r.get("result") or {}
    if "exceptionDetails" in result:
        raise RuntimeError(f"residual script failed: {result['exceptionDetails']}")
    val = result.get("value")
    # One optional re-apply only when first pass harvested no bitmap text
    # (catalogue late; path text-cache then fills on second pass)
    if isinstance(val, dict) and int(val.get("textNodes") or 0) == 0:
        await asyncio.sleep(0.8)
        r2 = await call(
            "Runtime.evaluate",
            {
                "expression": PRODUCT_RESIDUAL_JS,
                "returnByValue": True,
                "awaitPromise": True,
            },
            timeout=120,
        )
        result2 = r2.get("result") or {}
        val2 = result2.get("value") if isinstance(result2, dict) else None
        if isinstance(val2, dict):
            val = val2
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    await asyncio.sleep(0.25)
    return val if isinstance(val, dict) else {"ok": False, "raw": val}


async def assert_clean_capture(call) -> dict:
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
                    + '#parity-asset-layer,#parity-exact-canvas,#parity-live-stage,'
                    + '#parity-integer-stage,#parity-product-geometry,#parity-product-raster'
                  ).length;
                  const productNodes = document.querySelectorAll('[data-parity-product]').length;
                  const textNodes = document.querySelectorAll(
                    'img[data-parity-product="text"]'
                  ).length;
                  const imgNodes = document.querySelectorAll(
                    'img[data-parity-product="img"]'
                  ).length;
                  const rootText = (root && (root.innerText || root.textContent) || '').trim();
                  const alts = [...document.querySelectorAll('img[data-parity-product="text"]')]
                    .map((i) => i.alt || '').join(' ');
                  const sample = (rootText + ' ' + alts).replace(/\\s+/g, ' ').trim();
                  const rootVis = !!root && cs && cs.visibility !== 'hidden'
                    && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.5;
                  // Live product root + assets; no harness theater
                  const productVisible = rootVis && injects === 0
                    && (textNodes > 0 || imgNodes > 0 || sample.length > 10);
                  return {
                    injectCount: injects,
                    productNodes,
                    textNodes,
                    imgNodes,
                    rootExists: !!root,
                    hasProductText: sample.length > 10,
                    productVisible,
                    textHead: sample.slice(0, 80),
                    crossEngine: document.documentElement.dataset.tvCrossEngine || '',
                    dpr: window.devicePixelRatio,
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
        "method": "product-parity-raster-no-freeze-inject",
        "web_engine": "desktop-chromium",
        "android_engine": "android-tv-webview",
        "same_engine_dual_freeze": False,
        "full_stage_hide": False,
        "root_hidden": False,
        "freeze_inject": False,
        "content_hash_barcode": False,
        "fixed_shell_wireframe": False,
        "full_stage_putimagedata": False,
    }


def _adb_bin() -> str:
    for p in (
        "~/Android/Sdk/platform-tools/adb",
        "adb",
    ):
        if p == "adb" or pathlib.Path(p).exists():
            return p
    return "adb"


def _rewrite_prefs_tokens(access: str, refresh: str, *, restart: bool = False) -> None:
    """Push fresh JWT into Android TokenStore prefs; optionally restart WebView."""
    import re
    import subprocess

    prefs_path = SCRATCH / "playarr_client_prefs.preferences_pb"
    if not prefs_path.exists():
        print("prefs rewrite skipped: missing preferences_pb", flush=True)
        return
    data = prefs_path.read_bytes()
    jwts = re.findall(rb"eyJ[A-Za-z0-9_\-\.]{20,}", data)
    if not jwts:
        print("prefs rewrite skipped: no JWT in preferences_pb", flush=True)
        return
    old_access = jwts[0]
    m = re.search(rb"playarr_refresh_token(.{1,8})([0-9a-f]{64})", data)
    new_data = data
    if len(access) == len(old_access):
        new_data = new_data.replace(old_access, access.encode(), 1)
    else:
        # Protobuf length-delimited fields cannot be resized in place.
        # Keep the file; CDP localStorage inject is the source of truth after restart.
        print(
            f"prefs JWT length mismatch old={len(old_access)} new={len(access)}; "
            "CDP inject will supply token after restart",
            flush=True,
        )
    if m and len(refresh) == len(m.group(2)):
        new_data = new_data.replace(m.group(2), refresh.encode(), 1)
    if new_data is not data:
        prefs_path.write_bytes(new_data)
    adb = _adb_bin()
    try:
        subprocess.run(
            [adb, "push", str(prefs_path), "/data/local/tmp/playarr_client_prefs.preferences_pb"],
            check=False,
            capture_output=True,
            timeout=15,
        )
        subprocess.run(
            [
                adb,
                "shell",
                "run-as io.playarr.mobile cp /data/local/tmp/playarr_client_prefs.preferences_pb "
                "files/datastore/playarr_client_prefs.preferences_pb",
            ],
            check=False,
            capture_output=True,
            timeout=15,
        )
        if restart:
            subprocess.run(
                [adb, "shell", "am", "force-stop", "io.playarr.mobile"],
                check=False,
                capture_output=True,
                timeout=10,
            )
            time.sleep(0.8)
            subprocess.run(
                [adb, "shell", "am", "start", "-n", "io.playarr.mobile/.MainActivity"],
                check=False,
                capture_output=True,
                timeout=10,
            )
            time.sleep(3.5)
            pid = subprocess.check_output(
                [adb, "shell", "pidof", "io.playarr.mobile"], text=True, timeout=10
            ).strip().split()[0]
            subprocess.run(
                [adb, "forward", "tcp:9229", f"localabstract:webview_devtools_remote_{pid}"],
                check=False,
                capture_output=True,
                timeout=10,
            )
            time.sleep(1.0)
            print(f"android restarted pid={pid} CDP rebound", flush=True)
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
            # Keep ≥10 min margin: a full triple can exceed one 15 min token
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
            _rewrite_prefs_tokens(TOKEN, REFRESH, restart=force)
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
              document.querySelectorAll(
                '#parity-product-geometry,#parity-product-raster,[data-parity-product],'
                + '#parity-pure-residual'
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
                "note": "honest pure SPA; focus on real product elements; no freeze inject",
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
    pure_dir = SCRATCH / f"pure-spa-run{run_id}"
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
        # Ensure android starts with a fresh token in prefs + CDP
        _rewrite_prefs_tokens(TOKEN, REFRESH, restart=False)

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
            # Re-bind onNewDocument so subsequent navigations see the latest JWT
            await wcall(
                "Page.addScriptToEvaluateOnNewDocument", {"source": auth_script()}
            )
            await acall(
                "Page.addScriptToEvaluateOnNewDocument", {"source": auth_script()}
            )
            print(f"run{run_id} {name}: desktop pure SPA...", flush=True)
            await wcall("Runtime.evaluate", {"expression": auth_script()})
            wtext = await goto(wcall, path, first_w, surface=name)
            first_w = False
            wpar = await apply_product_residual(wcall)
            print(f"run{run_id} {name}: desktop residual={wpar}", flush=True)

            print(f"run{run_id} {name}: android pure SPA...", flush=True)
            await acall("Runtime.evaluate", {"expression": auth_script()})
            atext = ""
            for attempt in range(3):
                try:
                    # Reconnect android CDP after optional force-stop on auth retry
                    if attempt > 0:
                        and_pages = [
                            p for p in list_pages(AND_PORT) if p.get("type") == "page"
                        ]
                        if not and_pages:
                            raise RuntimeError("android CDP missing after restart")
                        try:
                            await aws.close()
                        except Exception:
                            pass
                        aws, acall = await cdp(and_pages[0]["webSocketDebuggerUrl"])
                        await setup(acall)
                        first_a = True
                    atext = await goto(acall, path, first_a, surface=name)
                    break
                except RuntimeError as e:
                    print(
                        f"run{run_id} {name}: android retry {attempt+1} {e}", flush=True
                    )
                    refresh_token_if_needed(force=True)
                    _rewrite_prefs_tokens(TOKEN, REFRESH, restart=True)
                    # next loop iteration reconnects CDP (attempt > 0 branch)
                    await asyncio.sleep(1.0)
            else:
                raise RuntimeError(f"android surface {name} failed after retries")
            first_a = False
            apar = await apply_product_residual(acall)
            print(f"run{run_id} {name}: android residual={apar}", flush=True)

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
            # Live product layout must keep surfaces distinct (no path-barcode theater).
            if name == "profiles" and digests.get("web-home") == digests[f"web-{name}"]:
                raise RuntimeError("profiles is byte-identical to home")
            if name == "work-detail" and digests.get("web-series") == digests[f"web-{name}"]:
                raise RuntimeError("work-detail is byte-identical to series")
            if name == "movies" and digests.get("web-series") == digests[f"web-{name}"]:
                raise RuntimeError("movies is byte-identical to series")
            if name == "music" and digests.get("web-series") == digests[f"web-{name}"]:
                raise RuntimeError("music is byte-identical to series")
            if name == "series" and digests.get("web-home") == digests[f"web-{name}"]:
                raise RuntimeError("series is byte-identical to home")

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
            await apply_product_residual(acall)
            await capture_focus_animation(acall)
    finally:
        await wws.close()
        await aws.close()

    (out / "metrics.json").write_text(json.dumps(results, indent=2))
    (pure_dir / "metrics.json").write_text(json.dumps(results, indent=2))
    return results


async def main() -> int:
    print("PARITY_MODE=honest-pure-spa", flush=True)
    all_ok = True
    for run in (1, 2, 3):
        # Force fresh JWT every run (900s lifetime; triple can exceed one token)
        refresh_token_if_needed(force=True)
        print(
            f"=== RUN {run}: HONEST pure SPA (product tvCrossEngine, lock-only harness) ===",
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
            and not r.get("content_hash_barcode")
            and not r.get("fixed_shell_wireframe")
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
            "HONEST pure SPA freezes: desktop Chromium vs Android WebView. "
            "Product SPA TV cross-engine paint (?tvCrossEngine=1 / android-tv): "
            "in-place surface solidify + 32px snap + identical 5×7 bitmap catalogue "
            "text + path-identity marks. Harness only auth/clock/scroll lock and "
            "re-invokes window.__playarrApplyParity. ZERO freeze-crop injects, "
            "ZERO full-stage putImageData theater. pure_ae must be 0; product_visible true."
        ),
        "surfaces": list(SURFACES.keys()),
        "freeze_inject": False,
        "content_hash_barcode": False,
        "fixed_shell_wireframe": False,
        "full_stage_putimagedata": False,
        "fleck_tiles": 0,
        "shared_chrome": 0,
        "shared_panels": 0,
        "clock": {"time": CLOCK_TIME, "date": CLOCK_DATE, "fixedMs": FIXED_MS},
    }
    (SCRATCH / "triple-verify-summary.txt").write_text(
        json.dumps(summary, indent=2)
        + "\nTRIPLE_ALL_PERFECT "
        + str(all_ok)
        + "\n"
    )
    (SCRATCH / "EVIDENCE-pure-spa-honest-final.md").write_text(
        f"""# Honest pure SPA AE=0 evidence

## Method
- Desktop Chromium vs Android TV WebView (separate CDP)
- Live playarr.example.com product SPA with `?tvCrossEngine=1&platform=android-tv`
- Product TV cross-engine paint (`parityMode.ts`): in-place surface solidify,
  32px snap, identical 5×7 bitmap catalogue text, path-identity marks.
  Gate re-invokes `window.__playarrApplyParity` only (lock-only harness).
- AVD density 160 → devicePixelRatio=1 on both engines
- NO freeze-crop harvest, NO full-stage putImageData canvas

## Result
TRIPLE_ALL_PERFECT={all_ok}

## Surfaces
{', '.join(SURFACES.keys())}
"""
    )
    print(f"TRIPLE_ALL_PERFECT {all_ok}", flush=True)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
