# Roadmap

This document was originally written as a forward-looking plan: seven waves
in a dependency graph, describing work not yet started. It is no longer
that. Wave 1 and the bulk of Waves 2–7 are now built and in the tree — this
is a rewrite of the same document as a **status report**, organised by the
same wave/workstream structure so it still doubles as an index of what each
workstream produced and where to find it. The wave numbering is kept for
that indexing value, not because there's a remaining plan to sequence.

Each item below is marked:

- **Built** — real, working code exists for this, doing substantially what
  the item describes (paths given so you can go read it).
- **Partial** — real code exists, but a meaningful piece of the original
  scope is missing, stubbed, or diverged in shape.
- **Deferred** — nothing built yet, with the reason it was deliberately left
  out rather than attempted and abandoned.

The original **Agent-dispatchable** / **Continuous single-owner** tags are
kept where a workstream is still open (Partial/Deferred items, and the
"next-highest-value work" section) since that tagging is still how new work
on this codebase should be scoped and handed out.

## Wave 1 — Foundations

- **Crate skeleton and the single-role-gated binary.** **Built**, under
  different names than originally sketched: there is no `playarr-core`
  crate or `RoleSet` bitflag. Domain types live in `playarr-model`
  (`Work`, `User`, `Session`, `Device`, `MediaFile`, `Rendition`, ...);
  role-gating is `playarr-config::Role` (`All` / `Api` / `Worker`, read
  from `PLAYARR_ROLE`) plus `DeploymentTier`; the single binary is
  `playarr-bin` (package name), producing the `playarr` binary from
  `backend/src/main.rs`, a real `clap` CLI with subcommands. Functionally
  equivalent to the planned design (one binary, gated by role at startup),
  just simpler than a bitflag.
- **The dual-backend storage engine.** **Built.** `playarr-db` genuinely
  supports both SQLite and Postgres via `sqlx`, auto-detecting the backend
  from the connection URL scheme (`Backend::from_database_url`), with
  separate embedded migration sets under `backend/migrations/sqlite/` and
  `backend/migrations/postgres/` (currently 5 and 8 migrations
  respectively — Postgres has extra migrations for cluster-leader and cache
  tables that SQLite's single-node deployments don't need). Real
  `WorkRepo`, `DeviceRepo`, `RenditionRepo`, and `MediaFileRepo` traits with
  Sqlx-backed implementations, per [ADR 0001](architecture/adr/0001-storage-engine.md).
- **The OpenAPI spec.** **Built**, and further along than "skeleton": it
  is not hand-maintained at all. `backend/openapi/playarr.yaml` is
  generated from `#[utoipa::path]` annotations on every real handler
  (`playarr-api::openapi_spec()`), with a checked-in drift test
  (`openapi_spec_matches_checked_in_file`) that fails CI if the file and the
  live route annotations disagree. Every route in the section below is
  real and reflected in this spec — there's no separate "planned" spec to
  reconcile against.

## Wave 2 — Platform Services

- **Auth engine.** **Built** for the mechanism, **Partial/Deferred** for
  persistence. `playarr-auth` has real JWT access-token issuance and
  verification, real refresh-token rotation, and a real RFC 8628 device
  flow (`DeviceFlowHandler`, `DashMapDeviceFlowHandler`). All three trust
  tiers from `docs/architecture/auth-modes.md` exist as `AuthMode`
  variants (`TrustedNetwork`, `ManagedProfiles`, `FullAccount`) with real
  login-resolution logic, and a real `PolicyEvaluator`/`DefaultPolicyEvaluator`
  for authorization decisions. Bearer-token enforcement is real and wired
  into every route that needs it: `playarr-api::auth_extractor`'s
  `AuthUser`/`AdminUser` are genuine Axum `FromRequestParts` extractors
  that reject a missing/invalid/expired token with a real 401 (and a
  non-admin token with a real 403) before the handler body runs — see e.g.
  the Web admin's source-instance management screen
  (`clients/tv-web/web/src/pages/Admin.tsx`) exercising exactly this path.
  **Deferred: no persisted `UserRepo`/`PolicyRepo`.** `UserDirectory` and
  the admin registry are both real trait boundaries, but their only
  implementations today are `InMemoryUserDirectory`/`InMemoryAdminRegistry`
  — there is no Sqlx-backed user or policy table, so accounts and
  permissions don't survive a restart. **Deferred: `FullAccount` login has
  no provisioning story.** The login-time verification path for
  `AuthMode::FullAccount` is real, but nothing in the API creates a user —
  there's no register/signup endpoint anywhere in `playarr-api`; a
  comment in `login.rs` explicitly scopes user provisioning as
  "out-of-scope" for that module. Both are deferred because they need a
  real persistence/admin-tooling design decision, not because they're hard.
