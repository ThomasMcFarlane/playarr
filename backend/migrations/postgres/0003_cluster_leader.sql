-- Leader-election heartbeat table backing `PostgresCoordinator::{campaign_leader,
-- renew_leadership}` in `streamarr-coordination`. One row per contended
-- role (e.g. "arr-sync:sonarr", "transcode-dispatcher"); `node_id` is
-- whichever node currently holds the lease for that role, and `expires_at`
-- is when that lease lapses if it isn't renewed first.
--
-- Leadership is acquired/renewed with a single upsert:
--
--   INSERT INTO cluster_leader (role, node_id, expires_at)
--   VALUES ($1, $2, now() + $3::interval)
--   ON CONFLICT (role) DO UPDATE
--   SET node_id = excluded.node_id, expires_at = excluded.expires_at
--   WHERE cluster_leader.expires_at < now()
--      OR cluster_leader.node_id = excluded.node_id
--   RETURNING node_id
--
-- The WHERE clause is what makes this safe under concurrent campaigns: the
-- UPDATE (and therefore the RETURNING row a caller uses to detect a win)
-- only fires if the existing lease already expired, or the existing lease
-- is already held by the same node renewing itself. A live lease held by a
-- different node blocks the update outright, so exactly one node can hold
-- a given role's lease at a time.
--
-- Postgres-only: single-node deployments use `SingleNodeCoordinator`, which
-- is unconditionally the leader of every role (there are no peer nodes to
-- lose an election to), so there is no matching table under
-- `backend/migrations/sqlite`.
CREATE TABLE IF NOT EXISTS cluster_leader (
    role TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- Supports cheap "which leases have lapsed" housekeeping/monitoring queries;
-- the upsert above matches on `role` (the primary key) so it doesn't need
-- this index itself.
CREATE INDEX IF NOT EXISTS idx_cluster_leader_expires_at ON cluster_leader (expires_at);
