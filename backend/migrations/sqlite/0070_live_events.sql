-- Per-user live change stream (docs/architecture/live-events.md).
-- Bounded retention: rows older than ten minutes (and any beyond a hard row
-- cap) are purged by the publisher and the stream loop. Times are Unix epoch
-- milliseconds. Postgres mirror: ../postgres/0070_live_events.sql.
CREATE TABLE IF NOT EXISTS live_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    kind TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    changed TEXT NOT NULL,
    source_instance_id TEXT,
    created_ms BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_events_created ON live_events (created_ms);
