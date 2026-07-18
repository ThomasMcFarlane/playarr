// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Streamarr",
    platforms: [
        // iOS 17 is the plan's stated minimum for the phone/tablet client.
        .iOS(.v17),
        // The sibling Apple TV Xcode project consumes the same
        // `StreamarrKit` product as a local package dependency.
        .tvOS(.v17)
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
        // what makes it reusable from the Apple TV app target unchanged.
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
