-- Table-backed key/value cache for `PostgresListenNotify`
-- (`playarr-cache`), used by `DeploymentTier::MultiNodePostgres` (Postgres
-- without Redis). `LISTEN`/`NOTIFY` has no storage of its own, so
-- `PostgresListenNotify::{get,set,delete}` read and write this table
-- directly; `PostgresListenNotify` also runs a periodic background sweep
-- deleting rows past `expires_at` (a `get` past expiry already treats the
-- row as absent regardless, so the sweep is space reclamation, not a
-- correctness concern).
--
-- Postgres-only: this migration deliberately has no `migrations/sqlite`
-- counterpart, because `PostgresListenNotify` itself is only ever
-- constructed for `DeploymentTier::MultiNodePostgres`, which is
-- Postgres-only by definition — unlike `0002_analytics.sql`/`0003_catalog.sql`,
-- there's no cross-engine portability concern here, so native `BYTEA`/
-- `TIMESTAMPTZ` types are used rather than the TEXT-everywhere convention
-- those migrations use for SQLite compatibility.
CREATE TABLE IF NOT EXISTS cache_entries (
    key TEXT PRIMARY KEY,
    value BYTEA NOT NULL,
    expires_at TIMESTAMPTZ
);

-- Partial index: only expiring rows are ever scanned by the sweep, and
-- rows with `expires_at IS NULL` (no expiry) would otherwise bloat an
-- unconditional index for no benefit.
CREATE INDEX IF NOT EXISTS idx_cache_entries_expires_at
    ON cache_entries (expires_at)
    WHERE expires_at IS NOT NULL;
