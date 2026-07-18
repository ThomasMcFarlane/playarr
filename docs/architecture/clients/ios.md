# Client Architecture: iOS

The iOS client is the native SwiftUI Playarr app for iPhone and iPad. It is
the one Playarr client with no meaningful code-sharing relationship to any
other client beyond the shared OpenAPI contract — Swift/SwiftUI simply
don't overlap with the Kotlin/Android side or the TypeScript-based TV/web
shell, and this document treats that as an accepted, deliberate fact
rather than a gap to close.

## Target OS/SDK versions

- **Minimum deployment target:** iOS 17.0 (`platforms: [.iOS(.v17)]` in
  `Package.swift`) — narrower than earlier drafts of this document assumed
  (iOS 15.0), chosen because `StreamarrKit`/`StreamarrApp` lean on modern
  Swift Concurrency and Observation-framework APIs (`@Observable`) without
  back-compat shims.
- **Built with:** whatever Xcode release is available when the app is
  actually opened and built as an Xcode project — see "No Xcode in this
  build environment" below for the current, real state of that.
- **tvOS:** not a separately shipped client. `StreamarrKit` (Networking,
  Player, Auth) has zero UIKit import anywhere — Foundation, Combine,
  Observation, AVFoundation, and AVKit are all available on iOS, tvOS, and
  macOS alike — so a tvOS target sharing this package's `StreamarrKit`
  product remains a low-cost, additive future step (add `.tvOS(.v17)` to
  `platforms`, add a new executable target). It is deliberately not
  committed to yet.

## Tech stack

| Concern | Choice |
|---|---|
| Language | Swift |
| UI | SwiftUI |
| Async | Swift Concurrency (`async`/`await`), Observation (`@Observable`) |
| Networking | `URLSession` + a hand-written client (`Networking/APIClient.swift`, `OpenAPISchemas.swift`) checked field-by-field against `backend/openapi/streamarr.yaml` and the real backend Rust structs — not a generated client |
| Local persistence | None yet — see "Token persistence is in-memory only" below; no SwiftData/Keychain wiring exists in the tree today |
| Playback | `AVFoundation`/`AVKit` (`AVPlayer`, `AVPlayerItem`, picture-in-picture) |
| DRM | Not implemented — see "Playback / DRM approach" below |

The project is organised as a local Swift package, `clients/ios/`
(`Package.swift` at the package root, not nested under a `StreamarrKit/`
subdirectory), exporting one real SPM product, **`StreamarrKit`**
(`Sources/StreamarrKit/`: `Networking/`, `Player/`, `Auth/`, `Models/`) —
there is no separate `StreamarrAPI`/`PlaybackKit` module split; networking,
playback, and auth are subdirectories of one library target, not three
independent products. `Sources/StreamarrApp/` is the SwiftUI app target
(views, view models, the `AppEnvironment` composition root) consuming
`StreamarrKit`.

## Playback / DRM approach

Playback uses `AVPlayer`/`AVKit` (`PlayerEngine`'s `AVPlayerEngine`
implementation) against whatever `GET /api/v1/playback/{media_file_id}`
returns — a `PlaybackInfoResponse` with just `mode` (`direct`/`hls`) and a
`url`, resolved against `APIClient.baseURL` since the URL may be
server-relative (see
[`../overview.md`](../overview.md#the-tdarr-background-vs-on-demand-transcode-split)
for the direct-play-vs-transcode split this negotiates). `PlayerViewModel.play(mediaFileID:title:)`
calls that negotiation endpoint first and only then hands the resolved
item to `AVPlayerEngine`.

**No DRM is implemented today.** There is no `AVContentKeySession` wiring,
no FairPlay SPC/CKC exchange, and no `/api/drm/...` endpoint anywhere in
the real API surface (`backend/openapi/streamarr.yaml` defines no DRM
paths at all) — playback is unencrypted HLS only. Earlier drafts of this
document described a `/api/drm/fairplay/license` endpoint and an
Apple-issued FPS certificate provisioning story; neither was ever actually
built. This is a real, current gap, not a permanent architectural
decision — FairPlay remains the structurally-correct choice *if* DRM is
ever added here (it is Apple's only supported path, and is not
interchangeable with the Widevine flow other platforms would use), but
nothing in this section describes shipped behaviour until that work
happens.

## Auth/session flow

Two real session paths exist, both landing in the same in-memory
`AccessTokenProviding` store so a token obtained either way is visible to
every subsequent call:

- **RFC 8628 device pairing** (`Auth/DeviceFlowClient.swift`), a real,
  user-initiated sign-in flow against `POST /api/v1/oauth/device/code` /
  `POST /api/v1/oauth/token`, including the real RFC 8628 §3.5 backoff and
  every error code the spec defines. `SettingsView`'s "Sign In" affordance
  drives this and flips `AppEnvironment.isSignedIn`.
- **Transparent trusted-network login.** `APIClient`'s `attachAuth` calls
  `POST /api/v1/auth/login` on demand — no user action, no credentials
  needed under the server's default `AuthMode::TrustedNetwork` — the first
  time a call that needs a bearer token has none cached. This means a
  bearer token is acquired transparently the moment one is needed, without
  requiring a device-flow sign-in first.

No endpoint the iOS app actually calls requires the resulting
`Authorization: Bearer` header today — catalog, playback, and system calls
all stay unauthenticated by the server's own design. (The server does
enforce Bearer-plus-admin-checked auth on the source-instance management
endpoints, but the iOS app has no admin UI and never calls them.)
**Token persistence is in-memory only** (`AppEnvironment`'s
`InMemoryTokenStore`) — there is a documented `TODO` at the one call site
that would need it (`refreshAccessToken()`) marking where Keychain-backed
persistence and a real OAuth refresh-token exchange still need to go; a
signed-in session does not currently survive an app relaunch.

