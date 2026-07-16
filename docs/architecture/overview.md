# Streamarr / Playarr Architecture Overview

This is the canonical entry point for the project. Read this document first,
before touching any crate, client, or infra file. It explains the shape of
the system and *why* it is shaped that way, so the more specific documents
under `docs/architecture/` (auth, distributed design, deployment, per-client)
make sense in context rather than reading as a pile of independent decisions.

## What Streamarr and Playarr are

**Streamarr** is the self-hosted media server: a single Rust workspace that
owns the library (scanning, metadata, artwork), the streaming path (on-demand
and background transcoding), authentication, and a unified HTTP/JSON API. It
is the thing you install on a NAS, a home server, a VPS, or a Kubernetes
cluster.

**Playarr** is the brand for the client suite that talks to a Streamarr
server: seven playback applications (Android Mobile, Android TV, iOS, LG
webOS, Samsung Tizen, Hisense VIDAA, and Web) that share an API contract, an
auth flow, and — where the underlying platform allows it — actual code.

Streamarr is the platform; Playarr is what people install to watch things on
it. They ship from the same monorepo and version together (see
[`docs/versioning-policy.md`](../versioning-policy.md)), but they are
conceptually separate products: one server admin can run Streamarr and never
use a Playarr client at all (a third-party client could speak the same API),
and a Playarr client only exists in service of some Streamarr server.

## The single-role-gated-binary principle

Streamarr ships as **one compiled binary**, `streamarr`, regardless of
deployment tier. There is no separate `streamarr-api`, `streamarr-worker`,
and `streamarr-coordinator` executable to build, version, and keep in sync.
Instead, the binary (default subcommand `serve`; a separate `update`
subcommand checks/applies binary updates out-of-band) reads a
`STREAMARR_ROLE` environment variable at startup, resolved by
`streamarr_config::Role` into one of three values, and every subsystem that
registers HTTP routes or spawns background tasks checks it before doing so:

```rust
pub enum Role {
    /// Everything in one process. The default, and the only sane choice
    /// for DeploymentTier::SingleNode.
    All,
    Api,
    Worker,
}

impl Role {
    pub fn runs_api(self) -> bool { matches!(self, Role::All | Role::Api) }
    pub fn runs_worker(self) -> bool { matches!(self, Role::All | Role::Worker) }
}
```

A single-node install (systemd tier) runs one process with `STREAMARR_ROLE`
unset (which defaults to `all`) — the Axum API, the arr-sync reconciliation
pollers, and the Tdarr background dispatcher all run as tasks in the same
process. A Kubernetes deployment can instead run several processes from the
*identical* binary: some started with `STREAMARR_ROLE=api` (serving the
Axum router) and others with `STREAMARR_ROLE=worker` (running the pollers
and dispatcher plus a minimal `/healthz` listener, no public API router).
There is no separate "coordinator" or "edge" role — cluster coordination
isn't something a process opts into via role, it's a trait
(`streamarr_coordination::ClusterCoordinator`) every `api`/`worker` process
constructs the same way at boot, picking `SingleNodeCoordinator` or
`PostgresCoordinator` based on `streamarr_config::DeploymentTier` (itself
*derived* from whether `DATABASE_URL`/`REDIS_URL` point at Postgres/Redis,
not a separately configured tier flag) — see
[`distributed-design.md`](distributed-design.md).

This buys three things deliberately:

1. **One artifact per platform per release.** CI builds one `x86_64` binary,
   one `aarch64` binary, one container image. There is no risk of an API
   node and a worker node drifting to different git SHAs because someone
   forgot to rebuild one of several images.
2. **Tier upgrades are a config change, not a rewrite.** Growing from a
   single NAS to a three-node cluster means changing how the *same* binary
   is invoked and pointing it at Postgres instead of SQLite — not swapping
   in different software.
3. **Role gating is a compile-time-visible runtime check, not a build
   feature.** The composition root (`backend/src/main.rs`'s `serve`
   function) checks `Role::runs_api()`/`Role::runs_worker()` before spawning
   the API router or the background tasks, so it is always obvious from
   reading the code which roles a given subsystem needs, without maintaining
   parallel Cargo feature matrices.

Role gating is a runtime concern; it does not fork the binary's feature
flags. Cargo features are reserved for genuinely optional *build-time*
concerns (e.g. compiling in the SQLite driver, the Postgres driver, or both).

## The three deployment tiers

Streamarr is designed against three explicit deployment tiers, in increasing
order of scale and operational complexity. Every architecture decision in
this repository is checked against all three — a design that only works at
Kubernetes scale, or only works as a single binary on a Raspberry Pi, is
rejected.

