# Roadmap

This roadmap is organised as **waves**, not sprints or calendar phases. A
wave is a position in the project's **dependency graph**: everything in
Wave *N* can start once its prerequisites in earlier waves have landed,
regardless of how much calendar time that takes or how many waves are
being worked concurrently. Waves overlap in practice — Wave 4's deployment
infra and Wave 6's TV clients can, and do, proceed in parallel once their
respective Wave-1/Wave-5 prerequisites are met, even though Wave 6 is
numbered after Wave 4. The numbering reflects *what depends on what*, not
*what happens when*.

Each workstream below is tagged:

- **Agent-dispatchable** — narrowly scoped, has a clear contract to build
  against (a trait signature, an existing API spec, a fixed set of sibling
  files it must not touch), and can be handed to an independent, parallel
  agent with minimal ongoing steering. This is the default mode of building
  this project — see
  [`architecture/overview.md`](architecture/overview.md#why-this-is-a-monorepo).
- **Continuous single-owner** — touches shared abstractions other
  workstreams depend on, requires judgement calls that ripple outward
  (changing a trait signature, a schema, a coordination primitive), or is
  performance/correctness-sensitive in a way that benefits from one
  consistent hand across many iterations rather than parallel independent
  attempts. These are kept as ongoing, singly-owned work even while
  everything downstream of them is parallelised.

## Wave 1 — Foundations

*Nothing meaningful can be agent-dispatched in parallel until this wave's
core abstractions exist and are stable enough to build against.*

- **Crate skeleton and the single-role-gated binary.** `streamarr-core`
  domain types, the `RoleSet` bitflag and `streamarr-cli` entry point,
  workspace `Cargo.toml` wiring. **Continuous single-owner** — every other
  crate's shape depends on decisions made here.
- **The dual-backend storage engine.** `streamarr-db`, the `Database`
  trait, SQLite and Postgres migration sets, per
  [ADR 0001](architecture/adr/0001-storage-engine.md). **Continuous
  single-owner** — a schema or trait change here has to ripple through
  every crate that persists anything, so it needs one consistent hand
  early, before there's a large surface depending on it.
- **The OpenAPI spec skeleton.** `crates/streamarr-api/openapi.yaml` scaffolded
  with the core resource shapes (library items, users, sessions,
  `system-version`), even before every endpoint is implemented — this is
  the contract every client-facing workstream in later waves generates
  against. **Continuous single-owner** while the shape is unstable;
  individual endpoint additions become agent-dispatchable once the spec's
  conventions are established.

## Wave 2 — Platform Services

*Depends on Wave 1's domain types, storage engine, and API spec skeleton
existing.*

- **Auth engine.** `streamarr-auth`: `Policy`, the three trust tiers, JWT +
  refresh token rotation, the RFC 8628 device flow — see
  [`architecture/auth-modes.md`](architecture/auth-modes.md). **Continuous
  single-owner** — security-sensitive, and every client's session-handling
  code depends on this contract being right the first time rather than
  iterated on in parallel.
- **`ClusterCoordinator`.** `streamarr-cluster`: the trait,
  `SingleNodeCoordinator`, `PostgresCoordinator` (advisory locks +
  heartbeat), gossip as an opt-in — see
  [`architecture/distributed-design.md`](architecture/distributed-design.md).
  **Continuous single-owner** for the trait and `PostgresCoordinator`;
  gossip membership is **agent-dispatchable** as an additive, opt-in
  implementation once the trait is frozen.
- **arr-ecosystem adapters.** `streamarr-arr`: one adapter per wrapped
  application (Sonarr, Radarr, Prowlarr, Bazarr). **Agent-dispatchable, one
  agent per adapter** — each adapter talks to one external REST API,
  normalises into `streamarr-core` types, and has essentially no
  interaction with its sibling adapters.
- **Metadata scanning.** `streamarr-metadata`: library scanning, metadata
  agents, artwork fetch/cache. **Agent-dispatchable** once
  `streamarr-core`'s library item types are stable — largely independent
  of auth and clustering work happening in the same wave.

## Wave 3 — Media Pipeline

*Depends on Wave 1's storage engine and Wave 2's cluster coordinator
(for session-affinity bookkeeping).*

- **On-demand transcode session manager.** `streamarr-transcode`: ffmpeg
  process supervision, HLS/DASH packaging, the DRM license endpoints
  (Widevine, FairPlay, PlayReady), session-to-node affinity routing per
  [`architecture/distributed-design.md`](architecture/distributed-design.md).
  **Continuous single-owner** — latency-sensitive, shares mutable
  process-lifecycle state, and mistakes here are directly user-visible as
  broken playback.
- **Background transcode dispatch.** `streamarr-tdarr`: job queueing and
  dispatch against a Tdarr-compatible worker pool, checkpointed progress.
  **Continuous single-owner** initially (shares scheduling concerns with
  the coordinator's leadership responsibilities), becoming
  **agent-dispatchable** for individual codec/preset profile additions once
  the dispatch core is stable.

## Wave 4 — Deployment Infra

*Depends on Wave 1's binary/role-gating shape being stable enough to
target; does not depend on Waves 2/3 being feature-complete, since infra
scaffolding only needs to know how the binary is invoked, not everything it
can do yet.*

- **systemd tier.** `infra/systemd/streamarr.service`, the installer, the
  opt-in update timer — see
  [`architecture/deployment/systemd.md`](architecture/deployment/systemd.md).
  **Agent-dispatchable.**
- **docker-compose tier.** `docker-compose.prod.yml`, `.env.example`, the
  Watchtower overlay — see
  [`architecture/deployment/docker-compose.md`](architecture/deployment/docker-compose.md).
  **Agent-dispatchable.**
- **Kubernetes tier.** `deploy/helm/streamarr/`, the Flux GitOps manifests
  under `deploy/gitops/` — see
  [`architecture/deployment/kubernetes.md`](architecture/deployment/kubernetes.md).
  **Agent-dispatchable.**

These three are dispatched as fully independent parallel agents in
practice — each tier's infra files reference the same binary and the same
config shape but never touch each other's files, which is exactly the
monorepo-with-disciplined-directory-ownership pattern described in
[`architecture/overview.md`](architecture/overview.md#why-this-is-a-monorepo).

## Wave 5 — Client Foundations

*Depends on Wave 1's OpenAPI spec being complete enough to generate real
clients against, and benefits from (but doesn't strictly require) Wave 2's
auth flow being implemented, since every client needs to authenticate.*

- **Web client / TV shell.** `clients/tv-shell/` and `clients/web/` — see
  [`architecture/clients/web.md`](architecture/clients/web.md). Treated as
  a **Wave 5 priority ahead of its Wave 6 siblings** because it is the base
  every TV-web client in Wave 6 builds on; landing it late would block
  webOS, Tizen, and the VIDAA fallback simultaneously. **Continuous
  single-owner** for the shared shell and player/platform-adapter
  interfaces; individual screens/components are **agent-dispatchable**
  once those interfaces exist.
- **Android Mobile.** `clients/android/core/`, `clients/android/playback/`,
  `clients/android/mobile/` — see
  [`architecture/clients/android-mobile.md`](architecture/clients/android-mobile.md).
  **Agent-dispatchable** once the OpenAPI spec is stable enough to generate
  a Kotlin client from.
- **iOS.** `clients/ios/StreamarrKit/`, the app target — see
  [`architecture/clients/ios.md`](architecture/clients/ios.md).
  **Agent-dispatchable**, source-scaffoldable without Xcode installed in a
  given environment (see the gap noted in that doc and in
  `clients/ios/README.md`), independent of the Android work in this same
  wave.

## Wave 6 — TV Clients

*Depends on Wave 5's Web/TV-shell codebase existing (webOS, Tizen, and the
VIDAA fallback are thin adapters on top of it) and on Wave 5's Android
Mobile modules (Android TV shares `core/`/`playback/` with it).*

- **Android TV.** `clients/android/tv/` — see
  [`architecture/clients/android-tv.md`](architecture/clients/android-tv.md).
  **Agent-dispatchable**, largely a D-pad-aware UI layer over Wave 5's
  shared Android modules.
- **webOS.** `clients/webos/` — see
  [`architecture/clients/webos.md`](architecture/clients/webos.md).
  **Agent-dispatchable**, a platform-bridge adapter over the Wave 5 TV
  shell.
- **Tizen.** `clients/tizen/` — see
  [`architecture/clients/tizen.md`](architecture/clients/tizen.md).
  **Agent-dispatchable**, a platform-bridge-plus-player adapter (`AVPlay`)
  over the Wave 5 TV shell.
- **VIDAA fallback.** No native client — Cast/AirPlay from Wave 5 clients,
  plus the optional unsupported PWA sideload reusing the Wave 5 TV shell
  build as-is. See [`architecture/clients/vidaa.md`](architecture/clients/vidaa.md)
  for the feasibility verdict. **Not a build workstream** in the
  conventional sense — the work here is the ToS re-verification process
  attached to the sideload path, which is **continuous single-owner**
  (a standing, recurring check, not a one-time deliverable) if and only if
  that fallback is ever promoted beyond best-effort.

## Wave 7 — Hardening and Versioning Rollout

*Depends on every client in Waves 5–6 existing (there is nothing to enforce
compatibility across until multiple real clients exist) and on Wave 1's
`apiVersion` scaffolding being wired through the API layer.*

- **Versioning enforcement middleware + CI compatibility matrix.** The
  `426`/deprecation-header middleware, the `system-version` endpoint, the
  pinned-fixture compatibility CI job — see
  [`versioning-policy.md`](versioning-policy.md). **Continuous
  single-owner** — this is the mechanism every other workstream's release
  cadence depends on being correct; getting the N-2 enforcement wrong
  breaks compatibility promises silently across the whole client fleet.
- **Per-platform update mechanism wiring.** Play In-App Updates
  integration, the iOS Lookup-API interstitial, the Web/VIDAA
  service-worker OTA path, and documenting the webOS/Tizen no-OTA
  resubmission reality in each client's release process — see the
  per-platform table in [`versioning-policy.md`](versioning-policy.md).
  **Agent-dispatchable, one agent per platform** — each platform's update
  mechanism is implemented entirely within that platform's own client
  directory against the shared `system-version` contract from Wave 1.
- **Security review and docs finalisation.** A final pass across auth,
  DRM license endpoints, and the deployment tiers' default configurations,
  plus bringing `docs/` fully in sync with whatever changed during Waves
  1–6. **Continuous single-owner** for the security pass itself; docs
  finalisation is **agent-dispatchable** per doc subtree, mirroring how
  this very docs tree was built.

## How to read this if you're picking up work

If you're an agent (or a person) about to start a workstream: check which
wave it's in, confirm the prerequisite waves' relevant pieces actually
exist in the tree yet (not just "the wave number is lower" — a Wave 6 TV
client genuinely cannot start meaningfully before Wave 5's TV shell has
landed, wave numbering exists precisely to make that dependency explicit),
and if it's tagged agent-dispatchable, treat your slice of the directory
tree as yours alone for the duration of the task — the whole point of the
tagging in this document is that agent-dispatchable work should be
handed out at exactly this granularity, not bundled into bigger,
harder-to-parallelise chunks.
