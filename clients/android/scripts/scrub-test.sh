#!/usr/bin/env bash
# Scrub/seek efficiency harness for the Playarr Android player.
#
# Usage: scrub-test.sh <adb-serial> <output-dir> [settle-seconds=4] [timeout-seconds=30]
#        scrub-test.sh --selftest   (parser/summary checks against scripts/fixtures; no device)
#
# Precondition: Playarr is already playing a title with the player surface
# focused (controls hidden or shown, but focus NOT on a control button).
# The script only sends key events and reads logcat; it never installs,
# launches or clears anything.
#
# Keys (see PlayarrPlayerChrome / PlayarrMediaSession):
#   DPAD_RIGHT / DPAD_LEFT           +5 s / -5 s per press (player surface)
#   MEDIA_FAST_FORWARD / MEDIA_REWIND +10 s / -10 s per press (media session)
#   There is no chapter-jump key; MEDIA_NEXT/PREVIOUS move the playback queue.
#   Long jumps are therefore bursts of repeated presses. The player coalesces
#   D-pad presses: the seek bar shows the accumulated target immediately and ONE
#   seek is issued after ~500 ms idle, so a burst should yield exactly one seek
#   (steps that do not are flagged). last_key_to_ready_ms is measured from the
#   last key press (device clock) to the seek_ready line, i.e. what a viewer feels.
#
# Telemetry consumed (logcat tag PlayarrPlaybackStats): `event=seek` and
# `event=seek_ready ... seek_to_ready_ms= ...`, plus seek_count, bytes_loaded
# (the data source's received-byte counter) and rebuffer_count on every line.
# Output: <dir>/logcat.txt (live `logcat -v epoch` stream, so nothing is lost to
# the device's small ring buffer), <dir>/results.tsv, <dir>/summary.txt.
# Percentiles cover every seek_ready line logged since the script started.
set -u

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TAG=PlayarrPlaybackStats

# Value of key=value on a log line (empty when absent).
field() { sed -n "s/.*[ ]$2=\([^ ]*\).*/\1/p" <<<"$1"; }

# Epoch seconds at the start of a `logcat -v epoch` line. The epoch column is
# right-aligned with leading spaces, so the old `^[0-9]` anchor never matched.
line_epoch() { sed -n 's/^ *\([0-9][0-9]*\.[0-9]*\).*/\1/p' <<<"$1"; }

# last_key_to_ready_ms <seek_ready line> <device epoch of last key>
last_key_to_ready_ms() {
  local readyt
  readyt=$(line_epoch "$1")
  awk -v a="$readyt" -v b="$2" 'BEGIN { if (a == "" || b !~ /^[0-9]+(\.[0-9]*)?$/) print "NA"; else printf "%d", (a - b) * 1000 + 0.5 }'
}

# Telemetry lines of a captured log, de-duplicated (seed + stream may overlap).
log_events() { tr -d '\r' <"$1" | awk '!seen[$0]++' | grep 'event='; }

# summary_percentiles <log> <not-before epoch>: p50/p95/max over every seek_ready line.
summary_percentiles() {
  log_events "$1" | grep 'event=seek_ready' | awk -v t0="$2" '
    { split($0, a, " "); ts = a[1] + 0; if (ts < t0) next
      if (match($0, /seek_to_ready_ms=[0-9]+/)) print substr($0, RSTART + 17, RLENGTH - 17) }' | sort -n | awk '
    { v[NR] = $1 }
    END {
      if (!NR) { print "no seek_ready lines"; exit }
      p50 = v[int((NR - 1) * 0.50) + 1]; p95 = v[int((NR - 1) * 0.95) + 1]
      printf "seek_to_ready_ms over %d seek_ready lines: p50=%d p95=%d max=%d\n", NR, p50, p95, v[NR]
    }'
}

