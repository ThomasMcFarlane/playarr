# Fonts native clients embed

Embed **`NunitoSans-wght-web.ttf`** (UI text) and **`JetBrainsMono[wght].ttf`** (monospace). Do not embed the upstream
full-axis `NunitoSans[YTLC,opsz,wdth,wght].ttf` in this folder: its default axes give slightly different glyph widths
from what the web renders (about 12 px on a settings subtitle).

## Why

The web serves fontsource's wght-only Nunito Sans woff2, which has the other upstream axes baked in. Measured against the
upstream font:

| Axis | Web (baked) | Upstream default |
| --- | --- | --- |
| `wdth` | 100 | 100 |
| `opsz` | 12 | 12 (range 6 to 12) |
| `YTLC` | 500 | 500 |
| `wght` | variable 200 to 1000 | 200 |

so the web instance equals the upstream with `wdth=100 opsz=12 YTLC=500` and the weight axis left free. Checked by
comparing the web woff2 against upstream instances: all 293 glyph advances of the Latin subset are equal at weight 400
and 700, and the outline bounds of `x o e a H` match only at `YTLC=500` (440 and 540 shift the x-height by 50 units).

`NunitoSans-wght-web.ttf` is exactly that instance, made from the upstream file with
`fonttools varLib.instancer "NunitoSans[YTLC,opsz,wdth,wght].ttf" wdth=100 opsz=12 YTLC=500`: one variable TTF with a single
`wght` axis (200 to 1000, default 200) and the full upstream glyph set (1104 glyphs; the web serves the Latin, Latin
Extended, Vietnamese and Cyrillic subsets). Always set the weight explicitly: the font's default weight is 200.

JetBrains Mono has only a `wght` axis (100 to 800, default 400), so the upstream `JetBrainsMono[wght].ttf` is already the
web's instance: advances are equal at 400 and 700 across the 394 glyphs of the web's Latin subset.

Weights the web uses: 100 to 820 in the steps listed in `docs/parity/README.md`; Nunito Sans starts at 200, so 100 renders
as 200.

## Licences

Both families are SIL Open Font License 1.1 (`OFL-NunitoSans.txt`, `OFL-JetBrainsMono.txt`). `NunitoSans-wght-web.ttf` is
a modified (axis-pinned) build of the upstream font, kept under the same licence; it does not use a reserved font name.
