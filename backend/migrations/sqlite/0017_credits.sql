-- `people`/`credits` back `playarr_model::{Person, Credit}` -- cast/crew
-- for a catalog work. Sourced only from Radarr's `/api/v3/credit`
-- endpoint today (verified live: Sonarr/Lidarr/Readarr have no equivalent
-- data), so in practice only movie `works` rows ever have credits -- see
-- `playarr_model::person`'s module doc comment.
--
-- Portability note (same convention as 0003_catalog.sql): ids are TEXT
-- (stringified UUIDs), the closed `CreditRole` enum is stored as two
-- columns (`role_kind` discriminant + the variant's own fields, nullable
-- per-variant) rather than JSON, since `role_kind` alone is enough for
-- every current read path (no need to parse the whole role to tell cast
-- from crew).

CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- Nullable (see `Person::tmdb_id`'s doc comment), but always present
    -- from the current Radarr-only source -- the dedup key `CreditRepo::
    -- find_person_by_tmdb_id` looks up by. NULLs don't collide against
    -- each other under a UNIQUE index in either engine, which is exactly
    -- what's wanted here (a hypothetical future no-tmdb-id person is never
    -- treated as "the same person" as another one).
    tmdb_id INTEGER,
    headshot_url TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_tmdb_id ON people (tmdb_id);

CREATE TABLE IF NOT EXISTS credits (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works (id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    -- 'cast' | 'crew'.
    role_kind TEXT NOT NULL,
    -- Cast-only.
    character TEXT,
    -- Crew-only.
    department TEXT,
    job TEXT,
    sort_order INTEGER NOT NULL
);

-- `CreditRepo::list_for_work`, ordered by `sort_order`.
CREATE INDEX IF NOT EXISTS idx_credits_work_id ON credits (work_id, sort_order);
-- `CreditRepo::list_works_for_person` -- the "find all content for this
-- person" endpoint's backing query.
CREATE INDEX IF NOT EXISTS idx_credits_person_id ON credits (person_id);
