# Streamarr iOS client

Source-only Swift Package Manager scaffold for the Streamarr iOS app.
**Xcode is not installed in the environment this was written in** — only
the Command Line Tools' `swift` compiler. Everything below was written and
reviewed with that constraint in mind; see "What was actually verified"
for exactly what that means in practice.

## Layout

```
clients/ios/
  Package.swift
  Sources/
    StreamarrKit/                        # library target — no UIKit dependency anywhere
      Models/Sensitive.swift              # generic secret-redaction wrapper
      Networking/OpenAPISchemas.swift     # Codable types for every backend/openapi/streamarr.yaml schema
      Networking/JSONCoding.swift         # shared JSONDecoder/JSONEncoder (RFC 3339 date handling)
      Networking/APIClient.swift          # StreamarrAPIClient protocol + URLSession-backed APIClient
      Player/PlayerEngine.swift           # AVFoundation/AVKit player wrapper
      Auth/DeviceFlowClient.swift         # RFC 8628 device-authorization-grant client
    StreamarrApp/                         # SwiftUI app target
      App.swift
      AppEnvironment.swift                 # composition root + UserDefaults-backed server URL
      InstalledAppVersion.swift            # installed-version/bundle-id/App-Store-id placeholders for the update module
      ViewModels/
      Views/
```

`StreamarrKit` is the one formal SPM *product* this package exports
(`Package.swift`'s `products:` array). `StreamarrApp` is a target but
deliberately not a product — see "Why `StreamarrApp` isn't a real .app
yet" below.

## Platform target

`platforms: [.iOS(.v17)]` — iOS 17 minimum, per the plan. tvOS is
deliberately **not** listed yet: `StreamarrKit` has zero UIKit import
anywhere (Networking/Player/Auth all stick to
Foundation/Combine/Observation/AVFoundation/AVKit, which are available on
iOS, tvOS, and macOS alike). When the tvOS client is scoped, the expected
change is additive: add `.tvOS(.v17)` to `platforms` and a new
`StreamarrTVApp` executable target depending on the same `StreamarrKit`
product — no source changes to `StreamarrKit` should be required. The one
place tvOS will need real new code is the app-target UI layer (focus
engine navigation, remote-control handling), which lives in
`StreamarrApp`/a future `StreamarrTVApp`, not in the kit.

## `Networking/OpenAPISchemas.swift` + `APIClient.swift` — the real client

This is a hand-written client generated directly against the real
`backend/openapi/streamarr.yaml` (OpenAPI 3.1.0), not a placeholder — it
replaces the Wave-1 scaffold's inferred/guessed `Models/`. Every
`Codable` type in `OpenAPISchemas.swift` was checked field-by-field
against both the spec and the real backend Rust structs it mirrors
(`backend/crates/streamarr-model`, `streamarr-catalog`,
`streamarr-auth`, `streamarr-api`) — see that file's header comment for
the full provenance note and why a handful of schemas (`ExternalProvider`,
`WorkChildren`) need custom `Codable` conformances a
generic `openapi-generator-cli -g swift5` run wouldn't produce correctly
(Rust's default externally-tagged and internally-tagged enum
representations).

`StreamarrAPIClient`/`APIClient` in `APIClient.swift` cover every
operation in the spec except the two OAuth device-flow endpoints, which
live in `Auth/DeviceFlowClient.swift` instead (see that file's header for
why the split): system health/ready/version, catalog browse/search/get,
playback negotiation, and the `*arr` webhook receiver. View models code against the
`StreamarrAPIClient` protocol, never `APIClient` concretely, so swapping
in a different implementation (or a mock for tests) is a one-line
dependency-injection change — see `Views/PreviewSupport.swift`'s
`PreviewAPIClient` for exactly that.

**Round D update — catalog/playback are now cross-linked server-side:**
`GET /api/v1/catalog/{id}` resolves a real, nullable `media_file_id` for
every playable leaf: `WorkDetail.mediaFileID` for a movie's own leaf, and
`EpisodeDetail`/`TrackDetail`/`BookDetail.mediaFileID` for a series'
episodes / an artist's tracks / an author's books (see
`OpenAPISchemas.swift`'s "Round D update" note and
`backend/openapi/streamarr.yaml`'s `WorkDetailSchema`/`EpisodeDetailSchema`/
`TrackDetailSchema`/`BookDetailSchema`). `WorkDetailView` wires each
leaf's real id straight into a `PlayerView` "Play" `NavigationLink` when
one has synced, and falls back to a plain (non-playable) row when it's
still `nil`. `PlayerView`'s manual media-file-ID entry field is still
there as a fallback/debugging path (and is what gets pre-filled when
navigated to from a real leaf), not the primary path anymore.

**Round D also added an auto-update module** (see its own section below):
`UpdateViewModel`/`AppUpdateEvaluator`/`UpdateGateModifier`
(`GET /api/system/version` polled on foreground).

## `Player/PlayerEngine.swift`

`PlayerEngine` is a `@MainActor` protocol; `AVPlayerEngine` is the
AVFoundation/AVKit-backed implementation — periodic time observation, KVO
on `AVPlayerItem.status`/buffer-empty/likely-to-keep-up, end-of-item
notification, async track enumeration/selection via
`loadMediaSelectionGroup(for:)`, and an AVKit picture-in-picture hookup.
It deliberately exposes `avPlayer: AVPlayer { get }` as a documented
escape hatch — SwiftUI's `VideoPlayer` (or a `UIViewControllerRepresentable`
wrapping `AVPlayerViewController`) needs the real object to render into —
while every other concern (state, seek, track selection) stays behind the
protocol so it's mockable in tests. `PlayerViewModel.play(mediaFileID:title:)`
calls the real `GET /api/v1/playback/{media_file_id}` negotiation endpoint
first, resolves `PlaybackInfoResponse.url` against `APIClient.baseURL`
(the URL in the response may be server-relative), and only then hands the
resolved `PlayableItem` to this engine.

