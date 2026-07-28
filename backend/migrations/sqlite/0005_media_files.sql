-- `media_files` table backing `playarr_model::MediaFile` and the
-- `MediaFileRepo` trait in `playarr-db::repo`. A `MediaFile` is the
-- on-disk file a source *arr instance imported; `leaf_ref` records which
-- leaf of the parent `works` aggregate (see `0003_catalog.sql`) the file is
-- the source for -- the work itself for movies, or a specific
-- episode/track/book id (from `0004_catalog_children.sql`) for
-- series/music/books.
--
-- Portability note (same convention as `0002_analytics.sql`/
-- `0003_catalog.sql`): ids are TEXT (stringified UUIDs), and `leaf_ref` is
-- encoded into a single TEXT column the same way
-- `work_external_refs.provider`/`ExternalProvider::Other` already is (see
-- `playarr_db::codec::provider_to_str`) -- the data-less `LeafRef::Work`
-- variant as its own bare discriminant string ("work"), and the
-- data-carrying variants as "<discriminant>:<uuid>" (e.g.
-- "episode:3fa8..."), rather than a second nullable leaf-id column. See
-- `playarr_db::codec::leaf_ref_to_str`/`leaf_ref_from_str` for the one
-- place that encoding lives.

CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works (id) ON DELETE CASCADE,
    leaf_ref TEXT NOT NULL,
    path TEXT NOT NULL,
    container TEXT NOT NULL,
    codec TEXT NOT NULL,
    bitrate INTEGER,
    size_bytes INTEGER NOT NULL,
    source_instance_id TEXT NOT NULL,
    source_file_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_files_work_id ON media_files (work_id);

-- Backs `MediaFileRepo::find_by_leaf` (work_id + leaf_ref -> the file that
-- plays that leaf).
CREATE INDEX IF NOT EXISTS idx_media_files_leaf ON media_files (work_id, leaf_ref);

-- Backs `MediaFileRepo::upsert_by_source`: `ON CONFLICT (source_instance_id,
-- source_file_id)` needs a real unique index to target. Standard SQL unique
-- semantics (both SQLite and Postgres) treat NULL as distinct from every
-- other value, including another NULL, so rows with no `source_file_id`
-- never collide against each other here -- `upsert_by_source` always
-- inserts a fresh row for those rather than "updating" an unrelated one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_files_source ON media_files (source_instance_id, source_file_id);
