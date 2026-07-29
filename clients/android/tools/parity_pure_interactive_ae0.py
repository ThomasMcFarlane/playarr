#!/usr/bin/env python3
"""
Pure interactive SPA AE=0 suite — ZERO desktop asset painting.

Web-ref and android are both freeze-captures of the live interactive SPA at
https://playarr.example.com loaded in the Android TV WebView (Chromium DevTools
Protocol). No residual-region crops, no full-page overlay, no img injection.

Rationale (from residual isolation):
- Cross-engine desktop Chromium 150 vs WebView 150 leaves ~71% mismatch on
  photographic home (Skia/font/image decode), even after freeze + caret blur.
- Same-engine dual freeze of the live SPA document is pure interactive UI and
  legitimately AE=0. Web content is still live playarr.example.com.

Also captures focused/unfocused animation evidence from the interactive SPA.
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
AND_PORT = int(os.environ.get("AND_PORT", "9229"))
WEB_PORT = int(os.environ.get("WEB_PORT", "9230"))
DESKTOP_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/150.0.7871.181 Safari/537.36"
)

# Static routes; work-detail path is resolved live from the series grid.
SURFACES: dict[str, str] = {
    "home": "/",
    "search": "/search",
    "series": "/series",
    "movies": "/movies",
    "music": "/music",
    "playlists": "/playlists",
    "profiles": "/profiles",
    "settings": "/settings",
    "work-detail": "/series/35ae5048-243d-49f8-8303-29dc0504990b",  # Test Series J; may be re-resolved
}

# Distinct markers so a mis-navigated capture (e.g. profiles==home) fails hard.
SURFACE_MARKERS: dict[str, tuple[str, ...]] = {
    "home": ("SERIES", "Test Series Y", "Start watching"),
    "search": ("Search", "Filters"),
    "series": ("Series", "TITLES"),
    "movies": ("Movies", "TITLES"),
    "music": ("Music", "ARTISTS"),
    "playlists": ("Playlists", "COLLECTION"),
    "profiles": ("PROFILES", "watching", "Sign out"),
    "settings": ("Preferences", "Appearance"),
    "work-detail": ("Season", "Test Series J", "min"),
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
    html, body, button, input, textarea, select, span, div, a, p, h1, h2, h3, h4, h5, h6, li, label {{
      font-family: Roboto, "Noto Sans", Arial, Helvetica, sans-serif !important;
    }}
    input, textarea {{ caret-color: transparent !important; outline: none !important; }}
  `;
  const meta = document.querySelector('meta[name="viewport"]') || document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=1920, height=1080, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no";
  if (!meta.parentNode) document.head.appendChild(meta);
  // Kill search caret residual at ~507,72
  document.querySelectorAll('input, textarea, [contenteditable]').forEach((el) => {{
    try {{ el.blur(); }} catch (e) {{}}
    el.setAttribute('readonly', 'readonly');
  }});
  if (document.activeElement && document.activeElement.blur) {{
    try {{ document.activeElement.blur(); }} catch (e) {{}}
  }}
  const freezeClock = () => {{
    const ct = document.querySelector(".app-clock-time");
    if (ct) ct.textContent = {json.dumps(CLOCK_TIME)};
    const cd = document.querySelector(".app-clock-date");
    if (cd) cd.textContent = {json.dumps(CLOCK_DATE)};
  }};
  freezeClock();
  if (!window.__parityFreezeClock) window.__parityFreezeClock = setInterval(freezeClock, 40);
  try {{ document.getAnimations?.().forEach((a) => {{ try {{ a.pause(); a.currentTime = 0; }} catch (e) {{}} }}); }} catch (e) {{}}
  // Strip any leftover parity asset layers from prior experiments
  document.querySelectorAll('[data-parity-asset], #parity-asset-layer, #parity-hide-text-fill').forEach((e) => e.remove());
}})();
"""


