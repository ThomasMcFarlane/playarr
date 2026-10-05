#!/usr/bin/env bash
# Renders the regional instances' backup configuration and checks that only
# the age PUBLIC key reaches the pod, that backups are optional and that the
# schema rejects an unusable configuration.
set -euo pipefail

src_chart="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The chart ships neutral (empty) defaults; test against the placeholder
# example values as if they were the defaults, so --set key=null still removes keys.
chart_dir="$(mktemp -d)"
cp -r "$src_chart/." "$chart_dir/"
cp "$src_chart/tests/example-values.yaml" "$chart_dir/values.yaml"
trap 'rm -rf "$chart_dir"' EXIT
rendered="$(mktemp)"
no_backup="$(mktemp)"
trap 'rm -rf "$chart_dir"; rm -f "$rendered" "$no_backup"' EXIT

helm template playarr-dev "$chart_dir" --namespace playarr >"$rendered"
test "$(grep -c '^            - name: PLAYARR_BACKUP_DIR$' "$rendered")" -eq 2
test "$(grep -c 'value: "/data/backups"$' "$rendered")" -eq 2
test "$(grep -c '^            - name: PLAYARR_BACKUP_RECIPIENTS$' "$rendered")" -eq 2
test "$(grep -c 'value: "age1[02-9ac-hj-np-z]\{58\}"$' "$rendered")" -eq 2
test "$(grep -c 'PLAYARR_BACKUP_KEEP_LAST' "$rendered")" -eq 2
if grep -q 'AGE-SECRET-KEY' "$rendered"; then echo "forbidden pattern rendered: line '$LINENO'" >&2; exit 1; fi

# Backups are optional: omitting the block removes every backup variable.
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-a.backup=null \
  --set regionalInstances.playarr-b.backup=null >"$no_backup"
test "$(grep -c 'PLAYARR_BACKUP_' "$no_backup")" -eq 0

# Enabling backups without a recovery public key, or with a malformed one, is rejected.
if helm template playarr-dev "$chart_dir" \
  --set regionalInstances.playarr-a.backup.recipients=null >/dev/null 2>&1; then
  echo "schema accepted backups without a recovery key" >&2
  exit 1
fi
if helm template playarr-dev "$chart_dir" \
  --set 'regionalInstances.playarr-a.backup.recipients[0]=not-a-key' >/dev/null 2>&1; then
  echo "schema accepted a malformed recovery key" >&2
  exit 1
fi
# Off-node replica: optional and off by default; the operator supplies any S3-compatible
# endpoint (the Secret is created out of band), and
# when enabled the keys come from a Secret reference, never from values.
test "$(grep -c 'PLAYARR_BACKUP_S3_' "$rendered")" -eq 0
s3="$(mktemp)"
trap 'rm -rf "$chart_dir"; rm -f "$rendered" "$no_backup" "$s3"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-a.backup.s3.enabled=true \
  --set regionalInstances.playarr-a.backup.s3.endpoint=https://s3.example.com \
  --set regionalInstances.playarr-a.backup.s3.bucket=playarr-backups \
  --set regionalInstances.playarr-a.backup.s3.prefix=playarr-a/ \
  --set regionalInstances.playarr-b.backup.s3.enabled=true \
  --set regionalInstances.playarr-b.backup.s3.endpoint=https://s3.example.com \
  --set regionalInstances.playarr-b.backup.s3.bucket=playarr-backups \
  --set regionalInstances.playarr-b.backup.s3.prefix=playarr-b/ >"$s3"
test "$(grep -c '^            - name: PLAYARR_BACKUP_S3_BUCKET$' "$s3")" -eq 2
test "$(grep -c 'value: "playarr-backups"$' "$s3")" -eq 2
grep -q 'value: "playarr-a/"$' "$s3"
grep -q 'value: "playarr-b/"$' "$s3"
test "$(grep -c '^                  name: "playarr-backup-s3"$' "$s3")" -eq 4
test "$(grep -c '^                  key: "secret-access-key"$' "$s3")" -eq 2
if grep -q '^kind: Secret$' "$s3"; then echo "chart rendered a Secret" >&2; exit 1; fi
# Enabling the replica without an endpoint and bucket is rejected.
if helm template playarr-dev "$chart_dir" \
  --set regionalInstances.playarr-a.backup.s3.enabled=true \
  --set regionalInstances.playarr-a.backup.s3.bucket=null >/dev/null 2>&1; then
  echo "schema accepted an S3 replica without a bucket" >&2
  exit 1
fi
if helm template playarr-dev "$chart_dir" \
  --set regionalInstances.playarr-a.backup.s3.enabled=true \
  --set regionalInstances.playarr-a.backup.s3.endpoint=not-a-url >/dev/null 2>&1; then
  echo "schema accepted a malformed S3 endpoint" >&2
  exit 1
fi
echo "backup chart checks passed"
