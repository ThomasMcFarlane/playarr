#!/usr/bin/env bash
# Fails if any workflow job targets a self-hosted runner. This repository is public, so every job
# must run on a GitHub-hosted runner (ubuntu-*, windows-*, macos-*): a self-hosted runner on a
# public repository would run code from untrusted fork pull requests on owner-controlled machines.
# Checks `runs-on` (scalar, flow list, block list, `group:`/`labels:` mappings) and rejects
# matrix expressions, which could hide a self-hosted label. Reusable workflows from other
# repositories are rejected unless allow-listed, because they choose their own runners.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec python3 - "$@" <<'PY'
import glob, os, re, sys

ALLOWED_REUSABLE = tuple(p.strip() for p in os.environ.get('ALLOWED_REUSABLE_WORKFLOWS', '').split(',') if p.strip())

HOSTED = re.compile(r'^(ubuntu|windows|macos)-[\w.-]+$', re.I)
errors = []
files = sorted(glob.glob('.github/workflows/*.yml') + glob.glob('.github/workflows/*.yaml') +
               glob.glob('.github/actions/**/*.yml', recursive=True))
for path in files:
    lines = open(path, encoding='utf-8').read().splitlines()
    for i, line in enumerate(lines):
        code = line.split(' #')[0]
        m = re.match(r'^(\s*)runs-on:\s*(.*)$', code)
        if m:
            indent = len(m.group(1))
            chunk = [m.group(2)]
            j = i + 1
            while j < len(lines):
                nxt = lines[j]
                if nxt.strip() and not nxt.strip().startswith('#') and (len(nxt) - len(nxt.lstrip())) <= indent:
                    break
                chunk.append(nxt.split(' #')[0])
                j += 1
            text = ' '.join(chunk).strip()
            if '${{' in text:
                errors.append(f'{path}:{i + 1}: runs-on uses an expression; use a literal hosted label: {text}')
                continue
            # Tokens: labels from scalars, flow lists and block lists; `group:`/`labels:` mappings fail.
            if re.search(r'\b(group|labels)\s*:', text):
                errors.append(f'{path}:{i + 1}: runs-on group/labels select runner groups, which are self-hosted: {text}')
                continue
            tokens = [t for t in (tok.strip('\'" -') for tok in re.split(r'[\s,\[\]]+', text.replace('- ', ' '))) if t]
            bad = [t for t in tokens if not HOSTED.match(t)]
            if not tokens or bad:
                errors.append(f'{path}:{i + 1}: runs-on must be a GitHub-hosted label (ubuntu-*, windows-*, macos-*): {text}')
        m = re.match(r'^\s*uses:\s*(?!\./)(\S+/\S+\.ya?ml@\S+)', code)
        if m and not (ALLOWED_REUSABLE and m.group(1).startswith(ALLOWED_REUSABLE)):
            errors.append(f'{path}:{i + 1}: reusable workflow {m.group(1)} may choose its own runners; review and allow-list it here')
if errors:
    print('::error::Public repositories must use GitHub-hosted runners (ubuntu-latest, windows-latest, macos-latest).')
    print('\n'.join(errors))
    sys.exit(1)
print(f'ok: every runs-on is a GitHub-hosted label in {len(files)} workflow files')
PY
