#!/usr/bin/env python3
"""Build the app's embedded font collections from the web's font builds (docs/parity/fonts).

UWP XAML does not pick weights from the variable web fonts (it fell back to Segoe UI), so the app embeds static
instances packed into one .ttc per family; FontWeight then selects the face from a single ms-appx URI.
Usage (needs fonttools): python3 clients/xbox/tools/make-fonts.py   (run from the repository root)
"""
from fontTools.ttLib import TTFont, TTCollection
from fontTools.varLib import instancer

SRC = "docs/parity/fonts"
OUT = "clients/xbox/src/Playarr.Xbox/Assets/Fonts"
FAMILIES = {
    "Nunito Sans": ("NunitoSans-wght-web.ttf", "NunitoSans.ttc", ((400, "Regular"), (600, "SemiBold"), (700, "Bold"), (800, "ExtraBold"))),
    "JetBrains Mono": ("JetBrainsMono[wght].ttf", "JetBrainsMono.ttc", ((400, "Regular"), (600, "SemiBold"))),
}

for family, (src, out, weights) in FAMILIES.items():
    fonts = []
    for weight, sub in weights:
        font = instancer.instantiateVariableFont(TTFont(f"{SRC}/{src}"), {"wght": weight}, updateFontNames=False)
        names = font["name"]
        for rec in list(names.names):
            if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
                names.removeNames(nameID=rec.nameID)
        ribbi = sub in ("Regular", "Bold")
        for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0)):
            names.setName(family if ribbi else f"{family} {sub}", 1, pid, eid, lid)
            names.setName(sub if ribbi else "Regular", 2, pid, eid, lid)
            names.setName(f"{family} {sub};web-instance", 3, pid, eid, lid)
            names.setName(f"{family} {sub}", 4, pid, eid, lid)
            names.setName(f"{family.replace(' ', '')}-{sub}", 6, pid, eid, lid)
            names.setName(family, 16, pid, eid, lid)
            names.setName(sub, 17, pid, eid, lid)
        os2 = font["OS/2"]
        os2.usWeightClass = weight
        os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b100000 if sub == "Bold" else 0b1000000)
        font["head"].macStyle = 1 if sub == "Bold" else 0
        if "STAT" in font:
            del font["STAT"]
        fonts.append(font)
    collection = TTCollection()
    collection.fonts = fonts
    collection.save(f"{OUT}/{out}")
    print("wrote", out)
