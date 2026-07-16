-- Postgres mirror of ../sqlite/0010_watch_progress.sql.
CREATE TABLE IF NOT EXISTS watch_progress (
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    media_file_id TEXT NOT NULL REFERENCES media_files (id) ON DELETE CASCADE,
    position_ms BIGINT NOT NULL,
    duration_ms BIGINT NOT NULL,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, media_file_id)
);

CREATE INDEX IF NOT EXISTS idx_watch_progress_user_updated
    ON watch_progress (user_id, updated_at DESC);
