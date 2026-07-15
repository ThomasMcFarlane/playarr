# Versioning Policy

This document describes the **real, current** version-negotiation contract
between Streamarr and its clients — what `GET /api/system/version` actually
returns today, what the version-gate middleware actually enforces (and does
not yet enforce), and the update mechanism each client platform actually
implements in its own source tree. It is written against the code, not
against a plan: earlier drafts of this document described a more elaborate
integer `apiVersion`/`apiVersionFloor` scheme with an N-2 backward-compatibility
promise and a CI-enforced fixture matrix. None of that exists in the codebase.
What exists instead is real, wired, tested plumbing whose enforcement half is
an intentional stub — that distinction matters, and this document tries to be
explicit about it everywhere below rather than describing the stub as if it
were live.

## `GET /api/system/version`

Defined in [`backend/crates/streamarr-api/src/version.rs`](../backend/crates/streamarr-api/src/version.rs),
mounted like any other route in `api_router()` with no auth extractor — it is
genuinely unauthenticated, so a client can ask "what version are you" before
it has a session. The response body is `streamarr_model::VersionEnvelope`,
documented in [`backend/openapi/streamarr.yaml`](../backend/openapi/streamarr.yaml)
as the `VersionEnvelope`/`CompatibilityEntry` schemas. The OpenAPI file is
generated from the handler's `#[utoipa::path]` annotation and drift-checked
in CI (`openapi_spec_matches_checked_in_file`), not hand-maintained, so the
wire shape below is not going to silently drift from the spec.

The real shape, as returned by a fresh checkout today:

```json
{
  "server_version": "0.1.0",
  "api_version": "1",
  "build_sha": null,
  "compatibility": []
}
```

| Field | Meaning |
|---|---|
| `server_version` | The server's own product version string. Sourced from `[server].version` in `backend/config/client-compatibility.toml` — there is no separate versioning source for this. |
| `api_version` | A free-form **string** (not an integer), sourced from `[server].apiVersion` in the same file. Purely descriptive today: no code anywhere, backend or client, parses or compares it. It is surfaced as informational metadata only — see e.g. `bundle-manifest.ts`'s optional `apiVersion` field, whose own comment calls it "informational only today". |
| `build_sha` | `option_env!("STREAMARR_BUILD_SHA")` at build time; `null` unless that env var was set for the build. |
| `compatibility` | A `CompatibilityEntry[]`, one row per platform. **Always an empty array in the current build** — see below. |

**There is no `apiVersionFloor`, no `apiVersionDeprecated` list, and no
per-request `X-Streamarr-Api-Version` header.** `api_version` is not used in
any compatibility decision by any code in this repository today.

## The compatibility table that *should* fill `compatibility`, and doesn't yet

`backend/config/client-compatibility.toml` is the real, checked-in source of
per-platform floors — one section per `streamarr_model::ClientPlatform`
(`android-mobile`, `android-tv`, `ios`, `web`, `tv-webos`, `tv-tizen`,
`tv-vidaa`). Its schema is intentionally split in two, because Android and
everything else key off different notions of "version":

```toml
[android-mobile]
latestVersionCode = 100
minSupportedVersionCode = 80
deprecatedBelowVersionCode = 90
sunset = "2026-12-31"

[web]
latestVersion = "1.0.0"
minSupported = "0.9.0"
deprecatedBelow = "0.9.0"
sunset = "2026-12-31"
```

Android platforms (`android-mobile`, `android-tv`) gate on Android's own
monotonic `versionCode` integer; every other platform gates on a SemVer-shaped
version string. `ClientCompatibilityTable` in
[`version_gate.rs`](../backend/crates/streamarr-api/src/version_gate.rs)
parses this with an untagged `ClientEntry` enum so both shapes deserialize
correctly, and a test (`shipped_client_compatibility_toml_parses`) pins the
checked-in file against that struct so the two can't silently drift apart.

**This table is consumed today only by the version-gate middleware's config
loader — it is not projected into the `VersionEnvelope.compatibility` array
served by `GET /api/system/version`.** `backend/src/main.rs` builds the
envelope with `compatibility: Vec::new()` and says so explicitly in a
comment: the mapping from the TOML's mixed version-code/SemVer shape into the
wire's flat, all-string `CompatibilityEntry` shape hasn't been written yet,
because it's waiting on the same version-comparison logic the middleware
itself is stubbed on (see below). **Practical consequence: no client can
currently learn its own floor from a real running server.** Every client-side
evaluator described further down gets an empty list back and treats its own
platform as having no row to enforce against.

## Version-gate middleware: real plumbing, stubbed comparison

