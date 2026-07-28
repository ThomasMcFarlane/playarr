# Playarr for HarmonyOS NEXT

`clients/harmony/` is a native HarmonyOS NEXT client for a viewer's own
Playarr Server library, built with ArkTS and declarative ArkUI on the stage
model. It is not a WebView: every screen is a native ArkUI component tree,
and playback runs through `@kit.MediaKit`'s `AVPlayer` bound to an
`XComponent` of type `SURFACE`.

The project produces one HAP (`entry`), targeting `compatibleSdkVersion
5.0.0(12)`, with `module.json5` declaring `deviceTypes: ["phone", "tablet",
"tv", "2in1"]`. One artefact covers phones, tablets/foldables and Huawei
Vision TV: the same one-artifact strategy the Android client uses for
phones and Android TV.

## Two platform identities, one HAP

The app reports one of two identities to the Playarr Server, chosen at
runtime from `deviceInfo.deviceType` rather than at build time:

| Wire name       | Reported when                                                          |
| --------------- | ------------------------------------------------------------------------ |
| `harmony-mobile` | `deviceType` is `phone`, `tablet`, `2in1`, `default`, `wearable` or `car` |
| `harmony-tv`      | `deviceType` is `tv`                                                    |

This mirrors the Android client's `android-mobile` / `android-tv` split.
One universal package ships, but the server's playback-session analytics,
the admin Activity screen and the client-compatibility table all need to
tell a living-room session apart from a handset one: a single identity
would throw that distinction away permanently. The identity is isolated in
exactly one file, `entry/src/main/ets/core/AppConfig.ts`, and pinned there
by a contract test so it cannot drift or leak into other files.

The runtime split also picks the input profile: `tv` gets a D-pad-driven,
overscan-safe TV stage; everything else gets a touch profile with a
floating bottom nav pill. `2in1` devices and any window wider than 1280vp
also render the TV-shaped wide layout while still reporting
`harmony-mobile`.

## What is verified today, and how

This client is developed and reviewed entirely on Linux, with no
HarmonyOS device or emulator available yet. Three tiers of offline checks
exist, and it is important to be precise about where their coverage
stops:

### Tier 0: `just harmony-validate` (seconds, zero runtime dependencies)

