# Parity testing

Which clients can be tested in which ways, and where each way runs.

> **Native parity is ON HOLD** until the owner is happy with the web client. The web client is the source of truth
> (`docs/parity/README.md`): native clients are matched to it, never the other way round. Until the hold lifts, the native
> columns below describe what is *available*, not what is being run.

Legend: ✅ available and working. ❌ not available. ⚠️ partial (see the note). ❓ unverified (not confirmed from the repo
or from the owner; do not rely on it).

Where things run: **CI** is GitHub-hosted runners only (the repository is public, so no self-hosted runners).
**hq0** is the owner's Arch Linux workstation. **MacBook** is the owner's MacBook, reached with `ssh macbook-builder`.

## Matrix

| Client | Unit / component (CI) | Fixture e2e (CI) | Desktop browser | Emulator | Simulator | Real device | Live VNC to owner | Screenshot parity vs web |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Web client (TV and mobile layouts) | ✅ vitest | ✅ Playwright, Storybook, axe [1] | ✅ [2] | ❌ n/a | ❌ n/a | ❌ n/a | ❌ | ✅ is the reference [3] |
| Admin web app (`clients/tv-web/admin`) | ⚠️ [4] | ❌ | ✅ | ❌ n/a | ❌ n/a | ❌ n/a | ❌ | ❌ |
| Android TV | ✅ [5] | ❌ | ❌ | ✅ hq0 [6] | ❌ n/a | ✅ [7] | ✅ [6] | ⚠️ manual script [8] |
| Android phone | ✅ [5] | ❌ | ❌ | ⚠️ local only [9] | ❌ n/a | ❓ unverified | ❌ | ⚠️ manual script [8] |
| Fire TV (Vega OS) | ✅ jest, typecheck | ❌ | ❌ | ❌ [10] | ❌ | ✅ [10] | ❌ | ⚠️ manual script [10] |
| iOS | ✅ [11] | ❌ | ❌ | ❌ n/a | ✅ CI [11] | ❓ unverified [12] | ❌ | ⚠️ manual CI [13] |
| tvOS (Apple TV) | ✅ [11] | ❌ | ❌ | ❌ n/a | ✅ CI and MacBook [14] | ❌ none mentioned | ✅ [14] | ⚠️ manual CI [13] |
| Roku | ⚠️ validate script [15] | ❌ | ❌ | ❌ none exists | ❌ | ✅ [15] | ❌ | ⚠️ manual script [15] |
| Xbox | ✅ dotnet test (core only) [16] | ❌ | ⚠️ Edge route [16] | ❌ | ❌ | ❓ unverified | ❌ | ❌ |
| HarmonyOS | ⚠️ validate and core tests [17] | ❌ | ❌ | ❌ none available [17] | ❌ | ❌ none | ❌ | ❌ |
| VIDAA (Hisense) | ⚠️ shared web CI [18] | ⚠️ shared web CI [18] | ⚠️ with the `?platform=tv-vidaa` flag | ❌ | ❌ | ⚠️ owner's TV, paused [18] | ❌ | ❌ |
| webOS (LG) | ⚠️ shared web CI [19] | ⚠️ shared web CI [19] | ⚠️ web client only | ❌ not set up [19] | ❌ | ❌ none | ❌ | ❌ |
| Tizen (Samsung) | ⚠️ shared web CI [20] | ⚠️ shared web CI [20] | ⚠️ web client only | ❌ not set up [20] | ❌ not set up [20] | ❌ none | ❌ | ❌ |

## Notes

1. CI jobs in `.github/workflows/ci.yml`: `tv-web-check` (vitest), `web-behaviour` (3 shards of the `nav-*-e2e` Playwright
   scripts, motion e2e and axe AAA checks against a built bundle and a fixture/mock server, via `scripts/web-behaviour.mjs`),
   `web-layout-parity` (layout pins, drawer, edge fade, keyboard e2e), `web-storybook` (Storybook build plus a render and
   accessibility smoke). All run on `ubuntu-latest`.
2. Live checks use the device test account against <https://playarr.app>. Local: `pnpm --filter @playarr-tv/web run dev`
   from `clients/tv-web`.
