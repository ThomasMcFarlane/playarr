-- Postgres mirror of `../sqlite/0020_profile_pins.sql`.
CREATE TABLE IF NOT EXISTS profile_pins (
    user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
