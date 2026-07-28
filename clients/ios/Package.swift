// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Playarr",
    platforms: [
        // iOS 17 is the plan's stated minimum for the phone/tablet client.
        .iOS(.v17),
        // The sibling Apple TV Xcode project consumes the same
        // `PlayarrKit` product as a local package dependency.
        .tvOS(.v17)
    ],
    products: [
        // The formal SPM product consumed by `Playarr.xcodeproj` and
        // available to future Apple-platform app targets.
        .library(
            name: "PlayarrKit",
            targets: ["PlayarrKit"]
        )
    ],
    targets: [
        // API client, domain models, and the AVFoundation/AVKit player
        // wrapper. No UIKit/AppKit import anywhere in this target — that's
        // what makes it reusable from the Apple TV app target unchanged.
        .target(
            name: "PlayarrKit",
            dependencies: [],
            path: "Sources/PlayarrKit"
        ),

        // The SwiftUI source target is also retained for direct package
        // browsing. The installable app bundle is produced by the checked-in
        // Xcode project, which compiles this same source directory and links
        // the `PlayarrKit` package product.
        .executableTarget(
            name: "PlayarrApp",
            dependencies: ["PlayarrKit"],
            path: "Sources/PlayarrApp"
        ),
        .testTarget(
            name: "PlayarrKitTests",
            dependencies: ["PlayarrKit"],
            path: "Tests/PlayarrKitTests"
        )
    ]
)