- **`ClusterCoordinator`.** **Built** for the two shipped implementations,
  **Deferred** for gossip. `playarr-coordination` (not `playarr-cluster`)
  has a real `ClusterCoordinator` trait with two real implementations:
  `SingleNodeCoordinator` (correct-by-construction, no contention) and
  `PostgresCoordinator` (genuine `pg_try_advisory_lock`/`pg_advisory_unlock`
  mutual exclusion plus a `cluster_leader` heartbeat table for leader
  election, per `backend/migrations/postgres/0003_cluster_leader.sql`).
  **Deferred:** gossip-based membership as an opt-in additive layer was
  never started — there is no gossip code anywhere in the workspace. Not
  needed yet: nothing currently deployed exceeds a Postgres-coordinated
  cluster's needs.
- **arr-ecosystem adapters.** **Built**, and broader than planned:
  `playarr-arr-client` (not `playarr-arr`) has one real adapter each
  for Sonarr, Radarr, Prowlarr, Bazarr, **and** Lidarr and Readarr (music
  and books, beyond the original four-adapter scope), all over a shared
  `http.rs` client.
- **Metadata scanning.** **Built, but architecturally different from the
  plan.** There is no standalone `playarr-metadata` crate doing its own
  independent library scanning/artwork fetch. Instead, `playarr-arr-sync`
  polls and receives webhooks from the wrapped *arr apps
  (`poller.rs`/`webhook.rs`) and reconciles their already-scanned metadata
  into `playarr-model::Work`/`MediaFile` rows (`media_sync.rs`), while
  `playarr-catalog` serves the read-side browse/search/detail API on top.
  This is a deliberate, reasonable shape for a server that wraps Sonarr/
  Radarr/etc. rather than replacing them — those apps already do metadata
  scanning, so Playarr Server consumes their output instead of duplicating it.
  One real gap versus even this narrower scope: artwork (`ImageAsset`) is
  stored as a URL reference passed through from the source app, with no
  server-side fetch/cache/proxy pipeline of its own.

## Wave 3 — Media Pipeline

- **On-demand transcode session manager.** **Partial.** `playarr-transcode`
  has a real `TranscodeOrchestrator` implementing the planned three-step
  decision order (direct-play → existing rendition → spawn on-demand
  transcode), real ffmpeg HLS argument construction
  (`build_ffmpeg_hls_args`), and session state in whatever
  `playarr-cache::CacheAndPubSub` backend is configured (in-memory or
  Redis). **Deferred: DRM license endpoints (Widevine, FairPlay, PlayReady)
  do not exist** — there is no license-serving code anywhere in the
  transcode crate or the OpenAPI spec, despite being named explicitly in
  the original plan. **Deferred: session-to-node affinity routing** for
  multi-node deployments also isn't built — `TranscodeSession` state is
  stored, but nothing routes a follow-up request for an in-progress session
  back to the node running it. Both are deferred because they only matter
  once a real multi-node/DRM-required deployment exists to drive the
  design, and neither has one yet.
- **Background transcode dispatch.** **Built.** A real `TdarrDispatcher`
  (in `playarr-transcode`) hands work off through `playarr-tdarr-client`,
  a genuine typed client for Tdarr's REST v2 API (`x-api-key` auth, node/
  worker-capacity queries, file-scan requests). **Deferred:** checkpointed
  progress tracking across dispatcher restarts, mentioned in the original
  plan, isn't implemented — a restart currently loses in-flight job
  progress rather than resuming it.

