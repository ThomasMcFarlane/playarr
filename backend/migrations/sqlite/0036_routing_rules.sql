-- Routing rules -- `docs/architecture/peer-groups.md` §2.4 (Phase 3).
--
-- The operator-configured policy that decides, for a given
-- (group_library, user) pair, which peer(s) should serve a stream and
-- whether delivery should redirect the client to that peer directly or
-- proxy the bytes through this node -- see §5 for the evaluation point
-- and §5.3 for the redirect-vs-proxy tradeoff. Never read for a single,
-- ungrouped node, and a grouped node with no matching row falls back to
-- today's exact `ServeLocally` behavior (§5.2) -- this table is
-- additive-only.
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
