# Client Architecture: Xbox

Playarr for Xbox is **not** a packaged distribution of
[`clients/tv-web/web`](../../../clients/tv-web/web/), unlike webOS, Tizen, or
VIDAA. It is a native UWP/XAML application at
[`clients/xbox/`](../../../clients/xbox/) with its own screens, its own
navigation, and its own player, split into a portable core
(`Playarr.Core`, netstandard2.0, no `Windows.*` reference, unit-testable on
any OS) and a thin native head (`Playarr.Xbox`, the UWP/XAML application
project that references it). The two share nothing at the UI layer with
`clients/tv-web`; what they share is the same API contract every Playarr
client speaks. A third, independent delivery path exists alongside the native
app: the shared Playarr Web app now detects Xbox's built-in Edge/Chromium
browser and serves it a narrower playback-capability profile, giving Xbox
owners a zero-install fallback while the native app has no package to
install. All three routes are covered here; the end-user instructions for
each are in [`docs/clients/xbox.md`](../../clients/xbox.md).

## Supported runtime

- **Developer-package floor:** `Windows.Universal`, `MinVersion
  10.0.17763.0` / `MaxVersionTested 10.0.19041.0`, declared in
  `Playarr.Xbox/Package.appxmanifest`. `Windows.Universal` (rather than the
  narrower `Windows.Xbox` device family) is deliberate for now: it is the
  widest family that still installs on an Xbox, so the manifest sideloads
  and runs on a desktop debug session without first confirming
  `Windows.Xbox`-only distribution is what this project actually wants for
  an eventual Store listing. Narrowing it is explicitly left as a follow-up,
  not an oversight.
- **Signing:** `Identity/@Publisher` is `CN=Playarr Server`, a self-signed Dev
  Mode/sideload placeholder, not a real Microsoft Store publisher identity.
  `PackageCertificateKeyFile` points at a `Playarr.Xbox_TemporaryKey.pfx`
  that does not exist yet; Visual Studio generates it (self-signed, matching
  the placeholder publisher) the first time this project is opened and
  built, and it is already `.gitignore`'d. A real Store submission replaces
  the placeholder with the Partner Center-issued publisher CN, which in turn
  means regenerating every certificate built against the placeholder.
- **Tooling:** Visual Studio with the UWP workload, a Windows 10/11 SDK
  matching the manifest's `TargetPlatformVersion`/`TargetPlatformMinVersion`,
  and — for sideloading once a package exists — the Xbox Device Portal
  reached from a Developer Mode console. None of this is installed in this
  repository's environment.

What is and is not buildable here matters more for this client than for any
packaged-web one, because there genuinely is native platform code this time.
`Playarr.Core` is a normal netstandard2.0 library with an xUnit test project
and **builds and passes its full test suite on Linux**:

```sh
cd clients/xbox
dotnet build src/Playarr.Core/Playarr.Core.csproj
dotnet test tests/Playarr.Core.Tests/Playarr.Core.Tests.csproj
# Build succeeded. 0 Warning(s), 0 Error(s).
# Passed! - Failed: 0, Passed: 36, Skipped: 0, Total: 36
```

`Playarr.Xbox` — the actual UWP/XAML application head, every screen, and the
player — **has never been compiled anywhere**. It is a legacy (non-SDK-style)
`ToolsVersion="15.0"` project that needs MSBuild plus a Windows 10 SDK plus
the UWP workload, none of which exist on this Linux box or in this repo's CI
today (see "Distribution blockers" below). Every `.xaml`/`.csproj`/
`.appxmanifest` file was instead validated with `xmllint --noout` (catching
several illegal `--` sequences inside XML `<!-- -->` comments along the way),
every `.cs` file's brace/paren balance was checked by hand, and every
`x:Name`/`Click` reference between a page's XAML and its code-behind was
cross-checked manually. That is real diligence, but it is not the same thing
as a compiler having seen this code — treat every claim below about the UWP
head as "written to be correct," not "verified correct."

## Portable core and native head

`Playarr.Core` (`clients/xbox/src/Playarr.Core/`) is the Xbox equivalent of
the hand-written Kotlin/Swift API mirrors described in
[`roadmap.md`](../../roadmap.md)'s Wave 5 SDK-codegen note: a typed
`IPlayarrApiClient`, RFC 8628 device-flow client, JWT/session models, and
`XboxPlaybackProfile` (below), all written by reading
`backend/openapi/playarr.yaml` directly rather than through generated
codegen. It has no dependency on any `Windows.*` namespace, which is exactly
what makes it buildable and testable outside Visual Studio.

