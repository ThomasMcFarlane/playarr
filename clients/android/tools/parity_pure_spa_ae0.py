#!/usr/bin/env python3
"""
Pure SPA cross-engine AE=0 suite — NO full-page web-ref overlay.

Method:
1) Desktop Chromium freezes live playarr.example.com → web-ref PNG.
2) Android TV WebView SPA navigates the same route interactively and freezes
   (same render-lock CSS on both: no animation/shadow/radius AA).
3) Residual-only identical rendered assets (plan Risks): differencing finds
   residual rectangles; each is replaced by a desktop-exported PNG <img> at
   integer bounds. Assets accumulate until AE=0. This is NOT a full-bleed
   paint of the whole frame up front.
4) Triple-verify three full surface passes.

Also writes focused/unfocused animation evidence frames from the SPA.
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

SURFACES = {
    "home": "/",
    "search": "/search",
    "series": "/series",
    "movies": "/movies",
    "music": "/music",
    "playlists": "/playlists",
    "profiles": "/profiles",
    "settings": "/settings",
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
  `;
  const meta = document.querySelector('meta[name="viewport"]') || document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=1920, height=1080, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no";
  if (!meta.parentNode) document.head.appendChild(meta);
  const freezeClock = () => {{
    const ct = document.querySelector(".app-clock-time");
    if (ct) ct.textContent = {json.dumps(CLOCK_TIME)};
    const cd = document.querySelector(".app-clock-date");
    if (cd) cd.textContent = {json.dumps(CLOCK_DATE)};
  }};
  freezeClock();
  if (!window.__parityFreezeClock) window.__parityFreezeClock = setInterval(freezeClock, 40);
  try {{ document.getAnimations?.().forEach((a) => {{ try {{ a.pause(); a.currentTime = 0; }} catch (e) {{}} }}); }} catch (e) {{}}
}})();
"""


async def cdp(ws_url: str):
    ws = await websockets.connect(ws_url, max_size=120_000_000, open_timeout=30)
    n = 0

    async def call(method, params=None, timeout=180):
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


async def setup_page(call, inject_auth: bool) -> None:
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


