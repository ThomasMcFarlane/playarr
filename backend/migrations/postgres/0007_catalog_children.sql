-- Postgres mirror of `../sqlite/0004_catalog_children.sql` -- see that file
-- for the full rationale. Numbered 0007 here (rather than 0004, matching the
-- sqlite side) because the two migration directories are independent
-- `Migrator`s (`SQLITE_MIGRATIONS` / `POSTGRES_MIGRATIONS` in
-- `streamarr-db::pool`), so their version numbers don't need to line up, and
-- because this file's `REFERENCES works (id)` foreign keys need `works` to
-- already exist -- it was originally 0005 (the next free slot when it was
-- added), but `0006_catalog.sql` -- the migration that actually creates
-- `works` -- landed with a *higher* number afterwards (itself a renumbering,
-- from an earlier `0003_catalog.sql` that collided with a concurrent task's
-- `0003_cluster_leader.sql`). Postgres enforces FK targets at
-- `CREATE TABLE` time, so running before 0006 would fail outright; SQLite
-- doesn't enforce FKs by default, which is why the sqlite side never showed
-- this. Renumbered to 0007 (after 0006) to fix the ordering.

CREATE TABLE IF NOT EXISTS seasons (
    id TEXT PRIMARY KEY,
    series_work_id TEXT NOT NULL REFERENCES works (id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    title TEXT,
    overview TEXT,
    monitored INTEGER NOT NULL DEFAULT 1,
    availability TEXT NOT NULL DEFAULT 'unknown',
    UNIQUE (series_work_id, season_number)
);

CREATE INDEX IF NOT EXISTS idx_seasons_series_work_id ON seasons (series_work_id);

CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
    episode_number INTEGER NOT NULL,
    title TEXT,
    overview TEXT,
    air_date TEXT,
    runtime_minutes INTEGER,
    monitored INTEGER NOT NULL DEFAULT 1,
    availability TEXT NOT NULL DEFAULT 'unknown',
    UNIQUE (season_id, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_episodes_season_id ON episodes (season_id);

CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    artist_work_id TEXT NOT NULL REFERENCES works (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    album_type TEXT NOT NULL,
    release_date TEXT,
    monitored INTEGER NOT NULL DEFAULT 1,
    availability TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_albums_artist_work_id ON albums (artist_work_id);

CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    album_id TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    disc_number INTEGER NOT NULL,
    track_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    duration_seconds INTEGER,
    availability TEXT NOT NULL DEFAULT 'unknown',
    UNIQUE (album_id, disc_number, track_number)
);

CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks (album_id);

CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    author_work_id TEXT NOT NULL REFERENCES works (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    isbn TEXT,
    release_date TEXT,
    series_name TEXT,
    series_position REAL,
    monitored INTEGER NOT NULL DEFAULT 1,
    availability TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_books_author_work_id ON books (author_work_id);
