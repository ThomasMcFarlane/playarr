# Google Cast SDK dependency

The native iOS Cast implementation in this directory uses the official Google Cast iOS SDK through CocoaPods. `clients/ios/Podfile` pins `google-cast-sdk` to 4.8.6, and CI runs `scripts/prepare.sh` to generate the Xcode project and CocoaPods workspace before building. Do not remove the Cast integration or replace it with a web playback path.

For local setup, run `bash scripts/prepare.sh` from `clients/ios` with Xcode, Ruby and CocoaPods available. CI uses a temporary Ruby gem home when the pinned CocoaPods version is not already installed; it does not modify the runner owner's Ruby installation.
