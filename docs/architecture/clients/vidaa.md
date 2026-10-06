# Client Architecture: VIDAA (Hisense Smart TVs)

VIDAA runs hosted television applications in its embedded browser. Playarr uses
the same browser-compatible model to run the current Playarr Web
client instead of maintaining a second user interface or shipping a
downloadable TV package.

**Product bar** ([`../client-principles.md`](../client-principles.md)): prefer
a real installed app when VIDAA permits one. Hosted Web in the TV Browser is a
**capability-limited delivery path**, not a licence to ship a thinner product.
Implement every feature the browser stack can support; degrade only for real
gaps (offline downloads, background agents, durable package identity).

## Delivery decision

There is no public, self-service VIDAA App Store submission route comparable to
LG Seller Lounge or Samsung Seller Office. Store and developer deployment
require a VIDAA partner relationship or device-specific developer access.

Playarr remains a hosted Web App at `playarr.app`, not an APK, `.ipk`, `.wgt`,
or USB-installable binary. Opening Playarr in the TV Browser receives the latest
hosted bundle independently of the selected Playarr Server.

**`http://` servers.** The hosted `https://` page cannot call an `http://`
server (mixed content, and a TV browser has no override). Playarr Server
therefore serves the same web client itself at `/tv/` (built with
`pnpm --filter @playarr-tv/web run build:server`, Vite `--mode server`,
`base: "/tv/"`, no service worker; mounted by `playarr_api::build_router_with_tv`
from `PLAYARR_TV_ASSETS_DIR`, default `web/tv/` beside the binary, shipped
inside the image's and tarball's web directory). The page and the API then share
one origin and scheme. The hosted sign-in shows a link to `http://<server>/tv/`
whenever the page is HTTPS and the entered server is `http://`
(`serverHostedEntryUrl`). Verified with the real server binary over plain
`http://` in headless Chromium; not verified on a VIDAA television.

An experimental fixed-purpose gateway under `infra/vidaa-gateway/` can give an
activated household temporary DNS access and serve a launcher portal at the
intercepted `vidaahub.com` hostname. It can install only the hosted Playarr URL;
it does not provide arbitrary URL, file, console, or script controls.

For the managed k3s environment, the standalone
`infra/kubernetes/helm/vidaa-installer/` chart replaces that temporary DNS
process with an app-owned, source-IP-filtered fragment consumed by the
cluster-owned LAN resolver. Its Emissary route proxies the same fixed hosted
portal, and both DNS interception and ingress remain opt-in. The Docker Compose
gateway remains available as the self-hosted reference implementation.

## Implementation

The VIDAA surface is the production client in `clients/tv-web/web/`:

- `?platform=tv-vidaa` selects and persists the `tv-vidaa` client identity;
- modern user agents containing `VIDAA` or `Hisense` are detected as a fallback;
- VIDAA advertises a conservative H.264/H.265/VP9 and AAC/Opus/MP3 playback
  profile during Playarr Server playback negotiation;
- `playarr.webmanifest` plus 192 px and 512 px PNG artwork provide launcher/PWA
  metadata;
- remote Back key codes already handled by Playarr Web include VIDAA's common
  browser Back value; and
- the existing Playarr Web service worker provides the hosted client's update
  path while leaving cross-origin Playarr Server API requests untouched.

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
user's private Playarr Server. That decision must account for mixed-content
rules, local-network access, reviewer access, and territory/device certification.

The Browser route is available only when the television can reach the
Playarr Server host and its embedded browser supports the required media features.
The experimental gateway is firmware-dependent and separate from official
VIDAA distribution. Use a Browser favourite, casting, or an external Android
TV/Google TV device if it is incompatible and no partner deployment is available.

No real VIDAA television or simulator is available in this development
environment. Builds and platform-selection behaviour are testable here;
launcher installation, remote behaviour, and actual codec support must still be
verified on the target television.

## References

- [VIDAA Partner Support and registration](https://www.vidaa.com/partner-support/)
- [VIDAA Partner Portal terms](https://www.vidaa.com/terms-and-conditions/)
- [VIDAA privacy notice](https://www.vidaa.com/privacy-policy-2026/)
- [VIDAA support: find the installed OS version](https://www.vidaa.com/support/)
