# Client Architecture: iOS

The iOS client is the native SwiftUI Playarr app for iPhone and iPad. It is
the one Playarr client with no meaningful code-sharing relationship to any
other client beyond the shared OpenAPI contract — Swift/SwiftUI simply
don't overlap with the Kotlin/Android side or the TypeScript-based TV/web
shell, and this document treats that as an accepted, deliberate fact
rather than a gap to close.

**Product bar** ([`../client-principles.md`](../client-principles.md)): fully
native SwiftUI + AVFoundation, full product parity with complete clients, no
WebView for catalogue/settings/player chrome. Degrade only for real Apple
platform or App Store capability limits (for example binary OTA rules).

## Target OS/SDK versions

- **Minimum deployment target:** iOS 17.0 (`platforms: [.iOS(.v17)]` in
  `Package.swift`) — narrower than earlier drafts of this document assumed
  (iOS 15.0), chosen because `PlayarrKit`/`PlayarrApp` lean on modern
  Swift Concurrency and Observation-framework APIs (`@Observable`) without
  back-compat shims.
- **Build toolchain:** the Apple release workflow builds with Xcode 26.5.
- **tvOS:** a native SwiftUI/AVKit Apple TV app exists at `clients/apple-tv` and shares
  `PlayarrKit` with iOS. It has its own target and active App Store provisioning profile. Both
  Apple targets use the App Store Connect bundle identifier `app.playarr.ios` and are uploaded
  together by the signed-only TestFlight workflow.

## Tech stack

| Concern | Choice |
|---|---|
| Language | Swift |
| UI | SwiftUI with a native Playarr design system matching the responsive web shell; no WebView |
| Async | Swift Concurrency (`async`/`await`), Observation (`@Observable`) |
| Networking | `URLSession` + a hand-written client (`Networking/APIClient.swift`, `OpenAPISchemas.swift`) checked field-by-field against `backend/openapi/playarr.yaml` and the real backend Rust structs — not a generated client |
| Local persistence | Per-server access/refresh sessions in the iOS Keychain; server URL and stable device id in `UserDefaults` |
| Playback | `AVFoundation`/`AVKit` (`AVPlayer`, `AVPlayerItem`, picture-in-picture) |
| DRM | Not implemented — see "Playback / DRM approach" below |

The project is organised as a local Swift package, `clients/ios/`
(`Package.swift` at the package root, not nested under a `PlayarrKit/`
subdirectory), exporting one real SPM product, **`PlayarrKit`**
(`Sources/PlayarrKit/`: `Networking/`, `Player/`, `Auth/`, `Models/`) —
there is no separate `PlayarrAPI`/`PlaybackKit` module split; networking,
playback, and auth are subdirectories of one library target, not three
independent products. `Sources/PlayarrApp/` is the SwiftUI app target
(views, view models, the `AppEnvironment` composition root) consuming
`PlayarrKit`.

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

The negotiated media URL is still authenticated. `PlayerViewModel` obtains the current bearer
header through `PlayarrAPIClient`, and `AVPlayerEngine` supplies it when constructing the
`AVURLAsset` so direct files, HLS manifests, and their child requests do not fall through to a
server-side `401` after negotiation succeeds.

**No DRM is implemented today.** There is no `AVContentKeySession` wiring,
no FairPlay SPC/CKC exchange, and no `/api/drm/...` endpoint anywhere in
the real API surface (`backend/openapi/playarr.yaml` defines no DRM
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

Three real session paths exist, all landing in the same Keychain-backed
`AccessTokenProviding` store so a token obtained either way is visible to
every subsequent call:

- **Full-account sign-in.** The signed-out root presents the same server URL,
  username, and password fields as Playarr Web and calls `POST /api/v1/auth/login`.
  Successful sessions enter the authenticated shell instead of exposing catalogue
  errors behind an always-visible tab scaffold.
- **Managed profiles.** The profile stage calls `GET /api/v1/users/profiles`
  and switches profiles through the same login endpoint, supplying the profile id
  and a four-digit PIN when the selected profile is locked.
- **RFC 8628 device pairing** (`Auth/DeviceFlowClient.swift`) remains available
  in `PlayarrKit` for device-oriented sibling clients and uses the same token store.
- **Transparent trusted-network login.** `APIClient`'s `attachAuth` calls
  `POST /api/v1/auth/login` on demand — no user action, no credentials
  needed under the server's default `AuthMode::TrustedNetwork` — the first
  time a call that needs a bearer token has none cached. This means a
  bearer token is acquired transparently the moment one is needed, without
  requiring a device-flow sign-in first.

Catalog and playback requests attach `Authorization: Bearer`; public system,
login, refresh, device-flow and webhook operations do not. `APIClient`
renews access tokens two minutes before expiry through
`POST /api/v1/auth/refresh`, persists the rotated token pair, and retries a
protected request once after an unexpected `401`. Sessions are isolated by
server URL in the iOS Keychain and survive app relaunches.

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
shared is the **contract**: `PlayarrKit`'s Swift types are checked
against the same `backend/openapi/playarr.yaml` spec that the Kotlin
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

`clients/ios/project.yml` is the iOS project source and generates the SwiftUI application project.
The release workflow regenerates it, installs the pinned Google Cast 4.8.6 CocoaPod, and builds
from the resulting workspace. The iOS and Apple TV targets both link the local `PlayarrKit`
package. Release builds are signed and exported by the Apple release workflow.

The signed-only TestFlight workflow has separately uploaded both platforms as marketing version
`1.0.0`. iOS build `11.1` was built from immutable source commit
`3b969d445c9d01ee010eb19c2356b0b5cc6bf714` in private run
<id>; App Store
Connect reports it `VALID`. tvOS build `12.1` was built from immutable source commit
`f2e4e70b579075c1057ce3b16e1305f346cb400a` in private run
<id>; its App Store
Connect build record is `VALID` and expires on `2027-01-02`. Both builds are available in the
`Playarr Internal Testers` group, which has access to all builds. An existing tester record reports
`INSTALLED`; this does not establish installation of the tvOS app on a device. These records verify
build processing and TestFlight availability, not public App Store release or physical-device
installation. See the [TestFlight runbook](../../apple-testflight/README.md).

## Store submission process and constraints

- Distributed through App Store Connect, with TestFlight used for internal and external beta
  distribution ahead of public release. The app record, shared bundle identifier, distribution
  signing and provisioning, and internal TestFlight build processing are in place. Public listing
  readiness is separate: Apple-platform privacy coverage, screenshots and metadata, App Review
  access instructions, and explicit authorisation for public submission remain outstanding.
- Full App Review applies to every release, including patch releases —
  there is no fast-track or self-service publish path, and review turnaround
  is outside Playarr Server's control.
- **No OTA (over-the-air) code updates are possible or attempted.** Apple's
  App Store guidelines prohibit downloading and executing new
  interpreted/native code outside what App Review approved; every update,
  including trivial ones, must go through a full build-and-review cycle.
  This is a hard platform constraint, not a Playarr Server policy choice. The
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
- The source currently keeps `InstalledAppVersion.appStoreID` at the placeholder
  `0000000000`; the App Store Connect app record exists, but the deep link must be updated before
  public release.
- Content/privacy: the app collects no data beyond what's needed to talk to
  the user's own configured Playarr Server and Google Cast. The app includes
  the Google Cast SDK; it has no analytics or advertising identifiers. Confirm
  the final App Privacy disclosure against the configured Cast receiver before
  public submission.
