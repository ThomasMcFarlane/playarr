//! Group-wide library registry -- Phase 2 of
//! `docs/architecture/peer-groups.md` (see that document's §2.3 for the
//! table itself and §5.1 for why this exists as its own entity rather than
//! reusing a local `SourceInstance::id`).
//!
//! `SourceInstance` is the only thing an operator can currently call a
//! "library," and its id is minted independently per node -- there is no
//! value that means "the Movies library" the same way on every peer.
//! [`playarr_model::GroupLibrary`] is that value: a stable, group-wide id
//! an operator maps each node's own `SourceInstance` onto via
//! `SourceInstance::group_library_id`. Rows sync across the group by plain
//! last-writer-wins on `updated_at` (§3.1/§3.5), same as `users`/`policies`/
//! `source_instances`/`routing_rules` -- `account_sync.rs`
//! (`playarr-peer-sync`) is this repo's sync writer, calling
//! [`GroupLibraryRepo::upsert`] for every incoming row exactly the way
//! `PeerNodeRepo::upsert` already does for gossiped `peer_nodes` rows.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::GroupLibrary;
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

fn from_row(row: &AnyRow) -> Result<GroupLibrary, DbError> {
    let id: String = row.try_get("id")?;
    let group_id: String = row.try_get("group_id")?;
    let name: String = row.try_get("name")?;
    let created_at: String = row.try_get("created_at")?;
    let updated_at: String = row.try_get("updated_at")?;

    Ok(GroupLibrary {
        id: parse_uuid(&id)?,
        group_id: parse_uuid(&group_id)?,
        name,
        created_at: parse_datetime(&created_at)?,
        updated_at: parse_datetime(&updated_at)?,
    })
}

const COLUMNS: &str = "id, group_id, name, created_at, updated_at";

/// Durable registry of every [`GroupLibrary`] this node knows about --
/// group-wide library identities an operator maps local `SourceInstance`s
/// onto (§5.1) and that `Policy::group_library_allow` /
/// `RoutingRule::group_library_id` (§2.4) reference. See
/// `docs/architecture/peer-groups.md` §2.3.
#[async_trait]
pub trait GroupLibraryRepo: Send + Sync {
    /// Insert-or-update by `GroupLibrary::id`. Both the local admin-authored
    /// path (create/rename) and `account_sync.rs`'s peer-ingest path share
    /// this one write method, exactly like `PeerNodeRepo::upsert`; callers
    /// own stamping `updated_at` (server time for a local write, the
    /// origin peer's claimed value for a synced one), the same convention
    /// `PeerNode::updated_at` already uses.
    async fn upsert(&self, library: &GroupLibrary) -> Result<(), DbError>;

    async fn get(&self, id: Uuid) -> Result<Option<GroupLibrary>, DbError>;

    /// Every `GroupLibrary` in one group, name-ordered -- the admin "group
    /// libraries" list and the `SourceInstance.group_library_id` picker.
    async fn list_for_group(&self, group_id: Uuid) -> Result<Vec<GroupLibrary>, DbError>;

