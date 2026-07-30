-- Postgres mirror of ../sqlite/0042_folder_media.sql. Keep booleans as
-- INTEGER 0/1 and UUIDs/timestamps as TEXT so sqlx::Any uses one portable
-- row representation. BIGINT mirrors SQLite's dynamically-sized INTEGER for
-- byte counts.
--
-- `reported_path` and `local_path_override` are server-only filesystem state
-- and must never be exposed by a viewer API DTO.

CREATE TABLE source_root_folders (
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

CREATE INDEX idx_source_root_folders_active
    ON source_root_folders (active, work_kind, display_name);
CREATE INDEX idx_source_root_folders_source
    ON source_root_folders (source_instance_id, active);

CREATE TABLE folder_media_entries (
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

CREATE INDEX idx_folder_media_entries_directory
    ON folder_media_entries (root_folder_id, directory_path, file_name);