if [ "${1:-}" = --selftest ]; then
  FIX=${2:-$HERE/fixtures/scrub-logcat-sample.txt}
  fail=0
  check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$3' got '$2'" >&2; fail=1; fi; }
  seek_ready=$(log_events "$FIX" | grep 'event=seek_ready' | head -n 1)
  check "line_epoch parses a right-aligned epoch column" "$(line_epoch "$seek_ready")" "1759500012.500"
  check "last_key_to_ready_ms from device-clock key time" "$(last_key_to_ready_ms "$seek_ready" 1759500010.250)" "2250"
  check "last_key_to_ready_ms is NA for an unusable key time" "$(last_key_to_ready_ms "$seek_ready" '%N')" "NA"
  check "bytes_loaded field" "$(field "$seek_ready" bytes_loaded)" "52428800"
  check "seek_count field" "$(field "$seek_ready" seek_count)" "1"
  check "seek_ready line count" "$(log_events "$FIX" | grep -c 'event=seek_ready')" "10"
  check "percentiles count all 10 seek_ready lines" "$(summary_percentiles "$FIX" 0)" \
    "seek_to_ready_ms over 10 seek_ready lines: p50=2100 p95=2900 max=2900"
  check "percentiles ignore lines before the run started" "$(summary_percentiles "$FIX" 1759500100)" \
    "seek_to_ready_ms over 5 seek_ready lines: p50=2200 p95=2900 max=2900"
  exit $fail
fi

SERIAL=${1:?usage: $0 <adb-serial> <output-dir> [settle-seconds] [timeout-seconds]}
OUT=${2:?usage: $0 <adb-serial> <output-dir> [settle-seconds] [timeout-seconds]}
SETTLE=${3:-4}
TIMEOUT=${4:-30}
mkdir -p "$OUT"
ADB=(adb -s "$SERIAL")

# name:key:presses:gap_seconds
STEPS=(
  "fwd_5s:DPAD_RIGHT:1:0"
  "fwd_10s:MEDIA_FAST_FORWARD:1:0"
  "back_5s:DPAD_LEFT:1:0"
  "fwd_30s_burst:DPAD_RIGHT:6:0.05"
  "back_30s_burst:DPAD_LEFT:6:0.05"
  "fwd_120s_burst:DPAD_RIGHT:24:0.05"
  "back_60s_burst:DPAD_LEFT:12:0.05"
  "fwd_300s_burst:DPAD_RIGHT:60:0.03"
  "back_300s_burst:DPAD_LEFT:60:0.03"
  "rapid_alternate:DPAD_RIGHT:1:0"
)

LOG="$OUT/logcat.txt"
stats() { log_events "$LOG"; }

# Device clock in epoch seconds with sub-second digits (toybox date lacks %N on some builds).
device_now() {
  local t
  t=$("${ADB[@]}" shell date +%s.%N 2>/dev/null | tr -d '\r')
  if [[ $t =~ ^[0-9]+\.[0-9]+$ ]]; then echo "$t"; else "${ADB[@]}" shell date +%s 2>/dev/null | tr -d '\r'; fi
}

"${ADB[@]}" get-state >/dev/null 2>&1 || { echo "device $SERIAL not reachable" >&2; exit 2; }
# Stream the log for the whole run: a late `logcat -d` loses early lines when the ring buffer wraps.
: >"$LOG"
"${ADB[@]}" logcat -v epoch -s "$TAG:I" >>"$LOG" 2>/dev/null &
LOGPID=$!
trap 'kill $LOGPID 2>/dev/null' EXIT
for _ in 1 2 3 4 5 6 7 8; do [ -n "$(stats | tail -n 1)" ] && break; sleep 0.5; done
if [ -z "$(stats | tail -n 1)" ]; then echo "no $TAG lines yet: is the player playing?" >&2; exit 2; fi
T0=$(device_now)

press() { "${ADB[@]}" shell input keyevent "KEYCODE_$1" >/dev/null; }

RESULTS="$OUT/results.tsv"
printf 'step\tpresses\tseeks\tlast_key_to_ready_ms\tseek_to_ready_ms\tbytes_to_ready\tbytes_settled\trebuffers\tstatus\n' >"$RESULTS"

