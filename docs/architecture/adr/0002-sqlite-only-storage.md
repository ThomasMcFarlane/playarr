# ADR 0002: SQLite-only storage

- **Status:** Accepted
- **Date:** 2026-10-07
- **Owners:** Playarr Server core team
- **Supersedes:** [ADR 0001](0001-storage-engine.md) (dual-backend storage engine)
- **Related:** [`docs/architecture/overview.md`](../overview.md),
  [`docs/architecture/distributed-design.md`](../distributed-design.md)

## Context

ADR 0001 chose SQLite for single-node installs and Postgres for the
docker-compose and Kubernetes tiers, and recorded a revisit trigger: if
migration-set drift became a recurring source of bugs, or the cost of two
query surfaces became a chronic tax, the decision should be re-examined.

That trigger has fired. Evidence:

- The SQLite migration 15 checksum outage: a migration edited after release
  broke startup on existing databases.
- A duplicate Postgres migration version 0053 (`0053_folder_media.sql` and
  `0053_media_file_languages.sql`) breaks every fresh Postgres install.
- The two migration sets drifted in numbering (for example the SQLite
  `0053_policy_can_request.sql` is `0054_policy_can_request.sql` on Postgres).
- CI never had a Postgres job, so the Postgres backend was compiled but not
  exercised against a live server; the "live-Postgres suite" promised as a
  follow-up in ADR 0001 never existed.
- Production already runs SQLite on every node. Multi-node operation works
  through peer sync, where each node keeps its own SQLite database. No
  deployment of ours uses Postgres.

## Decision

Playarr Server is SQLite-only. The Postgres backend is removed entirely:
the `postgres` cargo features, the `sqlx` Postgres driver, the dual-backend
abstraction layers that existed only for Postgres, the Postgres migration set
and the Postgres-only coordination and cache implementations. A
`postgres://` or `postgresql://` database URL is rejected at startup with a
clear error.

Multi-node deployments use peer sync, as in production today. Each node owns
its own SQLite database file.

## Consequences

**Positive**

- One migration set, one SQL dialect, one query surface to test. A schema
  change is a single migration.
- Every code path that ships is exercised by the existing CI.
- Smaller dependency tree and binary; no Postgres crates in `Cargo.lock`.

**Negative / accepted costs**

- The role-split, shared-database Kubernetes tier (several server replicas
  against one Postgres) is dropped. Kubernetes remains supported as a
  hosting platform for SQLite nodes that peer-sync with each other.
- Docker Compose with a Postgres service is dropped. Compose runs a single
  server with a SQLite data volume.
- Postgres-only features (advisory-lock leader election, `LISTEN`/`NOTIFY`
  cache invalidation) are no longer available. Cluster coordination relies
  on peer sync and per-node state.
- Existing Postgres databases are not migrated by Playarr. None are known to
  exist; anyone who created one must export their data before upgrading.

## Guardrails

- Existing SQLite migrations are never edited (sqlx checksums).
- CI fails if two files in `backend/migrations/sqlite` share a version number.

## Alternatives considered

- Keep both backends and add a Postgres CI job: rejected, because it
  preserves the double migration burden for a backend nothing uses.
- Embedded Postgres as the single engine: rejected for the reasons in
  ADR 0001, which still stand.
