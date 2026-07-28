-- `playlists`/`playlist_items` back `playarr_model::Playlist`/`PlaylistItem`
-- -- named, ordered lists of works, owned by one user (a personal
-- playlist) or by nobody (`owner_user_id IS NULL` -- a "System" playlist,
-- admin-managed and visible to every user). Playlists nest via
-- `parent_playlist_id`, a self-reference, so e.g. "MCU" can have
-- "Sample Movie Golf" nested under it. See playarr_model::playlist for the
-- full rationale.
--
-- Portability note (same convention as 0012_library_views.sql): id/
-- owner_user_id/parent_playlist_id/work_id are all TEXT (stringified
-- UUID), timestamps are TEXT ISO-8601.

CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- NULL = a System playlist. No FK -- `users` rows can be deleted
    -- (playarr_api::users::delete_user_handler) and a personal playlist
    -- orphaned that way is intentionally left in place rather than
    -- cascade-deleted (same "don't destroy content over an account
    -- change" reasoning as watch_progress in 0010_watch_progress.sql),
    -- pending an explicit decision on what "delete a user's playlists too"
    -- should mean.
    owner_user_id TEXT,
    -- NULL = top-level. Self-referential FK; `ON DELETE CASCADE` here
    -- follows the same already-established, working convention every
    -- other cascading FK in this schema uses (works -> seasons/episodes/
    -- media_files, users -> watch_progress, etc. -- see e.g.
    -- 0003_catalog.sql/0010_watch_progress.sql), so deleting a parent
    -- playlist also removes its nested children automatically.
    parent_playlist_id TEXT REFERENCES playlists (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_playlists_owner_user_id ON playlists (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_parent_playlist_id ON playlists (parent_playlist_id);

CREATE TABLE IF NOT EXISTS playlist_items (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    -- No FK to works: works are arr-sync-owned and can be deleted/re-synced
    -- independently of any playlist referencing them (same "no FK to
    -- works" convention watch_progress.media_file_id already documents in
    -- 0010_watch_progress.sql) -- a dangling work_id is filtered out at the
    -- read layer, not prevented at the schema layer.
    work_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_id ON playlist_items (playlist_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_items_playlist_position ON playlist_items (playlist_id, position);
