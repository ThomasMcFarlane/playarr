# Playarr for iOS

Native SwiftUI client for iPhone and iPad. The checked-in Xcode project produces a real
`Playarr.app` bundle and consumes the local `StreamarrKit` Swift package for networking,
authentication, update compatibility, and AVPlayer-backed playback.

## Requirements

- Xcode with an iOS 17 or newer SDK
- iOS 17 or newer on an iPhone, iPad, or simulator
- A reachable Streamarr server
- An Apple development team for installation on a physical device

## Open and run

1. Open `Streamarr.xcodeproj`.
2. Select the shared `StreamarrApp` scheme.
3. Choose an iPhone or iPad destination.
4. For a physical device, select the `StreamarrApp` target and set your development team under
   Signing & Capabilities.
5. Run the app and sign in with the Streamarr server URL, username, and password.

The app defaults to `http://localhost:8484`, which is useful when the simulator and server run on
the same Mac. A physical device needs a server address it can reach. Use HTTPS for remote hosts;
the bundle's App Transport Security configuration permits local networking but does not broadly
disable transport security.

## Project layout

```text
clients/ios/
  Streamarr.xcodeproj/             # installable iOS app and shared scheme
  project.yml                      # XcodeGen source for the project
  Package.swift                    # StreamarrKit package manifest
  Resources/
    Assets.xcassets/               # Playarr app icon and accent colour
    Info.plist                     # bundle and local-network configuration
    PrivacyInfo.xcprivacy          # required-reason API privacy manifest
    StreamarrApp.entitlements
  Sources/
    StreamarrKit/                  # reusable domain, API, auth, update, and player code
    StreamarrApp/                  # SwiftUI app, views, and view models
  Tests/
    StreamarrKitTests/             # contract and update-policy tests
    StreamarrAppTests/             # app view-model tests
```

`StreamarrKit` deliberately has no UIKit dependency. The Xcode app target compiles only
`Sources/StreamarrApp` and links the package product, so shared business logic is not duplicated
inside the application target.

## Build and test

`platforms: [.iOS(.v17), .tvOS(.v17)]`. The iOS client and the native
Apple TV Xcode project at `clients/apple-tv` both consume the same
`StreamarrKit` product. Networking, domain, authentication, and
AVFoundation playback stay shared; the Apple TV target owns its separate
focus-engine and remote-control UI.

Run tests from Xcode with Product > Test on an installed iOS Simulator runtime. From the command
line, use an available simulator name from `xcrun simctl list devices available`:

```sh
xcodebuild \
  -project Streamarr.xcodeproj \
  -scheme StreamarrApp \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  test
```

Compile an unsigned simulator bundle without launching a runtime:

```sh
xcodebuild \
  -project Streamarr.xcodeproj \
  -target StreamarrApp \
  -configuration Debug \
  -sdk iphonesimulator \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Regenerate the project after changing `project.yml` with XcodeGen 2.45 or newer:

```sh
xcodegen generate --spec project.yml
```

Commit both `project.yml` and the generated `Streamarr.xcodeproj` so contributors do not need
XcodeGen just to build the app.

## Distribution configuration

The checked-in bundle identifier is `com.streamarr.ios`, marketing version `0.1.0`, and build
number `1`. Before App Store or TestFlight distribution:

1. Confirm the final registered bundle identifier and development team.
2. Replace `InstalledAppVersion.appStoreID` after App Store Connect assigns the numeric app ID.
3. Set the release version and build number in the `StreamarrApp` target.
4. Review the privacy declaration and local-network transport policy for the release environment.
5. Archive with a distribution certificate and validate the archive in Xcode Organizer.

Apple distribution remains App Store/TestFlight based; the update gate in the app can prompt or
block its own UI, but it cannot install code outside Apple's reviewed release process.

## Current product behaviour

- The SwiftUI interface follows Playarr Web's stage palette, rounded artwork, responsive rails,
  profile control, and floating access-gated navigation on both iPhone and iPad.
- The signed-out app presents the real server/username/password login flow; household profiles can
  be switched natively, including four-digit PIN verification.
- Home shows recently added and continue-watching rails, while per-kind libraries, search,
  playlists, and rich work details use the same Streamarr catalogue contract as Playarr Web.
- Playback negotiates direct or HLS media, supplies bearer authentication to AVPlayer's media
  requests, and renders native controls through AVPlayer/AVKit.
- Settings persists the server URL and appearance choice without embedding a web surface.
- Access and refresh tokens are persisted per server in the iOS Keychain and rotated before
  expiry; no WebView is used anywhere in the app.
- Foreground update checks compare this installed bundle version with the server's iOS
  compatibility entry.

The App Store ID and production signing team are intentionally unset because they are allocated
outside the repository.
