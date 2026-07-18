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
        // The formal SPM product consumed by `Streamarr.xcodeproj` and
        // available to future Apple-platform app targets.
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

        // The SwiftUI source target is also retained for direct package
        // browsing. The installable app bundle is produced by the checked-in
        // Xcode project, which compiles this same source directory and links
        // the `StreamarrKit` package product.
        .executableTarget(
            name: "StreamarrApp",
            dependencies: ["StreamarrKit"],
            path: "Sources/StreamarrApp"
        ),
        .testTarget(
            name: "StreamarrKitTests",
            dependencies: ["StreamarrKit"],
            path: "Tests/StreamarrKitTests"
        )
    ]
)
