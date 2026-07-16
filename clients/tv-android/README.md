# tv-android

The Playarr Android TV / Google TV app, targeting Android TV 9+
(`minSdk 28`).

Its presentation layer is the co-hosted Playarr web client running in a
fullscreen, hardware-accelerated WebView. This is deliberate: Android TV
renders the same React tree, CSS, routes, sign-in, profiles, libraries,
playlists, detail pages, artwork, and player as `clients/tv-web/web`, so
the two surfaces cannot visually or functionally drift.

The native Kotlin shell remains responsible for:

- Android TV and Google TV launcher integration
- Google Play in-app updates
- the saved Streamarr server address
- D-pad, Menu, and Back-key integration
- HTML5 fullscreen video
- connection failure and server-address recovery

Press the remote **Menu** button to change the server address. If the
configured server cannot serve the Playarr app, the address editor opens
automatically.

## Build

This is not a standalone Gradle project. It is included by
`../android-shared/settings.gradle.kts`.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
cd ../android-shared
./gradlew :tv-android:testDebugUnitTest :tv-android:assembleDebug
```

Output:

```text
clients/tv-android/build/outputs/apk/debug/tv-android-debug.apk
```

## Runtime contract

The configured address must serve both:

- the Playarr web app at `/`
- the Streamarr API under `/api`

This matches Streamarr's co-hosted production deployment. Plain HTTP is
allowed because self-hosted home-LAN servers commonly do not terminate
TLS; HTTPS remains preferred for internet-exposed instances.

## Key files

```text
src/main/kotlin/io/streamarr/tv/
├── MainActivity.kt
├── ui/screens/WebAppScreen.kt
├── update/AppUpdateEffect.kt
└── di/AuthModule.kt
```

The earlier native Compose screens remain in the module temporarily as
reference code, but `MainActivity` no longer routes to them.
