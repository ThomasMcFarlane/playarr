-- Phone remote and playback handoff (docs/architecture/remote-control.md).
-- Times are Unix epoch milliseconds. SQLite mirror: ../sqlite/0045_remote_control.sql.
CREATE TABLE IF NOT EXISTS remote_targets (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    capabilities TEXT NOT NULL,
    state TEXT,
    state_at_ms BIGINT,
    last_seen_ms BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_remote_targets_user ON remote_targets (user_id);

CREATE TABLE IF NOT EXISTS remote_pairings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    controller_device_id TEXT NOT NULL,
    controller_name TEXT NOT NULL,
    target_device_id TEXT NOT NULL,
    status TEXT NOT NULL,
    scopes TEXT NOT NULL,
    verification_code TEXT NOT NULL,
    created_ms BIGINT NOT NULL,
    expires_ms BIGINT NOT NULL,
    approved_ms BIGINT,
    revoked_ms BIGINT,
    revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_remote_pairings_user ON remote_pairings (user_id);
CREATE INDEX IF NOT EXISTS idx_remote_pairings_pair ON remote_pairings (controller_device_id, target_device_id);

CREATE TABLE IF NOT EXISTS remote_events (
    id TEXT PRIMARY KEY,
    target_device_id TEXT NOT NULL,
    seq BIGINT NOT NULL,
    kind TEXT NOT NULL,
    pairing_id TEXT,
    user_id TEXT NOT NULL,
    controller_device_id TEXT,
    payload TEXT,
    status TEXT NOT NULL,
    result TEXT,
    created_ms BIGINT NOT NULL,
    expires_ms BIGINT NOT NULL,
    UNIQUE (target_device_id, seq)
);

CREATE TABLE IF NOT EXISTS remote_handoffs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    initiator_device_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    source_device_id TEXT NOT NULL,
    destination_device_id TEXT NOT NULL,
    media_file_id TEXT NOT NULL,
    work_id TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    status TEXT NOT NULL,
    created_ms BIGINT NOT NULL,
    expires_ms BIGINT NOT NULL,
    completed_ms BIGINT,
    acked_position_ms BIGINT,
    failure_reason TEXT,
    UNIQUE (initiator_device_id, request_key)
);
