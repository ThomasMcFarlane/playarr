# tv-android

The Playarr Android TV / Google TV app: Jetpack Compose +
`androidx.tv.material3` (10-foot-UI Material components with built-in
d-pad focus states), Hilt DI, Media3 playback, targeting Android TV 9+
(`minSdk 28`).

This module is **not** a standalone Gradle project — it's included by the
root build at `../android-shared/settings.gradle.kts`. See
[`../android-shared/README.md`](../android-shared/README.md) for the full
module graph, build instructions, and the (real, hit-and-fixed) build
toolchain notes.

Quick build:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21   # AGP needs 17/21; the environment default was too new
cd ../android-shared
./gradlew :tv-android:assembleDebug
```

This was run successfully in the environment this project was built in —
it produces a real, packaged, installable `tv-android-debug.apk`.

## Structure

```
src/main/kotlin/io/streamarr/tv/
├── StreamarrTvApp.kt           — @HiltAndroidApp Application
├── MainActivity.kt             — single Activity, hosts the Compose tree
├── navigation/
│   ├── Routes.kt                — type-safe routes, including Pairing
│   ├── AuthGateViewModel.kt      — decides Pairing vs. Home startDestination
│   └── StreamarrTvNavHost.kt     — gates the real NavHost behind pairing state
├── ui/
│   ├── theme/TvTheme.kt          — androidx.tv.material3.MaterialTheme wrapper
│   └── screens/                  — Pairing, Home, Library, Player, Settings
└── di/                          — Hilt modules (mirrors mobile-android's)
```

## The RFC 8628 pairing flow is real, end to end

Per `docs/architecture/auth-modes.md`, TV is the one Playarr client that
actually needs device-code pairing rather than username/password. This
isn't a placeholder screen: `PairingScreen` drives `core-auth`'s real
`DeviceAuthClient.requestDeviceCode()` → displays the user code +
verification URL → polls `pollUntilResolved()` (which implements the RFC's
`authorization_pending`/`slow_down`/`expired_token` backoff semantics) →
on approval, persists the token via `TokenStore` (DataStore-backed) and
navigates into the main app. `AuthGateViewModel` re-routes back to Pairing
if `TokenStore` is ever cleared (Settings → Sign out).

There is, of course, no real Streamarr server behind
`BuildConfig.STREAMARR_BASE_URL` in this environment to actually approve a
pairing against — the flow is real and compiles/type-checks against the
documented contract, but was not exercised against a live server.

## Design-system note

`tv-android` does **not** use `core-designsystem`'s `StreamarrTheme` (that
wraps `androidx.compose.material3.MaterialTheme`, tuned for phones). It
has its own `TvTheme.kt` wrapping `androidx.tv.material3.MaterialTheme`,
built from the same `StreamarrPalette` color tokens in `core-designsystem`
so both apps share one source of truth for brand color despite using two
different Material component libraries. The one exception is
`CircularProgressIndicator`, which `androidx.tv.material3` doesn't ship —
see `build.gradle.kts` for that dependency and the reasoning.

## No blockers

Gradle sync, `compileDebugKotlin`, and `assembleDebug` all succeeded
against the real Android SDK/toolchain in this environment (SDK Platform
37 and Build-Tools 37 were auto-downloaded; licenses were already
accepted). There is no missing-SDK-component or license blocker to report
here.
