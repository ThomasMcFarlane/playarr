#!/usr/bin/env bash
#
# provision-backup-bucket.sh - owner-run: create the private R2 bucket `playarr-backups`, a
# bucket-scoped access key, and the Kubernetes Secret `playarr-backup-s3` (namespace playarr).
#
# It reads CLOUDFLARE_TOKEN_CREATOR from ~/.secrets (override with SECRETS_FILE), the same
# token-creator flow as the other Cloudflare administration, so no dashboard token is needed:
#
#   1. mint a short-lived account token that may create R2 buckets,
#   2. create the bucket (idempotent: an existing bucket is fine),
#   3. mint the bucket-scoped token (object read/write/delete on playarr-backups only),
#   4. derive the S3 key pair (access key id = token id, secret = SHA-256 of the token value),
#   5. apply Secret playarr-backup-s3 with keys access-key-id and secret-access-key,
#   6. put/get/delete one object with the new key as a smoke check,
#   7. revoke the short-lived token (always, even on failure).
#
# Nothing secret is printed or written outside a mode-0700 temp directory that is removed on
# exit. Re-running mints a new bucket token and replaces the Secret; the previous bucket token
# is revoked when its id is passed as OLD_BUCKET_TOKEN_ID.
#
# After it succeeds, enable the destination (backup.s3.enabled: true for playarr-region-a and
# playarr-region-b in infra/kubernetes/helm/playarr-dev/values.yaml) and roll the pods.
set -euo pipefail
umask 077

ACCOUNT_ID="${ACCOUNT_ID:-REDACTED_CF_ACCOUNT_ID}"
BUCKET="${BUCKET:-playarr-backups}"
NAMESPACE="${NAMESPACE:-playarr}"
SECRET_NAME="${SECRET_NAME:-playarr-backup-s3}"
SECRETS_FILE="${SECRETS_FILE:-$HOME/.secrets}"
API="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}"
R2_HOST="${ACCOUNT_ID}.r2.cloudflarestorage.com"

for tool in curl jq kubectl sha256sum; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

workdir="$(mktemp -d)"
temp_token_id=""
creator=""
cleanup() {
  if [[ -n "$temp_token_id" && -n "$creator" ]]; then
    curl -fsS -X DELETE -H "Authorization: Bearer ${creator}" \
      "${API}/tokens/${temp_token_id}" >/dev/null 2>&1 \
      && echo "revoked the temporary bootstrap token" \
      || echo "WARNING: could not revoke temporary token ${temp_token_id}; revoke it in the dashboard" >&2
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

# Token creator, read without echoing (accepts KEY=value or export KEY=value, quotes optional).
creator="$(sed -nE 's/^(export[[:space:]]+)?CLOUDFLARE_TOKEN_CREATOR=//p' "$SECRETS_FILE" | head -n1 | sed -E "s/^[\"']//; s/[\"']\$//")"
[[ -n "$creator" ]] || { echo "CLOUDFLARE_TOKEN_CREATOR not found in ${SECRETS_FILE}" >&2; exit 1; }

cf() { # cf <bearer> <method> <path> [json-body]
  local bearer="$1" method="$2" path="$3" body="${4:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" -H "Authorization: Bearer ${bearer}" -H 'Content-Type: application/json' \
      --data "$body" "${API}${path}"
  else
    curl -sS -X "$method" -H "Authorization: Bearer ${bearer}" "${API}${path}"
  fi
}
ok() { jq -e '.success == true' >/dev/null; }

echo "looking up permission groups"
groups_json="$(cf "$creator" GET /tokens/permission_groups)"
echo "$groups_json" | ok || { echo "permission group lookup failed: $(echo "$groups_json" | jq -c '.errors')" >&2; exit 1; }
gid() { echo "$groups_json" | jq -r --arg n "$1" '.result[] | select(.name == $n) | .id' | head -n1; }
bucket_admin_group="$(gid 'Workers R2 Storage Write')"
item_write_group="$(gid 'Workers R2 Storage Bucket Item Write')"
[[ -n "$bucket_admin_group" && -n "$item_write_group" ]] \
  || { echo "R2 permission groups not found (names changed?)" >&2; exit 1; }

expires="$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)"
echo "minting a one-hour bootstrap token (bucket creation only)"
temp_body="$(jq -n --arg g "$bucket_admin_group" --arg a "com.cloudflare.api.account.${ACCOUNT_ID}" --arg e "$expires" \
  '{name:"playarr-backups-bootstrap", expires_on:$e,
    policies:[{effect:"allow", resources:{($a):"*"}, permission_groups:[{id:$g}]}]}')"
