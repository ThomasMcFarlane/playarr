# Parity testing

Which ways each platform lets you run a client, and which of those ways we have set up.

> **Native parity is ON HOLD** until the owner is happy with the web client. The web client is the source of truth
> (`docs/parity/README.md`): native clients are matched to it, never the other way round. Until the hold lifts, the
> "set up" markers below describe what exists, not what is being run.

The matrix lists what each **platform vendor supports or offers**, not what we do today. Our own status is the small
marker in each cell, and the "What we run today" table below it. Columns are only the ways to *run* the client. Taking
screenshots and driving input work in every run environment, so they are not columns: the tool for driving input on each
platform is named in the notes.

Legend: ✅ the vendor supports it. ❌ the vendor does not offer it (none found). ⚠️ limited (see the note). ❓ unverified
(could not be confirmed from an official source). Marker after the symbol: **set up** or **not set up** (by us).

Where things run: **CI** is GitHub-hosted runners only (the repository is public, so no self-hosted runners).
**Workstation** is the owner's Arch Linux machine. **MacBook** is the owner's MacBook, reached over SSH.

## Matrix

| Client | Desktop browser or native desktop host | Emulator | Simulator | Real device (dev mode or sideload) | Cloud device farm |
| --- | --- | --- | --- | --- | --- |
| Web client (TV and mobile layouts) | ✅ set up [1] | ❌ | ⚠️ set up (DevTools and Playwright device emulation) [1] | ✅ not set up | ❓ not set up [2] |
| Admin web app (`clients/tv-web/admin`) | ✅ set up [1] | ❌ | ⚠️ not set up [1] | ✅ not set up | ❓ not set up [2] |
| Android TV | ❌ | ✅ set up [3] | ❌ | ✅ set up (idle) [3] | ❓ not set up [2] |
| Android phone | ❌ | ✅ set up (ad hoc, no standing setup) [3] | ❌ | ✅ not set up [3] | ❓ not set up [2] |
| Fire TV, Vega OS | ❌ | ✅ not set up [4] | ❌ | ✅ set up [4] | ❓ not set up [2] |
| Fire TV, legacy Fire OS (Android based; not our target) | ❌ | ⚠️ not set up [5] | ❌ | ✅ not set up [5] | ❓ not set up [2] |
| iOS | ❌ | ❌ | ✅ set up (CI) [6] | ✅ not set up [6] | ❓ not set up [2] |
| tvOS (Apple TV) | ❌ | ❌ | ✅ set up (CI and MacBook) [6] | ✅ not set up [6] | ❓ not set up [2] |
| Roku | ❌ | ❌ | ❌ | ✅ set up [7] | ❓ not set up [2] |
| Samsung Tizen | ❌ | ✅ not set up [8] | ✅ not set up [8] | ✅ not set up [8] | ❓ not set up [2] |
| LG webOS | ❌ | ⚠️ not set up [9] | ✅ not set up [9] | ✅ not set up [9] | ❓ not set up [2] |
| Hisense VIDAA | ❌ [10] | ❌ | ❌ | ⚠️ set up (paused) [10] | ❓ not set up [2] |
| Xbox | ✅ not set up [11] | ❌ | ❌ | ✅ not set up [11] | ❓ not set up [2] |
| HarmonyOS | ❌ | ✅ not set up [12] | ⚠️ not set up (Previewer) [12] | ✅ not set up [12] | ❓ not set up [2] |

## Notes (vendor support, with official sources)

