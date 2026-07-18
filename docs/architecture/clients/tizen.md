# Client Architecture: Tizen (Samsung Smart TVs)

The Tizen client targets Samsung's Tizen Smart TV platform. Like webOS, it
is one of the "TV shell" clients built on the shared packages in
`clients/tv-web/packages/` (see [`webos.md`](webos.md) and
[`web.md`](web.md)) — Tizen TVs run a web-app host with a native bridge,
the same shape of platform as webOS, and the same "share the packages,
adapt the player/platform pieces" approach applies.

## Target OS/SDK versions

- **Minimum Tizen version:** Tizen 6.0 (`required_version="6.0"` in
  `tizen-manifest.xml`), matched to Samsung's own typical multi-year
  support and certification window for currently sellable/serviceable TV
  app submissions. The app's build target (`vite.config.ts`) compiles to
  conservative `es2018` for Tizen's legacy WebKit runtime.
- **SDK/tooling:** [Tizen Studio](https://developer.tizen.org/development/tizen-studio)
  and its CLI (`tizen build-web`, `tizen package`, `tizen install`, `tizen
  run`), plus a Samsung **Partner Certificate** profile required to sign
  packages for submission. **Tizen Studio is not installed in this
  development environment** — a real, current gap, not a permanent one:
  `clients/tv-web/apps/tv-tizen/` builds a genuine static Vite `dist/`
  bundle (verified as part of the workspace's full `pnpm -r run build`),
  and `tizen-manifest.xml` is a real, structurally-valid Tizen web-app
  manifest (W3C widget config + `tizen:` namespace extensions: application
  id/package, `tv` profile, required privileges, TV display settings), but
  `tizen build-web`/`tizen package` have not been invoked to produce or
  test an actual `.wgt` here. The production build copies
  `tizen-manifest.xml` to the package-root `config.xml`, includes the Playarr
  application icon, and validates both in its package-ready `dist/`
  directory. See `clients/tv-web/apps/tv-tizen/README.md` for the exact
  packaging commands to run once Tizen Studio is available.

## Tech stack

| Concern | Choice |
|---|---|
| Base codebase | Shared `clients/tv-web/packages/` (`ui-tv`, `player-avplay`, `device-auth`, `domain`, `api-client`, `spatial-nav`) |
| UI | React + TypeScript |
| Playback | Samsung **`webapis.avplay`** API (not plain HTML5 `<video>`), via `@streamarr-tv/player-avplay` |
| DRM | Not implemented in practice today — see "Playback / DRM approach" below |
| Platform bridge | No dedicated Tizen bridge module beyond the player adapter — see "Code-sharing story" below |
| Packaging | Tizen Studio (`tizen package` → `.wgt`) — not yet run in this environment, see above |

The one meaningful divergence from webOS's approach: Tizen's `webapis.avplay`
API is used for playback instead of Shaka Player + `<video>`. `AVPlay` is
Samsung's own TV-optimised native playback API; `TizenAvplayEngine`
(`@streamarr-tv/player-avplay`) satisfies the same `PlaybackEngine`
interface from `player-core` that `ShakaPlaybackEngine` satisfies, so
`ui-tv`'s Player screen and containers don't need to know which one is
plugged in — the Tizen app entry point (`apps/tv-tizen/src/index.tsx`)
renders no `<video>` element at all (unlike webOS/Web/VIDAA), since
`TizenAvplayEngine` draws to a native video plane positioned with
`setDisplayRect` instead of an MSE-backed DOM element. `player-avplay` is
typed against a hand-written `tizen-avplay.d.ts` (global ambient
declarations covering only the AVPlay surface the adapter actually calls),
since there is no real Tizen SDK available in this environment to pull
official type declarations from.

## Playback / DRM approach

`webapis.avplay` handles both direct-play and on-demand-transcoded
HLS/DASH sources (see
[`../overview.md`](../overview.md#the-tdarr-background-vs-on-demand-transcode-split)),
loading whatever `GET /api/v1/playback/{media_file_id}` returns.

**No DRM is exercised in practice today**, though this is the one TV
platform where the plumbing goes furthest: `player-avplay`'s
`applyDrm(DrmConfig)` contains real, working code that calls
`webapis.avplay.setStreamingProperty("WIDEVINE_LICENSE_SERVER_URL", ...)`
or `"PLAYREADY_LICENSE_SERVER_URL"` and `webapis.avplay.setDrm(...)`
depending on the config's `systemId` (`com.widevine.alpha` or
`com.microsoft.playready`) — real AVPlay DRM API usage, not a stub. But
nothing ever supplies a `DrmConfig`: the real `PlaybackInfoResponse`
carries no DRM fields, `ui-tv`'s playback wiring never sets
`PlaybackSource.drm`, and there is no `/api/drm/...` endpoint anywhere in
the real API surface. So, exactly as with the other platforms (see
[`web.md`](web.md#playback--drm-approach)), the DRM code path is real and
ready — and, on this platform specifically, more complete than the others,
since AVPlay's native DRM API is directly wired up — but currently always
inert pending server-side content protection. Earlier drafts of this
document described a live Widevine-with-PlayReady-fallback integration
against real `/api/drm/widevine/license`/`/api/drm/playready/license`
endpoints that were never actually built; treat that framing as
aspirational, not current.

## Code-sharing story with sibling platforms

Tizen shares the same `ui-tv` component tree, generated `api-client`, and
auth/session logic (including real RFC 8628 device pairing, per
[`../auth-modes.md`](../auth-modes.md)) as webOS, VIDAA, and (partially —
`ui-tv`/`spatial-nav` aren't used there) Web, through
`clients/tv-web/packages/`. As described in
[`webos.md`](webos.md#code-sharing-story-with-sibling-platforms), there is
no formal `TvPlatformAdapter` interface and no per-platform bridge module;
Tizen's one real divergence from webOS/VIDAA is the player implementation
(`TizenAvplayEngine`/`webapis.avplay` rather than `ShakaPlaybackEngine`/
`<video>`+MSE, as described above), confined to
`clients/tv-web/packages/player-avplay/` and the one line in
`apps/tv-tizen/src/index.tsx` that constructs it. Remote-key handling
itself is not Tizen-specific either — `spatial-nav` listens for the same
standard `keydown` events Tizen's remote dispatches, same as webOS.

## Store submission process and constraints

- Distributed via the **Samsung Seller Office** (Samsung's TV app developer
  portal), which requires a registered Samsung developer/seller account
  distinct from LG's or Google's.
- Packaging is a signed `.wgt` produced by `tizen package`, signed against
  a Samsung **Partner Certificate** profile obtained through Tizen Studio's
  certificate manager — this is a harder prerequisite than webOS's or the
  mobile stores' developer accounts, since it requires Samsung's
  certificate-issuance process to be completed before a package can even
  be installed on a physical test device, let alone submitted. This has
  not happened yet — see "Target OS/SDK versions" above for the current
  tooling gap.
- Submission goes through Samsung's certification review (functional
  testing against Samsung's Smart TV app guidelines, remote-control
  navigability, `AVPlay` usage compliance), with turnaround outside
  Streamarr's control.
- **No OTA update path.** Exactly as with webOS, every release — patch or
  otherwise — requires a full `.wgt` resubmission and Samsung's
  certification cycle; there is no in-app patch loophole. This is recorded
  identically in the per-platform update table in
  [`../../versioning-policy.md`](../../versioning-policy.md). `ui-tv`'s
  real `VersionBanner` component (shared with webOS and VIDAA) surfaces
  this in-app — a non-blocking banner once the running build is below the
  server's `GET /api/system/version` `latest_version` for this platform,
  escalating its wording once below `min_supported_version` — but, per its
  own doc comment, can only tell the viewer to update via the Samsung Smart
  Hub, not force it: the same deprecation-window consideration from
  [`webos.md`](webos.md#store-submission-process-and-constraints) applies,
  so the server's compatibility floor must give Tizen users realistic time
  to receive a store update before support for their client's version is
  dropped.
