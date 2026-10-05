#!/usr/bin/env bash
#
# scripts/remote-control-smoke.sh
#
# End-to-end smoke test and latency measurement for the phone remote and
# playback handoff (docs/architecture/remote-control.md, TASKS rows 53, 175).
# It plays both roles with two throw-away devices of one test account:
#
#   * "TV"    registers as a target and receives commands over the SSE push
#             stream (and, separately, over the long poll for comparison);
#   * "phone" pairs, sends navigation commands and starts a handoff.
#
# It measures, per transport, the time from the phone's command POST to the
# TV receiving it, and the handoff offer delivery and commit times (the
# destination acknowledges at once, so the commit number is the server and
# network share of the 5 s budget; real playback start time is measured on a
# device and recorded separately).
#
# Usage:
#   scripts/remote-control-smoke.sh [https://server:port]
#
# Credentials must be exported explicitly in the environment (TEST_SERVER,
# TEST_USERNAME, TEST_PASSWORD); no env file is read and they are never printed.
# Optional: SMOKE_COMMANDS (default 10), COMMAND_P95_MS (300), HANDOFF_MS (5000),
# MEDIA_FILE_ID (otherwise the first movie in the catalogue is used).
# Exit status is non-zero when a budget is exceeded or a step fails.

set -euo pipefail

SERVER="${1:-${TEST_SERVER:-}}"
if [[ -z "$SERVER" || -z "${TEST_USERNAME:-}" || -z "${TEST_PASSWORD:-}" ]]; then
  echo "usage: $0 https://server:port (with TEST_USERNAME/TEST_PASSWORD set)" >&2
  exit 2
fi
export SERVER

exec python3 - <<'PY'
import json, os, queue, statistics, sys, threading, time, uuid
import http.client, urllib.error, urllib.parse, urllib.request

SERVER = os.environ["SERVER"].rstrip("/")
N = int(os.environ.get("SMOKE_COMMANDS", "10"))
P95_BUDGET = float(os.environ.get("COMMAND_P95_MS", "300"))
HANDOFF_BUDGET = float(os.environ.get("HANDOFF_MS", "5000"))
failures = []


def ms():
    return time.perf_counter() * 1000.0


_tls = threading.local()


def _conn(timeout):
    """One keep-alive connection per thread, so timings are not dominated by TLS handshakes."""
    url = urllib.parse.urlparse(SERVER)
    conn = getattr(_tls, "conn", None)
    if conn is None:
        cls = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
        conn = cls(url.hostname, url.port, timeout=timeout)
        _tls.conn = conn
    return conn