`Playarr.Xbox` (`clients/xbox/src/Playarr.Xbox/`) is the UWP/XAML head:
`App`, eight screens (Login, Profiles, Home, Library, Search, WorkDetail,
Player, Settings), and their `ObservableObject`-based ViewModels. The whole
project follows one pattern, consistently:

- **No `{x:Bind}`, no `{Binding}`, no `IValueConverter`.** Controls use plain
  `x:Name` plus `Click="Foo_Click"` routed-event handlers that forward into
  parameterless ViewModel methods. A page subscribes to its ViewModel's
  `PropertyChanged` in `OnNavigatedTo` and re-renders through one `Render()`
  method that reads every property it cares about and pushes values onto
  named XAML elements — unconditionally, on every notification, with no
  per-property diffing.
- **No DI container.** `App.Environment` (an `XboxAppEnvironment`) and
  `App.Navigation` (a `NavigationService` wrapping the root `Frame`) are the
  only two static accessors every page reaches shared state through.

Signing in is a native RFC 8628 device-code pairing flow, not the hosted
`playarr.app` QR/short-code broker webOS, Tizen, and VIDAA use. `LoginPage`
takes a direct server address, and `XboxAppEnvironment.StartPairingAsync`
requests a device code straight from that Playarr Server (retrying across
every address the install has ever remembered for that server, via
`KnownServerGroup.CandidateUrls()`, last-good first) before polling for a
token — a direct port of `clients/apple-tv`'s `TVAppEnvironment.swift`, not a
relative of the tv-web hosted-device-link flow. The session is persisted
through Windows' `PasswordVault` (`PasswordVaultTokenStore`); the server
address and per-install device id persist through
`ApplicationData.LocalSettings` (`LocalSettingsKnownServerGroupStore`).

## Remote navigation and lifecycle

XAML's built-in `FocusManager` XY focus-navigation engine handles Up/Down/
Left/Right gamepad traversal between focusable controls for free — this
client does not hand-roll spatial navigation the way `clients/tv-web`'s
`ui-tv` package does for D-pad TVs. What is not free, and is only partly
addressed today:

- The gamepad **B button** maps to `SystemNavigationManager.BackRequested`,
  handled once at the app root in `App.xaml.cs`. The handler only claims Back
  when `Navigation.CanGoBack`; an unclaimed Back at the root is left with
  `e.Handled = false` for Xbox's own shell to back out of the app — the same
  judgment call `clients/tv-web/apps/tv-webos/src/webosLifecycle.mjs`'s
  `handleRemoteKey` makes for webOS, cited directly in `App.xaml.cs`'s own
  comment.
- The gamepad **View** and **Menu** buttons have no defined contract yet.
  Xbox certification expects consistent, documented behavior for both (see
  `clients/xbox/docs/store-submission.md` §3) rather than silent per-screen
  no-ops; this remains open.
- Every focusable control needs a visible focus rectangle at all times
  ("reveal focus") for certification, which is inherited from the XAML
  default control templates rather than anything this app added explicitly.

`NavigationService` is deliberately small: `CanGoBack`, `Navigate(Type)`,
`Navigate(Type, object)`, and `GoBack()`. It has no "replace current page" or
"clear back stack" operation, so `Navigate` always pushes a new page
instance — bouncing between Home's and Library's nav buttons grows the back
stack by one entry per click, and `SettingsPage`'s Sign Out navigates to
`LoginPage` without clearing what came before it, so a Back press after
signing out can still reach a now-stale authenticated screen. Both are known,
unaddressed rough edges, not oversights corrected elsewhere.

`OnSuspending` is a no-op deferral-complete: `XboxAppEnvironment` persists
`LocalSettings`/`PasswordVault` writes eagerly, at the point of the change,
so there is no batched state to flush on suspend. This will need revisiting
once playback position needs an explicit flush-on-suspend guarantee.

## Playback and DRM

`XboxPlaybackProfile` (`Playarr.Core/Playback/XboxPlaybackProfile.cs`) is the
Xbox equivalent of `clients/tv-web/web/src/lib/playbackCapabilities.ts`: it
declares this client's own `containers`/`video_codecs`/`audio_codecs`/
`max_bitrate_bps` on `GET /api/v1/playback/{media_file_id}`, because
`playarr-transcode`'s `ClientCapabilities` deliberately has no per-platform
table server-side. Per real console generation:

| | Xbox One | One S | One X | Series S | Series X |
|---|---|---|---|---|---|
| H.264 | 1080p60 | 1080p60 | 1080p60 | 1080p60 | 1080p60 |
| HEVC (Main/Main10) | — (no hardware decoder) | 2160p60 | 2160p60 | 2160p60 | 2160p60 |
| VP9 Profile 2 | — | — | 2160p60 | 2160p60 | 2160p60 |
| AV1 | — | — | — | — | — |
| Max bitrate advertised | 20 Mbps | 40 Mbps | 120 Mbps | 120 Mbps | 120 Mbps |

