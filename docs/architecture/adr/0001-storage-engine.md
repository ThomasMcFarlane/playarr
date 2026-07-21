# ADR 0001: Dual-Backend Storage Engine (SQLite for single-node, Postgres for multi-node)

- **Status:** Accepted
- **Date:** 2026-07-15
- **Owners:** Streamarr core team
- **Related:** [`docs/architecture/overview.md`](../overview.md) (crate layout, deployment tiers),
  [`docs/architecture/distributed-design.md`](../distributed-design.md) (`ClusterCoordinator`)

## Context

Streamarr must run acceptably across three very different deployment tiers
(see the overview doc's tier table): a single unattended process on
consumer NAS/ARM hardware, a small docker-compose deployment, and a
horizontally scaled Kubernetes cluster. All three tiers need a relational
store for the same schema — library metadata, users, sessions, policies,
transcode job state, cluster membership — and the persistence layer has to
be chosen once, early, because the domain layer (`streamarr-model`) and every
crate above it will be written against whatever abstraction is chosen here.

Three shapes of solution were on the table:

1. **Postgres everywhere**, including Tier 1 (systemd/NAS), requiring every
   single-node install to run a full Postgres server as a sibling process or
   dependency.
2. **An embedded/bundled Postgres** used as the *default* backend at every
   tier — i.e. Streamarr ships and manages its own Postgres server process
   internally (via an embedded-postgres approach: a bundled `postgres`
   binary per target triple, started and stopped by the `streamarr` process
   itself), so the rest of the codebase only ever talks to one database
   engine, full stop.
3. **A dual backend**: SQLite as the default, embedded, zero-dependency
   engine for Tier 1, and Postgres for Tiers 2 and 3, where a real database
   server is already an expected and normal part of the deployment (a
   docker-compose service, a managed or in-cluster Postgres instance).

The deciding constraint is Tier 1. Streamarr's single-node tier is targeted
explicitly at NAS devices (Synology, QNAP), Raspberry Pi–class ARM boards,
and other consumer hardware running unattended, often for months between
reboots, administered by people who are not database operators. Whatever
runs there has to be extremely hard to get into a broken state, and cheap to
recover when it does.

### Why option 2 (embedded/bundled Postgres) was seriously considered

Option 2 is attractive on paper: it collapses the storage layer to a single
engine, meaning one set of migrations, one SQL dialect to write against, one
set of Postgres-only features (`LISTEN`/`NOTIFY`, advisory locks, `JSONB`
operators) available unconditionally everywhere, and no need for the
`streamarr-db` crate to abstract over two engines' quirks at all. Several
embedded-Postgres approaches exist in the Rust ecosystem (bundling a
`postgres` binary per platform and driving it as a managed child process),
and this is a well-trodden pattern in other self-hosted software.

It was rejected as the **default** for Tier 1 for concrete reliability
reasons specific to the hardware Tier 1 targets:

- **ARM binary distribution is a real packaging burden.** A bundled Postgres
  needs a working, tested `postgres` server binary for every architecture
  Streamarr supports as a single-node install — at minimum `aarch64` (NAS,
  Raspberry Pi 4/5) and `armv7` (older Pi boards still in the wild) in
  addition to `x86_64`. Getting this wrong silently (a subtly broken ARM
  build of the bundled engine) is a materially worse failure mode than
  SQLite, which is a few hundred kilobytes of C compiled directly into the
  binary via the same toolchain that builds Streamarr itself, with no
  separate server binary to source or verify per architecture.
- **fsync/WAL behaviour on the storage these devices actually use is
  unpredictable.** NAS filesystems (btrfs with NAS-vendor overlays, SMB/NFS
  network shares that a user may accidentally point the data directory at),
  SD cards on Raspberry Pi, and USB-attached spinning disks are all common
  in Tier 1 and are all known to interact badly with a full RDBMS's
  durability assumptions (fsync latency spikes, silent write reordering on
  some NAS filesystem layers, SD card wear). SQLite's WAL mode is
  considerably more forgiving here and is the same engine already trusted by
  numerous other self-hosted single-node NAS software for exactly this
  reason.
- **Process supervision doubles.** A bundled Postgres is a second process
  Streamarr has to start, health-check, and crash-recover *itself*, on top
  of already being responsible for its own process lifecycle under systemd.
  A wedged or corrupted embedded Postgres data directory on an unattended
  NAS, with no operator watching, is a support burden Streamarr cannot
  absorb for its primary, most common deployment tier. SQLite has no
  separate process to wedge.
- **Startup latency and resource floor.** A Postgres server process,
  bundled or not, has a meaningfully higher idle memory footprint and
  startup time than an embedded SQLite connection, which matters on the
  lower end of Tier 1 hardware (1–2GB RAM NAS boxes) where Streamarr is
  competing for resources with the NAS vendor's own OS and other
  self-hosted apps already running on the box.

None of these problems are hypothetical; they are the standard set of
failure modes cited against running full RDBMS servers on consumer NAS/ARM
hardware, and Tier 1 is explicitly the tier for that hardware.

## Decision

Streamarr uses a **dual-backend storage engine, selected via `sqlx`**:

- **SQLite** is the default and only supported backend for **Tier 1
  (systemd/single-node)**. It requires no separate server process, no
  network port, and no operator action; the database is a file inside
  Streamarr's data directory.
- **Postgres** is the default and only supported backend for **Tier 2
  (docker-compose)** and **Tier 3 (Kubernetes)**, where a real database
  server is already a normal, expected part of the deployment topology (a
  `postgres` service in `docker-compose.prod.yml`, or an in-cluster/managed
  Postgres referenced by the Helm chart's `values.yaml`).

Implementation shape in `streamarr-db` (as actually built — see that
crate's `src/pool.rs`, `src/codec.rs`, and `src/repo/*.rs`):

- `DbPool` is a single concrete type alias, `sqlx::AnyPool` — not a
  hand-rolled `Database` trait. `sqlx::Any` dispatches to whichever driver
  is compiled in (the `sqlite`/`postgres` Cargo features, both enabled in
  every release binary — this is a runtime-selected backend, not a
  build-time one, because Tier 1 → Tier 2/3 migration is a supported
  upgrade path) based on the connection URL's scheme, once
  `sqlx::any::install_default_drivers()` has registered them.
- `sqlx::Any`'s own placeholder syntax is *not* translated between engines
  the way an ORM query builder's would be: text bound for `Any` is passed
  straight through to whichever concrete driver backs the connection, so it
  must already be in that driver's native style (`?` for SQLite, `$1, $2,
  ...` for Postgres). Each repository (`SqlxWorkRepo`, `SqlxDeviceRepo`,
  `SqlxRenditionRepo`, `SqlxMediaFileRepo`) detects which backend it's
  actually talking to once, at construction, via a `Backend::detect` helper
  that reads the scheme off the pool's connect URL, then `match`es on that
  `Backend` to pick between two hardcoded SQL strings per query. There is
  no single trait method (`transaction`/`migrate`/typed query helpers)
  hiding this — every repo does its own backend `match`, by design, so a
  reader never has to trust an abstraction to know which SQL text a given
  query actually sends.
- A second, related portability gap this ADR didn't anticipate: `sqlx::Any`'s
  own type system only encodes/decodes `bool`/`i16`/`i32`/`i64`/`f32`/`f64`/
  `String`/`Vec<u8>` — there is no `Uuid` or `chrono` support at the `Any`
  layer, and SQLite's bridge into `Any` has no mapping at all for a
  `BOOLEAN`-affinity column. `streamarr-db::codec` is the one place every
  repository maps its domain types to one of those primitives: UUIDs and
  timestamps round-trip as `TEXT` (RFC 3339 with millisecond precision for
  timestamps, parsed back with `chrono`), booleans as `INTEGER` `0`/`1`
  rather than a native `BOOLEAN` column, and domain enums as short
  snake_case strings. This keeps the mapping from drifting between the
  `sqlite`/`postgres` query bodies that use it, at the cost of every row
  read/write going through an explicit encode/decode step rather than
  sqlx's native type support.
- Migrations are maintained as **parallel migration sets**, embedded at
  compile time via `sqlx::migrate!` from `backend/migrations/sqlite/` and
  `backend/migrations/postgres/` (workspace-root-relative — not nested
  inside `streamarr-db`'s own crate directory), and run automatically at
  process startup (`streamarr_db::run_migrations`, called from
  `backend/src/main.rs`'s `connect_and_migrate`) rather than requiring a
  separate `migrate` subcommand. The two sets are schema-equivalent for the
  tables both backends need, but are **not** migration-number-aligned 1:1:
  Postgres has two migrations with no SQLite counterpart at all
  (`0003_cluster_leader.sql`, `0004_cache_entries.sql`) for the two things
  that are genuinely Postgres-only (see the next bullet and
  [`distributed-design.md`](../distributed-design.md)).
- Backend selection is purely a function of `DATABASE_URL`'s scheme (a
  `sqlite:...` value resolves `streamarr_config::DeploymentTier::SingleNode`;
  `postgres://`/`postgresql://` resolves one of the two multi-node tiers,
  further split on whether `REDIS_URL` is also set) — there is no separate
  `database.backend` config key to keep in sync with it.
- Anything that is genuinely Postgres-only and has no reasonable SQLite
  substitute — advisory-lock-based leader election and the `cluster_leader`
  heartbeat table, in `PostgresCoordinator` — is not forced into
  `streamarr-db`'s `AnyPool`-based repositories at all. It lives in its own
  crate, `streamarr-coordination`, with an explicit `SingleNodeCoordinator`
  no-op counterpart for Tier 1, rather than being faked with a
  lowest-common-denominator abstraction that would compromise the Postgres
  implementation to accommodate SQLite. See
  [`distributed-design.md`](../distributed-design.md).
- **Known gap:** "both backends get real test coverage" is aspirational,
  not yet fully true. `cargo test --workspace --all-features` runs on
  every change and gives SQLite paths real coverage (an in-memory
  `sqlite::memory:` pool, migrated for real), but
  Postgres-only logic (`PostgresCoordinator`'s advisory locks,
  `PostgresListenNotify`) is unit-tested against the literal SQL text and
  local in-process state it produces, not against a live Postgres server —
  see `streamarr-coordination`'s own test module doc comment for why that
  was a deliberate choice (connection-failure behaviour to a closed port is
  environment-dependent and was a source of flaky tests) rather than an
  oversight. A live-Postgres integration suite is a documented follow-up,
  not something this pass claims already exists.

## Consequences

**Positive**

- Tier 1 installs remain genuinely zero-dependency: no server process to
  install, configure, or lose data to on the hardware most likely to be run
  unattended by non-experts.
- Each backend is used exactly where it is strong: SQLite for single-writer
  embedded durability, Postgres for concurrent multi-node access, advisory
  locks, and the query patterns `ClusterCoordinator` needs.
- File-backed SQLite pools use WAL journal mode and a 30-second busy timeout
  on every pooled connection. Readers can therefore continue while the single
  SQLite writer commits, and short background-write collisions wait instead
  of surfacing `database is locked` across API and sync paths.
- The storage engine choice is decoupled from the deployment-tier decision
  a user makes, and matches the operational reality of that tier rather than
  forcing one engine's assumptions onto both.
- No dependency on the reliability of a bundled third-party server binary
  per architecture; SQLite is compiled from source as part of the normal
  Rust build.

**Negative / accepted costs**

- **Two query surfaces to test — and, as of this pass, only one of them is
  actually exercised in CI.** Every non-trivial query path needs test
  coverage against both SQLite and Postgres in principle, but today only
  the SQLite path gets that (a real, migrated, in-memory pool in every
  repo's test module); the Postgres-specific branches inside each repo's
  `match self.backend` are exercised by `cargo check`/compilation and, for
  `PostgresCoordinator`/`PostgresListenNotify`, by SQL-text assertions
  against a `connect_lazy` pool — not by a live Postgres server anywhere in
  this workspace's test suite yet. See the "Known gap" note above.
- **Two migration sets to write and keep in sync.** A schema change is not
  "add one migration," it is "add two migrations that must remain
  semantically equivalent" (except for the small number of genuinely
  Postgres-only tables, which only get a Postgres migration), which is
  extra author and review overhead on every schema change.
- **Backend-specific features are either avoided or isolated.** Postgres
  capabilities with no SQLite equivalent (`LISTEN`/`NOTIFY`, advisory locks,
  richer `JSONB` querying) cannot be used inside `streamarr-db`'s
  `AnyPool`-based repositories; they have to live in Postgres-only crates/
  code paths (as `streamarr-coordination::PostgresCoordinator` and
  `streamarr-cache::PostgresListenNotify` already do), which means some
  features are simply unavailable, or behave differently, on Tier 1.
- **Tier-1-to-Tier-2/3 migration requires an explicit data export/import
  step** (SQLite → Postgres), rather than "just point at a bigger Postgres,"
  since there is no shared storage between the two engines. This is
  considered acceptable because that migration is expected to be
  infrequent and deliberate (growing from a NAS to a cluster), not a
  routine operation.

## Alternatives considered and rejected

- **Postgres everywhere (option 1):** rejected outright — imposes a full
  RDBMS server requirement on every Tier 1 install, which is a materially
  worse default experience than SQLite for the hardware Tier 1 targets, with
  no corresponding benefit for the large majority of single-node users who
  will never need Postgres's concurrency guarantees.
- **Embedded/bundled Postgres as the default (option 2):** rejected as
  described above (ARM binary distribution, fsync/WAL behaviour on NAS
  filesystems, doubled process supervision, resource floor). Recorded here,
  not discarded silently, because the tradeoff it makes — one engine
  everywhere, in exchange for these risks — could look different once the
  dual-backend abstraction has real mileage on it.

## Revisit trigger

This decision is not considered final. If, once `streamarr-db`'s
dual-backend abstraction has been in production use for a while, the ongoing
cost of maintaining two query surfaces and two migration sets (the
"Negative" section above) turns out to be a chronic, worsening maintenance
tax rather than a one-time cost — for example, if Postgres-only features
keep getting requested for Tier 1, or if migration-set drift becomes a
recurring source of bugs — then it is worth spending a dedicated spike
re-evaluating an embedded/bundled Postgres approach (e.g. via a Rust crate
that manages a per-platform `postgres` binary, such as the
`postgresql_embedded` pattern) as a *replacement* for SQLite on Tier 1,
with the ARM reliability risks above re-tested against whatever the
ecosystem looks like at that time. This should be a deliberate, measured
spike triggered by observed pain, not a preemptive rewrite.
