# Client Architecture: Android Mobile

The Android Mobile client is a phone/tablet-first Playarr app: library
browsing, search, downloads, and playback against a Streamarr server on the
LAN or over the internet (subject to the server's `Policy.allow_remote_access`
— see [`../auth-modes.md`](../auth-modes.md)).

## Target OS/SDK versions

- **Minimum SDK:** 26 (Android 8.0 Oreo) — chosen as the floor that still
  covers the long tail of active Android devices without carrying
  compatibility shims for pre-`ExoPlayer`-viable or pre-scoped-storage
  Android versions.
- **Target/compile SDK:** 37 at time of writing (several current AndroidX
  releases the app depends on declare a minimum `compileSdk` of 37 in their
  AAR metadata), bumped each year to track Google Play's target-API-level
  requirement (Play requires apps to target an API level within one year of
  the latest major release to remain installable/updatable for new users —
  see [`../../versioning-policy.md`](../../versioning-policy.md) for how
  this policy requirement interacts with Streamarr's own release cadence).
- **Kotlin** 2.3.10, **Jetpack Compose** (Material 3) for all UI — no XML
  layouts or Views-based screens in new code.

## Tech stack

| Concern | Choice |
|---|---|
| Language | Kotlin 2.3.10 |
| UI | Jetpack Compose (Material 3), Compose BOM `2026.06.01` |
| DI | Hilt 2.60.1 (KSP annotation processing, not `kapt` — AGP 9's built-in-Kotlin compilation dropped `kapt` support) |
| Networking | Retrofit 3.0.0 + OkHttp, hand-written client (`core-data`'s `StreamarrApi`) checked field-for-field against `backend/openapi/streamarr.yaml`, not a codegen-tool-generated client |
| Serialization | kotlinx.serialization, with a global `JsonNamingStrategy.SnakeCase` mapping idiomatic-camelCase Kotlin properties to the spec's snake_case wire fields |
| Async | Kotlin Coroutines + Flow |
| Local persistence | Jetpack DataStore (Preferences) — server base URL, device id, and the access/refresh token pair; no Room/offline-downloads layer exists yet |
| Playback | Media3 (`androidx.media3` 1.10.1, ExoPlayer's successor) |
| Build | AGP 9.3.0 (built-in Kotlin compilation), Gradle 9.5.1, compileSdk/targetSdk 37 |
| Image loading | Coil 3 (`coil3.compose.AsyncImage`), wired into `core-designsystem`'s shared `PosterCard` component |

## Auth/session flow

Both apps' `core-auth` module implements the two real session paths
documented in [`../auth-modes.md`](../auth-modes.md), both landing in the
same DataStore-backed `TokenStore` so every downstream caller (`core-data`'s
`StreamarrHttpClient`) sees one session regardless of which path produced it:

- **Transparent trusted-network login (Android Mobile's path).**
  `SessionManager.ensureAccessToken()` calls `POST /api/v1/auth/login` on
  demand, the first time a call that needs a bearer token has none cached.
  Under the server's default `AuthMode::TrustedNetwork`, a login from a
  trusted source IP succeeds with no credentials at all — there is no
  sign-in screen in the mobile app; a session is acquired silently the
  first time it's needed.
- **RFC 8628 device pairing** is implemented in the same `core-auth`
  module (`DeviceAuthClient`) and is exercised by Android TV's pairing
  screen (see [`android-tv.md`](android-tv.md)); Mobile links against the
  same module but has no pairing UI of its own, since a phone/tablet has a
  keyboard and benefits from the login path instead.

Only three endpoints actually require the resulting `Authorization: Bearer`
header: `POST /api/v1/requests`, `.../{id}/approve`, `.../{id}/reject`. Every
catalog/playback/system call stays unauthenticated by the server's own
design, and `StreamarrHttpClient`'s auth interceptor only invokes the token
provider for those three write paths.

## Playback / DRM approach

Playback goes through Media3's `ExoPlayer`
(`ExoPlayerStreamarrPlayer`), which plays back whatever
`GET /api/v1/playback/{media_file_id}` returns — a `PlaybackInfoResponse`
carrying just a `mode` (`direct` or `hls`) and a `url` — identically
regardless of whether the server chose direct-play or an on-demand
transcode session (see
[`../overview.md`](../overview.md#the-tdarr-background-vs-on-demand-transcode-split)).
When `mode` is `hls`, the client forces Media3's HLS extractor via an
explicit MIME-type hint, since a freshly-spun-up transcode session's URL
doesn't necessarily end in `.m3u8`.

**No DRM is implemented today.** There is no `DefaultDrmSessionManager`
wiring, no Widevine license call, and no `/api/drm/...` endpoint anywhere
in the real API surface (`backend/openapi/streamarr.yaml` has no DRM
paths at all) — playback is unencrypted HLS/direct-play only. This is a
real, current gap relative to earlier drafts of this document, which
described a Widevine license-proxy endpoint that was never actually built.
Revisit this section if/when server-side content protection is added; for
now, "content protection" here means nothing more than requiring a
bearer-token-gated request/approval flow before a title becomes playable.

## Code-sharing story with sibling platforms

Android Mobile and Android TV (see
[`android-tv.md`](android-tv.md)) live in **one Gradle build rooted at
`clients/android-shared/`**, which includes `clients/mobile-android/` and
`clients/tv-android/` as sibling projects via an explicit `projectDir`
override in `settings.gradle.kts` (not a nested `clients/android/` tree —
that layout never materialized; the real module graph lives across three
top-level `clients/` directories that together form one build):

```
clients/
  android-shared/       # Gradle root: settings.gradle.kts, version catalog, 5 shared library modules
    core-data/             # domain models + hand-written Retrofit API client
    core-domain/           # repositories + use cases, built on core-data
    core-designsystem/     # Compose Material 3 theme + shared components (mobile-facing)
    core-player/           # Media3/ExoPlayer wrapper (StreamarrPlayer)
    core-auth/              # RFC 8628 device-flow client + trusted-network login + TokenStore
    core-update/            # Play In-App Updates coordinator + version-compatibility evaluator
  mobile-android/        # phone/tablet app (Jetpack Compose + Material 3 + Hilt)
  tv-android/            # Android TV app (Compose + androidx.tv.material3 + Hilt)
```

`core-data`, `core-domain`, `core-player`, `core-auth`, and `core-update`
are shared unmodified between the two app modules — they hold everything
that doesn't depend on the shape of the input device or screen: the API
client, the auth/session state machine (mirroring
[`../auth-modes.md`](../auth-modes.md)), Media3 setup, and the auto-update
evaluator. `core-designsystem` is mobile-facing (wraps
`androidx.compose.material3.MaterialTheme`); `tv-android` has its own
`TvTheme.kt` wrapping `androidx.tv.material3.MaterialTheme` instead, built
from the same color tokens so both apps share one source of truth for
brand color despite using two different Material component libraries. Each
app module's own `ui/screens/` and `di/` diverge where the platforms
genuinely diverge: touch gestures and bottom-nav for mobile versus D-pad
focus handling, a 10-foot-UI layout, and the pairing gate for TV.

There is no code sharing with iOS beyond the OpenAPI contract itself
(different language, different UI framework); see
[`ios.md`](ios.md).

## Store submission process and constraints

- Distributed via **Google Play** (Play Console), with the AAB (Android
  App Bundle) format required for new submissions.
- Standard Play review: content rating questionnaire, data-safety
  disclosure (the app talks only to the user's own configured Streamarr
  server — no third-party analytics/ad SDKs, which simplifies this
  disclosure considerably), and target-API-level compliance as above.
- Because this is a client for **self-hosted, user-owned servers** rather
  than a service Streamarr itself operates, the listing is explicit that
  the app requires the user to already run or have access to a Streamarr
  server — avoiding any implication of hosted content Google would need to
  review directly.
- Updates use Google Play's **In-App Updates API**, wired through
  `core-update`'s `AppUpdateCoordinator`/`UpdateAvailabilityEvaluator` and
  each app's `AppUpdateEffect.kt`. The evaluator compares this build's own
  version against `GET /api/system/version`'s per-platform
  `CompatibilityEntry` (`latest_version`/`min_supported_version`, the real
  wire shape — not an integer `apiVersion`/`apiVersionFloor` scheme):
  **Flexible** mode (background download, user-initiated install prompt)
  when only `latest_version` has moved ahead, escalating to **Immediate**
  mode (blocking, forced-update flow) once the running build has fallen
  below `min_supported_version` — see the per-platform update-mechanism
  table in [`../../versioning-policy.md`](../../versioning-policy.md) for
  the exact trigger condition shared with Android TV.

## Request-management screens

Both apps ship a real `RequestsScreen` and `WorkDetailScreen` — not a
placeholder — wired to `core-domain`'s `SubmitMediaRequestUseCase`,
`ListMediaRequestsUseCase`, and `DecideMediaRequestUseCase` against the
real `POST/GET /api/v1/requests` and `.../{id}/approve`/`.../{id}/reject`
endpoints. `WorkDetailScreen`'s "Play" action uses the real,
server-resolved `media_file_id` the catalog endpoint now cross-links per
leaf (`WorkDetailSchema.mediaFileId` for a movie; the sibling field on
`EpisodeDetailSchema`/`TrackDetailSchema`/`BookDetailSchema` for a series'
episodes / an artist's tracks / an author's books), falling back to a
non-playable row when a given leaf's file hasn't been resolved yet
(`media_file_id == null`).
