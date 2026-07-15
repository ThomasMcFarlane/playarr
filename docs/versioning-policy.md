# Versioning Policy

Streamarr and every Playarr client are versioned by **two deliberately
decoupled numbers**. Conflating them — as many projects do by treating a
SemVer bump as automatically meaning "the API changed" — breaks down the
moment you have seven clients on wildly different update cadences and three
platforms (webOS, Tizen, and iOS) that cannot self-update at all. This
document is the full compatibility contract: what the two numbers mean, how
a client discovers them, how the server enforces them, how each platform
actually gets updated, and how the promise that old clients keep working is
enforced in CI rather than left as a hope.

## The two version numbers

- **Release version (SemVer)** — e.g. `2.4.1`. Human-facing: what's in the
  changelog, what a store listing shows, what a git tag matches. Bumped on
  every release, following normal SemVer semantics for the *product* (major
  for breaking user-facing behaviour, minor for features, patch for fixes).
  It is **not** a reliable signal for whether the wire contract changed —
  a patch release can ship with no API change at all, and a minor release
  might.
- **`apiVersion`** — a single incrementing non-negative integer, e.g. `17`.
  Bumped **only** when the HTTP API's wire contract changes in a way that
  matters to a client: a new required field, a changed response shape, a
  removed endpoint, a changed auth flow. Many SemVer releases in a row can
  share the same `apiVersion` if none of them touch the wire contract; a
  single SemVer release can bump `apiVersion` exactly once even if it
  contains several contract changes, since they all ship together and a
  client either speaks the new contract or it doesn't — there's no
  meaningful in-between state to version separately.

`apiVersion` is the number every enforcement decision in this document is
made against. SemVer is what humans read; `apiVersion` is what the
middleware checks.

## The `system-version` endpoint

Every Streamarr server exposes its version information, unauthenticated,
at:

```http
GET /api/system/version
```

```json
{
  "release": "2.4.1",
  "apiVersion": 17,
  "apiVersionFloor": 15,
  "apiVersionDeprecated": [15, 16],
  "buildCommit": "a1b2c3d4e5f6",
  "buildDate": "2026-06-30T00:00:00Z",
  "tier": "kubernetes"
}
```

Field meanings:

| Field | Meaning |
|---|---|
| `release` | This server's SemVer release version. |
| `apiVersion` | The current, latest `apiVersion` this server speaks. |
| `apiVersionFloor` | The minimum `apiVersion` this server will still accept requests from. Requests below this are rejected — see enforcement below. Enforced as `apiVersion - 2` (the N-2 promise, below). |
| `apiVersionDeprecated` | The `apiVersion` values that still work but are past their recommended-fresh window and will emit deprecation warnings — always `[apiVersionFloor, apiVersion - 1]` inclusive of the floor itself, since a version at the floor is, by definition, on borrowed time. |
| `buildCommit` / `buildDate` | Diagnostic/support metadata, not used in any compatibility decision. |
| `tier` | Which deployment tier this server is running as (`systemd`, `docker-compose`, or `kubernetes`) — informational, surfaced in client diagnostics/support screens. |

Every client fetches this endpoint before or alongside authentication (it
requires no auth, deliberately, so a client can show a useful
"incompatible server" or "update required" message even before login
succeeds) and caches it for the session.

## Enforcement middleware behaviour

Every authenticated (and most unauthenticated) API request carries the
client's `apiVersion`, sent as a request header:

```http
X-Streamarr-Api-Version: 16
```

(Authenticated requests additionally carry the `apiv` claim inside the
access-token JWT, per [`architecture/auth-modes.md`](architecture/auth-modes.md);
the middleware trusts the explicit header over the JWT claim when both are
present, since a client might legitimately be running a newer build than
the token it was issued under, e.g. immediately after a hot-reload/OTA
update on the Web client.)

`streamarr-api`'s versioning middleware, run before route handling, applies
this logic on every request:

1. **No header present at all** → treated as `apiVersion = 0` (a
   pre-versioning legacy client, or a caller sending raw HTTP without going
   through a real client). Once `apiVersionFloor > 0` — true for any server
   that has ever shipped a single breaking contract change — this always
   falls into case 2 below.
2. **`apiVersion < apiVersionFloor`** → the request is rejected outright
   with **`426 Upgrade Required`**:

   ```http
   HTTP/1.1 426 Upgrade Required
   Content-Type: application/json

   {
     "error": "api_version_too_old",
     "message": "This client's API version (12) is no longer supported. The server requires at least 15.",
     "apiVersionFloor": 15,
     "apiVersionCurrent": 17
   }
   ```

   No downstream handler runs; the client is expected to show a hard
   update-required screen, using the per-platform mechanism in the table
   below.
3. **`apiVersionFloor <= apiVersion < apiVersion` (current)** → the request
   is processed **normally**, but the response carries deprecation
   signalling headers so the client can proactively nudge the user before
   they hit the hard floor:

   ```http
   Deprecation: true
   Sunset: 2026-10-01T00:00:00Z
   X-Streamarr-Api-Version-Current: 17
   ```

   `Sunset` is computed from the server's configured deprecation window
   (default 90 days from when a given `apiVersion` was superseded) and
   updated as the server's own `apiVersion` advances further — it is a
   moving estimate of when that client's version will cross the
   N-2 floor, not a fixed date set once.
4. **`apiVersion == apiVersion` (current)** → normal processing, no extra
   headers. This is the steady-state case for an up-to-date client.

