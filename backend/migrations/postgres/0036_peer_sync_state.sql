-- Postgres mirror of ../sqlite/0033_peer_sync_state.sql -- see that file
-- for the full rationale. Numbered 0036 here (independent `Migrator` from
-- the sqlite side -- see 0009_source_instances.sql's own note on this
-- convention).

CREATE TABLE IF NOT EXISTS peer_sync_state (
    peer_node_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    cursor TEXT,
    last_synced_at TEXT,
    PRIMARY KEY (peer_node_id, entity)
);

CREATE TABLE IF NOT EXISTS sync_conflict_log (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    winning_peer_id TEXT NOT NULL,
    losing_peer_id TEXT NOT NULL,
    losing_value_json TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    requires_admin_review INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sync_conflict_log_review ON sync_conflict_log (requires_admin_review);

ALTER TABLE users ADD COLUMN updated_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE users ADD COLUMN origin_peer_id TEXT;
ALTER TABLE policies ADD COLUMN updated_at TEXT;
ALTER TABLE policies ADD COLUMN deleted_at TEXT;
ALTER TABLE policies ADD COLUMN origin_peer_id TEXT;
ALTER TABLE source_instances ADD COLUMN updated_at TEXT;
ALTER TABLE source_instances ADD COLUMN deleted_at TEXT;

-- Backfill -- see the sqlite mirror for the full rationale. `to_char(now()
-- AT TIME ZONE 'UTC', ...)` is this codebase's standard Postgres form for
-- "now, in the same ISO-8601 TEXT shape every other timestamp column
-- uses" -- same convention as `0001_init.sql`/`0002_analytics.sql`.
UPDATE users SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE policies SET updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE updated_at IS NULL;
UPDATE source_instances SET updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE updated_at IS NULL;
