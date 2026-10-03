-- Postgres mirror of `../sqlite/0051_household.sql`.
--
-- No foreign keys to `users`: users are soft-deleted and replicated between
-- peers, and these rows are only ever reached through a user id the caller
-- has already authenticated.

-- Watch seconds served per profile per local day (the day string is
-- computed in the profile's time zone by the API layer).
CREATE TABLE IF NOT EXISTS household_usage (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
);

-- Guardian approval requests and grants.
CREATE TABLE IF NOT EXISTS household_approvals (
    id TEXT PRIMARY KEY,
    profile_user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    request_expires_at TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    grant_expires_at TEXT,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    bonus_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_household_approvals_profile
    ON household_approvals (profile_user_id, status);

-- Failed PIN attempts for lockout. `caller_user_id` is the nil UUID for the
-- per-target aggregate row.
CREATE TABLE IF NOT EXISTS pin_attempts (
    caller_user_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (caller_user_id, target_user_id)
);
