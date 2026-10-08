#!/usr/bin/env python3
"""Give every configured EXTERNAL TestFlight group each uploaded build.

App Store Connect has no auto-distribution for external groups, so after each upload this script,
for every platform released in the run:
  1. waits (bounded) for the build to finish processing;
  2. answers the export-compliance question when the build has no answer yet;
  3. makes sure the build has "What to Test" notes;
  4. adds the build to each group in TESTFLIGHT_EXTERNAL_GROUP_IDS (comma-separated);
  5. submits the build for beta app review, ignoring "already submitted".

It never submits an App Store version for review; that stays a manual App Store Connect action.

Configuration comes from the environment: APP_STORE_CONNECT_API_KEY_ID,
APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_API_KEY_BASE64, MARKETING_VERSION, BUILD_NUMBER,
RELEASE_PLATFORM (both, ios or tvos), TESTFLIGHT_EXTERNAL_GROUP_IDS (a repository variable),
and optionally WHATS_NEW (the notes text) and ENCRYPTION_EXEMPT (default "true", the value of
ITSAppUsesNonExemptEncryption being false in both Info.plist files).

--plan (used for dry runs) performs read-only requests and logs the writes it would make.

The uploaded build is already published, so distribution problems never fail the script: each is
printed as a warning and listed in the markdown file named by DISTRIBUTION_SUMMARY (if set), which
the workflow adds to the release summary. Only a missing configuration exits non-zero.
"""

import argparse
import base64
import os
import sys
import time

import asc_prepare_version as asc
from asc_prepare_version import ApiError, warn

LOCALE = "en-US"
WHATS_NEW_LIMIT = 4000
ALREADY_DONE = ("already", "duplicate", "exists")


def parse_group_ids(raw):
    """Split a comma- or whitespace-separated list, dropping blanks and duplicates, keeping order."""
    seen = []
    for part in (raw or "").replace(",", " ").split():
        if part not in seen:
            seen.append(part)
    return seen


def whats_new_text(raw, marketing_version, build_number):
    text = " ".join((raw or "").split())
    if not text:
        text = f"Playarr {marketing_version} (build {build_number})."
    return text[:WHATS_NEW_LIMIT]


def is_already_done(error):
    """True when an API error only says the work was already done (a 409 for an existing link)."""
    message = str(error).lower()
    return "http 409" in message and any(word in message for word in ALREADY_DONE)


class Outcome:
    def __init__(self):
        self.lines = []

    def ok(self, text):
        print(text, flush=True)
        self.lines.append(f"- {text}")

    def problem(self, text):
        warn(text)
        self.lines.append(f"- WARNING: {text}")


def compliance_body(build_id, exempt):
    return {"data": {"type": "builds", "id": build_id, "attributes": {"usesNonExemptEncryption": not exempt}}}