[`version_gate.rs`](../backend/crates/streamarr-api/src/version_gate.rs)
implements a genuine `tower::Layer`/`tower::Service` pair, and it is really
layered over the whole router in `build_router` (`(router.layer(version_gate), api)`
in `streamarr-api::lib.rs`) — every request really does pass through it, not
just the ones that happen to need it.

It reads two request headers, **not** an `apiVersion` header:

```http
X-Streamarr-Client-Platform: android-mobile
X-Streamarr-Client-Version: 2.4.1
```

Its `evaluate()` function is a deliberate, documented stub:

> The floor *comparison* in `evaluate` is deliberately a stub that always
> passes: Android's version-code comparison and the other platforms' SemVer
> comparison are different, non-trivial parsing problems, and shipping the
> middleware's plumbing correctly... matters more right now than the
> comparison logic itself.

Concretely: `evaluate()` reads both headers, ignores their values, and always
returns `Pass`. **No request has ever been rejected by this middleware in a
real deployment.** The `426 Upgrade Required` response path
(`upgrade_required_response`, real JSON body `{"error": "client_upgrade_required",
"minimum_version": ...}` plus an RFC 7231 `Upgrade: streamarr-client/<version>`
header) is fully implemented and unit-tested, but its only caller
(`VersionGateDecision::Reject`) is currently unreachable dead code
(`#[allow(dead_code)]`) — it is ready for the day the per-platform comparison
lands, not a path any client can hit today.

There is no `apiv` JWT claim, no N-2 backward-compatibility promise, and no
per-`apiVersion` floor anywhere in the server. (`docs/architecture/auth-modes.md`
still describes a planned `apiv` claim; that document is out of scope for
this pass, but be aware the same kind of drift exists there.)

## Real per-platform update mechanisms

Two of the headers above (`X-Streamarr-Client-Platform` /
`X-Streamarr-Client-Version`) are genuinely sent on every request by the
Android and iOS clients today; the Web/TV-web client has the plumbing to send
them (`@streamarr-tv/api-client`'s `defaultHeaders`) but no call site
currently populates them. Since the gate is a stub regardless, this has no
behavioural effect yet — it's noted here for accuracy, not as a bug report.

### Android Mobile / Android TV — `clients/android-shared/core-update/`

- **`VersionComparator`** — a small, deliberately-not-full-SemVer numeric
  comparator: splits on `.`, compares components as integers, ignores build
  metadata (`+...`) and pre-release suffixes (`-beta.1`), and treats a
  missing or non-numeric component as `0`.
- **`UpdateAvailabilityEvaluator.evaluate()`** — looks up this platform's row
  in `VersionEnvelope.compatibility` (empty today, so this always resolves to
  `UpdateSeverity.None` against a real server) and would return
  `Required(minSupportedVersion)` if below the floor,
  `Recommended(latestVersion)` if below latest but at/above the floor, else
  `None`.
- **`AppUpdateCoordinator`** — a real, non-stubbed wrapper over Play Core's
  `AppUpdateManager` (`requestAppUpdateInfo`, `startUpdateFlowForResult`,
  `requestCompleteUpdate`). This genuinely drives Google Play's **In-App
  Updates API**.
- **`resolveUpdateAction()`** — starts a real update flow only when *both*
  the server's severity *and* Play's own `updateAvailability` signal agree an
  update exists: `Required` maps to `AppUpdateType.IMMEDIATE` (blocking),
  `Recommended` maps to `AppUpdateType.FLEXIBLE` (background).

### iOS — `clients/ios/Sources/StreamarrKit/Update/`

- **`AppUpdateEvaluator.evaluate()`** — the same style of numeric comparator
  (`compareVersions`), producing `.upToDate` / `.softNudge(latestVersion:)` /
  `.blocked(minSupportedVersion:)` from a `CompatibilityEntry`. One notable
  cross-platform inconsistency: a non-numeric component sorts as `-1` here
  (strictly below any parsed `0`), whereas Android's and the TypeScript
  comparator (below) both treat it as `0` — a minor, independently-written
  discrepancy worth knowing about, not a deliberate design choice.
- This evaluator has **zero enforcement power**, and its own doc comment says
  so explicitly: Apple prohibits an iOS app from executing code outside what
  App Review approved, so there is no such thing as OTA on this platform.
  The evaluator can only choose which UI to show (none, a dismissible nudge,
  or a blocking-but-inert interstitial); real enforcement, if ever needed,
  has to happen server-side.
- **`AppStoreLookupClient`** — a secondary, **display-only** source hitting
  Apple's public iTunes Lookup API, explicitly documented as *not* the
  compatibility source of truth, and expected to be throttled to roughly
  once a day by its caller.
- Worth noting: the scaffold's fallback installed-version constant (`"0.1.0"`,
  in `InstalledAppVersion.swift`) would currently evaluate as `.blocked`
  against the checked-in `[ios] minSupported = "0.8.0"` in
  `client-compatibility.toml` — but since the live `compatibility` array is
  empty, that never actually surfaces outside unit tests against a
  hand-built fixture.

