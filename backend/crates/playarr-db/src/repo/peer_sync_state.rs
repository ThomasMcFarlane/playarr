//! Durable per-(peer, entity) sync cursor -- Phase 2 of
//! `docs/architecture/peer-groups.md` (see that document's §2.2 for the
//! table itself and §3.6 for the poller this backs).
//!
//! `PeerSyncPoller` (one instance per non-self `peer_nodes` row) persists
//! `server_time` from every successful `GET .../since=<cursor>` sync pass
//! into this table, keyed by `(peer_node_id, entity)`, so a poller restart
//! resumes an incremental pull instead of re-scanning everything. `entity`
//! is one of `"accounts" | "invites" | "libraries" | "availability" |
//! "routing_rules"` (see the migration's own column comment) -- kept a
//! plain `String` here rather than a closed Rust enum for the same reason
//! `sync_conflict_log.rs::SyncConflictLog::entity_type` is: the last of
//! those values (`"routing_rules"`) has no corresponding sync module until
//! Phase 3, and this repo must not grow a dependency on that phase.
//!
//! [`PeerSyncState`] does not (yet) have a home in `playarr-model` --
//! kept local to this module for the same reason
//! `crate::repo::peer_join_token::PeerJoinToken` and
//! `crate::repo::sync_conflict_log::SyncConflictLog` give in their own doc
//! comments: this change stays scoped to a single file while sibling Phase 2
//! repos land in the same directory in parallel; promoting it to
//! `playarr-model` is a natural follow-up for whichever pass wires this
//! repo into `AppState`/`playarr-peer-sync`.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::DbPool;
use crate::write_queue::{write_latest, WriteQueue};

/// One `(peer_node_id, entity)` sync cursor -- column-for-column mirror of
/// the `peer_sync_state` table
/// (`backend/migrations/sqlite/0033_peer_sync_state.sql`).
#[derive(Debug, Clone, PartialEq)]
pub struct PeerSyncState {
    pub peer_node_id: Uuid,
    /// `"accounts" | "invites" | "libraries" | "availability" |
    /// "routing_rules"` -- see this module's own doc comment.
    pub entity: String,
    /// Opaque `server_time` cursor from that entity's last successful sync
    /// response. `None` means this `(peer_node_id, entity)` pair has never
    /// completed a pass, so the next request is a full (`since=None`) pull.
    pub cursor: Option<String>,
    pub last_synced_at: Option<DateTime<Utc>>,
}

/// Durable sync-cursor bookkeeping for `PeerSyncPoller` -- see this module's
/// own doc comment and `docs/architecture/peer-groups.md` §3.6.
#[async_trait]
pub trait PeerSyncStateRepo: Send + Sync {
    /// Insert-or-update keyed by the table's own primary key --
    /// `(peer_node_id, entity)` -- called once per successful sync pass.
    async fn upsert(&self, state: &PeerSyncState) -> Result<(), DbError>;

    /// The cursor for one `(peer_node_id, entity)` pair, or `None` if that
    /// pair has never completed a sync pass.
    async fn get(&self, peer_node_id: Uuid, entity: &str)
        -> Result<Option<PeerSyncState>, DbError>;

    /// Every cursor row for one peer, entity-ordered -- the admin
    /// "sync status" read (§3.6): `GET /api/v1/admin/peer-nodes/{id}/
    /// sync-status`.
    async fn list_for_peer(&self, peer_node_id: Uuid) -> Result<Vec<PeerSyncState>, DbError>;
}

pub struct SqlxPeerSyncStateRepo {
    pool: DbPool,
    queue: Option<WriteQueue>,
}

impl SqlxPeerSyncStateRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool, queue: None }
    }

    /// Sends `upsert` through the shared write queue.
    pub fn with_write_queue(mut self, queue: WriteQueue) -> Self {
        self.queue = Some(queue);
        self
    }
}

