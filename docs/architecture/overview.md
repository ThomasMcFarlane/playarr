# Playarr Server / Playarr Architecture Overview

This is the canonical entry point for the project. Read this document first,
before touching any crate, client, or infra file. It explains the shape of
the system and *why* it is shaped that way, so the more specific documents
under `docs/architecture/` (auth, distributed design, deployment, per-client)
make sense in context rather than reading as a pile of independent decisions.

## What Playarr Server and Playarr are

**Playarr Server** is the self-hosted media server: a single Rust workspace that
owns the library (scanning, metadata, artwork), the streaming path (on-demand
and background transcoding), authentication, and a unified HTTP/JSON API. It
is the thing you install on a NAS, a home server, a VPS, or a Kubernetes
cluster.

**Playarr** is the brand for the client suite that talks to a Playarr Server
server: playback applications across Android Mobile, Android TV, iOS, LG
webOS, Samsung Tizen, Hisense VIDAA, Web, and Xbox (see below for the fuller,
still-growing list) that share an API contract, an auth flow, and — where
the underlying platform allows it — actual code.

Playarr Server is the platform; Playarr is what people install to watch things on
it. They ship from the same monorepo and version together (see
[`docs/versioning-policy.md`](../versioning-policy.md)), but they are
conceptually separate products: one server admin can run Playarr Server and never
use a Playarr client at all (a third-party client could speak the same API),
and a Playarr client only exists in service of some Playarr Server.

## The single-role-gated-binary principle

Playarr Server ships as **one compiled binary**, `playarr`, regardless of
deployment tier. There is no separate `playarr-api`, `playarr-worker`,
and `playarr-coordinator` executable to build, version, and keep in sync.
Instead, the binary (default subcommand `serve`; a separate `update`
subcommand checks/applies binary updates out-of-band) reads a
`PLAYARR_ROLE` environment variable at startup, resolved by
`playarr_config::Role` into one of three values, and every subsystem that
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

A single-node install (systemd tier) runs one process with `PLAYARR_ROLE`
unset (which defaults to `all`) — the Axum API, the arr-sync reconciliation
pollers, and the Tdarr background dispatcher all run as tasks in the same
process. A Kubernetes deployment can instead run several processes from the
*identical* binary: some started with `PLAYARR_ROLE=api` (serving the
Axum router) and others with `PLAYARR_ROLE=worker` (running the pollers
and dispatcher plus a minimal `/healthz` listener, no public API router).
There is no separate "coordinator" or "edge" role — cluster coordination
isn't something a process opts into via role, it's a trait
(`playarr_coordination::ClusterCoordinator`) every `api`/`worker` process
constructs the same way at boot, picking `SingleNodeCoordinator` or
`PostgresCoordinator` based on `playarr_config::DeploymentTier` (itself
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

Playarr Server is designed against three explicit deployment tiers, in increasing
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
people who outgrow a single box or who are running Playarr Server as shared
infrastructure for multiple households. See
[`docs/architecture/distributed-design.md`](distributed-design.md) for the
statelessness requirements and coordinator design that make moving between
tiers possible without a data migration story beyond "point at Postgres."

## Crate layout

The server is a Cargo workspace rooted at `backend/`: library crates live
under `backend/crates/`, and the binary entrypoint doubles as the workspace
root package — `playarr-bin` (binary name `playarr`), whose crate root
is `backend/src/main.rs`, not a separate `crates/playarr-bin/` directory
(the root manifest declares both `[workspace]` and `[package]`; cargo
supports that). Each crate has one job and depends downward, never sideways
into a peer's internals:

| Crate | Responsibility |
|---|---|
| `playarr-model` | Domain types shared across the backend (library items, `User`, `Session`, `Policy`, `Device`, ...) with no I/O. Everything else depends on this; it depends on nothing in-workspace. |
| `playarr-config` | Env-driven configuration (`Config::from_env`), hand-rolled on `std::env` rather than a config framework — loaded before telemetry exists, so config errors must be reportable with nothing fancier than `Display`. Also owns `Role` (`all`/`api`/`worker`) and `DeploymentTier` (derived from whether `DATABASE_URL`/`REDIS_URL` point at Postgres/Redis). |
| `playarr-db` | The `sqlx`-based dual-backend storage engine (SQLite + Postgres, via `sqlx::AnyPool`). See [ADR 0001](adr/0001-storage-engine.md). Owns migrations and the repository traits (`WorkRepo`, `DeviceRepo`, `RenditionRepo`, `MediaFileRepo`). |
| `playarr-coordination` | The `ClusterCoordinator` trait and its `SingleNodeCoordinator` / `PostgresCoordinator` implementations. See [`distributed-design.md`](distributed-design.md). |
| `playarr-cache` | Cache + pub/sub abstraction (`CacheAndPubSub`): in-memory (moka) for single-node, Redis or Postgres `LISTEN`/`NOTIFY` for multi-node. |
| `playarr-arr-client` | Typed HTTP clients for the wrapped *arr apps: Sonarr, Radarr, Lidarr, Prowlarr, Bazarr, Readarr. |
| `playarr-arr-sync` | Webhook-as-signal, poll-as-truth reconciliation between Playarr Server's catalog and the configured *arr source instances — see "The arr-wrapping approach" below. |
| `playarr-catalog` | Read-optimised catalog query API: browse/search/get-by-id over the `Work` aggregate, cache-fronted. |
| `playarr-tdarr-client` | Typed client for Tdarr's REST v2 API — the background transcode pipeline. |
| `playarr-transcode` | Playback-time transcode decision-making (direct-play / existing-rendition / on-demand-transcode ordering) plus the background Tdarr dispatch loop. See "The Tdarr background-vs-on-demand transcode split" below. |
| `playarr-auth` | Trust tiers (`AuthMode`), `Policy` evaluation, JWT issuance/verification, refresh-token rotation, RFC 8628 device flow. See [`auth-modes.md`](auth-modes.md). |
| `playarr-telemetry` | Logging, correlation IDs, metrics, optional OpenTelemetry export, playback analytics collection, diagnostics endpoints. |
| `playarr-api` | The Axum HTTP surface: system routes, auth (`/api/v1/auth/login`, `/api/v1/oauth/...`), catalog, playback, webhooks — handlers are annotated with `utoipa`, so `backend/openapi/playarr.yaml` is *generated from* the code, not the other way around. Versioning-middleware enforcement (see [`versioning-policy.md`](../versioning-policy.md)). |

`playarr-model` sits at the bottom of the dependency graph on purpose:
domain types must be usable by the DB layer, the API layer, and background
workers alike without any of them pulling in the others' dependencies (an
API handler should never need to link `playarr-transcode`'s ffmpeg
supervision just because it imports a shared type).

