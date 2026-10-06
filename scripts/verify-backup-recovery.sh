#!/usr/bin/env bash
#
# scripts/verify-backup-recovery.sh
#
# End-to-end proof that a backup can rebuild a server, using only scratch
# state in a temporary directory and loopback ports. It never touches a real
# server's data:
#
#   1. start instance A on a scratch SQLite database, create users with
#      different permissions, a playlist and a renamed instance;
#   2. take a backup through the admin API, download it and verify it with the
#      recovery key;
#   3. stop A, restore the archive into an empty scratch location with the CLI,
#      start instance B (API role only, so no background jobs run) from it;
#   4. check the users, permissions, passwords and playlists match, that the
#      old refresh tokens no longer work, and that wrong keys, damaged
#      archives and non-SQLite (Postgres) restore targets are refused.
#
# Usage: scripts/verify-backup-recovery.sh [path/to/playarr-server]
# Needs: curl, jq.
#
set -euo pipefail

BIN="${1:-backend/target/debug/playarr-server}"
[ -x "$BIN" ] || { echo "server binary not found: $BIN" >&2; exit 2; }
SCRATCH="$(mktemp -d)"
PORT_A=18484
PORT_B=18485
PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$SCRATCH"
}

# database_url NAME (a or b): the scratch database for an instance.
database_url() {
  echo "sqlite://$SCRATCH/$1/playarr.db"
}
trap cleanup EXIT

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

JWT_SECRET="$(head -c 24 /dev/urandom | base64)"
ADMIN_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
ALICE_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
KID_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
HEADERS=(-H "x-playarr-client-platform: web" -H "x-playarr-client-version: 1.0.0")

# Recovery key pair for this run only. The secret stays in a 0600 file.
RECIPIENT="$("$BIN" backup keygen --out "$SCRATCH/recovery.key" | sed -n 's/^public key.*: //p')"
"$BIN" backup keygen --out "$SCRATCH/other.key" >/dev/null

start_server() { # name port db role [extra env...]
  local name="$1" port="$2" db="$3" role="$4"
  shift 4
  env DATABASE_URL="$db" PLAYARR_ROLE="$role" \
    PLAYARR_HTTP_BIND_ADDR="127.0.0.1:$port" PLAYARR_METRICS_BIND_ADDR="127.0.0.1:$((port + 1000))" \
    PLAYARR_JWT_SECRET="$JWT_SECRET" PLAYARR_BOOTSTRAP_ADMIN_USERNAME=admin \
    PLAYARR_BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PASSWORD" PLAYARR_LOG=warn \
    PLAYARR_ARTWORK_CACHE_DIR="$SCRATCH/$name/artwork" "$@" \
    "$BIN" serve >"$SCRATCH/$name.log" 2>&1 &
  PIDS+=("$!")
  for _ in $(seq 1 100); do
    curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && return 0
    sleep 0.3
  done
  cat "$SCRATCH/$name.log" >&2
  fail "$name did not become healthy"
}

api() { # port token method path [json]
  local port="$1" token="$2" method="$3" path="$4" body="${5:-}"
  if [ -n "$body" ]; then
    curl -fsS "${HEADERS[@]}" -H "authorization: Bearer $token" -H 'content-type: application/json' \
      -X "$method" "http://127.0.0.1:$port$path" -d "$body"
  else
    curl -fsS "${HEADERS[@]}" -H "authorization: Bearer $token" -X "$method" "http://127.0.0.1:$port$path"
  fi
}

login() { # port username password [device id] [platform] -> prints JSON
  local device="${4:-$(cat /proc/sys/kernel/random/uuid)}" platform="${5:-web}"
  curl -fsS "${HEADERS[@]}" -H 'content-type: application/json' \
    -X POST "http://127.0.0.1:$1/api/v1/auth/login" \
    -d "{\"username\":\"$2\",\"password\":\"$3\",\"device_id\":\"$device\",\"device_name\":\"e2e\",\"client_platform\":\"$platform\",\"client_version\":\"1.0.0\"}"
}

