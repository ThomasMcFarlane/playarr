-- Postgres mirror of ../sqlite/0015_playlists.sql -- see that file for the
-- full rationale. Numbered 0018 here (independent `Migrator` from the
-- sqlite side -- see 0009_source_instances.sql's own note on this
-- convention).

CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id TEXT,
    parent_playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_playlists_owner_user_id ON playlists (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_parent_playlist_id ON playlists (parent_playlist_id);

CREATE TABLE IF NOT EXISTS playlist_items (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    work_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_id ON playlist_items (playlist_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_items_playlist_position ON playlist_items (playlist_id, position);
