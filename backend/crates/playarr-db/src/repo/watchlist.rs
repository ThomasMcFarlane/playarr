//! Storage for the per-profile watchlist -- see `playarr_model::discovery`.

use async_trait::async_trait;
use playarr_model::discovery::{DiscoveryKind, WatchlistItem};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

#[async_trait]
pub trait WatchlistRepo: Send + Sync {
    /// Newest first.
    async fn list(&self, user_id: Uuid) -> Result<Vec<WatchlistItem>, DbError>;
    async fn get(&self, user_id: Uuid, title_key: &str) -> Result<Option<WatchlistItem>, DbError>;
    /// Idempotent: re-adding keeps the original `added_at` and refreshes the snapshot.
    async fn add(&self, user_id: Uuid, item: &WatchlistItem) -> Result<(), DbError>;
    /// Idempotent; returns whether a row was removed.
    async fn remove(&self, user_id: Uuid, title_key: &str) -> Result<bool, DbError>;
}

pub struct SqlxWatchlistRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxWatchlistRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<WatchlistItem, DbError> {
        let kind: String = row.try_get("kind")?;
        let work_id: Option<String> = row.try_get("work_id")?;
        let refs: String = row.try_get("external_refs")?;
        let added_at: String = row.try_get("added_at")?;
        let year: Option<i32> = row.try_get("year")?;
        Ok(WatchlistItem {
            title_key: row.try_get("title_key")?,
            kind: serde_json::from_value::<DiscoveryKind>(serde_json::Value::String(kind.clone()))
                .map_err(|_| decode_err(format!("unknown discovery kind {kind}")))?,
            title: row.try_get("title")?,
            year,
            work_id: work_id.as_deref().map(parse_uuid).transpose()?,
            external_refs: serde_json::from_str(&refs)?,
            poster_url: row.try_get("poster_url")?,
            added_at: parse_datetime(&added_at)?,
        })
    }
}

const COLS: &str = "title_key, kind, title, year, work_id, external_refs, poster_url, added_at";

#[async_trait]
impl WatchlistRepo for SqlxWatchlistRepo {
    async fn list(&self, user_id: Uuid) -> Result<Vec<WatchlistItem>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLS} FROM watchlist_items WHERE user_id = ? ORDER BY added_at DESC, title_key"
            ),
            Backend::Postgres => format!(
                "SELECT {COLS} FROM watchlist_items WHERE user_id = $1 ORDER BY added_at DESC, title_key"
            ),
        };
        let rows = sqlx::query(&sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn get(&self, user_id: Uuid, title_key: &str) -> Result<Option<WatchlistItem>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                format!("SELECT {COLS} FROM watchlist_items WHERE user_id = ? AND title_key = ?")
            }
            Backend::Postgres => {
                format!("SELECT {COLS} FROM watchlist_items WHERE user_id = $1 AND title_key = $2")
            }
        };
        let row = sqlx::query(&sql)
            .bind(user_id.to_string())
            .bind(title_key)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn add(&self, user_id: Uuid, item: &WatchlistItem) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO watchlist_items \
                 (user_id, title_key, kind, title, year, work_id, external_refs, poster_url, added_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (user_id, title_key) DO UPDATE SET \
                 kind = excluded.kind, title = excluded.title, year = excluded.year, \
                 work_id = excluded.work_id, external_refs = excluded.external_refs, \
                 poster_url = excluded.poster_url"
            }
            Backend::Postgres => {
                "INSERT INTO watchlist_items \
                 (user_id, title_key, kind, title, year, work_id, external_refs, poster_url, added_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
                 ON CONFLICT (user_id, title_key) DO UPDATE SET \
                 kind = EXCLUDED.kind, title = EXCLUDED.title, year = EXCLUDED.year, \
                 work_id = EXCLUDED.work_id, external_refs = EXCLUDED.external_refs, \
                 poster_url = EXCLUDED.poster_url"
            }
        };
        sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(&item.title_key)
            .bind(item.kind.as_str())
            .bind(&item.title)
            .bind(item.year)
            .bind(item.work_id.map(|id| id.to_string()))
            .bind(serde_json::to_string(&item.external_refs)?)
            .bind(item.poster_url.clone())
            .bind(format_datetime(item.added_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn remove(&self, user_id: Uuid, title_key: &str) -> Result<bool, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM watchlist_items WHERE user_id = ? AND title_key = ?",
            Backend::Postgres => {
                "DELETE FROM watchlist_items WHERE user_id = $1 AND title_key = $2"
            }
        };
        let res = sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(title_key)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};
    use playarr_model::{ExternalProvider, ExternalRef};

    use super::*;
    use crate::pool::test_sqlite_pool;

    async fn seed_user(pool: &DbPool) -> Uuid {
        let policy_id = Uuid::new_v4();
        sqlx::query("INSERT INTO policies (id, name) VALUES (?, 'Test Policy')")
            .bind(policy_id.to_string())
            .execute(pool)
            .await
            .unwrap();
        let user_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users (id, username, display_name, password_hash, policy_id, created_at) \
             VALUES (?, ?, 'Test User', 'fakehash', ?, '2024-01-01T00:00:00.000Z')",
        )
        .bind(user_id.to_string())
        .bind(format!("test-{user_id}"))
        .bind(policy_id.to_string())
        .execute(pool)
        .await
        .unwrap();
        user_id
    }

    fn item(key: &str, offset_s: i64) -> WatchlistItem {
        WatchlistItem {
            title_key: key.into(),
            kind: DiscoveryKind::Movie,
            title: format!("Title {key}"),
            year: Some(1999),
            work_id: Some(Uuid::new_v4()),
            external_refs: vec![ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: "603".into(),
            }],
            poster_url: None,
            added_at: (Utc::now() + chrono::Duration::seconds(offset_s)).trunc_subsecs(3),
        }
    }

    #[tokio::test]
    async fn add_list_remove_round_trip_newest_first() {
        let pool = test_sqlite_pool().await;
        let user = seed_user(&pool).await;
        let other = seed_user(&pool).await;
        let repo = SqlxWatchlistRepo::new(pool);
        let (a, b) = (item("tmdb:movie:1", 0), item("tmdb:movie:2", 10));
        repo.add(user, &a).await.unwrap();
        repo.add(user, &b).await.unwrap();
        repo.add(other, &item("tmdb:movie:9", 0)).await.unwrap();
        let listed = repo.list(user).await.unwrap();
        assert_eq!(listed, vec![b.clone(), a.clone()]);
        assert_eq!(repo.get(user, "tmdb:movie:1").await.unwrap(), Some(a));
        assert!(repo.remove(user, "tmdb:movie:1").await.unwrap());
        assert!(!repo.remove(user, "tmdb:movie:1").await.unwrap());
        assert_eq!(repo.list(user).await.unwrap(), vec![b]);
        assert_eq!(repo.list(other).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn re_adding_keeps_original_added_at_and_refreshes_snapshot() {
        let pool = test_sqlite_pool().await;
        let user = seed_user(&pool).await;
        let repo = SqlxWatchlistRepo::new(pool);
        let first = item("k", 0);
        repo.add(user, &first).await.unwrap();
        let mut again = item("k", 500);
        again.title = "Renamed".into();
        repo.add(user, &again).await.unwrap();
        let got = repo.get(user, "k").await.unwrap().unwrap();
        assert_eq!(got.title, "Renamed");
        assert_eq!(got.added_at, first.added_at);
    }
}