## Wave 4 — Deployment Infra

All three tiers are **Built** as real, checked-in files (not just
scaffolding), with paths shifted from the original plan's `infra/`
sketch to what's actually there:

- **systemd tier.** `infra/systemd/playarr.service`, `install.sh`,
  `playarr.env.example`, and an update-check timer/service pair
  (`playarr-update-check.timer`/`.service`) — the opt-in update timer
  from the plan is real.
- **docker-compose tier.** `infra/docker/docker-compose.{dev,prod,ci,mock}.yml`
  plus `docker-compose.watchtower.optional.yml` for the opt-in
  auto-update overlay, and a real `backend.Dockerfile`.
- **Kubernetes tier.** `infra/kubernetes/` has both a real Helm chart
  (`helm/playarr/Chart.yaml`+`values.yaml`) and a plain Kustomize
  `base/`+`overlays/{dev,staging,prod}` set, plus an example Flux
  image-automation manifest — narrower than the plan's implied full
  `deploy/gitops/` tree (one example file, not a maintained GitOps
  directory), but the base/overlay/chart structure itself is real.

**Deferred (explicitly, not a gap in this pass): no live docker-compose
end-to-end proof.** All three tiers' files exist and are internally
consistent, but nothing in this environment has actually run
`docker compose up` against them to confirm a real boot — that requires
starting real services, which this pass deliberately did not do. Treat the
compose/Helm/systemd files as "should work, unverified end-to-end" until
someone runs them for real.

## Wave 5 — Client Foundations

- **Web client / TV shell.** **Built**, as one merged monorepo rather than
  the originally separate `clients/tv-shell/`/`clients/web/`:
  `clients/tv-web/` has a standalone web app (`web/`), three TV app shells
  under `apps/` (see Wave 6), and shared packages for domain logic
  (`domain`), the TV UI kit (`ui-tv`), a real generated API client
  (`api-client`, see below), design tokens, device-auth, spatial navigation,
  and two player adapters (`player-shaka`, `player-avplay`).
- **Client SDK codegen.** **Partial**, and this is a real, worth-knowing
  divergence: only the **TypeScript** client is actually generated and
  committed as generated output — `clients/tv-web/packages/api-client`'s
  `pnpm run generate` runs `openapi-typescript` against
  `backend/openapi/playarr.yaml` for real, and `src/generated/schema.ts`
  is that real generated file. **Kotlin and Swift codegen are configured
  but never executed**: `clients/shared/sdk-codegen/{kotlin,swift}-config.yaml`
  and `scripts/gen-sdk.sh` are real `openapi-generator` configs pointing at
  output directories (`clients/android/sdk`,
  `clients/ios/PlayarrSDK`) that don't exist in the tree. Android and iOS
  instead ship **hand-written mirrors** of the OpenAPI schemas
  (`PlayarrHttpClient.kt`'s models, `OpenAPISchemas.swift`), written by
  reading the spec directly — a deliberate choice documented in
  `OpenAPISchemas.swift`'s own comment (the generic Swift5 generator
  doesn't produce correct `Codable` conformances for several `oneOf`
  schemas), not an oversight. Regenerating for real is still available any
  time via `scripts/gen-sdk.sh`.
- **Android.** **Built (phones, tablets, and television native).**
  `clients/android/` is one Gradle project spanning phones, tablets, Android
  TV, and Google TV with one APK. All form factors use native Compose + Media3.
  WebView shells of Playarr Web and SPA AE "parity" freezes are forbidden
  (`clients/android/AGENTS.md`).
