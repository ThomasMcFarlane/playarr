-- Postgres mirror of ../sqlite/0035_peer_leaf_availability.sql -- see that
-- file for the full rationale. Numbered 0038 here (independent `Migrator`
-- from the sqlite side -- see 0009_source_instances.sql's own note on this
-- convention). `BIGINT` for `bitrate`/`size_bytes`/`duration_ms` matches
-- SQLite's dynamically-sized `INTEGER` (Postgres's own `INTEGER` is a fixed
-- 32 bits and would silently narrow the range) -- same convention as
-- `media_files` (`0008_media_files.sql`/`0017_media_file_duration.sql`).

-- `title`/`kind`/`release_date`: see ../sqlite/0035_peer_leaf_availability.sql's
-- own note -- the reporting peer's own values, persisted so the
-- partial-cache-node `RemoteOnlyWork` case (§4.3) has something to display
-- when `local_work_id` is `NULL`.
CREATE TABLE IF NOT EXISTS peer_leaf_availability (
    peer_node_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    leaf_selector TEXT NOT NULL,
    group_library_id TEXT,
    availability TEXT NOT NULL,
    container TEXT,
    codec TEXT,
    bitrate BIGINT,
    size_bytes BIGINT,
    duration_ms BIGINT,
    local_work_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'movie',
    release_date TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (peer_node_id, provider, external_id, leaf_selector)
);
CREATE INDEX IF NOT EXISTS idx_peer_leaf_availability_local_work ON peer_leaf_availability (local_work_id);
