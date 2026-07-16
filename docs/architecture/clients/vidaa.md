# Client Architecture: VIDAA (Hisense Smart TVs)

VIDAA runs hosted television applications: the TV launcher stores an HTTP or
HTTPS URL and opens that application in VIDAA's embedded browser. Playarr uses
that supported Web App model to run the current, co-hosted Playarr Web client
instead of maintaining a second user interface or shipping a downloadable TV
package.

## Delivery decision

There is no public, self-service VIDAA App Store submission route comparable to
LG Seller Lounge or Samsung Seller Office. Store distribution still requires a
VIDAA partner relationship. A private household installation does not need a
store package, however: VIDAA's official Web App Development Technical Guide
documents a debug installer that accepts an app name, URL, icon URLs, and
resolution, then adds the hosted app to the TV launcher.

The resulting Playarr entry is a VIDAA Web App, not an APK, `.ipk`, `.wgt`, or
USB-installable binary. The Streamarr server remains the deployment origin, so
the TV receives the latest co-hosted Playarr bundle whenever the server is
updated.

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

Follow [Installing Playarr on a Hisense VIDAA TV](../../clients/vidaa.md).

The debug installer is firmware-dependent. The official guide documents it for
VIDAA U-era hardware, but newer or region-specific firmware may hide it, require
partner credentials, or remove the Browser application. If
`hisense://debug` does not open an app-install form, there is no repository-side
package that can bypass that restriction. Use the ordinary Browser app, casting,
or an external Android TV/Google TV device instead.

No real VIDAA television or simulator is available in this development
environment. Builds and platform-selection behaviour are testable here;
launcher installation, remote behaviour, and actual codec support must still be
verified on the target television.

## References

- [VIDAA Web App Development Technical Guide](https://www.vidaa.com/wp-content/uploads/2020/12/WebApp_Development_Guide_for_VIDAA.pdf)
- [VIDAA support: find the installed OS version](https://www.vidaa.com/support/)
