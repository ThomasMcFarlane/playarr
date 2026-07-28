-- This node's own private state. Singleton row (fixed sentinel id, same
-- pattern as `system_settings`), deliberately its own table rather than
-- extending `system_settings`: that table is read by the public version
-- endpoint, and a private key must never be reachable from that read
-- path by a future refactor accidentally widening its query.
CREATE TABLE IF NOT EXISTS node_identity (
    id TEXT PRIMARY KEY,              -- fixed singleton row id
    peer_id TEXT NOT NULL,             -- generated once, first boot, never regenerated.
    -- Deliberately NOT named node_id: that token already means "this
    -- ephemeral process's replica identity" elsewhere in the codebase
    -- (AppState.node_id, PostgresCoordinator's node_id, see §1.1). peer_id
    -- is a distinct, durable, per-installation identity and needs a
    -- distinct name so a `grep node_id` never returns both concepts.
    -- Ed25519 seed, base64. Plain TEXT: no encryption-at-rest exists
    -- anywhere in this codebase today -- `source_instances.api_key_
    -- encrypted` is TEXT for the identical, already-documented reason
    -- (see playarr-db/src/repo/source_instance.rs:18). This inherits
    -- that gap; it does not introduce a new one.
    private_key TEXT NOT NULL,
    group_id TEXT,                    -- NULL until this node founds/joins a group
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS peer_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- One row per known group member, INCLUDING a self row (is_self = 1) so
-- every "list the whole membership picture" query (admin UI, sync fan-
-- out target list) is one query, not "self plus peer_nodes".
CREATE TABLE IF NOT EXISTS peer_nodes (
    id TEXT PRIMARY KEY,              -- this peer's peer_id (see node_identity above)
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- JSON array of {url, priority, label, client_reachable}. Not
    -- normalized into a child table: never filtered/sorted at the SQL
    -- level, same reasoning as policies.library_allow.
    addresses TEXT NOT NULL DEFAULT '[]',
    public_key TEXT NOT NULL,         -- this peer's Ed25519 public key, base64
    is_self INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'unreachable' | 'left'
    last_seen_at TEXT,
    last_sync_error TEXT,
    joined_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_nodes_group_name ON peer_nodes (group_id, name);

-- Single-use, short-TTL, admin-issued -- mirrors UserInvite's token_hash
-- shape exactly (see backend/crates/playarr-model/src/user.rs).
CREATE TABLE IF NOT EXISTS peer_join_tokens (
    token_hash TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    redeemed_by_peer_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_peer_join_tokens_expires_at ON peer_join_tokens (expires_at);
