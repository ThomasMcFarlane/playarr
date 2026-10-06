#!/usr/bin/env bash
# Playarr is self-hosted: every client must allow cleartext http:// to the server the user enters.
# Fails if a client's platform configuration forbids it.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec python3 - <<'PY'
import plistlib, re, sys
errors = []

def read(p):
    return open(p, encoding='utf-8').read()

for p in ('clients/ios/Resources/Info.plist', 'clients/apple-tv/Supporting/Info.plist'):
    ats = plistlib.load(open(p, 'rb')).get('NSAppTransportSecurity', {})
    if ats.get('NSAllowsArbitraryLoads') is not True:
        errors.append(f'{p}: NSAppTransportSecurity.NSAllowsArbitraryLoads must be true')

for p in ('clients/android/app/src/main/res/xml/network_security_config.xml',
          'clients/android/app/src/play/res/xml/network_security_config.xml'):
    s = read(p)
    if 'cleartextTrafficPermitted="true"' not in s or 'cleartextTrafficPermitted="false"' in s:
        errors.append(f'{p}: base-config must set cleartextTrafficPermitted="true"')

for p in ('clients/android/app/src/main/AndroidManifest.xml', 'clients/android/app/src/play/AndroidManifest.xml',
          'clients/android/app/src/sideload/AndroidManifest.xml'):
    if 'usesCleartextTraffic="false"' in read(p):
        errors.append(f'{p}: usesCleartextTraffic must not be false')

x = read('clients/xbox/src/Playarr.Xbox/Package.appxmanifest')
for cap in ('internetClient', 'privateNetworkClientServer'):
    if not re.search(rf'<Capability\s+Name="{cap}"', x):
        errors.append(f'Xbox manifest: capability {cap} is required')

if not re.search(r'<access\s+origin="\*"', read('clients/tv-web/apps/tv-tizen/tizen-manifest.xml')):
    errors.append('Tizen manifest: <access origin="*"> is required')

if errors:
    print('\n'.join(errors)); sys.exit(1)
print('cleartext policy ok')
PY
