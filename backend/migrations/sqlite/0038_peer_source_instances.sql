-- Credential-free source-instance identities learned from other peer-group
-- members. Local source_instances remains the only table containing URLs,
-- API keys, and reconciliation configuration; this cache stores only the
-- identity fields exposed by GET /api/v1/peer/libraries.
CREATE TABLE IF NOT EXISTS peer_source_instances (
    peer_node_id TEXT NOT NULL,
    source_instance_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL,
    group_library_id TEXT,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (peer_node_id, source_instance_id)
);
CREATE INDEX IF NOT EXISTS idx_peer_source_instances_group_library
    ON peer_source_instances (group_library_id);