## The arr-wrapping approach

Playarr Server does not reimplement indexing, acquisition, or subtitle-fetching
logic. That problem is already solved, extremely well, by the existing *arr
ecosystem (Sonarr for TV, Radarr for movies, Prowlarr for indexers, Bazarr
for subtitles). Reinventing it would be years of work duplicating mature,
actively maintained software for no user benefit.

Instead, `playarr-arr-client` provides typed HTTP clients over each *arr
app's existing REST API (wherever that instance is actually running — an
existing externally-managed install, most commonly), and `playarr-arr-sync`
reconciles Playarr Server's own catalog against it: a webhook, where the *arr app
is configured to send one, is only a *signal to reconcile sooner* — the
reconciliation itself always polls and diffs the *arr app's own state rather
than trusting a webhook payload as authoritative ("webhook-as-signal,
poll-as-truth," per that crate's own doc comment) — writing the normalised
result into `playarr-model` types (`Work`, `MediaFile`, ...) via
`playarr-db`. The user sees one coherent Playarr Server UI and one auth session;
underneath, an action like "add this series to the library and acquire it"
is translated into Sonarr API calls.

This keeps Playarr Server's own scope disciplined: it owns *library and
playback*, not acquisition. The *arr apps keep their own UIs available for
power users who want them directly; Playarr Server is additive, not a fork or a
replacement.

**Known gap:** which *arr instances to reconcile against is not yet
persisted or admin-configurable anywhere in the workspace — the webhook
receiver's `instance_id` lookup is backed by `playarr-api::SourceInstanceRegistry`,
a real, thread-safe, in-process registry that starts empty every boot and
has no admin API to populate it yet (see that type's own doc comment). A
fresh deployment currently needs its source instances wired in by whoever
builds the composition root, not configured through the running server.

## The Tdarr background-vs-on-demand transcode split

Playarr Server treats "transcode a video" as two unrelated problems with
unrelated latency, resource, and failure-mode requirements, and refuses to
let one code path serve both:

- **Background transcoding** (`playarr-transcode`'s `TdarrDispatcher`,
  talking to a Tdarr worker pool over `playarr-tdarr-client`) is
  library-wide optimisation: re-encoding a library toward more efficient
  codecs (e.g. H.264 → HEVC/AV1) or fixing container issues, queued against
  a pool of Tdarr-compatible worker nodes, low priority, fully resumable,
  and allowed to take hours. Progress is checkpointed in the database, so a
  worker node dying mid-job just means the job gets picked up by another
  worker; nothing about it is latency-sensitive.
- **On-demand transcoding** (`playarr-transcode`) is what happens the
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
  `TODO(streaming)` on `PlaybackInfoResponse` in `playarr-api`.

Sharing infrastructure between these two would compromise both: background
jobs would either starve on-demand playback of CPU, or on-demand playback
would need to preempt background jobs in ways that make background jobs no
longer safely resumable. They are dispatched, scheduled, and monitored
independently, even though they both ultimately shell out to `ffmpeg`.

## The client strategy

Playarr ships one client per platform surface that matters for a
home-theatre and mobile media experience. This table has historically been
called "the 7-client strategy," and the count is already stale for reasons
beyond this document's current pass — see the note below the table.

| Client | Platform | Doc |
|---|---|---|
| Android Mobile | Phones/tablets, Android 8.0+ (universal APK) | [`clients/android-mobile.md`](clients/android-mobile.md) |
| Android TV | Android TV / Google TV, Android 8.0+ (same universal APK) | [`clients/android-mobile.md`](clients/android-mobile.md) |
| iOS | iPhone/iPad, iOS 15+ | [`clients/ios.md`](clients/ios.md) |
| webOS | LG smart TVs | [`clients/webos.md`](clients/webos.md) |
| Tizen | Samsung smart TVs | [`clients/tizen.md`](clients/tizen.md) |
| VIDAA | Hisense/Toshiba smart TVs | [`clients/vidaa.md`](clients/vidaa.md) |
| Web | Browsers, installable PWA | [`clients/web.md`](clients/web.md) |
| Xbox | Xbox One/Series consoles: native UWP/XAML app (portable core built and tested, UWP head unverified), plus a zero-install Edge-browser fallback | [`clients/xbox.md`](../clients/xbox.md), [architecture detail](clients/xbox.md) |

Code sharing follows the grain of the platforms rather than forcing every
client through one runtime:

- Android Mobile and Android TV use one APK and responsive React/TypeScript
  presentation. Runtime UI-mode detection selects touch or D-pad lifecycle,
  input, update, notification, and fullscreen behaviour.
- webOS, Tizen, VIDAA, Android Mobile, and Android TV consume the same Playarr
  Web routes and responsive design, selecting their input and playback profile
  at runtime.
- iOS stands alone at the UI layer (SwiftUI, AVFoundation, FairPlay) because
  nothing else shares Swift or Apple's DRM stack, but still consumes the
  same OpenAPI-generated client contract as every other platform.
- Xbox also stands alone at the UI layer — a native UWP/XAML app
  (`clients/xbox/`) with its own screens and its own portable-core/native-head
  split, not a wrapper around `clients/tv-web`. It is the only platform with
  two independently maintained routes at once: the native app for whenever a
  package exists, and the shared Playarr Web app's Edge-on-Xbox browser
  detection as a standing zero-install fallback. See
  [`clients/xbox.md`](clients/xbox.md) for why native was chosen over a
  packaged web shell here specifically.

This table is also already incomplete for reasons unrelated to Xbox:
`clients/apple-tv/`, `clients/roku/`, and `clients/harmony/` (HarmonyOS,
covering `playarr_model::ClientPlatform`'s `HarmonyMobile`/`HarmonyTv`
variants) exist as real client trees in the repository, and `ClientPlatform`
also has `Cast` and `TvFire` variants, none of which have a row here or a doc
under `docs/architecture/clients/`. That drift predates this pass and is
noted here rather than fixed, to keep this change scoped to Xbox.

Every client, regardless of code sharing, is required to speak the same
versioned API contract — see [`versioning-policy.md`](../versioning-policy.md)
for how that contract is enforced and evolved without breaking clients that
can't update on demand (store review delays, no-OTA platforms).

## Why this is a monorepo

The server, every client (see "The client strategy" above), and the infra
manifests for all three deployment tiers live in one repository. This is a
deliberate choice, not incidental:

1. **The API contract is the coupling point, and the monorepo makes that
   coupling atomic.** A change that bumps `apiVersion` and a client change
   that adopts it can land in the same commit/PR, reviewed together. Across
   repos, that relationship has to be tracked out-of-band and is where
   version-skew bugs come from.
2. **One OpenAPI spec, generated clients for everyone.** The spec is
   generated from `utoipa`-annotated handlers in `playarr-api` into
   `backend/openapi/playarr.yaml`; Kotlin, Swift, and TypeScript client
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

- **No persisted `User`/`Policy` store.** `playarr-auth::InMemoryUserDirectory`
  and `playarr-auth::InMemoryAdminRegistry` are real, working
  implementations, not mocks — but there is no `UserRepo`/`PolicyRepo` in
  `playarr-db`, so accounts and admin status don't survive a restart and
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