def call(method, path, token=None, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    for attempt in (0, 1):
        conn = _conn(timeout)
        try:
            conn.timeout = timeout
            if conn.sock is not None:
                conn.sock.settimeout(timeout)
            conn.request(method, path, body=data, headers=headers)
            resp = conn.getresponse()
            raw = resp.read()
            try:
                return resp.status, (json.loads(raw) if raw else None)
            except ValueError:
                return resp.status, None
        except (http.client.HTTPException, OSError):
            conn.close()
            _tls.conn = None
            if attempt:
                raise


def need(cond, what):
    if not cond:
        failures.append(what)
        print("FAIL", what)
    return cond


class Device:
    def __init__(self, name, platform, caps):
        self.id = str(uuid.uuid4())
        self.name = name
        status, login = call("POST", "/api/v1/auth/login", body={
            "username": os.environ["TEST_USERNAME"],
            "password": os.environ["TEST_PASSWORD"],
            "device_id": self.id,
            "device_name": name,
            "client_platform": platform,
            "client_version": "smoke",
        })
        if status != 200:
            print(f"login failed for {name}: HTTP {status}")
            sys.exit(1)
        self.token = login["access_token"]
        status, _ = call("PUT", "/api/v1/remote/target", self.token,
                         {"name": name, "platform": platform, "capabilities": caps})
        need(status == 200, f"register {name}")
        self.cursor = 0
        self.events = queue.Queue()
        self._stop = threading.Event()

    def backlog(self):
        status, inbox = call("GET", f"/api/v1/remote/inbox?after={self.cursor}", self.token)
        if status == 200:
            self.cursor = max([self.cursor] + [e["seq"] for e in inbox["events"]])
            return inbox["events"]
        return []

    def listen(self, mode):
        # A fresh queue and stop flag per session, so a lingering thread from an earlier
        # session can never feed this one.
        self.events = queue.Queue()
        self._stop = threading.Event()
        self._resp = None
        t = threading.Thread(
            target=self._push if mode == "push" else self._poll,
            args=(self.events, self._stop), daemon=True)
        t.start()
        return t

    def stop(self):
        self._stop.set()
        resp = getattr(self, "_resp", None)
        if resp is not None:
            try:
                resp.close()
            except Exception:  # noqa: BLE001
                pass

    def _push(self, events, stop):
        req = urllib.request.Request(SERVER + "/api/v1/remote/stream?after=%d" % self.cursor)
        req.add_header("Authorization", "Bearer " + self.token)
        req.add_header("Accept", "text/event-stream")
        try:
            resp = urllib.request.urlopen(req, timeout=60)
            self._resp = resp
        except Exception as err:  # noqa: BLE001
            events.put(("error", repr(err), ms()))
            return
        events.put(("open", None, ms()))
        event, data = "message", []
        while not stop.is_set():
            try:
                line = resp.readline()
            except Exception:  # noqa: BLE001 - closed by stop()
                return
            if not line:
                return
            line = line.decode().rstrip("\r\n")
            if line == "":
                if event == "inbox" and data:
                    ev = json.loads("\n".join(data))
                    self.cursor = max(self.cursor, ev["seq"])
                    events.put(("event", ev, ms()))
                event, data = "message", []
            elif line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].lstrip())

    def _poll(self, events, stop):
        events.put(("open", None, ms()))
        while not stop.is_set():
            status, inbox = call("GET", f"/api/v1/remote/inbox?after={self.cursor}&wait=20",
                                 self.token, timeout=40)
            if status != 200:
                time.sleep(0.5)
                continue
            self.cursor = max(self.cursor, inbox["next"])
            for ev in inbox["events"]:
                events.put(("event", ev, ms()))

    def next_event(self, kind, timeout=15):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                what, payload, at = self.events.get(timeout=0.2)
            except queue.Empty:
                continue
            if what == "event" and payload["kind"] == kind:
                return payload, at
            if what == "error":
                need(False, f"stream error: {payload}")
                return None, None
        return None, None


def summarise(label, values):
    values = sorted(values)
    if not values:
        print(f"{label}: no samples")
        return None
    p95 = values[min(len(values) - 1, int(round(0.95 * (len(values) - 1))))]
    print(f"{label}: n={len(values)} min={values[0]:.0f} p50={statistics.median(values):.0f} "
          f"p95={p95:.0f} max={values[-1]:.0f} ms")
    return p95


tv = Device("Smoke TV", "android-tv", ["navigate", "text", "playback", "handoff"])
phone = Device("Smoke phone", "android-mobile", ["handoff", "playback"])
tv.backlog(); phone.backlog()

# --- pair ---
status, pairing = call("POST", "/api/v1/remote/pairings", phone.token,
                       {"target_device_id": tv.id, "controller_name": "Smoke phone"})
need(status == 201, f"create pairing (HTTP {status})")
pid = pairing["id"]
need(call("POST", f"/api/v1/remote/pairings/{pid}/approve", tv.token, {})[0] == 200, "approve pairing")
tv.backlog()  # drop the pairing_request notice

