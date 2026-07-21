-- Postgres mirror of ../sqlite/0032_node_identity.sql -- see that file for
-- the full rationale. Numbered 0035 here (independent `Migrator` from the
-- sqlite side -- see 0009_source_instances.sql's own note on this
-- convention).

CREATE TABLE IF NOT EXISTS node_identity (
    id TEXT PRIMARY KEY,
    peer_id TEXT NOT NULL,
    private_key TEXT NOT NULL,
    group_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS peer_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS peer_nodes (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    addresses TEXT NOT NULL DEFAULT '[]',
    public_key TEXT NOT NULL,
    is_self INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    last_seen_at TEXT,
    last_sync_error TEXT,
    joined_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_nodes_group_name ON peer_nodes (group_id, name);

CREATE TABLE IF NOT EXISTS peer_join_tokens (
    token_hash TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    redeemed_by_peer_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_peer_join_tokens_expires_at ON peer_join_tokens (expires_at);
