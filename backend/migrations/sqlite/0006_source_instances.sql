-- `source_instances` table backing `streamarr_model::SourceInstance`. This
-- is genuinely new persistence, not a mirror of an existing repo: today
-- `SourceInstance` configuration only lives in
-- `streamarr_api::source_registry::SourceInstanceRegistry`, an in-process
-- `DashMap` that starts empty on every boot (see that module's doc comment)
-- -- there is no `SourceInstanceRepo` in `streamarr-db::repo` yet. This
-- migration exists so that registry has somewhere real to load from/persist
-- to; wiring a `SourceInstanceRepo` and `streamarr-bin` boot-time hydration
-- on top of this table is a separate, follow-up change.
--
-- Portability note (same convention as `0003_catalog.sql`/`0005_media_files
-- .sql`): `id` is TEXT (a stringified UUID), and the closed `SourceKind`
-- enum is stored as its lowercase discriminant string ("sonarr", "radarr",
-- "lidarr", "bazarr", "prowlarr", "readarr" -- the same strings
-- `SourceKind`'s own `#[serde(rename_all = "snake_case")]` produces) via a
-- `source_kind_to_str`/`source_kind_from_str` pair in
-- `streamarr_db::codec`, following `work_kind_to_str`/`availability_to_str`
-- in that same file. `enabled_for_requests`/`best_effort` are `INTEGER`
-- 0/1, not a SQL `BOOLEAN` column, bound/read via
-- `streamarr_db::codec::bool_to_i64`/`bool_from_i64` exactly like
-- `works.monitored` in `0003_catalog.sql` -- see `bool_to_i64`'s doc
-- comment for why (the `sqlx::Any`-over-SQLite bridge can't decode a
-- `BOOLEAN`-affinity column at all), which keeps one SQL text path working
-- across both this file and its Postgres counterpart.
--
-- `api_key_encrypted` is plain `TEXT` today -- there is no encryption-at-
-- rest mechanism anywhere in this codebase yet, so nothing actually
-- encrypts the value before it lands in this column despite the field's
-- name (inherited as-is from `SourceInstance::api_key_encrypted`, whose own
-- doc comment already flags this). Adding real encryption-at-rest (key
-- management, rotation, etc.) is a known, separate, deferred concern -- out
-- of scope for this migration, which only adds real persistence for the
-- row shape.

CREATE TABLE IF NOT EXISTS source_instances (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    -- Plain TEXT -- see the file-level note above: no encryption-at-rest is
    -- applied here yet, despite the column name.
    api_key_encrypted TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    default_root_folder_id TEXT,
    default_quality_profile_id INTEGER,
    -- 0/1, not a SQL `BOOLEAN` column -- see `streamarr_db::codec::bool_to_i64`
    -- for why (the `sqlx::Any`-over-SQLite bridge can't decode a
    -- `BOOLEAN`-affinity column at all).
    enabled_for_requests INTEGER NOT NULL DEFAULT 1,
    best_effort INTEGER NOT NULL DEFAULT 0
);
