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
  time a call that needs a bearer token has none cached. This is what
  actually keeps the request-management screens working without requiring
  a device-flow sign-in first.

Only `POST /api/v1/requests` and its `.../{id}/approve`/`.../{id}/reject`
siblings require the resulting `Authorization: Bearer` header; catalog,
playback, and system calls stay unauthenticated by the server's own
design. **Token persistence is in-memory only** (`AppEnvironment`'s
`InMemoryTokenStore`) — there is a documented `TODO` at the one call site
that would need it (`refreshAccessToken()`) marking where Keychain-backed
persistence and a real OAuth refresh-token exchange still need to go; a
signed-in session does not currently survive an app relaunch.

## Request-management and auto-update

`WorkDetailView` offers a real "Request" action
(`POST /api/v1/requests`) whenever a loaded work's availability isn't
`available`, using the real, server-resolved `media_file_id` per leaf
(`WorkDetailSchema`/`EpisodeDetailSchema`/`TrackDetailSchema`/
`BookDetailSchema.mediaFileID`) for "Play" the rest of the time.
`RequestsView`/`RequestsViewModel` hit `GET /api/v1/requests` (which
returns either "my requests" or the full pending-approval queue,
depending on whether `user_id` is supplied) and expose real
`approve`/`reject` actions gated by a **local-only, not server-enforced**
`isAdminMode` toggle in Settings — the server independently enforces admin
access on approve/reject (403 otherwise), so this toggle only decides what
the device *attempts to show*, not what it can actually do.
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

## No Xcode in this build environment — a real, current gap

**This client has never actually been built or run as an installable
`.app`.** The development environment this codebase was built in has no
Xcode installed — only the Command Line Tools' `swift` compiler, and no iOS
SDK at all. Concretely, that means:

- Swift Package Manager has no first-class "produces an installable iOS
  app bundle" product type outside Xcode (`.iOSApplication` lives in
  `AppleProductTypes`, which only resolves inside Xcode/Swift Playgrounds),
  so `StreamarrApp` is declared as a plain `.executableTarget` with a real
  `@main struct StreamarrApp: App` — enough for Xcode, once available, to
  open `Package.swift` directly and run it, but not itself a packaged
  `.app`, `.ipa`, or Info.plist/entitlements/code-signing setup.
- What *was* verified: `swift build` against this package with a
  temporary, local-only `.macOS(.v14)` platform substitution (never
  committed) caught genuine Swift syntax/type errors, since `StreamarrKit`
  has no UIKit dependency. Result: `StreamarrKit` (Networking, Player,
  Auth, Models) built with zero errors and zero warnings; `StreamarrApp`
  had only macOS-vs-iOS platform-availability failures (`#Preview` macro
  plugins, iOS-only `View` modifiers like `.keyboardType`/
  `.fullScreenCover`) — a real, but partial, substitute for an actual iOS
  build, not equivalent to one.
- There is **no test target**: neither `XCTest` nor the `Testing` module
  resolves in this environment at all (confirmed by direct experiment, not
  assumed), so a written `StreamarrKitTests`/`StreamarrAppTests` pass was
  reverted rather than left as asserted-but-never-compiled code.
- This is a real, current environment limitation, not a permanent one:
  once Xcode is available, the expected next step is opening
  `Package.swift` directly, picking an iOS Simulator destination, and
  fixing whatever the macOS-substitute check above didn't catch — not a
  from-scratch rewrite.

## Store submission process and constraints

- Distributed via the **App Store**, through App Store Connect, with
  **TestFlight** used for beta/internal distribution ahead of release —
  both presuppose the real `.app`/Xcode project step above, which has not
  happened yet.
- Full App Review applies to every release, including patch releases —
  there is no fast-track or self-service publish path, and review turnaround
  is outside Streamarr's control.
- **No OTA (over-the-air) code updates are possible or attempted.** Apple's
  App Store guidelines prohibit downloading and executing new
  interpreted/native code outside what App Review approved; every update,
  including trivial ones, must go through a full build-and-review cycle.
  This is a hard platform constraint, not a Streamarr policy choice. The
  real client-side mechanism (see "Request-management and auto-update"
  above) is `UpdateViewModel` polling `GET /api/system/version` on every
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
