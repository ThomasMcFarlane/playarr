#!/usr/bin/env python3
"""Mask the Android system bars so they do not count in the parity diff.

The status bar (top 72 px) and the gesture navigation bar (bottom 72 px) are drawn by the OS,
not by Playarr, and the web reference has none. For every candidate PNG this copies those two
bands from the web reference, so both images are identical there. Usage:
  mask.py <ref-dir> <raw-cand-dir> <out-dir> [theme]   (each holds <screen-id>.png; out gets mobile/<id>.png, or
  mobile/<theme>/<id>.png when a theme is given, the layout diff.mjs reads)
"""
import os, sys
from PIL import Image

TOP, BOTTOM = 72, 72

# The decoded video frame is an agreed platform difference (Chromium and Android's MediaCodec convert the clip's YUV with
# different matrices), so on the player screens the 16:9 video rectangle is copied from the reference as well.
VIDEO = (0, 937, 1170, 1595)
VIDEO_SCREENS = {"player-controls.png", "player-quality-menu.png"}

def main(ref, cand, out, theme=None):
    dest = f"{out}/mobile/{theme}" if theme else f"{out}/mobile"
    os.makedirs(dest, exist_ok=True)
    for name in sorted(os.listdir(cand)):
        if not name.endswith(".png"):
            continue
        c = Image.open(f"{cand}/{name}").convert("RGB")
        rp = f"{ref}/{name}"
        if os.path.exists(rp):
            r = Image.open(rp).convert("RGB")
            if r.size == c.size:
                c.paste(r.crop((0, 0, c.width, TOP)), (0, 0))
                c.paste(r.crop((0, c.height - BOTTOM, c.width, c.height)), (0, c.height - BOTTOM))
                if name in VIDEO_SCREENS:
                    c.paste(r.crop(VIDEO), VIDEO[:2])
        c.save(f"{dest}/{name}", optimize=True)

if __name__ == "__main__":
    main(*sys.argv[1:5])
