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
  different names than originally sketched: there is no `streamarr-core`
  crate or `RoleSet` bitflag. Domain types live in `streamarr-model`
  (`Work`, `User`, `Session`, `Device`, `MediaFile`, `Rendition`, ...);
  role-gating is `streamarr-config::Role` (`All` / `Api` / `Worker`, read
  from `STREAMARR_ROLE`) plus `DeploymentTier`; the single binary is
  `streamarr-bin` (package name), producing the `streamarr` binary from
  `backend/src/main.rs`, a real `clap` CLI with subcommands. Functionally
  equivalent to the planned design (one binary, gated by role at startup),
  just simpler than a bitflag.
- **The dual-backend storage engine.** **Built.** `streamarr-db` genuinely
  supports both SQLite and Postgres via `sqlx`, auto-detecting the backend
  from the connection URL scheme (`Backend::from_database_url`), with
  separate embedded migration sets under `backend/migrations/sqlite/` and
  `backend/migrations/postgres/` (currently 5 and 8 migrations
  respectively — Postgres has extra migrations for cluster-leader and cache
  tables that SQLite's single-node deployments don't need). Real
  `WorkRepo`, `DeviceRepo`, `RenditionRepo`, and `MediaFileRepo` traits with
  Sqlx-backed implementations, per [ADR 0001](architecture/adr/0001-storage-engine.md).
- **The OpenAPI spec.** **Built**, and further along than "skeleton": it
  is not hand-maintained at all. `backend/openapi/streamarr.yaml` is
  generated from `#[utoipa::path]` annotations on every real handler
  (`streamarr-api::openapi_spec()`), with a checked-in drift test
  (`openapi_spec_matches_checked_in_file`) that fails CI if the file and the
  live route annotations disagree. Every route in the section below is
  real and reflected in this spec — there's no separate "planned" spec to
  reconcile against.

## Wave 2 — Platform Services

- **Auth engine.** **Built** for the mechanism, **Partial/Deferred** for
  persistence. `streamarr-auth` has real JWT access-token issuance and
  verification, real refresh-token rotation, and a real RFC 8628 device
  flow (`DeviceFlowHandler`, `DashMapDeviceFlowHandler`). All three trust
  tiers from `docs/architecture/auth-modes.md` exist as `AuthMode`
  variants (`TrustedNetwork`, `ManagedProfiles`, `FullAccount`) with real
  login-resolution logic, and a real `PolicyEvaluator`/`DefaultPolicyEvaluator`
  for authorization decisions. Bearer-token enforcement is real and wired
  into every route that needs it: `streamarr-api::auth_extractor`'s
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
  there's no register/signup endpoint anywhere in `streamarr-api`; a
  comment in `login.rs` explicitly scopes user provisioning as
  "out-of-scope" for that module. Both are deferred because they need a
  real persistence/admin-tooling design decision, not because they're hard.
- **`ClusterCoordinator`.** **Built** for the two shipped implementations,
  **Deferred** for gossip. `streamarr-coordination` (not `streamarr-cluster`)
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
  `streamarr-arr-client` (not `streamarr-arr`) has one real adapter each
  for Sonarr, Radarr, Prowlarr, Bazarr, **and** Lidarr and Readarr (music
  and books, beyond the original four-adapter scope), all over a shared
  `http.rs` client.
- **Metadata scanning.** **Built, but architecturally different from the
  plan.** There is no standalone `streamarr-metadata` crate doing its own
  independent library scanning/artwork fetch. Instead, `streamarr-arr-sync`
  polls and receives webhooks from the wrapped *arr apps
  (`poller.rs`/`webhook.rs`) and reconciles their already-scanned metadata
  into `streamarr-model::Work`/`MediaFile` rows (`media_sync.rs`), while
  `streamarr-catalog` serves the read-side browse/search/detail API on top.
  This is a deliberate, reasonable shape for a server that wraps Sonarr/
  Radarr/etc. rather than replacing them — those apps already do metadata
  scanning, so Streamarr consumes their output instead of duplicating it.
  One real gap versus even this narrower scope: artwork (`ImageAsset`) is
  stored as a URL reference passed through from the source app, with no
  server-side fetch/cache/proxy pipeline of its own.

## Wave 3 — Media Pipeline