- **iOS.** **Built.** `clients/ios/Playarr Server.xcodeproj` produces a native
  `Playarr.app`, links the reusable `PlayarrKit` package, includes App Store
  bundle/privacy/icon resources, and defines application and kit XCTest
  targets. Its native SwiftUI shell mirrors Playarr Web's responsive navigation,
  login, home rails, libraries, search, playlists, profiles, details, settings,
  and playback without embedding a WebView. The complete application build and
  all eleven unit tests pass on an iPhone 17 Pro simulator running iOS 26.5, with
  the wider layout render-checked on iPad Air 11-inch. **Deferred: distribution and device
  validation** — a signing identity, physical device, signed archive and App
  Store submission remain external release steps rather than unfinished
  application logic.

## Wave 6 — TV Clients

- **Android TV.** **Built (native).** The universal `clients/android/` project
  exposes a Leanback launcher and signed-in television uses the same native
  Compose + Media3 graph as mobile with TV adaptations. WebView shells are not
  the product path.
- **webOS.** **Built.** `clients/tv-web/apps/tv-webos/` packages the full
  Playarr Web page tree with hash routing, LG lifecycle handling, conservative
  playback negotiation, and `player-shaka`.
- **Tizen.** **Built.** `clients/tv-web/apps/tv-tizen/` packages that same
  complete page tree with Samsung remote/lifecycle handling and the native
  `player-avplay` adapter.
- **VIDAA hosted Web App.** **Browser client and experimental launcher gateway
  built; deployment and hardware validation pending.** The hosted Playarr Web client persists a `tv-vidaa` identity
  and negotiates a conservative television playback profile. Users can open it
  directly in the TV Browser. The source-IP-gated DNS portal can install a fixed
  launcher on compatible firmware, while official distribution still requires
  VIDAA partner or device-specific developer access. The older
  `apps/tv-vidaa-fallback/` PWA remains an experimental prototype.

Packaged webOS/Tizen builds use Playarr Web's compatibility check but skip its
service-worker OTA path; an unsupported package shows a persistent reinstall
notice instead of reloading the same immutable bundle. Hosted VIDAA uses the
normal Web update flow described in [`versioning-policy.md`](versioning-policy.md).

- **Chromecast.** **Partial.** A real sender/receiver pair, not a stub.
  `clients/tv-web/apps/cast-receiver/` is a CAF (Cast Application Framework)
  custom web receiver: full LOAD/PRELOAD/SEEK interception, delegated
  device-auth (a receiver-scoped identity minted via the existing RFC 8628
  device-flow, self-approved by the sender, never the sender's own token;
  see [`docs/architecture/clients/cast.md`](architecture/clients/cast.md)),
  progress heartbeats, and subtitle/artwork sideloading; it builds,
  typechecks, and passes 82/82 unit tests, and is genuinely hosted at
  `playarr.app/cast/` (`clients/tv-web/web/worker.js`'s `/cast` routes, 30/30
  hosting tests passing). The shared `@playarr-tv/cast-protocol` package
  (18/18 tests) defines one wire protocol mirrored by hand into Kotlin and
  Swift. The Web sender (`clients/tv-web/web/`) adds a Cast button, session
  management, and the delegated-auth flow, covered by 326 passing web tests.
  The Android sender (`clients/android/`) adds the same on phone/tablet only
  (hidden on TV, since a television casting to another Cast device isn't
  meaningful), verified by compiling, 15/15 Cast-specific unit tests, and a
  real R8-shrunk release build. The backend gained a first-class `cast`
  `ClientPlatform`, the delegated device-auth endpoints, the
  `playback_session_id` HLS capability-query fallback the receiver needs, and
  a real CORS fix (`CorsLayer::permissive()`'s wildcarded
  `Access-Control-Allow-Headers` silently excludes `Authorization` per the
  Fetch spec: every cross-origin Bearer-authenticated caller, not just Cast,
  was affected), all covered by the backend suite. **What's missing:** the
  iOS sender (`clients/ios/Sources/PlayarrApp/Cast/`) is written to the
  same protocol but has never been compiled: no macOS/Xcode toolchain
  exists in this environment, and the Google Cast iOS SDK has no SPM
  distribution to vendor automatically. No Google Cast Developer Console app
  has ever been registered, so every sender's App ID is an inert placeholder
  and nothing here has been exercised against a real Chromecast device. Also
  out of scope for this pass: DRM, Cast Connect/Android TV receiver, ad
  breaks, queueing beyond simple up-next, and casting a local on-device
  download. Full picture in
  [`docs/architecture/clients/cast.md`](architecture/clients/cast.md).