H.264 is capped at 1080p60 on **every** console, Series X included — 4K
media only ever arrives as HEVC or VP9, which is, per the profile's own
comment, "the most commonly mis-stated fact about Xbox playback." AV1 is
absent from every profile: no Xbox has AV1 hardware decode, full stop, and
declaring it would trade a clean server-side transcode for a software-decode
stutter. The bitrate ceilings are a deliberate design choice, not a
decoder-reported figure — high enough that a wired-LAN remux direct-plays,
low enough that a pathological source still gets transcoded rather than
starving the console's roughly 1 GB app memory budget, explicitly avoiding
the unexplained 12 Mbps cap that forced Jellyfin's Xbox client through a
transcode for every 4K remux for years. `MKV` is included in the container
list deliberately: Xbox's native Media Foundation pipeline demuxes Matroska
directly, which is the single largest direct-play advantage the native app
has over the browser fallback on the same hardware (see below). `XboxModel`
detection (`XboxModelDetector`) can only confirm "this process is running on
some Xbox" via `AnalyticsInfo.VersionInfo.DeviceFamily`, never which model —
telling One/One S/One X/Series S/Series X apart needs the Xbox-exclusive
`Windows.Xbox.System` extension SDK, unavailable to target or verify from
this environment. Detection failure or ambiguity always falls back to
`XboxModel.Unknown`'s profile (the original Xbox One's floor), so
under-detection only ever costs a needless transcode, never a direct play the
console can't actually decode.