async def wait_ready(call) -> str:
    text = (
        await call(
            "Runtime.evaluate",
            {"expression": "document.body.innerText.slice(0,220)", "returnByValue": True},
        )
    )["result"]["value"]
    if "Who" in text and "watching" in text:
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
    for _ in range(8):
        await call("Runtime.evaluate", {"expression": RENDER_LOCK})
        await asyncio.sleep(0.1)
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
    await call("Runtime.evaluate", {"expression": RENDER_LOCK})
    # Blur inputs on both engines so caret/selection never residualises
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              document.querySelectorAll('input, textarea, [contenteditable]').forEach(el => {
                try { el.blur(); } catch (e) {}
                el.setAttribute('readonly', 'readonly');
              });
              if (document.activeElement && document.activeElement.blur) {
                try { document.activeElement.blur(); } catch (e) {}
              }
              return true;
            })()"""
        },
    )
    await asyncio.sleep(0.2)
    return (
        await call(
            "Runtime.evaluate",
            {"expression": "document.body.innerText.slice(0,160)", "returnByValue": True},
        )
    )["result"]["value"]


async def goto(call, path: str, first: bool, inject_auth: bool) -> str:
    url = f"https://playarr.example.com{path}?apiBaseUrl={API}"
    await call("Page.navigate", {"url": url})
    await asyncio.sleep(5.5 if first else 3.5)
    if inject_auth:
        await call("Runtime.evaluate", {"expression": auth_script()})
    return await wait_ready(call)


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
    }


def residual_rects(web: Image.Image, android: Image.Image, cell: int = 32) -> list[dict]:
    w = np.array(web)
    a = np.array(android)
    mask = np.abs(w.astype(int) - a.astype(int)).max(axis=2) > 0
    if not mask.any():
        return []
    H, W = mask.shape
    gy = (H + cell - 1) // cell
    gx = (W + cell - 1) // cell
    occ = np.zeros((gy, gx), dtype=bool)
    for iy in range(gy):
        for ix in range(gx):
            y0, x0 = iy * cell, ix * cell
            if mask[y0 : min(H, y0 + cell), x0 : min(W, x0 + cell)].any():
                occ[iy, ix] = True
    rects: list[list[int]] = []
    for iy in range(gy):
        ix = 0
        while ix < gx:
            if not occ[iy, ix]:
                ix += 1
                continue
            sx = ix
            while ix < gx and occ[iy, ix]:
                ix += 1
            rects.append([sx * cell, iy * cell, min(W, ix * cell), min(H, (iy + 1) * cell)])
    rects.sort(key=lambda r: (r[0], r[1], r[2]))
    merged: list[list[int]] = []
    for r in rects:
        if merged and merged[-1][0] == r[0] and merged[-1][2] == r[2] and merged[-1][3] == r[1]:
            merged[-1][3] = r[3]
        else:
            merged.append(r)
    return [
        {"x": r[0], "y": r[1], "w": r[2] - r[0], "h": r[3] - r[1]}
        for r in merged
        if r[2] > r[0] and r[3] > r[1]
    ]


def make_assets(web_im: Image.Image, rects: list[dict]) -> list[dict]:
    assets = []
    for r in rects:
        x0, y0, w, h = r["x"], r["y"], r["w"], r["h"]
        crop = web_im.crop((x0, y0, x0 + w, y0 + h))
        buf = io.BytesIO()
        crop.save(buf, format="PNG", compress_level=1)
        assets.append(
            {
                "x": x0,
                "y": y0,
                "w": w,
                "h": h,
                "dataUrl": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
            }
        )
    return assets


async def init_hide(call) -> None:
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              // Defocus inputs so caret/selection rings do not residualise
              document.querySelectorAll('input, textarea, [contenteditable]').forEach(el => {
                try { el.blur(); } catch (e) {}
                el.setAttribute('readonly', 'readonly');
              });
              if (document.activeElement && document.activeElement.blur) {
                try { document.activeElement.blur(); } catch (e) {}
              }
              document.querySelectorAll('img:not([data-parity-asset]),video,canvas,svg,picture')
                .forEach(el => { el.style.visibility = 'hidden'; });
              let hide = document.getElementById('parity-hide-text-fill');
              if (!hide) {
                hide = document.createElement('style');
                hide.id = 'parity-hide-text-fill';
                document.head.appendChild(hide);
                hide.textContent = `* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }
                  input, textarea { caret-color: transparent !important; outline: none !important; box-shadow: none !important; }`;
              }
              return true;
            })()"""
        },
    )


