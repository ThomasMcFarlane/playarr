-- Postgres mirror of ../sqlite/0034_group_libraries.sql -- see that file
-- for the full rationale. Numbered 0037 here (independent `Migrator` from
-- the sqlite side -- see 0009_source_instances.sql's own note on this
-- convention).

CREATE TABLE IF NOT EXISTS group_libraries (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

ALTER TABLE source_instances ADD COLUMN group_library_id TEXT;

ALTER TABLE policies ADD COLUMN group_library_allow TEXT NOT NULL DEFAULT '[]';