## `Auth/DeviceFlowClient.swift`

Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) against the
real `POST /api/v1/oauth/device/code` and `POST /api/v1/oauth/token`
endpoints: JSON request/response bodies (not
`application/x-www-form-urlencoded` — an earlier draft of this file
assumed a generic form-encoded OAuth server; the real Streamarr API uses
plain `axum::Json` extractors), `requestDeviceCode()` (§3.1/§3.2),
`pollForToken(deviceCode:interval:expiresIn:)` (§3.4/§3.5, honoring
`slow_down` by adding 5s to the poll interval, `authorization_pending` by
continuing to poll, and stopping on `expired_token`/`access_denied`/
`unsupported_grant_type`), and an `authorize(onAuthorizationPending:)`
convenience that runs both steps. `DeviceFlowErrorCode` types the five
RFC 8628 §3.5 + RFC 6749 §5.2 error codes the spec documents
(`authorization_pending | slow_down | expired_token | access_denied |
unsupported_grant_type`), with an `.other(String)` fallback for anything
else. It's an `actor` (not a `@MainActor` class) specifically so it
satisfies `Sendable` without relying on
global-actor-isolation-implies-Sendable inference.
`AppEnvironment`/`SettingsViewModel` wire it up as the app's sign-in flow.

## Client auto-update module (`UpdateViewModel`/`AppUpdateEvaluator`/`UpdateGateModifier`)

