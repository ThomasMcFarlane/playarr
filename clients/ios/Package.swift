// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Streamarr",
    platforms: [
        // iOS 17 is the plan's stated minimum for the phone/tablet client.
        //
        // tvOS is deliberately NOT listed yet. `StreamarrKit` (Models,
        // Networking, Player, Auth) is written with zero UIKit dependency
        // for exactly this reason: when the tvOS client is scoped, add
        // `.tvOS(.v17)` to this list and a new `StreamarrTVApp` executable
        // target that depends on this same `StreamarrKit` product — no
        // source changes to StreamarrKit should be required. See
        // clients/ios/README.md for the reasoning and what would need to
        // change (mainly `PlayerView`/focus-engine navigation, which lives
        // in the app target, not the kit).
        .iOS(.v17)
    ],
    products: [
        // The only formal SPM *product* this package exports. StreamarrApp
        // (below) is intentionally not a product — see the target comment
        // and clients/ios/README.md for why a SwiftUI app target in a
        // source-only SPM package can't be a fully installable .app
        // without an Xcode project (or Xcode's Swift Playgrounds "App"
        // product type) layered on top.
        .library(
            name: "StreamarrKit",
            targets: ["StreamarrKit"]
        )
    ],
    targets: [
        // API client, domain models, and the AVFoundation/AVKit player
        // wrapper. No UIKit/AppKit import anywhere in this target — that's
        // what makes it reusable from a future tvOS app target unchanged.
        .target(
            name: "StreamarrKit",
            dependencies: [],
            path: "Sources/StreamarrKit"
        ),

        // The SwiftUI app shell. Declared as an `.executableTarget` so
        // `swift build`/`swift run` can at least type-check and (on a
        // machine with the full iOS SDK) run it as a plain SwiftUI
        // lifecycle app; producing a signed, installable .app bundle
        // (Info.plist, asset catalog, entitlements, code signing) still
        // requires wrapping this package in an Xcode project once Xcode is
        // available in this environment. See clients/ios/README.md.
        .executableTarget(
            name: "StreamarrApp",
            dependencies: ["StreamarrKit"],
            path: "Sources/StreamarrApp"
        )
    ]
)