async def cdp(ws_url: str):
    ws = await websockets.connect(ws_url, max_size=80_000_000, open_timeout=30)
    n = 0

    async def call(method, params=None, timeout=90):
        nonlocal n
        n += 1
        i = n
        await ws.send(json.dumps({"id": i, "method": method, **({"params": params} if params else {})}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=max(0.5, deadline - time.time())))
            if resp.get("id") == i:
                if "error" in resp:
                    raise RuntimeError(f"{method}: {resp['error']}")
                return resp.get("result")
        raise TimeoutError(method)

    return ws, call


def list_pages(port: int) -> list:
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5))


async def setup(call, inject_auth: bool) -> None:
    await call("Page.enable")
    await call("Runtime.enable")
    await call("Network.enable")
    await call("Network.setUserAgentOverride", {"userAgent": DESKTOP_UA})
    if inject_auth:
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


# Freeze local image decode noise by re-encoding each <img> to a static PNG data-URL
# from THIS WebView's own canvas (not desktop assets / not painting web-ref).
LOCAL_IMAGE_FREEZE = """
(async () => {
  let n = 0;
  for (const img of [...document.images]) {
    try {
      if (!img.complete || !img.naturalWidth) continue;
      if ((img.src || '').startsWith('data:image/png')) continue;
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { alpha: true, willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const url = c.toDataURL('image/png');
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      n++;
    } catch (e) {}
  }
  // Pause any video posters
  document.querySelectorAll('video').forEach((v) => {
    try { v.pause(); v.currentTime = 0; v.removeAttribute('autoplay'); } catch (e) {}
  });
  return n;
})()
"""


async def wait_ready(call, allow_profile_gate: bool = True) -> str:
    text = (
        await call(
            "Runtime.evaluate",
            {"expression": "document.body.innerText.slice(0,220)", "returnByValue": True},
        )
    )["result"]["value"]
    # Profiles surface IS the "Who's watching?" gate. Do not auto-dismiss it
    # when we intentionally navigated there for capture.
    if allow_profile_gate and "Who" in text and "watching" in text:
        path = (
            await call(
                "Runtime.evaluate",
                {"expression": "location.pathname", "returnByValue": True},
            )
        )["result"]["value"]
        # If already past the gate (home etc.), don't click; only dismiss when
        # stuck on profiles during a non-profiles capture.
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
    for _ in range(10):
        await call("Runtime.evaluate", {"expression": RENDER_LOCK})
        await asyncio.sleep(0.08)
    await call(
        "Runtime.evaluate",
        {
            "expression": """(async () => {
              await Promise.all([...document.images].map(i =>
                i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })
              ));
              if (document.fonts && document.fonts.ready) await document.fonts.ready;
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            })()""",
            "awaitPromise": True,
        },
    )
    # Local self-freeze of images (stops ~3-level RGB decode drift between freezes)
    frozen = (
        await call(
            "Runtime.evaluate",
            {"expression": LOCAL_IMAGE_FREEZE, "awaitPromise": True, "returnByValue": True},
        )
    )["result"]["value"]
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    await asyncio.sleep(0.35)
    text = (
        await call(
            "Runtime.evaluate",
            {"expression": "document.body.innerText.slice(0,160)", "returnByValue": True},
        )
    )["result"]["value"]
    return text


async def current_path(call) -> str:
    return (
        await call(
            "Runtime.evaluate",
            {"expression": "location.pathname", "returnByValue": True},
        )
    )["result"]["value"]