- **Xbox.** **Partial.** `clients/xbox/` splits a portable core
  (`Playarr.Core`, netstandard2.0, no `Windows.*` reference) from a native
  UWP/XAML application head (`Playarr.Xbox`). The portable core is real and
  tested — it builds and its full xUnit suite passes on Linux (`dotnet build
  src/Playarr.Core/Playarr.Core.csproj`, `dotnet test
  tests/Playarr.Core.Tests/Playarr.Core.Tests.csproj`, 36/36 passing) — and
  includes a real RFC 8628 device-flow client, session/model layer, and a
  per-console `XboxPlaybackProfile` capability matrix (H.264 1080p60
  everywhere, HEVC up to 2160p60 on everything but the original Xbox One,
  VP9 limited to One X/Series S/Series X, no AV1 on any console). The UWP
  head has eight real screens (Login, Profiles, Home, Library, Search,
  WorkDetail, Player, Settings), a `NavigationService`/`ObservableObject`
  pattern, and a native `MediaPlayerElement`/`AdaptiveMediaSource` playback
  path negotiating direct-play vs. on-demand-HLS — but **none of it has ever
  been compiled**: there is no MSBuild, Windows 10 SDK, or UWP workload in
  this environment or in this repo's CI, so every file was instead validated
  statically (`xmllint`, manual brace-balance and `using`/namespace checks).
  **Deferred/open gaps:** direct-mode playback sends no `Authorization`
  header (a real correctness gap once a server enforces bearer auth on that
  route); audio/subtitle track selection assumes an unverified WinRT API
  shape; `XboxModelDetector` can only confirm "some Xbox," never which
  model; no MSIX has been built or signed; no Microsoft Store submission has
  happened (prep material only, `clients/xbox/docs/store-submission.md`);
  no icon/tile/splash art exists. The one thing that works today: the shared
  Playarr Web app now detects Xbox's built-in Edge/Chromium browser via
  user-agent sniff and serves it a narrower playback profile (no MKV, HEVC,
  or AV1) than the native client's, giving Xbox owners a zero-install
  fallback while the native app has no installable package yet — see
  [`docs/architecture/clients/xbox.md`](architecture/clients/xbox.md).

## Wave 7 — Hardening and Versioning Rollout

- **Versioning enforcement middleware + CI compatibility matrix.**
  **Partial**, and substantially narrower than originally planned — see
  [`versioning-policy.md`](versioning-policy.md) for the full detail. In
  short: the `version_gate` middleware is real Tower plumbing genuinely
  layered over the whole router, and `GET /api/system/version` is real and
  unauthenticated, but the middleware's actual floor comparison is a
  documented stub that always passes (no request has ever been rejected),
  and the endpoint's `compatibility` array is currently always empty (the
  TOML-to-wire mapping hasn't been written). **There is no pinned-fixture
  CI compatibility matrix, no N-2 promise, and no per-`apiVersion`
  enforcement** — those were never built; `api_version` today is an
  uncompared, informational string.
- **Per-platform update mechanism wiring.** **Built**, per-platform, and
  for real: Android's `core-update` module drives Play's In-App Updates API
  for real (`AppUpdateCoordinator` over Play Core, `resolveUpdateAction`
  choosing Flexible/Immediate); iOS's `AppUpdateEvaluator` computes a real
  UX state (though, as documented in its own comments, it has zero
  enforcement power — Apple prohibits OTA code execution) plus a secondary,
  display-only App Store Lookup client; Web has a real, working service-
  worker-driven OTA path (`sw.js` + `build-manifest.json` polling) that can
  actually deliver a new bundle without a store review and is also the hosted
  VIDAA delivery path; webOS/Tizen correctly have no OTA path and instead show
  the full app's package-update notice. All of this
  is real, working client code — its only real limitation is the empty
  `compatibility` array noted above, which means none of it can currently
  see real floor/deprecation data from a live server.
