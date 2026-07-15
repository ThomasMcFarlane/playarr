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
(`backend/crates/streamarr-model`, `streamarr-catalog`, `streamarr-requests`,
`streamarr-auth`, `streamarr-api`) — see that file's header comment for
the full provenance note and why a handful of schemas (`ExternalProvider`,
`RequestTarget`, `WorkChildren`) need custom `Codable` conformances a
generic `openapi-generator-cli -g swift5` run wouldn't produce correctly
(Rust's default externally-tagged and internally-tagged enum
representations).

`StreamarrAPIClient`/`APIClient` in `APIClient.swift` cover every
operation in the spec except the two OAuth device-flow endpoints, which
live in `Auth/DeviceFlowClient.swift` instead (see that file's header for
why the split): system health/ready/version, catalog browse/search/get,
the media-request lifecycle (list/submit/approve/reject), playback
negotiation, and the `*arr` webhook receiver. View models code against the
`StreamarrAPIClient` protocol, never `APIClient` concretely, so swapping
in a different implementation (or a mock for tests) is a one-line
dependency-injection change — see `Views/PreviewSupport.swift`'s
`PreviewAPIClient` for exactly that.

**Known real gap in the spec, not a client-side placeholder:** none of
`Work`/`Episode`/`Track`/`Book` carry a `media_file_id` anywhere in the
current schema — catalog and playback-negotiation aren't cross-linked yet
server-side (`streamarr-api/src/playback.rs`'s own doc comment notes there
is no `MediaFileRepo` yet). `WorkDetailViewModel`'s doc comment and
`PlayerView`'s manual media-file-ID entry field are the honest
reflection of that: playback is wired end-to-end against the real `GET
/api/v1/playback/{media_file_id}` endpoint, it just can't be reached by
tapping something in the catalog UI yet, only by supplying an id
directly.

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
- **`StreamarrApp` (the SwiftUI app target): only three categories of
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

No other errors were found in either target across the whole package.

## Known gaps / assumptions to revisit

- **Catalog/playback aren't cross-linked server-side yet** — see the
  "Known real gap in the spec" note above. Once the backend exposes a
  `media_file_id` from a catalog `Work`/`Episode`/`Track`/`Book` (or a
  dedicated "media files for this work" endpoint), wire `WorkDetailView`'s
  "Play…" button straight to it instead of the manual entry field in
  `PlayerView`.
- **`grant_type`'s exact value** (`urn:ietf:params:oauth:grant-type:device_code`,
  `DeviceTokenRequest.deviceCodeGrantType`) was confirmed against the
  backend's `streamarr_api::oauth::DEVICE_CODE_GRANT_TYPE` constant, not
  guessed — see `backend/crates/streamarr-api/src/oauth.rs`.
- **Token persistence is in-memory only** (`AppEnvironment`'s
  `InMemoryTokenStore`) — there's a `// TODO` at the one call site
  (`refreshAccessToken()`) marking where Keychain-backed persistence and a
  real OAuth refresh-token exchange need to go. No route in the current
  spec is documented as requiring authentication yet either (no
  auth-extraction middleware exists server-side in this pass — see
  `SubmitRequestBody.requestedBy`'s `TODO(auth)` in the spec) — every
  request still attaches whatever bearer token is available so the client
  is ready the moment that middleware lands, without another client-side
  change.
- **No test target** — this package doesn't declare one yet. Once real
  network/player behavior needs testing, `PlayerEngine`'s protocol and
  `StreamarrAPIClient`'s protocol are both designed to be mocked (see
  `PreviewAPIClient` for the shape a test double would take); a
  `StreamarrKitTests` target can be added to `Package.swift` without
  touching either.
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