The middleware is written once in `streamarr-api` and applied to every
route uniformly (including the unauthenticated `system-version` endpoint
itself is exempt, by necessity — a client has to be able to ask "what
version are you" without already speaking a compatible `apiVersion`).

## Per-platform update mechanism

Whether a `426`/deprecation signal actually reaches the user as "please
update" depends entirely on what update mechanism that platform supports —
this is the concrete reason the two-number scheme and the enforcement
window exist at all, since some platforms genuinely cannot update on
demand. Full detail lives in each client's own architecture doc; this table
is the cross-platform summary:

| Platform | Update mechanism | OTA? | Notes |
|---|---|---|---|
| Android Mobile / Android TV | Google Play **In-App Updates API** | No code-level OTA, but in-app-triggered store update | **Flexible** mode (background download, user-chosen install) for the deprecation window; escalates to **Immediate** mode (blocking full-screen update flow) once `apiVersion` is at or below the floor. See [`architecture/clients/android-mobile.md`](architecture/clients/android-mobile.md). |
| iOS | Client polls the **App Store Lookup API**, shows an in-app interstitial | **No OTA whatsoever** — Apple prohibits it | Soft, dismissible interstitial during the deprecation window; hard, undismissible interstitial once below the floor. Always deep-links to the App Store listing, since that's the only place an update can be obtained. See [`architecture/clients/ios.md`](architecture/clients/ios.md). |
| Web | Versioned service worker + CDN-hosted build manifest | **Yes, full OTA** | New deploys publish a new manifest entry; the service worker detects it and prompts (or, once below the floor, forces) a reload to activate the new bundle. See [`architecture/clients/web.md`](architecture/clients/web.md). |
| VIDAA | Same mechanism as Web, **only** on the optional unsupported PWA sideload path | Best-effort OTA, unsupported | Not applicable to the (nonexistent) native VIDAA app — there isn't one. Relying on this as an update channel carries a standing obligation to re-verify VIDAA's ToS every release; see [`architecture/clients/vidaa.md`](architecture/clients/vidaa.md). |
| webOS | Full **LG Content Store** resubmission | **No OTA loophole** | Every release, including patches, requires a new `.ipk` and a full LG review cycle. See [`architecture/clients/webos.md`](architecture/clients/webos.md). |
| Tizen | Full **Samsung Seller Office** resubmission | **No OTA loophole** | Every release, including patches, requires a new signed `.wgt` and a full Samsung certification cycle. See [`architecture/clients/tizen.md`](architecture/clients/tizen.md). |

The `apiVersionFloor`/deprecation-window sizing (default 90 days,
configurable per deployment) is chosen with the **slowest** row in this
table in mind — a store-resubmission-only platform (webOS, Tizen) or a
review-gated platform (iOS) needs enough runway between "your version is
now deprecated" and "your version is now rejected" to realistically get a
new build through review and adopted by users, not just enough runway for
an OTA-capable platform like Web to patch itself.

## The N-2 backward-compatibility promise

**The server supports the current `apiVersion` and the two immediately
preceding it (`apiVersionFloor = apiVersion - 2`).** A client that hasn't
been updated across up to two consecutive contract-breaking release cycles
still works — reads, writes, playback, auth, everything — against a
current server, receiving deprecation headers as a warning rather than
failures. Only a client more than two contract-breaking changes behind gets
rejected with `426`.

This number is chosen deliberately, not arbitrarily: two is enough slack to
absorb the realistic worst case in the platform table above — an iOS or
webOS/Tizen release stuck in review, or a user who simply hasn't updated —
across a couple of server-side contract changes, without Streamarr having
to indefinitely support every `apiVersion` it has ever shipped, which would
make the server codebase's request-handling logic accumulate unbounded
branching for old contract shapes forever.

### Enforcement in CI

The N-2 promise is treated as a tested guarantee, not a policy statement
trusted to hold by convention:

- **Pinned contract fixtures.** Every time `apiVersion` is bumped, the
  outgoing (about-to-be-superseded) request/response fixtures are frozen
  and checked in under
  `tests/compat/apiVersion-<N>/*.json` — real recorded request bodies and
  their expected response shapes for that `apiVersion`. These fixtures are
  never edited after being frozen; a schema change that would alter them
  is exactly the kind of change that should have bumped `apiVersion`
  instead.
- **Compatibility matrix job.** CI runs every currently-in-window fixture
  set (`apiVersion` through `apiVersion - 2`, i.e. whatever the live
  `apiVersionFloor` currently is) against the **current** server build on
  every PR. A PR that breaks any fixture inside the N-2 window fails CI
  outright; a PR that breaks a fixture *older* than the window is expected
  (that's exactly what falling out of the window means) and the job drops
  that fixture set from the matrix as part of the same change that
  advances `apiVersionFloor`.
- **Explicit floor-bump commits.** `apiVersionFloor` is a value checked
  into `crates/streamarr-api/src/version.rs`, not derived automatically
  from `apiVersion - 2` at build time. Advancing it is always its own
  reviewed commit with a changelog entry, so "the floor moved and a
  platform fell out of support" is always a deliberate, visible, reviewable
  decision rather than something that happens silently as a side effect of
  an unrelated `apiVersion` bump three releases later.
- **Client-SDK matrix tests.** The generated client SDKs (Kotlin, Swift,
  TypeScript — see
  [`architecture/overview.md`](architecture/overview.md#why-this-is-a-monorepo))
  are versioned per `apiVersion` alongside the server fixtures. CI compiles
  and runs each client SDK's integration test suite at `apiVersion`,
  `apiVersion - 1`, and `apiVersion - 2` against the current server build,
  catching compile- or runtime-level breakage in generated client code
  within the promised window, not just raw JSON shape drift.

A change that would require moving `apiVersionFloor` forward by more than
one step in a single PR, or that breaks a fixture inside the current
window without an accompanying floor-bump commit, is treated as a CI
failure requiring either a design change or an explicit, reviewed decision
to shorten the compatibility window for that release — never a silent
merge.