# --- command latency per transport ---
results = {}
for mode in ("push", "poll"):
    tv.cursor = max([tv.cursor] + [e["seq"] for e in tv.backlog()])
    tv.listen(mode)
    tv.next_event("never", timeout=1.0)  # let the connection establish
    samples = []
    after_post = []
    for i in range(N):
        t0 = ms()
        status, acc = call("POST", f"/api/v1/remote/pairings/{pid}/commands", phone.token,
                           {"kind": "navigate", "payload": {"key": "down" if i % 2 else "up"}})
        posted = ms()
        if not need(status == 202, f"send command via {mode} (HTTP {status})"):
            continue
        ev, at = tv.next_event("command")
        if need(ev is not None, f"{mode}: command {i} delivered"):
            samples.append(at - t0)
            after_post.append(at - posted)
            call("POST", f"/api/v1/remote/events/{ev['id']}/ack", tv.token, {"status": "ok"})
        time.sleep(0.2)
    tv.stop()
    time.sleep(1.0)
    results[mode] = summarise(f"command latency ({mode}, POST start to TV receipt)", samples)
    summarise(f"  of which after the server accepted it ({mode})", after_post)
if results.get("push") is not None:
    need(results["push"] < P95_BUDGET, f"push p95 {results['push']:.0f} ms under {P95_BUDGET:.0f} ms")

# --- handoff ---
media = os.environ.get("MEDIA_FILE_ID")
if not media:
    status, page = call("GET", "/api/v1/catalog?kind=movie&limit=5", phone.token)
    for item in (page or {}).get("items", []):
        status, detail = call("GET", "/api/v1/catalog/" + item["id"], phone.token)
        if status == 200 and detail.get("media_file_id"):
            media = detail["media_file_id"]
            break
if media:
    tv.backlog(); phone.backlog()
    tv.listen("push")
    phone.listen("push")
    time.sleep(1.0)
    offer_ms, commit_ms, stop_ms = [], [], []
    for i in range(3):
        t0 = ms()
        status, h = call("POST", "/api/v1/remote/handoffs", phone.token, {
            "request_key": str(uuid.uuid4()), "source_device_id": phone.id,
            "destination_device_id": tv.id, "media_file_id": media,
            "snapshot": {"position_ms": 60000, "paused": False}})
        if not need(status == 201, f"create handoff (HTTP {status}, {h and h.get('error')})"):
            break
        offer, at = tv.next_event("handoff_offer")
        if not need(offer is not None, "handoff offer delivered"):
            break
        offer_ms.append(at - t0)
        waiter = {}
        def wait_commit():
            status, got = call("GET", f"/api/v1/remote/handoffs/{h['id']}?wait=20", phone.token)
            waiter["status"] = got and got["status"]
            waiter["at"] = ms()
        th = threading.Thread(target=wait_commit); th.start()
        call("POST", f"/api/v1/remote/handoffs/{h['id']}/ack", tv.token,
             {"status": "playing", "position_ms": 60500})
        th.join()
        need(waiter.get("status") == "committed", f"handoff committed ({waiter.get('status')})")
        commit_ms.append(waiter["at"] - t0)
        stop, at = phone.next_event("handoff_stop")
        if need(stop is not None, "source received handoff_stop"):
            stop_ms.append(at - t0)
    tv.stop(); phone.stop()
    summarise("handoff offer delivery", offer_ms)
    worst = summarise("handoff create to commit (instant destination)", commit_ms)
    summarise("handoff create to source stop", stop_ms)
    if worst is not None:
        need(worst < HANDOFF_BUDGET, f"handoff commit {worst:.0f} ms under {HANDOFF_BUDGET:.0f} ms")
else:
    print("SKIP handoff: no playable media file found (set MEDIA_FILE_ID)")

# --- revocation ---
need(call("DELETE", f"/api/v1/remote/pairings/{pid}", phone.token)[0] == 204, "revoke pairing")
status, _ = call("POST", f"/api/v1/remote/pairings/{pid}/commands", phone.token,
                 {"kind": "navigate", "payload": {"key": "up"}})
need(status == 403, f"command after revocation rejected (HTTP {status})")
for d in (tv, phone):
    call("DELETE", "/api/v1/remote/target", d.token)

print("RESULT:", "PASS" if not failures else "FAIL (" + "; ".join(failures) + ")")
sys.exit(1 if failures else 0)
PY
