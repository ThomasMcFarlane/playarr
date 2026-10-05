# iOS builds and TestFlight

## What runs

- `.github/workflows/ios-release.yml` builds, signs and uploads iOS and tvOS to TestFlight on a GitHub-hosted `macos-latest` runner. It runs on an `ios-vX.Y.Z` tag or a manual dispatch (inputs: optional commit SHA, marketing version, build number, platform `both|ios|tvos`). It verifies the commit is reachable from `main`, generates both native projects, installs the pinned Google Cast iOS SDK 4.8.6 through CocoaPods, signs and exports each app, then uploads both builds to the same App Store Connect record. Missing signing credentials fail the workflow before any build.
- `.github/workflows/simulator-tests.yml` (manual dispatch only) runs the iOS and tvOS Xcode tests on a freshly created Simulator on `macos-latest`. It does not sign or upload.
- Build numbers default to `<GitHub run number>.<run attempt>`; an override must have Apple-valid numeric components and must be unique in App Store Connect. Marketing version defaults to the tag version, else `1.0.0`. Versions are numeric three-part values.

Both app records use bundle ID `app.playarr.ios`, as required for the same App Store Connect app record. The signed path (`clients/ios/scripts/release.sh`) imports the distribution certificate into a temporary keychain, matches the signing identity to the certificate embedded in each profile, and installs the matching profile. iOS reads `APPLE_PROVISIONING_PROFILE_BASE64`; tvOS reads `APPLE_TVOS_PROVISIONING_PROFILE_BASE64`. The App Store Connect key is held in a private temporary `private_keys` directory for `altool`. An exit trap removes temporary signing state.

## Owner setup

1. Keep the App Store Connect app record with iOS and tvOS platforms and the shared bundle ID `app.playarr.ios`.
2. Use a matching distribution certificate and App Store profiles for the bundle ID on iOS and tvOS. Export the certificate as a password-protected `.p12`.
3. Create an App Store Connect API key with permission to upload builds.
4. Create the `release-ios` environment in this repository (add required reviewers if desired) and add these environment secrets: `APPLE_DISTRIBUTION_P12_BASE64`, `APPLE_DISTRIBUTION_P12_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64` (iOS), `APPLE_TVOS_PROVISIONING_PROFILE_BASE64` (tvOS), `APPLE_TEAM_ID`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_BASE64`. Values ending in `BASE64` are the base64 encoding of the original file, without wrapping newlines:

   ```sh
   base64 -i distribution.p12 | tr -d '\r\n' | gh secret set APPLE_DISTRIBUTION_P12_BASE64 --env release-ios
   base64 -i AppStore-iOS.mobileprovision | tr -d '\r\n' | gh secret set APPLE_PROVISIONING_PROFILE_BASE64 --env release-ios
   base64 -i AppStore-tvOS.mobileprovision | tr -d '\r\n' | gh secret set APPLE_TVOS_PROVISIONING_PROFILE_BASE64 --env release-ios
   base64 -i AuthKey_KEYID.p8 | tr -d '\r\n' | gh secret set APP_STORE_CONNECT_API_KEY_BASE64 --env release-ios
   gh secret set APPLE_DISTRIBUTION_P12_PASSWORD --env release-ios
   gh secret set APPLE_TEAM_ID --env release-ios
   gh secret set APP_STORE_CONNECT_API_KEY_ID --env release-ios
   gh secret set APP_STORE_CONNECT_ISSUER_ID --env release-ios
   ```
5. Push an `ios-vX.Y.Z` tag for a commit on `main`, or dispatch the workflow from `main`.

## Current gates

- The first signed run on a GitHub-hosted macOS runner and its TestFlight upload remain required for acceptance. Earlier signed runs were performed on a different (self-hosted) runner; hosted-runner behaviour (keychain access, installed Xcode and Simulator runtimes) is unverified.
