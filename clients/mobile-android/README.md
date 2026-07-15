# mobile-android

The Playarr Android Mobile app (phone/tablet): Jetpack Compose + Material 3,
Hilt DI, Media3 playback, targeting Android 8.0+ (`minSdk 26`).

This module is **not** a standalone Gradle project — it's included by the
root build at `../android-shared/settings.gradle.kts`. See
[`../android-shared/README.md`](../android-shared/README.md) for the full
module graph, build instructions, and the (real, hit-and-fixed) build
toolchain notes.

Quick build:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21   # AGP needs 17/21; the environment default was too new
cd ../android-shared
./gradlew :mobile-android:assembleDebug
```

This was run successfully in the environment this project was built in —
it produces a real, packaged, installable `mobile-android-debug.apk`.

## Structure

```
src/main/kotlin/io/streamarr/mobile/
├── StreamarrMobileApp.kt      — @HiltAndroidApp Application
├── MainActivity.kt            — single Activity, hosts the Compose tree
├── navigation/                — type-safe Navigation Compose routes + bottom-nav Scaffold
├── ui/screens/                — Home, Library, Player, Settings (+ their ViewModels)
└── di/                        — Hilt modules wiring core-data/core-player/core-auth factories
```

`core-data`, `core-domain`, `core-designsystem`, `core-player`, and
`core-auth` (all in `../android-shared/`) stay framework-agnostic where
Hilt is concerned — this module's `di/` package is where their factory
functions (`StreamarrHttpClient.create(...)`, `ExoPlayerStreamarrPlayer.create(...)`,
`AuthHttpClient.create(...)`) get bound into the Hilt graph.

## No blockers

Gradle sync, `compileDebugKotlin`, and `assembleDebug` all succeeded
against the real Android SDK/toolchain in this environment (SDK Platform
37 and Build-Tools 37 were auto-downloaded; licenses were already
accepted). There is no missing-SDK-component or license blocker to report
here.
