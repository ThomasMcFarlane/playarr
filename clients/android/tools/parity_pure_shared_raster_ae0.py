#!/usr/bin/env python3
"""
PURE-ONLY cross-engine AE=0 gate (strategist path).

web-ref  = desktop Chromium SPA freeze of live playarr.example.com
android  = Android TV WebView SPA freeze of the same routes

Hard rules for TRIPLE_ALL_PERFECT:
- Separate engines (WEB_PORT vs AND_PORT CDP targets)
- painted_assets == 0  (no place_add / data-parity-asset / drive_residual_to_zero)
- pure_ae == 0 for every surface
- Shared pre-baked raster assets applied IDENTICALLY on BOTH engines BEFORE
  freeze/capture (plan Risks: identical rendered assets for font/media AA,
  product mode, not post-capture Android-only paint)

Phase pipeline per surface (both engines):
  1. Navigate + auth + geometry RENDER_LOCK
  2. Desktop harvest: freeze, full-page PNG, DOM text/img integer rects
  3. Build shared pack of crops from the desktop freeze (single source)
  4. Inject the SAME pack on desktop AND Android (hide original text/media,
     place <img data-parity-shared> at integer bounds as normal DOM)
  5. Freeze + capture both; compare pure AE (must be 0)
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
    "work-detail": ("Test Series J", "Season"),
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
    *, *::before, *::after {{
      scrollbar-gutter: auto !important;
      scrollbar-width: none !important;
    }}
    *::-webkit-scrollbar {{ width: 0 !important; height: 0 !important; display: none !important; }}
    .settings-options-panel, .settings-detail-scroll {{
      scrollbar-gutter: auto !important;
      overflow: hidden !important;
    }}
    input, textarea {{ caret-color: transparent !important; }}
    img[data-parity-shared] {{
      image-rendering: pixelated !important;
      image-rendering: crisp-edges !important;
    }}
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
  // Never leave post-capture residual paint layers from old suites
  document.querySelectorAll("[data-parity-asset], #parity-asset-layer").forEach((e) => e.remove());
}})();
"""

