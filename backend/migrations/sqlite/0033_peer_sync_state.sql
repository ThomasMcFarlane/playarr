-- Sync bookkeeping -- `docs/architecture/peer-groups.md` §2.2 (Phase 2).
-- `peer_sync_state` gives `PeerSyncPoller` a durable per-(peer, entity)
-- cursor, so a poller restart resumes an incremental `since=` pull instead
-- of re-scanning everything. `sync_conflict_log` is the generic record for
-- every last-writer-wins resolution across the group: the losing write is
-- never silently discarded, it's logged here for admin review (§3.5).

CREATE TABLE IF NOT EXISTS peer_sync_state (
    peer_node_id TEXT NOT NULL,
    entity TEXT NOT NULL,          -- 'accounts' | 'invites' | 'libraries' | 'availability' | 'routing_rules'
    cursor TEXT,
    last_synced_at TEXT,
    PRIMARY KEY (peer_node_id, entity)
);

CREATE TABLE IF NOT EXISTS sync_conflict_log (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,     -- 'user' | 'policy' | 'source_instance' | 'group_library' | 'routing_rule'
    entity_id TEXT NOT NULL,
    winning_peer_id TEXT NOT NULL,
    losing_peer_id TEXT NOT NULL,
    losing_value_json TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    requires_admin_review INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sync_conflict_log_review ON sync_conflict_log (requires_admin_review);

-- `users`/`policies`/`source_instances` have no `updated_at`/`deleted_at`
-- today (confirmed against `0007_users_policies.sql` and
-- `0006_source_instances.sql` -- neither column exists on either table).
-- Both are required for last-writer-wins conflict resolution (§3.5) and
-- for soft-delete to propagate across the group as a tombstone, rather
-- than a peer merely lagging on sync looking like a delete.
--
-- All three new columns are nullable and additive -- no existing row, and
-- no existing read of these tables, changes shape. Nothing in this
-- migration writes `origin_peer_id`: that's set going forward by the
-- application's own create/sync write paths (see the scope note in
-- peer-groups.md §2.2), and left `NULL` here is exactly the correct
-- "created locally, before this node ever joined a group" state.
ALTER TABLE users ADD COLUMN updated_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
-- Which peer's admin actually created/owns this row -- see §3.5's
-- privilege-escalation defense.
ALTER TABLE users ADD COLUMN origin_peer_id TEXT;
ALTER TABLE policies ADD COLUMN updated_at TEXT;
ALTER TABLE policies ADD COLUMN deleted_at TEXT;
ALTER TABLE policies ADD COLUMN origin_peer_id TEXT;
ALTER TABLE source_instances ADD COLUMN updated_at TEXT;
ALTER TABLE source_instances ADD COLUMN deleted_at TEXT;

-- Backfill: every existing row's `updated_at` becomes its `created_at`
-- where that column exists (`users`), or `now()` where it never has
-- (`policies`, `source_instances` -- neither table has ever had a
-- `created_at` column), so no pre-existing row appears "just written" the
-- moment sync turns on and wins an LWW race it has no business winning.
UPDATE users SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE policies SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL;
UPDATE source_instances SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL;
