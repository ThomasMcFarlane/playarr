-- `policies` and `users` tables backing `streamarr_model::{Policy, User}`
-- and the new `PolicyRepo`/`UserRepo` traits in `streamarr-db::repo`.
--
-- This is the persistence half of moving Streamarr off `trusted-network`
-- auto-admin (source-IP allowlist login) and onto real username/password
-- accounts (`STREAMARR_AUTH_MODE=full-account` in `streamarr_auth::
-- AuthMode`). `streamarr_auth::login::evaluate_login` already handles
-- `full-account` correctly, including real Argon2id password hashing
-- (`streamarr_auth::login::hash_password` / `Argon2PasswordVerifier`) --
-- what was missing is that every account today only lives in
-- `streamarr_auth::login::InMemoryUserDirectory`, which starts empty on
-- every boot. These two tables are that directory's real, durable backing
-- store.
--
-- `policies` is created first and `users.policy_id` references it (`NOT
-- NULL` -- every user must have a policy, there is no implicit default)
-- because a user can't be inserted until the policy it points at exists.
--
-- Portability note (same convention as `0003_catalog.sql`/`0006_source_
-- instances.sql`): `id`/`policy_id` are TEXT (stringified UUIDs),
-- `created_at` is TEXT in ISO-8601 form, and every boolean
-- (`can_transcode`, `can_download`, `can_delete`, `can_share_public`,
-- `is_admin`, `disabled`) is `INTEGER` 0/1, not a SQL `BOOLEAN` column --
-- see `streamarr_db::codec::bool_to_i64` for why (the `sqlx::Any`-over-
-- SQLite bridge can't decode a `BOOLEAN`-affinity column at all).
--
-- `Policy`'s list/optional-list fields (`library_allow`, `blocked_folders`,
-- `blocked_tags`, `allowed_tags`, `device_allow`, `access_schedule`) follow
-- `works.genres`/`works.tags` in `0003_catalog.sql`: JSON-encoded into a
-- single TEXT column via `serde_json` rather than separate join tables,
-- since none of them are filtered/sorted on at the SQL level -- policy
-- evaluation always loads the whole `Policy` and reasons about it in Rust
-- (see `streamarr_auth::policy`). `access_schedule` has no `DEFAULT` (unlike
-- the `Vec`-typed columns, which default to `'[]'`) because `None` (SQL
-- `NULL`) and `Some(vec![])` are distinct, meaningful values on
-- `Policy::access_schedule` -- "no schedule restriction" vs. "never
-- allowed" -- and collapsing them behind a shared default would lose that
-- distinction.
--
-- `password_hash` is plain `TEXT`: it already holds an Argon2id PHC hash
-- string produced by `streamarr_auth::login::hash_password`, not a
-- plaintext secret, so no additional column-level protection is needed
-- beyond what `streamarr_model::Sensitive<String>` already gives it on the
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
    -- 0/1, not a SQL `BOOLEAN` column -- see `streamarr_db::codec::bool_to_i64`
    -- for why (the `sqlx::Any`-over-SQLite bridge can't decode a
    -- `BOOLEAN`-affinity column at all).
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
    -- 0/1, not a SQL `BOOLEAN` column -- see the note on `policies` above.
    disabled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_policy_id ON users (policy_id);
