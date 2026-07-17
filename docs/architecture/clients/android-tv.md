# Client Architecture: Android TV

The Android TV client is Playarr's installable Android TV / Google TV
surface. It targets Android TV 9+ (`minSdk 28`) and is distributed as a
normal Leanback-enabled APK.

## Presentation architecture

Android TV hosts the co-deployed Playarr web app in a fullscreen,
hardware-accelerated WebView.

This architecture is the parity mechanism: Android TV runs the same
React components, CSS, routing, authentication, profiles, home rails,
search, Movies, Series, Music, playlists, detail pages, artwork loading,
watch-state UI, and player controls as `clients/tv-web/web`. A separate
Compose recreation would be a second implementation and would stop being
exact as soon as either client changed.

The native layer owns only platform responsibilities:

- TV launcher and Google Play metadata
- app lifecycle and immersive mode
- Play in-app updates
- persisted server bootstrap
- Menu and Back-key behaviour
- WebView cookies and DOM storage
- autoplay and HTML5 fullscreen video
- main-frame connection failure recovery

The configured origin must serve both the Playarr app at `/` and the
Streamarr API at `/api`, matching the backend's co-hosted deployment.

## Remote input

The web app already implements geometric D-pad focus, OK/Enter
activation, long-press context menus, Escape/back navigation, and
player-specific remote shortcuts.

Android WebView forwards D-pad and Enter events to that implementation.
The native shell additionally:

- maps Android Back to WebView history, fullscreen exit, editor close, or
  Activity exit as appropriate
- reserves the remote Menu key for the native server-address editor

Text fields use Android TV's system keyboard.

## Server configuration

`ServerConfigStore` persists the origin in DataStore. The default
emulator address is `http://10.0.2.2:8484`; physical devices normally
use the server's LAN address.

The address editor appears automatically if the main document cannot be
loaded or returns an HTTP error. It can also be opened at any time with
the Menu key. Missing schemes are interpreted as `http://`; only absolute
HTTP and HTTPS addresses are accepted.

Cleartext HTTP is intentionally permitted for private home networks.
Internet-exposed deployments should use HTTPS.

## Authentication

Authentication is exactly the web client's authentication:

- trusted-network transparent login where enabled
- username/password login for full-account mode
- managed profile selection and PIN verification
- refresh-token rotation and browser-local session persistence

Cookies, Local Storage, and DOM Storage are retained by the app's private
WebView data directory.

## Playback

Playback is the web client's normal Shaka/HTML5 media pipeline, including
direct play, HLS, progress reporting, audio/subtitle preferences, player
overlays, and fullscreen requests. The native shell enables media
autoplay and provides the Android custom-view container required by HTML5
fullscreen video.

## Updates

Two update layers remain independent:

- Google Play updates the Android APK, driven by
  `AppUpdateEffect` and the Android-TV compatibility row.
- The co-hosted web bundle updates with the Streamarr deployment, so the
  Android TV layout and features change at the same time as Playarr Web.

## Build and verification

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
cd clients/android-shared
./gradlew :tv-android:testDebugUnitTest :tv-android:assembleDebug
./gradlew :tv-android:lintDebug
```

The debug APK is written to
`clients/tv-android/build/outputs/apk/debug/tv-android-debug.apk`.
