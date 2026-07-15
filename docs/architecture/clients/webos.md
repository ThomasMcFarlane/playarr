# Client Architecture: webOS (LG Smart TVs)

The webOS client targets LG's webOS Smart TV platform. It is one of three
"TV shell" clients (alongside [Tizen](tizen.md) and the VIDAA fallback in
[`vidaa.md`](vidaa.md)) built on the same underlying web codebase as the
[Web client](web.md), because webOS TVs are, at the runtime level, a
Chromium-based web app host with a native bridge layer bolted on — not a
platform that benefits from a from-scratch native rewrite the way iOS or
Android do.

## Target OS/SDK versions

- **Minimum webOS version:** not pinned anywhere in the real manifest
  (`appinfo.json` has no `minVersion`-style field) — the concrete signal
  that exists is the app's Vite build target, deliberately conservative
  `es2019` (`vite.config.ts`), chosen to cover older webOS Chromium
  engines well enough to run Shaka Player's MSE + EME pipeline. Treat any
  specific version-number floor (this document previously cited webOS TV
  4.x) as unverified until it's actually pinned in `appinfo.json` or
  tested against real hardware.
- **SDK/tooling:** the [webOS TV SDK](https://webostv.developer.lge.com/)
  and its CLI (`ares-cli`: `ares-package`, `ares-install`, `ares-launch`,
  `ares-inspect`), used for packaging and on-device install/debugging.
  **This CLI is not installed in this development environment** — a real,
  current gap, not a permanent one: the app shell in
  `clients/tv-web/apps/tv-webos/` builds a genuine static Vite `dist/`
  bundle (verified via `pnpm --filter @streamarr-tv/app-webos run build`
  as part of the workspace's full `pnpm -r run build`), and `appinfo.json`
  is a real, structurally-valid webOS app manifest, but turning that `dist/`
  into an installable `.ipk` and pushing it to a device or the webOS TV
  Simulator has not been done here — see
  `clients/tv-web/apps/tv-webos/README.md` for the exact `ares-package`/
  `ares-install`/`ares-launch` commands to run once the CLI is available.
  Placeholder `icon.png`/`splash.png` assets referenced by `appinfo.json`
  are also not included yet.

## Tech stack

| Concern | Choice |
|---|---|
| Base codebase | Shared `clients/tv-web/` pnpm workspace packages (`ui-tv`, `player-shaka`, `device-auth`, `domain`, `api-client`, `spatial-nav`), also used by Tizen and the VIDAA fallback |
| UI | React + TypeScript |
| Playback | **Shaka Player** (`@streamarr-tv/player-shaka`, a real `shaka-player` dependency with real TypeScript declarations) attached to an HTML5 `<video>` element |
| DRM | Not implemented — see "Playback / DRM approach" below |
| Platform bridge | No dedicated webOS bridge module exists — see "Code-sharing story" below for what's actually platform-specific |
| Packaging | webOS TV SDK (`ares-package` → `.ipk`) — not yet run in this environment, see above |

`clients/tv-web/apps/tv-webos/` is a thin platform wrapper: `appinfo.json`
(webOS's app manifest — app ID, title, icon, resolution, required
permissions), an `index.html` entry point, and `src/index.tsx`, which
mounts `@streamarr-tv/ui-tv`'s `TvApp` with a `ShakaPlaybackEngine` and a
declared, documented-default set of playback capabilities
(`containers: "mp4,webm"`, `videoCodecs: "h264,h265,vp9"`,
`audioCodecs: "aac,opus"` — there is no real webOS device here to probe
for the actual set). No hand-rolled `webos-bridge.ts` platform-adapter
module exists; see "Code-sharing story" below for what's actually
webOS-specific.

## Playback / DRM approach

Video plays through Shaka Player driving a standard HTML5 `<video>`
element for adaptive HLS/DASH segment loading (identical to how the Web
client plays back — see [`web.md`](web.md#playback--drm-approach) — since
this *is* the same `ShakaPlaybackEngine` adapter, just running inside
webOS's Chromium runtime rather than a desktop browser).

**No DRM is implemented today.** `@streamarr-tv/player-shaka` contains
real, working code to apply an EME `DrmConfig` (Widevine, PlayReady, or
FairPlay system ids) to Shaka's `configure({drm: ...})` call if one is
ever supplied — but nothing supplies one: the real
`GET /api/v1/playback/{media_file_id}` response carries only a
`mode`/`url`, no DRM fields, and there is no `/api/drm/...` endpoint in
the real API surface at all. So the DRM plumbing is real and ready but
currently always inert, identically to the Web client (see
[`web.md`](web.md#playback--drm-approach) for the same point in more
detail). Earlier drafts of this document described a live
`/api/drm/widevine/license` integration that was never actually built —
treat this as a real, current gap, not shipped behaviour.

## Code-sharing story with sibling platforms

webOS shares essentially all of its application logic with Tizen, VIDAA,
and the Web client through `clients/tv-web/packages/`: the `ui-tv` screen
components and containers (Browse/Detail/Player/Pairing), the generated
`api-client`, the auth/session state machine (including the real RFC 8628
device-pairing flow — `PairingScreenContainer` — since webOS is exactly
the kind of remote-control-only device that flow exists for, per
[`../auth-modes.md`](../auth-modes.md)), and the `spatial-nav` d-pad focus
engine are all shared, unmodified, across webOS, Tizen, and VIDAA (the Web
app uses `api-client`/`device-auth`/`domain` but not `ui-tv`/`spatial-nav`
— see [`web.md`](web.md#code-sharing-story-with-sibling-platforms)).

There is **no formal `TvPlatformAdapter` interface** with
`mapRemoteKeyEvent`/`getDeviceId`/`exitApp`-style methods, and no
per-platform bridge file (`webos-bridge.ts` does not exist) — that
abstraction never materialized. What's actually platform-specific per TV
app is narrower and more concrete:

- **Which `PlaybackEngine` is wired in** — webOS uses
  `ShakaPlaybackEngine`, same as VIDAA; Tizen uses `TizenAvplayEngine`
  (see [`tizen.md`](tizen.md)).
- **The declared playback-capabilities set** passed to `TvApp`
  (containers/codecs), a per-app constant.
- **The Vite build target** (webOS: `es2019`; Tizen: `es2018`) and the
  platform packaging manifest (`appinfo.json` here; `tizen-manifest.xml`
  for Tizen; `manifest.json` for VIDAA).
- Remote-key handling itself is **not** platform-specific: `spatial-nav`'s
  `SpatialNavProvider` listens for standard `ArrowUp`/`ArrowDown`/
  `ArrowLeft`/`ArrowRight`/`Enter` `keydown` events, which webOS's and
  Tizen's remote controls both dispatch as regular DOM key events — no
  webOS-specific remote-key mapping code exists or is needed.

This is a narrower, more concrete version of the code-sharing principle in
[`../overview.md`](../overview.md#the-7-client-strategy): one set of
shared packages, thin per-app entry points, rather than three
independently maintained TV codebases or a speculative adapter interface
nothing implements.

## Store submission process and constraints

- Distributed via the **LG Content Store**, submitted through LG's
  developer portal (`webostv.developer.lge.com`), which requires an LG
  developer account and app registration before submission.
- Packaging is an `.ipk` produced by `ares-package` against the app's
  `appinfo.json` and built web bundle; submission goes through LG's review
  process (functional review against LG's TV app guidelines, remote-control
  navigability checks, and a certification pass), with review turnaround
  outside Streamarr's control, similar in spirit to (though generally
  faster than) mobile app store review. This has not happened yet — see
  "Target OS/SDK versions" above for the current tooling gap.
- **No OTA update path exists on this platform.** Every release, including
  patch releases, requires a full new `.ipk` submission and LG's review
  cycle — there is no in-app patching mechanism LG permits, matching
  webOS's row in the per-platform update table in
  [`../../versioning-policy.md`](../../versioning-policy.md). This makes
  the shared `domain` package's `evaluateClientVersion` (the real
  `GET /api/system/version` `CompatibilityEntry`
  `min_supported_version`/`latest_version` comparison — see
  [`web.md`](web.md#self-update--ota-mechanism) for the same mechanism in
  more detail) important in practice: because a webOS client cannot patch
  itself between store releases, the server's compatibility floor and
  deprecation window have to give webOS users realistic time to receive
  and install a store update before the server ever drops support for the
  version a stale webOS build is still using.
