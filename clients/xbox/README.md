# Playarr for Xbox

Native UWP/XAML client for a self-hosted Playarr Server, targeting Xbox
One and Xbox Series consoles. Unlike the webOS/Tizen/VIDAA clients under
`clients/tv-web/apps/`, this is not a packaged distribution of the Web app —
it is a separate native application with its own screens, its own
navigation, and its own player. See
[`docs/architecture/clients/xbox.md`](../../docs/architecture/clients/xbox.md)
for the full architecture writeup and
[`docs/clients/xbox.md`](../../docs/clients/xbox.md) for the end-user guide.

## Layout

```
clients/xbox/
├── src/
│   ├── Playarr.Core/     Portable core: API client, RFC 8628 device-flow
│   │                     pairing, session/model types, and the per-console
│   │                     XboxPlaybackProfile capability matrix. Targets
│   │                     netstandard2.0 and has no Windows.* reference, so
│   │                     it builds and runs its tests on any OS.
│   └── Playarr.Xbox/     The UWP/XAML application head: App, screens
│                         (Login, Profiles, Home, Library, Search,
│                         WorkDetail, Player, Settings) and their
│                         ObservableObject-based ViewModels. A legacy
│                         (non-SDK-style) UWP project — needs MSBuild, a
│                         Windows 10/11 SDK, and the UWP workload.
├── tests/
│   └── Playarr.Core.Tests/   xUnit tests for Playarr.Core only.
├── docs/
│   └── store-submission.md   Microsoft Store / Partner Center prep checklist
│                              — preparation material, not a readiness claim.
├── Playarr.Xbox.sln
└── Directory.Build.props     Shared MSBuild properties for both projects.
```

## Building and testing `Playarr.Core`

This is the only part of the solution that builds in a plain `dotnet` CLI
environment (Linux, macOS, or Windows without the UWP workload):

```sh
cd clients/xbox
dotnet build src/Playarr.Core/Playarr.Core.csproj
dotnet test tests/Playarr.Core.Tests/Playarr.Core.Tests.csproj
```

Expected output: a clean build with 0 warnings/errors, and `Passed! -
Failed: 0, Passed: 43, Skipped: 0, Total: 43`. The repo's `Justfile` wraps
the same two commands as `just xbox-core-build` / `just xbox-core-test`, and
CI runs them on every PR that touches `clients/xbox/**` (`xbox-check` in
`.github/workflows/ci.yml`).

## What needs Windows

Everything below requires Visual Studio with the UWP workload, a Windows
10/11 SDK matching `Playarr.Xbox/Package.appxmanifest`'s declared
`TargetPlatformVersion`/`TargetPlatformMinVersion`, and — for on-device
testing — an Xbox Developer Mode console. None of it exists in this
repository's CI or development environment today:

- **Compiling `Playarr.Xbox` at all.** It is a legacy, non-SDK-style csproj
  that the plain `dotnet` CLI cannot build; nothing in this repo has ever
  compiled it. Every `.xaml`/`.csproj`/`.appxmanifest` file was instead
  validated statically (well-formed XML via `xmllint`, manual brace-balance
  and `using`/namespace checks across every `.cs` file) — real diligence,
  but not a substitute for a compiler having seen the code.
- **Adding `Playarr.Xbox` into `Playarr.Xbox.sln` with real platform
  configurations.** The `.sln` intentionally does not wire the UWP project
  in yet; that needs Visual Studio's own "Add existing project"/reload the
  first time this opens on Windows.
- **Generating the Dev Mode signing certificate.** `Playarr.Xbox.csproj`
  points `PackageCertificateKeyFile` at a `Playarr.Xbox_TemporaryKey.pfx`
  that does not exist; Visual Studio creates it (self-signed, matching the
  `CN=Playarr Server` placeholder in `Package.appxmanifest`) the first time the
  project is built and packaged.
- **Producing an MSIX and sideloading it via Xbox Developer Mode**, or
  **submitting to the Microsoft Store.** No package has ever been built.
  `docs/store-submission.md` is explicitly preparation material: no signing
  certificate, no Partner Center account, and no Xbox device-family
  submission access exist for this project yet.
- **Any real device testing.** No physical or virtual Xbox console has run
  this app. `Services/XboxModelDetector.cs` can only confirm "some Xbox"
  (via `AnalyticsInfo.VersionInfo.DeviceFamily`) and always falls back to
  the conservative `XboxModel.Unknown` profile otherwise — telling console
  generations apart needs the Xbox-exclusive `Windows.Xbox.System`
  extension SDK, which this environment cannot target or verify against
  either.
- **Icon/tile/splash art.** `Package.appxmanifest` references
  `Assets/*.png` files that do not exist yet; the project cannot package
  until real art is added.
- **Confirming the WinRT API shapes used in the Player screen.**
  `PlayerViewModel`'s audio/subtitle track selection
  (`SingleSelectMediaTrackList`, `TimedMetadataTrackDisplayMode`) and its
  `AdaptiveMediaSource`/`Windows.Web.Http` header-attachment calls are
  written from documentation and memory of the WinRT surface, not checked
  by a live Windows SDK compiler — see the doc comments on those methods in
  `src/Playarr.Xbox/ViewModels/PlayerViewModel.cs` for the specific,
  itemised caveats.

Until one of these paths is completed on an actual Windows machine, the only
way a Playarr Server user can use Playarr on an Xbox today is the Edge-browser
fallback described in [`docs/clients/xbox.md`](../../docs/clients/xbox.md) —
served by the shared Playarr Web app, not by anything in this directory.
