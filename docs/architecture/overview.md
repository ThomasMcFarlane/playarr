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
Instead, the binary exposes a `serve` subcommand that takes a `--role` flag
(or a `roles:` list in its config file), and every subsystem — the HTTP API,
the library scanner, the on-demand transcode manager, the Tdarr background
work dispatcher, the cluster coordinator — checks a `RoleSet` bitflag at
startup before it registers routes or spawns background tasks:

```rust
bitflags::bitflags! {
    pub struct Role: u8 {
        const API         = 0b0000_0001;
        const WORKER      = 0b0000_0010;
        const COORDINATOR = 0b0000_0100;
        const EDGE        = 0b0000_1000;
    }
}

pub const STANDALONE: Role = Role::API
    .union(Role::WORKER)
    .union(Role::COORDINATOR);
```

A single-node install (systemd tier) runs one process with the `STANDALONE`
role set — API, transcode worker, and coordinator (a no-op in this case) all
in the same process, because there is nothing to coordinate with. A
Kubernetes deployment runs many processes from the *identical* binary, each
started with a narrower role: a `Deployment` of `--role api` pods behind a
`Service`, a separate `Deployment` of `--role worker` pods for transcoding,
and `--role coordinator` participating in leader election.

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
   feature.** Every crate that registers HTTP routes or spawns a background
   task takes a `&RoleSet` and asserts membership before doing so, so it is
   always obvious from reading the code which roles a given subsystem needs,
   without maintaining parallel Cargo feature matrices.

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
| 3 — Kubernetes | Managed or self-hosted cluster, autoscaled | 3+ | Postgres | `PostgresCoordinator`, gossip opt-in | [`deployment/kubernetes.md`](deployment/kubernetes.md) |

Tier 1 is the default and the one the majority of users will run: it must
work with zero external dependencies, survive an unattended reboot, and not
require the owner to understand clustering at all. Tiers 2 and 3 exist for
people who outgrow a single box or who are running Streamarr as shared
infrastructure for multiple households. See
[`docs/architecture/distributed-design.md`](distributed-design.md) for the
statelessness requirements and coordinator design that make moving between
tiers possible without a data migration story beyond "point at Postgres."

## Crate layout

The server is a Cargo workspace under `crates/`. Each crate has one job and
depends downward, never sideways into a peer's internals:

| Crate | Responsibility |
|---|---|
| `streamarr-core` | Shared domain types (library item, user, session, policy) with no I/O. Everything else depends on this; it depends on nothing in-workspace. |
| `streamarr-db` | The `sqlx`-based dual-backend storage engine (SQLite + Postgres). See [ADR 0001](adr/0001-storage-engine.md). Owns migrations and the `Database` trait. |
| `streamarr-auth` | Trust tiers, `Policy`, JWT issuance/verification, refresh token rotation, RFC 8628 device flow. See [`auth-modes.md`](auth-modes.md). |
| `streamarr-cluster` | The `ClusterCoordinator` trait and its `SingleNode` / `Postgres` / gossip implementations. See [`distributed-design.md`](distributed-design.md). |
| `streamarr-arr` | Adapter clients for the wrapped *arr ecosystem (Sonarr, Radarr, Prowlarr, Bazarr) — see "The arr-wrapping approach" below. |
| `streamarr-metadata` | Library scanning, metadata agents, artwork fetch/cache. |
| `streamarr-transcode` | The on-demand transcode session manager (ffmpeg process supervision, HLS/DASH packaging, session-to-node affinity). |
| `streamarr-tdarr` | Background transcode/optimisation job dispatch against a Tdarr-compatible worker pool. |
| `streamarr-session` | Playback session and device state: what's playing, on which device, at what position, and (for TV clients) device-pairing state. |
| `streamarr-api` | The axum HTTP surface: route registration gated by `RoleSet`, request/response types generated from the OpenAPI spec, versioning-middleware enforcement (see [`versioning-policy.md`](../versioning-policy.md)). |
| `streamarr-cli` | The `streamarr` binary entry point: argument parsing, config loading, role resolution, subcommands (`serve`, `update`, `migrate`, `admin`). |

`streamarr-core` sits at the bottom of the dependency graph on purpose:
domain types must be usable by the DB layer, the API layer, and background
workers alike without any of them pulling in the others' dependencies (an
API handler should never need to link `streamarr-tdarr`'s worker-pool client
just because it imports a shared type).

## The arr-wrapping approach

Streamarr does not reimplement indexing, acquisition, or subtitle-fetching
logic. That problem is already solved, extremely well, by the existing *arr
ecosystem (Sonarr for TV, Radarr for movies, Prowlarr for indexers, Bazarr
for subtitles). Reinventing it would be years of work duplicating mature,
actively maintained software for no user benefit.

Instead, `streamarr-arr` treats each *arr application as a managed external
service: Streamarr can supervise it as a subprocess/sidecar (systemd and
docker-compose tiers) or point at an existing externally-run instance
(common in Kubernetes, where a *arr app might already be a separate
`Deployment`), and talks to it over its existing REST API using an adapter
that normalises each app's data model into `streamarr-core` types. The user
sees one coherent Streamarr UI and one auth session; underneath, requests
like "add this series to my watchlist and acquire it" are translated into
Sonarr API calls, and Streamarr's library scanner treats the *arr app's
managed download directory as just another library root to index once files
land.

This keeps Streamarr's own scope disciplined: it owns *library and
playback*, not acquisition. The *arr apps keep their own UIs available for
power users who want them directly; Streamarr is additive, not a fork or a
replacement.

## The Tdarr background-vs-on-demand transcode split

Streamarr treats "transcode a video" as two unrelated problems with
unrelated latency, resource, and failure-mode requirements, and refuses to
let one code path serve both:

- **Background transcoding** (`streamarr-tdarr`) is library-wide
  optimisation: re-encoding a library toward more efficient codecs (e.g.
  H.264 → HEVC/AV1) or fixing container issues, queued against a pool of
  Tdarr-compatible worker nodes, low priority, fully resumable, and allowed
  to take hours. Progress is checkpointed in the database, so a worker node
  dying mid-job just means the job gets picked up by another worker; nothing
  about it is latency-sensitive.
- **On-demand transcoding** (`streamarr-transcode`) is what happens the
  moment someone presses play and their device can't direct-play the source
  (wrong codec, insufficient bandwidth, no hardware decode support). This
  spins up a supervised `ffmpeg` process *right now*, packages it as
  HLS/DASH segments, and must start producing playable segments in low
  single-digit seconds. It is inherently ephemeral and — critically — pinned
  to the node that started it (see the session-affinity discussion in
  [`distributed-design.md`](distributed-design.md)); if that node dies, the
  session dies with it and the client has to restart playback.

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
- webOS, Tizen, and (where the fallback applies) VIDAA are all
  Chromium/WebKit-based TV runtimes, so they share a "TV shell" — the same
  React/TypeScript codebase used by the Web client, with a platform-adapter
  layer that swaps out remote-control input handling and the platform's
  native playback/DRM API (LG's webOS `<video>`+EME, Samsung's `AVPlay`)
  underneath a common player interface.
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
2. **One OpenAPI spec, generated clients for everyone.** The spec lives in
   `crates/streamarr-api/openapi.yaml`; Kotlin, Swift, and TypeScript client
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
