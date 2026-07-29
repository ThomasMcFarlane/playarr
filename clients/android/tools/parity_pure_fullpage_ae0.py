#!/usr/bin/env python3
"""
Pure full-page SPA freezes only (NO residual-asset paint, NO full-page paint).

web-ref  = desktop Chromium freeze of live playarr.example.com @ 1920×1080
android  = Android TV WebView SPA freeze of the same routes

Records pure_ae / match_pct for every surface. Exit 0 only when every surface
is AE=0; otherwise exit 1 with honest metrics (layout residual classified
separately from engine AA via residual analysis tools).
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import pathlib
import sys
import time
import urllib.request

import websockets
from PIL import Image, ImageChops, ImageStat

# Reuse RENDER_LOCK / auth from the cross-engine pure suite module path.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from parity_cross_engine_pure_ae0 import (  # type: ignore
    API,
    AND_PORT,
    DESKTOP_UA,
    RENDER_LOCK,
    SCRATCH,
    SURFACES,
    WEB_PORT,
    auth_script,
    cdp,
    compare_pair,
    goto,
    list_pages,
    png_to_rgb,
    screenshot,
    setup,
    wait_ready,
)


async def freeze_surface(call, path: str, first: bool, inject_auth: bool) -> tuple[str, bytes]:
    text = await goto(call, path, first=first, inject_auth=inject_auth)
    # Extra layout lock + scroll zero already inside RENDER_LOCK
    for _ in range(4):
        await call("Runtime.evaluate", {"expression": RENDER_LOCK})
        await asyncio.sleep(0.05)
    data = await screenshot(call)
    return text, data


async def run_once(run_id: int) -> list[dict]:
    out_dir = SCRATCH / f"pure-fullpage-run{run_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []

    web_pages = list_pages(WEB_PORT)
    and_pages = list_pages(AND_PORT)
    web_page = next(p for p in web_pages if p.get("type") == "page")
    and_page = next(p for p in and_pages if p.get("type") == "page")

    web_ws, web_call = await cdp(web_page["webSocketDebuggerUrl"])
    and_ws, and_call = await cdp(and_page["webSocketDebuggerUrl"])
    try:
        await setup(web_call, inject_auth=True)
        await setup(and_call, inject_auth=True)
        first = True
        for name, path in SURFACES.items():
            print(f"run{run_id} {name}: desktop Chromium SPA...", flush=True)
            w_text, w_png = await freeze_surface(web_call, path, first=first, inject_auth=True)
            print(f"run{run_id} {name}: Android WebView SPA...", flush=True)
            a_text, a_png = await freeze_surface(and_call, path, first=first, inject_auth=True)
            first = False
            w_im = png_to_rgb(w_png)
            a_im = png_to_rgb(a_png)
            m = compare_pair(w_im, a_im)
            row = {
                "name": name,
                "phase": "pure_fullpage_spa",
                "painted_assets": 0,
                "web_text": w_text[:120],
                "android_text": a_text[:120],
                **m,
            }
            results.append(row)
            w_im.save(out_dir / f"{name}-web.png")
            a_im.save(out_dir / f"{name}-android.png")
            ImageChops.difference(w_im, a_im).save(out_dir / f"{name}-diff.png")
            print(
                f"run{run_id} {name}: pure_AE={m['ae']} match={m['match_pct']}% perfect={m['perfect']}",
                flush=True,
            )
    finally:
        await web_ws.close()
        await and_ws.close()

    (out_dir / "metrics.json").write_text(json.dumps(results, indent=2))
    return results


async def main() -> int:
    runs = int(os.environ.get("RUNS", "3"))
    all_perfect = True
    summary: list[dict] = []
    for i in range(1, runs + 1):
        print(f"=== PURE FULLPAGE RUN {i}/{runs} ===", flush=True)
        rows = await run_once(i)
        perfect = all(r["perfect"] for r in rows)
        all_perfect = all_perfect and perfect
        summary.append({"run": i, "perfect": perfect, "rows": rows})
    (SCRATCH / "pure-fullpage-summary.json").write_text(json.dumps(summary, indent=2))
    lines = ["# Pure full-page SPA freezes (no asset paint)", ""]
    for s in summary:
        lines.append(f"## Run {s['run']} perfect={s['perfect']}")
        for r in s["rows"]:
            lines.append(
                f"- {r['name']}: AE={r['ae']} match={r['match_pct']}% painted_assets=0"
            )
        lines.append("")
    (SCRATCH / "pure-fullpage-summary.txt").write_text("\n".join(lines))
    print("ALL_PERFECT" if all_perfect else "NOT_PERFECT", flush=True)
    return 0 if all_perfect else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
