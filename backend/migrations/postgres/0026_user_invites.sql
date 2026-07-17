-- Postgres mirror of ../sqlite/0023_user_invites.sql.
CREATE TABLE IF NOT EXISTS user_invites (
    token_hash TEXT PRIMARY KEY,
    created_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_invites_expires_at ON user_invites (expires_at);
