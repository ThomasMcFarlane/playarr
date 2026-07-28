-- `tdarr_connection` backs `playarr_model::TdarrConnection` -- Playarr Server's
-- single connection to a Tdarr instance (see that type's doc comment for
-- why this is a singleton, unlike `source_instances`). Always 0 or 1 rows,
-- enforced at the application layer (`TdarrConnectionRepo::upsert` always
-- targets the same fixed id) rather than a schema-level constraint, the
-- same convention `library_views`' seeded-default rows use fixed ids for.
--
-- Portability note (same convention as 0006_source_instances.sql):
-- id/timestamps are TEXT, the API key is plain TEXT despite the column
-- name (see that migration's own note -- no encryption-at-rest is applied
-- yet, tracked as a pre-existing gap this doesn't newly introduce).

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
