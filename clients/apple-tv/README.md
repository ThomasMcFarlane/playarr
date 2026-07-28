# Playarr for Apple TV

Native SwiftUI tvOS client for Playarr Server. It uses the shared
`clients/ios/PlayarrKit` package for API schemas, networking, RFC 8628
device-code authentication, and AVFoundation playback.

## Features

- Native tvOS tab, focus, card, scroll, and remote-control behaviour.
- Recently added and search views backed by the Playarr Server catalogue API.
- Movie, episode, track, and book detail-to-playback navigation using real
  media-file identifiers returned by the server.
- AVKit playback after Playarr Server direct-play/HLS negotiation.
- Phone-friendly device-code pairing and an editable self-hosted server address.

The backend currently has one Apple-platform `ios` compatibility and policy
value rather than a separate tvOS value. This client therefore identifies as
`ios` until the server contract gains a dedicated Apple TV platform.

## Build and test

The checked-in Xcode project is generated from `project.yml` with XcodeGen so
project changes remain reviewable:

```sh
cd clients/apple-tv
xcodegen generate
xcodebuild -project PlayarrTV.xcodeproj -scheme PlayarrTV \
  -destination 'platform=tvOS Simulator,name=Apple TV' test
```

For a compile-only check that does not need a running simulator:

```sh
xcodebuild -project PlayarrTV.xcodeproj -target PlayarrTV \
  -sdk appletvsimulator -configuration Debug build CODE_SIGNING_ALLOWED=NO
```

The bundle identifier, signing team, version, and artwork are development
defaults. Set the release signing and App Store metadata in the delivery
configuration before distributing the app.
