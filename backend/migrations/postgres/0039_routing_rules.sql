-- Postgres mirror of ../sqlite/0036_routing_rules.sql -- see that file for
-- the full rationale. Numbered 0039 here (independent `Migrator` from the
-- sqlite side -- see 0009_source_instances.sql's own note on this
-- convention).

CREATE TABLE IF NOT EXISTS routing_rules (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    group_library_id TEXT,      -- NULL = matches any library
    user_id TEXT,                -- NULL = matches any user
    priority INTEGER NOT NULL DEFAULT 0,   -- tiebreak among equally-specific matches
    -- JSON array of peer_id (peer_nodes.id), ordered most-preferred first.
    preferred_nodes TEXT NOT NULL DEFAULT '[]',
    delivery_mode TEXT NOT NULL DEFAULT 'auto',   -- 'auto' | 'redirect' | 'proxy'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_group_library_id ON routing_rules (group_library_id);
CREATE INDEX IF NOT EXISTS idx_routing_rules_user_id ON routing_rules (user_id);
