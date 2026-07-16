# Client Architecture: VIDAA (Hisense Smart TVs)

VIDAA runs hosted television applications in its embedded browser. Playarr uses
the same browser-compatible model to run the current, co-hosted Playarr Web
client instead of maintaining a second user interface or shipping a
downloadable TV package.

## Delivery decision

There is no public, self-service VIDAA App Store submission route comparable to
LG Seller Lounge or Samsung Seller Office. Store and developer deployment
require a VIDAA partner relationship or device-specific developer access. The
older `hisense://debug` browser scheme is not a supported household installation
route: current firmware may reject it or require credentials.

Playarr remains a hosted Web App, not an APK, `.ipk`, `.wgt`, or USB-installable
binary. The Streamarr server is the deployment origin, so opening Playarr in the
TV Browser receives the latest co-hosted bundle whenever the server is updated.

## Implementation

The VIDAA surface is the production client in `clients/tv-web/web/`:

- `?platform=tv-vidaa` selects and persists the `tv-vidaa` client identity;
- modern user agents containing `VIDAA` or `Hisense` are detected as a fallback;
- VIDAA advertises a conservative H.264/H.265/VP9 and AAC/Opus/MP3 playback
  profile during Streamarr playback negotiation;
- `playarr.webmanifest` plus 192 px and 512 px PNG artwork provide launcher/PWA
  metadata;
- remote Back key codes already handled by Playarr Web include VIDAA's common
  browser Back value; and
- the existing Playarr Web service worker remains best-effort. A LAN HTTP
  installation can still launch and update from the server even when the
  browser does not permit service workers outside a secure context.

The older `clients/tv-web/apps/tv-vidaa-fallback/` package remains an
experimental shared-TV-shell prototype. It is not the recommended household
installation because it does not contain the current Playarr Web experience.

## Installation and support boundary

Follow [Using Playarr on a Hisense VIDAA TV](../../clients/vidaa.md).

Public registration only requests access to VIDAA's invite-only Partner Portal;
it does not create an immediately deployable developer account. The restricted
portal and VIDAA partner contact own the current DevKit, certification, and App
Store release process.

The existing per-household hosted URL is not yet an App Store distribution
artifact. Store publication requires VIDAA to approve either a public HTTPS
bootstrap/configuration origin or a packaged shell that can connect to the
user's private Streamarr server. That decision must account for mixed-content
rules, local-network access, reviewer access, and territory/device certification.

The Browser route is available only when the television can reach the
Streamarr host and its embedded browser supports the required media features.
There is no repository-side package that can bypass VIDAA launcher restrictions.
Use a Browser favourite, casting, or an external Android TV/Google TV device
unless a VIDAA partner deployment is available.

No real VIDAA television or simulator is available in this development
environment. Builds and platform-selection behaviour are testable here;
launcher installation, remote behaviour, and actual codec support must still be
verified on the target television.

## References

- [VIDAA Partner Support and registration](https://www.vidaa.com/partner-support/)
- [VIDAA Partner Portal terms](https://www.vidaa.com/terms-and-conditions/)
- [VIDAA privacy notice](https://www.vidaa.com/privacy-policy-2026/)
- [VIDAA support: find the installed OS version](https://www.vidaa.com/support/)
