-- Postgres mirror of `../sqlite/0005_media_files.sql` -- see that file for
-- the full rationale. Numbered 0008 here (after `0006_catalog.sql`, which is
-- where `works` actually gets created on this side -- see
-- `0007_catalog_children.sql`'s own note on the same renumbering) because
-- this migration's `work_id` column `REFERENCES works (id)`, and Postgres
-- enforces FK targets at `CREATE TABLE` time. BIGINT for `bitrate`/
-- `size_bytes` matches SQLite's dynamically-sized `INTEGER` (Postgres's own
-- `INTEGER` is a fixed 32 bits and would silently narrow the range -- see
-- the same note in `0006_catalog.sql` for `renditions.bitrate`).

CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works (id) ON DELETE CASCADE,
    leaf_ref TEXT NOT NULL,
    path TEXT NOT NULL,
    container TEXT NOT NULL,
    codec TEXT NOT NULL,
    bitrate BIGINT,
    size_bytes BIGINT NOT NULL,
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