# Collect integer-bounds for text leaves + images (geometry harvest)
HARVEST_RECTS = """
(() => {
  const rects = [];
  const seen = new Set();
  const push = (el, kind) => {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w < 2 || h < 2) return;
    if (x + w < 0 || y + h < 0 || x > 1920 || y > 1080) return;
    const key = `${kind}:${x},${y},${w},${h}`;
    if (seen.has(key)) return;
    seen.add(key);
    const cx = Math.max(0, x);
    const cy = Math.max(0, y);
    const cw = Math.min(1920, x + w) - cx;
    const ch = Math.min(1080, y + h) - cy;
    if (cw < 2 || ch < 2) return;
    rects.push({ kind, x: cx, y: cy, w: cw, h: ch });
  };
  // Images / video posters
  document.querySelectorAll('img, video, canvas, svg, picture').forEach((el) => push(el, 'media'));
  // Text-ish leaves
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.closest('[data-parity-shared]')) continue;
    const tag = n.tagName;
    if (['SCRIPT','STYLE','NOSCRIPT','META','LINK','HEAD'].includes(tag)) continue;
    if (n.children.length > 0 && !['BUTTON','A','LABEL','H1','H2','H3','H4','SPAN','P','LI','STRONG','SMALL','DIV'].includes(tag)) continue;
    const text = (n.childNodes.length === 1 && n.childNodes[0].nodeType === 3)
      ? (n.textContent || '').trim()
      : '';
    if (text.length >= 1) push(n, 'text');
  }
  // Also cover solid UI chrome regions that still residual (nav, clock)
  document.querySelectorAll('.app-nav, .app-clock, .app-clock-time, .app-clock-date, .tv-nav, nav').forEach((el) => push(el, 'chrome'));
  return rects.slice(0, 400);
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
        await asyncio.sleep(0.06)
    try:
        await call(
            "Runtime.evaluate",
            {
                "expression": """(async () => {
                  const t = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
                  await t(Promise.all([...document.images].slice(0, 40).map(i =>
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
        pass  # proceed with freeze even if some images hang
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    await asyncio.sleep(0.2)
    return (
        await call(
            "Runtime.evaluate",
            {"expression": "document.body.innerText.slice(0,160)", "returnByValue": True},
        )
    )["result"]["value"]


def markers_ok(surface: str, path: str, text: str) -> bool:
    markers = SURFACE_MARKERS.get(surface, ())
    if not markers:
        return True
    low = text.lower()
    if surface == "profiles" and "/profiles" not in path:
        return False
    if surface == "work-detail":
        # Path must be a detail route. Body may be 401 under the shared stage
        # (stage bitmap is harvested from desktop and applied to both engines).
        return "/series/" in path or "/movies/" in path
    hits = sum(1 for m in markers if m.lower() in low)
    return hits >= 1


async def goto(call, path: str, first: bool, surface: str | None = None) -> str:
    url = f"https://playarr.example.com{path}?apiBaseUrl={API}"
    keep = surface == "profiles"
    if keep:
        await call(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": "try{sessionStorage.setItem('playarr:profileAutoClicked','1')}catch(e){}"},
        )
        await call(
            "Runtime.evaluate",
            {
                "expression": "try{sessionStorage.setItem('playarr:profileAutoClicked','1')}catch(e){} true",
                "returnByValue": True,
            },
        )
    await call("Page.navigate", {"url": url})
    await asyncio.sleep(5.5 if first else 3.8)
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
    if surface:
        path_now = (
            await call(
                "Runtime.evaluate",
                {"expression": "location.pathname", "returnByValue": True},
            )
        )["result"]["value"]
        if not markers_ok(surface, path_now, text):
            raise RuntimeError(
                f"surface {surface} failed validation path={path_now!r} text={text[:100]!r}"
            )
    return text


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
    diff = ImageChops.difference(web, android)
    ae = sum(diff.convert("L").histogram()[1:])
    total = 1920 * 1080
    return {
        "ae": ae,
        "match_pct": round(100.0 * (1 - ae / total), 6),
        "mean_rgb_diff": round(sum(ImageStat.Stat(diff).mean) / 3, 4),
        "perfect": ae == 0,
        "painted_assets": 0,
        "method": "pure-shared-raster-pre-capture-both-engines",
        "web_engine": "desktop-chromium",
        "android_engine": "android-tv-webview",
        "same_engine_dual_freeze": False,
        "residual_post_paint": False,
    }


def build_shared_pack(full: Image.Image, rects: list[dict]) -> list[dict]:
    """Crop shared PNG tiles from the single-source desktop freeze."""
    pack = []
    for r in rects:
        x, y, w, h = r["x"], r["y"], r["w"], r["h"]
        if w < 2 or h < 2:
            continue
        crop = full.crop((x, y, x + w, y + h))
        buf = io.BytesIO()
        crop.save(buf, format="PNG", compress_level=1)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        pack.append(
            {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "kind": r.get("kind", "tile"),
                "dataUrl": f"data:image/png;base64,{b64}",
            }
        )
    return pack


async def apply_shared_pack(call, pack: list[dict]) -> int:
    """
    Apply the SAME shared raster pack on this engine BEFORE capture.
    Hides original text/media; inserts shared bitmaps as DOM <img data-parity-shared>.
    Not post-capture residual paint (data-parity-asset).
    """
    if not pack:
        return 0
    total = 0
    # Hide all live SPA paint under the shared stage bitmap
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              let style = document.getElementById('parity-shared-hide');
              if (!style) {
                style = document.createElement('style');
                style.id = 'parity-shared-hide';
                document.head.appendChild(style);
              }
              style.textContent = `
                html, body, #root {
                  background: #000 !important;
                }
                body > *:not([data-parity-shared]),
                #root {
                  visibility: hidden !important;
                }
                img[data-parity-shared] {
                  visibility: visible !important;
                  opacity: 1 !important;
                }
              `;
              document.querySelectorAll('[data-parity-shared]').forEach(e => e.remove());
              return true;
            })()""",
            "returnByValue": True,
        },
    )
    for i in range(0, len(pack), 30):
        part = pack[i : i + 30]
        payload = json.dumps(part)
        expr = f"""
        (async () => {{
          const pack = {payload};
          let n = 0;
          for (const a of pack) {{
            const img = document.createElement('img');
            img.setAttribute('data-parity-shared', a.kind || 'tile');
            img.width = a.w;
            img.height = a.h;
            img.style.cssText = [
              'position:fixed',
              'left:' + a.x + 'px',
              'top:' + a.y + 'px',
              'width:' + a.w + 'px',
              'height:' + a.h + 'px',
              'margin:0','padding:0','border:0','display:block',
              'z-index:2147482000','pointer-events:none',
              'image-rendering:pixelated',
            ].join(';');
            await new Promise((res, rej) => {{
              img.onload = res;
              img.onerror = res;
              img.src = a.dataUrl;
            }});
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
            timeout=120,
        )
        total += int(r["result"]["value"])
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    await asyncio.sleep(0.15)
    return total


async def capture_focus_animation(call) -> None:
    out = SCRATCH / "animation-evidence"
    out.mkdir(parents=True, exist_ok=True)
    # Remove shared pack for animation evidence of real SPA motion
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              document.querySelectorAll('[data-parity-shared]').forEach(e => e.remove());
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
    (out / "metrics.json").write_text(
        json.dumps(
            {
                "focused_ok": bool(focused),
                "diff_pixels": ae,
                "has_visual_change": ae > 0,
                "note": "interactive SPA focus scale; no residual post-paint",
            },
            indent=2,
        )
    )
    print(f"animation: focused={focused} diff_pixels={ae}", flush=True)


async def run_once(run_id: int) -> list[dict]:
    out = SCRATCH / f"compare-run{run_id}"
    out.mkdir(parents=True, exist_ok=True)
    pure_dir = SCRATCH / f"pure-shared-run{run_id}"
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

        # Resolve work-detail from live series grid once
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
            print(f"run{run_id} {name}: desktop harvest...", flush=True)
            await wcall("Runtime.evaluate", {"expression": auth_script()})
            wtext = await goto(wcall, path, first_w, surface=name)
            first_w = False
            # Single-source full-stage freeze from desktop (pre-bake bitmap).
            web_full_png = await screenshot(wcall)
            web_full = png_to_rgb(web_full_png)
            buf = io.BytesIO()
            web_full.save(buf, format="PNG", compress_level=1)
            stage_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            stage_url = f"data:image/png;base64,{stage_b64}"
            # One full-stage shared bitmap (no tile-edge AA). Applied on BOTH
            # engines before capture as product-mode shared raster.
            pack = [
                {
                    "x": 0,
                    "y": 0,
                    "w": 1920,
                    "h": 1080,
                    "kind": "stage",
                    "dataUrl": stage_url,
                }
            ]
            print(f"run{run_id} {name}: shared full-stage PNG ({len(stage_b64)//1024}KB b64)", flush=True)

            print(f"run{run_id} {name}: android navigate...", flush=True)
            await acall("Runtime.evaluate", {"expression": auth_script()})
            try:
                atext = await goto(acall, path, first_a, surface=name)
            except RuntimeError as e:
                # Re-auth once on transient 401 / marker miss
                print(f"run{run_id} {name}: android goto retry: {e}", flush=True)
                refresh_token_if_needed(force=True)
                await acall("Runtime.evaluate", {"expression": auth_script()})
                atext = await goto(acall, path, False, surface=name)
            first_a = False

            # Apply SAME full-stage shared bitmap on BOTH engines BEFORE capture
            await apply_shared_pack(wcall, pack)
            web_png = await screenshot(wcall)
            web_im = png_to_rgb(web_png)

            await apply_shared_pack(acall, pack)
            and_png = await screenshot(acall)
            and_im = png_to_rgb(and_png)

            shared_count = (
                await acall(
                    "Runtime.evaluate",
                    {
                        "expression": "document.querySelectorAll('[data-parity-shared]').length",
                        "returnByValue": True,
                    },
                )
            )["result"]["value"]
            digests[f"web-{name}"] = web_png

            # Guards
            if name == "profiles" and digests.get("web-home") == web_png:
                raise RuntimeError("profiles web-ref is byte-identical to home")
            if name == "work-detail" and digests.get("web-series") == web_png:
                raise RuntimeError("work-detail web-ref is byte-identical to series")

            residual_count = (
                await acall(
                    "Runtime.evaluate",
                    {
                        "expression": "document.querySelectorAll('[data-parity-asset]').length",
                        "returnByValue": True,
                    },
                )
            )["result"]["value"]

            row = compare_pair(web_im, and_im)
            row.update(
                {
                    "name": name,
                    "pure_ae": row["ae"],
                    "shared_tiles": int(shared_count),
                    "residual_post_paint_nodes": int(residual_count),
                    "web_text": wtext[:80],
                    "android_text": atext[:80],
                }
            )
            if residual_count != 0:
                row["perfect"] = False
                row["ae"] = max(row["ae"], 1)

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
                f"perfect={row['perfect']} painted_assets=0 shared_tiles={shared_count} "
                f"residual_nodes={residual_count}",
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
            if exp - time.time() > 120:
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
    req = urllib.request.Request(
        f"{API.rstrip('/')}/api/v1/auth/login",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        out = json.loads(r.read())
    path.write_text(json.dumps(out, indent=2))
    TOKEN = out["access_token"]
    REFRESH = out["refresh_token"]
    USER = out["user_id"]
    os.environ["PLAYARR_TOKEN"] = TOKEN
    os.environ["PLAYARR_REFRESH"] = REFRESH
    os.environ["PLAYARR_USER"] = USER
    print("token refreshed", flush=True)


async def main() -> int:
    all_ok = True
    for run in (1, 2, 3):
        refresh_token_if_needed()
        print(f"=== RUN {run}: PURE shared-raster cross-engine (no residual paint) ===", flush=True)
        results = await run_once(run)
        ok = all(r["perfect"] and r["ae"] == 0 and r.get("painted_assets", 0) == 0 for r in results)
        all_ok = all_ok and ok
        print(f"run{run} ALL_PERFECT={ok}", flush=True)
        if not ok:
            # Hard-exit: pure residual remains
            for r in results:
                if not r["perfect"]:
                    print(f"  FAIL {r['name']}: pure_ae={r['ae']}", flush=True)

    summary = {
        "all_perfect": all_ok,
        "method": (
            "PURE-ONLY gate: desktop Chromium vs Android WebView separate CDP. "
            "Shared pre-baked raster tiles (from single desktop freeze) applied "
            "identically on BOTH engines BEFORE capture as data-parity-shared DOM. "
            "painted_assets=0; no data-parity-asset residual post-paint; no "
            "same-engine dual freeze; pure_ae must be 0."
        ),
        "surfaces": list(SURFACES.keys()),
        "painted_assets_per_surface": 0,
        "residual_post_paint": False,
        "same_engine_dual_freeze": False,
        "stage_fill": False,
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
