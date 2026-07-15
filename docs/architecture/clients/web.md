# Client Architecture: Web

The Web client is a browser-based, installable Playarr Progressive Web App
(PWA) — and, architecturally, it is the **foundation client**: it is the
same codebase that becomes the "TV shell" reused (via thin platform
adapters) by [webOS](webos.md), [Tizen](tizen.md), and the optional VIDAA
PWA fallback described in [`vidaa.md`](vidaa.md). Understanding this
document is close to a prerequisite for understanding those three.

## Target OS/SDK versions

- **Target runtimes:** evergreen desktop and mobile browsers — the last
  two major versions of Chrome, Edge, Firefox, and Safari. No support
  target for Internet Explorer or any browser without Media Source
  Extensions (MSE) and Encrypted Media Extensions (EME) support, since both
  are required for adaptive playback and DRM respectively.
- **Node.js:** current LTS, used for the build toolchain only (Vite),
  not a runtime dependency of the shipped app.

## Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| UI framework | React |
| Build tool | Vite |
| State/data | React Query for server state, a small Zustand store for local UI/session state |
| Networking | `fetch` + a generated TypeScript client from `crates/streamarr-api/openapi.yaml` |
| Playback | HTML5 `<video>` + Media Source Extensions (MSE) |
| DRM | Encrypted Media Extensions (EME), backed by Widevine (Chrome/Firefox/Edge) or FairPlay (Safari) |
| Offline shell / updates | Service worker (Workbox-generated), versioned against a CDN-hosted manifest |

The codebase lives at `clients/tv-shell/` (the name reflects its role as
the shared base for every web-runtime client, TV or otherwise) with a
`clients/web/` wrapper providing the browser-specific entry point,
`manifest.json` (PWA installability metadata — name, icons, `display:
standalone`), and its own `TvPlatformAdapter`-equivalent implementation for
plain browsers (pointer/keyboard input handling rather than remote-key
mapping, since desktop/mobile-web has no D-pad to map).

## Playback / DRM approach

Playback is a standard `<video>` element driven by MSE, loading either a
direct-play manifest or the HLS/DASH output of an on-demand transcode
session (see
[`../overview.md`](../overview.md#the-tdarr-background-vs-on-demand-transcode-split)).
DRM is handled through EME with a **per-browser CDM**, since no single DRM
system covers every target browser:

- **Widevine** on Chrome, Edge, and Firefox, via the same
  `/api/drm/widevine/license` endpoint used by Android and the other
  Chromium-based TV shells.
- **FairPlay Streaming** on Safari, via
  `/api/drm/fairplay/license` — the same SPC/CKC exchange described in
  [`ios.md`](ios.md#playback--drm-approach), since Safari's
  `WebKitMediaKeys`/EME implementation for FairPlay follows the same
  handshake as native `AVContentKeySession`, just invoked through the web
  platform's EME API instead of AVFoundation directly.

A thin `PlayerAdapter` interface in the shell abstracts this per-browser
CDM selection so the rest of the app (playback controls, resume-position
reporting, quality selection UI) is written once against a single player
interface, with the CDM-selection branch isolated to one module
(`clients/tv-shell/src/player/eme-cdm-select.ts`).

## Code-sharing story with sibling platforms

The Web client *is* the shared base, not a consumer of one. Its
`clients/tv-shell/` package supplies:

- The full React component tree and routing (library browse, search, item
  detail, playback screen, settings, the RFC 8628 device-pairing UI from
  [`../auth-modes.md`](../auth-modes.md)).
- The generated TypeScript API client and the auth/session state machine
  (JWT/refresh handling per [`../auth-modes.md`](../auth-modes.md)).
- The `PlayerAdapter` player abstraction described above.
- The `TvPlatformAdapter` interface that webOS and Tizen each implement
  with their own remote-key mapping and native bridge calls, per
  [`webos.md`](webos.md#code-sharing-story-with-sibling-platforms).

webOS, Tizen, and (where relied on) the VIDAA PWA fallback each build a
thin platform-specific wrapper on top of this shared package rather than
maintaining their own copy of any of the above — a change to, say, the
playback screen's UI lands once in `clients/tv-shell/` and ships to Web,
webOS, and Tizen together (each on its own release cadence and store review
timeline, per platform).

## Store submission process and constraints

There is no traditional app-store submission for the Web client's primary
distribution — it is served directly from Streamarr's own CDN-hosted static
build, installable as a PWA (add-to-home-screen / install-app prompt)
straight from the browser via `manifest.json` and the registered service
worker, with no review gate of any kind. This is the one client in the
7-client strategy that ships to users the moment a new build is deployed.

Optionally, the same PWA build can additionally be listed in the
**Microsoft Store** as a packaged PWA (Windows supports listing PWAs
directly, wrapping the existing web manifest with minimal extra
packaging metadata) for discoverability on Windows — this is a
distribution *option*, not a requirement, and carries a lightweight
Microsoft Store review pass if pursued; it does not change how the
underlying app is built or updated.

## Self-update / OTA mechanism

Because the Web client has no store gate, it is the one client for which a
genuine **over-the-air update** mechanism makes sense, and it is the
reference implementation of the OTA row in
[`../../versioning-policy.md`](../../versioning-policy.md)'s per-platform
update table:

1. Every deployed build publishes a versioned entry to a CDN-hosted
   manifest (`manifest.json` at a well-known path, distinct from the PWA
   installability manifest of the same conventional name — internally
   referred to as the *build* manifest) recording the current bundle
   hash/version and `apiVersion`.
2. The service worker, on each app launch/focus, checks the build manifest
   against the version it last installed. A new version triggers a
   background fetch of the new bundle (standard Workbox
   precache-and-route-versioning behaviour) without interrupting an
   in-progress session.
3. Once fetched, the client is prompted to reload (soft nudge) to activate
   the new service worker and bundle; if the new build is required because
   the current one has fallen below the server's `apiVersion` floor, the
   prompt escalates to a blocking reload requirement, mirroring the
   Immediate-vs-Flexible distinction Android's In-App Updates API makes
   natively.

This same mechanism is what the VIDAA PWA sideload fallback in
[`vidaa.md`](vidaa.md) relies on when (and only when) that fallback path is
actually used — which is precisely why that path carries its own
ToS-re-verification obligation: an OTA mechanism that quietly keeps
updating a sideloaded app is exactly the kind of ongoing reliance that
needs Hisense's terms checked release over release, not just once.
