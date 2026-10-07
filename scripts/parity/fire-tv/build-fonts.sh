#!/usr/bin/env bash
# Builds the static font instances the Fire TV (Vega) client embeds, from the shared parity fonts in docs/parity/fonts.
#
# Vega's React Native text stack loads a font file by its file name and ignores `fontWeight` for a variable font (every
# weight of a variable TTF renders at the font's default weight, 200 for NunitoSans-wght-web), so the client ships one
# static instance per weight the web uses and picks the file with src/theme/fonts.ts.
#
#   build-fonts.sh [python-with-fonttools]
#
# Needs fonttools (`python3 -m venv v && v/bin/pip install fonttools brotli`). Output: clients/fire-tv/assets/fonts/
# (committed; re-run after changing the weight list below or the source fonts, and keep src/theme/fonts.ts in step).
set -euo pipefail
py=${1:-python3}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
src="$root/docs/parity/fonts"
out="$root/clients/fire-tv/assets/fonts"
mkdir -p "$out"
rm -f "$out"/*.ttf
# Latin, Latin-1, Latin Extended-A/B, general punctuation, arrows, currency, letterlike, geometric shapes, dingbats.
unicodes='U+0020-007E,U+00A0-024F,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+25A0-25FF,U+2713,U+2714,U+2715,U+2605,U+2606'
for w in 300 400 480 560 610 640 680 720 760 820 900; do
  "$py" -m fontTools.varLib.instancer "$src/NunitoSans-wght-web.ttf" wght=$w -q -o "$out/.tmp.ttf"
  "$py" -m fontTools.subset "$out/.tmp.ttf" --unicodes="$unicodes" --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk' --output-file="$out/NunitoSans-w$w.ttf"
done
for w in 400 700; do
  "$py" -m fontTools.varLib.instancer "$src/JetBrainsMono[wght].ttf" wght=$w -q -o "$out/.tmp.ttf"
  "$py" -m fontTools.subset "$out/.tmp.ttf" --unicodes="$unicodes" --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk' --output-file="$out/JetBrainsMono-w$w.ttf"
done
rm -f "$out/.tmp.ttf"
ls -l "$out"
