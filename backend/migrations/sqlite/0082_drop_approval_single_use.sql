-- Single-use approvals are retired (owner decision, 9 Oct 2026): with purchase and install approvals gone
-- (0081), approvals are only `content` and `time` grants bounded by `grant_expires_at`. Nothing reads or
-- writes `max_uses` or `uses` any more, so drop both columns.
--
-- Rebuild the table rather than `ALTER TABLE ... DROP COLUMN`, so it works on every SQLite version the
-- server may be linked against. Rows and the profile index are preserved.
CREATE TABLE household_approvals_new (
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
    bonus_seconds INTEGER NOT NULL DEFAULT 0
);

INSERT INTO household_approvals_new
    (id, profile_user_id, kind, subject, note, status, requested_at, request_expires_at,
     decided_by, decided_at, grant_expires_at, bonus_seconds)
SELECT id, profile_user_id, kind, subject, note, status, requested_at, request_expires_at,
       decided_by, decided_at, grant_expires_at, bonus_seconds
FROM household_approvals;

DROP TABLE household_approvals;
ALTER TABLE household_approvals_new RENAME TO household_approvals;

CREATE INDEX IF NOT EXISTS idx_household_approvals_profile
    ON household_approvals (profile_user_id, status);
