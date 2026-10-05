#!/usr/bin/env bash
#
# scripts/live-events-smoke.sh
#
# Measures cross-device live update latency (docs/architecture/live-events.md,
# TASKS row 275). Two throw-away devices of one test account: device B holds
# GET /api/v1/events open; device A reports a watched state for a media file and
# the script times POST -> `watch` frame on B. The progress row is restored to
# its previous state afterwards.
#
# Usage: scripts/live-events-smoke.sh https://server:port
# Credentials: TEST_USERNAME / TEST_PASSWORD must be exported explicitly in the
# environment (no env file is read); never printed. Optional: MEDIA_FILE_ID, BUDGET_MS (1000).
set -euo pipefail
SERVER="${1:-${TEST_SERVER:-}}"
[[ -n "$SERVER" && -n "${TEST_USERNAME:-}" && -n "${TEST_PASSWORD:-}" ]] || { echo "usage: $0 https://server:port" >&2; exit 2; }
export SERVER
exec python3 - <<'PY'
import json, os, sys, threading, time, uuid, queue
import http.client, urllib.parse

SERVER = os.environ["SERVER"].rstrip("/")
BUDGET = float(os.environ.get("BUDGET_MS", "1000"))
u = urllib.parse.urlparse(SERVER)
Conn = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection

def call(method, path, token=None, body=None):
    c = Conn(u.hostname, u.port, timeout=40)
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    c.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
    r = c.getresponse(); raw = r.read(); c.close()
    try: return r.status, json.loads(raw) if raw else None
    except ValueError: return r.status, None

def login(name):
    s, l = call("POST", "/api/v1/auth/login", body={
        "username": os.environ["TEST_USERNAME"], "password": os.environ["TEST_PASSWORD"],
        "device_id": str(uuid.uuid4()), "device_name": name, "client_platform": "web", "client_version": "smoke"})
    if s != 200: sys.exit(f"login failed: HTTP {s}")
    return l["access_token"]

a, b = login("smoke-A"), login("smoke-B")
q = queue.Queue()
def listen():
    c = Conn(u.hostname, u.port, timeout=60)
    c.request("GET", "/api/v1/events", headers={"Authorization": "Bearer " + b})
    r = c.getresponse()
    q.put(("status", r.status, r.getheader("Content-Type")))
    if r.status != 200: return
    ev = None
    while True:
        line = r.fp.readline()
        if not line: return
        line = line.decode().rstrip("\r\n")
        if line.startswith("event:"): ev = line[6:].strip()
        elif line.startswith("data:"): q.put((ev, time.perf_counter() * 1000, line[5:].strip()))
threading.Thread(target=listen, daemon=True).start()
st = q.get(timeout=20)
if st[1] != 200 or "text/event-stream" not in (st[2] or ""): sys.exit(f"stream unavailable: {st}")
assert q.get(timeout=10)[0] == "ready"

mf = os.environ.get("MEDIA_FILE_ID")
if not mf:
    s, cat = call("GET", "/api/v1/catalog?kind=movie&limit=1", a)
    wid = (cat.get("items") or cat.get("results") or cat)[0]["id"]
    s, w = call("GET", f"/api/v1/catalog/{wid}", a)
    mf = (w.get("media_files") or [{}])[0].get("id") or w.get("media_file_id")
if not mf: sys.exit("set MEDIA_FILE_ID")
s, prev = call("GET", f"/api/v1/playback/{mf}/progress", a)
times = []
for i in range(5):
    watched = i % 2 == 0
    t0 = time.perf_counter() * 1000
    s, _ = call("PUT", f"/api/v1/playback/{mf}/progress", a,
                {"position_ms": 3_000_000 if watched else 1000 * (i + 1), "duration_ms": 3_000_000, "completed": watched})
    if s != 200: sys.exit(f"progress PUT HTTP {s}")
    ev, t1, data = q.get(timeout=10)
    assert ev == "change" and json.loads(data)["type"] == "watch", (ev, data)
    times.append(t1 - t0); print(f"POST -> frame {t1 - t0:.0f} ms ({json.loads(data)['changed']})")
    time.sleep(0.1)
if prev and prev.get("position_ms") is not None:
    call("PUT", f"/api/v1/playback/{mf}/progress", a, {"position_ms": prev["position_ms"], "duration_ms": prev.get("duration_ms", 0), "completed": prev.get("state") == "watched"})
print(f"max {max(times):.0f} ms, budget {BUDGET:.0f} ms")
sys.exit(0 if max(times) <= BUDGET else 1)
PY
