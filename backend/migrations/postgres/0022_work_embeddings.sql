-- Postgres mirror of ../sqlite/0019_work_embeddings.sql -- see that file
-- for the full rationale. Numbered 0022 here (independent `Migrator` from
-- the sqlite side -- see 0009_source_instances.sql's own note on this
-- convention).

CREATE TABLE IF NOT EXISTS work_embeddings (
    work_id TEXT PRIMARY KEY REFERENCES works (id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    source_text TEXT NOT NULL,
    vector TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
