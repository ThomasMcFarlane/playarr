# Playarr for Fire TV (Amazon Vega OS)

Playarr for Fire TV is a native [React Native](https://reactnative.dev/) app
targeting Amazon's [Vega OS](https://developer.amazon.com/docs/vega/): the
Linux-based, New Architecture (Fabric), Hermes-only runtime that ships on
current-generation Fire TV Stick hardware. It is not a WebView, not a hosted
build of [`clients/tv-web/web`](../tv-web/web/), and not a reskin of
[`clients/android`](../android/): Vega has no browser surface at all, so
unlike VIDAA, webOS or Tizen there is no Playarr Web bundle to package here;
every screen is a real `.tsx` component talking to native Vega modules.

It reuses [`clients/android`](../android/) for precisely nothing (Vega is not
Android: see [`docs/architecture/clients/fire-tv.md`](../../docs/architecture/clients/fire-tv.md)
for why that distinction actually matters) and reuses
[`clients/tv-web/packages/*`](../tv-web/packages/) for its non-visual logic:
the API client, device-linking/session machinery, domain types and design
tokens are consumed **as TypeScript source**, not copied. See
[Why a standalone npm project](#why-a-standalone-npm-project-not-a-pnpm-workspace-member)
below for exactly how and why.

## Current implementation status

Read this before assuming a green `npm test` means the app runs on real
hardware: it typechecks cleanly, every pure-logic module has real unit-test
coverage, and (see the caveats below) none of it has actually been exercised
on a Vega device or virtual device yet.

`App.tsx` mounts the real app shell: `src/navigation/RootNavigator.tsx` and
`AppShellNavigator.tsx` are wired in as the app's actual root (Link, Profiles,
then the tabbed home/library/detail/search/playlists/settings shell), with
`PlayerScreen` mounted alongside `NavigationContainer` as a shell-level
sibling rather than a route, per design doc §4.2's stated reason (a minimised
music player has to survive navigation, and `VegaPlaybackEngine` wraps a
native decoder the first-generation Stick allows only one instance of at a
time, so the component owning it cannot be torn down and recreated by
ordinary navigation). `App.tsx` provides `playerRef` through
`PlayerHandleContext`, wrapping both `NavigationContainer` and the
shell-mounted `PlayerScreen`; `AppShellNavigator.tsx`'s `WorkDetailScreenScreen`
and `MusicDetailScreenScreen` wrappers consume that context and pass a real
`onPlay` callback down to `WorkDetailScreen`/`MusicDetailScreen`, so pressing
play on either screen reaches `PlayerScreen` end to end. A render-level test
in `AppShellNavigator.test.tsx` mounts the real navigator tree, presses play,
and asserts the handle actually received the call.

