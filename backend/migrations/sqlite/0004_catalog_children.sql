-- Kind-specific children of the `works` aggregate root (see `0003_catalog.sql`
-- for `works`/`work_external_refs`): seasons/episodes for `WorkKind::Series`,
-- albums/tracks for `WorkKind::Artist`, books for `WorkKind::Author`.
-- `WorkKind::Movie` has no children.
--
-- These get their own migration/tables rather than living in
-- `streamarr-db` because that crate's `WorkRepo` deliberately scopes them
-- out (see its doc comment: "Season/episode/album/track/book children ...
-- get their own repositories once the catalog write path is built"); until
-- that write path exists, `streamarr-catalog`'s `CatalogService::get_by_id`
-- is the only reader, so it owns the schema.
--
-- Portability note (same convention as `0002_analytics.sql`/`0003_catalog.sql`):
-- ids/dates are TEXT (ISO-8601 for `air_date`/`release_date`, i.e.
-- `YYYY-MM-DD`), and `monitored` is INTEGER (0/1) rather than a native
-- BOOLEAN -- deliberately, since `sqlx::Any` (the driver `DbPool` dispatches
-- through) has no `Bool` decode path for SQLite's dynamically-typed INTEGER
-- storage class, only Small/Integer/BigInt; keeping every boolean-shaped
-- column an INTEGER here sidesteps that entirely rather than working around
-- it per-query.

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
