# Client Architecture: Chromecast

Playarr Chromecast support is a sender/receiver pair, not a packaged
distribution of an existing client. A Google Cast **sender** (Web, Android, or
iOS) discovers and connects to a Chromecast device, which launches Playarr's
own **custom web receiver**, a small standalone app hosted at
`playarr.app/cast/`, inside the Cast device itself. Sender and receiver talk
to each other over a Cast custom message channel; the receiver talks to the
Playarr Server directly for playback negotiation, progress reporting, and
media.

```text
Sender (Web / Android / iOS)              Chromecast device                Playarr Server
┌─────────────────────────┐   Cast SDK    ┌───────────────────────┐   HTTPS   ┌───────────────┐
│ requestSession()         │──────────────▶│ Playarr custom        │──────────▶│ /api/v1/...   │
│ loadMedia(customData)    │  session +    │ web receiver           │  Bearer   │               │
│ custom-channel messages  │  custom msgs  │ (cast-receiver app)    │  token    │               │
└─────────────────────────┘◀──────────────└───────────────────────┘◀──────────└───────────────┘
```

The receiver is the thing that actually plays media and holds a Playarr Server
session; the sender only launches it, hands it a load request, and relays
UI-level control messages afterwards. This split is what makes casting
survive the sender's own app (or browser tab) closing.

## Why the receiver never gets the sender's own token: delegated device auth

The obvious design (hand the receiver the signed-in sender's own access and
refresh token over the custom channel) was deliberately rejected. Playarr Server's
refresh-token rotation includes reuse detection: if a rotated-and-then-reused
refresh token is ever presented, the server treats it as theft and revokes the
whole session lineage. A sender and a receiver both rotating from the same
refresh token would eventually race and one side's legitimate rotation would
look identical to theft, tearing down the sender's own signed-in session.

Instead, the sender mints the receiver a **separate device identity** using
the existing RFC 8628 device-authorization-grant flow already used for TV
pairing: the same flow, just self-approved instead of polled by a second
device:

1. `POST /api/v1/oauth/device/code` with `{ client_platform: "cast" }`
   (unauthenticated): mints a user code for a brand-new `cast` device.
2. `POST /api/v1/oauth/device/authorize`, authenticated with the **sender's
   own** bearer token, approving the code it just minted for itself. No
   second device or human interaction is needed: the signed-in sender
   approves its own Cast device inline.
3. `POST /api/v1/oauth/token` (device-code grant) redeems that approval for a
   `cast`-platform access/refresh token pair.

Only `{ castDeviceId, castRefreshToken }` are cached client-side (the access
token itself is short-lived and never persisted); every subsequent cast
either reuses the cached refresh token via a plain `POST /api/v1/auth/refresh`
or re-runs the three-call mint above if that refresh has expired. The receiver
therefore always operates as its own independently-provisioned `cast` client,
with its own rotation lineage, and cannot revoke the sender's session or vice
versa.

