#!/usr/bin/env bash
# Native-against-web parity regression is manual (owner ruling 8 October 2026): CI tests the web styles as the source of
# truth on every pull request, and the native parity captures (Apple, Android, Roku, Fire TV) are workflow_dispatch only.
# Fails when a workflow named like a parity or capture run (file name containing "parity" or "capture") has any trigger
# other than workflow_dispatch. Also fails when ci-required lists such a job.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec python3 - "$@" <<'PY'
import glob, re, sys

errors = []
for path in sorted(glob.glob('.github/workflows/*.yml') + glob.glob('.github/workflows/*.yaml')):
    name = path.rsplit('/', 1)[-1].lower()
    text = open(path, encoding='utf-8').read()
    if not re.search(r'parity|capture', name):
        continue
    m = re.search(r'^on:\s*\n((?:[ \t]+.*\n|\n)+)', text, re.M)
    if not m:
        errors.append(f'{path}: no `on:` block found')
        continue
    triggers = re.findall(r'^  ([a-z_]+):', m.group(1), re.M)
    extra = [t for t in triggers if t != 'workflow_dispatch']
    if extra or 'workflow_dispatch' not in triggers:
        errors.append(f'{path}: native parity runs must be workflow_dispatch only, found: {", ".join(triggers) or "none"}')
if errors:
    for e in errors:
        print(f'::error::{e}')
    sys.exit(1)
print('Parity workflows are manual (workflow_dispatch only)')
PY
