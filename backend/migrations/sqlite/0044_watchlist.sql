-- Per-profile watchlist (a profile is a user). A row is a snapshot of a
-- discovery title so titles that are not in the library yet (requestable
-- titles, games) can still be listed. `title_key` is the discovery identity
-- key (see playarr_model::discovery::identity_key).
CREATE TABLE IF NOT EXISTS watchlist_items (
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    year INTEGER,
    work_id TEXT,
    external_refs TEXT NOT NULL,
    poster_url TEXT,
    added_at TEXT NOT NULL,
    PRIMARY KEY (user_id, title_key)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user_added
    ON watchlist_items (user_id, added_at DESC);