- **On-demand transcode session manager.** **Partial.** `streamarr-transcode`
  has a real `TranscodeOrchestrator` implementing the planned three-step
  decision order (direct-play → existing rendition → spawn on-demand
  transcode), real ffmpeg HLS argument construction
  (`build_ffmpeg_hls_args`), and session state in whatever
  `streamarr-cache::CacheAndPubSub` backend is configured (in-memory or
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
  (in `streamarr-transcode`) hands work off through `streamarr-tdarr-client`,
  a genuine typed client for Tdarr's REST v2 API (`x-api-key` auth, node/
  worker-capacity queries, file-scan requests). **Deferred:** checkpointed
  progress tracking across dispatcher restarts, mentioned in the original
  plan, isn't implemented — a restart currently loses in-flight job
  progress rather than resuming it.

## Wave 4 — Deployment Infra

All three tiers are **Built** as real, checked-in files (not just
scaffolding), with paths shifted from the original plan's `infra/`
sketch to what's actually there:

- **systemd tier.** `infra/systemd/streamarr.service`, `install.sh`,
  `streamarr.env.example`, and an update-check timer/service pair
  (`streamarr-update-check.timer`/`.service`) — the opt-in update timer
  from the plan is real.
- **docker-compose tier.** `infra/docker/docker-compose.{dev,prod,ci,mock}.yml`
  plus `docker-compose.watchtower.optional.yml` for the opt-in
  auto-update overlay, and a real `backend.Dockerfile`.
- **Kubernetes tier.** `infra/kubernetes/` has both a real Helm chart
  (`helm/streamarr/Chart.yaml`+`values.yaml`) and a plain Kustomize
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
  `backend/openapi/streamarr.yaml` for real, and `src/generated/schema.ts`
  is that real generated file. **Kotlin and Swift codegen are configured
  but never executed**: `clients/shared/sdk-codegen/{kotlin,swift}-config.yaml`
  and `scripts/gen-sdk.sh` are real `openapi-generator` configs pointing at
  output directories (`clients/android-shared/sdk`,
  `clients/ios/StreamarrSDK`) that don't exist in the tree. Android and iOS
  instead ship **hand-written mirrors** of the OpenAPI schemas
  (`StreamarrHttpClient.kt`'s models, `OpenAPISchemas.swift`), written by
  reading the spec directly — a deliberate choice documented in
  `OpenAPISchemas.swift`'s own comment (the generic Swift5 generator
  doesn't produce correct `Codable` conformances for several `oneOf`
  schemas), not an oversight. Regenerating for real is still available any
  time via `scripts/gen-sdk.sh`.
- **Android Mobile.** **Built.** `clients/android-shared/` (core-auth,
  core-data, core-domain, core-designsystem, core-player, core-update) plus
  `clients/mobile-android/` for the app shell.
- **iOS.** **Built**, within the documented environment constraint:
  `clients/ios/Sources/StreamarrKit/` and `StreamarrApp/` are real Swift
  source. **Deferred: no Xcode project layer** — the
  package is real SPM source but there's no `.xcodeproj`/real App target,
  documented explicitly in `clients/ios/README.md` as a consequence of
  Xcode not being installed in the environment this was built in
  (`xcodebuild` errors immediately without a real Xcode install). This is
  an environment limitation, not unfinished application logic.

## Wave 6 — TV Clients

- **Android TV.** **Built.** `clients/tv-android/` shares
  `android-shared`'s core modules.
- **webOS.** **Built.** `clients/tv-web/apps/tv-webos/`, a real adapter
  over the shared TV shell using `player-shaka`.
- **Tizen.** **Built.** `clients/tv-web/apps/tv-tizen/`, using the
  `player-avplay` adapter for Samsung's `AVPlay`.
- **VIDAA hosted Web App.** **Browser client built; launcher distribution
  pending.** The co-hosted Playarr Web client persists a `tv-vidaa` identity
  and negotiates a conservative television playback profile. Users can open it
  directly in the TV Browser; a dedicated launcher tile requires VIDAA partner
  distribution or device-specific developer access. The older
  `apps/tv-vidaa-fallback/` PWA remains an experimental prototype.

The packaged webOS/Tizen shells share `VersionBanner.tsx`; hosted VIDAA uses
Playarr Web's update flow described in
[`versioning-policy.md`](versioning-policy.md).

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
  `VersionBanner`. All of this
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
- **No Chromecast/AirPlay, push notifications, offline downloads, or deep
  linking**, on any client. None of this exists in the client trees at all
  — not attempted yet, not partially built.
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
