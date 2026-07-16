-- Durable storage for `streamarr_auth::refresh::RefreshTokenRecord` --
-- previously only `InMemoryRefreshTokenStore` (an in-process DashMap)
-- existed, which meant every refresh-token family was silently wiped on
-- every process restart. Since access tokens are short-lived (minutes,
-- not hours -- see `JwtIssuer::access_ttl`) and nothing else re-issues one
-- without a refresh token to redeem, that made every restart eventually
-- force every logged-in client back through a full login once its access
-- token expired, even though its refresh token was still well within its
-- own (much longer) `refresh_ttl`. This table is that durable backing
-- store; `SqlxRefreshTokenStore` in `streamarr-auth` reads/writes it.
--
-- One row per device (`device_id` is the primary key, matching
-- `RefreshTokenStore::get`/`put`'s device-keyed contract -- a device has
-- at most one live token family at a time, a fresh login replaces
-- whatever family it had). Portability conventions match every other
-- table in this schema (see e.g. `0007_users_policies.sql`): `TEXT` ids,
-- `TEXT` ISO-8601 timestamps, `INTEGER` 0/1 booleans, JSON-encoded list
-- columns.

CREATE TABLE IF NOT EXISTS refresh_token_families (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    family_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    current_hash TEXT NOT NULL,
    -- JSON-encoded `HashSet<String>` -- every hash this family has ever
    -- had as `current_hash`, checked on reuse (see `RefreshTokenRecord`'s
    -- doc comment in streamarr-auth).
    used_hashes TEXT NOT NULL DEFAULT '[]',
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    rotated_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
);