Runs `scripts/validate.mjs`, a dependency-free Node script. It parses
every `*.json5` manifest with a hand-rolled JSON5 tokeniser, cross-checks
`app.json5` / `module.json5` / `build-profile.json5` against each other,
resolves every `$string:` / `$color:` / `$media:` / `$profile:` /
`$rawfile()` resource reference against the real resource tree, verifies
every page and route is wired into `main_pages.json` / `router_map.json`,
lexically lints every `.ets` / `.ts` file against the ArkTS language
restrictions (no `any`, no optional chaining, no destructuring, and
several dozen more), asserts the layering rules in this README's
[Source layout](#source-layout) section by grepping for forbidden imports
and stray literals, and rejects any committed secret, private key, or
RFC1918 host from the shippable tree. This is the closest offline
equivalent to the Roku client's `make validate`, and it is what CI runs on
every PR that touches this directory.

### Tier 0b: `just harmony-test` (seconds, Node + `typescript` only)

Transpiles every file under `entry/src/main/ets/core/` plus
`entry/src/test/**/*.test.ts` with `tsc` and runs the result under `node
--test`. `core/` is plain TypeScript with no ArkUI and no `@kit.*` /
`@ohos.*` imports, so it is fully testable without the Huawei SDK. This is
where the logic most likely to have a real bug actually gets exercised:
URL joining, JWT payload decoding, the RFC 8628 device-code poll back-off
(including the "polling too fast permanently ratchets the interval up"
rule), the refresh-retry cap and same-peer-only failover selection, the
three distinct error-envelope shapes, `source_offset_ms` position
arithmetic, continue-watching ordering, similar-title scoring, avatar
hashing, device-profile resolution, and every generated API endpoint
string against the checked-in contract.

### Tier 1: `just harmony-build` (minutes, Huawei SDK required, still Linux)

Compiles a real HAP: `scripts/fetch-sdk.sh` downloads the OpenHarmony
public SDK and Command Line Tools, `ohpm install --all` resolves
dependencies, `codelinter` (the official ArkTS linter: strictly stronger
than Tier 0's lexical checks) runs if present, and `hvigorw assembleHap`
performs real ArkTS type checking and produces `.abc` bytecode. This is
the definitive offline correctness gate: it catches every type error Tier
0's lexical scan cannot. It does not run a single line of the app.

### What none of the above can tell you

Everything behavioural is unverified until this runs on real hardware:
rendering, D-pad focus traversal, actual AVPlayer state transitions and
HLS/direct-play behaviour, Asset Store round-trips, backdrop blur, and
immersive/full-screen mode. No HarmonyOS emulator or previewer exists on
Linux, and no Huawei Vision TV or HarmonyOS NEXT phone has been available
to this project so far. Treat every claim in this repository about
on-device behaviour as "compiles and passes contract tests, unverified on
device" until someone runs it on hardware and updates this section.
A few specific open questions carry real behavioural risk and are worth
knowing about if you pick up a device:

- Whether `media.createMediaSourceWithUrl` actually accepts request
  headers is unconfirmed: HLS auth (`Authorization` or a
  `playarr_playback_session` cookie) depends on it. If it doesn't, HLS
  falls back to direct play only.
- Whether an fd-sourced sidecar subtitle (`addSubtitleFromFd`) can attach
  to a URL-sourced player at all is unconfirmed. If not, only in-band
  subtitle tracks work.
- Whether ArkUI's `.backdropBlur()` is usable at 1080p on Vision TV's GPU
  budget is unconfirmed. If not, the glass panels degrade to a flat,
  higher-opacity fill.
- The codec/container capability string sent to `/api/v1/playback/{id}`
  (`h264,h265` / `mp4,mkv,m3u8` / `aac,mp3,flac,vorbis,opus`) is a
  conservative guess from documented `AVPlayer` support, not a measurement
  against a real panel.

## Fetch the SDK and build a HAP on Linux

DevEco Studio is a GUI wrapped around a command-line toolchain Huawei also
publishes standalone for Linux, so a signed-or-unsigned HAP can be built
here without the IDE:

```sh
just harmony-sdk      # downloads and unpacks the OpenHarmony SDK + Command
                      # Line Tools into ~/.cache/ohos-sdk (once; cached after)
just harmony-build    # debug by default; `just harmony-build release` also
                      # produces the .app bundle
```

`harmony-sdk` requires `curl` or `wget`, `tar`, `unzip`, Node 18 and JDK 17
on `PATH`; it writes an env file consumed by every later step. `harmony-build`
runs `ohpm install`, the official `codelinter` if present, and
`hvigorw assembleHap`, then reports where the unsigned HAP was written
(`entry/build/default/outputs/default/entry-default-unsigned.hap`).

## Sideload with hdc

`hdc` ships inside the Command Line Tools fetched by `harmony-sdk`. Find a
connected device's serial, then deploy:

```sh
hdc list targets
HDC_TARGET=<serial-from-above> just harmony-deploy
```

`harmony-deploy` prefers a signed HAP if one exists (see below), otherwise
falls back to the unsigned build for devices that allow unsigned installs,
sends it over with `hdc file send`, installs with `hdc shell bm install`,
and launches `io.playarr.harmony/EntryAbility`. Tail logs with
`hdc -t <serial> shell hilog`.

`HDC_TARGET` takes a device serial, not a network address, for USB-attached
hardware. If you are pointing at a device reachable over the network
instead, treat the value the same way the Roku client's
`ROKU_DEV_TARGET` is documented: never put a real LAN address in a
committed file or example: this repository's own secret-safety check
(Tier 0, `checks/package.mjs`) rejects RFC1918 hosts on sight. Use an
RFC 5737 documentation address such as `192.0.2.10` in any example that
needs to show the shape of a device target.

## Release signing

Release signing material: the app certificate (`.cer`), the provisioning
profile (`.p7b`) and the signing keystore: comes from Huawei AppGallery
Connect, which is gated behind a Huawei developer account and enterprise
verification. **None of it is ever committed to this repository.**
`scripts/sign.sh` reads it exclusively from environment variables
(`HARMONY_SIGN_CERT_PATH`, `HARMONY_SIGN_P7B_PATH`,
`HARMONY_SIGN_KEYSTORE_PATH`, `HARMONY_SIGN_KEYSTORE_PASSWORD`,
`HARMONY_SIGN_ALIAS`), copies them into a temporary directory for the
signing tool, and deletes that copy on exit whether or not signing
succeeded. Every check in `just harmony-validate` and `just harmony-build`
runs and passes against an **unsigned** HAP; AppGallery enrolment is a
separate, non-blocking track from the rest of this client's development.

## Source layout

```text
entry/src/main/ets/
├─ core/            pure TypeScript (.ts): the offline-verifiable seam
├─ net/, auth/,      everything else: ArkTS (.ets), ArkUI, @kit.* imports
│  data/, device/,
│  design/, navigation/,
│  pages/, player/, util/
└─ entryability/
```

`core/` is the one directory held to a hard rule, enforced by the Tier 0
validator: every file is `.ts`, none of them import `@kit.*`, `@ohos.*`,
or any `.ets` file, and none of them use ArkUI decorators (`@Component`,
`@Entry`, `@State`, `build()`). Every wire DTO, every API path, every
request header, every timing/back-off policy and every design-token
literal lives here as plain data and pure functions. ArkTS explicitly
permits a `.ets` file to import a `.ts` file (only the reverse is
disallowed), so this is a legal architectural seam in the real build, not
just a testing convenience.

The split exists because of a hard constraint: nothing in this repository
can run the app on Linux, so the only logic that gets real test coverage
before a device is available is logic that does not touch the OS. The
rule of thumb applied throughout this codebase is: *if it can be got
wrong, and you cannot run the app to find out, it belongs in `core/`.*
Everything upstream of it: networking, secure storage, the design
system, navigation, pages and the player: is ArkTS/ArkUI, is exercised
only by Tier 1's type-checking build today, and is unverified behaviourally
until it runs on a device, per the section above.

Full layer-by-layer detail is enforced by `scripts/checks/contract.mjs`
and `scripts/checks/arkts.mjs`, and documented in
`docs/architecture/clients/harmony.md`.