def distribute_platform(client, out, app_id, platform, version, build_number, groups, notes, exempt, plan, timeout, interval):
    label = f"{platform} {version} ({build_number})"
    prefix = "PLAN " if plan else ""
    build = asc.wait_for_build(client, app_id, build_number, platform, version, timeout, interval, once=plan)
    if build is None and not plan:
        out.problem(f"{label}: build did not become VALID, so it was not added to the external groups")
        return
    if plan:
        state = "present" if build else "not uploaded yet (a dry run uploads nothing)"
        out.ok(f"{prefix}{label}: build is {state}; would wait for processing")
    build_id = build["id"] if build else "<build>"
    try:
        if build is None or build["attributes"].get("usesNonExemptEncryption") is None:
            out.ok(f"{prefix}{label}: set export compliance usesNonExemptEncryption={not exempt}")
            if not plan:
                client.request("PATCH", f"/v1/builds/{build_id}", body=compliance_body(build_id, exempt))
        else:
            out.ok(f"{label}: export compliance already answered")
    except ApiError as exc:
        out.problem(f"{label}: export compliance: {exc}")

    try:
        existing = [] if build is None else client.request(
            "GET", f"/v1/builds/{build_id}/betaBuildLocalizations", {"limit": "50"}).get("data", [])
        have = [x for x in existing if x["attributes"].get("locale") == LOCALE]
        if have and (have[0]["attributes"].get("whatsNew") or "").strip():
            out.ok(f"{label}: What to Test notes already present")
        elif have:
            out.ok(f"{prefix}{label}: fill empty What to Test notes ({len(notes)} characters)")
            if not plan:
                client.request("PATCH", f"/v1/betaBuildLocalizations/{have[0]['id']}", body={
                    "data": {"type": "betaBuildLocalizations", "id": have[0]["id"], "attributes": {"whatsNew": notes}}})
        else:
            out.ok(f"{prefix}{label}: create {LOCALE} What to Test notes ({len(notes)} characters)")
            if not plan:
                client.request("POST", "/v1/betaBuildLocalizations", body={"data": {
                    "type": "betaBuildLocalizations",
                    "attributes": {"locale": LOCALE, "whatsNew": notes},
                    "relationships": {"build": {"data": {"type": "builds", "id": build_id}}}}})
    except ApiError as exc:
        out.problem(f"{label}: What to Test notes: {exc}")

    for index, group_id in enumerate(groups, 1):
        name = f"external group {index} of {len(groups)}"
        try:
            group = client.request("GET", f"/v1/betaGroups/{group_id}").get("data", {}).get("attributes", {})
            if group.get("isInternalGroup"):
                out.problem(f"{label}: {name} is an internal group; skipped (internal groups distribute on their own)")
                continue
            out.ok(f"{prefix}{label}: add build to {name}")
            if not plan:
                try:
                    client.request("POST", f"/v1/betaGroups/{group_id}/relationships/builds",
                                   body={"data": [{"type": "builds", "id": build_id}]})
                except ApiError as exc:
                    if not is_already_done(exc):
                        raise
                    out.ok(f"{label}: build was already in {name}")
        except ApiError as exc:
            out.problem(f"{label}: {name}: {exc}")

    if not groups:
        return
    try:
        out.ok(f"{prefix}{label}: submit for beta app review")
        if not plan:
            try:
                client.request("POST", "/v1/betaAppReviewSubmissions", body={"data": {
                    "type": "betaAppReviewSubmissions",
                    "relationships": {"build": {"data": {"type": "builds", "id": build_id}}}}})
            except ApiError as exc:
                if not is_already_done(exc):
                    raise
                out.ok(f"{label}: beta app review already submitted")
    except ApiError as exc:
        out.problem(f"{label}: beta app review submission: {exc}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--plan", "--read-only", dest="plan", action="store_true",
                        help="only perform GET requests and log the writes that would be made")
    parser.add_argument("--timeout", type=int, default=asc.POLL_TIMEOUT_SECONDS)
    parser.add_argument("--interval", type=int, default=asc.POLL_INTERVAL_SECONDS)
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
    platforms = [asc.PLATFORMS[p] for p in ("ios", "tvos") if selected in ("both", p)]
    groups = parse_group_ids(env.get("TESTFLIGHT_EXTERNAL_GROUP_IDS"))
    version, build_number = env["MARKETING_VERSION"], env["BUILD_NUMBER"]
    notes = whats_new_text(env.get("WHATS_NEW"), version, build_number)
    exempt = env.get("ENCRYPTION_EXEMPT", "true").lower() != "false"
    out = Outcome()
    if not groups:
        out.problem("TESTFLIGHT_EXTERNAL_GROUP_IDS is empty, so no external TestFlight group receives this build")

    try:
        client = asc.Client(env["APP_STORE_CONNECT_API_KEY_ID"], env["APP_STORE_CONNECT_ISSUER_ID"],
                            base64.b64decode(env["APP_STORE_CONNECT_API_KEY_BASE64"]))
        apps = client.request("GET", "/v1/apps", {"filter[bundleId]": asc.BUNDLE_ID}).get("data", [])
        if not apps:
            raise ApiError(f"no App Store Connect app found for bundle ID {asc.BUNDLE_ID}")
        for platform in platforms:
            distribute_platform(client, out, apps[0]["id"], platform, version, build_number, groups, notes,
                                exempt, args.plan, args.timeout, args.interval)
    except ApiError as exc:
        out.problem(f"external TestFlight distribution: {exc}")
    except Exception as exc:  # key decoding or signing problems; never echo key material
        out.problem(f"external TestFlight distribution: authentication setup failed ({type(exc).__name__})")

    summary = env.get("DISTRIBUTION_SUMMARY")
    if summary:
        with open(summary, "w", encoding="utf-8") as handle:
            handle.write("\n".join(out.lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
