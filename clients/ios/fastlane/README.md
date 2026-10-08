# iOS and tvOS App Store metadata (row 289)

`metadata/en-GB/` follows the fastlane `deliver` layout for the single App Store Connect record shared by iOS and
tvOS. It holds the listing text, support and privacy URLs and the App Review notes. Credentials for the App Review
demonstration account are entered in App Store Connect only and are never committed. The review phone number is
also entered there.

Public listing screenshots must show the open-movie demo library (see `clients/android/fastlane/README.md` and
`scripts/showcase`), never the parity fixture. They need an iPhone, iPad and Apple TV simulator capture on a macOS
runner and are not yet produced. Nothing here is submitted for review: submission needs explicit owner approval.

`clients/ios/scripts/appstore-metadata.contract.test.mjs` checks the Apple field length limits.