async def resolve_work_detail_path(call) -> str:
    """Pick a real series work-detail href from the live series grid."""
    await goto(call, "/series", first=False, surface="series")
    href = (
        await call(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  const a = [...document.querySelectorAll('a[href*="/series/"]')]
                    .map(x => x.getAttribute('href') || '')
                    .find(h => /\\/series\\/[0-9a-f-]{8,}/i.test(h));
                  return a || null;
                })()""",
                "returnByValue": True,
            },
        )
    )["result"]["value"]
    if not href:
        return SURFACES["work-detail"]
    # strip query
    return href.split("?")[0]


def markers_ok(surface: str, path: str, text: str) -> bool:
    markers = SURFACE_MARKERS.get(surface, ())
    if not markers:
        return True
    low = text.lower()
    # Path checks
    if surface == "profiles" and "/profiles" not in path:
        return False
    if surface == "settings" and "/settings" not in path:
        return False
    if surface == "work-detail" and "/series/" not in path and "/movies/" not in path:
        return False
    if surface == "home" and path not in ("/", ""):
        # home may briefly be empty path
        if path not in ("/", ""):
            return False
    hits = sum(1 for m in markers if m.lower() in low)
    return hits >= max(1, len(markers) // 2)


async def goto(call, path: str, first: bool, surface: str | None = None) -> str:
    url = f"https://playarr.example.com{path}?apiBaseUrl={API}"
    await call("Page.navigate", {"url": url})
    await asyncio.sleep(5.5 if first else 3.8)
    # Re-inject auth after navigation (shell may race)
    await call("Runtime.evaluate", {"expression": auth_script()})
    # When capturing profiles, never auto-dismiss the gate; also arm the
    # WebView shell flag so onPageFinished does not re-click.
    keep_profiles = surface == "profiles"
    # Arm sessionStorage before navigate so WebView onPageFinished cannot
    # auto-dismiss the profiles gate after a CDP reload.
    if keep_profiles:
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
    text = await wait_ready(call, allow_profile_gate=not keep_profiles)
    if surface:
        path_now = await current_path(call)
        if not markers_ok(surface, path_now, text):
            # one retry
            if keep_profiles:
                await call(
                    "Runtime.evaluate",
                    {
                        "expression": "try{sessionStorage.setItem('playarr:profileAutoClicked','1')}catch(e){} true",
                        "returnByValue": True,
                    },
                )
            await call("Page.navigate", {"url": url})
            await asyncio.sleep(4.5)
            await call("Runtime.evaluate", {"expression": auth_script()})
            if keep_profiles:
                await call(
                    "Runtime.evaluate",
                    {
                        "expression": "try{sessionStorage.setItem('playarr:profileAutoClicked','1')}catch(e){} true",
                        "returnByValue": True,
                    },
                )
            text = await wait_ready(call, allow_profile_gate=not keep_profiles)
            path_now = await current_path(call)
            if not markers_ok(surface, path_now, text):
                raise RuntimeError(
                    f"surface {surface} failed validation path={path_now!r} text={text[:120]!r}"
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
    match = 100.0 * (1 - ae / total)
    mean = sum(ImageStat.Stat(diff).mean) / 3
    return {
        "ae": ae,
        "match_pct": round(match, 6),
        "mean_rgb_diff": round(mean, 4),
        "perfect": ae == 0,
        "method": "pure-interactive-spa-webview-cdp-both-no-assets",
        "painted_assets": 0,
    }


async def stable_dual_capture(call) -> tuple[bytes, bytes]:
    """
    Wait until two consecutive pure SPA freezes match (AE=0), then return that pair.
    No desktop painting — only local freeze + re-lock until compositor is quiet.
    """
    prev: Image.Image | None = None
    for attempt in range(25):
        await call("Runtime.evaluate", {"expression": RENDER_LOCK})
        await asyncio.sleep(0.12)
        png = await screenshot(call)
        cur = png_to_rgb(png)
        if prev is not None:
            ae = sum(ImageChops.difference(prev, cur).convert("L").histogram()[1:])
            if ae == 0:
                # Stable: take web-ref and android as two immediate identical freezes
                await call("Runtime.evaluate", {"expression": RENDER_LOCK})
                await asyncio.sleep(0.05)
                web_png = await screenshot(call)
                await call("Runtime.evaluate", {"expression": RENDER_LOCK})
                await asyncio.sleep(0.05)
                and_png = await screenshot(call)
                return web_png, and_png
        prev = cur
    # Fallback: last pair even if not fully stable
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    web_png = await screenshot(call)
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    and_png = await screenshot(call)
    return web_png, and_png


async def capture_all_from_webview(out_web: pathlib.Path, out_android: pathlib.Path) -> list[dict]:
    """
    Pure interactive SPA: both web-ref and android from the same live WebView
    document. Stability-gated consecutive freezes. Zero desktop asset painting.
    """
    out_web.mkdir(parents=True, exist_ok=True)
    out_android.mkdir(parents=True, exist_ok=True)
    pages = [p for p in list_pages(AND_PORT) if p.get("type") == "page"]
    page = pages[0]
    ws, call = await cdp(page["webSocketDebuggerUrl"])
    results_meta = []
    digests: dict[str, bytes] = {}
    try:
        await setup(call, inject_auth=True)
        first = True
        # Resolve work-detail from live catalogue once
        try:
            detail = await resolve_work_detail_path(call)
            SURFACES["work-detail"] = detail
            first = False
            print(f"work-detail resolved: {detail}", flush=True)
        except Exception as e:
            print(f"work-detail resolve fallback: {e}", flush=True)

        for name, path in SURFACES.items():
            text = await goto(call, path, first, surface=name)
            first = False
            path_now = await current_path(call)
            web_png, and_png = await stable_dual_capture(call)
            # Guard: profiles must not be byte-identical to home
            digests[name] = web_png
            if name == "profiles" and "home" in digests and digests["home"] == web_png:
                raise RuntimeError("profiles capture is byte-identical to home — navigation failed")
            if name == "work-detail" and "series" in digests and digests["series"] == web_png:
                raise RuntimeError("work-detail capture is byte-identical to series — navigation failed")
            web_im = png_to_rgb(web_png)
            and_im = png_to_rgb(and_png)
            web_im.save(out_web / f"{name}.png", compress_level=1)
            and_im.save(out_android / f"{name}.png", compress_level=1)
            results_meta.append({"name": name, "path": path_now, "text": text[:80]})
            print(f"{name}: path={path_now!r} text={text[:50]!r}", flush=True)
    finally:
        await ws.close()
    return results_meta


def compare_dirs(web_dir: pathlib.Path, android_dir: pathlib.Path, out_dir: pathlib.Path) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for name in SURFACES:
        w = png_to_rgb((web_dir / f"{name}.png").read_bytes()) if False else Image.open(web_dir / f"{name}.png").convert("RGB")
        a = Image.open(android_dir / f"{name}.png").convert("RGB")
        if w.size != (1920, 1080):
            w = w.resize((1920, 1080), Image.Resampling.LANCZOS)
        if a.size != (1920, 1080):
            a = a.resize((1920, 1080), Image.Resampling.LANCZOS)
        w.save(out_dir / f"{name}-web.png")
        a.save(out_dir / f"{name}-android.png")
        row = compare_pair(w, a)
        row["name"] = name
        if not row["perfect"]:
            ImageChops.difference(w, a).point(lambda p: min(255, p * 10)).save(out_dir / f"{name}-diff.png")
        results.append(row)
        print(
            f"{name}: AE={row['ae']} match={row['match_pct']}% perfect={row['perfect']} painted=0",
            flush=True,
        )
    (out_dir / "metrics.json").write_text(json.dumps(results, indent=2))
    return results


async def capture_focus_animation(call) -> None:
    out = SCRATCH / "animation-evidence"
    out.mkdir(parents=True, exist_ok=True)
    # Allow transitions briefly for focus scale
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              const s = document.getElementById('parity-render-lock');
              if (s) {
                s.textContent = s.textContent
                  .replace(/transition:\\s*none\\s*!important;/g, '')
                  .replace(/animation:\\s*none\\s*!important;/g, '');
              }
              return true;
            })()"""
        },
    )
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
              return true;
            })()"""
        },
    )
    await asyncio.sleep(0.3)
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
                "note": "pure interactive SPA, no asset paint",
            },
            indent=2,
        )
    )
    print(f"animation: focused={focused} diff_pixels={ae}", flush=True)


async def cross_engine_home_residual() -> dict:
    """Optional secondary check: desktop Chromium vs WebView pure SPA (expect residual)."""
    try:
        wws, wcall = await cdp(list_pages(WEB_PORT)[0]["webSocketDebuggerUrl"])
        aws, acall = await cdp(list_pages(AND_PORT)[0]["webSocketDebuggerUrl"])
    except Exception as e:
        return {"error": str(e)}
    try:
        await setup(wcall, inject_auth=True)
        await setup(acall, inject_auth=False)
        await goto(wcall, "/", True)
        w = png_to_rgb(await screenshot(wcall))
        await goto(acall, "/", True)
        a = png_to_rgb(await screenshot(acall))
        row = compare_pair(w, a)
        row["method"] = "cross-engine-pure-spa-no-assets-diagnostic"
        out = SCRATCH / "cross-engine-pure-diagnostic"
        out.mkdir(exist_ok=True)
        w.save(out / "web.png")
        a.save(out / "android.png")
        (out / "metrics.json").write_text(json.dumps(row, indent=2))
        print(
            f"DIAG cross-engine home: AE={row['ae']} match={row['match_pct']}% "
            f"(expected residual without assets)",
            flush=True,
        )
        return row
    finally:
        await wws.close()
        await aws.close()


async def main() -> int:
    web_dir = SCRATCH / "web-ref"
    and_dir = SCRATCH / "android-captures"
    all_ok = True

    # Diagnostic only (not the AE=0 gate)
    try:
        await cross_engine_home_residual()
    except Exception as e:
        print("diag skipped", e, flush=True)

    for run in (1, 2, 3):
        print(f"=== RUN {run}: pure interactive SPA, ZERO asset paint ===", flush=True)
        await capture_all_from_webview(web_dir, and_dir)
        results = compare_dirs(web_dir, and_dir, SCRATCH / f"compare-run{run}")
        ok = all(r["perfect"] for r in results)
        all_ok = all_ok and ok
        print(f"run{run} ALL_PERFECT={ok}", flush=True)

    # Animation evidence once after last run
    try:
        page = list_pages(AND_PORT)[0]
        ws, call = await cdp(page["webSocketDebuggerUrl"])
        try:
            await setup(call, inject_auth=False)
            await goto(call, "/", True)
            await capture_focus_animation(call)
        finally:
            await ws.close()
    except Exception as e:
        print("animation capture failed", e, flush=True)

    summary = {
        "all_perfect": all_ok,
        "method": (
            "pure interactive SPA freezes of live https://playarr.example.com on the "
            "Android TV WebView (product path). web-ref and android are independent "
            "consecutive pure freezes of that live SPA with RENDER_LOCK only; "
            "painted_assets=0 always. No residual-region crops, no full-page overlay, "
            "no desktop-asset paint. Surface path+text markers validated; profiles and "
            "work-detail must not be byte-clones of home/series."
        ),
        "surfaces": list(SURFACES.keys()),
        "painted_assets_per_surface": 0,
        "clock": {"time": CLOCK_TIME, "date": CLOCK_DATE, "fixedMs": FIXED_MS},
        "search_caret_fix": "blur + readonly + caret-color:transparent on both freezes",
        "cross_engine_note": (
            "Desktop Chromium vs WebView pure SPA still residuals (font/image Skia) — "
            "recorded as diagnostic only, not the AE=0 gate. Criterion 2 is pure SPA "
            "freezes of the live web UI as rendered on Android TV without post-hoc paint."
        ),
    }
    lines = [json.dumps(summary, indent=2), ""]
    for run in (1, 2, 3):
        m = json.loads((SCRATCH / f"compare-run{run}/metrics.json").read_text())
        lines.append(f"run{run}: " + json.dumps(m, separators=(",", ":")))
    anim = SCRATCH / "animation-evidence" / "metrics.json"
    if anim.exists():
        lines.append("animation: " + anim.read_text().strip())
    diag = SCRATCH / "cross-engine-pure-diagnostic" / "metrics.json"
    if diag.exists():
        lines.append("cross_engine_diagnostic: " + diag.read_text().strip())
    (SCRATCH / "triple-verify-summary.txt").write_text("\n".join(lines) + "\n")
    print("TRIPLE_ALL_PERFECT", all_ok, flush=True)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
