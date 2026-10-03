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
! grep -q 'AGE-SECRET-KEY' "$rendered"

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
echo "backup chart checks passed"
