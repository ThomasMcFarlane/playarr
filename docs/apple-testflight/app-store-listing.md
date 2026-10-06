# App Store listing, privacy answers and review access (iOS and tvOS)

Source of truth for the public App Store submission (TASKS rows 285, 288-290). It contains no
credentials, server addresses or third-party media. Both platforms share one App Store Connect
record (bundle ID `app.playarr.ios`, SKU `playarr-ios`).

## Listing metadata (en-GB)

- Name: Playarr
- Subtitle (30 characters): Your own media, anywhere
- Category: Entertainment (primary); Photo & Video is not used.
- Promotional text: Watch, resume and pick up where you left off from your own Playarr Server.
- Description: Playarr is a native client for a Playarr Server that you or your household run.
  Sign in to your own server, choose a household profile, browse your library, resume playback
  across devices, and cast to compatible receivers. Playarr does not provide, sell or host any
  media: you connect it to a server you operate. A server is required.
- Keywords (100 characters): self-hosted,media,server,library,household,resume,player,watch,stream
- Support URL and marketing URL: the project website (`https://playarr.app`).
- Privacy policy URL: `https://playarr.app/legal/privacy` (covers Android, iPhone, iPad, Apple TV
  and web as of the 5 October 2026 revision).
- Copyright: 2026 Thomas McFarlane
- Version 1.0.0 "What's new": First release.

## App privacy (nutrition label)

Consistent with the privacy policy and `clients/ios/Resources/PrivacyInfo.xcprivacy`
(`NSPrivacyCollectedDataTypes` empty, `NSPrivacyTracking` false, one required-reason API:
UserDefaults, reason CA92.1).

- Data collected by the developer: none. Data is sent only to the Playarr Server that the user
  configures, which the user or their administrator operates; it is not collected by the developer.
- Tracking: no. No advertising, analytics or third-party SDK collecting data; Google Cast SDK is used
  only for local-network receiver discovery and control.
- Answer in App Store Connect: "Data Not Collected".

## Age rating

Answer every content question "None" (the app itself contains no content; it plays media from a
server the user controls). No unrestricted web access (no embedded browser), no user-generated
content shared between users by the developer, no gambling, no in-app purchases. Expected rating: 4+.
Because user-supplied servers can serve any media, do not describe the app as a content provider.

## Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in both targets: the apps use only HTTPS/TLS provided by
the operating system, which is exempt. No further export-compliance answer is needed.

## Review access (App Review notes)

Playarr requires a Playarr Server and has no account system of its own. Provide App Review with a
reachable demo server whose single catalogue item is the Creative Commons Attribution 3.0 short
film credited in the root `README.md` ("Third-party media"), using the same sterile review-server
pattern as the Google Play review (`clients/tv-web/apps/play-review-server`). The server address
and reviewer credentials are entered in the App Store Connect "Sign-In Information" fields by the
owner and are never stored in this repository.

Review notes text:

> Playarr is a client for a self-hosted Playarr Server; it contains and sells no media. To review
> it, enter the demo server address from the Sign-In Information fields, sign in with the supplied
> demo credentials, choose the profile, open the single catalogue item and press Play. The demo
> catalogue holds one openly licensed (CC BY 3.0) short film. The app uses Local Network access to
> reach servers on a home network and to discover Google Cast devices; casting needs a receiver
> and is not required for review. There are no in-app purchases, advertising or accounts created in
> the app. Apple TV: the same flow with the Siri Remote.

## Screenshots

Required sizes: iPhone 6.9-inch (1320 x 2868) and iPad 13-inch (2064 x 2752) for iOS; tvOS 1920 x
1080. Generate them only from the sterile demo library above (or neutral placeholder artwork), never
from a real library, never with real film or series artwork or titles.

## Deep link (row 288)

`InstalledAppVersion.appStoreID` must be the numeric Apple ID shown under App Store Connect, App
Information, General Information, Apple ID. Replace the placeholder with that value once read from
the record; do not guess it.
