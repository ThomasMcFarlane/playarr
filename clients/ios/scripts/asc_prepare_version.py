#!/usr/bin/env python3
"""Prepare the App Store Connect draft version for a freshly uploaded TestFlight build.

#############################################################################################
# THIS SCRIPT ONLY PREPARES A DRAFT.                                                        #
# It never submits for review, never creates review submissions, never changes the release  #
# type or phased release, and never touches TestFlight groups. Publishing the version to    #
# the App Store remains a manual App Store Connect action.                                  #
#############################################################################################

For each platform uploaded in this run it:
  1. waits (bounded) for the uploaded build to finish processing;
  2. renames the editable draft App Store version to MARKETING_VERSION, or creates one when no
     draft exists and the version string is unused;
  3. attaches the processed build to that version.

Configuration comes from the environment: APP_STORE_CONNECT_API_KEY_ID,
APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_API_KEY_BASE64 (base64 of the .p8 key),
MARKETING_VERSION, BUILD_NUMBER and RELEASE_PLATFORM (both, ios or tvos).

Use --plan to perform read-only requests and print what would be changed without writing.
Processing problems (failed, invalid or timed-out builds) are warnings and never fail the
release; genuine API or authentication errors while preparing the version exit non-zero.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.appstoreconnect.apple.com"
BUNDLE_ID = "app.playarr.ios"
PLATFORMS = {"ios": "IOS", "tvos": "TV_OS"}
EDITABLE_STATES = {
    "PREPARE_FOR_SUBMISSION",
    "DEVELOPER_REJECTED",
    "REJECTED",
    "METADATA_REJECTED",
    "INVALID_BINARY",
}
POLL_TIMEOUT_SECONDS = 30 * 60
POLL_INTERVAL_SECONDS = 30


class ApiError(Exception):
    """A genuine App Store Connect API or authentication failure."""


# --------------------------------------------------------------------------------------------
# Pure decision logic (unit-tested offline)
# --------------------------------------------------------------------------------------------
def version_state(version):
    attrs = version.get("attributes", {})
    return attrs.get("appStoreState") or attrs.get("appVersionState") or ""


def decide_version_action(versions, marketing_version):
    """Return (action, version_id, note) for one platform's App Store versions.

    action is one of: use (attach only), rename, create, skip.
    """
    editable = [v for v in versions if version_state(v) in EDITABLE_STATES]
    same = [v for v in versions if v["attributes"].get("versionString") == marketing_version]
    for v in editable:
        if v["attributes"].get("versionString") == marketing_version:
            return "use", v["id"], f"{marketing_version} ({version_state(v)})"
    if editable:
        if same:
            state = version_state(same[0])
            return "skip", None, f"version {marketing_version} already exists in state {state}"
        v = editable[0]
        return "rename", v["id"], f"{v['attributes'].get('versionString')} -> {marketing_version}"
    if same:
        return "skip", None, f"version {marketing_version} already exists in state {version_state(same[0])}"
    return "create", None, marketing_version


def select_build(builds, build_number, platform, marketing_version):
    """Pick the matching build, never one whose pre-release version differs from the marketing version."""
    included = {i["id"]: i for i in builds.get("included", []) if i.get("type") == "preReleaseVersions"}
    for b in builds.get("data", []):
        if b["attributes"].get("version") != build_number:
            continue
        pre = (b.get("relationships", {}).get("preReleaseVersion", {}).get("data") or {}).get("id")
        attrs = included.get(pre, {}).get("attributes")
        if attrs is None:
            continue  # cannot prove the version matches, so never use it
        if attrs.get("platform") == platform and attrs.get("version") == marketing_version:
            return b
    return None


# --------------------------------------------------------------------------------------------
# API access
# --------------------------------------------------------------------------------------------
def make_token(key_id, issuer_id, key_pem):
    import jwt  # imported lazily so the pure functions need no dependencies

    now = int(time.time())
    return jwt.encode(
        {"iss": issuer_id, "iat": now, "exp": now + 15 * 60, "aud": "appstoreconnect-v1"},
        key_pem,
        algorithm="ES256",
        headers={"kid": key_id, "typ": "JWT"},
    )


class Client:
    def __init__(self, key_id, issuer_id, key_pem):
        self._args = (key_id, issuer_id, key_pem)
        self._token = None
        self._issued = 0.0

    def _auth(self):
        if self._token is None or time.time() - self._issued > 10 * 60:
            self._token = make_token(*self._args)
            self._issued = time.time()
        return self._token

    def request(self, method, path, params=None, body=None):
        url = API + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self._auth()}")
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            raise ApiError(f"{method} {path} failed with HTTP {exc.code}: {error_detail(exc.read())}") from None
        except urllib.error.URLError as exc:
            raise ApiError(f"{method} {path} failed: {exc.reason}") from None
        return json.loads(raw) if raw else {}


def error_detail(raw):
    try:
        errors = json.loads(raw).get("errors", [])
        parts = [f"{e.get('title', '')}: {e.get('detail', '')}".strip(": ") for e in errors]
        if parts:
            return "; ".join(parts)
    except (ValueError, AttributeError):
        pass
    return "no error detail returned"


# --------------------------------------------------------------------------------------------
# Workflow
# --------------------------------------------------------------------------------------------
def warn(message):
    print(f"::warning::{message}", flush=True)


def wait_for_build(client, app_id, build_number, platform, marketing_version, timeout, interval, once=False):
    """Return the VALID build, or None after emitting a warning (one check only when once=True)."""
    deadline = time.monotonic() + timeout
    while True:
        resp = client.request(
            "GET",
            "/v1/builds",
            {
                "filter[app]": app_id,
                "filter[version]": build_number,
                "filter[preReleaseVersion.platform]": platform,
                "include": "preReleaseVersion",
                "limit": "10",
            },
        )
        build = select_build(resp, build_number, platform, marketing_version)
        state = build["attributes"].get("processingState") if build else "NOT_YET_VISIBLE"
        if state == "VALID":
            return build
        if state in ("FAILED", "INVALID"):
            warn(f"{platform}: build {build_number} ended in processing state {state}; skipping version preparation")
            return None
        if once:
            warn(f"{platform}: no VALID {marketing_version} build {build_number} exists yet (state {state}); attach would be skipped")
            return None
        if time.monotonic() + interval > deadline:
            warn(f"{platform}: build {build_number} for {marketing_version} was not VALID within {timeout // 60} minutes (last state {state}); skipping version preparation")
            return None
        print(f"{platform}: build {build_number} is {state}; waiting {interval}s", flush=True)
        time.sleep(interval)


def prepare_platform(client, app_id, platform, marketing_version, build_number, plan, timeout, interval):
    build = None
    if not plan:
        build = wait_for_build(client, app_id, build_number, platform, marketing_version, timeout, interval)
        if build is None:
            return
    resp = client.request(
        "GET",
        f"/v1/apps/{app_id}/appStoreVersions",
        {"filter[platform]": platform, "limit": "200"},
    )
    action, version_id, note = decide_version_action(resp.get("data", []), marketing_version)
    prefix = "PLAN " if plan else ""
    if action == "skip":
        warn(f"{platform}: {note}; leaving it untouched and not attaching build {build_number}")
        return
    if action == "rename":
        print(f"{prefix}{platform}: rename draft version {note}", flush=True)
        if not plan:
            client.request(
                "PATCH",
                f"/v1/appStoreVersions/{version_id}",
                body={"data": {"type": "appStoreVersions", "id": version_id, "attributes": {"versionString": marketing_version}}},
            )
    elif action == "create":
        print(f"{prefix}{platform}: create draft version {note}", flush=True)
        if not plan:
            created = client.request(
                "POST",
                "/v1/appStoreVersions",
                body={
                    "data": {
                        "type": "appStoreVersions",
                        "attributes": {"platform": platform, "versionString": marketing_version},
                        "relationships": {"app": {"data": {"type": "apps", "id": app_id}}},
                    }
                },
            )
            version_id = created["data"]["id"]
    else:
        print(f"{prefix}{platform}: draft version {note} already has the right version string", flush=True)
    if plan:
        build = wait_for_build(client, app_id, build_number, platform, marketing_version, timeout, interval, once=True)
        if build is None:
            return
    print(f"{prefix}{platform}: attach build {build_number} to draft version {marketing_version}", flush=True)
    if not plan:
        client.request(
            "PATCH",
            f"/v1/appStoreVersions/{version_id}/relationships/build",
            body={"data": {"type": "builds", "id": build["id"]}},
        )
        print(f"{platform}: draft version {marketing_version} now has build {build_number} attached (not submitted)", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--plan", "--read-only", dest="plan", action="store_true",
                        help="only perform GET requests and print the actions that would be taken")
    parser.add_argument("--timeout", type=int, default=POLL_TIMEOUT_SECONDS, help="build processing wait in seconds")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL_SECONDS, help="poll interval in seconds")
    args = parser.parse_args(argv)

    env = os.environ
    missing = [n for n in ("APP_STORE_CONNECT_API_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID",
                           "APP_STORE_CONNECT_API_KEY_BASE64", "MARKETING_VERSION", "BUILD_NUMBER") if not env.get(n)]
    if missing:
        print(f"Missing required environment: {', '.join(missing)}", file=sys.stderr)
        return 2
    selected = env.get("RELEASE_PLATFORM", "both")
    if selected not in ("both", "ios", "tvos"):
        print("RELEASE_PLATFORM must be both, ios or tvos.", file=sys.stderr)
        return 2
    platforms = [PLATFORMS[p] for p in ("ios", "tvos") if selected in ("both", p)]

    try:
        key_pem = base64.b64decode(env["APP_STORE_CONNECT_API_KEY_BASE64"])
        client = Client(env["APP_STORE_CONNECT_API_KEY_ID"], env["APP_STORE_CONNECT_ISSUER_ID"], key_pem)
        apps = client.request("GET", "/v1/apps", {"filter[bundleId]": BUNDLE_ID}).get("data", [])
        if not apps:
            raise ApiError(f"no App Store Connect app found for bundle ID {BUNDLE_ID}")
        app_id = apps[0]["id"]
        for platform in platforms:
            prepare_platform(client, app_id, platform, env["MARKETING_VERSION"], env["BUILD_NUMBER"],
                             args.plan, args.timeout, args.interval)
    except ApiError as exc:
        print(f"::error::{exc}", flush=True)
        return 1
    except Exception as exc:  # signing or key decoding problems; never echo key material
        print(f"::error::App Store Connect authentication setup failed ({type(exc).__name__})", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
