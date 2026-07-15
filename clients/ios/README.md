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
    StreamarrKit/            # library target — no UIKit dependency anywhere
      Models/                 # Codable structs mirroring streamarr-model
      Networking/APIClient.swift
      Player/PlayerEngine.swift
      Auth/DeviceFlowClient.swift
    StreamarrApp/             # SwiftUI app target
      App.swift
      AppEnvironment.swift
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
anywhere (Models/Networking/Player/Auth all stick to
Foundation/Combine/Observation/AVFoundation/AVKit, which are available on
iOS, tvOS, and macOS alike). When the tvOS client is scoped, the expected
change is additive: add `.tvOS(.v17)` to `platforms` and a new
`StreamarrTVApp` executable target depending on the same `StreamarrKit`
product — no source changes to `StreamarrKit` should be required. The one
place tvOS will need real new code is the app-target UI layer (focus
engine navigation, remote-control handling), which lives in
`StreamarrApp`/a future `StreamarrTVApp`, not in the kit.

## `streamarr-model` mirroring — what's inferred vs. verified

At the time this scaffold was written, `backend/crates/streamarr-model/`
only had two files on disk: `lib.rs` (module declarations + `pub use`
re-exports) and `sensitive.rs`. The other modules it declares
(`work.rs`, `media.rs`, `playback.rs`, `series.rs`, `user.rs`, `source.rs`,
`policy.rs`, `platform.rs`, `music.rs`, `publishing.rs`) did not exist yet
— presumably being written concurrently by the backend agent.

So the Swift models under `Sources/StreamarrKit/Models/` are built from
two different confidence levels:

- **Verified**: the exact set of type names each module exports (via
  `lib.rs`'s `pub use` list), and the exact shape of `Sensitive<T>` (read
  directly from `sensitive.rs` and mirrored 1:1 in `Models/Sensitive.swift`
  — same redaction semantics, same `expose_secret`/`exposeSecret` escape
  hatch, same transparent `Codable`).
- **Inferred, not verified**: every field name, type, optionality, and the
  assumption that the wire format is snake_case JSON (serde's default,
  since no crate-wide `rename_all` was observed — but that's exactly one
  data point, from one file). Every model file has a `MIRROR NOTE` doc
  comment at the top saying exactly this and naming the `.rs` file to
  reconcile against once it lands.

Deliberately **out of scope** for this pass: `music.rs`'s `Album` /
`AlbumType` / `Artist` / `Track` and `publishing.rs`'s `Author` / `Book`.
The task's explicit examples (`Work`, `MediaFile`, `PlaybackSession`) are
all video-streaming-path types; the video path is fully mirrored
(`Work`/`Series`/`Season`/`Episode`/`MediaFile`/`Rendition`/
`PlaybackSession`/`PlaybackEvent`, plus the supporting `User`/`Device`/
`Session`, `SourceInstance`, `Policy`, and `ClientPlatform`/
`VersionEnvelope` types). Add `Models/Music.swift` and
`Models/Publishing.swift` the same way (1:1 with the Rust module, explicit
`CodingKeys`, explicit `public init`) once those screens are in scope.

Every model uses **explicit `CodingKeys`** rather than
`JSONDecoder.keyDecodingStrategy = .convertFromSnakeCase`, specifically
because Swift's automatic snake_case conversion doesn't round-trip
Swift's own idiomatic `ID` capitalization (`workID` decoded from
`work_id` needs `case workID = "work_id"`; the automatic converter
produces `workId` instead, silently failing to match). Every public
struct also has a hand-written `public init(...)` — Swift does not
synthesize a `public` memberwise initializer even when every property is
`public`, and `StreamarrApp` (a separate module) needs to construct these
types directly (see `Views/PreviewSupport.swift`).

## `Networking/APIClient.swift` — the openapi-generator placeholder

`backend/openapi/` is empty in this tree so far, so there's no spec to
generate a client from yet. `APIClient.swift` is a real, working
`URLSession`-based implementation of the `StreamarrAPIClient` protocol —
not a stub — specifically so the rest of the app has something functional
to build and test against today. The file's own header comment spells out
the exact migration path: once `backend/openapi/openapi.yaml` exists, run
`openapi-generator-cli generate -g swift5 ...`, make the generated
client's type conform to `StreamarrAPIClient`, and delete the hand-rolled
`APIClient` class (keep the protocol — every view model already codes
against `StreamarrAPIClient`, never `APIClient` concretely, so this swap
is meant to be a one-line dependency-injection change).

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
protocol so it's mockable in tests.

