-- Postgres mirror of ../sqlite/0030_download_tickets.sql.
CREATE TABLE IF NOT EXISTS download_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    media_file_id TEXT NOT NULL REFERENCES media_files (id) ON DELETE CASCADE,
    quality_id TEXT NOT NULL,
    profile TEXT,
    container TEXT NOT NULL,
    status TEXT NOT NULL,
    output_path TEXT,
    size_bytes BIGINT,
    error_message TEXT,
    requested_at TEXT NOT NULL,
    ready_at TEXT,
    expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_download_tickets_user_requested ON download_tickets (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_download_tickets_media_file ON download_tickets (media_file_id);
CREATE INDEX IF NOT EXISTS idx_download_tickets_status_expiry ON download_tickets (status, expires_at);
