//! Group registry -- Phase 1 of `docs/architecture/peer-groups.md` (see
//! that document's §2.1 for the full design and rationale).
//!
//! A [`streamarr_model::PeerGroup`] is the set of peer nodes that have
//! agreed to sync with each other. A group is created exactly once, at
//! founding time (`POST /api/v1/admin/peer-groups`, §3.4) -- there is no
//! update path in Phase 1, only [`PeerGroupRepo::create`] and
//! [`PeerGroupRepo::get`], the same "insert-only, no upsert" shape
//! `UserInviteRepo::create` already uses for a row that likewise has no
//! legitimate reason to be overwritten in place.

use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::PeerGroup;
use uuid::Uuid;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

fn from_row(row: &AnyRow) -> Result<PeerGroup, DbError> {
    let id: String = row.try_get("id")?;
    let name: String = row.try_get("name")?;
    let created_at: String = row.try_get("created_at")?;

    Ok(PeerGroup {
        id: parse_uuid(&id)?,
        name,
        created_at: parse_datetime(&created_at)?,
    })
}

const COLUMNS: &str = "id, name, created_at";

/// Durable registry of [`PeerGroup`]s this node knows about -- in practice,
/// at most the single group this node has founded or joined (`node_identity
/// .group_id`), but keyed on `PeerGroup::id` rather than assumed singleton
/// so nothing here has to change if a future phase ever needs more than one.
#[async_trait]
pub trait PeerGroupRepo: Send + Sync {
    async fn create(&self, group: &PeerGroup) -> Result<(), DbError>;

    async fn get(&self, id: Uuid) -> Result<Option<PeerGroup>, DbError>;

    /// Deletes the group and its group-scoped rows through the schema's
    /// `ON DELETE CASCADE` relationships. The caller must clear
    /// `node_identity.group_id` first because that installation-local
    /// pointer deliberately has no foreign-key cascade.
    async fn delete(&self, id: Uuid) -> Result<(), DbError>;
}

pub struct SqlxPeerGroupRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxPeerGroupRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl PeerGroupRepo for SqlxPeerGroupRepo {
    async fn create(&self, group: &PeerGroup) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "INSERT INTO peer_groups (id, name, created_at) VALUES (?, ?, ?)",
            Backend::Postgres => {
                "INSERT INTO peer_groups (id, name, created_at) VALUES ($1, $2, $3)"
            }
        };
        sqlx::query(sql)
            .bind(group.id.to_string())
            .bind(group.name.as_str())
            .bind(format_datetime(group.created_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get(&self, id: Uuid) -> Result<Option<PeerGroup>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!("SELECT {COLUMNS} FROM peer_groups WHERE id = ?"),
            Backend::Postgres => format!("SELECT {COLUMNS} FROM peer_groups WHERE id = $1"),
        };
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM peer_groups WHERE id = ?",
            Backend::Postgres => "DELETE FROM peer_groups WHERE id = $1",
        };
        sqlx::query(sql)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_group(name: &str) -> PeerGroup {
        PeerGroup {
            id: Uuid::new_v4(),
            name: name.to_string(),
            created_at: Utc::now().trunc_subsecs(3),
        }
    }

    #[tokio::test]
    async fn create_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerGroupRepo::new(pool);
        let group = sample_group("Home Group");

        repo.create(&group).await.expect("create");
        let fetched = repo.get(group.id).await.expect("get").expect("present");

        assert_eq!(fetched, group);
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerGroupRepo::new(pool);

        assert!(repo.get(Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn create_duplicate_id_fails() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerGroupRepo::new(pool);
        let group = sample_group("Home Group");
        repo.create(&group).await.unwrap();

        let err = repo.create(&group).await.unwrap_err();
        assert!(matches!(err, DbError::Backend(_)));
    }

    #[tokio::test]
    async fn delete_removes_the_group() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerGroupRepo::new(pool);
        let group = sample_group("Home Group");
        repo.create(&group).await.unwrap();

        repo.delete(group.id).await.unwrap();

        assert!(repo.get(group.id).await.unwrap().is_none());
    }
}