fn from_row(row: &AnyRow) -> Result<PeerSyncState, DbError> {
    let peer_node_id: String = row.try_get("peer_node_id")?;
    let entity: String = row.try_get("entity")?;
    let cursor: Option<String> = row.try_get("cursor")?;
    let last_synced_at: Option<String> = row.try_get("last_synced_at")?;

    Ok(PeerSyncState {
        peer_node_id: parse_uuid(&peer_node_id)?,
        entity,
        cursor,
        last_synced_at: last_synced_at.as_deref().map(parse_datetime).transpose()?,
    })
}

const COLUMNS: &str = "peer_node_id, entity, cursor, last_synced_at";

#[async_trait]
impl PeerSyncStateRepo for SqlxPeerSyncStateRepo {
    /// Latest value wins: two cursors saved for one peer and entity in one
    /// write-queue batch collapse to the one with the newer `last_synced_at`
    /// (the later submission on a tie).
    async fn upsert(&self, state: &PeerSyncState) -> Result<(), DbError> {
        let peer = state.peer_node_id.to_string();
        let entity = state.entity.clone();
        let cursor = state.cursor.clone();
        let synced = state.last_synced_at.map(format_datetime);
        let rank = state.last_synced_at.map_or(0, |at| at.timestamp_millis());
        write_latest(
            self.queue.as_ref(),
            &self.pool,
            format!("peer_sync_state:{peer}:{entity}"),
            rank,
            move |conn| {
                let (peer, entity, cursor, synced) =
                    (peer.clone(), entity.clone(), cursor.clone(), synced.clone());
                Box::pin(async move {
                    let sql = "INSERT INTO peer_sync_state (peer_node_id, entity, cursor, last_synced_at) \
                         VALUES (?, ?, ?, ?) \
                         ON CONFLICT (peer_node_id, entity) DO UPDATE SET \
                         cursor = excluded.cursor, last_synced_at = excluded.last_synced_at";
                    sqlx::query(sql)
                        .bind(peer)
                        .bind(entity)
                        .bind(cursor)
                        .bind(synced)
                        .execute(&mut *conn)
                        .await?;
                    Ok(())
                })
            },
        )
        .await
    }

