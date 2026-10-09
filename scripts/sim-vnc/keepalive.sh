#!/usr/bin/env bash
# Keeps the live simulator session healthy until a deadline (used by .github/workflows/tvos-live-sim.yml).
# Every 30 s it restarts what died (VNC server, idb companion, the simulator and the app) and checks the tailnet node;
# every 5 min it logs a heartbeat with the runner load. A final failure is written to the job summary.
# env: SIM_UDID IDB APP_BUNDLE_ID VNC_PORT TS_IP DEADLINE (epoch s) RUNNER_TEMP JOB_START PLAYARR_VNC_PASSWORD
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
vnc_log="$RUNNER_TEMP/sim-vnc.log"
restarts=0

say() { echo "$(date -u +%H:%M:%S) keepalive: $*"; }
summary() { [[ -z "${GITHUB_STEP_SUMMARY:-}" ]] || echo "$*" >> "$GITHUB_STEP_SUMMARY"; }
alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

start_companion() {
  nohup nice -n 5 idb_companion --udid "$SIM_UDID" --grpc-port 10880 >> "$RUNNER_TEMP/idb-companion.log" 2>&1 &
  echo $! > "$RUNNER_TEMP/idb-companion.pid"
  sleep 5
  "$IDB" connect localhost 10880 >/dev/null 2>&1 || true
}

start_vnc() {
  rm -f "$RUNNER_TEMP/vnc.ready"
  nohup nice -n 5 python3 "$here/sim_vnc.py" --udid "$SIM_UDID" --bind "$TS_IP" --port "$VNC_PORT" --idb "$IDB" --fps 24 \
    --metrics-file "$RUNNER_TEMP/health.txt" --ready-file "$RUNNER_TEMP/vnc.ready" >> "$vnc_log" 2>&1 &
  echo $! > "$RUNNER_TEMP/sim-vnc.pid"
  for _ in $(seq 1 60); do [[ -s "$RUNNER_TEMP/vnc.ready" ]] && return 0; sleep 1; done
  return 1
}

simulator_booted() { xcrun simctl list devices booted 2>/dev/null | grep -q "$SIM_UDID"; }

recover_simulator() {
  say "the simulator is not booted: booting it again"
  xcrun simctl boot "$SIM_UDID" 2>/dev/null
  xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1
  xcrun simctl launch "$SIM_UDID" "$APP_BUNDLE_ID" -PlayarrTheme dark >/dev/null 2>&1
  kill "$(cat "$RUNNER_TEMP/idb-companion.pid" 2>/dev/null)" 2>/dev/null
  start_companion
  kill "$(cat "$RUNNER_TEMP/sim-vnc.pid" 2>/dev/null)" 2>/dev/null
  start_vnc
}

# One snapshot of runner health, served at port+1 by the VNC server so it can be read from outside while the job runs.
snapshot() {
  {
    echo "time $(date -u +%FT%TZ) job_age_s=$(( $(date +%s) - JOB_START ))"
    echo "load $(sysctl -n vm.loadavg | tr -d '{}')"
    vm_stat | awk '/page size/ {ps=$8} /^Pages (free|active|inactive|wired down)|occupied by compressor/ {l=$0; sub(/:.*/,"",l); v=$NF; gsub(/\./,"",v); printf "mem %s=%dMB\n", l, v*ps/1048576}'
    echo "swap $(sysctl -n vm.swapusage)"
    echo "disk $(df -h / | awk 'NR==2 {print $4" free"}')"
    echo "top cpu:"; ps -Ao pcpu,pmem,rss,comm -r | sed -n 2,6p
    echo "top mem:"; ps -Ao pcpu,pmem,rss,comm -m | sed -n 2,6p
  } > "$RUNNER_TEMP/health.tmp" 2>/dev/null
  mv "$RUNNER_TEMP/health.tmp" "$RUNNER_TEMP/health.txt"
}

heartbeat() {
  say "heartbeat load=$(sysctl -n vm.loadavg | tr -d '{}') free_pages=$(vm_stat | awk '/Pages free/ {print $3}') vnc=$(tail -n 1 "$vnc_log" | cut -c1-120)"
  ps -Ao pcpu,pmem,comm -r | sed -n 2,4p | sed 's/^/  top: /'
}

fail() { say "FAILED: $*"; summary "### The live simulator stopped early"; summary ""; summary "- $*"; tail -n 20 "$vnc_log"; exit 1; }

last_heartbeat=0
while (( $(date +%s) < DEADLINE )); do
  now=$(date +%s)
  if ! simulator_booted; then
    (( restarts += 1 )); (( restarts <= 10 )) || fail "the simulator kept stopping (10 restarts)"
    recover_simulator
  fi
  if ! alive "$RUNNER_TEMP/idb-companion.pid"; then say "the idb companion died: restarting it"; start_companion; fi
  if ! alive "$RUNNER_TEMP/sim-vnc.pid"; then
    (( restarts += 1 )); (( restarts <= 10 )) || fail "the VNC server kept stopping (10 restarts)"
    say "the VNC server died: restarting it"; tail -n 5 "$vnc_log"
    start_vnc || say "the VNC server did not become ready"
  fi
  if ! tailscale status --json 2>/dev/null | grep -q '"Online": *true'; then
    say "the tailnet node looks offline: asking tailscale to reconnect"
    sudo tailscale up --timeout 30s >/dev/null 2>&1 || true
  fi
  snapshot
  if (( now - last_heartbeat >= 300 )); then heartbeat; last_heartbeat=$now; fi
  sleep 30
done
say "time is up"
