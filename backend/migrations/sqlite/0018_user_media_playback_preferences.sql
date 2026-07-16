-- Per-viewer playback choices for one concrete movie/episode file.
CREATE TABLE IF NOT EXISTS user_media_playback_preferences (
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    media_file_id TEXT NOT NULL REFERENCES media_files (id) ON DELETE CASCADE,
    quality_id TEXT NOT NULL DEFAULT 'original',
    audio_track_id TEXT,
    subtitle_track_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, media_file_id)
);
