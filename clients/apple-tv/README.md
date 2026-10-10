# Playarr for Apple TV

Native SwiftUI tvOS client for Playarr Server. It uses the shared
`clients/ios/PlayarrKit` package for API schemas, networking, RFC 8628
device-code authentication, and AVFoundation playback.

**No WebView.** Catalogue, settings, player chrome, and visual-parity captures
are production SwiftUI only. Do not introduce `WKWebView` / web-shell / web-ref
paint for parity (other platforms’ WebView shells are not a model for Apple).

## Features

- Native tvOS tab, focus, card, scroll, and remote-control behaviour.
- Recently added and search views backed by the Playarr Server catalogue API.
- Movie, episode, track, and book detail-to-playback navigation using real
  media-file identifiers returned by the server.
- AVKit playback after Playarr Server direct-play/HLS negotiation.
- Phone-friendly pairing via playarr.app hosted device link (QR / code). The
  linking device supplies the Playarr Server API URL in the claim — the TV does
  not ask for a server address on first launch.
- Advanced: Settings → Server connection can set a direct server URL (or pass
  `-PlayarrServerURL` for dev/parity). Direct RFC 8628 pairing is used only
  when a server is already configured.

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

## Playarr for Mac

The `PlayarrMac` target builds the same sources and `PlayarrKit` for macOS: the Apple TV app's 10-foot layout
(web TV) in a resizable 16:9 window, 1920x1080 by default and at least 1280x720, scaled to the window as web TV
scales to the viewport. The macOS-only pieces live in `macOS/`: `PlatformShims.swift` maps the UIKit and
tvOS-only names the shared code uses, `MacFocus.swift` gives every button keyboard and hover focus with web TV's
geometric arrow moves, and `PlayarrMacApp.swift` owns the window. Keys: arrows move, Return selects, Shift+Return
or a right click opens a card's actions (the long press), Escape or Delete is Back, and Space is Play/Pause.
`-PlayarrMuted` mutes playback as on tvOS.

```sh
xcodebuild -project PlayarrTV.xcodeproj -scheme PlayarrMac -destination 'platform=macOS' test CODE_SIGNING_ALLOWED=NO
```

Debug builds also listen for the distributed notification `app.playarr.macos.debug` (`MacDebugRemote.swift`),
which renders the app's own window to a PNG and posts keys or taps into it, for parity captures without screen
recording.

The bundle identifier, signing team, version, and artwork are development
defaults. Set the release signing and App Store metadata in the delivery
configuration before distributing the app.
