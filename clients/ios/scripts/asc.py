#!/usr/bin/env python3
"""Minimal App Store Connect API client for Playarr (stdlib + openssl only).

Reads APP_STORE_CONNECT_API_KEY_ID, APP_STORE_CONNECT_ISSUER_ID and
APP_STORE_CONNECT_API_KEY_BASE64 from the environment. Never prints credentials.
Commands: status

Run it locally with the App Store Connect API key in the environment:
  python3 clients/ios/scripts/asc.py status
Its output includes App Store Connect record and build IDs, so do not run it in a
workflow whose logs are public.
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error, urllib.parse

BASE = "https://api.appstoreconnect.apple.com"
BUNDLE_ID = "app.playarr.ios"


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=")


def der_to_raw(der):
    # ECDSA DER -> r||s (32 bytes each)
    assert der[0] == 0x30
    i = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    assert der[i] == 0x02
    rl = der[i + 1]; r = der[i + 2:i + 2 + rl]; i = i + 2 + rl
    assert der[i] == 0x02
    sl = der[i + 1]; s = der[i + 2:i + 2 + sl]
    return r.lstrip(b"\0").rjust(32, b"\0") + s.lstrip(b"\0").rjust(32, b"\0")


def token():
    kid = os.environ["APP_STORE_CONNECT_API_KEY_ID"]
    iss = os.environ["APP_STORE_CONNECT_ISSUER_ID"]
    pem = base64.b64decode(os.environ["APP_STORE_CONNECT_API_KEY_BASE64"])
    head = b64u(json.dumps({"alg": "ES256", "kid": kid, "typ": "JWT"}).encode())
    now = int(time.time())
    body = b64u(json.dumps({"iss": iss, "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"}).encode())
    msg = head + b"." + body
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(pem); path = f.name
    try:
        der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", path], input=msg, capture_output=True, check=True).stdout
    finally:
        os.unlink(path)
    return (msg + b"." + b64u(der_to_raw(der))).decode()


def api(method, path, body=None, params=None):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} {method} {path}: {e.read().decode()[:1500]}", file=sys.stderr)
        raise


def status():
    apps = api("GET", "/v1/apps", params={"filter[bundleId]": BUNDLE_ID})["data"]
    for a in apps:
        aid = a["id"]
        print("app", aid, a["attributes"].get("name"), a["attributes"].get("sku"), a["attributes"].get("bundleId"))
        for k in ("appInfos", "appStoreVersions", "builds"):
            try:
                p = {"limit": 30}
                if k == "builds":
                    p["sort"] = "-uploadedDate"
                d = api("GET", f"/v1/apps/{aid}/{k}", params=p)["data"]
            except Exception:
                continue
            for x in d:
                at = x["attributes"]
                keep = {kk: vv for kk, vv in at.items() if kk in (
                    "platform", "versionString", "appStoreState", "appVersionState", "state", "version",
                    "processingState", "uploadedDate", "expired", "usesNonExemptEncryption",
                    "appStoreAgeRating", "brazilAgeRating", "reviewType", "releaseType")}
                print(" ", k, x["id"], json.dumps(keep, sort_keys=True))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"status": status}[cmd]()
