-- Postgres mirror of `../sqlite/0009_refresh_token_families.sql` -- see
-- that file for the full rationale. Durable storage for
-- `streamarr_auth::refresh::RefreshTokenRecord`, replacing the previous
-- in-process-only `InMemoryRefreshTokenStore`.

CREATE TABLE IF NOT EXISTS refresh_token_families (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    family_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    current_hash TEXT NOT NULL,
    used_hashes TEXT NOT NULL DEFAULT '[]',
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    rotated_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
);
