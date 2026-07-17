-- User-requested friend invitations. Approval is deliberately separate from
-- user_invites so the final invite's 24-hour expiry starts only when the
-- approved requester generates its QR code.
CREATE TABLE IF NOT EXISTS user_invite_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'generated')),
    requested_at TEXT NOT NULL,
    reviewed_by TEXT REFERENCES users (id) ON DELETE SET NULL,
    reviewed_at TEXT,
    generated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_invite_requests_user_requested
    ON user_invite_requests (user_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invite_requests_one_active
    ON user_invite_requests (user_id)
    WHERE status IN ('pending', 'approved');
