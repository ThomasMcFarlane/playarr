# Client Architecture: LG webOS TV

Playarr for LG webOS is a packaged distribution of the complete
[`clients/tv-web/web`](../../../clients/tv-web/web/) application. It shares the
same profiles, home, search, library, playlists, settings, authentication, and
player implementation as the hosted Web client. The webOS project is a thin
platform and packaging layer, not a second UI and not the earlier `ui-tv`
Browse/Detail/Player skeleton.

## Supported runtime

- **Developer-package floor:** webOS 23 (Chromium 94). The Vite build targets ES2018, which
  is conservative for that generation's Chromium runtime while retaining the
  full React and Shaka application. Its vendor-only CSS transform emits a
  theme-colour fallback before each newer `color-mix()` value. Older generations are not supported
  until representative devices prove the full bundle and player.
- **Manifest limitation:** LG's `appinfo.json` has no minimum-OS field. Store
  release targeting/certification must enforce the floor; the manifest cannot.
- **Tooling:** LG's current `@webos-tools/cli` provides `ares-package`,
  `ares-install`, `ares-launch`, and `ares-inspect`. The older webOS TV CLI is
  deprecated. See the app [README](../../../clients/tv-web/apps/tv-webos/README.md)
  for build and physical-TV installation commands.

The checked-in environment can build and validate the package-ready `dist/`
tree without LG tooling. Producing an IPK requires `ares-package`; installing
and certifying it requires a webOS TV or simulator plus the corresponding LG
developer/store access.

## Runtime integration

`apps/tv-webos/index.html` launches the webOS bootstrap, which installs the
visibility lifecycle policy and imports the real Web entry point. The webOS
Vite config supplies two compile-time facts to the shared runtime:

- `__PLAYARR_PLATFORM__ = "tv-webos"`, so API sessions, device login, version
  compatibility, TV interaction policy, and playback negotiation identify the
  installed LG client correctly.
- `__APP_VERSION__`, sourced from the webOS package version and validated
  against `appinfo.json` before packaging.

The native bundle uses `base: "./"` and the shared entry point selects hash
routing for `tv-webos`. Both are required: an installed webOS app loads from
its package path rather than an HTTP origin, so root-absolute assets and
server-rewritten browser routes do not exist. Package preparation scans every
emitted HTML/CSS file and fails if Vite emits a root-absolute asset reference.

On a generic first launch, the packaged login screen requests a hosted
`playarr.app` device-link code. The viewer scans its QR code (or visits the
displayed URL and types the short code), chooses a Playarr Server/profile in
the browser, and approves the TV. Playarr then transfers the chosen server
addresses into the same known-server group, authentication, profile, and
session persistence used by the hosted client. An operator-specific build may
instead seed an absolute server default in `playarr-config.json`; the generic
package deliberately ships that field empty.

## Remote navigation and lifecycle

`disableBackHistoryAPI` is explicitly `true`, which makes webOS deliver Magic
Remote Back to Playarr. Shared modal, drawer, mini-player, and route handlers
get the event first. The platform bootstrap returns only an unclaimed Back
press at the hash-router entry route to `webOS.platformBack()`, so nested UI is
closed before the TV returns Home. The same bootstrap normalises LG's numeric
Play/Pause/Stop/Rewind/Fast-forward codes into the standard media keys used by
the shared player.

`handlesRelaunch` is also `false`, leaving foreground reactivation to webOS.
The platform bootstrap listens to standard and legacy WebKit visibility events
and pauses active audio/video when the app is hidden. It also pauses media on
`pagehide`, preventing playback from continuing as the system suspends or
terminates the app. The shared player observes the media-element pause event,
so its UI state stays consistent.

## Playback and DRM

Playback uses the same `ShakaPlaybackEngine` and HTML5 `<video>` surface as the
Web client. The server negotiates direct play or HLS from the LG capability
profile; unsupported sources fall back to the server's H.264/AAC transcode
path. Audio/subtitle selection, resume state, quality choice, analytics, and
authenticated segment recovery remain shared Web behavior rather than
webOS-only implementations.

The player has EME configuration plumbing, but the current playback API does
not return DRM configuration or license endpoints. The package therefore does
not claim Widevine or PlayReady playback until the server-side contract and
real-device certification exist.

## Package contract

`appinfo.json` contains only current webOS TV metadata. Its app ID is
`com.playarr.tv`; the main page is `index.html`; Back history and system
relaunch behavior are explicit. Launcher assets are checked in at LG's required
80×80 (`icon.png`) and 130×130 (`largeIcon.png`) sizes. The shared
`playarr-icon.svg` mark is also packaged because the login and TV chrome load
it at runtime through Vite's relative base URL.

`scripts/prepare-package.mjs` is a production gate. It validates:

- required manifest fields and webOS version syntax;
- exact equality between manifest and JavaScript package versions;
- history/relaunch settings required by the shared router and lifecycle;
- exact PNG dimensions for both launcher assets; and
- relative emitted HTML/CSS asset URLs.

`ares-package dist -o out` produces a versioned IPK. Release automation may
publish it as `playarr-webos.ipk`, but must not rewrite the internal application
ID or version.

## Distribution blockers

Repository-local buildability is separate from release completion. A public LG
Content Store release still needs LG Seller Lounge registration, product
metadata and store artwork, device/model targeting, representative hardware
tests, and LG certification. There is no in-app patch mechanism for this
packaged client; fixes require a new versioned IPK and store release. The
shared version-compatibility banner therefore remains important for giving TV
users a realistic update window.
