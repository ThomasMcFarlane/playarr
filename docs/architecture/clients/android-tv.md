# Client Architecture: Android TV

The Android TV client is the 10-foot, D-pad/remote-driven Playarr app for
Android TV and Google TV devices (set-top boxes, TV-integrated Android TV,
Chromecast with Google TV). It shares its Gradle project and most of its
non-UI code with Android Mobile — see
[`android-mobile.md`](android-mobile.md#code-sharing-story-with-sibling-platforms)
for the module layout.

## Target OS/SDK versions

- **Minimum SDK:** 28 (Android TV 9 / API 28), chosen to cover Android TV
  and Google TV devices sold from roughly 2018 onward, which is the large
  majority of the addressable TV hardware still receiving use, while
  avoiding the compatibility burden of much older Android TV (5.x/6.x)
  releases that predate reliable Media3-equivalent playback stacks and
  modern DRM session handling.
- **Target/compile SDK:** 37, tracked on the same annual cadence as Android
  Mobile for the same Play target-level policy reasons (see
  [`android-mobile.md`](android-mobile.md#target-ossdk-versions) for why
  37, not a round "current year" number).
- Fire TV (Amazon's Fire OS fork, distributed via the Amazon Appstore
  rather than Google Play) is **not** a currently supported target. The
  Android TV APK is Fire-OS-compatible at the AOSP/API level in principle,
  but Amazon Appstore submission, Fire TV-specific certification, and
  Amazon's remote/input differences are out of scope for the initial
  7-client strategy and would be a separate, explicitly scoped addition if
  ever taken on.

## Tech stack

Same core stack as Android Mobile (Kotlin 2.3.10, Media3 1.10.1, Hilt
2.60.1, Coroutines/Flow — see
[`android-mobile.md`](android-mobile.md#tech-stack) for the full table),
with a hand-written Retrofit client (`core-data`'s `StreamarrApi`) rather
than a codegen-tool-generated one, and the TV-specific UI layer built on
**Jetpack Compose for TV** (`androidx.tv.material3` 1.1.0) rather than the
standard Material 3 Compose used by the mobile module — Compose for TV
provides the D-pad focus-handling primitives that a touch-oriented Compose
screen doesn't need. Two real deviations from a clean TV-Compose stack,
both hit and fixed against the real toolchain rather than assumed: plain
`androidx.compose.foundation.lazy.LazyRow`/`LazyColumn` are used instead of
`androidx.tv.foundation`'s TV-specific lazy layouts (`TvLazyRow`/
`TvLazyColumn` were removed before `tv-foundation` 1.0.0 stable — their
focus/scroll behaviour moved into the plain Compose Foundation versions),
and `CircularProgressIndicator` comes from plain
`androidx.compose.material3` for that one widget only, since
`androidx.tv.material3` doesn't ship one. The `tv-android` app module
(included in the same Gradle build as `mobile-android` via
`clients/android-shared/settings.gradle.kts` — see
[`android-mobile.md`](android-mobile.md#code-sharing-story-with-sibling-platforms))
depends on the same shared `core-data`/`core-domain`/`core-player`/
`core-auth`/`core-update` modules as `mobile-android`. One tech-stack
divergence worth flagging: Android Mobile's `PosterCard` (Coil-backed
image loading, see [`android-mobile.md`](android-mobile.md#tech-stack))
lives in `core-designsystem`, which `tv-android` deliberately doesn't
depend on (it has its own `TvTheme.kt` instead — see "Code-sharing story
with sibling platforms" below) — `tv-android`'s own screens render library
items as plain text rows today, with no Coil/`AsyncImage` usage anywhere
in the module yet.

## Auth: the RFC 8628 pairing flow is real, end to end

Per [`../auth-modes.md`](../auth-modes.md), TV is the one Playarr client
that actually needs device-code pairing rather than a keyboard-driven
sign-in. This isn't a placeholder screen: `PairingScreen` drives
`core-auth`'s real `DeviceAuthClient.requestDeviceCode()` → displays the
user code and verification URL → polls `pollUntilResolved()` (which
implements RFC 8628 §3.5's `authorization_pending`/`slow_down`/
`expired_token` backoff semantics against the real
`POST /api/v1/oauth/device/code` / `POST /api/v1/oauth/token` endpoints) →
on approval, persists the token pair via the same DataStore-backed
`TokenStore` Android Mobile's trusted-network login writes to, and
navigates into the main app. `AuthGateViewModel` re-routes back to Pairing
if `TokenStore` is ever cleared (Settings → Sign out).

## Playback / DRM approach

Identical to Android Mobile: Media3 `ExoPlayer` against whatever
`GET /api/v1/playback/{media_file_id}` returns (direct-play or
on-demand-transcoded HLS — see
[`android-mobile.md`](android-mobile.md#playback--drm-approach) for the
exact response shape). **No DRM is implemented today** — the same real
gap noted for Android Mobile applies identically here; there is no
Widevine session manager wiring and no `/api/drm/...` endpoint in the real
API surface. Once real content protection exists, Android TV hardware
being overwhelmingly Widevine L1-capable would make it the platform most
likely to benefit from full-resolution 4K/HDR licensed playback, but that
is a forward-looking note, not a description of what runs today —
currently the only reason direct-play is preferred when a device can
decode the source natively is to avoid the cost of a transcode session,
not any DRM consideration.

## Work detail screen and playback resolution

Same as Android Mobile (see
[`android-mobile.md`](android-mobile.md#work-detail-screen-and-playback-resolution)):
`tv-android`'s `WorkDetailScreen`, a Compose-for-TV version built on the
same `core-domain` use cases, resolves the server's real cross-linked
`media_file_id` per leaf for the "Play" action.

## Code-sharing story with sibling platforms

Covered in full in
[`android-mobile.md`](android-mobile.md#code-sharing-story-with-sibling-platforms):
`core-data`/`core-domain` (API client, auth state) and `core-player`
(Media3 wiring) are shared unmodified with Android Mobile; only the UI
module (and `core-designsystem` vs. `tv-android`'s own `TvTheme.kt`)
diverges, because D-pad navigation and a 10-foot layout have no honest
overlap with a touch UI. There is no code sharing with the webOS/Tizen/
VIDAA "TV shell" web codebase (see [`webos.md`](webos.md)) — that shell is
a distinct, TypeScript/React-based approach used specifically because
*those* platforms are web-runtime TVs; Android TV is native Kotlin and
gains nothing from sharing with a web codebase.

## Store submission process and constraints

- Distributed via **Google Play**, using the same Play Console listing
  mechanics as Android Mobile but declared as TV-form-factor-supporting
  (the manifest's `<uses-feature android:name="android.software.leanback">`
  and a `LEANBACK_LAUNCHER` intent filter on the TV entry activity are
  required for the app to surface in the Android TV/Google TV launcher and
  be discoverable in Play's TV category).
- Requires TV-specific store assets beyond what the mobile listing needs:
  a banner image (320×180) for the Android TV launcher tile, and TV-form
  factor screenshots, submitted as part of the same Play Console
  application (Android Mobile and Android TV can ship as either one
  universal listing with both form factors or as separate listings; the
  monorepo produces both APK variants from the shared codebase either way).
- No touch-only UI elements are permitted anywhere in the `tv-android`
  module's navigable surface — Play's TV review explicitly checks that
  every interactive element is reachable via D-pad focus traversal, not
  just tap/click, which is enforced in practice by building exclusively on
  Compose for TV's focus-aware components rather than reusing mobile
  Compose widgets.
- Updates: same **Play In-App Updates API** mechanism as Android Mobile,
  driven by the same `CompatibilityEntry`-based evaluator (Flexible by
  default, Immediate once below the server's `min_supported_version`) —
  see [`android-mobile.md`](android-mobile.md#store-submission-process-and-constraints)
  and [`../../versioning-policy.md`](../../versioning-policy.md).
