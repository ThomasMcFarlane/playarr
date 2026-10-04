-- PostgreSQL counterpart of SQLite migration 0042: first-class source-root and
-- file-derived folder browse cache.
--
-- Both path columns are server-only state. `reported_path` is the source
-- application's path and `local_path_override` is an explicit per-root
-- current-node override. API responses must project `source_root_folders`
-- into path-free DTOs. Roots are retained and marked inactive when a source
-- refresh no longer reports them so their scan cache can be reused if they
-- reappear.
--
-- Timestamps and flags follow the portable convention of the other migrations
-- (TEXT timestamps, INTEGER flags); sizes are BIGINT.

CREATE TABLE IF NOT EXISTS source_root_folders (
    id TEXT PRIMARY KEY,
    source_instance_id TEXT NOT NULL REFERENCES source_instances (id) ON DELETE CASCADE,
    source_root_id TEXT NOT NULL,
    reported_path TEXT NOT NULL,
    local_path_override TEXT,
    display_name TEXT NOT NULL,
    work_kind TEXT NOT NULL,
    accessible INTEGER NOT NULL DEFAULT 0,
    free_space_bytes BIGINT,
    total_space_bytes BIGINT,
    active INTEGER NOT NULL DEFAULT 1,
    scan_status TEXT NOT NULL DEFAULT 'pending',
    last_scanned_at TEXT,
    scan_error TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (source_instance_id, source_root_id)
);

CREATE INDEX IF NOT EXISTS idx_source_root_folders_active
    ON source_root_folders (active, work_kind, display_name);
CREATE INDEX IF NOT EXISTS idx_source_root_folders_source
    ON source_root_folders (source_instance_id, active);

-- One row per playable file beneath a source root. The physical path remains
-- in `media_files`; this table carries only a normalised root-relative path
-- and file-probed display metadata.
CREATE TABLE IF NOT EXISTS folder_media_entries (
    id TEXT PRIMARY KEY,
    root_folder_id TEXT NOT NULL REFERENCES source_root_folders (id) ON DELETE CASCADE,
    media_file_id TEXT NOT NULL UNIQUE REFERENCES media_files (id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    directory_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    work_kind TEXT NOT NULL,
    title TEXT NOT NULL,
    modified_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    scanned_at TEXT NOT NULL,
    UNIQUE (root_folder_id, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_folder_media_entries_directory
    ON folder_media_entries (root_folder_id, directory_path, file_name);
