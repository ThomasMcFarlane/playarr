-- Administrator-issued, expiring, one-use invitations for Playarr account
-- sign-up. The raw bearer token is never stored: token_hash is its SHA-256
-- digest. ISO-8601 timestamps sort chronologically in their canonical UTC
-- representation, allowing an atomic conditional DELETE during redemption.
CREATE TABLE IF NOT EXISTS user_invites (
    token_hash TEXT PRIMARY KEY,
    created_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_invites_expires_at ON user_invites (expires_at);