    /// Every `GroupLibrary` in `group_id` whose `updated_at` is strictly
    /// greater than `since` (every row in the group, oldest first, when
    /// `since` is `None`) -- the read behind `GET /api/v1/peer/
    /// libraries?since=`'s `group_libraries` half (`docs/architecture/
    /// peer-groups.md` §3.6). `group_libraries` has no soft-delete column
    /// (see §2.3's schema -- unlike `users`/`policies`/`source_instances`,
    /// nothing here ever tombstones a row), so unlike
    /// `UserRepo::list_updated_since` there is no `deleted_at` filtering
    /// concern. Ordered by `updated_at` (then `id` as a stable tie-breaker)
    /// so the caller can resume from the last row's `updated_at`.
    async fn list_updated_since(
        &self,
        group_id: Uuid,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<GroupLibrary>, DbError>;
}

pub struct SqlxGroupLibraryRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxGroupLibraryRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl GroupLibraryRepo for SqlxGroupLibraryRepo {
    async fn upsert(&self, library: &GroupLibrary) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO group_libraries (id, group_id, name, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 group_id = excluded.group_id, name = excluded.name, \
                 updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO group_libraries (id, group_id, name, created_at, updated_at) \
                 VALUES ($1, $2, $3, $4, $5) \
                 ON CONFLICT (id) DO UPDATE SET \
                 group_id = excluded.group_id, name = excluded.name, \
                 updated_at = excluded.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(library.id.to_string())
            .bind(library.group_id.to_string())
            .bind(library.name.as_str())
            .bind(format_datetime(library.created_at))
            .bind(format_datetime(library.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get(&self, id: Uuid) -> Result<Option<GroupLibrary>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!("SELECT {COLUMNS} FROM group_libraries WHERE id = ?"),
            Backend::Postgres => format!("SELECT {COLUMNS} FROM group_libraries WHERE id = $1"),
        };
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn list_for_group(&self, group_id: Uuid) -> Result<Vec<GroupLibrary>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                format!("SELECT {COLUMNS} FROM group_libraries WHERE group_id = ? ORDER BY name")
            }
            Backend::Postgres => {
                format!("SELECT {COLUMNS} FROM group_libraries WHERE group_id = $1 ORDER BY name")
            }
        };
        let rows = sqlx::query(&sql)
            .bind(group_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(from_row).collect()
    }

