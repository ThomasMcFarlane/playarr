#!/usr/bin/env bash
# Renders the regional instances' backup configuration and checks that only
# the age PUBLIC key reaches the pod, that backups are optional and that the
# schema rejects an unusable configuration.
set -euo pipefail

chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rendered="$(mktemp)"
no_backup="$(mktemp)"
trap 'rm -f "$rendered" "$no_backup"' EXIT

helm template playarr-dev "$chart_dir" --namespace playarr >"$rendered"
test "$(grep -c '^            - name: PLAYARR_BACKUP_DIR$' "$rendered")" -eq 2
test "$(grep -c 'value: "/data/backups"$' "$rendered")" -eq 2
test "$(grep -c '^            - name: PLAYARR_BACKUP_RECIPIENTS$' "$rendered")" -eq 2
test "$(grep -c 'value: "age1[02-9ac-hj-np-z]\{58\}"$' "$rendered")" -eq 2
test "$(grep -c 'PLAYARR_BACKUP_KEEP_LAST' "$rendered")" -eq 2
if grep -q 'AGE-SECRET-KEY' "$rendered"; then echo "forbidden pattern rendered: line '$LINENO'" >&2; exit 1; fi

# Backups are optional: omitting the block removes every backup variable.
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-region-a.backup=null \
  --set regionalInstances.playarr-region-b.backup=null >"$no_backup"
test "$(grep -c 'PLAYARR_BACKUP_' "$no_backup")" -eq 0

# Enabling backups without a recovery public key, or with a malformed one, is rejected.
if helm template playarr-dev "$chart_dir" \
  --set regionalInstances.playarr-region-a.backup.recipients=null >/dev/null 2>&1; then
  echo "schema accepted backups without a recovery key" >&2
  exit 1
fi
if helm template playarr-dev "$chart_dir" \
  --set 'regionalInstances.playarr-region-a.backup.recipients[0]=not-a-key' >/dev/null 2>&1; then
  echo "schema accepted a malformed recovery key" >&2
  exit 1
fi
# Off-node replica: off by default (the Secret is created out of band), and
# when enabled the keys come from a Secret reference, never from values.
test "$(grep -c 'PLAYARR_BACKUP_S3_' "$rendered")" -eq 0
s3="$(mktemp)"
trap 'rm -f "$rendered" "$no_backup" "$s3"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-region-a.backup.s3.enabled=true \
  --set regionalInstances.playarr-region-b.backup.s3.enabled=true >"$s3"
test "$(grep -c '^            - name: PLAYARR_BACKUP_S3_BUCKET$' "$s3")" -eq 2
test "$(grep -c 'value: "playarr-backups"$' "$s3")" -eq 2
grep -q 'value: "playarr-region-a/"$' "$s3"
grep -q 'value: "playarr-region-b/"$' "$s3"
test "$(grep -c '^                  name: "playarr-backup-s3"$' "$s3")" -eq 4
test "$(grep -c '^                  key: "secret-access-key"$' "$s3")" -eq 2
if grep -q '^kind: Secret$' "$s3"; then echo "chart rendered a Secret" >&2; exit 1; fi
# Enabling the replica without an endpoint and bucket is rejected.
if helm template playarr-dev "$chart_dir" \
  --set regionalInstances.playarr-region-a.backup.s3.enabled=true \
  --set regionalInstances.playarr-region-a.backup.s3.bucket=null >/dev/null 2>&1; then
  echo "schema accepted an S3 replica without a bucket" >&2
  exit 1
fi
if helm template playarr-dev "$chart_dir" \
  --set regionalInstances.playarr-region-a.backup.s3.enabled=true \
  --set regionalInstances.playarr-region-a.backup.s3.endpoint=not-a-url >/dev/null 2>&1; then
  echo "schema accepted a malformed S3 endpoint" >&2
  exit 1
fi
echo "backup chart checks passed"