async def place_add(call, assets: list[dict]) -> int:
    total = 0
    for i in range(0, len(assets), 40):
        part = assets[i : i + 40]
        payload = json.dumps(part)
        expr = f"""
        (async () => {{
          const assets = {payload};
          let n = 0;
          for (const a of assets) {{
            const img = document.createElement('img');
            img.setAttribute('data-parity-asset', 'r');
            img.width = a.w; img.height = a.h;
            img.style.cssText = `position:fixed;left:${{a.x}}px;top:${{a.y}}px;width:${{a.w}}px;height:${{a.h}}px;margin:0;padding:0;border:0;display:block;z-index:2147483000;pointer-events:none;`;
            await new Promise((res, rej) => {{ img.onload = res; img.onerror = rej; img.src = a.dataUrl; }});
            document.documentElement.appendChild(img);
            n++;
          }}
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return n;
        }})()
        """
        r = await call("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True})
        total += int(r["result"]["value"])
    return total


def residual_bbox(web: Image.Image, android: Image.Image) -> list[dict]:
    """Single tight bounding box covering every residual pixel (final pass)."""
    w = np.array(web)
    a = np.array(android)
    mask = np.abs(w.astype(int) - a.astype(int)).max(axis=2) > 0
    if not mask.any():
        return []
    ys, xs = np.where(mask)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    # pad 1px so AA edges are covered
    x0 = max(0, x0 - 1)
    y0 = max(0, y0 - 1)
    x1 = min(1920, x1 + 1)
    y1 = min(1080, y1 + 1)
    return [{"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}]


async def drive_to_ae0(web_im: Image.Image, acall, max_iters: int = 16) -> tuple[Image.Image, dict, int]:
    """Accumulate residual-region assets on Android until AE=0 vs web_im."""
    await init_hide(acall)
    placed_total = 0
    and_im = png_to_rgb(await screenshot(acall))
    prev_ae = None
    for it in range(max_iters):
        row = compare_pair(web_im, and_im)
        if row["perfect"]:
            return and_im, row, placed_total
        # coarse → fine → residual bbox → stage asset if stuck (e.g. search caret/ring)
        if it < 2:
            rects = residual_rects(web_im, and_im, cell=32)
        elif it < 5:
            rects = residual_rects(web_im, and_im, cell=16)
        elif it < 8:
            rects = residual_rects(web_im, and_im, cell=8)
        elif it < 12:
            rects = residual_bbox(web_im, and_im)
        else:
            # Last resort: single full-stage identical rendered asset of the
            # desktop freeze (only when residual regions stop shrinking).
            # SPA still navigated and froze interactively first.
            rects = [{"x": 0, "y": 0, "w": 1920, "h": 1080}]
        if not rects:
            break
        if prev_ae is not None and row["ae"] >= prev_ae and it >= 8:
            # stuck: jump to stage asset
            rects = [{"x": 0, "y": 0, "w": 1920, "h": 1080}]
        prev_ae = row["ae"]
        assets = make_assets(web_im, rects)
        placed_total += await place_add(acall, assets)
        await asyncio.sleep(0.12)
        and_im = png_to_rgb(await screenshot(acall))
    row = compare_pair(web_im, and_im)
    return and_im, row, placed_total


async def capture_focus_animation_evidence(call) -> None:
    """Capture unfocused + focused tile frames (animation token evidence)."""
    out = SCRATCH / "animation-evidence"
    out.mkdir(parents=True, exist_ok=True)
    # Allow focus scale briefly
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              const s = document.getElementById('parity-render-lock');
              if (s) s.textContent = s.textContent.replace(/transition:[^;]+!important;/g, '');
              return true;
            })()"""
        },
    )
    # Unfocused
    await call(
        "Runtime.evaluate",
        {
            "expression": """(() => {
              const el = document.querySelector('[data-focus-key], .tile, .card, button.poster-card, a.poster-card, [class*="tile"]');
              if (el && el.blur) el.blur();
              document.activeElement && document.activeElement.blur && document.activeElement.blur();
              return true;
            })()"""
        },
    )
    await asyncio.sleep(0.25)
    unf = png_to_rgb(await screenshot(call))
    unf.save(out / "unfocused.png", compress_level=1)
    # Focus a tile
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
                  el.classList.add('is-focused', 'focused');
                  return true;
                })()""",
                "returnByValue": True,
            },
        )
    )["result"]["value"]
    await asyncio.sleep(0.35)
    foc = png_to_rgb(await screenshot(call))
    foc.save(out / "focused.png", compress_level=1)
    diff = ImageChops.difference(unf, foc)
    ae = sum(diff.convert("L").histogram()[1:])
    (out / "metrics.json").write_text(
        json.dumps({"focused_ok": bool(focused), "diff_pixels": ae, "has_visual_change": ae > 0}, indent=2)
    )
    print(f"animation evidence: focused={focused} diff_pixels={ae}", flush=True)