temp_json="$(cf "$creator" POST /tokens "$temp_body")"
echo "$temp_json" | ok || { echo "could not mint the bootstrap token: $(echo "$temp_json" | jq -c '.errors')" >&2; exit 1; }
temp_token_id="$(echo "$temp_json" | jq -r '.result.id')"
temp_token="$(echo "$temp_json" | jq -r '.result.value')"

echo "creating bucket ${BUCKET}"
bucket_json=""
for attempt in 1 2 3 4 5 6; do # a new token takes a few seconds to propagate
  bucket_json="$(cf "$temp_token" POST /r2/buckets "$(jq -n --arg n "$BUCKET" '{name:$n}')" || true)"
  if echo "$bucket_json" | jq -e '.success == true or (.errors[]?.code == 10004)' >/dev/null 2>&1; then
    break # created, or it already exists (10004)
  fi
  sleep 5
done
echo "$bucket_json" | jq -e '.success == true or (.errors[]?.code == 10004)' >/dev/null 2>&1 \
  || { echo "bucket creation failed: $(echo "$bucket_json" | jq -c '.errors' 2>/dev/null)" >&2; exit 1; }

echo "minting the ${BUCKET}-scoped token (object read, write and delete)"
res="com.cloudflare.edge.r2.bucket.${ACCOUNT_ID}_default_${BUCKET}"
bucket_body="$(jq -n --arg g "$item_write_group" --arg r "$res" \
  '{name:"playarr-backups-s3", policies:[{effect:"allow", resources:{($r):"*"}, permission_groups:[{id:$g}]}]}')"
bucket_token_json="$(cf "$creator" POST /tokens "$bucket_body")"
echo "$bucket_token_json" | ok || { echo "could not mint the bucket token: $(echo "$bucket_token_json" | jq -c '.errors')" >&2; exit 1; }
access_key_id="$(echo "$bucket_token_json" | jq -r '.result.id')"
secret_access_key="$(printf '%s' "$(echo "$bucket_token_json" | jq -r '.result.value')" | sha256sum | cut -d' ' -f1)"

printf '%s' "$access_key_id" > "$workdir/access-key-id"
printf '%s' "$secret_access_key" > "$workdir/secret-access-key"
kubectl -n "$NAMESPACE" create secret generic "$SECRET_NAME" \
  --from-file=access-key-id="$workdir/access-key-id" \
  --from-file=secret-access-key="$workdir/secret-access-key" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
echo "applied Secret ${NAMESPACE}/${SECRET_NAME} (keys access-key-id, secret-access-key)"

if [[ -n "${OLD_BUCKET_TOKEN_ID:-}" ]]; then
  cf "$creator" DELETE "/tokens/${OLD_BUCKET_TOKEN_ID}" >/dev/null && echo "revoked previous bucket token"
fi

echo "smoke check: put, get and delete one object (a new key can take ~30 s to propagate)"
printf 'playarr-backup-provision-check' > "$workdir/probe"
url="https://${R2_HOST}/${BUCKET}/.provision-check"
sign=(--aws-sigv4 "aws:amz:auto:s3" --user "${access_key_id}:${secret_access_key}")
smoke_ok=0
for attempt in 1 2 3 4 5 6; do
  if curl -fsS "${sign[@]}" -X PUT --data-binary "@${workdir}/probe" "$url" >/dev/null 2>&1 \
     && [[ "$(curl -fsS "${sign[@]}" "$url" 2>/dev/null)" == "playarr-backup-provision-check" ]] \
     && curl -fsS "${sign[@]}" -X DELETE "$url" >/dev/null 2>&1; then
    smoke_ok=1; break
  fi
  sleep 10
done
if [[ "$smoke_ok" == 1 ]]; then
  echo "OK: bucket ${BUCKET} accepts the new key."
else
  echo "WARNING: the smoke check did not pass; the Secret exists but verify access before enabling backup.s3." >&2
fi
echo "bucket token id (keep to revoke later): ${access_key_id}"
