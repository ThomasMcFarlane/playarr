-- Postgres mirror of ../sqlite/0021_tdarr_connection.sql -- see that file
-- for the full rationale. Numbered 0024 here (independent `Migrator` from
-- the sqlite side -- see 0009_source_instances.sql's own note on this
-- convention).

CREATE TABLE IF NOT EXISTS tdarr_connection (
    id TEXT PRIMARY KEY,
    base_url TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    tdarr_db_id TEXT NOT NULL,
    default_profile TEXT NOT NULL,
    worker_process TEXT NOT NULL,
    default_worker_limit INTEGER NOT NULL,
    throttled_worker_limit INTEGER NOT NULL,
    active_session_threshold INTEGER NOT NULL,
    throttle_check_interval_secs INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
