# Client Architecture: iOS

The iOS client is the native SwiftUI Playarr app for iPhone and iPad. It is
the one Playarr client with no meaningful code-sharing relationship to any
other client beyond the generated API contract — Swift, SwiftUI, and
Apple's DRM stack (FairPlay) simply don't overlap with the Kotlin/Android
side or the web-based TV shell, and this document treats that as an
accepted, deliberate fact rather than a gap to close.

## Target OS/SDK versions

- **Minimum deployment target:** iOS 15.0, chosen to cover the substantial
  majority of active iPhones/iPads while allowing use of modern SwiftUI
  APIs (`async`/`await`-native SwiftUI, `NavigationStack`) introduced
  around iOS 15–16 without extensive back-compat shims.
- **Built with:** the current Xcode release at time of build, targeting the
  latest public iOS SDK — Apple requires apps to be built against a recent
  SDK to remain submittable, similarly to Android's target-API-level
  policy (see [`../../versioning-policy.md`](../../versioning-policy.md)).
- **tvOS:** not a separately shipped client in the current 7-client
  strategy (see [`../overview.md`](../overview.md#the-7-client-strategy)).
  Because the client is built with SwiftUI and AVFoundation, both of which
  target tvOS with minimal changes, a tvOS target sharing this codebase's
  `PlaybackKit`/`StreamarrAPI` modules is a natural, low-cost future
  addition if Apple TV support is prioritised later — it is deliberately
  not committed to yet, so it is scoped out of this document rather than
  described as shipped.

## Tech stack

| Concern | Choice |
|---|---|
| Language | Swift |
| UI | SwiftUI |
| Async | Swift Concurrency (`async`/`await`, `AsyncSequence`) |
| Networking | `URLSession` + a generated Swift client from `crates/streamarr-api/openapi.yaml` |
| Local persistence | SwiftData (offline downloads metadata, resume cache) |
| Playback | `AVFoundation` (`AVPlayer`, `AVPlayerItem`) |
| DRM | `AVContentKeySession` (FairPlay Streaming) |

The project is organised as a local Swift package,
`clients/ios/StreamarrKit/`, split into `StreamarrAPI` (generated client +
auth/session state, mirroring the shape of Android's `core/` module
conceptually even though nothing is shared literally),
`PlaybackKit` (AVFoundation/FairPlay wiring), and the `StreamarrApp` app
target consuming both.

## Playback / DRM approach

Playback uses `AVPlayer` against an `AVPlayerItem` backed by either a
direct-play HLS manifest or an on-demand transcode session's HLS output
(see [`../overview.md`](../overview.md#the-tdarr-background-vs-on-demand-transcode-split))
— Streamarr always serves iOS clients HLS specifically, since it's the
only adaptive streaming format `AVPlayer` supports natively without a
third-party player framework, which conveniently means the on-demand
transcode path (already HLS for the other clients too) needs no
iOS-specific packaging variant.

DRM is **FairPlay Streaming**, which is structurally different from
Widevine's flow used by every other Playarr client: FairPlay requires an
`AVContentKeySession` on-device to produce a **SPC** (Server Playback
Context) request, which the app forwards to a license server that
exchanges it for a **CKC** (Content Key Context) response containing the
actual decryption key material. Streamarr's `/api/drm/fairplay/license`
endpoint in `streamarr-transcode` implements this exchange, separately
from (but architecturally parallel to) the Widevine endpoint the
Android/web/TV clients use — the two DRM systems are not interchangeable
and each has its own license endpoint, key material, and certificate
provisioning (FairPlay requires an Apple-issued FPS certificate configured
server-side, requested once through Apple's FairPlay Streaming developer
process and provisioned as part of `streamarr-transcode`'s DRM
configuration, not something generated per-deployment).

## Code-sharing story with sibling platforms

None at the source-code level, by design — see the framing above. What is
shared is the **contract**: `StreamarrAPI`'s Swift types are generated from
the same `crates/streamarr-api/openapi.yaml` spec that produces the Kotlin
client for Android and the TypeScript client for the Web/webOS/Tizen/VIDAA
shell, so a server-side API change surfaces as a regenerated-client diff on
every platform simultaneously rather than needing to be hand-ported. This
is the "one OpenAPI spec, generated clients for everyone" point made in
[`../overview.md`](../overview.md#why-this-is-a-monorepo).

## Store submission process and constraints

- Distributed via the **App Store**, through App Store Connect, with
  **TestFlight** used for beta/internal distribution ahead of release.
- Full App Review applies to every release, including patch releases —
  there is no fast-track or self-service publish path, and review turnaround
  is outside Streamarr's control.
- **No OTA (over-the-air) code updates are possible or attempted.** Apple's
  App Store guidelines prohibit downloading and executing new
  interpreted/native code outside what App Review approved; every update,
  including trivial ones, must go through a full build-and-review cycle.
  This is a hard platform constraint, not a Streamarr policy choice, and it
  is the reason iOS's update-notification mechanism (see
  [`../../versioning-policy.md`](../../versioning-policy.md)) is a **client
  polling the App Store Lookup API and showing an in-app interstitial**
  rather than any form of self-update: the client periodically checks
  `https://itunes.apple.com/lookup?bundleId=<bundle-id>` for the currently
  published version and compares it against its own, showing a soft nudge
  (dismissible) or a hard blocking interstitial (undismissible) depending
  on whether the client's `apiVersion` has fallen below the server's
  enforced floor — deep-linking to the App Store listing either way, since
  that is the only place an update can actually be obtained.
- Content/privacy: the app collects no data beyond what's needed to talk to
  the user's own configured Streamarr server, simplifying the App Privacy
  "nutrition label" disclosure in App Store Connect considerably (no
  third-party SDKs, no analytics, no advertising identifiers).