The playback engine itself exists and is unit-tested: `PlayerScreen.tsx`,
`lib/playbackCapabilities.ts`, `lib/playerSession.ts`, and everything under
`src/platform/media/` (`VegaPlaybackEngine.ts`, `VegaVideoSurface.tsx`,
`shakaAdapter.ts`, `authTransport.ts`, `subtitles.ts`), each with a passing
test file alongside it. What that coverage does and does not prove is worth
being precise about: `npm test` runs these against a mocked Shaka/GStreamer
surface on plain Node, not Amazon's actual Vega fork of Shaka Player, so
whether the request-filter mechanism the header-injection design depends on
behaves the same way against a real device is still unverified, exactly as
the [Playback strategy](../../docs/architecture/clients/fire-tv.md#playback-strategy)
section of the architecture doc lays out. Nothing in this codebase has run
against real or virtual Vega hardware yet; see
[What still needs the SDK or real hardware](#what-still-needs-the-vega-sdk-or-real-hardware)
for exactly what remains unverified and why.

Everything else in the design's screen inventory is built with real,
non-stub logic too: hosted device linking (QR + user-code polling), profile
selection, the shared `TvStage`/`TvMediaTrack`/`PosterCard`/`NavRail` visual
components, catalogue browsing, search, playlists, and all six settings
screens.

## Why a standalone npm project, not a pnpm workspace member

`clients/tv-web/pnpm-workspace.yaml` globs `packages/* apps/* web admin`. That
glob has no way to reach a sibling directory, so `clients/fire-tv` could never
have joined it as `workspace:*` even if everything else pointed that way. But
that's not the only reason it stands alone: three more forcing factors,
stated plainly rather than argued around:

1. **Vega pins exact versions the tv-web catalogue doesn't share.** React
   `18.2.0` and TypeScript `~4.9.5` here, vs `^18.3.1` / `^5.6.3` in tv-web's
   catalogue. Joining the workspace would mean fighting the catalogue on every
   install.
2. **React Native's Metro bundler and autolinking are fragile under pnpm's
   symlinked `node_modules`.** Amazon's own Vega sample apps use npm with
   `legacy-peer-deps=true`, not pnpm; this project follows that precedent
   rather than fighting the toolchain to prove a point.
3. **The shared `@playarr-tv/*` packages build to `dist/` via `tsc`.**
   Consuming that `dist/` output would mean fire-tv can't typecheck or bundle
   until tv-web has been built first, which is bad for CI and bad for editing a shared
   package and seeing the change land here immediately.

**The trade-off, stated honestly:** this project consumes
`clients/tv-web/packages/*/src` (the shared logic packages' TypeScript
*source*, never their built `dist/`) through Metro `watchFolders` +
`extraNodeModules` aliases, mirrored exactly in `tsconfig.json`'s `paths`. The
win is real: no build-order dependency, no version fight, a flat
`node_modules` React Native's tooling actually expects, and shared logic
stays a single copy with zero drift. The cost is also real and worth naming:
this is the one client in the repo that does not follow the pnpm-workspace
convention, its own `package.json`/`package-lock.json` are the source of
truth for its dependencies rather than the workspace catalogue, and a
breaking change to a shared package can break this project's typecheck
without anyone having touched a single file under `clients/fire-tv/`, which
is exactly why CI must (once wired) filter on `clients/tv-web/packages/**` as
well as `clients/fire-tv/**`, not `clients/fire-tv/**` alone.

Two Metro details make "source, not dist" actually hold (both in
`metro.config.js`): the shared packages' `package.json` files are put on the
resolver `blockList`, because otherwise Metro's haste map registers each
package by name and follows its `main` (`./dist/index.js`, never built here)
ahead of the `extraNodeModules` alias; and `@playarr-tv/api-client` is aliased
to `metro-shims/api-client/` (`index.ts` and `react.ts`) because
`extraNodeModules` maps whole package names, not subpaths. Bundling also
needs tv-web's `web/src/lib/i18n` directory in `watchFolders`.

See `metro.config.js` and `tsconfig.json`: both are heavily commented at the
exact points this reasoning gets fiddly (the `/react` subpath, the
`@babel/runtime` helper redirect, why `qrcode`/`react` in `tsconfig.json`'s
`paths` point at their `@types/*` companions rather than the runtime package).

## Typecheck and test (no Vega SDK required)

Everything below runs on a plain Linux/macOS workstation with Node and npm.
None of it touches Amazon's SDK, a Vega virtual device, or real hardware:

```sh
cd clients/fire-tv
npm ci
npm run typecheck   # tsc -p tsconfig.json --noEmit
npm test            # jest, pure-logic unit tests, no native module needed
npm run gate        # node --test scripts/*.test.mjs, manifest/package.json consistency, icon dimensions
```

This is a deliberate split, not an oversight: every screen, hook and adapter
in this app is authored, typechecked and unit-tested with zero SDK
involvement. Amazon's toolchain is needed only to turn the TypeScript into a
`.vpkg` and put it on glass: see the next section.

**Node version note:** `package.json`'s `engines` field asks for
`>=18.0.0 <21.0.0` (Metro 0.76 / React Native 0.72's supported range). A newer
host Node will print an engine warning
on `npm ci` but has, in practice, still completed the install and run
`typecheck`/`test`/`gate` cleanly: the warning is advisory, not a hard
failure, for the pure-TypeScript half of the workflow. Do not extend that
same confidence to `build:*`/`vd:*`/`device:*` below; those genuinely need
the pinned Node 20 the container in `scripts/Dockerfile.vega-sdk` provides.

**A render-time gap `tsc`/`jest` do not catch on their own:** `babel.config.js`
deliberately forces the classic JSX runtime project-wide (Amazon's
`KeplerVideoView` needs it). Classic-runtime JSX compiles to literal
`React.createElement(...)` calls, which need `React` in scope as a *value*
import, not just the named imports (`useState`, `createContext`, …) most
files in this app use, because `tsc`'s `"jsx": "react-native"` check
validates structurally against the global `JSX` namespace and does not
require a value binding in scope. Every file in this app that renders JSX,
including `App.tsx` and `src/api/ApiClientProvider.tsx`, now carries that
explicit `import React from 'react';`, and several screens' test files also
keep a documented `globalThis.React = React;` shim as a belt-and-braces
guard. This is recorded here as a standing hazard for any new file added to
the tree, not as an outstanding defect: a file that skips the value import
will typecheck and pass Jest cleanly, then throw `ReferenceError: React is
not defined` only at real Metro-bundled render time, so it is worth checking
by hand rather than trusting the green build.

## What still needs the Vega SDK or real hardware

| Task | Needs the SDK? | Needs real/virtual hardware? |
|---|---|---|
| `npm run typecheck`, `npm test`, `npm run gate` | No | No |
| `npm run build:debug` / `build:release` (produce a `.vpkg`) | Yes | No |
| `npm run manifest:validate`, `npm run vpkg:info` | Yes | No |
| `npm run vd:start` / `npm run run:vd` (virtual device) | Yes | `/dev/kvm` |
| `npm run device:install` / `device:launch` / `device:logs` | Yes | A real Fire TV Stick |
| Verifying `src/platform/media/**` (playback) against real Shaka-for-Vega behaviour | Yes (Shaka-for-Vega tarball) | Yes: the implementation and its unit tests exist and pass against a mocked surface, but nothing has run against a real device or the actual Vega Shaka fork yet |

Amazon documents the Vega SDK installer as macOS 10.15+ / Ubuntu 20.04+ only:
other Linux distributions are off that list, and many no longer package the
SDK's `libpython3.8-dev` dependency. Rather than fight that, `scripts/Dockerfile.vega-sdk` builds an Ubuntu
22.04 container with the exact pinned dependencies (Node 20, `libpython3.8-dev`
via deadsnakes, `watchman`) and installs the SDK inside it;
`scripts/vega-docker.sh` wraps any `npm run build:*` / `vd:*` / `device:*`
command to run through that container, mounting both `clients/fire-tv` and
`clients/tv-web/packages` (the Metro aliases have to resolve inside the
container too). None of this has been exercised end-to-end in this
environment: see `docs/architecture/clients/fire-tv.md`'s SDK section for
exactly what is verified vs assumed.

## Source layout

- `src/platform/`: isolates the Kepler-specific surface whose real
  on-device behaviour nobody has confirmed yet: remote input, focus
  management, app lifecycle, device identity, capability flags, storage and
  (once built) the media playback engine, all behind a small public surface
  (`src/platform/index.ts`), so one of those Amazon APIs turning out to
  behave differently than assumed is a one-file fix, never a screen-level
  one. This is narrower than "every `@amazon-devices/*` import lives here":
  the Amazon-namespaced forks of otherwise-standard React Native libraries
  (`react-navigation`, `react-native-svg`, `shopify__flash-list`,
  `react-native-gesture-handler`, `react-native-screens`,
  `react-native-safe-area-context`, `react-linear-gradient`) are a
  lower-risk category with well-understood upstream behaviour, and are
  imported directly from `src/App.tsx`, `src/navigation/`, `src/screens/`
  and `src/components/` where each is used, matching the dependency table in
  the architecture doc.
- `src/config/appConfig.ts`: the single file naming this app's
  `ClientPlatform` identity (`'tv-fire'`) and hosted-link origin. The origin is
  a build-time setting: bundle with `PLAYARR_HOSTED_LINK_ORIGIN=<origin>` to
  point a bench build at another broker (plain `http://` is accepted); unset
  keeps the production default.
- `src/theme/`: design tokens (imported from `@playarr-tv/design-tokens`
  where possible, harvested from `clients/tv-web/web/src/styles/global.css`
  where the shared package has no colour palette) and the 1920×1080-baseline
  scaling helpers TV apps need for 4K panels.
- `src/api/`: the RN-fetch-backed `ApiClient` wiring and the reduced RN port
  of tv-web's `ApiClientProvider`.
- `src/auth/`: hosted device-link wire protocol, session commit/refresh,
  profile listing/PIN verification.
- `src/navigation/`: route-name constants, the root/app-shell navigators, and
  the ported `parentRoute`/`tvBackNavigationTarget` back-navigation policy.
- `src/components/`: the shared TV visual language: `TvStage`,
  `TvMediaTrack`, `TvEmptyState`, `PosterCard`, `ProfileAvatar`, `NavRail`,
  `ArtworkImage`, `QrCode`, each paired with a dependency-free `.ts` sibling
  holding its testable pure logic (geometry, focus-scale maths, gradient
  presets, …), because the `.tsx` components themselves cannot be rendered
  under Jest without a real Kepler host (see the test notes in
  `docs/architecture/clients/fire-tv.md`).
- `src/screens/`: one file per tv-web page that made the v1 cut; see the
  architecture doc's screen inventory for what didn't and why.
- `src/i18n/`: a thin RN port of tv-web's `LanguageProvider`, re-using its
  `en`/`th`/`ja` translation data as-is.
- `src/lib/`: small standalone helpers (catalogue-kind caching) that don't
  fit any of the above.
- `scripts/`: `Dockerfile.vega-sdk` + `vega-docker.sh` (the containerised SDK
  toolchain), and `prepare-package.mjs` (a pre-build gate checking
  `manifest.toml`/`package.json` version parity, icon PNG dimensions, and that
  no stray `proxy-config.json` is left in the tree).

## Full documentation

For the platform-identity decision, the device-linking flow, the playback
strategy and its fallback plans, and the SDK-on-other-Linux situation in more depth,
see [`docs/architecture/clients/fire-tv.md`](../../docs/architecture/clients/fire-tv.md).
