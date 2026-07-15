# Client Architecture: webOS (LG Smart TVs)

The webOS client targets LG's webOS Smart TV platform. It is one of three
"TV shell" clients (alongside [Tizen](tizen.md) and the VIDAA fallback in
[`vidaa.md`](vidaa.md)) built on the same underlying web codebase as the
[Web client](web.md), because webOS TVs are, at the runtime level, a
Chromium-based web app host with a native bridge layer bolted on — not a
platform that benefits from a from-scratch native rewrite the way iOS or
Android do.

## Target OS/SDK versions

- **Minimum webOS version:** webOS TV 4.x (2019 model year LG TVs and
  newer). This is chosen as the practical floor for a modern Chromium
  engine and reasonably current HTML5/EME support; older webOS releases
  (3.x and earlier) ship Chromium versions old enough that maintaining
  compatibility would meaningfully constrain the shared TV-shell
  codebase's use of current web platform features for no proportionate
  reach benefit.
- **SDK/tooling:** the [webOS TV SDK](https://webostv.developer.lge.com/)
  and its CLI (`ares-cli`: `ares-package`, `ares-install`, `ares-launch`),
  used for packaging and on-device install/debugging. This CLI is **not**
  installed in this development environment; the source and packaging
  config in `clients/webos/` are written and structurally valid, but
  `ares-package`/`ares-install` have not been invoked to produce or test an
  actual `.ipk` here — see the note in `clients/webos/README.md`.

## Tech stack

| Concern | Choice |
|---|---|
| Base codebase | Shared TV shell (`clients/tv-shell/`, also used by Tizen and the VIDAA PWA fallback) |
| UI | React + TypeScript |
| Playback | HTML5 `<video>` + Media Source Extensions (MSE) |
| DRM | Encrypted Media Extensions (EME) with Widevine, via webOS's EME implementation |
| Platform bridge | `webOSTV.js` / Luna Service API calls for TV-specific system integration (network status, remote-key mapping, deep-link launch args) |
| Packaging | webOS TV SDK (`ares-package` → `.ipk`) |

`clients/webos/` itself is a thin platform wrapper around
`clients/tv-shell/`: an `appinfo.json` (webOS's app manifest — app ID,
title, icon, resolution), an `index.html` entry point loading the shared TV
shell bundle, and a `webos-bridge.ts` adapter implementing the shell's
platform-adapter interface (remote-key event mapping, `webOSTV.js` calls)
against webOS's actual APIs.

## Playback / DRM approach

Video plays through a standard HTML5 `<video>` element driven by MSE for
adaptive HLS/DASH segment loading (identical conceptually to how the Web
client plays back — see [`web.md`](web.md) — since this *is* the same
player abstraction, just running inside webOS's Chromium runtime rather
than a desktop browser). DRM uses EME with the **Widevine** CDM webOS ships
built into its Chromium engine — the same license endpoint
(`/api/drm/widevine/license`) used by Android Mobile/TV, since Widevine
license issuance is DRM-system-specific, not client-platform-specific.
webOS TVs are Widevine-capable at a security level sufficient for
HD/4K-HDR playback on supporting hardware.

## Code-sharing story with sibling platforms

webOS shares essentially all of its application logic with Tizen and the
Web client through `clients/tv-shell/`: the React component tree, the
generated TypeScript API client, the auth/session state machine (including
the RFC 8628 device-pairing flow from
[`../auth-modes.md`](../auth-modes.md), since webOS is exactly the kind of
remote-control-only device that flow exists for), and the player
abstraction are all shared, unmodified, across webOS, Tizen, and Web. What
differs per TV platform is confined to a narrow **platform-adapter**
interface the shell defines and each platform implements separately:

```ts
export interface TvPlatformAdapter {
  mapRemoteKeyEvent(nativeEvent: unknown): RemoteKey | null;
  getDeviceId(): Promise<string>;
  exitApp(): void;
  // ...
}
```

webOS's implementation of this interface lives in `clients/webos/src/webos-bridge.ts`;
Tizen's equivalent lives in `clients/tizen/src/tizen-bridge.ts`. This is the
practical expression of the code-sharing principle in
[`../overview.md`](../overview.md#the-7-client-strategy): one shell, thin
per-platform adapters, rather than three independently maintained TV
codebases.

## Store submission process and constraints

- Distributed via the **LG Content Store**, submitted through LG's
  developer portal (`webostv.developer.lge.com`), which requires an LG
  developer account and app registration before submission.
- Packaging is an `.ipk` produced by `ares-package` against the app's
  `appinfo.json` and built web bundle; submission goes through LG's review
  process (functional review against LG's TV app guidelines, remote-control
  navigability checks, and a certification pass), with review turnaround
  outside Streamarr's control, similar in spirit to (though generally
  faster than) mobile app store review.
- **No OTA update path exists on this platform.** Every release, including
  patch releases, requires a full new `.ipk` submission and LG's review
  cycle — there is no in-app patching mechanism LG permits, matching
  webOS's row in the per-platform update table in
  [`../../versioning-policy.md`](../../versioning-policy.md). This makes
  the shared TV shell's *deprecation-header* handling important in
  practice: because a webOS client cannot patch itself between store
  releases, the server's `apiVersion` floor and deprecation window (see
  [`../../versioning-policy.md`](../../versioning-policy.md)) have to give
  webOS users realistic time to receive and install a store update before
  the server ever drops support for the `apiVersion` a stale webOS build is
  still using.