## Auto-update

`UpdateViewModel`/`AppUpdateEvaluator`/`UpdateGateModifier` implement the
client auto-update module against the real `GET /api/system/version`
`CompatibilityEntry` shape (SemVer-ish `latest_version`/
`min_supported_version` strings per platform) — not the more elaborate
integer `apiVersion`/`apiVersionFloor` scheme earlier drafts of this
document and [`../../versioning-policy.md`](../../versioning-policy.md)
describe; that is a real, currently-unreconciled drift between this client
and the docs' more elaborate scheme, not a client-side placeholder. A
secondary, **display-only** `AppStoreLookupClient` still polls
`https://itunes.apple.com/lookup?bundleId=...` (throttled to roughly
daily) purely so a diagnostics view can show "what's on the App Store" —
it plays no role in the actual update-gating decision, which is driven
entirely by `GET /api/system/version`.

## Code-sharing story with sibling platforms

None at the source-code level, by design — see the framing above. What is
shared is the **contract**: `StreamarrKit`'s Swift types are checked
against the same `backend/openapi/streamarr.yaml` spec that the Kotlin
client for Android and the TypeScript client for the Web/webOS/Tizen/VIDAA
shell are checked against, so a server-side API change surfaces as a
diff needing porting on every platform rather than being silently missed
on one. This is the "one OpenAPI spec, one contract for every client"
point made in
[`../overview.md`](../overview.md#why-this-is-a-monorepo) — today that
means hand-written clients kept in sync by inspection on iOS and Android,
and a real `openapi-typescript`-generated client on the Web/TV-web side
(see [`web.md`](web.md)), not (yet) a single generator producing every
platform's client from one command.

## Xcode project and local validation

`clients/ios/Streamarr.xcodeproj` is a checked-in, installable application
project generated from `project.yml`. It builds the SwiftUI sources as
`Playarr.app`, links the local `StreamarrKit` package, and includes bundle
metadata, entitlements, the privacy manifest, the accent colour, and a real
1024 px application icon. The shared scheme also contains `StreamarrKitTests`
and `StreamarrAppTests` XCTest targets.

The available local validation compiled and linked the application and both
test bundles against the iOS Simulator SDK, compiled a Release device target,
and passed all six platform-independent `StreamarrKit` tests using a temporary
host-only manifest adjustment that was reverted afterwards. The generated
project's resources phase contains both the asset catalogue and privacy
manifest.

This Xcode installation has the iOS SDK but no installed iOS Simulator runtime.
Consequently, XCTest and UI execution are not possible here, and Xcode's asset
compiler cannot finish its runtime-specific thinning pass. A machine with an
installed iOS runtime is still required for the final simulator build, app
launch, XCTest execution, signing, archive, and physical-device validation.

## Store submission process and constraints

- Distributed via the **App Store**, through App Store Connect, with
  **TestFlight** used for beta/internal distribution ahead of release —
  both require signing and App Store Connect registration, which have not
  happened yet.
- Full App Review applies to every release, including patch releases —
  there is no fast-track or self-service publish path, and review turnaround
  is outside Streamarr's control.
- **No OTA (over-the-air) code updates are possible or attempted.** Apple's
  App Store guidelines prohibit downloading and executing new
  interpreted/native code outside what App Review approved; every update,
  including trivial ones, must go through a full build-and-review cycle.
  This is a hard platform constraint, not a Streamarr policy choice. The
  real client-side mechanism (see "Auto-update" above) is `UpdateViewModel`
  polling `GET /api/system/version` on every
  foreground and comparing this build's version against its platform's
  `CompatibilityEntry` — a dismissible soft nudge
  (`.alert`) once below `latest_version`, escalating to a non-dismissible
  `.fullScreenCover` interstitial once below `min_supported_version` — with
  the **display-only** App Store Lookup API poll as a secondary signal, not
  the gating mechanism itself. Both ends deep-link to the App Store
  listing, since that is the only place an update can actually be
  obtained, and — stated explicitly, since it's easy to overstate what a
  client-side interstitial can enforce — the blocking cover withholds this
  app's own UI but cannot stop a determined user from working around it
  and has no effect at the network/API layer; real enforcement, if ever
  needed, has to happen server-side.
- Content/privacy: the app collects no data beyond what's needed to talk to
  the user's own configured Streamarr server, simplifying the App Privacy
  "nutrition label" disclosure in App Store Connect considerably (no
  third-party SDKs, no analytics, no advertising identifiers).