**Why a native head instead of a packaged web shell, the way webOS/Tizen/
VIDAA are:** `playarr-transcode`'s on-demand HLS output is real MPEG-TS
segments (`-hls_segment_filename .../segment_%05d.ts`, per
`build_ffmpeg_hls_args` in `backend/crates/playarr-transcode/src/lib.rs`),
not fragmented MP4 announced through `#EXT-X-MAP`. A browser's Media Source
Extensions pipeline — the same MSE pipeline every packaged webOS/Tizen/VIDAA
build and the Edge-on-Xbox fallback both use — cannot append raw MPEG-TS
segments directly; it needs fMP4/ISO-BMFF media, which means a transmuxing
step somewhere in the chain. UWP's `Windows.Media.Streaming.Adaptive.
AdaptiveMediaSource`, by contrast, consumes the server's MPEG-TS HLS output
natively with no remux step. Combined with MKV direct-play and reliable HEVC
support (both unavailable to Xbox's own Edge, see below), this is why Xbox
gets a native head at all rather than joining the packaged-web-shell family
the other TV platforms belong to.

`PlayerViewModel.LoadAsync` negotiates `PlaybackMode.Direct` vs `.Hls` from
`GetPlaybackInfoAsync`. HLS builds an `AdaptiveMediaSource` via
`CreateFromUriAsync(uri, httpClient)`, with the bearer token attached as a
real HTTP header on a pre-configured `Windows.Web.Http.HttpClient` — never as
a query parameter. Direct mode uses `MediaSource.CreateFromUri`, which has no
overload accepting custom headers or an `HttpClient` at all, so **direct-mode
requests carry no `Authorization` header today** — a genuine, open
correctness gap if the server's direct-serve route enforces the same
bearer-token auth as every other endpoint, not a documentation nicety. Watch
progress reports every 15 seconds and once more on navigating away, offset by
`PlaybackInfoResponse.SourceOffsetMs` so a seek-ahead transcode reports a true
source position; duration is read from `PlaybackInfo.DurationMs`, not
`NaturalDuration`, for the same reason. Audio/subtitle track selection
correlates a server-reported track's list position with the same position in
`MediaPlaybackItem`'s track lists — there is no shared id to match on, so this
is an assumption, and the exact shape of `SingleSelectMediaTrackList` it
relies on is written from memory of the WinRT surface, not confirmed by a
live SDK. System Media Transport Controls are wired (`CommandManager.
IsEnabled = true`, title-only `DisplayUpdater`, Next/Previous disabled since
there is no playlist), giving the Xbox Guide's now-playing card and hardware
media-remote buttons real function — a capability the browser fallback does
not get.

There is no DRM. UWP's native protected-playback API is PlayReady, and the
`rescap:hevcPlayback` capability declared in the manifest is unrelated to
it — it exists purely so Media Foundation's HEVC decoder is available to
this app at all, matching what `XboxPlaybackProfile` already advertises. Per
[`roadmap.md`](../../roadmap.md)'s Wave 3 status, `GET /api/v1/playback/...`
returns no DRM configuration or license endpoint for any Playarr Server client
today, so this client does not attempt to wire up PlayReady against a server
contract that does not exist.

**The Edge-browser fallback is deliberately narrower**, not an oversight:
`clients/tv-web/web/src/lib/playbackCapabilities.ts`'s
`XBOX_PLAYBACK_CAPABILITIES` claims only `h264,vp9` video and `aac,opus`
audio in `mp4,m4v,webm,mp3,m4a` containers. Xbox's built-in Edge/Chromium
falsely reports HEVC and AV1 as supported through `MediaSource.
isTypeSupported`/`canPlayType` — HEVC does not actually decode there at all,
and AV1 only software-decodes and stutters (consistent with "no Xbox has AV1
hardware decode" above) — so both are excluded from the browser profile even
though the native profile claims HEVC on every console but the original One.
There is no Matroska demuxer in that browser either, so `mkv` is excluded
too, unlike the native client's container list. `ac3`/`eac3` aren't claimed
for the MSE path since they are unverified there, unlike the native decode
path which does claim them. Detection itself
(`clients/tv-web/web/src/lib/clientPlatform.ts`) is a `/\bXbox\b/i`
user-agent sniff with **no `localStorage` persistence** — Xbox's Edge sends
this UA token on every request and reload, unlike VIDAA's one-shot installer
query flag, so nothing needs to survive a route reload the way VIDAA's marker
does.

## Package contract

`Playarr.Xbox.csproj` is a legacy, non-SDK-style project (`ToolsVersion`
`"15.0"`) with every `Compile`/`Page`/`Content` item explicitly listed —
legacy `csproj` has no globbing — and full Debug/Release × x86/x64/ARM64
property groups, referencing `Playarr.Core.csproj` by its solution GUID.
`Directory.Build.props` supplies MSBuild properties shared by both this
project and the SDK-style `Playarr.Core`/test projects (`LangVersion latest`,
`Nullable enable`, `Deterministic true`, and the single `<Version>0.1.0</
Version>` that both the assemblies and the packaging manifest must be kept
in step with — nothing enforces that automatically for a legacy project).

`Package.appxmanifest` declares `Identity Name="Playarr Server.PlayarrXbox"`,
`Publisher="CN=Playarr Server"` (the self-signed placeholder above), `Version
"0.1.0.0"`, `TargetDeviceFamily Name="Windows.Universal"` with the SDK
range above, and `<rescap:Capability Name="hevcPlayback" />` — a genuinely
required, genuinely *restricted* capability, since `XboxPlaybackProfile`
already advertises HEVC direct-play and Media Foundation's HEVC decoder
needs it declared to be available to the app at all. Every `Assets/*.png`
the manifest references (icons, tiles, splash screen) is a plausible
filename, not a file that exists — no icon/tile/splash art has been produced
for this client yet.

`Playarr.Xbox.sln` deliberately does not wire the UWP head project in with
real platform-configuration mappings (Any CPU vs x86/x64/ARM64) — that needs
Visual Studio's own "Add existing project"/reload the first time this is
opened on Windows, which this environment cannot do or validate.

## Distribution blockers

Repository-local buildability is separate from release completion, and for
this client the gap is unusually wide: `Playarr.Core` is real, tested code,
but the native application it supports has never been compiled by anything.
No CI job builds `Playarr.Xbox` either — `.github/workflows/ci.yml`'s
`xbox-check` and the `Justfile`'s `xbox-core-build`/`xbox-core-test` recipes
only build/test `Playarr.Core`; `.github/workflows/xbox-ci.yml`'s
`build-and-package` job runs on `windows-latest` with real checkout/`dotnet`/
MSBuild setup steps but three unimplemented `TODO` placeholders in place of
an actual signing/packaging/publish sequence. There is no signing certificate
beyond the Visual-Studio-generated Dev Mode placeholder, no Microsoft Partner
Center account has ever been used for this project, and Xbox device-family
submission access has not been requested — see
[`clients/xbox/docs/store-submission.md`](../../../clients/xbox/docs/store-submission.md)
for the full, honestly-labeled submission checklist. No icon, tile, or
splash art exists. No physical or virtual Xbox console, and no Windows
machine with the UWP workload, has ever run this code.

Until a package is built and sideloaded through Xbox Developer Mode, or a
Store submission is approved, the Edge-on-Xbox browser route described in
[`docs/clients/xbox.md`](../../clients/xbox.md) is the only way a Playarr Server
user can actually use Playarr on an Xbox today.
