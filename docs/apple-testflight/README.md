# Apple TestFlight release

This runbook covers the native iOS and tvOS binaries produced by the Apple release
workflow. Both targets use the App Store Connect bundle identifier `app.playarr.ios`. The iOS
project uses SwiftUI, and Google Cast SDK 4.8.6 is pinned in `clients/ios/Podfile` and linked
through CocoaPods. The receiver application ID remains unset, so successful builds do not establish
end-to-end Cast operation.

## Release path

The source-side workflow is [iOS build and release dispatch](../../.github/workflows/ios-ci.yml).
It accepts a manual dispatch on `main` or an `ios-v*` tag and forwards an immutable full source SHA
to the Apple release pipeline. The private signed Apple release workflow
checks that the source commit is reachable from Playarr `main`, regenerates both native Xcode
projects, installs the pinned CocoaPods dependency, then signs, exports, and uploads iOS and tvOS.
There is no unsigned or build-only release mode in this workflow. Historical unsigned build runs
only validate development tooling; they are not release evidence.

For a manual source dispatch, use the full source SHA (or leave it empty to use the selected `main`
commit), a three-part numeric marketing version, and a fresh unique Apple-valid build number. The
private workflow also accepts `source_repository`, `source_sha`, `marketing_version`, and
`build_number` directly. Its automatic build-number fallback is the workflow run number and attempt.

### Owner setup for source-side dispatch

The `APPLE_DISPATCH_TOKEN` GitHub Actions secret is already configured, and the credential is also
provisioned as an out-of-band Kubernetes Secret. The existing OAuth token is broader than a
dedicated dispatch credential. At the next planned rotation, replace it with a short-lived,
least-privilege token limited to dispatching the private Apple workflow, then update both secret
stores without exposing its value. The private workflow holds the signing and App Store Connect
credentials; the source workflow uses its dispatch credential only to request an authorised build.

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
- Prepare public listing screenshots and metadata, plus complete App Review access instructions.
- Obtain explicit authorisation before public App Store submission and complete App Review.

Do not interpret internal beta state as public approval or device installation evidence.
