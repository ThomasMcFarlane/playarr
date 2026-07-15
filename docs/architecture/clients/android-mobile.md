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
- **Target/compile SDK:** 34 (Android 14) at time of writing, bumped each
  year to track Google Play's target-API-level requirement (Play requires
  apps to target an API level within one year of the latest major release
  to remain installable/updatable for new users — see
  [`../../versioning-policy.md`](../../versioning-policy.md) for how this
  policy requirement interacts with Streamarr's own release cadence).
- **Kotlin** 1.9+, **Jetpack Compose** (Material 3) for all UI — no XML
  layouts or Views-based screens in new code.

## Tech stack

| Concern | Choice |
|---|---|
| Language | Kotlin |
| UI | Jetpack Compose (Material 3) |
| DI | Hilt |
| Networking | Retrofit + OkHttp, generated client from `crates/streamarr-api/openapi.yaml` |
| Async | Kotlin Coroutines + Flow |
| Local persistence | Room (offline downloads metadata, resume state cache) |
| Playback | Media3 (`androidx.media3`, ExoPlayer's successor) |
| Image loading | Coil |

## Playback / DRM approach

Playback goes through Media3's `ExoPlayer`, which handles adaptive
HLS/DASH playback of both direct-played originals and the HLS output of
Streamarr's on-demand transcode sessions (see
[`../overview.md`](../overview.md#the-tdarr-background-vs-on-demand-transcode-split))
identically — the client doesn't need to know which one it's getting; it
just requests a playback manifest from `/api/playback/start` and gets back
either a direct-play URL or an HLS manifest URL for a freshly-spun-up
transcode session.

DRM: Widevine, via Media3's built-in `DefaultDrmSessionManager`. Devices
with Widevine L1 (hardware-backed, the vast majority of phones sold since
~2016) get full HD/4K-capable playback where the source and license allow
it; L3 (software-only) devices are capped to SD-equivalent output by
Widevine's own security-level enforcement, not by Streamarr — Streamarr
issues licenses at whatever resolution/security-level tier the requesting
device's attested Widevine security level supports. Streamarr's license
server endpoint (`/api/drm/widevine/license`) is a thin proxy in
`streamarr-transcode` issuing per-session keys tied to the requesting
user's session, not a general DRM vault — content protection here is about
preventing casual re-distribution of a personal library stream, not
studio-grade anti-piracy.

## Code-sharing story with sibling platforms

Android Mobile and Android TV (see
[`android-tv.md`](android-tv.md)) live in the same Gradle multi-module
project at `clients/android/`:

```
clients/android/
  core/          # domain models, API client, auth/session state (shared)
  playback/      # Media3 wiring, DRM session manager (shared)
  mobile/        # phone/tablet Compose UI, touch navigation
  tv/            # TV Compose UI, D-pad navigation, leanback integration
```

`core` and `playback` are shared unmodified between the two app modules —
they hold everything that doesn't depend on the shape of the input device
or screen: the generated API client, the auth/refresh-token state machine
(mirroring [`../auth-modes.md`](../auth-modes.md)), and Media3/DRM setup.
`mobile` and `tv` diverge only where the platforms genuinely diverge: touch
gestures and bottom-nav for mobile versus D-pad focus handling and a
10-foot-UI layout for TV. This is the same "share where the platforms
share, diverge where they diverge" principle described for the wider
client fleet in [`../overview.md`](../overview.md#the-7-client-strategy).

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
- Updates use Google Play's **In-App Updates API**, in **Flexible** mode by
  default (background download, user-initiated install prompt) for routine
  releases, escalating to **Immediate** mode (blocking, forced-update flow)
  only when the client's `apiVersion` has fallen below the server's
  enforced floor — see the per-platform update-mechanism table in
  [`../../versioning-policy.md`](../../versioning-policy.md) for the exact
  trigger condition shared with Android TV.
