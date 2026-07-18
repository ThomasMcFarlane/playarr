# Client Architecture: Android

Playarr ships one Android APK for phones, tablets, Android TV, and Google TV.
It hosts the shared responsive web application and selects the touch or D-pad
profile from Android's runtime UI mode. There is no second Android catalogue,
player UI, package, or download to keep synchronised.

## Platform baseline

- **Minimum SDK:** 26 (Android 8.0 Oreo).
- **Compile/target SDK:** 37.
- **Build:** AGP 9.3.0, Gradle 9.5.1, Kotlin 2.3.10.
- **Native shell:** Jetpack Compose, Hilt, DataStore, Google Play In-App
  Updates, and Firebase Cloud Messaging.
- **Presentation:** a hardware-accelerated Android WebView loading the
  server-co-hosted `clients/tv-web/web` bundle.

## Shared presentation

`MainActivity` mounts `AndroidWebAppScreen`, which loads the configured
Streamarr origin. The server serves both the API and built Playarr assets in
the normal deployment, so the app receives the same bundle that a browser
or a browser opens. The WebView appends `PlayarrAndroidMobile/<version>` on
touch devices or `PlayarrAndroidTV/<version>` on televisions. The same binary
therefore selects phone safe areas and image picking or the fixed 1920 by 1080
TV viewport, D-pad navigation, and signed sideload updater as appropriate.

The responsive web layer owns:

- profile selection and full-account sign-in;
- home rails, library directories, search, playlists, and settings;
- touch navigation and safe-area-aware bottom navigation;
- detail pages, direct/HLS playback, quality controls, and the minimised
  player; and
- custom profile-avatar cropping after Android supplies an image URI.

Android owns only the platform boundary:

- WebView lifecycle, cookies, DOM storage, Android Back, external links,
  fullscreen video, and file selection;
- a native server-address recovery sheet for first run or connection
  failure, also reachable from the shared Server settings page;
- Play Store update flows; and
- Firebase invite notifications.

The device-specific boundary is selected inside the same native wrapper:
televisions fix a 1920 by 1080 CSS viewport and translate remote input, while
touch devices use the physical viewport, system safe area, image picker, and
Google Play update channel.

## Authentication and native session bridge

The web bundle performs the same trusted-network or full-account login used
in a browser and persists the active session in origin-scoped local storage.
An optional `PlayarrAndroidMobile` JavaScript bridge mirrors that token pair
into the native DataStore-backed `TokenStore`. This lets the existing native
Firebase service register its installation against the same signed-in
profile without creating an independent login flow.

The configured server is trusted to supply the app document. Main-frame
links to a different origin are opened by Android rather than loaded into
the bridged WebView, and file/content access is disabled on the WebView.

## Server bootstrap

`ServerConfigStore` persists the origin that serves Playarr. The default
`http://10.0.2.2:8484` targets a backend running on the Android emulator's
host. A physical device uses the operator's LAN or HTTPS address. Missing
schemes default to LAN HTTP; only absolute HTTP(S) origins are accepted.

If the initial document fails, the native connection sheet remains visible
until a valid host loads. Once connected, the same sheet is available from
Settings > Server connection > Change app host.

## Playback and updates

Playback is implemented once in the web player's direct/HLS pipeline. The
native host enables inline media without an extra user gesture and presents
WebChrome fullscreen custom views for video. Android Back is offered to the
shared player first so active or minimised sessions close cleanly before
WebView history changes.

Touch installs use Google Play In-App Updates. `AppUpdateEffect` evaluates
the server's `android-mobile` compatibility row and starts Flexible or
Immediate Play flows as documented in
[`../../versioning-policy.md`](../../versioning-policy.md). The hosted web
bundle can update independently with the server, so visual fixes do not
require duplicating or republishing native screen code. Television sideloads
use the signed `playarr.app` manifest and checksum-verified APK installer.

## Distribution

The release artefact is one Android App Bundle for Google Play and one signed
APK for direct installation across every supported Android device. The listing
must state that the app connects to a self-hosted Streamarr server. Cleartext
HTTP remains permitted for private LAN deployments; HTTPS is recommended for
remote access.
