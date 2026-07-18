-- Postgres mirror of `../sqlite/0029_profile_avatars.sql`.
CREATE TABLE IF NOT EXISTS user_profile_avatars (
    user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    preference TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
