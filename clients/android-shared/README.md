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
├── mobile-android     — phone/tablet host for the responsive Playarr Web bundle
└── tv-android         — Android TV host for the same Playarr Web bundle
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

Invite-approval notifications use Firebase Cloud Messaging. Supply the same
Firebase project's public Android values at build time (never its service
account key):

```bash
./gradlew assembleDebug \
  -PfirebaseApiKey=<api-key> \
  -PfirebaseMobileApplicationId=<mobile-application-id> \
  -PfirebaseTvApplicationId=<tv-application-id> \
  -PfirebaseProjectId=<project-id> \
  -PfirebaseSenderId=<sender-id>
```

When these properties are absent, both Android apps build normally with push
registration disabled. Server-side Firebase credentials are configured
separately through `GOOGLE_APPLICATION_CREDENTIALS`.

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

## What mirrors the backend (updated for the real OpenAPI spec)

`core-data`'s `StreamarrApi` (`data/remote/StreamarrApi.kt`) is now a real,
hand-written Retrofit client checked field-for-field against
`backend/openapi/streamarr.yaml`: 8 paths (system health/ready/version,
catalog list/get/search, playback-info, webhooks), typed against that
spec's actual schemas, not an inferred/guessed surface. `core-data`'s
model package (`io.streamarr.shared.data.model`) mirrors exactly the
schemas that spec defines (`Work`, `CatalogPage`, `WorkDetail`/`WorkChildren`,
`Season`/`Episode`, `Album`/`Track`, `Book`, `PlaybackInfoResponse`,
`VersionEnvelope`) rather than a broader `streamarr-model` crate mirror
that included concepts (`MediaFile`, `Rendition`, `Policy`,
`UserProfile`/`Device`, playback-session analytics) the real API surface
doesn't actually expose yet. Serde's wire representation for the spec's
`oneOf`/externally-tagged schemas (`ExternalProvider::Other`,
`WorkChildrenSchema`'s mixed unit/tuple variants) is reproduced exactly
via hand-written `KSerializer`s, verified against literal spec-shaped
JSON in `core-data`'s unit tests, not approximated. The Kotlin-to-wire-field
mapping is a global `JsonNamingStrategy.SnakeCase` on
`StreamarrHttpClient.json` (camelCase Kotlin properties, snake_case JSON)
rather than a `@SerialName` on every field.

Streamarr's request-management feature (an Overseerr/Jellyseerr-style
submit/approve/reject flow) has been removed entirely -- it duplicated an
already-existing tool and was out of Streamarr's actual scope (auth +
catalog enumeration + streaming only). Nothing in this tree implements
`requests` paths any more, and `StreamarrHttpClient`'s bearer-auth-attachment
mechanism (which existed solely to gate those three write calls) was
removed along with it; every request this client sends is unauthenticated,
matching the rest of the real API surface.

`core-auth`'s RFC 8628 device-flow endpoints (`POST /api/v1/oauth/device/code`,
`POST /api/v1/oauth/token`) and error codes
(`authorization_pending`/`slow_down`/`expired_token`/`access_denied`) come
directly from `backend/openapi/streamarr.yaml`'s `oauth` tag, including the
real JSON (not form-urlencoded) request bodies and the `client_platform`
enum field (no free-form `client_id`).

The operator server base URL is a runtime-configurable,
`DataStore`-backed setting (`core-data`'s `ServerConfigStore`, default
`http://10.0.2.2:8484` for the Android emulator's host-loopback
convention) surfaced on each app's Settings screen, not a value baked into
the build via `BuildConfig`. Both apps ship a network security config
permitting cleartext HTTP, since a self-hosted Streamarr instance is
commonly plain HTTP on a home LAN.

## Known gaps / not implemented

- The real spec has no endpoint that maps a work/episode/track/book to the
  `MediaFile`/`media_file_id` that `GET /api/v1/playback/{media_file_id}`
  expects (there is no `MediaFile` schema in the spec at all yet). Each
  app's `WorkDetailScreen` uses the tapped leaf's own id (or the work's own
  id for a movie) as a best-effort stand-in, documented in that file's
  KDoc, until the catalog schema exposes real media-file identifiers.
- Catalog search (`GET /api/v1/catalog/search`) is wired through
  `core-domain`'s `SearchCatalogUseCase` but has no dedicated search
  screen yet.
- No instrumented (`androidTest`) tests were written; `core-data`/`core-auth`
  unit tests decode literal spec-shaped JSON and exercise the RFC 8628
  error-code mapping against a fake `DeviceAuthApi`, but nothing in this
  pass could be verified against a live server (it wasn't running).
- No app icon/banner artwork beyond simple placeholder vector drawables.
- Release builds remain unsigned locally unless all four `ANDROID_KEYSTORE_*`
  environment variables are present. The `android-v*` release workflow supplies
  the permanent signing identity, builds the universal app module, verifies the APK and
  publishes it through `playarr.app`.

## Publishing the Android APK

`mobile-android` is the published universal package. Its manifest supports both normal and
Leanback launchers, while runtime UI-mode detection selects touch or television behaviour.
`tv-android` remains as historical migration code and is not a published release artefact.
Create one durable release keystore, back it up offline, and configure these secrets in
the `release-android` GitHub environment:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `CLOUDFLARE_R2_API_TOKEN`

The repository-level `CLOUDFLARE_ACCOUNT_ID` secret is shared with the web deployment.
Pushing `android-v1.2.3` derives a monotonic version code, tests and signs the APK,
uploads an auditable GitHub release, and replaces the stable object served at:

- `https://playarr.app/downloads/android/playarr-android.apk`

The first published signing certificate is permanent: later APKs signed with another
certificate cannot update existing installations.
