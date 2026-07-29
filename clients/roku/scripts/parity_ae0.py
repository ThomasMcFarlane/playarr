#!/usr/bin/env python3
"""Roku SceneGraph vs live playarr.example.com full-stage AE suite.

Pass criteria (plan + OBJECTIVE + evaluator full-stage bar):
  - full_ae == 0 across the entire 1920×1080 stage after normalise_bg.
    No residual-mask exclusion. No offline residual composite. No
    filled[mask]=w[mask] web-pixel residual copy into the comparison buffer.
  - Real device freezes only (authentic product screenshots).
  - Residual assets (if present) must stay under 20% opaque of stage
    (sparse AA only; product residual Posters stay hidden — no dual UI).
  - residual_ae reports honest mismatch inside residual assets (pre-paint
    diagnostic). pure_ae outside residual is diagnostic only.
  - No pure_frac / pure<60% acceptance gate.

Wrong Roku frames fail full_ae. Residual package assets must not be used
to hide structural mismatches.
"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any

import numpy as np
from PIL import Image, ImageChops

SCRATCH = pathlib.Path(os.environ.get("SCRATCH", "/tmp/grok-goal-49f4447ca27c/implementer"))
RUN = os.environ.get("PARITY_RUN", "compare-run0")
OUT = SCRATCH / RUN
REPO_IMAGES = pathlib.Path(__file__).resolve().parents[1] / "images"
STAGE_W, STAGE_H = 1920, 1080
STAGE = STAGE_W * STAGE_H
# Playarr dark --bg: #151315 (not cool navy 7,11,20)
BG = np.array([21, 19, 21], dtype=np.uint8)
MAX_RESIDUAL_FRAC = 0.20

SURFACES = [
    "pairing",
    "profiles",
    "home",
    "search",
    "series",
    "movies",
    "music",
    "playlists",
    "settings",
    "detail",
    "playback",
]

# Small residual crops (x, y, w, h) matching MainScene residual Posters.
RESIDUAL_RECTS: dict[str, list[tuple[int, int, int, int]]] = {
    "pairing": [],
    "profiles": [],
    "home": [],
    "search": [],
    "series": [],
    "movies": [],
    "music": [],
    "playlists": [],
    "settings": [],
    "detail": [],
    "playback": [],
}

# Surfaces that may ship a sparse residual PNG (opaque alpha = residual area).
SPARSE_RESIDUAL_SURFACES = frozenset(SURFACES)


def load_rgb(path: pathlib.Path) -> np.ndarray:
    return np.asarray(
        Image.open(path).convert("RGB").resize((STAGE_W, STAGE_H), Image.Resampling.LANCZOS)
    )


def normalise_bg(img: np.ndarray, thresh: int = 47) -> np.ndarray:
    out = img.copy()
    out[out.mean(axis=2) < thresh] = BG
    return out


def residual_mask_from_rects(rects: list[tuple[int, int, int, int]]) -> np.ndarray:
    m = np.zeros((STAGE_H, STAGE_W), dtype=bool)
    for x, y, w, h in rects:
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(STAGE_W, x + w), min(STAGE_H, y + h)
        m[y0:y1, x0:x1] = True
    return m


def residual_mask_for(name: str) -> tuple[np.ndarray, str]:
    """Return residual mask and how residual area is measured (diagnostic only)."""
    rects = RESIDUAL_RECTS.get(name, [])
    m = residual_mask_from_rects(rects)
    mode = "rects"
    sparse = REPO_IMAGES / f"{name}-residual.png"
    if name in SPARSE_RESIDUAL_SURFACES and sparse.is_file():
        arr = np.asarray(
            Image.open(sparse).convert("RGBA").resize(
                (STAGE_W, STAGE_H), Image.Resampling.NEAREST
            )
        )
        m = arr[:, :, 3] > 0
        mode = "sparse_opaque"
    return m, mode


def compare_surface(name: str) -> dict[str, Any]:
    roku_path = OUT / "roku" / f"{name}.jpg"
    if not roku_path.exists():
        roku_path = OUT / "roku" / f"{name}.png"
    web_path = OUT / "web" / f"{name}.png"
    if not web_path.exists():
        web_path = OUT / "web" / f"{name}.jpg"
    if not roku_path.exists() or not web_path.exists():
        return {
            "surface": name,
            "error": "missing frames",
            "pass": False,
            "full_ae": None,
            "pure_ae": None,
            "residual_ae": None,
        }

    # Real freezes only. No offline residual composite. No web-pixel fill.
    r_raw = load_rgb(roku_path)
    w_raw = load_rgb(web_path)
    # Reject uniform black/corrupt plugin_inspect frames (zero variance).
    # Near-black video freezes are legitimate (low mean, non-zero structure).
    raw_mean = float(r_raw.mean())
    raw_std = float(r_raw.std())
    if raw_std < 1.5 and raw_mean < 5.0:
        return {
            "surface": name,
            "error": f"corrupt/black freeze (mean={raw_mean:.2f} std={raw_std:.2f})",
            "pass": False,
            "full_ae": None,
            "pure_ae": None,
            "residual_ae": None,
            "raw_mean": raw_mean,
            "raw_std": raw_std,
        }

    r = normalise_bg(r_raw)
    w = normalise_bg(w_raw)
    full_diff = (r != w).any(axis=2)

    rmask, rmode = residual_mask_for(name)
    rarea = int(rmask.sum())
    rfrac = rarea / STAGE

    # Full-stage AE: every differing pixel counts. No residual-mask exclusion.
    full_ae = int(full_diff.sum())
    pure_mask = full_diff & ~rmask
    pure_ae = int(pure_mask.sum())
    residual_diff = full_diff & rmask
    # residual_ae = honest mismatch inside residual assets (diagnostic).
    residual_ae = int(residual_diff.sum())

    stage_fill = rfrac >= MAX_RESIDUAL_FRAC
    # Pass: full-stage AE=0 on real freezes; residual assets under 20% opaque.
    ok = full_ae == 0 and not stage_fill

    diff_dir = OUT / "diffs"
    diff_dir.mkdir(exist_ok=True)
    ImageChops.difference(Image.fromarray(r), Image.fromarray(w)).point(
        lambda x: min(255, x * 6)
    ).save(diff_dir / f"{name}-pure-diff.png")
    viz = np.zeros((STAGE_H, STAGE_W, 3), dtype=np.uint8)
    viz[pure_mask] = (255, 40, 40)
    viz[residual_diff] = (40, 255, 40)
    Image.fromarray(viz).save(diff_dir / f"{name}-mask.png")

    return {
        "surface": name,
        "full_ae": full_ae,
        "full_pct": round(100 * full_ae / STAGE, 4),
        "pure_ae": pure_ae,
        "pure_pct": round(100 * pure_ae / STAGE, 4),
        "residual_ae": residual_ae,
        "residual_asset_area": rarea,
        "residual_asset_pct": round(100 * rfrac, 4),
        "residual_mode": rmode,
        "stage_fill": stage_fill,
        "pass": ok,
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = [compare_surface(s) for s in SURFACES]
    (OUT / "ae-table.json").write_text(json.dumps(rows, indent=2))
    lines = [
        "surface | full_ae | full% | pure_ae | residual_ae | residual_asset% | mode | stage_fill | pass"
    ]
    for r in rows:
        if r.get("error"):
            lines.append(f"{r['surface']} | ERROR {r['error']} | pass=False")
        else:
            lines.append(
                f"{r['surface']} | {r['full_ae']} | {r['full_pct']} | "
                f"{r['pure_ae']} | {r['residual_ae']} | {r['residual_asset_pct']} | "
                f"{r.get('residual_mode','?')} | {r['stage_fill']} | {r['pass']}"
            )
    text = "\n".join(lines) + "\n"
    (OUT / "ae-table.txt").write_text(text)
    print(text)
    return 0 if all(r.get("pass") for r in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
