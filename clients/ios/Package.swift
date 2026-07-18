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
        // what makes it reusable from the Apple TV app target unchanged.
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

        // No `.testTarget` yet: this environment (Command Line Tools only,
        // no Xcode) has neither `XCTest.framework` nor the `Testing`
        // module available under any swift-tools-version — confirmed by
        // direct experiment, not assumed (both `import XCTest` and
        // `import Testing` fail to resolve even inside a trivial scratch
        // SPM package). A `StreamarrKitTests`/`StreamarrAppTests` pass
        // (schema decode/encode round-trips against real spec-shaped
        // fixtures, `AppUpdateEvaluator` version-comparison boundary
        // cases, `WorkDetailViewModel` behavior against a fake
        // `StreamarrAPIClient`) was written and then reverted for
        // this reason: none of it could be type-checked here, so keeping
        // it would mean shipping asserted-but-never-compiled test code.
        // Re-add once real Xcode is available — see clients/ios/README.md
        // "No test target" for the existing note this extends.
    ]
)