    async fn list_updated_since(
        &self,
        group_id: Uuid,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<GroupLibrary>, DbError> {
        let sql = match (self.backend, since.is_some()) {
            (Backend::Sqlite, true) => format!(
                "SELECT {COLUMNS} FROM group_libraries WHERE group_id = ? AND updated_at > ? \
                 ORDER BY updated_at ASC, id ASC"
            ),
            (Backend::Sqlite, false) => format!(
                "SELECT {COLUMNS} FROM group_libraries WHERE group_id = ? \
                 ORDER BY updated_at ASC, id ASC"
            ),
            (Backend::Postgres, true) => format!(
                "SELECT {COLUMNS} FROM group_libraries WHERE group_id = $1 AND updated_at > $2 \
                 ORDER BY updated_at ASC, id ASC"
            ),
            (Backend::Postgres, false) => format!(
                "SELECT {COLUMNS} FROM group_libraries WHERE group_id = $1 \
                 ORDER BY updated_at ASC, id ASC"
            ),
        };
        let mut query = sqlx::query(&sql).bind(group_id.to_string());
        if let Some(since) = since {
            query = query.bind(format_datetime(since));
        }
        let rows = query.fetch_all(&self.pool).await?;
        rows.iter().map(from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};

    use super::*;
    use crate::pool::test_sqlite_pool;

    /// `group_libraries.group_id` has a `REFERENCES peer_groups (id)`
    /// foreign key (see `0034_group_libraries.sql`), so every test needs a
    /// real `peer_groups` row first -- same bypass-the-sibling-repo pattern
    /// `peer_node.rs`'s own tests use for the identical foreign key.
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

    fn sample_library(group_id: Uuid, name: &str) -> GroupLibrary {
        let now = Utc::now().trunc_subsecs(3);
        GroupLibrary {
            id: Uuid::new_v4(),
            group_id,
            name: name.to_string(),
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxGroupLibraryRepo::new(pool);
        let library = sample_library(group_id, "Movies");

        repo.upsert(&library).await.expect("upsert");
        let fetched = repo.get(library.id).await.expect("get").expect("present");

        assert_eq!(fetched, library);
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxGroupLibraryRepo::new(pool);

        assert!(repo.get(Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn upsert_updates_existing_row_by_id() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxGroupLibraryRepo::new(pool);
        let mut library = sample_library(group_id, "Movies");
        repo.upsert(&library).await.unwrap();

        library.name = "Renamed Movies".to_string();
        library.updated_at = Utc::now().trunc_subsecs(3);
        repo.upsert(&library).await.unwrap();

        let fetched = repo.get(library.id).await.unwrap().unwrap();
        assert_eq!(fetched, library);
    }

    #[tokio::test]
    async fn list_for_group_orders_by_name() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxGroupLibraryRepo::new(pool);
        let tv = sample_library(group_id, "TV");
        let movies = sample_library(group_id, "Movies");
        let music = sample_library(group_id, "Music");

        repo.upsert(&tv).await.unwrap();
        repo.upsert(&movies).await.unwrap();
        repo.upsert(&music).await.unwrap();

        let all = repo.list_for_group(group_id).await.unwrap();
        assert_eq!(
            all.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(),
            vec!["Movies", "Music", "TV"]
        );
    }

    #[tokio::test]
    async fn list_for_group_excludes_other_groups() {
        let pool = test_sqlite_pool().await;
        let group_a = seed_group(&pool).await;
        let group_b = seed_group(&pool).await;
        let repo = SqlxGroupLibraryRepo::new(pool);
        let library_a = sample_library(group_a, "Movies");
        let library_b = sample_library(group_b, "TV");

        repo.upsert(&library_a).await.unwrap();
        repo.upsert(&library_b).await.unwrap();

        let fetched = repo.list_for_group(group_a).await.unwrap();
        assert_eq!(fetched, vec![library_a]);
    }

    #[tokio::test]
    async fn list_for_group_empty_for_single_ungrouped_node() {
        // Phase 2 must be inert for a single, ungrouped node: with no
        // `GroupLibrary` ever created, the list stays empty.
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxGroupLibraryRepo::new(pool);

        assert!(repo.list_for_group(group_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn list_updated_since_none_returns_every_row_in_the_group() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxGroupLibraryRepo::new(pool);
        let movies = sample_library(group_id, "Movies");
        let tv = sample_library(group_id, "TV");
        repo.upsert(&movies).await.unwrap();
        repo.upsert(&tv).await.unwrap();

        let rows = repo.list_updated_since(group_id, None).await.unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|library| library.id).collect();
        assert!(ids.contains(&movies.id));
        assert!(ids.contains(&tv.id));
    }

    #[tokio::test]
    async fn list_updated_since_excludes_other_groups() {
        let pool = test_sqlite_pool().await;
        let group_a = seed_group(&pool).await;
        let group_b = seed_group(&pool).await;
        let repo = SqlxGroupLibraryRepo::new(pool);
        let library_a = sample_library(group_a, "Movies");
        let library_b = sample_library(group_b, "TV");
        repo.upsert(&library_a).await.unwrap();
        repo.upsert(&library_b).await.unwrap();

        let fetched = repo.list_updated_since(group_a, None).await.unwrap();
        assert_eq!(fetched, vec![library_a]);
    }

    #[tokio::test]
    async fn list_updated_since_a_cursor_excludes_rows_at_or_before_it() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxGroupLibraryRepo::new(pool);
        let now = Utc::now().trunc_subsecs(3);
        let mut old = sample_library(group_id, "Already Synced");
        old.updated_at = now - chrono::Duration::minutes(10);
        repo.upsert(&old).await.unwrap();
        let cursor = old.updated_at;

        let mut fresh = sample_library(group_id, "Freshly Changed");
        fresh.updated_at = now;
        repo.upsert(&fresh).await.unwrap();

        let rows = repo
            .list_updated_since(group_id, Some(cursor))
            .await
            .unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|library| library.id).collect();
        assert!(
            !ids.contains(&old.id),
            "a row at or before the cursor must not be re-reported"
        );
        assert!(ids.contains(&fresh.id));
    }

    #[tokio::test]
    async fn list_updated_since_orders_oldest_first() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxGroupLibraryRepo::new(pool);
        let now = Utc::now().trunc_subsecs(3);
        let mut older = sample_library(group_id, "Older Write");
        older.updated_at = now - chrono::Duration::minutes(10);
        let mut newer = sample_library(group_id, "Newer Write");
        newer.updated_at = now;
        repo.upsert(&newer).await.unwrap();
        repo.upsert(&older).await.unwrap();

        let rows = repo.list_updated_since(group_id, None).await.unwrap();
        let position = |id: Uuid| rows.iter().position(|library| library.id == id).unwrap();
        assert!(position(older.id) < position(newer.id));
    }
}
