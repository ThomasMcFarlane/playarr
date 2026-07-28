use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use playarr_model::{ExternalProvider, ExternalRef, Work, WorkKind};
use uuid::Uuid;

use crate::codec::{
    availability_from_str, availability_to_str, bool_from_i64, bool_to_i64, format_datetime,
    parse_datetime, parse_uuid, provider_from_str, provider_to_str, work_kind_from_str,
    work_kind_to_str,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// CRUD + lookup surface over the `Work` aggregate root (movies, series,
/// artists, authors — see `playarr_model::Work`). Season/episode/album/
/// track/book children are intentionally out of scope here; they get their
/// own repositories once the catalog write path is built, since their
/// query patterns (paginate-by-parent, bulk-upsert-on-sync) differ enough
/// from the root aggregate's to not share one trait cleanly.
#[async_trait]
pub trait WorkRepo: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<Work, DbError>;

    async fn list_by_kind(
        &self,
        kind: WorkKind,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Work>, DbError>;

    /// Insert-or-update by `Work::id`. Sync pollers call this after
    /// reconciling against a source instance; there is no separate
    /// `create`/`update` split because the caller (arr-sync) always has a
    /// full, authoritative `Work` value in hand rather than a partial
    /// patch.
    async fn upsert(&self, work: &Work) -> Result<(), DbError>;

    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    /// Used by the reconciliation poller to map an inbound webhook/poll
    /// result (which only carries the source app's own id) back to a
    /// `Work`, before falling back to creating a new one.
    async fn find_by_external_ref(
        &self,
        provider: &ExternalProvider,
        external_id: &str,
    ) -> Result<Option<Work>, DbError>;
}

pub struct SqlxWorkRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxWorkRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    /// Loads a work's `work_external_refs` rows. Split out of `hydrate` so
    /// `find_by_external_ref` can reuse it without an extra round trip
    /// through the `works` table it already has the row for.
    async fn load_external_refs(&self, work_id: Uuid) -> Result<Vec<ExternalRef>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT provider, external_id FROM work_external_refs \
                 WHERE work_id = ? ORDER BY provider, external_id"
            }
            Backend::Postgres => {
                "SELECT provider, external_id FROM work_external_refs \
                 WHERE work_id = $1 ORDER BY provider, external_id"
            }
        };
        let rows = sqlx::query(sql)
            .bind(work_id.to_string())
            .fetch_all(&self.pool)
            .await?;

        rows.into_iter()
            .map(|row| {
                let provider: String = row.try_get("provider")?;
                let external_id: String = row.try_get("external_id")?;
                Ok(ExternalRef {
                    provider: provider_from_str(&provider),
                    external_id,
                })
            })
            .collect()
    }

    /// Turns one `works` row plus its `work_external_refs` into a `Work`.
    async fn hydrate(&self, row: AnyRow) -> Result<Work, DbError> {
        let id: String = row.try_get("id")?;
        let kind: String = row.try_get("kind")?;
        let title: String = row.try_get("title")?;
        let sort_title: String = row.try_get("sort_title")?;
        let overview: Option<String> = row.try_get("overview")?;
        let images: String = row.try_get("images")?;
        let genres: String = row.try_get("genres")?;
        let tags: String = row.try_get("tags")?;
        let added_at: String = row.try_get("added_at")?;
        let release_date: Option<String> = row.try_get("release_date")?;
        let monitored: i64 = row.try_get("monitored")?;
        let availability: String = row.try_get("availability")?;

        let work_id = parse_uuid(&id)?;
        let external_refs = self.load_external_refs(work_id).await?;

        Ok(Work {
            id: work_id,
            kind: work_kind_from_str(&kind)?,
            external_refs,
            title,
            sort_title,
            overview,
            images: serde_json::from_str(&images)?,
            genres: serde_json::from_str(&genres)?,
            tags: serde_json::from_str(&tags)?,
            added_at: parse_datetime(&added_at)?,
            release_date: release_date.map(|raw| parse_datetime(&raw)).transpose()?,
            monitored: bool_from_i64(monitored),
            availability: availability_from_str(&availability)?,
        })
    }
}

