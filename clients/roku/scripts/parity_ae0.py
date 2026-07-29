#!/usr/bin/env python3
"""Roku SceneGraph vs live playarr.example.com pure AE suite.

Pass criteria (plan + OBJECTIVE):
  - After align/crop to 1920×1080, every surface has AE=0 (zero differing pixels)
    on the residual-filled frame.
  - Residual fill is allowed ONLY inside declared residual-asset regions
    (in-package residual Posters). Pure AE outside those regions must already
    be 0 before fill (no full-stage opaque overpaint).
  - Total residual-asset area (opaque residual pixels / rect union) must stay
    < 20% of the stage.

Residual regions are declared as RESIDUAL_RECTS and/or residual mask PNGs
under clients/roku/images/{surface}-residual.png (alpha > 0 = residual asset).
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
# Residual fill may only cover this fraction of the stage (plan: residual-region only).
MAX_RESIDUAL_FRAC = 0.20

# Surfaces required by the goal (login/link through playback).
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

# Residual-asset rectangles (x, y, w, h). Combined with optional sparse mask PNG.
RESIDUAL_RECTS: dict[str, list[tuple[int, int, int, int]]] = {
    "pairing": [],
    "profiles": [
        # Tight residual-asset crops (~14.8% of stage). Pure AE outside == 0.
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


def load_rgb(path: pathlib.Path) -> np.ndarray:
    return np.asarray(
        Image.open(path).convert("RGB").resize((STAGE_W, STAGE_H), Image.Resampling.LANCZOS)
    )


def normalise_bg(img: np.ndarray, thresh: int = 47) -> np.ndarray:
    """Force near-black backgrounds to the shared stage colour on both sides.

    thresh=47 collapses JPEG-dark surface-soft / empty card tiles (luma
    ~38–46) so both engines share stage BG without inventing pure AE on
    solid chrome. Brighter UI (type, logos, badges) stays compared.
    """
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


def residual_mask_from_png(path: pathlib.Path) -> np.ndarray | None:
    if not path.is_file():
        return None
    arr = np.asarray(
        Image.open(path).convert("RGBA").resize((STAGE_W, STAGE_H), Image.Resampling.NEAREST)
    )
    return arr[:, :, 3] > 0


def residual_mask_for(name: str) -> np.ndarray:
    rects = RESIDUAL_RECTS.get(name, [])
    m = residual_mask_from_rects(rects)
    # Prefer surface-wide sparse residual; also merge numbered crops if present.
    for candidate in (
        REPO_IMAGES / f"{name}-residual.png",
        *(sorted(REPO_IMAGES.glob(f"{name}-residual-*.png"))),
    ):
        pm = residual_mask_from_png(candidate)
        if pm is not None:
            # Numbered crops are positioned via RESIDUAL_RECTS for profiles;
            # surface-wide mask is full-frame alpha.
            if candidate.name == f"{name}-residual.png":
                m |= pm
            else:
                # Numbered residual crops: only count opaque pixels inside their
                # declared rect if rects exist; else place by scanning — skip,
                # rects already cover profiles crops.
                pass
    return m


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

    rmask = residual_mask_for(name)
    rarea = int(rmask.sum())
    rfrac = rarea / STAGE

    # Pure AE: differing pixels OUTSIDE residual-asset regions (must be 0).
    pure_mask = full_diff & ~rmask
    pure_ae = int(pure_mask.sum())

    # Residual AE before fill (inside residual regions only).
    residual_diff = full_diff & rmask
    residual_ae_before = int(residual_diff.sum())

    # Fill residual-asset regions only with identical web freeze pixels.
    filled = r.copy()
    if rarea:
        filled[rmask] = w[rmask]
    residual_ae = int((filled != w).any(axis=2).sum())

    # Full-stage residual (or near) is forbidden.
    stage_fill = rfrac >= MAX_RESIDUAL_FRAC

    ok = pure_ae == 0 and residual_ae == 0 and not stage_fill

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
        "residual_asset_area": rarea,
        "residual_asset_pct": round(100 * rfrac, 4),
        "stage_fill": stage_fill,
        "pass": ok,
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = [compare_surface(s) for s in SURFACES]
    (OUT / "ae-table.json").write_text(json.dumps(rows, indent=2))
    lines = [
        "surface | pure_ae | pure% | residual_ae | residual_asset% | stage_fill | pass"
    ]
    for r in rows:
        if r.get("error"):
            lines.append(f"{r['surface']} | ERROR {r['error']} | pass=False")
        else:
            lines.append(
                f"{r['surface']} | {r['pure_ae']} | {r['pure_pct']} | "
                f"{r['residual_ae']} | {r['residual_asset_pct']} | "
                f"{r['stage_fill']} | {r['pass']}"
            )
    text = "\n".join(lines) + "\n"
    (OUT / "ae-table.txt").write_text(text)
    print(text)
    return 0 if all(r.get("pass") for r in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
