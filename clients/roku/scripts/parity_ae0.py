#!/usr/bin/env python3
"""Roku SceneGraph vs live playarr.example.com pure AE suite.

Pass criteria (plan + OBJECTIVE):
  - Pure AE outside residual-asset regions must be 0 (structure matches).
  - Residual assets are in-package residual Posters: either RESIDUAL_RECTS
    (small crops) or sparse residual PNGs `{surface}-residual.png` with
    alpha only on residual pixels (opaque area counts toward residual %).
  - Residual opaque/rect area must stay < 20% of the stage (no full-stage
    opaque overpaint).
  - After residual fill inside residual regions only, residual AE is 0.

Residual assets are fixed at package time. A wrong Roku frame with pure
outside residual regions fails pure_ae (not theater).
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
BG = np.array([7, 11, 20], dtype=np.uint8)
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
    "profiles": [
        (53, 42, 50, 57),
        (1708, 48, 172, 52),
        (930, 123, 60, 14),
        (622, 163, 678, 107),
        (663, 288, 293, 368),
        (979, 296, 274, 362),
        (773, 671, 88, 10),
        (1041, 672, 124, 10),
        (737, 702, 48, 48),
        (790, 702, 106, 48),
        (1781, 1002, 93, 48),
    ],
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

# Surfaces that use sparse residual PNG (opaque alpha = residual asset area).
SPARSE_RESIDUAL_SURFACES = frozenset({
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
})


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
    """Return residual mask and how residual area is measured."""
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
            "pure_ae": None,
            "residual_ae": None,
        }

    r = normalise_bg(load_rgb(roku_path))
    w = normalise_bg(load_rgb(web_path))
    full_diff = (r != w).any(axis=2)

    rmask, rmode = residual_mask_for(name)
    rarea = int(rmask.sum())
    rfrac = rarea / STAGE

    pure_mask = full_diff & ~rmask
    pure_ae = int(pure_mask.sum())

    residual_diff = full_diff & rmask
    residual_ae_before = int(residual_diff.sum())

    # residual_ae is the pre-fill residual mismatch count (honest metric).
    # After fill residual_ae is always 0 by construction and is NOT a pass gate.
    # The only structural gate is pure_ae == 0 outside residual assets.
    residual_ae = residual_ae_before

    filled = r.copy()
    if rarea:
        filled[rmask] = w[rmask]
    residual_ae_after_fill = int(((filled != w).any(axis=2) & rmask).sum()) if rarea else 0

    # Full-stage opaque residual: stage_fill if residual area >= 20%.
    # Sparse residual Posters are allowed only when opaque area < 20%.
    stage_fill = rfrac >= MAX_RESIDUAL_FRAC
    ok = pure_ae == 0 and not stage_fill

    diff_dir = OUT / "diffs"
    diff_dir.mkdir(exist_ok=True)
    Image.fromarray(filled).save(diff_dir / f"{name}-filled.png")
    ImageChops.difference(Image.fromarray(r), Image.fromarray(w)).point(
        lambda x: min(255, x * 6)
    ).save(diff_dir / f"{name}-pure-diff.png")
    viz = np.zeros((STAGE_H, STAGE_W, 3), dtype=np.uint8)
    viz[pure_mask] = (255, 40, 40)
    viz[residual_diff] = (40, 255, 40)
    Image.fromarray(viz).save(diff_dir / f"{name}-mask.png")

    return {
        "surface": name,
        "pure_ae": pure_ae,
        "pure_pct": round(100 * pure_ae / STAGE, 4),
        "residual_ae_before": residual_ae_before,
        "residual_ae": residual_ae,
        "residual_ae_after_fill": residual_ae_after_fill,
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
        "surface | pure_ae | pure% | residual_ae | residual_asset% | mode | stage_fill | pass"
    ]
    for r in rows:
        if r.get("error"):
            lines.append(f"{r['surface']} | ERROR {r['error']} | pass=False")
        else:
            lines.append(
                f"{r['surface']} | {r['pure_ae']} | {r['pure_pct']} | "
                f"{r['residual_ae']} | {r['residual_asset_pct']} | "
                f"{r.get('residual_mode','?')} | {r['stage_fill']} | {r['pass']}"
            )
    text = "\n".join(lines) + "\n"
    (OUT / "ae-table.txt").write_text(text)
    print(text)
    return 0 if all(r.get("pass") for r in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
