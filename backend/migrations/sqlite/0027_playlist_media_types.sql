-- Existing playlists contain work-level video items, so they migrate to video.
-- Audio items retain the owning artist work id and add the exact track id.
ALTER TABLE playlists
ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video'
CHECK (media_type IN ('video', 'audio'));

ALTER TABLE playlist_items ADD COLUMN track_id TEXT;

CREATE INDEX IF NOT EXISTS idx_playlist_items_track_id ON playlist_items (track_id);
