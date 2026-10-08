#!/usr/bin/env python3
"""Signs the device test account in to the tvOS app without the QR flow, by seeding the app's saved session.

Logs in against the real server (SERVER_URL, TEST_USERNAME, TEST_PASSWORD from the environment), then writes the
app's UserDefaults on the booted simulator: the server address, the device id and the stored auth session
(access and refresh token) the app restores at launch and refreshes on its own. Prints statuses only, never values.
usage: seed_session.py --udid <udid> --bundle <bundle id>
"""
import argparse
import binascii
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

APPLE_REFERENCE_EPOCH = 978307200  # seconds from 1970 to 2001-01-01, the base of Swift's default Date encoding


PROFILE_NAME = "Device Test"


def call(request: urllib.request.Request, what: str):
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        sys.exit(f"{what} failed: HTTP {error.code}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--udid", required=True)
    parser.add_argument("--bundle", required=True)
    args = parser.parse_args()
    server = os.environ["SERVER_URL"].strip().rstrip("/")
    device_id = str(uuid.uuid4()).upper()
    body = json.dumps({"username": os.environ["TEST_USERNAME"], "password": os.environ["TEST_PASSWORD"], "device_id": device_id,
                       "device_name": "tvos-live-sim", "client_platform": "ios", "client_version": "live-sim"}).encode()
    request = urllib.request.Request(server + "/api/v1/auth/login", data=body, method="POST",
                                     headers={"content-type": "application/json", "user-agent": "playarr-tvos-live-sim"})
    login = call(request, "login")
    # The app opens on the household profile "Device Test", like the other test devices.
    profiles = call(urllib.request.Request(server + "/api/v1/users/profiles", headers={
        "authorization": "Bearer " + login["access_token"], "user-agent": "playarr-tvos-live-sim"}), "profile list")
    profiles = profiles if isinstance(profiles, list) else profiles.get("profiles", [])
    wanted = next((p for p in profiles if p.get("display_name") == PROFILE_NAME), None)
    if wanted is None:
        sys.exit(f"profile {PROFILE_NAME!r} not found on the account")
    if wanted.get("pin_locked") and not wanted.get("is_current"):
        sys.exit(f"profile {PROFILE_NAME!r} is PIN locked")
    if not wanted.get("is_current"):
        body = json.dumps({"device_id": device_id, "device_name": "tvos-live-sim", "client_platform": "ios",
                           "client_version": "live-sim", "profile_user_id": wanted["id"]}).encode()
        login = call(urllib.request.Request(server + "/api/v1/auth/login", data=body, method="POST", headers={
            "content-type": "application/json", "authorization": "Bearer " + login["access_token"],
            "user-agent": "playarr-tvos-live-sim"}), "profile switch")
    expires_at = time.time() + int(login.get("expires_in", 900)) - APPLE_REFERENCE_EPOCH
    session = json.dumps({"accessToken": login["access_token"], "refreshToken": login["refresh_token"],
                          "tokenType": login.get("token_type", "Bearer"), "expiresAt": expires_at}).encode()

    def write(key: str, *value: str) -> None:
        subprocess.run(["xcrun", "simctl", "spawn", args.udid, "defaults", "write", args.bundle, key, *value], check=True)

    write("com.playarr.playarr.tvos.lastProfileName", "-string", PROFILE_NAME)
    write("com.playarr.playarr.tvos.serverURL", "-string", server)
    write("com.playarr.playarr.tvos.deviceID", "-string", device_id)
    write(f"com.playarr.playarr.tvos.session.{server}", "-data", binascii.hexlify(session).decode())
    print("login ok; saved session seeded")


if __name__ == "__main__":
    main()
