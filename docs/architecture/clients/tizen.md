# Client Architecture: Tizen (Samsung Smart TVs)

The Tizen client targets Samsung's Tizen Smart TV platform. Like webOS, it
is one of the "TV shell" clients built on the shared web codebase in
`clients/tv-shell/` (see [`webos.md`](webos.md) and [`web.md`](web.md)) —
Tizen TVs run a web-app host with a native bridge, the same shape of
platform as webOS, and the same "share the shell, adapt the platform
bridge" approach applies.

## Target OS/SDK versions

- **Minimum Tizen version:** Tizen 4.0 (2018 model year Samsung TVs and
  newer), matched to Samsung's own typical multi-year support and
  certification window for currently sellable/serviceable TV app
  submissions and chosen for the same reasoning as webOS's floor: a modern
  enough web engine and `AVPlay`/EME implementation without carrying
  compatibility burden for TV hardware old enough to be dropping off
  Samsung's own supported list.
- **SDK/tooling:** [Tizen Studio](https://developer.tizen.org/development/tizen-studio)
  and its CLI (`tizen build-web`, `tizen package`, `tizen install`), plus a
  Samsung **Partner Certificate** profile required to sign packages for
  submission. Tizen Studio is **not** installed in this development
  environment; the source and packaging config in `clients/tizen/` are
  written and structurally valid (a correct `config.xml`, correct
  `.tproject` metadata), but `tizen build-web`/`tizen package` have not
  been invoked to produce or test an actual `.wgt` here — see the note in
  `clients/tizen/README.md`.

## Tech stack

| Concern | Choice |
|---|---|
| Base codebase | Shared TV shell (`clients/tv-shell/`) |
| UI | React + TypeScript |
| Playback | Samsung **`AVPlay`** API (not plain HTML5 `<video>`) |
| DRM | Widevine and PlayReady, both available through `AVPlay`'s DRM configuration |
| Platform bridge | Tizen Web Device API (`tizen.tvinputdevice` for remote-key registration, `tizen.tvaudiocontrol`, network/system info) |
| Packaging | Tizen Studio (`tizen package` → `.wgt`) |

The one meaningful divergence from webOS's approach: Tizen's `AVPlay` API
is used for playback instead of the standard HTML5 `<video>` + MSE/EME
stack the Web and webOS clients use. `AVPlay` is Samsung's own
TV-optimised playback API and is materially more capable on Tizen than
plain `<video>` for adaptive streaming and DRM-protected content —
`<video>`+MSE/EME is supported on Tizen but is the officially
de-emphasised path for anything beyond basic playback, so the shared TV
shell's player abstraction has a Tizen-specific implementation
(`clients/tizen/src/avplay-player.ts`) satisfying the same player interface
`web.md` and `webos.md`'s implementations satisfy, swapped in via the same
platform-adapter mechanism described in [`webos.md`](webos.md#code-sharing-story-with-sibling-platforms).

## Playback / DRM approach

`AVPlay` handles both direct-play and on-demand-transcoded HLS/DASH
sources (see
[`../overview.md`](../overview.md#the-tdarr-background-vs-on-demand-transcode-split)),
configured with DRM parameters pointing at Streamarr's license endpoints —
`AVPlay` supports both Widevine (`/api/drm/widevine/license`, the same
endpoint Android and webOS use) and PlayReady, with PlayReady available as
a fallback on Tizen hardware/firmware combinations where Widevine's
supported security level would otherwise cap output resolution below what
PlayReady can achieve on that same device. Streamarr's `streamarr-transcode`
crate exposes a parallel `/api/drm/playready/license` endpoint specifically
for this Tizen (and, prospectively, any future PlayReady-preferring
platform) case; it is not used by any other client in the current
7-client strategy.

## Code-sharing story with sibling platforms

Tizen shares the same shell, component tree, generated API client, and
auth/session logic (including RFC 8628 device pairing, per
[`../auth-modes.md`](../auth-modes.md)) as webOS and Web, through
`clients/tv-shell/`. It diverges from webOS in two adapter-layer places
rather than one: the standard `TvPlatformAdapter` (remote-key mapping,
device ID, exit-app — implemented in
`clients/tizen/src/tizen-bridge.ts`) *and* the player implementation
(`AVPlay` rather than `<video>`+MSE/EME, as described above). Both
divergences are confined to `clients/tizen/`; nothing in
`clients/tv-shell/` needs to know which player or bridge implementation a
given TV platform has plugged in.

## Store submission process and constraints

- Distributed via the **Samsung Seller Office** (Samsung's TV app developer
  portal), which requires a registered Samsung developer/seller account
  distinct from LG's or Google's.
- Packaging is a signed `.wgt` produced by `tizen package`, signed against
  a Samsung **Partner Certificate** profile obtained through Tizen Studio's
  certificate manager — this is a harder prerequisite than webOS's or the
  mobile stores' developer accounts, since it requires Samsung's
  certificate-issuance process to be completed before a package can even
  be installed on a physical test device, let alone submitted.
- Submission goes through Samsung's certification review (functional
  testing against Samsung's Smart TV app guidelines, remote-control
  navigability, `AVPlay` usage compliance), with turnaround outside
  Streamarr's control.
- **No OTA update path.** Exactly as with webOS, every release — patch or
  otherwise — requires a full `.wgt` resubmission and Samsung's
  certification cycle; there is no in-app patch loophole. This is recorded
  identically in the per-platform update table in
  [`../../versioning-policy.md`](../../versioning-policy.md), and the same
  deprecation-window consideration from [`webos.md`](webos.md#store-submission-process-and-constraints)
  applies: the server's `apiVersion` floor must give Tizen users realistic
  time to receive a store update before support for their client's
  `apiVersion` is dropped.
