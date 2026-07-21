//! Peer group membership registry -- Phase 1 of
//! `docs/architecture/peer-groups.md` (see that document's §2.1 for the
//! full design and rationale).
//!
//! One row per known group member, INCLUDING a row for this node itself
//! (`is_self = true`), so every "list the whole membership picture" query
//! (admin UI, sync fan-out target list) is one query, not "self plus the
//! other peers" -- see `streamarr_model::PeerNode`'s own doc comment.

use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::{PeerAddress, PeerNode, PeerNodeStatus};
use uuid::Uuid;

use crate::codec::{
    bool_from_i64, bool_to_i64, decode_err, format_datetime, parse_datetime, parse_uuid,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

fn status_to_str(status: PeerNodeStatus) -> &'static str {
    match status {
        PeerNodeStatus::Active => "active",
        PeerNodeStatus::Unreachable => "unreachable",
        PeerNodeStatus::Left => "left",
    }
}

fn status_from_str(value: &str) -> Result<PeerNodeStatus, DbError> {
    match value {
        "active" => Ok(PeerNodeStatus::Active),
        "unreachable" => Ok(PeerNodeStatus::Unreachable),
        "left" => Ok(PeerNodeStatus::Left),
        other => Err(decode_err(format!("unknown peer node status {other:?}"))),
    }
}

fn from_row(row: &AnyRow) -> Result<PeerNode, DbError> {
    let id: String = row.try_get("id")?;
    let group_id: String = row.try_get("group_id")?;
    let name: String = row.try_get("name")?;
    let addresses: String = row.try_get("addresses")?;
    let public_key: String = row.try_get("public_key")?;
    let is_self: i64 = row.try_get("is_self")?;
    let status: String = row.try_get("status")?;
    let last_seen_at: Option<String> = row.try_get("last_seen_at")?;
    let last_sync_error: Option<String> = row.try_get("last_sync_error")?;
    let joined_at: String = row.try_get("joined_at")?;
    let updated_at: String = row.try_get("updated_at")?;

    Ok(PeerNode {
        id: parse_uuid(&id)?,
        group_id: parse_uuid(&group_id)?,
        name,
        addresses: serde_json::from_str::<Vec<PeerAddress>>(&addresses)?,
        public_key,
        is_self: bool_from_i64(is_self),
        status: status_from_str(&status)?,
        last_seen_at: last_seen_at.as_deref().map(parse_datetime).transpose()?,
        last_sync_error,
        joined_at: parse_datetime(&joined_at)?,
        updated_at: parse_datetime(&updated_at)?,
    })
}

const COLUMNS: &str = "id, group_id, name, addresses, public_key, is_self, status, \
                        last_seen_at, last_sync_error, joined_at, updated_at";

/// Durable registry of every known member of this node's
/// [`streamarr_model::PeerGroup`], including a row for this node itself.
/// See `docs/architecture/peer-groups.md` §2.1.
#[async_trait]
pub trait PeerNodeRepo: Send + Sync {
    /// Insert-or-update by `PeerNode::id`.
    async fn upsert(&self, node: &PeerNode) -> Result<(), DbError>;

    async fn get(&self, id: Uuid) -> Result<Option<PeerNode>, DbError>;

    /// Every known member, including the self row.
    async fn list_all(&self) -> Result<Vec<PeerNode>, DbError>;

    /// Every OTHER, active member (`is_self = false`, `status = Active`) --
    /// the sync/fan-out target list every later phase reads (§2.1).
    async fn list_others(&self) -> Result<Vec<PeerNode>, DbError>;
}

