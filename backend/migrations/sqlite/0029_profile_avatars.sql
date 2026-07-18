-- One server-backed avatar choice per Playarr profile. Custom photos are
-- cropped and resized by the client before their JPEG data URL is stored.
CREATE TABLE IF NOT EXISTS user_profile_avatars (
    user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    preference TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