mkdir -p "$SCRATCH/a" "$SCRATCH/b"
start_server a "$PORT_A" "$(database_url a)" all \
  PLAYARR_BACKUP_DIR="$SCRATCH/a/backups" PLAYARR_BACKUP_RECIPIENTS="$RECIPIENT" \
  PLAYARR_BACKUP_INTERVAL_HOURS=0

ADMIN_DEVICE="$(cat /proc/sys/kernel/random/uuid)"
ADMIN_JSON="$(login "$PORT_A" admin "$ADMIN_PASSWORD" "$ADMIN_DEVICE" playarr-admin)"
ADMIN_TOKEN="$(jq -r .access_token <<<"$ADMIN_JSON")"
ADMIN_REFRESH="$(jq -r .refresh_token <<<"$ADMIN_JSON")"

api "$PORT_A" "$ADMIN_TOKEN" POST /api/v1/admin/users \
  "{\"username\":\"alice\",\"display_name\":\"Alice\",\"password\":\"$ALICE_PASSWORD\",\"is_admin\":false,\"can_stream\":true}" >/dev/null
api "$PORT_A" "$ADMIN_TOKEN" POST /api/v1/admin/users \
  "{\"username\":\"kid\",\"display_name\":\"Kid\",\"password\":\"$KID_PASSWORD\",\"is_admin\":false,\"can_stream\":false}" >/dev/null
api "$PORT_A" "$ADMIN_TOKEN" PUT /api/v1/admin/system-settings '{"instance_name":"Recovery Test Server"}' >/dev/null
api "$PORT_A" "$ADMIN_TOKEN" POST /api/v1/playlists '{"name":"Family Night"}' >/dev/null
USERS_A="$(api "$PORT_A" "$ADMIN_TOKEN" GET /api/v1/admin/users | jq -S '[.[] | {username, is_admin, can_stream}] | sort_by(.username)')"
PLAYLISTS_A="$(api "$PORT_A" "$ADMIN_TOKEN" GET /api/v1/playlists | jq -S '[.[] | .name] | sort')"
pass "instance A seeded with $(jq length <<<"$USERS_A") users and playlists $(jq -c . <<<"$PLAYLISTS_A")"

# --- backup through the admin API ---
api "$PORT_A" "$ADMIN_TOKEN" POST /api/v1/admin/backups >/dev/null
BACKUP_ID=""
for _ in $(seq 1 100); do
  OVERVIEW="$(api "$PORT_A" "$ADMIN_TOKEN" GET /api/v1/admin/backups)"
  if [ "$(jq '.current == null and (.backups | length) > 0' <<<"$OVERVIEW")" = true ]; then
    BACKUP_ID="$(jq -r '.backups[0].id' <<<"$OVERVIEW")"
    break
  fi
  sleep 0.3
done
[ -n "$BACKUP_ID" ] || { jq . <<<"$OVERVIEW" >&2; fail "backup did not complete"; }
[ "$(jq -r '.backups[0].complete' <<<"$OVERVIEW")" = true ] || fail "backup not marked complete"
pass "backup $BACKUP_ID completed ($(jq -r '.backups[0].size_bytes' <<<"$OVERVIEW") bytes, partial=$(jq -r '.backups[0].partial' <<<"$OVERVIEW"))"

curl -fsS "${HEADERS[@]}" -H "authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:$PORT_A/api/v1/admin/backups/$BACKUP_ID/download" -o "$SCRATCH/downloaded.parbak"
if curl -fsS -o /dev/null "${HEADERS[@]}" "http://127.0.0.1:$PORT_A/api/v1/admin/backups/$BACKUP_ID/download" 2>/dev/null; then
  fail "download worked without authentication"
fi
pass "download requires an administrator"
grep -q "SQLite format" "$SCRATCH/downloaded.parbak" && fail "archive is not encrypted"
pass "downloaded archive is encrypted"
"$BIN" backup verify --archive "$SCRATCH/downloaded.parbak" --identity-file "$SCRATCH/recovery.key" >/dev/null
pass "archive decrypts and every checksum matches with the recovery key"

# --- failure modes ---
if "$BIN" backup verify --archive "$SCRATCH/downloaded.parbak" --identity-file "$SCRATCH/other.key" >/dev/null 2>&1; then
  fail "a wrong key was accepted"
