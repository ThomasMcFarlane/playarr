-- Postgres mirror of ../sqlite/0017_credits.sql -- see that file for the
-- full rationale. Numbered 0020 here (independent `Migrator` from the
-- sqlite side -- see 0009_source_instances.sql's own note on this
-- convention).

CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tmdb_id INTEGER,
    headshot_url TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_tmdb_id ON people (tmdb_id);

CREATE TABLE IF NOT EXISTS credits (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works (id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    role_kind TEXT NOT NULL,
    character TEXT,
    department TEXT,
    job TEXT,
    sort_order INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credits_work_id ON credits (work_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_credits_person_id ON credits (person_id);