| Tier | Typical hardware | Node count | DB backend | Coordinator | Doc |
|---|---|---|---|---|---|
| 1 — systemd | NAS, mini-PC, Raspberry Pi 4/5, home server | 1 | SQLite | `SingleNodeCoordinator` (no-op) | [`deployment/systemd.md`](deployment/systemd.md) |
| 2 — docker-compose | Small VPS or home server, fixed handful of containers | 1–3 | Postgres | `PostgresCoordinator` (advisory locks) | [`deployment/docker-compose.md`](deployment/docker-compose.md) |
| 3 — Kubernetes | Managed or self-hosted cluster, autoscaled | 3+ | Postgres | `PostgresCoordinator` | [`deployment/kubernetes.md`](deployment/kubernetes.md) |

Tier 1 is the default and the one the majority of users will run: it must
work with zero external dependencies, survive an unattended reboot, and not
require the owner to understand clustering at all. Tiers 2 and 3 exist for
people who outgrow a single box or who are running Streamarr as shared
infrastructure for multiple households. See
[`docs/architecture/distributed-design.md`](distributed-design.md) for the
statelessness requirements and coordinator design that make moving between
tiers possible without a data migration story beyond "point at Postgres."

## Crate layout

The server is a Cargo workspace rooted at `backend/`: library crates live
under `backend/crates/`, and the binary entrypoint doubles as the workspace
root package — `streamarr-bin` (binary name `streamarr`), whose crate root
is `backend/src/main.rs`, not a separate `crates/streamarr-bin/` directory
(the root manifest declares both `[workspace]` and `[package]`; cargo
supports that). Each crate has one job and depends downward, never sideways
into a peer's internals:

| Crate | Responsibility |
|---|---|
| `streamarr-model` | Domain types shared across the backend (library items, `User`, `Session`, `Policy`, `Device`, ...) with no I/O. Everything else depends on this; it depends on nothing in-workspace. |
| `streamarr-config` | Env-driven configuration (`Config::from_env`), hand-rolled on `std::env` rather than a config framework — loaded before telemetry exists, so config errors must be reportable with nothing fancier than `Display`. Also owns `Role` (`all`/`api`/`worker`) and `DeploymentTier` (derived from whether `DATABASE_URL`/`REDIS_URL` point at Postgres/Redis). |
| `streamarr-db` | The `sqlx`-based dual-backend storage engine (SQLite + Postgres, via `sqlx::AnyPool`). See [ADR 0001](adr/0001-storage-engine.md). Owns migrations and the repository traits (`WorkRepo`, `DeviceRepo`, `RenditionRepo`, `MediaFileRepo`). |
| `streamarr-coordination` | The `ClusterCoordinator` trait and its `SingleNodeCoordinator` / `PostgresCoordinator` implementations. See [`distributed-design.md`](distributed-design.md). |
| `streamarr-cache` | Cache + pub/sub abstraction (`CacheAndPubSub`): in-memory (moka) for single-node, Redis or Postgres `LISTEN`/`NOTIFY` for multi-node. |
| `streamarr-arr-client` | Typed HTTP clients for the wrapped *arr apps: Sonarr, Radarr, Lidarr, Prowlarr, Bazarr, Readarr. |
| `streamarr-arr-sync` | Webhook-as-signal, poll-as-truth reconciliation between Streamarr's catalog and the configured *arr source instances — see "The arr-wrapping approach" below. |
| `streamarr-catalog` | Read-optimised catalog query API: browse/search/get-by-id over the `Work` aggregate, cache-fronted. |
| `streamarr-tdarr-client` | Typed client for Tdarr's REST v2 API — the background transcode pipeline. |
| `streamarr-transcode` | Playback-time transcode decision-making (direct-play / existing-rendition / on-demand-transcode ordering) plus the background Tdarr dispatch loop. See "The Tdarr background-vs-on-demand transcode split" below. |
| `streamarr-auth` | Trust tiers (`AuthMode`), `Policy` evaluation, JWT issuance/verification, refresh-token rotation, RFC 8628 device flow. See [`auth-modes.md`](auth-modes.md). |
| `streamarr-telemetry` | Logging, correlation IDs, metrics, optional OpenTelemetry export, playback analytics collection, diagnostics endpoints. |
| `streamarr-api` | The Axum HTTP surface: system routes, auth (`/api/v1/auth/login`, `/api/v1/oauth/...`), catalog, playback, webhooks — handlers are annotated with `utoipa`, so `backend/openapi/streamarr.yaml` is *generated from* the code, not the other way around. Versioning-middleware enforcement (see [`versioning-policy.md`](../versioning-policy.md)). |

`streamarr-model` sits at the bottom of the dependency graph on purpose:
domain types must be usable by the DB layer, the API layer, and background
workers alike without any of them pulling in the others' dependencies (an
API handler should never need to link `streamarr-transcode`'s ffmpeg
supervision just because it imports a shared type).

## The arr-wrapping approach

