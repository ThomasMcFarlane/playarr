# Streamarr / Playarr Android client tree

This directory is the Gradle root for one native Playarr Android application
and its shared libraries. `clients/mobile-android/` is the only application
module and produces the universal phone, tablet, Android TV, and Google TV APK.

## Module graph

```text
streamarr-android
├── core-auth          account and device authentication
├── core-data          server configuration, models, and Retrofit APIs
├── core-designsystem  shared Compose theme and components
├── core-domain        repositories and use cases
├── core-player        Media3/ExoPlayer wrapper
├── core-update        update policy and Play update integration
└── mobile-android     responsive native application
```

The application is included as a sibling project from `settings.gradle.kts`:

```kotlin
include(":mobile-android")
project(":mobile-android").projectDir = file("../mobile-android")
```

## Build

Use JDK 21:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
cd clients/android-shared
./gradlew :mobile-android:testDebugUnitTest \
  :mobile-android:assembleDebug \
  :mobile-android:lintDebug
```

The APK is written to
`clients/mobile-android/build/outputs/apk/debug/mobile-android-debug.apk`.

Firebase invite notifications accept the public Android project values through
the `firebaseApiKey`, `firebaseMobileApplicationId`, `firebaseProjectId`, and
`firebaseSenderId` Gradle properties. With no values supplied, the app builds
normally with push registration disabled.

## Responsive application contract

- The package is `io.streamarr.mobile` on every Android device.
- The manifest exposes both normal and Leanback launcher categories.
- Runtime UI-mode detection selects `android-mobile` or `android-tv` request
  headers without changing the package or APK.
- Phone layouts use Playarr's floating navigation pill, touch-sized landscape
  rails, edge-to-edge artwork, and compact detail surfaces.
- Wide and television layouts use the same native components with Playarr's
  editorial stage, right-hand content rails, immersive mode, and D-pad focus
  scaling.
- Sign-in owns the account's Streamarr URL. No server URL is compiled into the
  application.
- All visible screens are native Compose and playback uses Media3. There is no
  WebView presentation layer.

Cleartext HTTP is permitted because self-hosted Streamarr servers commonly run
on a private LAN. Public deployments should use HTTPS.

## Publishing

Release tags use `android-v<semver>`. The release build requires the four
`ANDROID_KEYSTORE_*` environment variables and publishes one signed APK plus a
checksum and update manifest at:

- `https://playarr.app/downloads/android/playarr-android.apk`

The first published signing certificate is permanent: later APKs signed with a
different certificate cannot update existing installations.