3. References are committed under `docs/parity/web/{tv,mobile}/{light,dark}`, produced by `scripts/parity/capture-web.mjs`.
   `scripts/parity/diff.mjs` compares any native capture with them (at most 1% of pixels may differ).
4. The admin app sits in the same pnpm workspace, so the recursive lint, typecheck and vitest in `tv-web-check` cover it.
   It has no e2e or screenshot checks of its own.
5. `android-check` runs Gradle on `ubuntu-latest` (`./gradlew` with tasks from `scripts/ci/android-scope.sh`: affected
   modules on pull requests, a full build otherwise). `android-apk` builds a signed APK on main (artifact
   `playarr-android-main-*`). Android TV and phone share one codebase (`clients/android`). Whether every Gradle task
   runs instrumented tests: ❓ unverified (JVM unit tests only, as far as the workflow shows).
6. An Android TV emulator runs on hq0: `emulator-5560`, Android TV 1080p, API 36, systemd user unit
   `playarr-android-tv-vnc`, display Xvnc `:98`. It is VNC-streamed to the owner's PC screen 2. Local only; there is no
   emulator in CI. Emulator is software-rendered, so timings are not real-device figures
   (`docs/validation/remote-emulator-run-2026-10-07.md`).
7. A real Android TV is at 192.168.1.198. It has not been used for recent runs.
8. `scripts/parity/android-tv/capture.sh` and `scripts/parity/android-mobile/capture.sh` capture over `adb` from a running
   device (sideload debug build, fixture server from `scripts/fixtures/up.sh --fresh`). Manual, not in CI.
9. A phone emulator (API 35) was used for the 2026-10-07 remote-control run, headless and local. No standing setup or CI.
10. Fire TV runs Vega OS, which is not Android, so no Android emulator applies. The real device is a Fire TV Stick 4K Select
    at 192.168.1.117:5555. It is driven with the Vega CLI plus helper scripts that live in a scratch directory and are
    **not in the repo**. In the repo: `scripts/parity/fire-tv/capture.sh` (remote-only driver, needs `FIRETV_VEGA` and
    `FIRETV_DEVICE`) and `capture-web-live.mjs`. Jest and typecheck run in CI job `firetv-check`.
11. `ios-tests.yml` (pull requests) and `simulator-tests.yml` (manual) run Xcode tests on iPhone and Apple TV simulators on
    `macos-latest`. TestFlight external group distribution covers iOS builds for real devices (see `docs/apple-testflight`).
12. No iOS real-device testing is recorded in the repo. TestFlight makes it possible; whether the owner runs it: ❓ unverified.
13. `parity-apple.yml` (Actions, Run workflow, choose `tvos` or `ios`) builds the fixture server and web client, drives the
    simulator and diffs against the web references. Manual only by owner ruling (8 October 2026), never a pull-request check.
    Local equivalents: `scripts/parity/apple/capture-ios.sh`, `capture-tvos.sh`.
14. tvOS simulator on the owner's MacBook over SSH: `~/playarr-sim`, launchd agent `app.playarr.sim-live`, app "Playarr Live
    ATV", VNC-streamed to the owner's screen 3 (`scripts/sim-vnc`). A GitHub-hosted variant exists, `tvos-live-sim.yml`
    (`macos-latest`), but it is unreliable: runners have dropped after 1 to 2 hours (memory pressure, from memory).
15. Real device: Roku Streaming Stick 4K at 192.168.1.228. Deploy with `make deploy` in `clients/roku`; capture with
    `ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<pw> node scripts/parity/roku/capture.mjs <out-dir>` (ECP on port 8060, dev
    installer screenshots; the clock is masked in the diff). `scripts/parity/roku/verify-playback.mjs` checks playback.
    `clients/roku/scripts/validate.py` is a static check; whether it runs in CI: ❓ unverified. There is no Roku emulator.
16. `xbox-check` in `ci.yml` builds and tests `Playarr.Core` only (`dotnet test`); the UWP/XAML shell is not built in CI.
    Today the usable route is the Edge browser (`docs/clients/xbox.md`). No Xbox device or emulator is recorded.