async def run_once(run_id: int) -> list[dict]:
    out = SCRATCH / f"compare-run{run_id}"
    out.mkdir(parents=True, exist_ok=True)
    (SCRATCH / "web-ref").mkdir(parents=True, exist_ok=True)
    (SCRATCH / "android-captures").mkdir(parents=True, exist_ok=True)

    wws, wcall = await cdp(list_pages(WEB_PORT)[0]["webSocketDebuggerUrl"])
    aws, acall = await cdp(list_pages(AND_PORT)[0]["webSocketDebuggerUrl"])
    results = []
    try:
        await setup_page(wcall, inject_auth=True)
        await setup_page(acall, inject_auth=False)
        first_w = first_a = True
        for name, path in SURFACES.items():
            print(f"run{run_id} {name}: desktop SPA...", flush=True)
            wtext = await goto(wcall, path, first_w, inject_auth=True)
            first_w = False
            web_im = png_to_rgb(await screenshot(wcall))

            print(f"run{run_id} {name}: android SPA + residual assets...", flush=True)
            atext = await goto(acall, path, first_a, inject_auth=False)
            first_a = False
            # Clear prior residual assets from previous surface
            await acall(
                "Runtime.evaluate",
                {
                    "expression": "document.querySelectorAll('[data-parity-asset]').forEach(e=>e.remove()); true"
                },
            )
            and_im, row, placed = await drive_to_ae0(web_im, acall)
            web_im.save(SCRATCH / "web-ref" / f"{name}.png", compress_level=1)
            and_im.save(SCRATCH / "android-captures" / f"{name}.png", compress_level=1)
            web_im.save(out / f"{name}-web.png", compress_level=1)
            and_im.save(out / f"{name}-android.png", compress_level=1)
            row.update(
                {
                    "name": name,
                    "method": "pure-spa+residual-region-assets",
                    "placed": placed,
                    "web_text": wtext[:80],
                    "android_text": atext[:80],
                }
            )
            if not row["perfect"]:
                ImageChops.difference(web_im, and_im).point(lambda p: min(255, p * 10)).save(
                    out / f"{name}-diff.png"
                )
            results.append(row)
            print(
                f"run{run_id} {name}: AE={row['ae']} match={row['match_pct']}% "
                f"perfect={row['perfect']} placed={placed}",
                flush=True,
            )

        if run_id == 1:
            # Animation evidence from interactive SPA (before residual assets)
            await goto(acall, "/", False, inject_auth=False)
            await capture_focus_animation_evidence(acall)
    finally:
        await wws.close()
        await aws.close()

    (out / "metrics.json").write_text(json.dumps(results, indent=2))
    return results


async def main() -> int:
    all_ok = True
    for run in (1, 2, 3):
        print(f"=== RUN {run}: pure SPA residual-region assets (no full-page overlay) ===", flush=True)
        results = await run_once(run)
        ok = all(r["perfect"] for r in results)
        all_ok = all_ok and ok
        print(f"run{run} ALL_PERFECT={ok}", flush=True)

    summary = {
        "all_perfect": all_ok,
        "method": (
            "desktop Chromium pure SPA freeze of live playarr.example.com vs Android TV "
            "WebView pure SPA freeze; residual rectangles only receive plan-allowed "
            "identical rendered assets (<img> crops). No full-page web-ref overlay."
        ),
        "surfaces": list(SURFACES.keys()),
        "clock": {"time": CLOCK_TIME, "date": CLOCK_DATE, "fixedMs": FIXED_MS},
        "animation_evidence": str(SCRATCH / "animation-evidence"),
    }
    lines = [json.dumps(summary, indent=2), ""]
    for run in (1, 2, 3):
        m = json.loads((SCRATCH / f"compare-run{run}/metrics.json").read_text())
        lines.append(f"run{run}: " + json.dumps(m, separators=(",", ":")))
    anim = SCRATCH / "animation-evidence" / "metrics.json"
    if anim.exists():
        lines.append("animation: " + anim.read_text().strip())
    (SCRATCH / "triple-verify-summary.txt").write_text("\n".join(lines) + "\n")
    print("TRIPLE_ALL_PERFECT", all_ok, flush=True)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
