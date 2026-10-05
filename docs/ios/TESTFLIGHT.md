# iOS builds and TestFlight

## What runs

- Apple releases are manual/tag only. A manual workflow dispatch from Playarr `main` or an `ios-vX.Y.Z` tag sends an immutable commit to the Apple release pipeline and always requests a signed TestFlight release for both iOS and tvOS. The dispatcher verifies the source commit is reachable from `main`, generates both native projects, installs the pinned Google Cast iOS SDK 4.8.6 through CocoaPods, signs and exports each app, then uploads both builds to the same App Store Connect record. Missing dispatch or signing credentials fail the workflow.
- Supply the full release commit SHA (for example the commit tagged `ios-v1.0.0`). Build numbers default to `<GitHub run number>.<run attempt>`; an override must have Apple-valid numeric components and must be unique in App Store Connect. Marketing version defaults to `1.0.0`, matching the existing app record, and can be overridden at dispatch. Versions are numeric three-part values.

The dispatcher is private, uses the `apple-builders` group and stable `apple-builder` label, and checks out the exact Playarr commit through a read-only deploy key. The explicit TestFlight job signs and uploads both platform builds. Both app records use bundle ID `app.playarr.ios`, as required for the same App Store Connect app record, with SKU `playarr-ios`. The signed path imports the distribution certificate into a temporary keychain, matches the signing identity to the certificate embedded in each profile, and installs the matching profile while backing up and restoring any same-UUID profile. iOS reads `APPLE_PROVISIONING_PROFILE_BASE64`; tvOS reads `APPLE_TVOS_PROVISIONING_PROFILE_BASE64`. The App Store Connect key is held in a private temporary `private_keys` directory for `altool`. An exit trap removes temporary signing state.

## Owner setup still required

1. App Store Connect already has the Playarr app record with iOS and tvOS platforms, shared bundle ID `app.playarr.ios`, SKU `playarr-ios` and version 1.0. Keep both platform uploads attached to that record.
2. In the same Apple Developer team already used by AppSwitcher, use the existing matching distribution certificate and create App Store profiles for bundle ID `app.playarr.ios` on both iOS and tvOS. Export the certificate as a password-protected `.p12`; do not use AppSwitcher Developer ID or notarisation credentials.
3. Create an App Store Connect API key with permission to upload builds. Record its key ID and issuer ID and retain the `.p8` file securely.
4. Add these Actions secrets to the `release-ios` environment in the Apple release pipeline: `APPLE_DISTRIBUTION_P12_BASE64`, `APPLE_DISTRIBUTION_P12_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64` (iOS), `APPLE_TVOS_PROVISIONING_PROFILE_BASE64` (tvOS), `APPLE_TEAM_ID`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and `APP_STORE_CONNECT_API_KEY_BASE64`. Values ending in `BASE64` are the base64 encoding of the original binary file, without wrapping newlines. The signed release fails if any required credential is absent.
   Replace `KEYID` in the filename with the actual App Store Connect key ID. With GitHub CLI (and `APPLE_BUILDS_REPOSITORY=<owner>/<repo>` of the Apple release pipeline, the same value as the Playarr repository variable of that name), set file secrets without putting their contents in shell history:

   ```sh
   base64 -i distribution.p12 | tr -d '\r\n' | gh secret set APPLE_DISTRIBUTION_P12_BASE64 --repo "$APPLE_BUILDS_REPOSITORY" --env release-ios
   base64 -i AppStore-iOS.mobileprovision | tr -d '\r\n' | gh secret set APPLE_PROVISIONING_PROFILE_BASE64 --repo "$APPLE_BUILDS_REPOSITORY" --env release-ios
   base64 -i AppStore-tvOS.mobileprovision | tr -d '\r\n' | gh secret set APPLE_TVOS_PROVISIONING_PROFILE_BASE64 --repo "$APPLE_BUILDS_REPOSITORY" --env release-ios
   base64 -i AuthKey_KEYID.p8 | tr -d '\r\n' | gh secret set APP_STORE_CONNECT_API_KEY_BASE64 --repo "$APPLE_BUILDS_REPOSITORY" --env release-ios
   gh secret set APPLE_DISTRIBUTION_P12_PASSWORD --repo "$APPLE_BUILDS_REPOSITORY" --env release-ios
   gh secret set APPLE_TEAM_ID --repo "$APPLE_BUILDS_REPOSITORY" --env release-ios
   gh secret set APP_STORE_CONNECT_API_KEY_ID --repo "$APPLE_BUILDS_REPOSITORY" --env release-ios
   gh secret set APP_STORE_CONNECT_ISSUER_ID --repo "$APPLE_BUILDS_REPOSITORY" --env release-ios
   ```
5. The source repository's read-only deploy key is installed on Playarr and its private half is stored as the dispatcher repository secret `PLAYARR_READONLY_DEPLOY_KEY`. This has been configured read-only. Do not grant write access.
6. Install a fine-grained GitHub token scoped only to the Apple release pipeline with Actions write permission, then save it as Playarr's `APPLE_DISPATCH_TOKEN` using `gh secret set APPLE_DISPATCH_TOKEN --repo ThomasMcFarlane/playarr`. The source workflow requires it to dispatch the private workflow. No broad personal token belongs in the dispatcher.
7. After the dispatcher workflow is merged to its default branch, push an `ios-vX.Y.Z` tag for a commit on `main`, or manually dispatch the Playarr workflow from `main`. Either request always runs signed TestFlight uploads for iOS and tvOS.

## Current gates

- The signed workflow's first Apple runner execution and TestFlight upload remain required for acceptance. the Apple release pipeline uses `apple-builders` and `apple-builder`; the `release-ios` environment has no reviewer or wait-timer protection rules because the plan rejected them.
- Apple certificate/team and both ACTIVE platform profiles match `app.playarr.ios`; the profiles and shared signing credentials are installed in the private `release-ios` environment and expire in 2027. The App Store Connect app record is verified for iOS and tvOS. The source `APPLE_DISPATCH_TOKEN` is not installed, so the source workflow will fail its credential check until configured. The earlier unsigned dispatcher run verified only simulator/archive tooling and is not signed-release acceptance evidence.
- The workflow is a declared Apple runner job in the private organisation repository. The public shared workflow is not used for signing and receives no credentials.
