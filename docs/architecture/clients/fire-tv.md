# Client Architecture: Amazon Fire TV (Vega OS)

Playarr for Fire TV, in `clients/fire-tv/`, is a native
[React Native](https://reactnative.dev/) app for Amazon's
[Vega OS](https://developer.amazon.com/docs/vega/): the runtime shipping on
current-generation Fire TV Stick hardware. It is a genuinely separate
implementation from every other Playarr client: it does not host
`clients/tv-web/web` the way VIDAA, webOS and Tizen do (Vega has no browser
surface at all), and it does not extend `clients/android` (Vega is not
Android). Every screen (linking, profiles, home, library, detail, search,
playlists, six settings screens) is a real `.tsx` component, built and
tested without Amazon's SDK, against a platform adapter layer that isolates
everything genuinely unverified about Vega behind one directory. See
[`clients/fire-tv/README.md`](../../../clients/fire-tv/) for build
commands and current implementation status (in short: `App.tsx` mounts the
real app shell and a shell-level `PlayerScreen`, and the playback engine
under `src/platform/media/` exists with a passing unit-test suite, but none
of it has been verified against real or virtual Vega hardware yet).

## Why Vega OS is a separate platform, not "Android TV with a different SDK"

Fire TV hardware has historically run Fire OS, an Android fork, which is why
it's tempting to assume it belongs next to `clients/android-tv` in spirit.
Current-generation Fire TV Stick hardware runs Vega instead, and the two are
not the same platform wearing different branding:

- **Vega is Linux-based**, not an Android Open Source Project fork. There is
  no Android Runtime, no APK, no Play-style install path, and none of
  `clients/android`'s Kotlin/Jetpack Compose/Media3 code is reachable or
  relevant here.
- **Vega's UI layer is React Native 0.72 / React 18.2, New Architecture only
  (Fabric renderer), Hermes-only.** There is no DOM and no CSS: this app is
  TSX and `StyleSheet` objects throughout, closer in shape to
  `clients/tv-web`'s React components than to `clients/android`'s Compose
  screens, but running against native Vega modules instead of a browser.
- **Focus is a platform-owned Cartesian engine, not app-scored.** Apps declare
  `TVFocusGuideView`/`nextFocusUp`-style hints; they cannot override default
  D-pad directional resolution the way tv-web's 741-line `useTvNavigation.ts`
  geometric focus engine does for the browser. `src/platform/focus.tsx` wraps
  the small number of Vega focus primitives (`TVFocusGuideView`,
  `FocusManager`) this app actually needs; what gets ported from tv-web is the
  *policy* (focus-scale motion, the `activeRailFactor` stale-focus-border
  fix), not a directional-scoring algorithm, because the platform already
  does that part.
- **Packaging, distribution and toolchain are entirely separate.** Vega apps
  ship as a `.vpkg` built by a `vega`/`react-native build-vega` CLI against a
  `manifest.toml`, not an APK signed and distributed through Play/Amazon
  Appstore's Android path.

Concretely, this means Fire TV is not "one more `ClientPlatform` value that
happens to reuse Android code": it is its own React Native project
(`clients/fire-tv/`), its own adapter layer, its own screens, and its own
build/packaging pipeline, sharing only the same backend contract and the same
non-visual TypeScript logic (`@streamarr-tv/*`) that every `clients/tv-web`-family
client already shares.

## `client_platform` identity

Playarr for Fire TV identifies itself on the wire as `tv-fire`, via the single
file `src/config/appConfig.ts`. This is a real, first-class
`ClientPlatform::TvFire` variant (`wire_name() == "tv-fire"`) in
`backend/crates/streamarr-model/src/platform.rs`, with its own
`[tv-fire]` section in `backend/config/client-compatibility.toml` and its own
entry in the hosted broker's `LINK_CLIENT_PLATFORMS` allow-list
(`clients/tv-web/web/worker.js`) and in `hostedDeviceLink.ts`'s accepted
platform union, not a compatibility stand-in borrowed from another platform.

That is worth calling out because it is a genuine change of plan mid-project,
not the original design: this client was designed against a branch where none
of those enum/table/allow-list entries existed yet, and the design's own
worked-through fallback was to send `android-tv`, reasoning that it's what
the worker's allow-list would silently clamp an unknown value to anyway, and
that Fire TV genuinely is Android-TV-class hardware from a policy standpoint.
That fallback reasoning is now moot: by the time `clients/fire-tv/` was
actually built, `tv-fire` had already landed as a real variant across the
backend, the compatibility table, the worker allow-list and the hosted-link
type union (tracked as its own build-order step, landing ahead of this
client rather than after it). Sending the honest value is strictly better
than a compromise for a problem that no longer exists, so that's what
`appConfig.ts` does; its own doc comment documents both the current state
and exactly what to revert if a future rebase ever drops those changes.

## Device-linking flow

Fire TV never has a build-time-baked server address and never presents a
keyboard-first login form: a TV remote makes typing a server URL and
password miserable, and Vega's on-screen keyboard needs its own manifest
service (`com.amazon.inputmethod.service`) that a login form would need to
request just to type a hostname. Instead it uses the same hosted, first-contact
linking flow every recent Playarr TV client uses, against `playarr.app`'s
worker:

1. **Request a code.** `src/auth/hostedLink.ts`'s `requestFireTvHostedLinkCode`
   calls `POST https://playarr.app/api/link/code` with
   `{client_platform: "tv-fire"}` and gets back a `device_code`, a short
   `user_code`, a `verification_uri_complete`, and an `interval`/`expires_in`
   pair.
2. **Show it.** `LinkScreen.tsx` renders the Playarr QR code of
   `verification_uri_complete` (rendered fully offline: `qrcode` emits an SVG
   string, `components/QrCode.tsx` parses its `<path>` data and redraws it
   with `react-native-svg`; there is no round-trip to a third-party QR
   service, and deliberately not Roku's `/api/link/qr` route, which is a dead
   endpoint the worker never implements) alongside the plain-text URL and the
   `user_code` itself.
3. **Poll.** `pollHostedDeviceLink` sleeps `interval` seconds before each poll
   of `GET /api/link/code/{device_code}`, treating `202` as "keep waiting" and
   `404` as "code expired", the same contract as every other Playarr client's
   hosted linking, ported field-for-field from
   `clients/tv-web/web/src/lib/hostedDeviceLink.ts` rather than re-derived.
   Meanwhile, a phone or browser at that URL signs in, picks a household
   profile and its Streamarr server, and approves this TV against it.
4. **Redeem.** The claim the poll eventually returns names a real
   `server_url`/`server_urls` and a `server_device_code` that has *already*
   been approved server-side: `src/auth/session.ts`'s
   `completeServerDeviceLink` redeems it directly against the real Streamarr
   instance via the standard RFC 8628 device-code grant. Fire TV never
   implements the approver side of this exchange (`/api/link/session`,
   `/api/link/authorize`); no TV client does.
5. **Commit.** `commitLinkedSession` relay-rewrites every claimed server
   address (`publicIpv4RelayUrl`, ported from `loginServerUrl.ts`: a bare
   public IPv4 literal becomes `https://v4-a-b-c-d.relay.playarr.app:8484`
   rather than forcing plaintext HTTP to a public address or a self-signed
   TLS warning; private/LAN/loopback addresses pass through unchanged),
   points the API client at the primary one, writes the session to
   `TokenStore`, and remembers the *full* address list as a
   `KnownServerGroup`, never a single URL, per the peer-group rules in
   `docs/architecture/peer-groups.md`. Ordering here is load-bearing and
   documented at length in `session.ts`: `setApiBaseUrl` must run before the
   `TokenStore` write, because pointing the API client at a new server clears
   the current session as a side effect: reversing the order would silently
   erase the session that was just linked.

Refreshing an access token afterwards reuses `@streamarr-tv/device-auth`'s
`ensureAccessToken` verbatim (`ensureFireTvAccessToken` just supplies this
app's identity and known-server group), including its node-scoped refresh
retry: a refresh token is only ever retried against addresses sharing the
issuing peer's `peerNodeId`, since refresh tokens are never synced
peer-to-peer, while a fresh login retries across the whole known list. A hard
refresh failure clears the session (keeping `deviceId` and the known-server
group) and returns to `LinkScreen`, the same recovery Roku's
`ClearSession(true)` → `beginPairing()` performs.

## Playback strategy

Streamarr's artwork, HLS manifests and segments all require an
`Authorization: Bearer` header. The moment a media URL crosses into Vega's
native GStreamer pipeline, JavaScript loses the ability to attach headers to
it, so the whole playback design turns on *where* the credential enters the
request, and what happens if the assumed answer is wrong.

**Primary plan: HLS via Shaka, header injection.** `lib/playbackCapabilities.ts`
(built and unit-tested; see the status note below for what that coverage does
and does not prove) advertises a capability set that steers the server's
`GET /api/v1/playback/{id}` response toward `mode: "hls"`. Amazon's Vega fork
of Shaka Player loads that manifest through MSE entirely inside Hermes-run
JavaScript, and `platform/media/shakaAdapter.ts` is the *one* place a
credential ever touches a media request: a `registerRequestFilter` callback
attaching `Authorization: Bearer <token>` to `MANIFEST`/`SEGMENT`/`LICENSE`
requests. Every other module asks an `authTransport.ts` abstraction for a
source descriptor and never sees the token itself.

**Fallback plan: the `streamarr_playback_session` cookie.** If Shaka's
request filter turns out not to reach manifest/segment requests on Vega (the
mechanism is documented for `LICENSE` requests specifically; whether it
extends to `MANIFEST`/`SEGMENT` is unverified), the backend already supports
an alternative with no server change required: HLS session/rendition
endpoints accept a `streamarr_playback_session=<session_id>` cookie instead of
a bearer header. This exists precisely for native players that cannot set
headers: Samsung's AVPlay integration (`docs/architecture/clients/tizen.md`)
already relies on it, and it is scoped to one live session and one media
file, not a standing credential.

**Contingency: a small backend change, out of v1 scope.** Progressive
direct-play (`/api/v1/media/{id}/stream`) supports neither the header nor the
cookie today. If the Stick's decoder performance ever makes direct MP4 play
necessary, the minimal server change is accepting the same
`streamarr_playback_session` cookie on that handler too. Nothing in this
client's design depends on that change landing; it's tracked, not assumed.

**Current status: built and unit-tested, unverified on real hardware.**
`PlayerScreen.tsx`, `lib/playbackCapabilities.ts`, `lib/playerSession.ts`, and
every module under `src/platform/media/` (`VegaPlaybackEngine.ts`,
`VegaVideoSurface.tsx`, `shakaAdapter.ts`, `authTransport.ts`,
`subtitles.ts`) exist in the tree, each with its own passing test file. That
proves the request-filter wiring, session-state machine and capability
negotiation logic are internally consistent against a mocked Shaka/GStreamer
surface; it does not prove any of it against Amazon's actual Vega fork of
Shaka Player, which still needs the same containerised SDK install described
below, plus obtaining Amazon's Shaka-for-Vega tarball (distributed outside
npm, as a downloaded archive plus a `setup.sh`; whether it is obtainable
without a registered Amazon developer account is itself unverified). Whether
the request filter reaches `MANIFEST`/`SEGMENT` requests the same way it is
documented to reach `LICENSE` requests, and whether HLS plays at all on real
Stick hardware, are both still open questions the first real device session
needs to answer. Everything upstream of playback, linking, profiles,
browsing, search, is real, independently testable, and does not depend on any
of this.

DRM is out of scope for v1 by design, not by omission: Streamarr serves a
household's own media library, so there is nothing to protect with
`com.amazon.drm.key`/`com.amazon.drm.crypto` privileges, an
`HW_SECURE_ALL`/`SW_SECURE_CRYPTO` robustness split, or a `setDrm(...)` call:
`manifest.toml` deliberately omits every DRM-related `wants` entry rather than
requesting privileges the app has no use for yet.

## Storage and the `localStorage` shim

Vega's only persistence primitive is `AsyncStorage`
(`@amazon-devices/react-native-async-storage__async-storage`), and it is
explicitly unencrypted: there is no keychain or secure-store on Vega at all.
The shared `@streamarr-tv/device-auth`/`@streamarr-tv/domain` packages
(`TokenStore`, `getStoredApiBaseUrl`, `getOrCreateDeviceId`, …) all guard on
`typeof localStorage === "undefined"`, which is *always* true under Hermes:
run unmodified, every one of them would silently fall into an in-memory
fallback and the session would be lost on every app restart.
`src/platform/storage/localStorageShim.ts` closes that gap: it hydrates every
persisted Playarr key into a `Map` from `AsyncStorage` before first render
(`bootstrap/hydrate.ts` awaits this), then exposes a synchronous
`Storage`-shaped facade on `globalThis`, writing through to `AsyncStorage` on
a write-behind basis. That lets the shared packages run **verbatim** on Vega
rather than being refactored to accept an injected store, a much larger diff
into a package three other clients also depend on. The plaintext-refresh-token
consequence of Vega having no secure-store is stated as a platform ceiling,
not hidden: `@amazon-devices/keplercrypto` may offer envelope encryption in
future, but that is unverified and not relied on today.

## Workspace placement

Fire TV consumes `clients/tv-web/packages/*`'s shared logic (API client,
device-auth, domain types, design tokens) as TypeScript source via Metro
`watchFolders`/`extraNodeModules` aliases (mirrored in `tsconfig.json`'s
`paths`), rather than joining the `clients/tv-web` pnpm workspace as a
`workspace:*` member. `clients/tv-web/pnpm-workspace.yaml`'s globs cannot
reach a sibling directory regardless; beyond that, Vega pins React 18.2.0 and
TypeScript ~4.9.5 against tv-web's `^18.3.1`/`^5.6.3` catalogue, React
Native's Metro/autolinking are fragile under pnpm's symlinked
`node_modules`, and consuming the shared packages' built `dist/` output would
make this project's build order depend on tv-web's. This is a deliberate,
repo-convention-breaking trade-off: see
[`clients/fire-tv/README.md`](../../../clients/fire-tv/)
for the full reasoning and its stated cost: this is the one client whose
dependencies are not governed by the workspace catalogue, and a breaking
change to a shared package can break this client's typecheck without a single
file under `clients/fire-tv/` having changed.

## The Vega SDK on other Linux distributions

Amazon documents the Vega SDK installer as macOS 10.15+ or Ubuntu 20.04+
only: other Linux distributions are off that list outright, and one of the
SDK's real dependencies (`libpython3.8-dev`) is missing from many newer
distributions, exactly the kind
of thing that fails at link time rather than at install time. Rather than
treat that as blocking, the toolchain is deliberately split in two so that
almost nothing about developing this client depends on the SDK being
installed anywhere at all:

| Task | Needs the Vega SDK? | Runs natively on an unsupported distribution? |
|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | No | Yes |
| `npm test` (Jest, pure logic only) | No | Yes |
| `npm run gate` (manifest/package version parity, icon dimensions) | No | Yes |
| `npm run build:debug` / `build:release` (produce a `.vpkg`) | Yes | No |
| `npm run vd:start` / `run:vd` (virtual device) | Yes | Needs `/dev/kvm` |
| `npm run device:install` / `device:launch` (real Stick) | Yes | Needs the physical device |

Every screen, adapter and hook in this app is authored, typechecked and
unit-tested with zero SDK involvement: the SDK is needed only to turn
TypeScript into a `.vpkg` and put it on glass. When it is needed,
`scripts/Dockerfile.vega-sdk` builds an Ubuntu 22.04 image carrying the exact
pinned prerequisites (Node 20, not a much newer host
Node, which is too new for Metro 0.76/React Native 0.72, `libpython3.8-dev`
via the deadsnakes PPA, `watchman`) and installs the SDK inside it via
Amazon's own installer script; `scripts/vega-docker.sh` wraps any
`build:*`/`vd:*`/`device:*` command to run through that container, mounting
both `clients/fire-tv` and `clients/tv-web/packages` so the same Metro
aliases resolve inside the container as outside it. None of this has been
exercised against a real SDK install yet: whether the
installer even runs without a registered Amazon developer account, whether
every pinned `@amazon-devices/*` package version resolves together, and
whether HLS/DASH actually play on real Fire TV Stick hardware (a since-closed
community report describes exactly the opposite (only progressive MP4
working, HLS/DASH failing with Shaka error 1002, on a Fire TV Stick 4K
Select) are all open questions the first real hardware session needs to
answer, not assumptions this design quietly relies on.

## Screen inventory

Sixteen screens ship in v1, a deliberately narrowed set against tv-web's 20
routed pages plus 9 settings sub-pages:

- **Linking and identity**: `LinkScreen`, `ProfilesScreen`.
- **Browsing**: `HomeScreen`, `LibraryScreen` (one screen, `kind` param, for
  movies/series/sites/music alike), `WorkDetailScreen`, `MusicDetailScreen`,
  `SearchScreen`, `PlaylistsScreen` (read and play; reorder/edit deferred).
- **Settings**: `SettingsIndexScreen` plus `AppearanceScreen`,
  `LanguageScreen`, `PlayerSettingsScreen`, `ServerScreen`,
  `ProfileLockScreen`.
- **Fallback**: `NotFoundScreen`.

Deliberately out of v1, each for a stated reason rather than by omission:
`/downloads` (tv-web's IndexedDB offline engine has no Vega equivalent, and a
Stick has little local storage to offer one); `/settings/profile-avatar`
(needs image upload/crop, and there is no file picker on a TV remote);
`/settings/invite` and `/settings/request-latency` (administrative/diagnostic
screens better suited to phone or web); `/login`, `/signup`, and the public
`/clients` catalogue pages (no keyboard-first login path exists on this
client by design, and the client-download catalogue is web-only by
definition).

## References

- [Vega OS developer documentation](https://developer.amazon.com/docs/vega/)
- [`clients/fire-tv/README.md`](../../../clients/fire-tv/): build
  commands, current implementation status, and the full workspace-placement
  trade-off
- [`docs/architecture/peer-groups.md`](../peer-groups.md): the known-server
  group rules this client's linking flow follows
- [`docs/architecture/clients/tizen.md`](tizen.md): the closest sibling for
  native-player-adapter shape (`TizenAvplayEngine` vs. this client's planned
  `VegaPlaybackEngine`) and the `streamarr_playback_session` cookie fallback
  this design also relies on
