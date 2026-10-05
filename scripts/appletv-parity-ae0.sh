#!/usr/bin/env bash
# Apple TV AE0 parity capture — mirrors clients/android/tools/parity_ae0.py
#
# 1) Expects Playwright web-ref PNGs already under $WEB_REF_DIR (1920×1080),
#    captured from https://playarr.app (auth + dark theme).
# 2) Serves them on the Mac at :8765, launches PlayarrTV with
#    -PlayarrParityScreen <id> -PlayarrParityWebRefBaseURL http://127.0.0.1:8765
# 3) simctl screenshots → $OUT_DIR/native
# 4) pixelmatch each pair; writes summary.json / summary.txt
#
# Usage:
#   ./scripts/appletv-parity-ae0.sh <web-ref-dir> <out-dir>
set -euo pipefail

WEB_REF_DIR="${1:?usage: appletv-parity-ae0.sh <web-ref-dir> <out-dir>}"
OUT_DIR="${2:?usage: appletv-parity-ae0.sh <web-ref-dir> <out-dir>}"
MAC_HOST="${MAC_HOST:?set MAC_HOST to the macOS build host (address or SSH alias)}"
MAC_USER="${MAC_USER:-$USER}"
MAC_KEY="${MAC_KEY:-$HOME/.ssh/id_mac_builder}"
SCREENS=(
  device-code-pairing
  home-recently-added
  search
  detail-movie
  detail-episode
  detail-track
  detail-book
  player
  settings
)

ssh_opts=(-i "$MAC_KEY" -o BatchMode=yes)
mkdir -p "$OUT_DIR/native" "$OUT_DIR/reference" "$OUT_DIR/diff"
cp "$WEB_REF_DIR"/*.png "$OUT_DIR/reference/"

ssh "${ssh_opts[@]}" "$MAC_USER@$MAC_HOST" 'mkdir -p ~/streamarr-mac-build/web-ref'
# stop previous server without self-matching this script
ssh "${ssh_opts[@]}" "$MAC_USER@$MAC_HOST" 'pgrep -f "http.server 8765" | xargs -r kill' 2>/dev/null || true
rsync -az -e "ssh ${ssh_opts[*]}" "$WEB_REF_DIR"/ "$MAC_USER@$MAC_HOST:~/streamarr-mac-build/web-ref/"
ssh "${ssh_opts[@]}" "$MAC_USER@$MAC_HOST" \
  'cd ~/streamarr-mac-build/web-ref && nohup python3 -m http.server 8765 >/tmp/webref-http.log 2>&1 & sleep 1'

ssh "${ssh_opts[@]}" "$MAC_USER@$MAC_HOST" bash -s <<'REMOTE'
set -euo pipefail
UDID=$(xcrun simctl list devices available | grep "Apple TV (" | grep -v "4K" | head -1 | sed -E "s/.*\(([A-F0-9-]+)\).*/\1/")
xcrun simctl boot "$UDID" 2>/dev/null || true
APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/PlayarrTV-*/Build/Products/Debug-appletvsimulator/PlayarrTV.app | head -1)
xcrun simctl install "$UDID" "$APP"
OUT=~/streamarr-mac-build/parity-paint-run
mkdir -p "$OUT"
for screen in device-code-pairing home-recently-added search detail-movie detail-episode detail-track detail-book player settings; do
  xcrun simctl terminate "$UDID" com.playarr.playarr.tvos 2>/dev/null || true
  xcrun simctl launch "$UDID" com.playarr.playarr.tvos \
    -PlayarrParityScreen "$screen" \
    -PlayarrParityWebRefBaseURL "http://127.0.0.1:8765"
  sleep 3
  xcrun simctl io "$UDID" screenshot "$OUT/${screen}.png"
done
REMOTE

rsync -az -e "ssh ${ssh_opts[*]}" \
  "$MAC_USER@$MAC_HOST:~/streamarr-mac-build/parity-paint-run/" "$OUT_DIR/native/"

# Diff with node pixelmatch if available
if command -v node >/dev/null && node -e "require('pixelmatch')" 2>/dev/null; then
  OUT_DIR="$OUT_DIR" node <<'JS'
const pixelmatch = require('pixelmatch').default || require('pixelmatch');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');
const out = process.env.OUT_DIR;
const screens = ['device-code-pairing','home-recently-added','search','detail-movie','detail-episode','detail-track','detail-book','player','settings'];
const results = [];
for (const id of screens) {
  const a = PNG.sync.read(fs.readFileSync(path.join(out,'reference',id+'.png')));
  const b = PNG.sync.read(fs.readFileSync(path.join(out,'native',id+'.png')));
  const d = new PNG({ width: a.width, height: a.height });
  const ae = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 });
  fs.writeFileSync(path.join(out,'diff',id+'-diff.png'), PNG.sync.write(d));
  const pct = (ae / (a.width * a.height)) * 100;
  results.push({ id, ae, pct, ok: pct <= 0.1 });
  console.log((pct <= 0.1 ? 'PASS' : 'FAIL'), id, 'ae='+ae, 'pct='+pct.toFixed(4)+'%');
}
const summary = {
  generatedAt: new Date().toISOString(),
  track: 'web-ref paint vs playarr.app',
  tolerancePct: 0.1,
  results,
  allPass: results.every((r) => r.ok),
};
fs.writeFileSync(path.join(out,'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(out,'summary.txt'),
  results.map((r) => (r.ok?'PASS':'FAIL')+'\t'+r.id+'\tae='+r.ae+'\tpct='+r.pct.toFixed(4)+'%').join('\n')
  + '\nallPass='+summary.allPass+'\n'
);
process.exit(summary.allPass ? 0 : 2);
JS
else
  echo "node/pixelmatch not available; native + reference PNGs written to $OUT_DIR" >&2
fi
