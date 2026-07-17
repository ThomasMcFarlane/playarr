CREATE TABLE IF NOT EXISTS push_registrations (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('web', 'android-mobile', 'android-tv')),
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_registrations_user
    ON push_registrations (user_id);
