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
- **Target/compile SDK:** 34 (Android 14 / Google TV), tracked on the same
  annual cadence as Android Mobile for the same Play target-level policy
  reasons.
- Fire TV (Amazon's Fire OS fork, distributed via the Amazon Appstore
  rather than Google Play) is **not** a currently supported target. The
  Android TV APK is Fire-OS-compatible at the AOSP/API level in principle,
  but Amazon Appstore submission, Fire TV-specific certification, and
  Amazon's remote/input differences are out of scope for the initial
  7-client strategy and would be a separate, explicitly scoped addition if
  ever taken on.

## Tech stack

Same core stack as Android Mobile (Kotlin, Media3, Hilt, Retrofit/OkHttp
generated client, Coroutines/Flow), with the TV-specific UI layer built on
**Jetpack Compose for TV** (`androidx.tv.material3`) rather than the
standard Material 3 Compose used by the mobile module — Compose for TV
provides the D-pad focus-handling primitives (`Modifier.focusable`,
TV-aware `LazyRow`/`LazyColumn` focus restoration) that a touch-oriented
Compose screen doesn't need. The `tv/` app module in
`clients/android/` depends on the same shared `core/` and `playback/`
modules as `mobile/`.

## Playback / DRM approach

Identical to Android Mobile: Media3 `ExoPlayer` against direct-play or
on-demand-transcoded HLS, Widevine DRM via
`DefaultDrmSessionManager`, license issuance from the same
`/api/drm/widevine/license` endpoint. Android TV hardware is
overwhelmingly Widevine L1, so this is typically the path that gets
full-resolution 4K/HDR playback where the source supports it — worth
calling out because Android TV is the client most likely to be pointed at
a 4K HDR library on a real television, making direct-play (avoiding
on-demand transcode entirely when the device can decode the source
natively) the preferred and most common path in practice.

## Code-sharing story with sibling platforms

Covered in full in
[`android-mobile.md`](android-mobile.md#code-sharing-story-with-sibling-platforms):
`core/` (API client, auth state) and `playback/` (Media3/DRM wiring) are
shared unmodified with Android Mobile; only the UI module diverges,
because D-pad navigation and a 10-foot layout have no honest overlap with a
touch UI. There is no code sharing with the webOS/Tizen/VIDAA "TV shell"
web codebase (see [`webos.md`](webos.md)) — that shell is a
distinct, HTML/JS-based approach used specifically because *those*
platforms are web-runtime TVs; Android TV is native Kotlin and gains
nothing from sharing with a web codebase.

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
- No touch-only UI elements are permitted anywhere in the `tv/` module's
  navigable surface — Play's TV review explicitly checks that every
  interactive element is reachable via D-pad focus traversal, not just
  tap/click, which is enforced in practice by building exclusively on
  Compose for TV's focus-aware components rather than reusing mobile
  Compose widgets.
- Updates: same **Play In-App Updates API** mechanism as Android Mobile
  (Flexible by default, Immediate once below the server's enforced
  `apiVersion` floor) — see
  [`../../versioning-policy.md`](../../versioning-policy.md).
