#!/usr/bin/env bash
# Fails if any workflow job targets a GitHub-hosted runner label. This repository must only use
# self-hosted runners (`playarr-runners`); the owner enforces the same rule with a GitHub ruleset.
# Checks `runs-on` (scalar, flow list, block list, `group:`/`labels:` mappings, matrix/expression
# values) and any `uses:` of a reusable workflow in another repository (which could hide a hosted label).
set -euo pipefail
cd "$(dirname "$0")/../.."
exec python3 - "$@" <<'PY'
import glob, re, sys

HOSTED = re.compile(r'(?<![\w.-])(ubuntu|windows|macos)-[\w.]+|-latest\b', re.I)
errors = []
files = sorted(glob.glob('.github/workflows/*.yml') + glob.glob('.github/workflows/*.yaml') +
               glob.glob('.github/actions/**/*.yml', recursive=True))
for path in files:
    lines = open(path, encoding='utf-8').read().splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        code = line.split(' #')[0]
        m = re.match(r'^(\s*)(runs-on):\s*(.*)$', code)
        if m:
            indent = len(m.group(1))
            chunk = [m.group(3)]
            j = i + 1
            while j < len(lines):
                nxt = lines[j]
                if nxt.strip() and not nxt.strip().startswith('#') and (len(nxt) - len(nxt.lstrip())) <= indent:
                    break
                chunk.append(nxt.split(' #')[0])
                j += 1
            text = ' '.join(chunk)
            if HOSTED.search(text):
                errors.append(f'{path}:{i + 1}: runs-on targets a GitHub-hosted label: {text.strip()}')
            elif '${{' in text and 'matrix.' in text:
                errors.append(f'{path}:{i + 1}: runs-on uses a matrix expression; use a literal self-hosted label: {text.strip()}')
        m = re.match(r'^\s*uses:\s*(?!\./)(\S+/\S+\.ya?ml@\S+)', code)
        if m and not m.group(1).startswith('example-org/.github/'):
            errors.append(f'{path}:{i + 1}: reusable workflow {m.group(1)} may run on hosted runners; review and allow-list it here')
        i += 1
if errors:
    print('::error::GitHub-hosted runners are forbidden in this repository. Use `runs-on: playarr-runners`.')
    print('\n'.join(errors))
    sys.exit(1)
print(f'ok: no GitHub-hosted runner labels in {len(files)} workflow files')
PY