Streamarr does not reimplement indexing, acquisition, or subtitle-fetching
logic. That problem is already solved, extremely well, by the existing *arr
ecosystem (Sonarr for TV, Radarr for movies, Prowlarr for indexers, Bazarr
for subtitles). Reinventing it would be years of work duplicating mature,
actively maintained software for no user benefit.

Instead, `streamarr-arr-client` provides typed HTTP clients over each *arr
app's existing REST API (wherever that instance is actually running — an
existing externally-managed install, most commonly), and `streamarr-arr-sync`
reconciles Streamarr's own catalog against it: a webhook, where the *arr app
is configured to send one, is only a *signal to reconcile sooner* — the
reconciliation itself always polls and diffs the *arr app's own state rather
than trusting a webhook payload as authoritative ("webhook-as-signal,
poll-as-truth," per that crate's own doc comment) — writing the normalised
result into `streamarr-model` types (`Work`, `MediaFile`, ...) via
`streamarr-db`. The user sees one coherent Streamarr UI and one auth session;
underneath, an action like "add this series to the library and acquire it"
is translated into Sonarr API calls.

This keeps Streamarr's own scope disciplined: it owns *library and
playback*, not acquisition. The *arr apps keep their own UIs available for
power users who want them directly; Streamarr is additive, not a fork or a
replacement.

**Known gap:** which *arr instances to reconcile against is not yet
persisted or admin-configurable anywhere in the workspace — the webhook
receiver's `instance_id` lookup is backed by `streamarr-api::SourceInstanceRegistry`,
a real, thread-safe, in-process registry that starts empty every boot and
has no admin API to populate it yet (see that type's own doc comment). A
fresh deployment currently needs its source instances wired in by whoever
builds the composition root, not configured through the running server.

## The Tdarr background-vs-on-demand transcode split

Streamarr treats "transcode a video" as two unrelated problems with
unrelated latency, resource, and failure-mode requirements, and refuses to
let one code path serve both:

- **Background transcoding** (`streamarr-transcode`'s `TdarrDispatcher`,
  talking to a Tdarr worker pool over `streamarr-tdarr-client`) is
  library-wide optimisation: re-encoding a library toward more efficient
  codecs (e.g. H.264 → HEVC/AV1) or fixing container issues, queued against
  a pool of Tdarr-compatible worker nodes, low priority, fully resumable,
  and allowed to take hours. Progress is checkpointed in the database, so a
  worker node dying mid-job just means the job gets picked up by another
  worker; nothing about it is latency-sensitive.
- **On-demand transcoding** (`streamarr-transcode`) is what happens the
  moment someone presses play and their device can't direct-play the source
  (wrong codec, insufficient bandwidth, no hardware decode support). This
  spins up a supervised `ffmpeg` process *right now*, tracked as a
  `TranscodeSession` tagged with the owning node's id. It is inherently
  ephemeral and — critically — pinned to the node that started it (see the
  session-affinity discussion in
  [`distributed-design.md`](distributed-design.md)); if that node dies, the
  session dies with it and the client has to restart playback. **Known
  gap:** `GET /api/v1/playback/{media_file_id}` implements the
  direct-play/existing-rendition/on-demand-transcode *decision* and returns
  a well-known-convention URL for the chosen mode, but actually serving
  bytes at that URL (range requests for direct-play, HLS playlist/segment
  serving for the transcode paths) is not implemented yet — see the
  `TODO(streaming)` on `PlaybackInfoResponse` in `streamarr-api`.

Sharing infrastructure between these two would compromise both: background
jobs would either starve on-demand playback of CPU, or on-demand playback
would need to preempt background jobs in ways that make background jobs no
longer safely resumable. They are dispatched, scheduled, and monitored
independently, even though they both ultimately shell out to `ffmpeg`.

## The 7-client strategy

Playarr ships seven clients, one per platform surface that matters for a
home-theatre and mobile media experience:

| Client | Platform | Doc |
|---|---|---|
| Android Mobile | Phones/tablets, Android 8.0+ | [`clients/android-mobile.md`](clients/android-mobile.md) |
| Android TV | Android TV / Google TV, Android TV 9+ | [`clients/android-tv.md`](clients/android-tv.md) |
| iOS | iPhone/iPad, iOS 15+ | [`clients/ios.md`](clients/ios.md) |
| webOS | LG smart TVs | [`clients/webos.md`](clients/webos.md) |
| Tizen | Samsung smart TVs | [`clients/tizen.md`](clients/tizen.md) |
| VIDAA | Hisense/Toshiba smart TVs | [`clients/vidaa.md`](clients/vidaa.md) |
| Web | Browsers, installable PWA | [`clients/web.md`](clients/web.md) |

The strategy is deliberately *not* "one codebase, seven targets" — the
platforms are too different for that to be honest (native AVFoundation/DRM
on iOS has nothing in common with a webOS Enact app). Instead, code sharing
follows the grain of the platforms themselves:

- Android Mobile and Android TV share a Kotlin multi-module Gradle project
  (`:core`, `:playback`, `:api-client` modules) with separate `:mobile` and
  `:tv` UI modules, because they share a language, a DRM stack (Widevine via
  Media3), and a store.
- webOS and Tizen share a React/TypeScript TV shell with platform player
  adapters (LG's webOS `<video>`+EME and Samsung's `AVPlay`). VIDAA opens the
  current Playarr Web client in its Browser and selects its television identity
  and playback profile at runtime.
- iOS stands alone at the UI layer (SwiftUI, AVFoundation, FairPlay) because
  nothing else shares Swift or Apple's DRM stack, but still consumes the
  same OpenAPI-generated client contract as every other platform.

Every client, regardless of code sharing, is required to speak the same
versioned API contract — see [`versioning-policy.md`](../versioning-policy.md)
for how that contract is enforced and evolved without breaking clients that
can't update on demand (store review delays, no-OTA platforms).

## Why this is a monorepo

The server, all seven clients, and the infra manifests for all three
deployment tiers live in one repository. This is a deliberate choice, not
incidental:

1. **The API contract is the coupling point, and the monorepo makes that
   coupling atomic.** A change that bumps `apiVersion` and a client change
   that adopts it can land in the same commit/PR, reviewed together. Across
   repos, that relationship has to be tracked out-of-band and is where
   version-skew bugs come from.
2. **One OpenAPI spec, generated clients for everyone.** The spec is
   generated from `utoipa`-annotated handlers in `streamarr-api` into
   `backend/openapi/streamarr.yaml`; Kotlin, Swift, and TypeScript client
   stubs are generated from it in CI for the respective clients. That
   generation step is trivial in-repo and painful to keep synchronised
   across repos with independent release cadences.
3. **It matches how the project is actually built.** This project is built
   by dispatching many parallel, narrowly-scoped agents against clearly
   bounded subdirectories (a crate, an infra tier, a client platform, a docs
   subtree) at the same time — see [`docs/roadmap.md`](../roadmap.md). A
   monorepo with disciplined directory ownership gives every agent a stable,
   conflict-free slice of one tree instead of needing cross-repo
   coordination for every change that touches more than one component.
4. **Docs, infra, and code drift together or not at all.** A systemd unit
   file, a Helm chart, and the doc describing how to use them are far more
   likely to stay accurate when a single PR is the unit of change across all
   three than when they live in separate repos with separate release
   trains.

The cost — a bigger checkout, and CI that has to be selective about what it
rebuilds per change — is accepted deliberately in exchange for the coupling
guarantees above.

## Known gaps as of this pass

The docs under `docs/architecture/` describe both what's built and, where
relevant, what isn't yet — called out explicitly rather than glossed over.
The recurring theme across the backend today is: the domain types and the
trait boundaries they'll eventually persist through already exist, but a
few of the concrete persistence layers behind those traits don't yet, so
some real, working functionality is currently backed by an in-process store
that resets on restart and doesn't survive/coordinate across a multi-node
deployment. Concretely:

- **No persisted `User`/`Policy` store.** `streamarr-auth::InMemoryUserDirectory`
  and `streamarr-auth::InMemoryAdminRegistry` are real, working
  implementations, not mocks — but there is no `UserRepo`/`PolicyRepo` in
  `streamarr-db`, so accounts and admin status don't survive a restart and
  aren't shared across nodes in a multi-node deployment. See
  [`auth-modes.md`](auth-modes.md) for the direct consequence this has for
  `AuthMode::FullAccount`.
- **Refresh tokens and RFC 8628 device-authorization state are in-memory.**
  `RefreshTokenService`/`DashMapDeviceFlowHandler` work correctly within one
  process's lifetime; a restart or a second node cannot see the other's
  sessions.
- **No persisted `SourceInstance` configuration** — see "The arr-wrapping
  approach" above.
- **On-demand transcode segment/playlist serving is not implemented** — see
  "The Tdarr background-vs-on-demand transcode split" above.

None of this is silently papered over in code: every one of the in-memory
stores above documents its own "not a mock, but pending real persistence"
status directly in its module doc comment, with a `TODO(persistence)`
pointing at what should replace it.

## Where to go next

- New to the storage layer? Start with
  [ADR 0001: storage engine](adr/0001-storage-engine.md).
- Implementing or reviewing auth? Read [`auth-modes.md`](auth-modes.md).
- Working on clustering, node affinity, or the coordinator? Read
  [`distributed-design.md`](distributed-design.md).
- Deploying or writing infra for a specific tier? Read the matching doc
  under `deployment/`.
- Building a specific client? Read the matching doc under `clients/`.
- Wondering what to build next, or how work is sequenced? Read
  [`docs/roadmap.md`](../roadmap.md).