for entry in "${STEPS[@]}"; do
  IFS=: read -r name key presses gap <<<"$entry"
  base=$(stats | tail -n 1)
  s0=$(field "$base" seek_count); s0=${s0:-0}
  b0=$(field "$base" bytes_loaded); b0=${b0:-0}
  r0=$(field "$(stats | grep rebuffer_count= | tail -n 1)" rebuffer_count); r0=${r0:-0}
  if [ "$name" = rapid_alternate ]; then
    for _ in 1 2 3 4 5; do press DPAD_RIGHT; press DPAD_LEFT; done
    presses=10
  else
    for ((i = 0; i < presses; i++)); do press "$key"; [ "$gap" != 0 ] && sleep "$gap"; done
  fi
  keyt=$(device_now)
  want=$((s0 + 1))
  status=timeout; lastkey_ms=NA; ready_ms=NA; bytes_ready=NA; seeks=NA
  end=$((SECONDS + TIMEOUT))
  while [ $SECONDS -lt $end ]; do
    all=$(stats)
    lastseek=$(grep -n 'event=seek ' <<<"$all" | tail -n 1 | cut -d: -f2-)
    cnt=$(field "$lastseek" seek_count)
    if [ -n "$cnt" ] && [ "$cnt" -gt "$s0" ]; then
      rl=$(grep 'event=seek_ready' <<<"$all" | tail -n 1)
      rc=$(field "$rl" seek_count)
      if [ -n "$rc" ] && [ "$rc" -eq "$cnt" ]; then
        status=ok
        [ "$cnt" -gt "$want" ] && status="ok(not_coalesced:$((cnt - s0))_seeks)"
        lastkey_ms=$(last_key_to_ready_ms "$rl" "$keyt")
        ready_ms=$(field "$rl" seek_to_ready_ms)
        bytes_ready=$(( $(field "$rl" bytes_loaded || true) + 0 - b0 ))
        seeks=$((cnt - s0))
        break
      fi
    fi
    sleep 0.25
  done
  sleep "$SETTLE"
  end_line=$(stats | tail -n 1)
  bytes_settled=$(( $(field "$end_line" bytes_loaded) - b0 ))
  r1=$(field "$(stats | grep rebuffer_count= | tail -n 1)" rebuffer_count); r1=${r1:-0}
  rebuf=$((r1 - r0))
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$presses" "$seeks" "$lastkey_ms" "$ready_ms" \
    "$bytes_ready" "$bytes_settled" "$rebuf" "$status" >>"$RESULTS"
done

sleep 1
kill "$LOGPID" 2>/dev/null; wait "$LOGPID" 2>/dev/null

{
  echo "Scrub summary ($SERIAL)"
  column -t -s "$(printf '\t')" "$RESULTS"
  echo
  # Per-seek latencies straight from every seek_ready line captured since the run started.
  summary_percentiles "$LOG" "$T0"
  awk -F'\t' 'NR > 1 && $4 ~ /^[0-9]+$/ { v[++n] = $4 + 0 } END { if (!n) exit; for (i = 1; i <= n; i++) for (j = i + 1; j <= n; j++) if (v[j] < v[i]) { t = v[i]; v[i] = v[j]; v[j] = t }
    printf "last_key_to_ready_ms over %d steps: p50=%d p95=%d max=%d\n", n, v[int((n - 1) * 0.5) + 1], v[int((n - 1) * 0.95) + 1], v[n] }' "$RESULTS"
  awk -F'\t' 'NR > 1 && $8 ~ /^[0-9]+$/ { r += $8 } END { printf "rebuffers after seeks (excluding seek stalls): %d\n", r }' "$RESULTS"
  awk -F'\t' 'NR > 1 && $7 ~ /^-?[0-9]+$/ { b += $7 } END { printf "total bytes_loaded across steps: %d (%.1f MiB)\n", b, b / 1048576 }' "$RESULTS"
} | tee "$OUT/summary.txt"