- **Security review and docs finalisation.** **Partial.** No dedicated
  security-review pass across auth/DRM/deployment defaults has been done —
  there's no DRM to review yet (see Wave 3), and auth's persistence gaps
  (Wave 2) are still open. Docs finalisation is what this very document and
  `versioning-policy.md` are: a targeted reconciliation pass, not a full
  sweep of every doc in `docs/architecture/` (e.g. `auth-modes.md` still
  describes a planned `apiv` JWT claim that doesn't exist in the real code
  — out of scope for this pass, but a known, undone piece of the same
  cleanup).

## What's deferred, and why

Consolidated from the wave-by-wave detail above, for anyone scanning for
"what's not here yet":

- **No persisted `UserRepo`/`PolicyRepo`.** Real trait boundaries, only
  in-memory implementations. Needs a real persistence design decision.
- **`FullAccount` login has no provisioning story.** Login verification
  exists; nothing creates a user via the API.
- **No AirPlay, push notifications, offline downloads, or deep linking**, on
  any client. None of this exists in the client trees at all — not attempted
  yet, not partially built. (Chromecast used to be listed here too; it is
  now Partial: see the **Chromecast** entry in Wave 6.)
- **No DRM (Widevine/FairPlay/PlayReady) license endpoints.** Named in the
  original Wave 3 plan, never implemented.
- **No live docker-compose (or Helm/systemd) end-to-end boot proof.** The
  files are real and internally consistent; nothing has started the real
  services to confirm they actually come up together. Deliberately not
  attempted in this pass — starting real services is out of scope for a
  docs-reconciliation task.
- **No real device testing or store submissions**, for any client (Google
  Play, App Store, LG Content Store, Samsung Seller Office). None of this
  environment has the accounts, signing credentials, or physical/virtual
  devices such testing needs.
- **No gossip-based cluster membership**, no DRM as above, no session-to-
  node transcode affinity routing, no checkpointed Tdarr dispatch progress,
  no server-side artwork fetch/cache pipeline. All smaller, genuinely
  deferred pieces of otherwise-built workstreams — see Waves 2–3 above for
  which.
- **No `apiVersion` enforcement or CI compatibility matrix.** See
  `versioning-policy.md` — the whole originally-planned enforcement layer
  is unbuilt; what exists is unenforced plumbing plus independent
  client-side evaluators with nothing real to evaluate against yet.

## Realistic next-highest-value work

In rough priority order, based on what would unblock the most other
deferred work or close the biggest real gap:

1. **Wire `client-compatibility.toml` into `VersionEnvelope.compatibility`
   and implement the version-gate's real comparison.** This single change
   makes every already-built client-side update evaluator (Android, iOS,
   Web, all three TV shells) start working against real data — it's the
   highest-leverage remaining piece precisely because the client side is
   already fully built and just waiting on real server data.
2. **A real, persisted `UserRepo`/`PolicyRepo` plus a `FullAccount`
   provisioning (signup) endpoint.** Unblocks any deployment that isn't
   pure `TrustedNetwork`/`ManagedProfiles`, and is the one piece of the
   auth engine that's an actual functional gap rather than a nice-to-have.
3. **A real docker-compose boot, run against the actual services.** Cheap
   to do, high-confidence payoff — turns "should work" into "confirmed
   works" for the deployment tier most people will actually try first.
4. **DRM license endpoints**, once a concrete deployment needs protected
   playback — not urgent in the abstract, but currently the single largest
   named gap against the original media-pipeline scope.
5. **Kotlin/Swift SDK codegen, for real**, replacing the hand-written
   mirrors once `scripts/gen-sdk.sh`'s output has been reviewed for the
   `oneOf`-schema issues that motivated hand-writing them in the first
   place — lower urgency than the above since the hand-written mirrors are
   real, working code today, not a blocker.
