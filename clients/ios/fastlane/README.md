# iOS and tvOS App Store metadata (row 289)

`metadata/en-GB/` follows the fastlane `deliver` layout for the single App Store Connect record shared by iOS and
tvOS. It holds the listing text, support and privacy URLs and the App Review notes. Playarr is bring-your-own-server and the
project provides no demo server or hosted review account (owner, 2026-10-09), so the review notes explain that model.
Any server address or credentials the owner decides to enter in App Store Connect are never committed. The review
phone number is also entered there.

Public listing screenshots must show the open-movie demo library (see `clients/android/fastlane/README.md` and
`scripts/showcase`), never the parity fixture. They need an iPhone, iPad and Apple TV simulator capture on a macOS
runner and are not yet produced. Nothing here is submitted for review: submission needs explicit owner approval.

`clients/ios/scripts/appstore-metadata.contract.test.mjs` checks the Apple field length limits.

Store policy note (2026-10-09): Apple guideline 2.1(a) names a demo account with live backend services, or a built-in
demo mode with prior approval from Apple. Whether App Review notes alone suffice for a bring-your-own-server client is an
open owner decision tracked in `TASKS.md` row 289.
