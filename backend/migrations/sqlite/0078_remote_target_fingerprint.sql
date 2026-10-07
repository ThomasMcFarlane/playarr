-- Optional install-independent device fingerprint, so a reinstalled app can reclaim its old
-- remote target (and pairings) instead of leaving a stale "Offline" duplicate behind.
ALTER TABLE remote_targets ADD COLUMN fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_remote_targets_fingerprint ON remote_targets (user_id, fingerprint);