    async fn get(
        &self,
        peer_node_id: Uuid,
        entity: &str,
    ) -> Result<Option<PeerSyncState>, DbError> {
        let sql =
            format!("SELECT {COLUMNS} FROM peer_sync_state WHERE peer_node_id = ? AND entity = ?");
        let row = sqlx::query(&sql)
            .bind(peer_node_id.to_string())
            .bind(entity)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn list_for_peer(&self, peer_node_id: Uuid) -> Result<Vec<PeerSyncState>, DbError> {
        let sql =
            format!("SELECT {COLUMNS} FROM peer_sync_state WHERE peer_node_id = ? ORDER BY entity");
        let rows = sqlx::query(&sql)
            .bind(peer_node_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::write_queue::WriteQueue;

    /// `peer_sync_state` has no `REFERENCES` foreign key (see
    /// `0033_peer_sync_state.sql`'s own schema), so tests can insert
    /// directly with whatever `Uuid` they like -- same as
    /// `peer_leaf_availability.rs`'s own tests.
    fn sample(peer_node_id: Uuid, entity: &str) -> PeerSyncState {
        PeerSyncState {
            peer_node_id,
            entity: entity.to_string(),
            cursor: Some("2026-07-21T00:00:00.000Z".to_string()),
            last_synced_at: Some(Utc::now().trunc_subsecs(3)),
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerSyncStateRepo::new(pool);
        let peer_node_id = Uuid::new_v4();
        let state = sample(peer_node_id, "accounts");

        repo.upsert(&state).await.expect("upsert");
        let fetched = repo
            .get(peer_node_id, "accounts")
            .await
            .expect("get")
            .expect("present");

        assert_eq!(fetched, state);
    }

    #[tokio::test]
    async fn get_missing_pair_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerSyncStateRepo::new(pool);

        assert!(repo
            .get(Uuid::new_v4(), "accounts")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn upsert_updates_existing_row_by_primary_key() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerSyncStateRepo::new(pool);
        let peer_node_id = Uuid::new_v4();
        let mut state = sample(peer_node_id, "libraries");
        repo.upsert(&state).await.unwrap();

        state.cursor = Some("2026-07-21T01:00:00.000Z".to_string());
        state.last_synced_at = Some(Utc::now().trunc_subsecs(3));
        repo.upsert(&state).await.unwrap();

        let all = repo.list_for_peer(peer_node_id).await.unwrap();
        assert_eq!(all, vec![state]);
    }

    #[tokio::test]
    async fn distinct_entities_for_the_same_peer_coexist() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerSyncStateRepo::new(pool);
        let peer_node_id = Uuid::new_v4();
        let accounts = sample(peer_node_id, "accounts");
        let availability = sample(peer_node_id, "availability");

        repo.upsert(&accounts).await.unwrap();
        repo.upsert(&availability).await.unwrap();

        let all = repo.list_for_peer(peer_node_id).await.unwrap();
        assert_eq!(
            all.iter().map(|s| s.entity.as_str()).collect::<Vec<_>>(),
            vec!["accounts", "availability"]
        );
    }

    #[tokio::test]
    async fn list_for_peer_excludes_other_peers() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerSyncStateRepo::new(pool);
        let peer_a = Uuid::new_v4();
        let peer_b = Uuid::new_v4();
        let state_a = sample(peer_a, "accounts");
        let state_b = sample(peer_b, "accounts");

        repo.upsert(&state_a).await.unwrap();
        repo.upsert(&state_b).await.unwrap();

        let fetched = repo.list_for_peer(peer_a).await.unwrap();
        assert_eq!(fetched, vec![state_a]);
    }

    #[tokio::test]
    async fn cursor_and_last_synced_at_round_trip_as_none_before_first_sync() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerSyncStateRepo::new(pool);
        let peer_node_id = Uuid::new_v4();
        let state = PeerSyncState {
            peer_node_id,
            entity: "routing_rules".to_string(),
            cursor: None,
            last_synced_at: None,
        };

        repo.upsert(&state).await.unwrap();
        let fetched = repo
            .get(peer_node_id, "routing_rules")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(fetched, state);
    }

    #[tokio::test]
    async fn list_for_peer_empty_for_single_ungrouped_node() {
        // Phase 2 must be inert for a single, ungrouped node: with
        // `PeerSyncPoller` never spawned (no known other peer), no cursor
        // row is ever written.
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerSyncStateRepo::new(pool);

        assert!(repo.list_for_peer(Uuid::new_v4()).await.unwrap().is_empty());
    }

    /// Cursors saved together for one peer and entity collapse to the newest;
    /// another entity in the same batch is kept, and every call is committed
    /// before it returns.
    #[tokio::test]
    async fn queued_upserts_keep_the_newest_cursor_per_peer_and_entity() {
        let pool = test_sqlite_pool().await;
        let queue = WriteQueue::spawn(
            pool.clone(),
            crate::WriteQueueConfig {
                max_wait: std::time::Duration::from_millis(300),
                ..Default::default()
            },
        );
        let repo =
            std::sync::Arc::new(SqlxPeerSyncStateRepo::new(pool).with_write_queue(queue.clone()));
        let peer = Uuid::new_v4();
        let now = Utc::now().trunc_subsecs(3);
        let mut calls = Vec::new();
        for (entity, age_s, cursor) in [
            ("accounts", 5, "newer"),
            ("accounts", 20, "older"),
            ("playlists", 7, "other"),
        ] {
            let repo = repo.clone();
            let state = PeerSyncState {
                peer_node_id: peer,
                entity: entity.to_string(),
                cursor: Some(cursor.to_string()),
                last_synced_at: Some(now - chrono::Duration::seconds(age_s)),
            };
            calls.push(tokio::spawn(async move { repo.upsert(&state).await }));
        }
        for call in calls {
            call.await.unwrap().unwrap();
        }
        let accounts = repo.get(peer, "accounts").await.unwrap().unwrap();
        assert_eq!(accounts.cursor.as_deref(), Some("newer"));
        let playlists = repo.get(peer, "playlists").await.unwrap().unwrap();
        assert_eq!(playlists.cursor.as_deref(), Some("other"));
        assert_eq!(queue.stats().coalesced, 1);
        queue.shutdown().await;
    }
}