#[async_trait]
impl WorkRepo for SqlxWorkRepo {
    async fn get(&self, id: Uuid) -> Result<Work, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, kind, title, sort_title, overview, images, genres, tags, \
                 added_at, release_date, monitored, availability FROM works WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT id, kind, title, sort_title, overview, images, genres, tags, \
                 added_at, release_date, monitored, availability FROM works WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        self.hydrate(row).await
    }

    async fn list_by_kind(
        &self,
        kind: WorkKind,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Work>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, kind, title, sort_title, overview, images, genres, tags, \
                 added_at, release_date, monitored, availability FROM works \
                 WHERE kind = ? ORDER BY sort_title LIMIT ? OFFSET ?"
            }
            Backend::Postgres => {
                "SELECT id, kind, title, sort_title, overview, images, genres, tags, \
                 added_at, release_date, monitored, availability FROM works \
                 WHERE kind = $1 ORDER BY sort_title LIMIT $2 OFFSET $3"
            }
        };
        let rows = sqlx::query(sql)
            .bind(work_kind_to_str(kind))
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

        // N+1 on `work_external_refs` per row: acceptable for a first real
        // implementation (browse pages are paginated, so `rows.len()` is
        // bounded by `limit`), but a batched `WHERE work_id IN (...)` load
        // would cut this to two queries total if it shows up in profiling.
        let mut works = Vec::with_capacity(rows.len());
        for row in rows {
            works.push(self.hydrate(row).await?);
        }
        Ok(works)
    }

    async fn upsert(&self, work: &Work) -> Result<(), DbError> {
        let images = serde_json::to_string(&work.images)?;
        let genres = serde_json::to_string(&work.genres)?;
        let tags = serde_json::to_string(&work.tags)?;

        let mut tx = self.pool.begin().await?;

        let upsert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO works \
                 (id, kind, title, sort_title, overview, images, genres, tags, added_at, release_date, monitored, availability) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 kind = excluded.kind, title = excluded.title, sort_title = excluded.sort_title, \
                 overview = excluded.overview, images = excluded.images, genres = excluded.genres, \
                 tags = excluded.tags, added_at = excluded.added_at, release_date = excluded.release_date, \
                 monitored = excluded.monitored, availability = excluded.availability"
            }
            Backend::Postgres => {
                "INSERT INTO works \
                 (id, kind, title, sort_title, overview, images, genres, tags, added_at, release_date, monitored, availability) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
                 ON CONFLICT (id) DO UPDATE SET \
                 kind = excluded.kind, title = excluded.title, sort_title = excluded.sort_title, \
                 overview = excluded.overview, images = excluded.images, genres = excluded.genres, \
                 tags = excluded.tags, added_at = excluded.added_at, release_date = excluded.release_date, \
                 monitored = excluded.monitored, availability = excluded.availability"
            }
        };
        sqlx::query(upsert_sql)
            .bind(work.id.to_string())
            .bind(work_kind_to_str(work.kind))
            .bind(work.title.as_str())
            .bind(work.sort_title.as_str())
            .bind(work.overview.as_deref())
            .bind(images)
            .bind(genres)
            .bind(tags)
            .bind(format_datetime(work.added_at))
            .bind(work.release_date.map(format_datetime))
            .bind(bool_to_i64(work.monitored))
            .bind(availability_to_str(work.availability))
            .execute(&mut *tx)
            .await?;

        let delete_refs_sql = match self.backend {
            Backend::Sqlite => "DELETE FROM work_external_refs WHERE work_id = ?",
            Backend::Postgres => "DELETE FROM work_external_refs WHERE work_id = $1",
        };
        sqlx::query(delete_refs_sql)
            .bind(work.id.to_string())
            .execute(&mut *tx)
            .await?;

        let insert_ref_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO work_external_refs (work_id, provider, external_id) VALUES (?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO work_external_refs (work_id, provider, external_id) VALUES ($1, $2, $3)"
            }
        };
        for external_ref in &work.external_refs {
            sqlx::query(insert_ref_sql)
                .bind(work.id.to_string())
                .bind(provider_to_str(&external_ref.provider))
                .bind(external_ref.external_id.as_str())
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM works WHERE id = ?",
            Backend::Postgres => "DELETE FROM works WHERE id = $1",
        };
        let result = sqlx::query(sql)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    async fn find_by_external_ref(
        &self,
        provider: &ExternalProvider,
        external_id: &str,
    ) -> Result<Option<Work>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT w.id, w.kind, w.title, w.sort_title, w.overview, w.images, w.genres, \
                 w.tags, w.added_at, w.release_date, w.monitored, w.availability \
                 FROM works w \
                 JOIN work_external_refs r ON r.work_id = w.id \
                 WHERE r.provider = ? AND r.external_id = ? LIMIT 1"
            }
            Backend::Postgres => {
                "SELECT w.id, w.kind, w.title, w.sort_title, w.overview, w.images, w.genres, \
                 w.tags, w.added_at, w.release_date, w.monitored, w.availability \
                 FROM works w \
                 JOIN work_external_refs r ON r.work_id = w.id \
                 WHERE r.provider = $1 AND r.external_id = $2 LIMIT 1"
            }
        };
        let row = sqlx::query(sql)
            .bind(provider_to_str(provider))
            .bind(external_id)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => Ok(Some(self.hydrate(row).await?)),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};
    use playarr_model::{Availability, ImageAsset, ImageKind};

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_work(kind: WorkKind, title: &str) -> Work {
        Work {
            id: Uuid::new_v4(),
            kind,
            external_refs: vec![
                ExternalRef {
                    provider: ExternalProvider::Tmdb,
                    external_id: "123".to_string(),
                },
                ExternalRef {
                    provider: ExternalProvider::Other("anidb".to_string()),
                    external_id: "abc".to_string(),
                },
            ],
            title: title.to_string(),
            sort_title: title.to_string(),
            overview: Some("An overview.".to_string()),
            images: vec![ImageAsset {
                kind: ImageKind::Poster,
                url: "https://example.com/poster.jpg".to_string(),
                width: Some(500),
                height: Some(750),
            }],
            genres: vec!["Drama".to_string()],
            tags: vec!["favorite".to_string()],
            // Storage round-trips through millisecond precision (see
            // `codec::format_datetime`); truncate here so the fixture
            // already matches what a `get()` will hand back, instead of
            // asserting exact equality against a nanosecond-precision
            // `Utc::now()`.
            added_at: Utc::now().trunc_subsecs(3),
            release_date: Some(Utc::now().trunc_subsecs(3) - chrono::Duration::days(14)),
            monitored: true,
            availability: Availability::Available,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        let mut work = sample_work(WorkKind::Movie, "Sample Movie Kilo");

        repo.upsert(&work).await.expect("upsert");
        let mut fetched = repo.get(work.id).await.expect("get");

        // external_refs come back sorted by (provider, external_id); sort
        // the input the same way before comparing.
        work.external_refs
            .sort_by(|a, b| provider_to_str(&a.provider).cmp(&provider_to_str(&b.provider)));
        fetched
            .external_refs
            .sort_by(|a, b| provider_to_str(&a.provider).cmp(&provider_to_str(&b.provider)));

        assert_eq!(fetched, work);
    }

    #[tokio::test]
    async fn upsert_replaces_external_refs_and_fields() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        let mut work = sample_work(WorkKind::Series, "Original Title");
        repo.upsert(&work).await.expect("initial upsert");

        work.title = "Renamed Title".to_string();
        work.monitored = false;
        work.external_refs = vec![ExternalRef {
            provider: ExternalProvider::Tvdb,
            external_id: "999".to_string(),
        }];
        repo.upsert(&work).await.expect("second upsert");

        let fetched = repo.get(work.id).await.expect("get");
        assert_eq!(fetched.title, "Renamed Title");
        assert!(!fetched.monitored);
        assert_eq!(fetched.external_refs, work.external_refs);
    }

    #[tokio::test]
    async fn list_by_kind_filters_and_sorts() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);

        let movie_b = sample_work(WorkKind::Movie, "B Movie");
        let movie_a = sample_work(WorkKind::Movie, "A Movie");
        let series = sample_work(WorkKind::Series, "A Series");

        repo.upsert(&movie_b).await.unwrap();
        repo.upsert(&movie_a).await.unwrap();
        repo.upsert(&series).await.unwrap();

        let movies = repo.list_by_kind(WorkKind::Movie, 10, 0).await.unwrap();
        assert_eq!(movies.len(), 2);
        assert_eq!(movies[0].title, "A Movie");
        assert_eq!(movies[1].title, "B Movie");
    }

    #[tokio::test]
    async fn list_by_kind_paginates() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        for i in 0..3 {
            repo.upsert(&sample_work(WorkKind::Movie, &format!("Movie {i}")))
                .await
                .unwrap();
        }

        let page = repo.list_by_kind(WorkKind::Movie, 1, 1).await.unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].title, "Movie 1");
    }

    #[tokio::test]
    async fn find_by_external_ref_matches_and_misses() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        let work = sample_work(WorkKind::Movie, "Found Me");
        repo.upsert(&work).await.unwrap();

        let found = repo
            .find_by_external_ref(&ExternalProvider::Tmdb, "123")
            .await
            .unwrap();
        assert_eq!(found.map(|w| w.id), Some(work.id));

        let missing = repo
            .find_by_external_ref(&ExternalProvider::Tmdb, "does-not-exist")
            .await
            .unwrap();
        assert!(missing.is_none());
    }

    #[tokio::test]
    async fn get_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        let err = repo.get(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn delete_removes_row_and_cascades_refs() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        let work = sample_work(WorkKind::Movie, "Goodbye");
        repo.upsert(&work).await.unwrap();

        repo.delete(work.id).await.unwrap();
        let err = repo.get(work.id).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));

        let found = repo
            .find_by_external_ref(&ExternalProvider::Tmdb, "123")
            .await
            .unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn delete_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        let err = repo.delete(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }
}
