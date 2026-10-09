# Apple TestFlight release

This runbook covers the native iOS and tvOS binaries produced by the Apple release
workflow. Both targets use the App Store Connect bundle identifier `app.playarr.ios`. The iOS
project uses SwiftUI, and Google Cast SDK 4.8.6 is pinned in `clients/ios/Podfile` and linked
through CocoaPods. The receiver application ID remains unset, so successful builds do not establish
end-to-end Cast operation.

## Release path

The workflow is [Apple signed release](https://github.com/ThomasMcFarlane/playarr/blob/main/.github/workflows/ios-release.yml),
which runs on a GitHub-hosted macOS runner. It accepts an `ios-v*` tag or a manual dispatch,
checks that the commit is reachable from `main`, regenerates both native Xcode projects, installs
the pinned CocoaPods dependency, then signs, exports, and uploads iOS and tvOS. There is no
unsigned or build-only release mode in this workflow.

For a manual dispatch, use an optional full source SHA (default: the selected ref), a three-part
numeric marketing version, and a fresh unique Apple-valid build number (default: the workflow run
number and attempt). Signing and App Store Connect credentials live in the `release-ios`
environment; see [the setup list](../ios/TESTFLIGHT.md).

## Verified internal TestFlight state

On 4 October 2026, private run
<id>
completed successfully for source commit `b47fda4956f6a0adee39027689504bfcdd2b2adb`, marketing
version `1.0.0`, build number `1.2`. Both targets completed signed archive, export, and upload.
App Store Connect subsequently reported iOS build 1.2 and tvOS build 1.2 as `VALID`, with
`usesNonExemptEncryption=false` and `internalBuildState=IN_BETA_TESTING`. An authorised internal
tester invitation request was accepted. These records verify processing and internal TestFlight
state; they do not establish that a tester received, installed, or launched either app on a device.

## Separate public-release gates

The internal TestFlight path does not complete public App Store release preparation. These items
remain pending and are not authorised by this runbook:

- Review and update Apple-platform coverage in the linked privacy policy (task 285).
- Replace the source `InstalledAppVersion.appStoreID` placeholder before relying on the App Store
deep link.
- Prepare public listing screenshots and metadata, plus App Review notes explaining the bring-your-own-server model (Playarr provides no demo server or hosted review account; how App Review gets access is an open owner question, task 289).
- Obtain explicit authorisation before public App Store submission and complete App Review.

Do not interpret internal beta state as public approval or device installation evidence.
