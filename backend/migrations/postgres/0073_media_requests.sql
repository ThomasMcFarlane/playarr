-- Unified media requests and Ombi/Seerr integrations (TASKS 280-287).
-- One media_requests row per title identity (title_key); origin and the
-- per-system request ids drive sync-loop avoidance. request_integrations
-- holds the Ombi/Seerr connections (API key stored here or read from an
-- environment variable named by api_key_env). request_settings is a small
-- key/value table (backend mode). No foreign keys: users are soft-deleted and
-- replicated between peers. Mirror: ../sqlite/0073_media_requests.sql.
CREATE TABLE IF NOT EXISTS media_requests (
    id TEXT PRIMARY KEY,
    title_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    year INTEGER,
    tmdb_id BIGINT,
    tvdb_id BIGINT,
    imdb_id TEXT,
    poster_url TEXT,
    seasons TEXT NOT NULL DEFAULT '[]',
    requester_user_id TEXT,
    requester_label TEXT,
    status TEXT NOT NULL,
    origin TEXT NOT NULL,
    ombi_request_id TEXT,
    seerr_request_id TEXT,
    direct_instance_id TEXT,
    status_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_requests_user ON media_requests (requester_user_id);
CREATE INDEX IF NOT EXISTS idx_media_requests_tmdb ON media_requests (kind, tmdb_id);
CREATE INDEX IF NOT EXISTS idx_media_requests_tvdb ON media_requests (kind, tvdb_id);

CREATE TABLE IF NOT EXISTS request_integrations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    api_key_env TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    poll_interval_secs INTEGER NOT NULL DEFAULT 300,
    mapping TEXT NOT NULL DEFAULT 'email',
    user_map TEXT NOT NULL DEFAULT '{}',
    webhook_secret TEXT NOT NULL DEFAULT '',
    last_sync_at TEXT,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS request_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