pub struct SqlxPeerNodeRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxPeerNodeRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl PeerNodeRepo for SqlxPeerNodeRepo {
    async fn upsert(&self, node: &PeerNode) -> Result<(), DbError> {
        let addresses = serde_json::to_string(&node.addresses)?;
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO peer_nodes \
                 (id, group_id, name, addresses, public_key, is_self, status, \
                 last_seen_at, last_sync_error, joined_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 group_id = excluded.group_id, name = excluded.name, \
                 addresses = excluded.addresses, public_key = excluded.public_key, \
                 is_self = excluded.is_self, status = excluded.status, \
                 last_seen_at = excluded.last_seen_at, last_sync_error = excluded.last_sync_error, \
                 joined_at = excluded.joined_at, updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO peer_nodes \
                 (id, group_id, name, addresses, public_key, is_self, status, \
                 last_seen_at, last_sync_error, joined_at, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (id) DO UPDATE SET \
                 group_id = excluded.group_id, name = excluded.name, \
                 addresses = excluded.addresses, public_key = excluded.public_key, \
                 is_self = excluded.is_self, status = excluded.status, \
                 last_seen_at = excluded.last_seen_at, last_sync_error = excluded.last_sync_error, \
                 joined_at = excluded.joined_at, updated_at = excluded.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(node.id.to_string())
            .bind(node.group_id.to_string())
            .bind(node.name.as_str())
            .bind(addresses)
            .bind(node.public_key.as_str())
            .bind(bool_to_i64(node.is_self))
            .bind(status_to_str(node.status))
            .bind(node.last_seen_at.map(format_datetime))
            .bind(node.last_sync_error.as_deref())
            .bind(format_datetime(node.joined_at))
            .bind(format_datetime(node.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get(&self, id: Uuid) -> Result<Option<PeerNode>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!("SELECT {COLUMNS} FROM peer_nodes WHERE id = ?"),
            Backend::Postgres => format!("SELECT {COLUMNS} FROM peer_nodes WHERE id = $1"),
        };
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn list_all(&self) -> Result<Vec<PeerNode>, DbError> {
        let sql = format!("SELECT {COLUMNS} FROM peer_nodes ORDER BY name");
        let rows = sqlx::query(&sql).fetch_all(&self.pool).await?;
        rows.iter().map(from_row).collect()
    }

    async fn list_others(&self) -> Result<Vec<PeerNode>, DbError> {
        // Literal `0`/`'active'` rather than bound params: not user input,
        // same convention as user_invite_request.rs's `status = 'pending'`.
        let sql = format!(
            "SELECT {COLUMNS} FROM peer_nodes WHERE is_self = 0 AND status = 'active' \
             ORDER BY name"
        );
        let rows = sqlx::query(&sql).fetch_all(&self.pool).await?;
        rows.iter().map(from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};

    use super::*;
    use crate::pool::test_sqlite_pool;

    /// `peer_nodes.group_id` has a `REFERENCES peer_groups (id)` foreign
    /// key (see the design doc's §2.1 schema), so every test needs a real
    /// `peer_groups` row to point at first. `PeerGroupRepo` is a sibling
    /// repo, not this one, so this seeds the row directly with a raw
    /// insert -- same approach `user_invite.rs`'s own tests use to satisfy
    /// `UserInvite::created_by`'s foreign key onto `users`.
    async fn seed_group(pool: &DbPool) -> Uuid {
        let group_id = Uuid::new_v4();
        sqlx::query("INSERT INTO peer_groups (id, name, created_at) VALUES (?, ?, ?)")
            .bind(group_id.to_string())
            .bind("test group")
            .bind(format_datetime(Utc::now()))
            .execute(pool)
            .await
            .expect("seed peer_groups row");
        group_id
    }

    fn sample_node(group_id: Uuid, name: &str, is_self: bool, status: PeerNodeStatus) -> PeerNode {
        let now = Utc::now().trunc_subsecs(3);
        PeerNode {
            id: Uuid::new_v4(),
            group_id,
            name: name.to_string(),
            addresses: vec![PeerAddress {
                url: "https://east.example.com".to_string(),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            }],
            public_key: "base64-ed25519-public-key".to_string(),
            is_self,
            status,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxPeerNodeRepo::new(pool);
        let node = sample_node(group_id, "home", true, PeerNodeStatus::Active);

        repo.upsert(&node).await.expect("upsert");
        let fetched = repo.get(node.id).await.expect("get").expect("present");

        assert_eq!(fetched, node);
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerNodeRepo::new(pool);

        assert!(repo.get(Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn upsert_updates_existing_row_by_id() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxPeerNodeRepo::new(pool);
        let mut node = sample_node(group_id, "home", true, PeerNodeStatus::Active);
        repo.upsert(&node).await.unwrap();

        node.name = "renamed-home".to_string();
        node.status = PeerNodeStatus::Unreachable;
        node.last_sync_error = Some("connection refused".to_string());
        node.addresses.push(PeerAddress {
            url: "https://home.lan".to_string(),
            priority: 1,
            label: "lan".to_string(),
            client_reachable: false,
        });
        repo.upsert(&node).await.unwrap();

        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], node);
    }

    #[tokio::test]
    async fn list_all_includes_self_row() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxPeerNodeRepo::new(pool);
        let self_node = sample_node(group_id, "home", true, PeerNodeStatus::Active);
        let peer_node = sample_node(group_id, "east", false, PeerNodeStatus::Active);

        repo.upsert(&self_node).await.unwrap();
        repo.upsert(&peer_node).await.unwrap();

        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "east");
        assert_eq!(all[1].name, "home");
    }

    #[tokio::test]
    async fn list_others_excludes_self_and_inactive_peers() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxPeerNodeRepo::new(pool);
        let self_node = sample_node(group_id, "home", true, PeerNodeStatus::Active);
        let active_peer = sample_node(group_id, "east", false, PeerNodeStatus::Active);
        let unreachable_peer = sample_node(group_id, "west", false, PeerNodeStatus::Unreachable);
        let left_peer = sample_node(group_id, "north", false, PeerNodeStatus::Left);

        repo.upsert(&self_node).await.unwrap();
        repo.upsert(&active_peer).await.unwrap();
        repo.upsert(&unreachable_peer).await.unwrap();
        repo.upsert(&left_peer).await.unwrap();

        let others = repo.list_others().await.unwrap();
        assert_eq!(others.len(), 1);
        assert_eq!(others[0], active_peer);
    }

    #[tokio::test]
    async fn list_others_empty_for_single_ungrouped_node() {
        // Phase 1 must be byte-for-byte inert for a single, ungrouped node:
        // with only a self row present (or no rows at all), the fan-out
        // target list is empty.
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxPeerNodeRepo::new(pool);

        assert!(repo.list_others().await.unwrap().is_empty());

        let self_node = sample_node(group_id, "home", true, PeerNodeStatus::Active);
        repo.upsert(&self_node).await.unwrap();

        assert!(repo.list_others().await.unwrap().is_empty());
    }
}
