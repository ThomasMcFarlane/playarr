-- Postgres mirror of ../sqlite/0027_playlist_media_types.sql.
ALTER TABLE playlists
ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video'
CHECK (media_type IN ('video', 'audio'));

ALTER TABLE playlist_items ADD COLUMN track_id TEXT;

CREATE INDEX IF NOT EXISTS idx_playlist_items_track_id ON playlist_items (track_id);
