#!/usr/bin/env python3
"""Deterministic AE pixel compare for Android TV vs web 1920x1080 captures."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageStat


def fit_stage(im: Image.Image, size=(1920, 1080)) -> Image.Image:
    im = im.convert("RGB")
    if im.size != size:
        im = im.resize(size, Image.Resampling.LANCZOS)
    return im


def mask_dynamic(im: Image.Image) -> Image.Image:
    """Black out live clock (top-centre) so AE is not poisoned by wall-clock drift."""
    out = im.copy()
    draw = ImageDraw.Draw(out)
    # Top-centre clock band used by both surfaces
    draw.rectangle((780, 8, 1140, 64), fill=(0, 0, 0))
    return out


def compare_pair(web: Path, android: Path, out_dir: Path, name: str, mask_clock: bool) -> dict:
    w = fit_stage(Image.open(web))
    a = fit_stage(Image.open(android))
    if mask_clock:
        w = mask_dynamic(w)
        a = mask_dynamic(a)
    out_dir.mkdir(parents=True, exist_ok=True)
    w.save(out_dir / f"{name}-web.png")
    a.save(out_dir / f"{name}-android.png")
    diff = ImageChops.difference(w, a)
    gray = diff.convert("L")
    hist = gray.histogram()
    ae = sum(hist[1:])
    total = 1920 * 1080
    match_pct = 100.0 * (1.0 - ae / total)
    mean_rgb = sum(ImageStat.Stat(diff).mean) / 3.0
    diff.point(lambda p: min(255, p * 8)).save(out_dir / f"{name}-diff.png")
    return {
        "name": name,
        "ae": ae,
        "total": total,
        "match_pct": round(match_pct, 6),
        "mean_rgb_diff": round(mean_rgb, 4),
        "perfect": ae == 0,
        "mask_clock": mask_clock,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--web-dir", type=Path, required=True)
    ap.add_argument("--android-dir", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--mask-clock", action="store_true")
    ap.add_argument(
        "--surfaces",
        default="home,search,series,movies,music,playlists,profiles,settings",
    )
    args = ap.parse_args()
    results = []
    for name in [s.strip() for s in args.surfaces.split(",") if s.strip()]:
        # allow home2 alias
        web = args.web_dir / f"{name}.png"
        android = args.android_dir / f"{name}.png"
        if name == "home" and not android.exists():
            android = args.android_dir / "home2.png"
        if not web.exists() or not android.exists():
            results.append({"name": name, "status": "missing", "web": web.exists(), "android": android.exists(), "perfect": False})
            print(f"{name}: MISSING web={web.exists()} android={android.exists()}")
            continue
        m = compare_pair(web, android, args.out_dir, name, args.mask_clock)
        results.append(m)
        print(f"{name}: AE={m['ae']} match={m['match_pct']}% perfect={m['perfect']}")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "metrics.json").write_text(json.dumps(results, indent=2))
    all_perfect = all(r.get("perfect") for r in results if r.get("status") != "missing")
    present = [r for r in results if r.get("status") != "missing"]
    summary = {
        "surfaces": len(present),
        "perfect_count": sum(1 for r in present if r.get("perfect")),
        "all_perfect": all_perfect and len(present) > 0,
        "results": results,
    }
    (args.out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    print("all_perfect", summary["all_perfect"])
    return 0 if summary["all_perfect"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
