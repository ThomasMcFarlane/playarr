# Google Cast iOS SDK: dependency status

Google Cast iOS SDK has no SPM distribution as of 2026-07-28. To integrate:
download the CocoaPods/manual XCFramework distribution from
https://developers.google.com/cast/docs/ios_sender, add it as a vendored
framework in Xcode (drag into the project, embed & sign), and set
`OTHER_LDFLAGS = -ObjC -lc++` on the PlayarrApp target.

This must be done in Xcode on macOS; it cannot be scripted from this Linux
environment.

## What was checked (2026-07-28/29)

- `github.com/googlecast/google-cast-ios-sdk`: still an empty placeholder
  repo (0 stars/forks/watchers, 1 commit, only a `README.md`, no
  `Package.swift`, no releases, no tags).
- `developers.google.com/cast/docs/ios_sender#sdk`: official guidance lists
  only two distribution methods: CocoaPods (recommended, `pod 'google-cast-sdk'`)
  and manual `.xcframework` integration. Swift Package Manager is not
  mentioned anywhere in the official setup docs.

Because there is no real SPM target to point at, `clients/ios/project.yml`
and `clients/ios/Playarr Server.xcodeproj/project.pbxproj` were **not** modified:
adding a fabricated package reference to either file would silently break the
Xcode project for whoever opens it next. Once Google ships an SPM
distribution (or if a vendored XCFramework is added manually in Xcode), this
note should be replaced with the real integration steps and this directory's
neighbours should gain the actual Cast wrapper code.
