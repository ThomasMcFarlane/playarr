# Client Architecture: Samsung Tizen TV

Playarr for Samsung Tizen is a packaged distribution of the complete
[`clients/tv-web/web`](../../../clients/tv-web/web/) application. It shares the
same profiles, home, search, libraries, playlists, settings, authentication,
and player UI as the hosted Web client. The Tizen project is a platform and
packaging layer, not a second UI and not the earlier `ui-tv` screen skeleton.

## Supported runtime

- **Developer-package floor:** Tizen 7.0 (2023 Samsung TVs), declared by
  `required_version="7.0"` in the widget manifest. The Vite bundle targets
  ES2018, and shared runtime and CSS code stay within Tizen 7's Chromium 94
  floor. The vendor-only CSS transform expands `inset` plus emits theme-colour
  fallbacks before `color-mix()` values. Older generations are not supported
  until the complete application and native player are proven on
  representative TVs.
- **Tooling:** Tizen Studio with Samsung TV Extensions, Samsung Certificate
  Extension, Web CLI, and SDB. The checked-in environment can build and test
  the package-ready tree but does not contain Tizen Studio or Samsung Product
  APIs, so it cannot sign a WGT or replace real-device certification.
- **Signing:** every WGT must be signed. A physical-TV developer package needs
  a Samsung author/distributor certificate profile whose distributor
  certificate authorises the TV DUID. Partner certificates are feature- and
  submission-dependent, not a universal requirement for this app.

Exact source-build, signing, Developer Mode, install, and launch commands are
in the app [README](../../../clients/tv-web/apps/tv-tizen/README.md).

## Shared runtime integration

`apps/tv-tizen/src/index.ts` loads the optional packaged server configuration,
installs Samsung lifecycle/input behavior, and imports the real Web entry
point. Its Vite config supplies:

- `__PLAYARR_PLATFORM__ = "tv-tizen"`, so API sessions, device login, version
  compatibility, TV interaction policy, and playback negotiation identify the
  Samsung app correctly; and
- `__APP_VERSION__`, sourced from the widget package version.

The package uses `base: "./"`; the shared entry point selects hash routing for
installed TVs. Those choices make all assets and routes work from a widget
package path rather than an HTTP server with rewrite rules. The generic
package leaves `streamarr-config.json` empty. On a fresh install it obtains a
short-lived QR/manual code from `playarr.app`; the phone-side link flow chooses
an existing profile/server and returns a server-scoped device authorisation to
the TV. No localhost default or TV-keyboard server entry is part of that
generic flow. An operator build can still embed an absolute HTTP(S) server URL
before packaging.

## Remote navigation and lifecycle

Directional navigation, focus restoration, native scroll containers,
on-screen keyboard behavior, and standard media controls remain shared Web
features. The Tizen bootstrap adds the platform responsibilities:

- registers Samsung's media-key names through `tvinputdevice` and normalises
  numeric key codes to standard keyboard events;
- lets Back traverse hash-router history on nested routes, but displays an
  explicit Exit/Stay confirmation when Back is pressed at the entry route;
- closes AVPlay and restores screen-saver policy during termination; and
- gives the player Samsung visibility changes so AVPlay can suspend and
  restore without losing application state.

Samsung supplies the four directional keys, Enter, and Back without explicit
registration. The manifest requests `tv.inputdevice` for the additional media
keys.

## Native playback

Tizen replaces the Web client's Shaka/HTML `<video>` engine with
`TizenAvplayEngine`, while retaining the same player page and surrounding
application. `index.html` loads Samsung's `$WEBAPIS/webapis/webapis.js` and
contains the required `application/avplayer` object. AVPlay renders into that
native plane; the React controls remain above it.

The adapter provides the shared playback-engine contract and additionally
handles Samsung-specific behavior:

- AVPlay's `open` → streaming properties → `prepareAsync` state order;
- direct and HLS playback selected by the server capability negotiation;
- playback-session cookie injection after `open`, when AVPlay first permits
  the `COOKIE` property, and before manifest preparation;
- position, duration, buffering, completion, error, and track state;
- explicit initial audio selection after PLAYING for multi-audio sources,
  plus later audio/text track selection;
- WebVTT sidecar conversion to Samsung-supported SAMI in `wgt-private-tmp`
  before `setExternalSubtitlePath`;
- native plane sizing with letterbox display mode, keeping both AVPlay's
  1920x1080 display rectangle and the `<object>` CSS bounds aligned with the
  full-screen or minimised React player;
- AVPlay suspend/restore across visibility changes; and
- screen-saver disable only while playing, restored on pause, completion,
  error, teardown, and exit.

DRM properties use AVPlay's three-argument
`setDrm(type, "SetProperties", json)` contract. The app does not claim
protected-content support today because the real playback API still supplies
no DRM configuration or licence endpoints, and the package intentionally does
not request Samsung's unused DRM privilege. The dormant code path is
infrastructure, not proof of an end-to-end DRM product; enabling it would also
require the matching manifest privilege and certificate/release validation.

The AVPlay declarations are a deliberately small structural interface rather
than a bundled Samsung SDK. Runtime behavior therefore remains gated on a
physical Tizen TV even when unit tests cover call order and state transitions.

## Package contract

`tizen-manifest.xml` declares the TV profile, Tizen 7.0 floor, full-HD
viewport, network/input/filesystem privileges, cross-origin access, and
application ID `StrmarrTV1.Streamarr`. `scripts/prepare-package.mjs` copies it
to the required package-root `config.xml`, adds the launcher icon and runtime
configuration, and rejects a build missing the Product API script or AVPlay
surface.

`scripts/package-wgt.mjs` refuses to package without an explicit Samsung
certificate profile. It runs `tizen package`, verifies exactly one generated
WGT, then copies it to the stable local name `playarr-tizen.wgt` for release
automation. The internal application ID and version are not rewritten.

## Distribution blockers

Repository-local buildability is separate from release completion. A public
Smart Hub release still needs Samsung Seller Office registration, store
metadata/artwork, model and country targeting, representative-hardware tests,
and Samsung certification. A developer WGT signed for one set of TV DUIDs is
not a generic public installer; broad distribution must use Samsung's approved
store/signing path. There is no in-app patch channel for a packaged release,
so fixes require a new versioned WGT and distribution review.
