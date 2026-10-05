#!/usr/bin/env bash
# Fails when tracked files contain deployment-specific data. This repository is
# public: real hostnames, node names, addresses, hostPaths, registry hosts and
# image pins belong in the private deployment (GitOps) repository instead.
#
# Two kinds of check:
#   1. Generic, in this file: any IPv4 literal that is not a documentation,
#      loopback or special-purpose address and not listed in
#      scripts/ci/env-data-allowlist.txt; absolute /home/<user>/ paths; tailnet
#      MagicDNS names (*.ts.net).
#   2. Deployment-specific, from the ENV_DATA_DENYLIST environment variable (an
#      extended regex, case-insensitive; CI passes it from a repository secret
#      so the internal names it describes are not published here).
#
# Every tracked file is scanned, including TASKS.md, CHANGELOG.md and the tasks.d/ and changelog.d/
# fragments, so a fragment cannot reintroduce environment data before the train folds it.
#
# Output names files and line numbers only, never the matched text, so a
# finding does not leak through public CI logs.
#
# Usage: scripts/ci/check-env-data.sh            (from anywhere in the repo)
#        ENV_DATA_DENYLIST='internal\.example|node-7' scripts/ci/check-env-data.sh
set -euo pipefail
shopt -s lastpipe # report() runs as the last pipeline stage and must set fail in this shell
cd "$(dirname "$0")/../.."

allow=scripts/ci/env-data-allowlist.txt
spec=(. ":!$allow" ':!scripts/ci/check-env-data.sh')
while IFS= read -r p; do spec+=(":!$p"); done < <(sed -n 's/^path: //p' "$allow")

fail=0
report() { # <title> ; stdin: path:line[:...]
  local hits
  hits=$(cut -d: -f1,2 | sort -u)
  if [ -n "$hits" ]; then
    echo "::error::$1"
    printf '%s\n' "$hits"
    fail=1
  fi
}

# 1a. IPv4 literals.
{ git grep -nIoE '(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)' -- "${spec[@]}" || true; } |
  awk -v allow="$allow" '
    BEGIN { while ((getline l < allow) > 0) if (l ~ /^ip: /) ok[substr(l, 5)] = 1 }
    {
      line = $0
      n = index(line, ":"); file = substr(line, 1, n - 1); rest = substr(line, n + 1)
      n = index(rest, ":"); lno = substr(rest, 1, n - 1); m = substr(rest, n + 1)
      if (!match(m, /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/)) next
      ip = substr(m, RSTART, RLENGTH)
      split(ip, o, ".")
      for (i = 1; i <= 4; i++) if (o[i] + 0 > 255 || (length(o[i]) > 1 && substr(o[i], 1, 1) == "0")) next
      a = o[1] + 0; b = o[2] + 0; c = o[3] + 0
      if (ip in ok) next
      if (ip == "0.0.0.0" || ip == "255.255.255.255" || a == 127 || a >= 224) next
      if (a == 169 && b == 254) next
      if ((a == 192 && b == 0 && c == 2) || (a == 198 && b == 51 && c == 100) || (a == 203 && b == 0 && c == 113)) next
      print file ":" lno
    }' | report "IPv4 address that is not a documentation/allow-listed example (use RFC 5737: 192.0.2.x, 198.51.100.x, 203.0.113.x)"

# 1b. Personal home directories and tailnet names.
{ git grep -nIE '(^|[[:space:]"'"'"'`(=@:])/home/[A-Za-z][A-Za-z0-9._-]*/|[A-Za-z0-9-]+\.ts\.net\b' -- "${spec[@]}" || true; } |
  report "absolute /home/<user>/ path or tailnet (*.ts.net) name"

# 2. Deployment-specific names (hostnames, node names, registry hosts, ...).
if [ -n "${ENV_DATA_DENYLIST:-}" ]; then
  { git grep -nIiE -e "$ENV_DATA_DENYLIST" -- "${spec[@]}" || true; } |
    report "deployment-specific name (ENV_DATA_DENYLIST); move it to the deployment repository or use a placeholder (example.com, <node>)"
else
  echo "ENV_DATA_DENYLIST not set: deployment-specific name check skipped"
fi

if [ "$fail" -ne 0 ]; then
  echo "Deployment data belongs in the private GitOps repository; see AGENTS.md, 'Deployment configuration'." >&2
  exit 1
fi
echo "env-data guard: clean"
