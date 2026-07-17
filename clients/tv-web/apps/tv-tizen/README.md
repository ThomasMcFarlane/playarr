# @streamarr-tv/app-tizen

Streamarr's Tizen TV app shell. Bootstraps `@streamarr-tv/ui-tv` (Browse /
Detail / Player screens + spatial navigation) with `@streamarr-tv/player-avplay`
as the playback engine, since Tizen TVs play video through the native
`webapis.avplay` API rather than a `<video>` element.

## Configuring the API server

This TV has no keyboard, so the app resolves which Streamarr instance to
talk to (via `@streamarr-tv/domain`'s `resolveApiBaseUrl`) in this order:

1. A `?apiBaseUrl=http://192.168.1.50:8484` query param the app was launched
   with.
2. `apiBaseUrl` in `streamarr-config.json`, shipped in this app's `public/`
   directory and copied verbatim into `dist/` (and so into the packaged
   `.wgt`) at build time. An operator can overwrite this file inside the
   installed widget to repoint the app without a rebuild.
3. `DEFAULT_API_BASE_URL` (`http://localhost:8484`), for local development.

## Building

`pnpm --filter @streamarr-tv/app-tizen run build` produces a static
`dist/` bundle via Vite (relative asset paths, conservative `es2018` build
target for Tizen's legacy WebKit runtime).

## Known gap: Tizen Studio CLI is not installed in this environment

Turning `dist/` into an installable `.wgt` and pushing it to a device or the
Tizen TV Simulator requires **Tizen Studio** (`tizen build-web`, `tizen
package`, `tizen install`, `tizen run`), which is not installed here.
`tizen-manifest.xml` in this directory is a real Tizen web-app manifest (W3C
widget config + `tizen:` namespace extensions: application id/package,
`tv` profile, required privileges, TV display settings) so packaging is a
matter of running, once the CLI is available:

```sh
pnpm --filter @streamarr-tv/app-tizen run build
cp tizen-manifest.xml dist/config.xml   # Tizen Studio expects config.xml at the package root
tizen package -t wgt -s <profile-name> -- dist
tizen install -n <package>.wgt -t <device-id>
tizen run -p StrmarrTV1.Streamarr -t <device-id>
```

Placeholder `icon.png` referenced by `tizen-manifest.xml` is not included in
this scaffold and will need a real asset before packaging.

## Known gap: no real Tizen AVPlay runtime here

`packages/player-avplay/src/tizen-avplay.d.ts` is a hand-written stand-in
for the Tizen SDK's own AVPlay type declarations (normally sourced from
Tizen Studio / `@types` equivalents), since there is no Tizen environment
available to pull real ones from. It covers only the API surface the
adapter currently calls.
