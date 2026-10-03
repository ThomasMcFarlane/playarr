//! Credential-free identities of source instances owned by other peer-group
//! nodes. The local `source_instances` table remains the sole owner of URLs,
//! API keys, and reconciliation settings; peer sync writes only this cache.

use async_trait::async_trait;
use playarr_model::SourceInstanceIdentity;
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    format_datetime, parse_datetime, parse_uuid, source_kind_from_str, source_kind_to_str,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

fn from_row(row: &AnyRow) -> Result<SourceInstanceIdentity, DbError> {
    let id: String = row.try_get("source_instance_id")?;
    let kind: String = row.try_get("kind")?;
    let group_library_id: Option<String> = row.try_get("group_library_id")?;
    let updated_at: String = row.try_get("updated_at")?;
    let deleted_at: Option<String> = row.try_get("deleted_at")?;

    Ok(SourceInstanceIdentity {
        id: parse_uuid(&id)?,
        kind: source_kind_from_str(&kind)?,
        name: row.try_get("name")?,
        priority: row.try_get("priority")?,
        group_library_id: group_library_id.as_deref().map(parse_uuid).transpose()?,
        updated_at: parse_datetime(&updated_at)?,
        deleted_at: deleted_at.as_deref().map(parse_datetime).transpose()?,
    })
}

const COLUMNS: &str = "source_instance_id, kind, name, priority, group_library_id, \
                       updated_at, deleted_at";

#[async_trait]
pub trait PeerSourceInstanceRepo: Send + Sync {
    /// Applies a source identity after the caller has resolved its LWW
    /// timestamp. The reporting peer is part of the key, so independently
    /// minted source-instance UUIDs never collide between nodes.
    async fn upsert(
        &self,
        peer_node_id: Uuid,
        instance: &SourceInstanceIdentity,
    ) -> Result<(), DbError>;

    /// Reads one row including tombstones for LWW comparison.
    async fn get(
        &self,
        peer_node_id: Uuid,
        source_instance_id: Uuid,
    ) -> Result<Option<SourceInstanceIdentity>, DbError>;

    /// Lists active identities reported by one peer for admin/debug reads.
    async fn list_for_peer(
        &self,
        peer_node_id: Uuid,
    ) -> Result<Vec<SourceInstanceIdentity>, DbError>;
}

pub struct SqlxPeerSourceInstanceRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxPeerSourceInstanceRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl PeerSourceInstanceRepo for SqlxPeerSourceInstanceRepo {
    async fn upsert(
        &self,
        peer_node_id: Uuid,
        instance: &SourceInstanceIdentity,
    ) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO peer_source_instances \
                 (peer_node_id, source_instance_id, kind, name, priority, group_library_id, \
                  updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (peer_node_id, source_instance_id) DO UPDATE SET \
                 kind = excluded.kind, name = excluded.name, priority = excluded.priority, \
                 group_library_id = excluded.group_library_id, updated_at = excluded.updated_at, \
                 deleted_at = excluded.deleted_at"
            }
            Backend::Postgres => {
                "INSERT INTO peer_source_instances \
                 (peer_node_id, source_instance_id, kind, name, priority, group_library_id, \
                  updated_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
                 ON CONFLICT (peer_node_id, source_instance_id) DO UPDATE SET \
                 kind = excluded.kind, name = excluded.name, priority = excluded.priority, \
                 group_library_id = excluded.group_library_id, updated_at = excluded.updated_at, \
                 deleted_at = excluded.deleted_at"
            }
        };
        sqlx::query(sql)
            .bind(peer_node_id.to_string())
            .bind(instance.id.to_string())
            .bind(source_kind_to_str(instance.kind))
            .bind(instance.name.as_str())
            .bind(instance.priority)
            .bind(instance.group_library_id.map(|id| id.to_string()))
            .bind(format_datetime(instance.updated_at))
            .bind(instance.deleted_at.map(format_datetime))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get(
        &self,
        peer_node_id: Uuid,
        source_instance_id: Uuid,
    ) -> Result<Option<SourceInstanceIdentity>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM peer_source_instances \
                 WHERE peer_node_id = ? AND source_instance_id = ?"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM peer_source_instances \
                 WHERE peer_node_id = $1 AND source_instance_id = $2"
            ),
        };
        let row = sqlx::query(&sql)
            .bind(peer_node_id.to_string())
            .bind(source_instance_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn list_for_peer(
        &self,
        peer_node_id: Uuid,
    ) -> Result<Vec<SourceInstanceIdentity>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM peer_source_instances \
                 WHERE peer_node_id = ? AND deleted_at IS NULL ORDER BY priority, name"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM peer_source_instances \
                 WHERE peer_node_id = $1 AND deleted_at IS NULL ORDER BY priority, name"
            ),
        };
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
    use playarr_model::SourceKind;

    use super::*;
    use crate::pool::test_sqlite_pool;

    #[tokio::test]
    async fn identities_round_trip_and_tombstones_leave_the_active_list() {
        let repo = SqlxPeerSourceInstanceRepo::new(test_sqlite_pool().await);
        let peer_id = Uuid::new_v4();
        let mut identity = SourceInstanceIdentity {
            id: Uuid::new_v4(),
            kind: SourceKind::Radarr,
            name: "Remote Radarr".to_string(),
            priority: 2,
            group_library_id: Some(Uuid::new_v4()),
            updated_at: Utc::now().trunc_subsecs(3),
            deleted_at: None,
        };

        repo.upsert(peer_id, &identity).await.unwrap();
        assert_eq!(
            repo.get(peer_id, identity.id).await.unwrap(),
            Some(identity.clone())
        );
        assert_eq!(
            repo.list_for_peer(peer_id).await.unwrap(),
            vec![identity.clone()]
        );

        identity.updated_at = Utc::now().trunc_subsecs(3);
        identity.deleted_at = Some(identity.updated_at);
        repo.upsert(peer_id, &identity).await.unwrap();

        assert_eq!(
            repo.get(peer_id, identity.id).await.unwrap(),
            Some(identity)
        );
        assert!(repo.list_for_peer(peer_id).await.unwrap().is_empty());
    }
}
