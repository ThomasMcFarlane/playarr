# Streamarr / Playarr — Android client tree

This directory is the **Gradle root** for both Android Playarr clients
(`clients/mobile-android/` and `clients/tv-android/`) and the shared
library modules they're built from. It is one Gradle build, not three.

## Why the root lives here, not at `clients/`

This task's write scope was `clients/mobile-android/`,
`clients/tv-android/`, and `clients/android-shared/` only — not `clients/`
itself, which other concurrently-running agents own files in (`clients/shared/`,
`clients/tv-web/`). Putting `settings.gradle.kts` at `clients/` would have
been the more conventional location for a monorepo-wide Android root, but
would have written outside the assigned scope. Instead, `settings.gradle.kts`
here includes `mobile-android` and `tv-android` as sibling projects via an
explicit `projectDir` override:

```kotlin
include(":mobile-android")
project(":mobile-android").projectDir = file("../mobile-android")
```

This is standard, fully-supported Gradle (it's how composite/monorepo
builds routinely include a project that doesn't nest under the settings
file's own directory) — there is still exactly **one** Gradle build, one
version catalog, one set of resolved dependency versions, for all seven
modules.

## Module graph

```
streamarr-android (this root)
├── core-data          — domain model (mirrors streamarr-model) + Retrofit API contract
├── core-domain        — repositories + use cases, built on core-data
├── core-designsystem  — Compose Material 3 theme + shared components (mobile-facing)
├── core-player        — Media3/ExoPlayer wrapper (StreamarrPlayer)
├── core-auth          — RFC 8628 device-authorization-flow client
├── mobile-android     — phone/tablet app (Jetpack Compose + Material 3 + Hilt)
└── tv-android         — Android TV app (Compose + androidx.tv.material3 + Hilt)
```

`core-domain` depends "up" onto `core-data` rather than the reverse a
stricter clean-architecture layering would use — this task's module split
put the domain model and Retrofit contract in `core-data`, not
`core-domain`, so business logic in `core-domain` necessarily consumes
those types directly. See the KDoc on `WorkRepository` in `core-domain`
for the full rationale.

## Building

Requires **JDK 21** (or 17). The environment this was built in defaults
`java`/`JAVA_HOME` to a JDK 26 install, which is too new for the Android
Gradle Plugin; point `JAVA_HOME` at a JDK 21/17 before invoking `./gradlew`:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21   # adjust to your JDK 21 install
cd clients/android-shared

./gradlew projects                 # sanity-check the module graph resolves
./gradlew compileDebugKotlin       # compile every module (all 7)
./gradlew :mobile-android:assembleDebug   # build the phone/tablet debug APK
./gradlew :tv-android:assembleDebug       # build the Android TV debug APK
```

All of the above were run and passed in the environment this project was
built in (Gradle 9.5.1, AGP 9.3.0, Kotlin 2.3.10, compileSdk/targetSdk 37 —
auto-downloaded via the Android SDK manager, licenses were pre-accepted).
Both `assembleDebug` invocations produced real, installable, signed-debug
APKs (`mobile-android-debug.apk`, `tv-android-debug.apk`).

## Notable build-system decisions (verified against the real toolchain, not assumed)

These weren't guesses — each one was hit as a real build failure against
the actual Maven Central / Google Maven state at build time and fixed by
testing against the real toolchain, not by reading changelogs:

- **AGP 9, not 8.x.** AGP 9.0 folded Kotlin compilation into itself
  ("built-in Kotlin") and dropped the separate
  `org.jetbrains.kotlin.android` plugin — that plugin is **not** applied
  anywhere in this tree; only `org.jetbrains.kotlin.plugin.compose` and
  `org.jetbrains.kotlin.plugin.serialization` (genuine Kotlin *compiler
  plugins*, unaffected by the built-in-Kotlin change) are. This wasn't
  optional: `com.google.dagger.hilt.android` 2.60.1 (the current Hilt
  release) hard-requires AGP ≥ 9.0.0, and pinning AGP to the last 8.x
  release to sidestep the migration produced that error directly.
- **KSP for Hilt, not kapt.** `kapt` is incompatible with AGP 9's built-in
  Kotlin. Every module doing Hilt annotation processing uses
  `com.google.devtools.ksp` instead (`ksp(libs.hilt.android.compiler)`).
- **`compileSdk`/`targetSdk` 37, not 36.** Several current AndroidX
  releases (`androidx.core:core:1.19.0`, `androidx.hilt:hilt-navigation-compose:1.4.0`,
  `androidx.lifecycle:lifecycle-runtime-compose:2.11.0`) declare a minimum
  `compileSdk` of 37 in their AAR metadata; building against 36 fails
  `checkDebugAarMetadata` at `assembleDebug` time (compiles fine at
  `compileDebugKotlin`, since that check only runs during full app
  assembly). Android SDK Platform 37 and Build-Tools 37 were not
  preinstalled in this environment; AGP auto-downloaded both successfully
  since the SDK licenses were already accepted.
- **Kotlin pinned to 2.3.10, not the newest 2.3.x/2.4.x.** KSP2's version
  numbering now tracks the exact Kotlin compiler version it was built
  against (no longer the old `<kotlin>-<ksp>` composite version string),
  and the newest published KSP at build time was `2.3.10` — so Kotlin is
  pinned to `2.3.10` to match exactly rather than floating ahead of it.
- **`retrofit2-kotlinx-serialization-converter`'s real coordinates** are
  `com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter`
  (Maven Central) with import path
  `com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory`
  — not `com.jakewharton.retrofit2:...` or `retrofit2.kotlinx.serialization.*`,
  both of which look equally plausible and were the first thing tried.
- **`androidx.tv.foundation` 1.0.0 stable ships almost no public API** —
  `TvLazyRow`/`TvLazyColumn` were removed before the 1.0.0 stable release
  (their functionality moved into plain `androidx.compose.foundation.lazy.LazyRow`/
  `LazyColumn`, which now handle TV focus/scroll well enough on their
  own). `tv-android` therefore uses plain Compose Foundation lazy layouts
  throughout, not `androidx.tv.foundation` lazy variants, even though
  `tv-foundation` is still a declared real dependency per this task's spec.
- **`androidx.tv.material3` has no `CircularProgressIndicator`.** `tv-android`
  pulls in plain `androidx.compose.material3` for that one widget only (see
  the comment in `tv-android/build.gradle.kts`); it is never themed via
  `androidx.compose.material3.MaterialTheme`, only `androidx.tv.material3.MaterialTheme`.
- **Type-safe Navigation Compose's `hasRoute`/`hierarchy` helpers** import
  as `androidx.navigation.NavDestination.Companion.hasRoute` and
  `androidx.navigation.NavDestination.Companion.hierarchy` — both are
  declared inside `NavDestination`'s companion object in the actual
  library source, not as plain top-level package functions the way most
  Kotlin extensions are, which is easy to get wrong by pattern-matching
  against other extension-import examples.

## Version catalog

See `gradle/libs.versions.toml` for the full, real, resolved version set
(Compose BOM `2026.06.01`, Media3 `1.10.1`, Hilt `2.60.1`, Retrofit `3.0.0`,
`androidx.tv` `1.1.0`/`1.0.0`, kotlinx.serialization `1.11.0`, and
everything else). Every version in it was resolved against the live Google
Maven / Maven Central metadata at build time, not from memory.

## What mirrors the backend

`core-data`'s model package (`io.streamarr.shared.data.model`) is a
deliberate, field-for-field Kotlin mirror of the Rust
`backend/crates/streamarr-model` crate (`Work`, `MediaFile`, `Rendition`,
`PlaybackSession`, `PlaybackEvent`, `Series`/`Season`/`Episode`,
`Artist`/`Album`/`Track`, `Author`/`Book`, `Policy`, and a client-safe
`UserProfile`/`Device` projection of `User`/`Device` that drops the
server-only secret fields). Serde's wire representation for Rust's
externally-tagged enums with data-carrying variants (`ExternalProvider::Other`,
`TranscodeReason::Other`, `StopReason::Other`) and the adjacently-tagged
`LeafRef`/internally-tagged-plus-flatten `PlaybackEventKind` is reproduced
exactly via hand-written `KSerializer`s, not approximated.

`core-auth`'s RFC 8628 device-flow shapes
(`DeviceAuthorizationResponse`/`TokenResponse`/`DevicePollResult`) and the
`DeviceAuthApi` endpoint paths/field names come directly from the worked
example in `docs/architecture/auth-modes.md`.

## Known gaps / not implemented

- No `streamarr-api` OpenAPI spec exists yet to generate a real client
  from, so `core-data`'s `StreamarrApi` and `core-auth`'s `DeviceAuthApi`
  are hand-written, best-effort placeholders — see the KDoc atop
  `StreamarrApi.kt`. They are real, compiling, Retrofit-shaped interfaces
  against inferred endpoint paths, not stubs with no bodies, but the exact
  paths/DTOs will need reconciling against the real OpenAPI spec once
  `streamarr-api` publishes one.
- No unit/instrumented tests were written (test dependencies and source
  sets are wired and ready — `testImplementation(libs.junit4)` etc. — but
  no `src/test` files exist yet).
- No app icon/banner artwork beyond simple placeholder vector drawables.
- Release-build signing config is the AGP default debug-keystore fallback;
  no real release signing config exists (correctly out of scope for a
  scaffold).
