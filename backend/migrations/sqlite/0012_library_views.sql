-- `library_views` backs `streamarr_model::LibraryView` -- the "Views"
-- feature: named, saved filter+sort presets over the catalog, admin-
-- managed and global (one set per instance), surfaced to Playarr as
-- browsable shelves. See streamarr_model::library_view for the full
-- rationale.
--
-- Portability note (same convention as 0006_source_instances.sql): id is
-- TEXT (stringified UUID), timestamps are TEXT ISO-8601, is_default is
-- INTEGER 0/1 (not a SQL BOOLEAN -- see streamarr_db::codec::bool_to_i64's
-- doc comment for why), and `criteria` is an opaque JSON-encoded TEXT blob
-- (streamarr_model::ViewCriteria) rather than normalized columns, same
-- rationale as works.images/genres/tags in 0003_catalog.sql: nothing ever
-- filters/sorts at the SQL level on these fields, only after
-- CatalogService::resolve_view decodes them.

CREATE TABLE IF NOT EXISTS library_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    criteria TEXT NOT NULL DEFAULT '{}',
    -- One of "title" / "recent" / "released" -- same string convention as
    -- streamarr_api::catalog::BrowseQueryParams.sort.
    sort TEXT NOT NULL DEFAULT 'title',
    is_default INTEGER NOT NULL DEFAULT 0,
    default_order INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_views_name ON library_views (name);