Implements the "client auto-update" piece of the architecture plan
(`docs/versioning-policy.md`, `docs/architecture/clients/ios.md`) against
the *real* current backend shape, not those docs' more elaborate
`apiVersion`/`apiVersionFloor` integer scheme (a `426`-based gate, an
`X-Streamarr-Api-Version` header) — the real `GET /api/system/version`
(`streamarr-model::VersionEnvelope`, `backend/config/client-compatibility.toml`)
only exposes a flat `compatibility: [CompatibilityEntry]` table keyed by
`ClientPlatform`, each entry carrying plain per-platform SemVer-shaped
strings (`latest_version` / `min_supported_version`). This is a real,
noted drift between those architecture docs and the current backend, not
something this client pass reconciled (out of scope — backend/docs aren't
in this pass's edit scope).

- `AppUpdateEvaluator` (`StreamarrKit`, pure logic, no networking/UIKit):
  compares the installed version against the `ios` `CompatibilityEntry`'s
  two floors and returns `.upToDate` / `.softNudge(latestVersion:)` /
  `.blocked(minSupportedVersion:)`.
- `AppStoreLookupClient` (`StreamarrKit`): the secondary, **display-only**
  `https://itunes.apple.com/lookup?bundleId=...` source the architecture
  docs describe — never used for the actual gating decision, only polled
  (throttled to ~daily) so a diagnostics screen could show "what's on the
  App Store" if useful.
- `UpdateViewModel` (`StreamarrApp`): `@MainActor` glue — calls
  `fetchVersion()` and the throttled store lookup, holds the resulting
  `AppUpdateStatus`, knows how to `openAppStore()` (`itms-apps://`).
  `RootView` calls `checkForUpdate()` once on first appear and again on
  every `scenePhase` transition to `.active` (i.e. every foreground).
- `UpdateGateModifier`/`BlockingUpdateInterstitial` (`StreamarrApp`):
  renders the status — a dismissible `.alert` for `.softNudge`, a
  `.fullScreenCover` with no dismiss/skip affordance for `.blocked`.

**Enforcement ceiling, stated explicitly (per this pass's instructions):**
Apple prohibits OTA code updates on iOS outright — nothing here, or
anywhere on this platform, can force an actual update. The "blocking"
interstitial is UX-level only: it withholds this app's own UI, but cannot
stop a determined user/debugger from working around it and does nothing at
the network/API layer (every request this app makes is unaffected by it).
Real enforcement, if ever needed, has to happen server-side. See
`AppUpdateEvaluator.swift`'s and `UpdateGateView.swift`'s header comments
for the same statement in place against the actual code.

`InstalledAppVersion` (`StreamarrApp`) is where the "what version/bundle
id/App Store id am I" placeholders live — `CFBundleShortVersionString`
isn't populated yet (no real `Info.plist`, see "Why `StreamarrApp` isn't a
real `.app` yet" below), and the numeric App Store id is an obviously-fake
placeholder (`"0000000000"`) until this app is actually published. Replace
both with real values at that point.

## Configurable server base URL

Streamarr is operator-run software, so this client can never hardcode a
single host. `AppEnvironment.serverBaseURL` is backed by `UserDefaults`
(key `com.streamarr.ios.serverBaseURL`), defaults to
`http://localhost:8080`, and rebuilds both `apiClient` and
`deviceFlowClient` whenever it changes. `SettingsView` has the one field
in the UI that changes it (`Server` section, `Save` button).

## Why `StreamarrApp` isn't a real `.app` yet

SPM has no first-class "produces an installable iOS app bundle" product
type in a plain package manifest (`.iOSApplication` exists but lives in
`AppleProductTypes`, which is only resolvable inside Xcode/Swift
Playgrounds, not from bare command-line SPM — using it here would have
made the manifest fail to even resolve in this environment). So
`StreamarrApp` is declared as a plain `.executableTarget` with a real
`@main struct StreamarrApp: App` SwiftUI entry point. That's enough for
Xcode, once available, to open this package directly and run it as an
iOS destination, or to wrap it in a thin `.xcodeproj`/`.xcworkspace` for
the Info.plist/asset-catalog/entitlements/code-signing an installable
`.app` needs. Neither of those steps happens in this scaffold.

## What was actually verified

The `swift` compiler (Command Line Tools, no `xcodebuild`) is present but
there is no iOS SDK in this environment, so a real `swift build` targeting
iOS is not possible here (`xcodebuild` itself errors immediately —
`requires Xcode, but active developer directory ... is a command line
tools instance`).

As a substitute, `swift build` was run against this package with a
**temporary, local-only** `.macOS(.v14)` entry added to `platforms` (the
committed `Package.swift` is iOS-only, as required — the macOS entry was
removed again before finishing). This isn't a real validation of iOS
behavior, but it does catch genuine Swift syntax/type errors, since
`StreamarrKit` has no UIKit dependency and almost all of the APIs it uses
(Foundation, Combine, Observation, AVFoundation, AVKit, SwiftUI) exist on
both platforms.

Result, on a clean build (`rm -rf .build && swift build`):

- **`StreamarrKit` (Networking, Player, Auth, `Models/Sensitive.swift`):
  zero errors, zero warnings.**
- **`StreamarrApp` (the SwiftUI app target): only four categories of
  failure, all artifacts of substituting macOS for iOS locally, not
  source defects**:
  1. `#Preview { ... }` in each `Views/*.swift` file fails with *"external
     macro implementation type 'PreviewsMacros.SwiftUIView' could not be
     found... plugin for module 'PreviewsMacros' not found"* — that macro
     plugin binary ships inside `Xcode.app`, not the Command Line Tools;
     expected to work once opened in real Xcode.
  2. `SettingsView.swift`/`PlayerView.swift`'s `TextField` chains
     (`.textInputAutocapitalization(.never)`, `.keyboardType(.URL)`) fail
     to type-check *only* because these are iOS/tvOS/watchOS-only `View`
     modifiers with no macOS counterpart — correct, current SwiftUI API
     for an iOS 17 target, just inapplicable to the macOS stand-in.
  3. `LibraryView.swift`'s `ToolbarItem(placement: .navigationBarTrailing)`
     fails because that `ToolbarItemPlacement` case is unavailable on
     macOS — again correct, standard iOS API, just inapplicable here.
  4. `UpdateGateView.swift`'s `.fullScreenCover(isPresented:content:)`
     fails because that modifier is unavailable on macOS — same category
     as #3, a real, standard iOS API with no macOS counterpart.

No other errors were found in either target across the whole package.

**Unit tests were attempted and reverted, not skipped:** a
`StreamarrKitTests`/`StreamarrAppTests` pass (schema decode/encode
round-trips against real spec-shaped fixtures, `AppUpdateEvaluator`
version-comparison boundary cases, `WorkDetailViewModel` behavior against
a fake `StreamarrAPIClient`, an `AppStoreLookupClient` test against a
mocked `URLProtocol`) was written,
then removed once direct experiment (a throwaway scratch SPM package, not
assumption) confirmed this environment has **neither `XCTest.framework`
nor the `Testing` module available at all**, under any swift-tools-version
— both `import XCTest` and `import Testing` fail with "no such module"
here, and there is no `XCTest.framework` anywhere on the filesystem to
point at. Since compilation aborts at that unresolved import before
type-checking anything else in the file, keeping those test files would
mean shipping asserted-but-never-compiled code — see "No test target"
below.

## Known gaps / assumptions to revisit

- **`InstalledAppVersion`'s bundle id / numeric App Store id are
  placeholders** (`"com.streamarr.ios"` fallback, `"0000000000"`) until
  this app has a real App Store Connect listing — see "Client auto-update
  module" above.
- **`docs/versioning-policy.md`/`docs/architecture/clients/ios.md` describe
  a more elaborate `apiVersion`/`apiVersionFloor` integer scheme than the
  real backend implements today** — see "Client auto-update module" above
  for the noted drift; this pass implemented against the real
  `CompatibilityEntry` shape, per instructions, not the docs' aspirational
  one.
- **`grant_type`'s exact value** (`urn:ietf:params:oauth:grant-type:device_code`,
  `DeviceTokenRequest.deviceCodeGrantType`) was confirmed against the
  backend's `streamarr_api::oauth::DEVICE_CODE_GRANT_TYPE` constant, not
  guessed — see `backend/crates/streamarr-api/src/oauth.rs`.
- **Token persistence is in-memory only** (`AppEnvironment`'s
  `InMemoryTokenStore`) — there's a `// TODO` at the one call site
  (`refreshAccessToken()`) marking where Keychain-backed persistence and a
  real OAuth refresh-token exchange need to go. No operation this client
  drives requires authentication today (see `APIClient.swift`'s header
  note); `AccessTokenProviding`/`InMemoryTokenStore` exist to back the
  device-flow Sign In/Out UI in `SettingsView`.
- **No test target** — this package doesn't declare one yet, and can't
  meaningfully in this environment (see "Unit tests were attempted and
  reverted" above: neither `XCTest` nor `Testing` resolves here at all).
  `PlayerEngine`'s protocol and `StreamarrAPIClient`'s protocol are both
  designed to be mocked (see `PreviewAPIClient` for the shape a test
  double would take); once real Xcode is available, add a
  `StreamarrKitTests` target (schema round-trips, `AppUpdateEvaluator`,
  `AppStoreLookupClient` against a mocked `URLProtocol`) and a
  `StreamarrAppTests` target (`WorkDetailViewModel` against a fake
  `StreamarrAPIClient`) — this pass wrote and then removed exactly that
  pair, so the design just needs re-adding, not re-designing.
- **No Xcode project layer** (see "Why `StreamarrApp` isn't a real `.app`
  yet"). The first real step once Xcode is available: open
  `Package.swift` directly in Xcode, pick an iOS Simulator destination,
  and see what (if anything) needs adjusting for a genuine iOS SDK build
  — the macOS-substitute check above should have caught the large
  majority of real bugs already.
- **`release_date`/`air_date`-style fields are kept as `String?`** (Rust
  `NaiveDate`, plain `YYYY-MM-DD`), not parsed into `Date` — see
  `OpenAPISchemas.swift`'s note on `Episode.airDate` for why, and add a
  `DateFormatter("yyyy-MM-dd")` at the call site if date arithmetic on
  them is ever needed.
