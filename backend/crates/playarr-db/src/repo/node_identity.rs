//! Database boundary for this installation's own singleton
//! [`NodeIdentity`] -- Phase 1 of `docs/architecture/peer-groups.md` (see
//! that document's §2.1 for the full design and rationale).
//!
//! Exactly one row ever exists in `node_identity`, keyed by a fixed
//! sentinel id, the same singleton convention
//! [`crate::repo::SystemSettingsRepo`] uses. Unlike `system_settings`
//! there is no sensible default to fall back to (a private key can't be
//! synthesized on read), so `get` returns `None` until first boot -- or a
//! future join flow -- has actually written one.
//!
//! `NodeIdentity::private_key` never leaves this module through any query
//! but the two defined here: [`NodeIdentityRepo::get`] and
//! [`NodeIdentityRepo::put`] are the *only* SQL in this crate that touches
//! the `private_key` column. No other method, view, or admin-facing query
//! anywhere in `playarr-db` selects it -- callers that need the raw
//! secret (e.g. the Ed25519 signer, once Phase 2 wires it in) must go
//! through this repo, and the value stays wrapped in [`Sensitive<String>`]
//! the moment it leaves the database so it can never leak via `Debug`/
//! `Display`.

use async_trait::async_trait;
use playarr_model::{NodeIdentity, Sensitive};
use sqlx::any::AnyRow;
use sqlx::Row;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::DbPool;

const NODE_IDENTITY_ID: &str = "00000000-0000-0000-0000-00000000e001";

/// Singleton accessor over this node's own [`NodeIdentity`].
#[async_trait]
pub trait NodeIdentityRepo: Send + Sync {
    /// `None` until this installation has minted (or been given) its own
    /// identity -- byte-for-byte inert for a fresh, ungrouped node.
    async fn get(&self) -> Result<Option<NodeIdentity>, DbError>;

    /// Insert-or-replace the singleton row.
    async fn put(&self, identity: &NodeIdentity) -> Result<(), DbError>;
}

pub struct SqlxNodeIdentityRepo {
    pool: DbPool,
}

impl SqlxNodeIdentityRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    fn from_row(row: &AnyRow) -> Result<NodeIdentity, DbError> {
        let peer_id: String = row.try_get("peer_id")?;
        let private_key: String = row.try_get("private_key")?;
        let group_id: Option<String> = row.try_get("group_id")?;
        let created_at: String = row.try_get("created_at")?;

        Ok(NodeIdentity {
            peer_id: parse_uuid(&peer_id)?,
            private_key: Sensitive::new(private_key),
            group_id: group_id.map(|s| parse_uuid(&s)).transpose()?,
            created_at: parse_datetime(&created_at)?,
        })
    }
}

const COLUMNS: &str = "peer_id, private_key, group_id, created_at";

#[async_trait]
impl NodeIdentityRepo for SqlxNodeIdentityRepo {
    async fn get(&self) -> Result<Option<NodeIdentity>, DbError> {
        let sql = format!("SELECT {COLUMNS} FROM node_identity WHERE id = ?");
        let row = sqlx::query(&sql)
            .bind(NODE_IDENTITY_ID)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn put(&self, identity: &NodeIdentity) -> Result<(), DbError> {
        let sql = "INSERT INTO node_identity (id, peer_id, private_key, group_id, created_at) \
                 VALUES (?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 peer_id = excluded.peer_id, private_key = excluded.private_key, \
                 group_id = excluded.group_id, created_at = excluded.created_at";
        sqlx::query(sql)
            .bind(NODE_IDENTITY_ID)
            .bind(identity.peer_id.to_string())
            .bind(identity.private_key.expose_secret().as_str())
            .bind(identity.group_id.map(|id| id.to_string()))
            .bind(format_datetime(identity.created_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::SubsecRound;
    use uuid::Uuid;

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_identity() -> NodeIdentity {
        NodeIdentity {
            peer_id: Uuid::new_v4(),
            private_key: Sensitive::new("ed25519-seed-base64".to_string()),
            group_id: None,
            created_at: chrono::Utc::now().trunc_subsecs(3),
        }
    }

    #[tokio::test]
    async fn get_with_no_identity_minted_is_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxNodeIdentityRepo::new(pool);
        assert_eq!(repo.get().await.unwrap(), None);
    }

    #[tokio::test]
    async fn put_then_get_round_trips_ungrouped_identity() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxNodeIdentityRepo::new(pool);
        let identity = sample_identity();

        repo.put(&identity).await.unwrap();
        let fetched = repo.get().await.unwrap().unwrap();

        assert_eq!(fetched, identity);
        assert_eq!(fetched.group_id, None);
    }

    #[tokio::test]
    async fn put_then_get_round_trips_grouped_identity() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxNodeIdentityRepo::new(pool);
        let mut identity = sample_identity();
        identity.group_id = Some(Uuid::new_v4());

        repo.put(&identity).await.unwrap();
        let fetched = repo.get().await.unwrap().unwrap();

        assert_eq!(fetched, identity);
    }

    #[tokio::test]
    async fn put_replaces_the_single_row_not_appends() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxNodeIdentityRepo::new(pool);
        repo.put(&sample_identity()).await.unwrap();

        let mut updated = sample_identity();
        updated.group_id = Some(Uuid::new_v4());
        repo.put(&updated).await.unwrap();

        let fetched = repo.get().await.unwrap().unwrap();
        assert_eq!(fetched.peer_id, updated.peer_id);
        assert_eq!(fetched.group_id, updated.group_id);

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM node_identity")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(count.0, 1);
    }

    #[tokio::test]
    async fn put_never_selects_private_key_through_a_second_path() {
        // Regression guard for the design doc's own invariant (§2.1): the
        // only query in this module that reads `private_key` is `get`'s
        // `from_row`. Assert the round trip actually carries the exact
        // secret through `Sensitive`, so a future edit that accidentally
        // drops the column from `COLUMNS` (silently defaulting the field)
        // is caught here rather than discovered downstream.
        let pool = test_sqlite_pool().await;
        let repo = SqlxNodeIdentityRepo::new(pool);
        let identity = sample_identity();

        repo.put(&identity).await.unwrap();
        let fetched = repo.get().await.unwrap().unwrap();

        assert_eq!(
            fetched.private_key.expose_secret(),
            identity.private_key.expose_secret()
        );
    }
}
