# Playarr for iOS

Native SwiftUI client for iPhone and iPad. `project.yml` generates the Xcode project and the
CocoaPods dependency declaration pins Google Cast SDK 4.8.6. The app consumes the local
`PlayarrKit` Swift package for networking, authentication, update compatibility, and AVPlayer-backed
playback. The signed release workflow also builds the native Apple TV app from `clients/apple-tv`.

## Requirements

- Xcode with an iOS 17 or newer SDK
- iOS 17 or newer on an iPhone, iPad, or simulator
- A reachable Playarr Server
- An Apple development team for installation on a physical device

## Open and run

1. Generate the project with XcodeGen and install the CocoaPods dependency:

   ```sh
   xcodegen generate --spec project.yml
   pod install
   ```

2. Open `Playarr.xcworkspace` so the Google Cast pod is linked.
3. Select the shared `PlayarrApp` scheme.
4. Choose an iPhone or iPad destination.
5. For a physical device, select the `PlayarrApp` target and set your development team under
   Signing & Capabilities.
6. Run the app and sign in with the Playarr Server URL, username, and password.

The app defaults to `http://localhost:8484`, which is useful when the simulator and server run on
the same Mac. A physical device needs a server address it can reach. Use HTTPS for remote hosts;
the bundle's App Transport Security configuration permits local networking but does not broadly
disable transport security.

## Project layout

```text
clients/ios/
  project.yml                    # XcodeGen source for the iOS app project
  Playarr.xcodeproj/             # generated iOS app project
  Playarr.xcworkspace/           # generated after CocoaPods setup
  Package.swift                    # PlayarrKit package manifest
  Resources/
    Assets.xcassets/               # Playarr app icon and accent colour
    Info.plist                     # bundle and local-network configuration
    PrivacyInfo.xcprivacy          # required-reason API privacy manifest
    PlayarrApp.entitlements
  Sources/
    PlayarrKit/                  # reusable domain, API, auth, update, and player code
    PlayarrApp/                  # SwiftUI app, views, and view models
  Tests/
    PlayarrKitTests/             # contract and update-policy tests
    PlayarrAppTests/             # app view-model tests
```

`PlayarrKit` deliberately has no UIKit dependency. The Xcode app target compiles only
`Sources/PlayarrApp` and links the package product, so shared business logic is not duplicated
inside the application target.

## Build and test

`platforms: [.iOS(.v17), .tvOS(.v17)]`. The iOS client and the native
Apple TV Xcode project at `clients/apple-tv` both consume the same
`PlayarrKit` product. Networking, domain, authentication, and
AVFoundation playback stay shared; the Apple TV target owns its separate
focus-engine and remote-control UI.

Run tests from Xcode with Product > Test on an installed iOS Simulator runtime. From the command
line, use an available simulator name from `xcrun simctl list devices available`:

```sh
xcodebuild \
  -workspace Playarr.xcworkspace \
  -scheme PlayarrApp \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  test
```

Compile an unsigned simulator bundle without launching a runtime:

```sh
xcodebuild \
  -workspace Playarr.xcworkspace \
  -scheme PlayarrApp \
  -configuration Debug \
  -sdk iphonesimulator \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Regenerate the project after changing `project.yml` with XcodeGen 2.45 or newer:

```sh
xcodegen generate --spec project.yml
```

The CI release workflow regenerates `Playarr.xcodeproj` from `project.yml` before CocoaPods setup.

## Distribution configuration

Both distribution targets use the registered App Store Connect bundle identifier
`app.playarr.ios`. The source project defaults to marketing version `1.0.0`; the private signed
release workflow assigns a fresh Apple-valid build number for each release. The iOS and tvOS
targets have separate active App Store provisioning profiles and use the Apple runner
for signed archive, export, and TestFlight upload. There is no unsigned release stage.

The source repository's automatic/manual dispatcher requires the owner to create a fine-grained
GitHub token with `Actions: read and write` access limited to the Apple release pipeline,
then add it as `APPLE_DISPATCH_TOKEN` in this repository's Actions secrets. It is currently
absent, so source-side dispatch is not ready. The private workflow can be inspected or dispatched
from the Apple release workflow.
See [the TestFlight runbook](../../docs/apple-testflight/README.md) for the owner setup links and
current build evidence.

Before public App Store release:

1. Replace the numeric App Store listing ID placeholder used by the update deep link.
2. Complete Apple-platform privacy-policy coverage, store screenshots and listing metadata, and
   App Review access instructions.
3. Obtain explicit release authorisation and complete App Store review and submission.

Apple distribution remains App Store/TestFlight based; the update gate in the app can prompt or
block its own UI, but it cannot install code outside Apple's reviewed release process.

## Current product behaviour

- The SwiftUI interface follows Playarr Web's stage palette, rounded artwork, responsive rails,
  profile control, and floating access-gated navigation on both iPhone and iPad.
- The signed-out app presents the real server/username/password login flow; household profiles can
  be switched natively, including four-digit PIN verification.
- Home shows recently added and continue-watching rails, while per-kind libraries, search,
  playlists, and rich work details use the same Playarr Server catalogue contract as Playarr Web.
- Playback negotiates direct or HLS media, supplies bearer authentication to AVPlayer's media
  requests, and renders native controls through AVPlayer/AVKit.
- Settings persists the server URL and appearance choice without embedding a web surface.
- Access and refresh tokens are persisted per server in the iOS Keychain and rotated before
  expiry; no WebView is used anywhere in the app.
- Foreground update checks compare this installed bundle version with the server's iOS
  compatibility entry.

The App Store Connect app record and signing setup now exist. TestFlight processing and internal
beta state are verified, but these records do not prove that a build was delivered to or installed
on a physical device. Public listing preparation and submission remain separate work.

## Chromecast

`Sources/PlayarrApp/Cast/` adds a Google Cast sender, mirroring the same
protocol and delegated device-auth model as the Web and Android senders; see
[`docs/architecture/clients/cast.md`](../../docs/architecture/clients/cast.md).
The receiver App ID is read from the `PlayarrCastReceiverAppID` key in
`Resources/Info.plist`, left empty on purpose; `AppDelegate` only initialises
`GCKCastContext` when that value is non-empty.

The `google-cast-sdk` CocoaPod is pinned to 4.8.6, and the signed iOS archive and export completed
successfully with the Cast sources included. The Cast receiver application ID is still empty in
`Resources/Info.plist`, so receiver discovery and Cast playback have not been validated as an
end-to-end feature. Configure a real receiver ID before claiming that runtime path is ready.