fi
pass "wrong recovery key is refused"
cp "$SCRATCH/downloaded.parbak" "$SCRATCH/damaged.parbak"
printf '\xff' | dd of="$SCRATCH/damaged.parbak" bs=1 seek=4096 conv=notrunc 2>/dev/null
if "$BIN" backup verify --archive "$SCRATCH/damaged.parbak" --identity-file "$SCRATCH/recovery.key" >/dev/null 2>&1; then
  fail "a damaged archive was accepted"
fi
pass "damaged archive is refused"
head -c 3000 "$SCRATCH/downloaded.parbak" >"$SCRATCH/truncated.parbak"
if "$BIN" backup verify --archive "$SCRATCH/truncated.parbak" --identity-file "$SCRATCH/recovery.key" >/dev/null 2>&1; then
  fail "a truncated archive was accepted"
fi
pass "truncated archive is refused"
OTHER_ENGINE="postgres://nobody@127.0.0.1:1/none"
if DATABASE_URL="$OTHER_ENGINE" "$BIN" backup restore \
  --archive "$SCRATCH/downloaded.parbak" --identity-file "$SCRATCH/recovery.key" >/dev/null 2>&1; then
  fail "restore into a non-SQLite target was attempted"
fi
pass "restore into a non-SQLite target is refused"

# --- restore into a replacement location and start it ---
kill "${PIDS[0]}"; wait "${PIDS[0]}" 2>/dev/null || true
DATABASE_URL="$(database_url b)" PLAYARR_ARTWORK_CACHE_DIR="$SCRATCH/b/artwork" \
  "$BIN" backup restore --archive "$SCRATCH/downloaded.parbak" --identity-file "$SCRATCH/recovery.key" \
  >"$SCRATCH/restore.json"
grep -q '"cutover": true' "$SCRATCH/restore.json" || fail "restore did not cut over"
pass "restore completed: $(jq -r '"\(.tables_restored) tables, \(.rows_restored) rows, schema \(.archive_schema_version)"' < <(sed '/^restore complete/d' "$SCRATCH/restore.json"))"

start_server b "$PORT_B" "$(database_url b)" api
if curl -fsS "${HEADERS[@]}" -H 'content-type: application/json' -X POST "http://127.0.0.1:$PORT_B/api/v1/auth/refresh" \
  -d "{\"refresh_token\":\"$ADMIN_REFRESH\",\"device_id\":\"$ADMIN_DEVICE\"}" >/dev/null 2>&1; then
  fail "an old refresh token still works after restore"
fi
pass "sessions were invalidated by the restore"

ADMIN_B="$(login "$PORT_B" admin "$ADMIN_PASSWORD" "" playarr-admin | jq -r .access_token)"
USERS_B="$(api "$PORT_B" "$ADMIN_B" GET /api/v1/admin/users | jq -S '[.[] | {username, is_admin, can_stream}] | sort_by(.username)')"
[ "$USERS_A" = "$USERS_B" ] || { echo "$USERS_A" "$USERS_B" >&2; fail "users or permissions differ after restore"; }
pass "users and permissions match"
login "$PORT_B" alice "$ALICE_PASSWORD" >/dev/null || fail "alice cannot sign in after restore"
pass "restored password hashes work (alice signs in)"
if login "$PORT_B" kid "$KID_PASSWORD" >/dev/null 2>&1; then
  fail "a user without streaming access can sign in after restore"
fi
pass "per-user permissions are enforced after restore (kid is refused)"
PLAYLISTS_B="$(api "$PORT_B" "$ADMIN_B" GET /api/v1/playlists | jq -S '[.[] | .name] | sort')"
[ "$PLAYLISTS_A" = "$PLAYLISTS_B" ] || fail "playlists differ after restore"
pass "playlists match"
[ "$(curl -fsS "http://127.0.0.1:$PORT_B/api/system/version" | jq -r .instance_name)" = "Recovery Test Server" ] \
  || fail "instance name was not restored"
pass "instance settings restored"
echo "ALL CHECKS PASSED"
