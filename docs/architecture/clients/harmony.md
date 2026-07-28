# Client Architecture: HarmonyOS NEXT

Playarr for HarmonyOS is a native ArkTS/ArkUI HarmonyOS NEXT application at
[`clients/harmony/`](../../../clients/harmony/) — not a WebView, and not a
packaged distribution of [`clients/tv-web/web`](../../../clients/tv-web/web/)
the way webOS, Tizen, or the VIDAA fallback are. One HAP (`entry`) covers
phone, tablet/foldable and Huawei Vision TV; the touch-vs-D-pad input profile
and the `harmony-mobile` / `harmony-tv` platform identity are both chosen at
runtime from `deviceInfo.deviceType`, never at build time, mirroring the
Android client's single-universal-APK strategy.

**Product bar** ([`../client-principles.md`](../client-principles.md)): fully
native UI and player, full product parity with complete clients, native-class
performance. Degrade only where HarmonyOS APIs or policy cannot support a
capability (document each gap; do not thin features for convenience).

## Target OS/SDK versions

- **`compatibleSdkVersion`:** `5.0.0(12)` — HarmonyOS NEXT / API 12 floor.
- **`compileSdkVersion`:** `6.1.1(24)`, from the `6.1-Release` public SDK
  tarball `scripts/fetch-sdk.sh` downloads. Building an API-12-compatible HAP
  against a newer SDK is what `compatibleSdkVersion` is for, but that
  combination is unverified without a device (see the README's risk list).
- **`deviceTypes`:** `["phone", "tablet", "tv", "2in1"]`, asserted literally
  by the offline validator (`scripts/validate.mjs`) since the whole
  responsive-layout strategy depends on exactly this set.
- **Toolchain:** `hvigor` + `ohpm` + `codelinter` + `hdc` +
  `hap-sign-tool.jar`, all fetched from Huawei's public mirrors by
  `scripts/fetch-sdk.sh` — every one of these genuinely runs on Linux, unlike
  the Xbox UWP toolchain (see `docs/architecture/clients/xbox.md`). What does
  **not** exist on this Linux workstation is a HarmonyOS emulator, previewer,
  profiler, or physical device — see "What is verified today" below.

## Tech stack

| Concern | Choice |
|---|---|
| Language | ArkTS (a restricted TypeScript dialect: no `any`, no index signatures, no optional chaining, no destructuring, and more — see `scripts/checks/arkts.mjs`) |
| UI | ArkUI, declarative, stage model |
| Build | `hvigor` / `hvigor-ohos-plugin` |
| State | `AppStorage` (device profile, theme) + small per-page view-model state |
| Routing | `Navigation` + `NavPathStack` (`navigation/`) — **not** `@ohos.router`, whose global functions are deprecated since API 18 |
| Networking | `@kit.NetworkKit`'s `http` module, wrapped once in `net/HttpTransport.ets` |
| Playback | `@kit.MediaKit`'s `AVPlayer`, bound to an `XComponent` of type `SURFACE` |
| Secrets | `@kit.AssetStoreKit` (`auth/SecretStore.ets`), never `preferences` |
| DRM | None |

## Device-profile split

`core/DeviceProfile.ts` (pure, unit-tested TypeScript) resolves
`deviceInfo.deviceType` plus the current window width/height into an
`inputMode` (`touch` | `dpad`), a `formFactor`, and the `harmony-mobile` /
`harmony-tv` wire name the rest of the session reports. `device/
DeviceProfileService.ets` reads the real HarmonyOS APIs once at ability
creation and on every window-size change, and publishes the result into
`AppStorage` for the rest of the app to read reactively. The identity itself
is resolved exactly once at boot and held for the session's lifetime — it
must never change mid-session, since it stamps every playback session.

TV metrics are expressed as ratios of a fixed 1920×1080 design space
(`design/Metrics.ets`'s `tv(n)` helper multiplies by `windowWidthVp / 1920`)
rather than a nested scale transform, so a 4K panel reporting a different `vp`
width does not blur text.

## What is verified today, and how

There is no HarmonyOS device or emulator available in this environment, so
correctness rests on three offline tiers instead of a compiler having
actually run the app:

- **Tier 0 — `just harmony-validate`** (seconds, zero dependencies): manifest
  cross-checks, resource-reference resolution, ArkTS restriction linting, and
  the layering/contract rules below, all via a hand-rolled JSON5 tokeniser
  and lexical scanner — no HarmonyOS SDK involved.
- **Tier 0b — `just harmony-test`** (seconds, Node + `typescript`): the
  entire `core/` layer (endpoints, headers, auth policies, error decoding,
  device-profile resolution, design tokens) is plain, ArkUI-free TypeScript,
  compiled and unit-tested with plain `tsc` + `node --test`. This is where
  the logic most likely to hide a real bug — RFC 8628 poll back-off, refresh
  retry/failover, `source_offset_ms` arithmetic — actually gets exercised.
- **Tier 1 — `just harmony-sdk` / `just harmony-build`** (minutes, real SDK,
  still Linux): a genuine `hvigor assembleHap` with `execution.typeCheck:
  true`, so real ArkTS type errors fail the build. This produces a real
  `.hap`; it is the strongest offline gate available, but it still cannot
  exercise rendering, focus traversal, D-pad input, or actual playback.

`clients/harmony/README.md` is the canonical, more detailed account of this
split, including the specific behavioural gaps (backdrop blur under TV GPU
budgets, `AVPlayer`'s per-request-header API on an HLS `MediaSource`,
`addSubtitleFromFd` combined with a `url`-sourced player) that only a
physical device can close.

## Architectural seam: `core/` vs everything else

`entry/src/main/ets/core/` is deliberately plain TypeScript — no ArkUI, no
`@kit.*`/`@ohos.*` imports, no decorators — enforced by the offline
validator. Every other layer (`net/`, `auth/`, `device/`, `design/`,
`navigation/`, `data/`, `player/`, `pages/`) is ArkTS/ArkUI and exercised only
by Tier 1's type-checked compile, never by a device-independent test. The
same validator also pins a handful of architectural rules: the literal
`"/api/"` path prefix may only appear in `core/Endpoints.ts`; the two
`X-Playarr-Client-*` header names may only appear in `core/Headers.ts`; the
`harmony-mobile`/`harmony-tv` wire names may only appear in
`core/AppConfig.ts` (and, as a documented exception, `core/DeviceProfile.ts`,
the pure resolver both `AppConfig.ts` and its unit tests call into); and
`pages/*.ets` may never import `net/` or `auth/` directly, only `data/`
repositories.