`cast` is a first-class `ClientPlatform` variant end to end: the backend
enum (`playarr-model::platform::ClientPlatform`), `client-compatibility.toml`
(a `[cast]` entry mirroring `[tv-vidaa]`'s shape), and every hand-written
client-side mirror (Kotlin, Swift, TypeScript-generated schema).

Reference implementations of the flow:
- Web sender: `clients/tv-web/web/src/lib/cast/delegatedDeviceAuth.ts`
- Android sender: `clients/android/app/src/main/kotlin/io/playarr/mobile/cast/PlayarrDelegatedDeviceAuth.kt`
- iOS sender: `clients/ios/Sources/PlayarrApp/Cast/CastSessionCoordinator.swift`
- Receiver-side credential handling: `clients/tv-web/apps/cast-receiver/src/auth.ts`

## The CORS/auth fix this build required

Once the receiver exists, it is a page served from `playarr.app` calling a
self-hosted Playarr Server on a different origin: a genuinely
cross-origin, Bearer-authenticated request. Playarr Server's CORS policy was
already deliberately wide open (`CorsLayer::permissive()`: any origin, no
credentials, because the API is Bearer-token authenticated and has no
cookie/session CSRF surface an origin allow-list would protect). That
permissiveness turned out to hide a real bug:

> **`CorsLayer::permissive()`'s `Access-Control-Allow-Headers` response is the
> literal wildcard `*`. Per the Fetch spec, that wildcard does not cover
> `Authorization`.** Chromium enforces this. A cross-origin caller sending
> `Authorization: Bearer <token>` will fail CORS preflight against a
> `permissive()`-only CORS layer, even though every other header and method is
> allowed.

This is easy to never notice locally because same-origin requests (the
hosted Web app calling its own Cloudflare Worker, or a native app with no
browser CORS enforcement at all) never hit this path. It only surfaces for a
genuinely cross-origin browser context sending `Authorization`, exactly what
the Cast receiver is.

The fix, in `backend/crates/playarr-api/src/lib.rs`:

```rust
CorsLayer::permissive().allow_headers(AllowHeaders::mirror_request())
```

`AllowHeaders::mirror_request()` echoes back whatever the browser's own
preflight `Access-Control-Request-Headers` asked for, including
`authorization`, instead of wildcarding. Origin stays `*` (no credentials
mode is used, so this remains safe); only the header-allow behavior changed.
Covered by `cors_preflight_mirrors_requested_headers_for_a_playback_route` in
the same file.

**If this regresses**, the symptom is a Cast receiver (or any other
cross-origin, Bearer-authenticated browser caller) that fails every API call
with an opaque CORS error in devtools, while same-origin clients keep working
fine. Do not re-simplify this back to bare `CorsLayer::permissive()`.

## `playback_session_id`: HLS capability-query fallback

HLS playback for authenticated media (rendition/segment files, subtitles) is
normally authorized by the streaming cookie the Web app already holds. A Cast
receiver's manifest/segment requests are issued by the Cast device's own
internal media pipeline, not by page JavaScript, so it cannot attach that
cookie or an `Authorization` header to every internal fetch. Instead, the
receiver appends the negotiated `PlaybackSession`'s id as a query parameter,
`?playback_session_id=<uuid>`, to the manifest URL it hands to the CAF SDK,
and the SDK carries that query string through to every subsequent
rendition/segment request it makes internally.

Server-side, `HlsCapabilityQuery { playback_session_id: Option<Uuid> }` is
accepted alongside the existing streaming-cookie check on every HLS handler
(`serve_rendition_file_handler`, `serve_session_file_handler`, and the
subtitle handler): the cookie is tried first, and `playback_session_id` is
the fallback when no cookie is present. This is a capability-style grant, not
a fresh authentication: the id must already resolve to a live
`PlaybackSession` the caller's own negotiation created; see
`backend/crates/playarr-api/src/media.rs`.

## Protocol namespace and message shapes

The full wire protocol (namespace/version constants, the load-request shape,
and the discriminated-union sender/receiver message types) is defined once
and shared, not duplicated per platform:

- **Canonical definition (TypeScript):**
  [`clients/tv-web/packages/cast-protocol/src/index.ts`](https://github.com/ThomasMcFarlane/playarr/blob/main/clients/tv-web/packages/cast-protocol/src/index.ts),
  used directly by the Web sender and the receiver.
- **Kotlin mirror:**
  `clients/android/app/src/main/kotlin/io/playarr/mobile/cast/PlayarrCastProtocol.kt`
- **Swift mirror:**
  `clients/ios/Sources/PlayarrApp/Cast/PlayarrCastProtocol.swift`

All three define the same namespace (`urn:x-cast:app.playarr.cast.v1`),
protocol version constant, a `PlayarrCastLoadRequest` carried as `loadMedia`'s
`customData`, and a flat `"type"`-discriminated `PlayarrCastSenderMessage` /
`PlayarrCastReceiverMessage` union for everything exchanged afterwards
(auth rotation, track/quality selection, queue, state, ack/error). Read the
TypeScript source for the authoritative shape rather than relying on this
document to stay in sync with it.

## App ID configuration per sender

Every sender needs the Cast **receiver application ID** issued by the Google
Cast Developer Console once a real receiver is registered. Each sender reads
it from its own config knob; all three currently default to the same inert
placeholder, `0000PLAYARR` (Web) / empty string (Android/iOS gate on
non-empty):

| Sender  | Knob | Where |
|---|---|---|
| Web | `VITE_CAST_RECEIVER_APP_ID` (build-time env var) | `clients/tv-web/web/src/lib/cast/castSdk.ts`, exported as `CAST_RECEIVER_APP_ID`, falls back to `"0000PLAYARR"` |
| Android | `castReceiverAppId` Gradle property | `clients/android/app/build.gradle.kts`, surfaced to the app as the `CAST_RECEIVER_APP_ID` `BuildConfig` field, read by `PlayarrCastOptionsProvider` |
| iOS | `PlayarrCastReceiverAppID` Info.plist key | `clients/ios/Resources/Info.plist`, read in `AppDelegate.swift`; left empty on purpose, and `GCKCastContext` is only initialised when it is non-empty |

None of these three currently holds a real registered App ID; see Known
limitations below.

## Known limitations

- **No Google Cast Developer Console registration exists yet.** Every App ID
  above is an inert placeholder. Nothing in this build has ever launched a
  real Cast device against Playarr's own receiver, because no such
  registration/App ID exists to launch.
- **iOS sender is unverified.** This environment has no macOS/Xcode
  toolchain, so `clients/ios/Sources/PlayarrApp/Cast/` has never been
  compiled, let alone run. It was written carefully against documented Cast
  iOS SDK shapes, but several call sites (`GCKMediaLoadRequestDataBuilder`,
  error-code bridging, `GCKDevice`/`GCKCastSession` API surface) are flagged
  in-code as needing confirmation against real vendored SDK headers.
- **Plain `http://` self-hosted servers cannot be cast to from the
  `https://playarr.app` receiver.** The receiver page is always served over
  HTTPS; a browser/Cast device refuses mixed-content requests from an HTTPS
  page to an HTTP origin. Casting only works today against an HTTPS Playarr Server
  server.
- **No DRM.** Same as every other Playarr client: the playback-negotiation
  API returns no DRM configuration or license endpoint today, so this only
  ever plays unencrypted direct/HLS sources.
- **No Cast Connect / Android TV receiver.** Casting always launches the web
  receiver on the Cast device; there is no Android TV app-to-app Cast Connect
  integration.
- **No ad breaks.**
- **No queueing beyond a simple up-next.** The protocol has a queue message
  shape and a `queue.playNext` handler, but no multi-item queue UI or
  reordering exists on any sender.
- **Casting a local, on-device download is unsupported.** Only server-backed
  media (direct play or on-demand HLS) can be cast; downloaded files never
  leave the device that downloaded them.

## Related docs

- [`clients/tv-web/apps/cast-receiver/README.md`](https://github.com/ThomasMcFarlane/playarr/blob/main/clients/tv-web/apps/cast-receiver/README.md)
  for building and locally testing the receiver with the Cast Command & Control
  tool, before any sender is involved.
