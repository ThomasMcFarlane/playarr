# Playarr for Roku

Playarr for Roku is a native SceneGraph channel for browsing and playing a
viewer’s own Playarr Server library. It uses Roku-native focusable lists and the
native `Video` node, so directional navigation, list scrolling and playback do
not depend on a browser or JavaScript focus shim.

## Current flow

1. Enter the base URL of a Playarr Server on first launch.
2. Link the Roku through Playarr Server’s RFC 8628 device-authorisation flow.
3. Select the linked household profile.
4. Browse the available catalogue, open a title and play its first available
   media file.
5. Report playback start, pause, resume, heartbeat and stop events to the
   Playarr Server session API.

The server URL, rotating refresh token and current access token are stored in
the Roku registry. Signing out removes all session material. No credentials,
tokens or private server addresses are part of the channel package.

The checked-in server contract does not yet define a `tv-roku` value in
`ClientPlatform`. Until that server enum is extended, this channel uses the
contract’s supported `web` compatibility identity for device authorisation and
client headers. The identity is isolated in `source/Config.brs` so it can be
changed in one place when `tv-roku` becomes available.

## Validate and package

Python 3 and `zip` are the only local requirements for the lightweight checks
and sideload package:

```sh
cd clients/roku
make validate
make package
```

The package is written to `build/playarr-roku.zip`. `make validate` checks the
manifest, parses every SceneGraph XML file, rejects unsafe package contents,
verifies the expected API surface, and runs the contract tests.

## Sideload to a development Roku

Enable Developer Mode on the Roku, then provide its local address and the
developer password without writing either value to the repository:

```sh
export ROKU_DEV_TARGET=192.0.2.10
export ROKU_DEV_PASSWORD='replace-with-device-password'
make deploy
```

The deploy script uploads the package to Roku’s development installer over the
local network. Store signing, channel artwork and physical-device certification
remain release-engineering steps outside this source-only client.

## Source layout

- `source/`: entry point, API transport, configuration and registry-backed
  session storage.
- `components/`: SceneGraph scene, poster renderer and background API task.
- `scripts/`: deterministic validation, packaging and development deployment.
- `tests/`: API-path, focus-navigation and secret-safety contract checks.
