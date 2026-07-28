-- Postgres mirror of `../sqlite/0007_users_policies.sql` -- see that file
-- for the full rationale. Numbered 0010 here (the sqlite/postgres migration
-- directories are independent `Migrator`s -- `SQLITE_MIGRATIONS` /
-- `POSTGRES_MIGRATIONS` in `playarr-db::pool` -- so their version numbers
-- have already diverged and don't need to line up; this table has no FK
-- dependency on anything added since `0009_source_instances.sql`, so it
-- simply takes the next free slot on this side).
--
-- `policies` and `users` back `playarr_model::{Policy, User}` and the new
-- `PolicyRepo`/`UserRepo` traits in `playarr-db::repo`. This is the
-- persistence half of moving Playarr Server off `trusted-network` auto-admin
-- (source-IP allowlist login) and onto real username/password accounts
-- (`PLAYARR_AUTH_MODE=full-account` in `playarr_auth::AuthMode`).
-- `playarr_auth::login::evaluate_login` already handles `full-account`
-- correctly, including real Argon2id password hashing
-- (`playarr_auth::login::hash_password` / `Argon2PasswordVerifier`) --
-- what was missing is that every account today only lives in
-- `playarr_auth::login::InMemoryUserDirectory`, which starts empty on
-- every boot. These two tables are that directory's real, durable backing
-- store.
--
-- `policies` is created first and `users.policy_id` references it (`NOT
-- NULL` -- every user must have a policy, there is no implicit default)
-- because a user can't be inserted until the policy it points at exists.
--
-- Portability note (same convention as `0006_catalog.sql`/`0009_source_
-- instances.sql`): `id`/`policy_id` are TEXT (stringified UUIDs),
-- `created_at` is TEXT in ISO-8601 form, and every boolean
-- (`can_transcode`, `can_download`, `can_delete`, `can_share_public`,
-- `is_admin`, `disabled`) is kept as `INTEGER` 0/1 on this side too (rather
-- than a native Postgres `boolean`), bound/read via
-- `playarr_db::codec::bool_to_i64`/`bool_from_i64` -- so the
-- application-level SQL and Rust row-mapping stay identical across both
-- engines; see `bool_to_i64`'s doc comment for the SQLite driver
-- limitation that motivates it.
--
-- `Policy`'s list/optional-list fields (`library_allow`, `blocked_folders`,
-- `blocked_tags`, `allowed_tags`, `device_allow`, `access_schedule`) follow
-- `works.genres`/`works.tags` in `0006_catalog.sql`: JSON-encoded into a
-- single TEXT column via `serde_json` rather than a native `jsonb` column
-- or separate join tables, since none of them are filtered/sorted on at the
-- SQL level and keeping one representation for both engines avoids
-- branching per backend. `access_schedule` has no `DEFAULT` (unlike the
-- `Vec`-typed columns, which default to `'[]'`) because `None` (SQL `NULL`)
-- and `Some(vec![])` are distinct, meaningful values on
-- `Policy::access_schedule` -- "no schedule restriction" vs. "never
-- allowed" -- and collapsing them behind a shared default would lose that
-- distinction.
--
-- `password_hash` is plain `TEXT`: it already holds an Argon2id PHC hash
-- string produced by `playarr_auth::login::hash_password`, not a
-- plaintext secret, so no additional column-level protection is needed
-- beyond what `playarr_model::Sensitive<String>` already gives it on the
-- Rust side (keeping it out of `Debug`/`Display`/logs).

CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- JSON-encoded `Vec<Uuid>` / `Vec<String>` -- see the file-level note
    -- above.
    library_allow TEXT NOT NULL DEFAULT '[]',
    blocked_folders TEXT NOT NULL DEFAULT '[]',
    max_rating TEXT,
    blocked_tags TEXT NOT NULL DEFAULT '[]',
    allowed_tags TEXT NOT NULL DEFAULT '[]',
    -- 0/1, not a native `boolean` column -- see the file-level note above.
    can_transcode INTEGER NOT NULL DEFAULT 1,
    can_download INTEGER NOT NULL DEFAULT 1,
    can_delete INTEGER NOT NULL DEFAULT 0,
    can_share_public INTEGER NOT NULL DEFAULT 0,
    -- JSON-encoded `Vec<ClientPlatform>` -- see the file-level note above.
    device_allow TEXT NOT NULL DEFAULT '[]',
    max_concurrent_sessions INTEGER,
    -- JSON-encoded `Option<Vec<AccessWindow>>`; no `DEFAULT` -- see the
    -- file-level note above on why `NULL` and `'[]'` must stay distinct.
    access_schedule TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    email TEXT,
    -- Plain TEXT -- see the file-level note above: already an Argon2id PHC
    -- hash string, not a plaintext secret.
    password_hash TEXT NOT NULL,
    policy_id TEXT NOT NULL REFERENCES policies (id),
    created_at TEXT NOT NULL,
    -- 0/1, not a native `boolean` column -- see the note on `policies`
    -- above.
    disabled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_policy_id ON users (policy_id);