1. **Web.** Every desktop browser runs the client. Playwright device emulation sets viewport, user agent and touch to
   mimic a phone or tablet, but it is not a real mobile engine
   ([Playwright emulation](https://playwright.dev/docs/emulation)). Any real phone or TV browser also runs it. Input:
   Playwright. Admin app: same browsers, nothing admin-specific. TV web shells (Tizen, webOS, VIDAA) reuse this client.
2. **Cloud device farms.** Not researched. Marked ❓ unverified for every platform: do not rely on it.
3. **Android phone and Android TV.** The Android Emulator takes a phone or an Android TV hardware profile and system
   image ([Android TV emulator](https://developer.android.com/training/tv/start/start),
   [create and manage virtual devices](https://developer.android.com/studio/run/managing-avds)). Real devices use USB
   debugging from Developer options (same TV page). Input: `adb`
   ([adb](https://developer.android.com/tools/adb)). Ours: Android TV emulator on the workstation, API 36, 1080p, VNC to
   the owner's screen, software-rendered (`docs/validation/remote-emulator-run-2026-10-07.md`). A real Android TV exists
   but has not been used for recent runs. The phone emulator (API 35) was used for the 2026-10-07 remote-control run only.
   No emulator in CI.
4. **Fire TV on Vega OS.** Amazon's Vega SDK ships a **Vega Virtual Device** started with `vega virtual-device start`
   and run with `vega run-app`; it is a virtual device, called a simulator in some of Amazon's wording
   ([run your app](https://developer.amazon.com/docs/vega/0.24/run-apps),
   [guide to building for Fire TV on Vega OS](https://developer.amazon.com/apps-and-games/blogs/2026/07/guide-to-building-for-fire-tv-on-vega-os)).
   Its build must match the host architecture. Amazon recommends real hardware for production-ready checks. Real device:
   Developer Mode on the Fire TV, then `vega devmode login`, `vega devmode enable-device`, `vega device install-app` (same
   page). Input: the Vega CLI; on the virtual device, `inputd-cli` (full command set after `vsm developer-mode enable`).
   Ours: a Fire TV Stick 4K Select, driven by the Vega CLI plus helper scripts that live in a scratch directory and are
   **not in the repo**. We have not set up the virtual device.
5. **Legacy Fire OS.** Android based, so the Android emulator and `adb` apply. An Amazon-specific emulator image: ❓
   unverified. Our client targets Vega OS only, so this row is for reference.
6. **iOS and tvOS.** Xcode includes iPhone and Apple TV simulators; a real device needs a signing team, and Developer Mode
   on iOS ([running in Simulator or on a device](https://developer.apple.com/documentation/xcode/running-your-app-in-simulator-or-on-a-device)).
   Input: XCUITest, `xcrun simctl`. Ours: simulator tests on `macos-latest` (`ios-tests.yml`, `simulator-tests.yml`).
   TestFlight (`docs/apple-testflight`) would allow real-device iOS builds; whether the owner runs it: ❓ unverified. No
   Apple TV device recorded. tvOS live simulator on the MacBook (`app.playarr.sim-live`, VNC to screen 3); the hosted
   variant `tvos-live-sim.yml` is unreliable (runners drop after 1 to 2 hours).
7. **Roku.** No emulator or simulator; testing is on physical devices only
   ([automated channel testing](https://developer.roku.com/docs/developer-program/dev-tools/automated-channel-testing/automated-testing-overview.md)).
   Real device: Developer Mode, sideload through the developer installer. Input: ECP, or the Roku WebDriver server (needs
   Roku OS 9.1 or later, addresses the device by IP, translates to ECP). Ours: Roku Streaming Stick 4K; `make deploy` in
   `clients/roku`; ECP via `scripts/parity/roku/capture.mjs`.
8. **Samsung Tizen.** Tizen Studio's TV Extension (10.0.0 released 26 February 2026) provides the **TV Emulator**, which
   needs CPU virtualisation and at least 1024 MB RAM, and is slower than a real TV; 4K video, DRM and some Samsung APIs
   are unsupported ([TV emulator](https://developer.samsung.com/tv/develop/getting-started/using-sdk/tv-emulator),
   [release history](https://developer.samsung.com/smarttv/develop/tools/tv-extension/release-history.html)). The **TV
   Simulator** is lighter, uses a different web engine from the TV and emulator, and does not support hardware-bound APIs
   ([TV Simulator](https://developer.samsung.com/tv/develop/getting-started/using-sdk/tv-simulator)). Real TV: Developer
   Mode ([TV device](https://developer.samsung.com/tv/develop/getting-started/using-sdk/tv-device)). Debugging and input:
   Web Inspector and the virtual remote ([Web Inspector](https://developer.samsung.com/SmartTV/develop/getting-started/using-sdk/web-inspector.html)).
   Ours: app shell at `clients/tv-web/apps/tv-tizen`; nothing else. The workstation runs Arch, so the emulator would need
   an Ubuntu container with KVM. No Samsung TV.
9. **LG webOS.** The **webOS TV Emulator** (VirtualBox 6.1, at least 3 GB RAM) is deprecated and not provided for webOS
   TV 22 and later; Apple silicon unsupported ([emulator](https://webostv.developer.lge.com/develop/tools/emulator-installation)).
   The **webOS TV Simulator** runs on a PC with the TV's Chromium version, web apps only, with no DRM and different media
   behaviour ([simulator](https://webostv.developer.lge.com/develop/tools/simulator-introduction)). Real TV: Developer
   Mode app from the LG Content Store. Input and debugging: the `ares-*` CLI
   ([CLI introduction](https://webostv.developer.lge.com/develop/tools/webos-tv-cli-introduction)). Ours: app shell at
   `clients/tv-web/apps/tv-webos`; nothing else. No LG TV recorded.
10. **VIDAA.** No official emulator or simulator found. The developer portal is gated behind registration, so official
   debugging steps are ❓ unverified; VIDAA's web app guide covers remote debugging but is marked confidential
   ([WebApp development guide](https://www.vidaa.com/wp-content/uploads/2020/12/WebApp_Development_Guide_for_VIDAA.pdf)).
   Third-party guides describe sideloading a URL through the TV's browser; unofficial. Our client is the hosted web client,
   and a desktop browser with the `?platform=tv-vidaa` flag is our own stand-in, not a vendor method. The owner's Hisense TV
   exists; testing is paused while the owner uses it.
11. **Xbox.** Dev Mode turns any retail console into a development console; deploy UWP apps from Visual Studio over the
   network with a signed-in user ([activation](https://learn.microsoft.com/windows/uwp/xbox-apps/devkit-activation),
   [environment setup](https://learn.microsoft.com/en-us/windows/uwp/xbox-apps/development-environment-setup)). UWP apps
   also run on a Windows 10 or 11 desktop (stand-in). No Xbox emulator or simulator found. Windows Device Portal on Xbox:
   ❓ unverified. Ours: nothing; the UWP shell needs Windows and the UWP workload and is not built in CI
   (`clients/xbox/README.md`). The Edge browser route works today (`docs/clients/xbox.md`).
12. **HarmonyOS.** DevEco Studio provides an emulator, driven from the CLI too
   ([emulator CLI](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-emulator-command-line)), and real
   devices over USB or wireless debugging with `hdc`
   ([developer mode](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-developer-mode)). The Previewer is a
   UI preview, not a full run. Remote emulator access reportedly needs a verified Huawei account and is time-limited
   (third-party report); availability outside China: ❓ unverified. Ours: offline checks only; `clients/harmony/README.md`
   says no device, emulator or previewer is available to us.

## What we run today

| Client | In CI (GitHub-hosted) | Local or manual |
| --- | --- | --- |
| Web client | `tv-web-check` (vitest), `web-behaviour` (Playwright e2e, motion, axe AAA), `web-layout-parity`, `web-storybook` | Dev server; live checks with the device test account |
| Admin web app | Covered by the recursive lint, typecheck and vitest in `tv-web-check`; no e2e of its own | Local dev server |
| Android TV and phone | `android-check` (Gradle, JVM unit tests as far as the workflow shows), `android-apk` on main | Workstation TV emulator over VNC; `scripts/parity/android-tv/capture.sh`, `scripts/parity/android-mobile/capture.sh` |
| Fire TV (Vega) | `firetv-check` (jest, typecheck) | Real Stick 4K Select; `scripts/parity/fire-tv/capture.sh` (needs `FIRETV_VEGA`, `FIRETV_DEVICE`); helper scripts outside the repo |
| iOS and tvOS | `ios-tests.yml` on pull requests; `simulator-tests.yml` and `parity-apple.yml` manual (by owner ruling, 8 October 2026) | `scripts/parity/apple/capture-ios.sh`, `capture-tvos.sh`; MacBook tvOS live simulator |
| Roku | `clients/roku/scripts/validate.py` static check; whether it runs in CI: ❓ unverified | Real Stick 4K; `make deploy`; `scripts/parity/roku/capture.mjs`, `verify-playback.mjs` |
| Xbox | `xbox-check`: `Playarr.Core` build and tests only | Edge browser route |
| HarmonyOS | `harmony-check`: `scripts/validate.mjs`, `tools/run-core-tests.mjs` | None |
| VIDAA, webOS, Tizen | Shared web CI only | VIDAA: owner's TV, paused |

Web parity references live under `docs/parity/web/{tv,mobile}/{light,dark}`, made by `scripts/parity/capture-web.mjs`;
`scripts/parity/diff.mjs` compares native captures with them (at most 1% of pixels may differ). Native parity is manual
everywhere and none of it is a pull-request check.

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
| Android TV parity | `scripts/parity/android-tv/capture.sh <out> <light\|dark>` | workstation emulator or real TV |
| Android phone parity | `scripts/parity/android-mobile/capture.sh` | local emulator |
| Fire TV | `npm test -- --ci` in `clients/fire-tv`; `scripts/parity/fire-tv/capture.sh` | CI; real device |
| iOS and tvOS tests | Actions > Apple Simulator tests; iOS tests on pull requests | `macos-latest` |
| Apple parity | Actions > Apple parity > Run workflow | `macos-latest` |
| tvOS live simulator | `tvos-live-sim.yml` (hosted) or the MacBook launchd agent `app.playarr.sim-live` | `macos-latest`; MacBook |
| Simulator VNC | `scripts/sim-vnc/sim_vnc.py`; tests `python3 scripts/sim-vnc/test_sim_vnc.py` | MacBook, runner |
| Roku | `make deploy` in `clients/roku`; `scripts/parity/roku/capture.mjs` | real device |
| Xbox core | `dotnet test tests/Playarr.Core.Tests/Playarr.Core.Tests.csproj` in `clients/xbox` | CI, local |
| HarmonyOS checks | `node scripts/validate.mjs`; `node tools/run-core-tests.mjs` in `clients/harmony` | CI, local |

## Gaps to close

Ordered by value for mass parity testing: platforms where the vendor offers a run environment we have not set up come first.

1. **Tizen emulator and TV Simulator** (vendor offers both; one Ubuntu container with KVM on the workstation). Covers
   Samsung, the largest TV share, with no hardware.
2. **webOS TV Simulator** (vendor offers it for current TV versions; the emulator is deprecated). Covers LG with no hardware.
3. **Fire TV: move the Vega helper scripts into the repo** and try the Vega Virtual Device so Fire TV runs without the Stick.
4. **Roku: script ECP and WebDriver automation in the repo** (CI is not possible: physical device only). Confirm whether
   `validate.py` runs in CI.
5. **Android: a standing phone emulator and a CI emulator job**, so Android TV and phone run without the workstation.
6. **HarmonyOS: DevEco emulator or remote emulator**, once availability outside China is confirmed.
7. **Xbox: build the UWP shell** on a Windows machine, and run it on the desktop, then in Dev Mode on a console.
8. **Real iOS device and Apple TV** through Xcode or TestFlight, to catch what the simulators cannot.
9. **VIDAA:** ask VIDAA for developer portal access to confirm official debug steps.
10. **Cloud device farms:** research once the hold lifts.
11. Make the hosted tvOS live simulator reliable (runner drops after 1 to 2 hours).
