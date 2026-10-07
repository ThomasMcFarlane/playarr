#!/usr/bin/env bash
# Downloads the openly licensed Blender films (CC BY) from Wikimedia Commons and download.blender.org into
# the showcase media tree, re-encodes small copies, embeds chapters and derives missing artwork.
# Credits for every film are in the README "Third-party media" section.
#
#   scripts/showcase/fetch-media.sh        # idempotent; PLAYARR_SHOWCASE_MEDIA chooses the tree
#
# Layout produced: raw/ (downloads), library/movies/<Title (Year)>/<Title (Year)>.mp4,
# library/tv/Caminandes/Season 01/..., art/<slug>-poster.jpg and <slug>-backdrop.jpg.
# Official project posters can be dropped into art/ beforehand; the script never overwrites existing art.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
RAW="${SC_MEDIA}/raw"; LIB="${SC_MEDIA}/library"; ART="${SC_MEDIA}/art"
mkdir -p "${RAW}" "${LIB}/movies" "${LIB}/tv/Caminandes/Season 01" "${ART}"
UA="playarr-showcase/1.0 (screenshots)"
T=https://upload.wikimedia.org/wikipedia/commons/transcoded
get() { # name url
  [[ -s "${RAW}/$1" ]] && return
  curl -sSL -A "${UA}" -o "${RAW}/$1.part" "$2" && mv "${RAW}/$1.part" "${RAW}/$1"; sleep 5
}
get bbb.480p.webm "$T/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.480p.vp9.webm"
get sintel.1080p.webm "$T/f/f1/Sintel_movie_4K.webm/Sintel_movie_4K.webm.1080p.vp9.webm"
get tos.480p.webm "$T/c/cb/Tears_of_Steel_1080p.webm/Tears_of_Steel_1080p.webm.480p.vp9.webm"
get ed.480p.webm "$T/a/a2/Elephants_Dream_%282006%29.webm/Elephants_Dream_%282006%29.webm.480p.vp9.webm"
get spring.480p.webm "$T/a/a5/Spring_-_Blender_Open_Movie.webm/Spring_-_Blender_Open_Movie.webm.480p.vp9.webm"
get sprite.480p.webm "$T/7/74/Sprite_Fright_-_Open_Movie_by_Blender_Studio.webm/Sprite_Fright_-_Open_Movie_by_Blender_Studio.webm.480p.vp9.webm"
get charge.480p.webm "$T/7/7a/Charge_-_Blender_Open_Movie-full_movie.webm/Charge_-_Blender_Open_Movie-full_movie.webm.480p.vp9.webm"
get cam1.1080p.webm "$T/d/d0/Caminandes-_Llama_Drama_-_Short_Movie.ogv/Caminandes-_Llama_Drama_-_Short_Movie.ogv.1080p.vp9.webm"
get cam3.1080p.webm "$T/a/ab/Caminandes_3_-_Llamigos_-_Blender_Animated_Short.webm/Caminandes_3_-_Llamigos_-_Blender_Animated_Short.webm.1080p.vp9.webm"
get cam2.mp4.zip https://download.blender.org/demo/movies/caminandes_gran_dillama.mp4.zip
[[ -s "${RAW}/cam2.mp4" ]] || unzip -oqj "${RAW}/cam2.mp4.zip" -d "${RAW}/cam2" && true

enc() { # input outfile height seek
  local out="$2"; [[ -s "${out}" ]] && return; mkdir -p "$(dirname "${out}")"
  sc_ffmpeg -y -loglevel error -ss "${4:-9}" -i "$1" -vf "scale=-2:$3" -c:v libx264 -preset fast -crf 24 \
    -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "${out}"
}
m() { echo "${LIB}/movies/$1/$1.mp4"; }
enc "${RAW}/bbb.480p.webm" "$(m 'Big Buck Bunny (2008)')" 480
enc "${RAW}/sintel.1080p.webm" "$(m 'Sintel (2010)')" 720
enc "${RAW}/tos.480p.webm" "$(m 'Tears of Steel (2012)')" 480
enc "${RAW}/ed.480p.webm" "$(m 'Elephants Dream (2006)')" 480
enc "${RAW}/spring.480p.webm" "$(m 'Spring (2019)')" 480
enc "${RAW}/sprite.480p.webm" "$(m 'Sprite Fright (2021)')" 480
enc "${RAW}/charge.480p.webm" "$(m 'Charge (2022)')" 480
C="${LIB}/tv/Caminandes/Season 01"
enc "${RAW}/cam1.1080p.webm" "${C}/Caminandes - S01E01 - Llama Drama.mp4" 480 0
enc "$(ls "${RAW}"/cam2/*.mp4 | head -1)" "${C}/Caminandes - S01E02 - Gran Dillama.mp4" 480 0
enc "${RAW}/cam3.1080p.webm" "${C}/Caminandes - S01E03 - Llamigos.mp4" 480 0

# Artwork fallback: a backdrop is a frame, a poster is a centred 2:3 crop of it.
art() { # slug source
  [[ -s "${ART}/$1-backdrop.jpg" ]] || sc_ffmpeg -y -loglevel error -ss 40 -i "$2" -frames:v 1 -vf "scale=1280:-2" "${ART}/$1-backdrop.jpg"
  [[ -s "${ART}/$1-poster.jpg" ]] || sc_ffmpeg -y -loglevel error -ss 40 -i "$2" -frames:v 1 -vf "crop=ih*2/3:ih,scale=500:750" "${ART}/$1-poster.jpg"
}
art bbb "$(m 'Big Buck Bunny (2008)')"; art sintel "$(m 'Sintel (2010)')"; art tos "$(m 'Tears of Steel (2012)')"
art ed "$(m 'Elephants Dream (2006)')"; art spring "$(m 'Spring (2019)')"; art sprite "$(m 'Sprite Fright (2021)')"
art charge "$(m 'Charge (2022)')"; art cam "${C}/Caminandes - S01E01 - Llama Drama.mp4"
for n in 1 2 3; do
  f=$(ls "${C}"/*S01E0${n}*.mp4)
  [[ -s "${ART}/cam-ep${n}-still.jpg" ]] || sc_ffmpeg -y -loglevel error -ss 20 -i "${f}" -frames:v 1 -vf "scale=640:-2" "${ART}/cam-ep${n}-still.jpg"
done

# Four chapter markers per movie (stream copy).
for f in "${LIB}"/movies/*/*.mp4; do
  [[ "$(sc_ffprobe -v error -show_chapters -of csv=p=0 "${f}" | wc -l)" -gt 0 ]] && continue
  dur=$(sc_ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}")
  meta="${SC_MEDIA}/chapters.txt"
  python3 - "${dur}" >"${meta}" <<'PY'
import sys
d = float(sys.argv[1]); pts = [12, d * .28, d * .5, d * .72]; ends = pts[1:] + [d]
print(";FFMETADATA1")
for i, (s, e) in enumerate(zip(pts, ends), 1):
    print(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={int(s*1000)}\nEND={int(e*1000)}\ntitle=Chapter {i}")
PY
  sc_ffmpeg -y -loglevel error -i "${f}" -i "${meta}" -map 0 -map_metadata 1 -map_chapters 1 -c copy -movflags +faststart "${f}.chap.mp4" && mv "${f}.chap.mp4" "${f}"
done
echo "media ready in ${SC_MEDIA}"
