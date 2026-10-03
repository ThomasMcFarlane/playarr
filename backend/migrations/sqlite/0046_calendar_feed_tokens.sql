-- Per-user revocable tokens for the external iCal subscription URL.
-- Only a SHA-256 of the token is stored. At most one active token per user.
CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_feed_tokens_active_user
    ON calendar_feed_tokens (user_id) WHERE revoked_at IS NULL;