17. `harmony-check` runs `node scripts/validate.mjs` and `node tools/run-core-tests.mjs` (offline structure and logic checks).
    `clients/harmony/README.md` states there is no HarmonyOS device, emulator or previewer available.
18. VIDAA runs the hosted web client (`docs/clients/vidaa.md`), so it is covered by the web CI. The owner's real Hisense
    VIDAA TV exists; testing is paused while the owner uses it. There are no VIDAA-specific scripts in the repo.
19. webOS has an app shell at `clients/tv-web/apps/tv-webos`; CI only covers the shared packages. LG's SDK includes an
    emulator, but it is **not set up**.
20. Tizen has an app shell at `clients/tv-web/apps/tv-tizen`. Samsung's Tizen Studio TV emulator (TV Extension 9.0 or 10.0,
    needs KVM) and the TV Simulator are **not set up**. hq0 runs Arch, so the emulator would need an Ubuntu container.
    There is no Samsung TV device.

## How to run each

| What | Command or path | Runs on |
| --- | --- | --- |
| Web unit tests | `pnpm --filter @playarr-tv/web run test` (from `clients/tv-web`) | CI, local |
| Web behaviour e2e | `node scripts/web-behaviour.mjs --dist dist --shard 1/3` (from `clients/tv-web/web`, after `pnpm exec vite build`) | CI, local |
| Web layout parity | `node scripts/layout-parity.mjs --out <dir>` (same directory) | CI, local |
| Storybook smoke | `pnpm run build:storybook && node scripts/storybook-smoke.mjs` (same directory) | CI, local |
| Web parity references | `node scripts/parity/capture-web.mjs` (see `docs/parity/README.md`) | local |
| Diff native against web | `node scripts/parity/diff.mjs --ref docs/parity/web --cand <dir> --layout tv --theme dark` | local |
| Fixture server | `scripts/fixtures/up.sh --fresh` (`down.sh` to stop) | local |
| Android build and tests | `./gradlew build` in `clients/android` | CI, local |
| Android TV parity | `scripts/parity/android-tv/capture.sh <out> <light\|dark>` | hq0 emulator or real TV |
| Android phone parity | `scripts/parity/android-mobile/capture.sh` | local emulator |
| Fire TV | `npm test -- --ci` in `clients/fire-tv`; `scripts/parity/fire-tv/capture.sh` | CI; real device |
| iOS and tvOS tests | Actions > Apple Simulator tests; iOS tests on pull requests | `macos-latest` |
| Apple parity | Actions > Apple parity > Run workflow | `macos-latest` |
| tvOS live simulator | `tvos-live-sim.yml` (hosted) or the MacBook launchd agent `app.playarr.sim-live` | `macos-latest`; MacBook |
| Simulator VNC | `scripts/sim-vnc/sim_vnc.py`; tests `python3 scripts/sim-vnc/test_sim_vnc.py` | MacBook, runner |
| Roku | `make deploy` in `clients/roku`; `scripts/parity/roku/capture.mjs` | real device |
| Xbox core | `dotnet test tests/Playarr.Core.Tests/Playarr.Core.Tests.csproj` in `clients/xbox` | CI, local |
| HarmonyOS checks | `node scripts/validate.mjs`; `node tools/run-core-tests.mjs` in `clients/harmony` | CI, local |

## Gaps

- No Tizen emulator or simulator is set up, and there is no Samsung TV. Needs an Ubuntu container on hq0 with KVM.
- No webOS emulator is set up, and no LG TV is recorded.
- No Roku emulator exists. Roku testing is the real device only and there is no CI for it.
- Fire TV has no CI beyond jest and typecheck. Its device driver scripts live outside the repo.
- VIDAA has no scripts of its own and the real TV is paused.
- HarmonyOS has no device, emulator or previewer, so only offline checks run.
- Xbox CI covers the core library only; there is no shell build, device or emulator.
- Android has no emulator in CI; the Android TV emulator on hq0 is local and the real TV is untouched recently.
- No real iOS device or Apple TV is recorded.
- Native screenshot parity is manual everywhere (and on hold); none of it is a pull-request check.
- The hosted tvOS live simulator is unreliable (runner drops after 1 to 2 hours).