## `Auth/DeviceFlowClient.swift`

Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) end to end:
`requestDeviceCode()` (§3.1/§3.2), `pollForToken(deviceCode:interval:
expiresIn:)` (§3.4/§3.5, including honoring `slow_down` by adding 5s to
the poll interval and respecting the code's `expires_in`), and an
`authorize(onAuthorizationPending:)` convenience that runs both steps.
It's an `actor` (not a `@MainActor` class) specifically so it satisfies
`Sendable` without relying on global-actor-isolation-implies-Sendable
inference. `AppEnvironment`/`SettingsViewModel` wire it up as the app's
sign-in flow.

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

The `swift` compiler (Command Line Tools, no `xcodebuild`) is present:

```
$ swift --version
swift-driver version: 1.148.6 Apple Swift version 6.3.2 (swiftlang-6.3.2.1.108 clang-2100.1.1.101)
Target: arm64-apple-macosx26.0
```

`xcodebuild` is present as a binary but errors immediately
(`xcode-select: error: tool 'xcodebuild' requires Xcode, but active
developer directory ... is a command line tools instance`) — there is no
iOS SDK in this environment, so a real `swift build` targeting iOS is not
possible here.

As a substitute, `swift build` was run against this package with a
**temporary, local-only** `.macOS(.v14)` entry added to `platforms` (the
committed `Package.swift` is iOS-only, as required — the macOS entry was
removed again before finishing). This isn't a real validation of iOS
behavior, but it does catch genuine Swift syntax/type errors, since
`StreamarrKit` has no UIKit dependency and almost all of the APIs it uses
(Foundation, Combine, Observation, AVFoundation, AVKit, SwiftUI) exist on
both platforms.

Result, on a clean build (`rm -rf .build && swift build`):

- **`StreamarrKit` (the library target — Models, Networking, Player,
  Auth): zero errors, zero warnings.** Two real issues surfaced and were
  fixed during this pass: a deprecated synchronous `AVAsset.duration`
  read (replaced with the value already returned by
  `asset.load(.isPlayable, .duration)`), and two MainActor-isolation
  warnings in `AVPlayerEngine`'s periodic time-observer closure (fixed by
  hopping via `Task { @MainActor in ... }`, matching the pattern already
  used in the KVO closures).
- **`StreamarrApp` (the SwiftUI app target): only two categories of
  failure, both artifacts of substituting macOS for iOS locally, not
  source defects**:
  1. `#Preview { ... }` in each `Views/*.swift` file fails with *"external
     macro implementation type 'PreviewsMacros.SwiftUIView' could not be
     found... plugin for module 'PreviewsMacros' not found"* — that macro
     plugin binary ships inside `Xcode.app`, not the Command Line Tools;
     this is expected to work once opened in real Xcode and was left in
     place as legitimate, standard SwiftUI scaffold code.
  2. `SettingsView.swift`'s `TextField` chain
     (`.textInputAutocapitalization(.never)`, `.keyboardType(.URL)`) fails
     to type-check *only* because these are iOS/tvOS/watchOS-only
     `View` modifiers with no macOS counterpart — correct, current
     SwiftUI API for an iOS 17 target, just inapplicable to the macOS
     stand-in used for this local check.

No other errors were found in either target across the whole package.
Every other file in `StreamarrApp` (`App.swift`, `AppEnvironment.swift`,
`RootView.swift`, `HomeView.swift`, `LibraryView.swift`,
`PlayerView.swift`, all four `ViewModels/*.swift`) compiled cleanly
against the macOS stand-in.

## Known gaps / assumptions to revisit

- **Field-level model shapes are inferred**, not verified against real
  Rust structs — see "`streamarr-model` mirroring" above. Reconcile once
  `backend/crates/streamarr-model/src/{work,media,playback,series,user,
  source,policy,platform}.rs` exist.
- **Token persistence is in-memory only** (`AppEnvironment`'s
  `InMemoryTokenStore`) — there's a `// TODO` at the one call site
  (`refreshAccessToken()`) marking where Keychain-backed persistence and a
  real OAuth refresh-token exchange need to go.
- **No test target** — this package doesn't declare one yet. Once real
  network/player behavior needs testing, `PlayerEngine`'s protocol and
  `StreamarrAPIClient`'s protocol are both designed to be mocked; a
  `StreamarrKitTests` target can be added to `Package.swift` without
  touching either.
- **No Xcode project layer** (see "Why `StreamarrApp` isn't a real `.app`
  yet"). The first real step once Xcode is available: open
  `Package.swift` directly in Xcode, pick an iOS Simulator destination,
  and see what (if anything) needs adjusting for a genuine iOS SDK build
  — the macOS-substitute check above should have caught the large
  majority of real bugs already.
- **Assumed camelCase-with-`ID` Swift naming maps to snake_case JSON.**
  If the real backend actually serializes camelCase (e.g. via a
  crate-wide `#[serde(rename_all = "camelCase")]`), every model's
  `CodingKeys` needs its right-hand-side string updated accordingly — the
  Swift property names themselves (and everything else) stay the same.