### Web — `clients/tv-web/web/`

`useAppUpdate`/`appUpdate.ts` implements **two independent, both-real**
mechanisms:

1. **OTA bundle delivery.** `/build-manifest.json` is polled every 15
   minutes plus on focus/visibility change, and compared against the
   bundle's own baked-in `__APP_VERSION__` via `isNewerBundleAvailable`. A
   versioned service worker (`web/public/sw.js`) precaches the new bundle on
   `install` but deliberately does **not** call `self.skipWaiting()`
   unconditionally — it only activates once the page posts `SKIP_WAITING`,
   either because the viewer clicked "reload now" on a dismissible toast, or
   because of mechanism 2 below. This is the one genuinely OTA-capable
   client update path in the whole system.
2. **Compatibility check.** `evaluateClientVersion()` (from
   `@streamarr-tv/domain`'s `version-check.ts`) computes a tri-state
   `"supported" | "deprecated" | "unsupported"` against
   `VersionEnvelope.compatibility`; `"unsupported"` forces an **automatic,
   non-dismissible** reload rather than merely offering one.

Since `compatibility` is always `[]` from the real server today, and since no
call site currently sets the platform/version headers for this client either,
mechanism 2 cannot currently fire against a real deployment — only mechanism
1 (the CDN-manifest OTA path) is exercisable today.

### webOS / Tizen / VIDAA fallback — `VersionBanner.tsx`

All three TV shells share the `tv-web`/`ui-tv` codebase and render the same
[`VersionBanner`](../clients/tv-web/packages/ui-tv/src/screens/VersionBanner.tsx):
a simple, non-blocking (`pointerEvents: "none"`), check-on-launch banner shown
whenever `evaluateClientVersion` returns `"deprecated"` or `"unsupported"`,
telling the viewer to update via their TV's app store. Unlike Web, there is no
forced-reload path here, because these platforms have no OTA mechanism at
all: webOS and Tizen require a full store resubmission and review cycle for
every release, including patches, and VIDAA has no native app at all (only
the optional, unsupported PWA sideload reusing the Web build). As with the
other clients, this banner currently has nothing real to react to against a
live server, since the compatibility array it reads is always empty.

## Automation: the client-compatibility bump bot

[`.github/workflows/release-client-compat-bot.yml`](../.github/workflows/release-client-compat-bot.yml)
triggers on any client release tag (`mobile-android-v*`, `tv-android-v*`,
`ios-v*`, `tv-web-v*`, `web-v*` — anything except `backend-v*`) and opens a
PR proposing a version-floor bump in `client-compatibility.toml`; it never
pushes to `main` directly. It is explicitly, self-documented, a placeholder
today: its update step does a naive regex replace written against a
`[clients.<name>].version_floor` shape that **does not match** the real
file's actual per-platform table names and fields (`[android-mobile]` /
`minSupportedVersionCode`, etc.), so in practice it currently no-ops with a
"skipping" log line rather than proposing a real change. Deciding the actual
floor-bump policy (bump on every release? only on major/minor?) is called out
in the workflow's own comments as still undecided.

There is no pinned-fixture compatibility matrix, no per-`apiVersion` frozen
request/response fixtures under `tests/compat/`, and no client-SDK
compile/run matrix test at `apiVersion`/`apiVersion - 1`/`apiVersion - 2` —
none of that exists. The only CI safety net in this area today is
`openapi_spec_matches_checked_in_file` in `streamarr-api`, and that only
checks that the checked-in OpenAPI spec still matches the live
`#[utoipa::path]` annotations — a schema-drift check on the *current* spec,
not a backward-compatibility promise across old client builds.

## What this adds up to today

No version number is enforced server-side yet. Every "you're out of date"
signal a user could see today is produced entirely client-side, by each
platform independently polling `GET /api/system/version` and comparing
locally against its own copy of the compatibility rules — and even that
can't fire against a real deployment yet, because the compatibility array the
server actually serves is always empty. What is real: the version-gate
middleware's request plumbing, the `CompatibilityEntry` wire schema, the
`client-compatibility.toml` config format, and every platform's own
evaluator/UI. What is not real yet: the TOML-to-wire-envelope mapping, the
middleware's actual floor comparison, and any backward-compatibility promise
enforced in CI. Update this document in the same change that removes any one
of these stubs, rather than letting it drift the way its previous draft did.
