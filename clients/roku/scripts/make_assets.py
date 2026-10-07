#!/usr/bin/env python3
"""Regenerates the Roku channel's theme-tintable UI masks.

Every image written here is a WHITE mask (alpha carries the shape) so the channel can tint it with a theme token through
`blendColor` (see source/Theme.brs). Needs Pillow and rsvg-convert (librsvg). Run from clients/roku:
    python3 scripts/make_assets.py
Nav icons are drawn from the web's NavIcons.tsx paths (24 box, stroke 1.8, round caps) at their web size of 20 px.
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

IMAGES = Path(__file__).resolve().parents[1] / "images"
SS = 8  # supersampling

ICONS = {
    "nav-search": '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
    "nav-home": '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-6h4v6"/>',
    "nav-series": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/><path d="m10 1 2 3 2-3"/>',
    "nav-movies": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 5 2-3M13 5l2-3M19 5l2-3"/>'
    '<path d="m10 10 5 2.5-5 2.5z" fill="white" stroke="none"/>',
    "nav-sites": '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5"/>',
    "nav-music": '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M9 10l10-2"/>',
    "nav-playlists": '<path d="M5 6h10M5 10h10M5 14h6"/><path d="M17 13.5v6"/><path d="m17 13.5 4-1.5v5.5"/><circle cx="15.5" cy="19.5" r="1.5"/><circle cx="19.5" cy="17.5" r="1.5"/>',
    "nav-watchlist": '<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z"/><path d="M12 7.5v5M9.5 10h5"/>',
    "nav-calendar": '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    "player-play": '<path d="M7 4.5v15l13-7.5z" fill="white" stroke="none"/>',
    "player-pause": '<rect x="6" y="4.5" width="4.5" height="15" rx="1" fill="white" stroke="none"/><rect x="13.5" y="4.5" width="4.5" height="15" rx="1" fill="white" stroke="none"/>',
    "player-prev": '<rect x="4.5" y="5" width="2.4" height="14" rx="1" fill="white" stroke="none"/><path d="M19.5 5.5v13L8.2 12z" fill="white" stroke="none"/>',
    "player-next": '<rect x="17.1" y="5" width="2.4" height="14" rx="1" fill="white" stroke="none"/><path d="M4.5 5.5v13L15.8 12z" fill="white" stroke="none"/>',
    "player-subtitles": '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M6.5 12h4M13.5 12h4M6.5 15.5h7M15.5 15.5h2"/>',
    "player-close": '<path d="M6 6l12 12M18 6 6 18"/>',
    "tile-filters": '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    "tile-bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    "arrow-left": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
    "arrow-down": '<path d="M12 5v14M6 13l6 6 6-6"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "check": '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    "icon-empty": '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M6.5 10h8M6.5 13h6M6.5 16h3"/><circle cx="17" cy="8.5" r="1"/>',
}


def icon(name: str, size: int, stroke: float = 1.8) -> None:
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="{size}" height="{size}" fill="none" '
        f'stroke="white" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</svg>'
    )
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "i.svg"
        src.write_text(svg)
        subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(IMAGES / f"{name}.png"), str(src)], check=True)


def rounded(w: int, h: int, r: float, alpha: int = 255, outline: float = 0) -> Image.Image:
    big = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(big)
    d.rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], radius=r * SS, fill=255)
    if outline:
        inner = Image.new("L", big.size, 0)
        di = ImageDraw.Draw(inner)
        o = outline * SS
        di.rounded_rectangle([o, o, w * SS - 1 - o, h * SS - 1 - o], radius=max(r - outline, 0) * SS, fill=255)
        big = Image.composite(Image.new("L", big.size, 0), big, inner)
    mask = big.resize((w, h), Image.LANCZOS).point(lambda v: v * alpha // 255)
    out = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    out.putalpha(mask)
    return out


def nine_patch(name: str, r: int, outline: float = 0) -> None:
    """White rounded-rectangle 9-patch: corners are fixed, the single centre row and column stretch."""
    inner = 2 * r + 1
    body = rounded(inner, inner, r, 255, outline)
    img = Image.new("RGBA", (inner + 2, inner + 2), (0, 0, 0, 0))
    img.paste(body, (1, 1))
    px = img.load()
    px[r + 1, 0] = (0, 0, 0, 255)  # stretch marker, top
    px[0, r + 1] = (0, 0, 0, 255)  # stretch marker, left
    img.save(IMAGES / f"{name}.9.png")


def group(n: int) -> None:
    # Web dock group: 77.5 wide, 73.6 per item plus 5.8 padding; fill is --surface at .56 (token tint, alpha baked).
    h = round(73.6 * n + 5.8)
    rounded(78, h, 22, 143).save(IMAGES / f"nav-group-{n}.png")


def main() -> None:
    for name in ICONS:
        icon(name, 40 if name == "icon-empty" else 20)
    for r in (6, 12, 25):
        nine_patch(f"round-r{r}", r)
        nine_patch(f"round-outline-r{r}", r, 1.2)
    nine_patch("round-r82", 82)
    nine_patch("round-outline-r82", 82, 1.2)
    nine_patch("round-ring-r12", 12, 3)
    nine_patch("round-ring-r25", 25, 3)
    for n in range(1, 5):
        group(n)
    # Page shell: the right-hand panel fades in over 260 px (white ramp, tinted by the panel token).
    ramp = Image.new("RGBA", (260, 4), (255, 255, 255, 0))
    px = ramp.load()
    for x in range(260):
        for y in range(4):
            px[x, y] = (255, 255, 255, round(255 * x / 259))
    ramp.save(IMAGES / "page-fade.png")
    # Scroll edge fades (white alpha ramps, tinted with the page background): opaque at the named edge, clear 96 px in.
    for name, size, fn in (("edge-fade-l", (96, 4), lambda x, y: x), ("edge-fade-r", (96, 4), lambda x, y: 95 - x)):
        img = Image.new("RGBA", size, (255, 255, 255, 0))
        px2 = img.load()
        for yy in range(size[1]):
            for xx in range(size[0]):
                t = 1 - fn(xx, yy) / 95
                px2[xx, yy] = (255, 255, 255, round(255 * max(t, 0) ** 1.4))
        img.save(IMAGES / f"{name}.png")
    for name, fn in (("edge-fade-t", lambda y: y), ("edge-fade-b", lambda y: 95 - y)):
        img = Image.new("RGBA", (4, 96), (255, 255, 255, 0))
        px2 = img.load()
        for yy in range(96):
            for xx in range(4):
                t = 1 - fn(yy) / 95
                px2[xx, yy] = (255, 255, 255, round(255 * max(t, 0) ** 1.4))
        img.save(IMAGES / f"{name}.png")
    # Linear alpha ramps (white, tinted at run time): the web's stage gradients (.tv-key-art::after, .tv-stage-wash) are CSS linear
    # gradients from a token colour to transparent, so a stretched ramp bitmap reproduces them without stepped rectangles.
    for name, size, fn in (
        ("ramp-l", (256, 4), lambda x, y: 255 - x),
        ("ramp-r", (256, 4), lambda x, y: x),
        ("ramp-t", (4, 256), lambda x, y: 255 - y),
        ("ramp-b", (4, 256), lambda x, y: y),
    ):
        ramp_img = Image.new("RGBA", size, (255, 255, 255, 0))
        rpx = ramp_img.load()
        for yy in range(size[1]):
            for xx in range(size[0]):
                rpx[xx, yy] = (255, 255, 255, max(0, min(255, fn(xx, yy))))
        ramp_img.save(IMAGES / f"{name}.png")
    # Media-card shadows (web, pinned in docs/design/page-layout.md section 5): colour rgb(56,38,33) under the 220 x 124 art
    # (radius 12). Focused Home card: 0 26px 52px .32 and 0 11px 22px .22. Resting card: 0 10px 20px .14 and 0 3px 8px .10.
    # A CSS blur radius B is a gaussian of sigma B / 2. The bitmap carries 90 px of room on every side; the y offset is baked in.
    from PIL import ImageFilter
    def card_shadow(name, layers):
        pad = 90
        out = Image.new("RGBA", (220 + 2 * pad, 124 + 2 * pad), (56, 38, 33, 0))
        for dy, blur, alpha in layers:
            layer = Image.new("RGBA", out.size, (56, 38, 33, 0))
            mask = Image.new("L", out.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle((pad, pad + dy, pad + 220, pad + dy + 124), radius=12, fill=round(255 * alpha))
            mask = mask.filter(ImageFilter.GaussianBlur(blur / 2))
            layer.putalpha(mask)
            out = Image.alpha_composite(out, layer)
        out.save(IMAGES / f"{name}.png")
    card_shadow("card-shadow", [(26, 52, 0.32), (11, 22, 0.22)])
    card_shadow("card-shadow-rest", [(10, 20, 0.14), (3, 8, 0.10)])
    # Player scrim (.player-scrim): black fading in from the top of the bottom 48 % to .92 at the bottom edge.
    scrim = Image.new("RGBA", (4, 256), (255, 255, 255, 0))
    spx = scrim.load()
    for y in range(256):
        for x in range(4):
            spx[x, y] = (255, 255, 255, round(255 * y / 255))
    scrim.save(IMAGES / "player-scrim.png")
    # Identity pill (.app-user-identity): 143.5 x 48.2, fully rounded, --surface at .66.
    rounded(144, 48, 24, 168).save(IMAGES / "nav-user-pill.png")
    # Active dock chip: 67.2 square, radius 16, ink at .09 (tinted by blendColor).
    rounded(67, 67, 16, 23).save(IMAGES / "nav-item-active.png")
    # Dock focus chip: the same shape, stronger.
    rounded(67, 67, 16, 46).save(IMAGES / "nav-item-focus.png")


if __name__ == "__main__":
    main()
