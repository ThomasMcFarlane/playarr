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

# VIDAA / hosted launcher: the server must serve the web client itself (/tv/) so an http:// server works,
# and the hosted sign-in must keep offering that route instead of a dead end.
if 'build_router_with_tv' not in read('backend/src/main.rs'):
    errors.append('server must mount the server-hosted web client at /tv/ (build_router_with_tv)')
if 'serverHostedEntryUrl' not in read('clients/tv-web/web/src/pages/Login.tsx'):
    errors.append('hosted sign-in must offer the server-hosted /tv/ entry for http:// servers')
if 'build:server' not in read('infra/docker/backend.Dockerfile'):
    errors.append('server image must build the server-hosted web client (build:server)')

# Chromecast: the receiver and senders must never refuse an http:// server up front.
# (A failed attempt is explained with the remedy instead; see docs/architecture/clients/cast.md.)
if 'Refusing to load an insecure' in read('clients/tv-web/apps/cast-receiver/src/main.ts'):
    errors.append('cast receiver must not refuse an http:// server up front')
if 'serverIsHttps' in read('clients/android/app/src/main/kotlin/io/playarr/mobile/cast/PlayarrCastAvailability.kt'):
    errors.append('Android cast availability must not depend on the server being https')
if 'serverIsHttps' in read('clients/android/app/src/main/kotlin/io/playarr/mobile/ui/PlayarrExperience.kt'):
    errors.append('Android cast button must be offered for http:// servers')

# TV QR pairing with an http:// server: the server's default verification page is its own /tv/link,
# and the hosted /link page hands off to it.
if '"/tv/link"' not in read('backend/src/main.rs'):
    errors.append('server must default the device verification page to its own /tv/link when it serves the client')
if 'serverHostedEntryUrl' not in read('clients/tv-web/web/src/pages/DeviceLink.tsx'):
    errors.append('hosted /link page must offer the server-hosted /tv/link hand-off for http:// servers')

if errors:
    print('\n'.join(errors)); sys.exit(1)
print('cleartext policy ok')
PY
