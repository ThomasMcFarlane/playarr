-- Optional, profile-specific PIN locks. Kept separate from `users` so a
-- short household PIN never replaces the account's full password hash.
CREATE TABLE IF NOT EXISTS profile_pins (
    user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
