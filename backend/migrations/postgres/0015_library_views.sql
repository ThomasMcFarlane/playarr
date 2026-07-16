-- Postgres mirror of ../sqlite/0012_library_views.sql -- see that file for
-- the full rationale. Numbered 0015 here (independent `Migrator` from the
-- sqlite side -- see `0009_source_instances.sql`'s own note on this
-- convention).

CREATE TABLE IF NOT EXISTS library_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    criteria TEXT NOT NULL DEFAULT '{}',
    -- One of "title" / "recent" / "released" -- same string convention as
    -- streamarr_api::catalog::BrowseQueryParams.sort.
    sort TEXT NOT NULL DEFAULT 'title',
    -- 0/1, not a native `boolean` column -- kept as `INTEGER` on this side
    -- too so the application-level SQL and Rust row-mapping in
    -- `streamarr_db::codec` stay identical across both engines; see
    -- `bool_to_i64` for the SQLite driver limitation that motivates it.
    is_default INTEGER NOT NULL DEFAULT 0,
    default_order INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_views_name ON library_views (name);
