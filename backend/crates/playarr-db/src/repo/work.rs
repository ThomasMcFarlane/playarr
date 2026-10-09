use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::{folder_work_provider, ExternalProvider, ExternalRef, Work, WorkKind};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    availability_from_str, availability_to_str, bool_from_i64, bool_to_i64, format_datetime,
    parse_datetime, parse_uuid, provider_from_str, provider_to_str, work_kind_from_str,
    work_kind_to_str,
};
use crate::error::DbError;
use crate::pool::DbPool;
use crate::write_queue::{write, WriteQueue};

/// The few fields title/year matching needs, without the images, genres and
/// external refs a full [`Work`] carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkIdentity {
    pub id: Uuid,
    pub title: String,
    pub release_date: Option<DateTime<Utc>>,
}

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

    /// [`WorkIdentity`] of every catalogue work of `kind`, in the order
    /// [`Self::list_by_kind`] returns them. The default pages through
    /// `list_by_kind`; the SQL repo reads the three columns in one query.
    async fn list_identities(&self, kind: WorkKind) -> Result<Vec<WorkIdentity>, DbError> {
        const PAGE_SIZE: i64 = 200;
        let mut out = Vec::new();
        let mut offset = 0;
        loop {
            let page = self.list_by_kind(kind, PAGE_SIZE, offset).await?;
            let got = page.len() as i64;
            out.extend(page.into_iter().map(|work| WorkIdentity {
                id: work.id,
                title: work.title,
                release_date: work.release_date,
            }));
            if got < PAGE_SIZE {
                return Ok(out);
            }
            offset += PAGE_SIZE;
        }
    }

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

    /// [`Self::find_by_external_ref`] for many refs at once, keyed by the
    /// ref. Refs with no work are absent. The default asks one by one; the
    /// SQL repo answers in a few queries.
    async fn find_by_external_refs(
        &self,
        refs: &[ExternalRef],
    ) -> Result<std::collections::HashMap<ExternalRef, Work>, DbError> {
        let mut out = std::collections::HashMap::new();
        for r in refs {
            if let Some(work) = self
                .find_by_external_ref(&r.provider, &r.external_id)
                .await?
            {
                out.insert(r.clone(), work);
            }
        }
        Ok(out)
    }
}

/// Owned bind values for a work upsert, so a queued write can run again.
struct WorkBinds {
    id: String,
    kind: &'static str,
    title: String,
    sort_title: String,
    overview: Option<String>,
    images: String,
    genres: String,
    tags: String,
    added_at: String,
    release_date: Option<String>,
    end_date: Option<String>,
    monitored: i64,
    availability: &'static str,
    refs: Vec<(String, String)>,
}

impl WorkBinds {
    fn new(work: &Work) -> Result<Self, DbError> {
        Ok(Self {
            id: work.id.to_string(),
            kind: work_kind_to_str(work.kind),
            title: work.title.clone(),
            sort_title: work.sort_title.clone(),
            overview: work.overview.clone(),
            images: serde_json::to_string(&work.images)?,
            genres: serde_json::to_string(&work.genres)?,
            tags: serde_json::to_string(&work.tags)?,
            added_at: format_datetime(work.added_at),
            release_date: work.release_date.map(format_datetime),
            end_date: work.end_date.map(format_datetime),
            monitored: bool_to_i64(work.monitored),
            availability: availability_to_str(work.availability),
            refs: work
                .external_refs
                .iter()
                .map(|r| (provider_to_str(&r.provider), r.external_id.clone()))
                .collect(),
        })
    }
}

pub struct SqlxWorkRepo {
    pool: DbPool,
    queue: Option<WriteQueue>,
}

impl SqlxWorkRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool, queue: None }
    }

    /// Sends `upsert` through the shared write queue. The work row and its
    /// external refs still change together, in the queue's savepoint for the
    /// call, and the call returns after the commit.
    pub fn with_write_queue(mut self, queue: WriteQueue) -> Self {
        self.queue = Some(queue);
        self
    }

    /// Loads a work's `work_external_refs` rows. Split out of `hydrate` so
    /// `find_by_external_ref` can reuse it without an extra round trip
    /// through the `works` table it already has the row for.
    async fn load_external_refs(&self, work_id: Uuid) -> Result<Vec<ExternalRef>, DbError> {
        let sql = "SELECT provider, external_id FROM work_external_refs \
                 WHERE work_id = ? ORDER BY provider, external_id";
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

    /// Loads the `work_external_refs` of many works in a handful of
    /// `IN (...)` queries (chunked to stay under backend bind limits)
    /// instead of one query per work.
    async fn load_external_refs_batch(
        &self,
        work_ids: &[String],
    ) -> Result<std::collections::HashMap<String, Vec<ExternalRef>>, DbError> {
        let mut out: std::collections::HashMap<String, Vec<ExternalRef>> =
            std::collections::HashMap::new();
        for chunk in work_ids.chunks(500) {
            let placeholders = (1..=chunk.len())
                .map(|_| "?".to_string())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT work_id, provider, external_id FROM work_external_refs \
                 WHERE work_id IN ({placeholders}) ORDER BY provider, external_id"
            );
            let mut query = sqlx::query(&sql);
            for id in chunk {
                query = query.bind(id.clone());
            }
            for row in query.fetch_all(&self.pool).await? {
                let work_id: String = row.try_get("work_id")?;
                let provider: String = row.try_get("provider")?;
                let external_id: String = row.try_get("external_id")?;
                out.entry(work_id).or_default().push(ExternalRef {
                    provider: provider_from_str(&provider),
                    external_id,
                });
            }
        }
        Ok(out)
    }

    /// Turns one `works` row plus its `work_external_refs` into a `Work`.
    async fn hydrate(&self, row: AnyRow) -> Result<Work, DbError> {
        let id: String = row.try_get("id")?;
        let refs = self.load_external_refs(parse_uuid(&id)?).await?;
        Self::build_work(&row, refs)
    }

    fn build_work(row: &AnyRow, external_refs: Vec<ExternalRef>) -> Result<Work, DbError> {
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
        let end_date: Option<String> = row.try_get("end_date")?;
        let monitored: i64 = row.try_get("monitored")?;
        let availability: String = row.try_get("availability")?;

        let work_id = parse_uuid(&id)?;

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
            end_date: end_date.map(|raw| parse_datetime(&raw)).transpose()?,
            monitored: bool_from_i64(monitored),
            availability: availability_from_str(&availability)?,
        })
    }
}

#[async_trait]
impl WorkRepo for SqlxWorkRepo {
    async fn get(&self, id: Uuid) -> Result<Work, DbError> {
        let sql = "SELECT id, kind, title, sort_title, overview, images, genres, tags, \
                 added_at, release_date, end_date, monitored, availability FROM works WHERE id = ?";
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
        // Hidden backing works of folder-discovered files (see
        // `playarr_model::folder`) never appear in catalogue enumeration;
        // they stay reachable by id for playback and detail lookups.
        let sql = "SELECT w.id, w.kind, w.title, w.sort_title, w.overview, w.images, w.genres, \
                 w.tags, w.added_at, w.release_date, w.end_date, w.monitored, w.availability FROM works w \
                 WHERE w.kind = ? \
                 AND NOT EXISTS (SELECT 1 FROM work_external_refs r \
                                 WHERE r.work_id = w.id AND r.provider = ?) \
                 ORDER BY w.sort_title LIMIT ? OFFSET ?";
        let rows = sqlx::query(sql)
            .bind(work_kind_to_str(kind))
            .bind(provider_to_str(&folder_work_provider()))
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

        // One batched `work_external_refs` load for the whole page; the old
        // per-row query cost ~0.4 s over a 2.7k-title catalogue.
        let ids = rows
            .iter()
            .map(|row| row.try_get::<String, _>("id"))
            .collect::<Result<Vec<_>, _>>()?;
        let mut refs = self.load_external_refs_batch(&ids).await?;
        rows.iter()
            .zip(ids.iter())
            .map(|(row, id)| Self::build_work(row, refs.remove(id).unwrap_or_default()))
            .collect()
    }

    async fn list_identities(&self, kind: WorkKind) -> Result<Vec<WorkIdentity>, DbError> {
        // Same filter and order as `list_by_kind`.
        let sql = "SELECT w.id, w.title, w.release_date FROM works w \
                 WHERE w.kind = ? \
                 AND NOT EXISTS (SELECT 1 FROM work_external_refs r \
                                 WHERE r.work_id = w.id AND r.provider = ?) \
                 ORDER BY w.sort_title";
        let rows = sqlx::query(sql)
            .bind(work_kind_to_str(kind))
            .bind(provider_to_str(&folder_work_provider()))
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|row| {
                let id: String = row.try_get("id")?;
                let release_date: Option<String> = row.try_get("release_date")?;
                Ok(WorkIdentity {
                    id: parse_uuid(&id)?,
                    title: row.try_get("title")?,
                    release_date: release_date.map(|raw| parse_datetime(&raw)).transpose()?,
                })
            })
            .collect()
    }

    async fn upsert(&self, work: &Work) -> Result<(), DbError> {
        let row = Arc::new(WorkBinds::new(work)?);
        write(self.queue.as_ref(), &self.pool, move |conn| {
            let row = row.clone();
            Box::pin(async move {
                let upsert_sql = "INSERT INTO works \
                     (id, kind, title, sort_title, overview, images, genres, tags, added_at, release_date, end_date, monitored, availability) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                     ON CONFLICT (id) DO UPDATE SET \
                     kind = excluded.kind, title = excluded.title, sort_title = excluded.sort_title, \
                     overview = excluded.overview, images = excluded.images, genres = excluded.genres, \
                     tags = excluded.tags, added_at = excluded.added_at, release_date = excluded.release_date, end_date = excluded.end_date, \
                     monitored = excluded.monitored, availability = excluded.availability";
                sqlx::query(upsert_sql)
                    .bind(row.id.clone())
                    .bind(row.kind)
                    .bind(row.title.clone())
                    .bind(row.sort_title.clone())
                    .bind(row.overview.clone())
                    .bind(row.images.clone())
                    .bind(row.genres.clone())
                    .bind(row.tags.clone())
                    .bind(row.added_at.clone())
                    .bind(row.release_date.clone())
                    .bind(row.end_date.clone())
                    .bind(row.monitored)
                    .bind(row.availability)
                    .execute(&mut *conn)
                    .await?;

                sqlx::query("DELETE FROM work_external_refs WHERE work_id = ?")
                    .bind(row.id.clone())
                    .execute(&mut *conn)
                    .await?;

                let insert_ref_sql = "INSERT INTO work_external_refs (work_id, provider, external_id) VALUES (?, ?, ?)";
                for (provider, external_id) in &row.refs {
                    sqlx::query(insert_ref_sql)
                        .bind(row.id.clone())
                        .bind(provider.clone())
                        .bind(external_id.clone())
                        .execute(&mut *conn)
                        .await?;
                }
                Ok(())
            })
        })
        .await
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = "DELETE FROM works WHERE id = ?";
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
        let sql = "SELECT w.id, w.kind, w.title, w.sort_title, w.overview, w.images, w.genres, \
                 w.tags, w.added_at, w.release_date, w.end_date, w.monitored, w.availability \
                 FROM works w \
                 JOIN work_external_refs r ON r.work_id = w.id \
                 WHERE r.provider = ? AND r.external_id = ? LIMIT 1";
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

    async fn find_by_external_refs(
        &self,
        refs: &[ExternalRef],
    ) -> Result<std::collections::HashMap<ExternalRef, Work>, DbError> {
        let mut out = std::collections::HashMap::new();
        for chunk in refs.chunks(200) {
            let clause = vec!["(r.provider = ? AND r.external_id = ?)"; chunk.len()].join(" OR ");
            let sql = format!(
                "SELECT w.id, w.kind, w.title, w.sort_title, w.overview, w.images, w.genres, \
                 w.tags, w.added_at, w.release_date, w.end_date, w.monitored, w.availability, \
                 r.provider AS hit_provider, r.external_id AS hit_external_id \
                 FROM works w JOIN work_external_refs r ON r.work_id = w.id WHERE {clause}"
            );
            let mut query = sqlx::query(&sql);
            for r in chunk {
                query = query
                    .bind(provider_to_str(&r.provider))
                    .bind(r.external_id.clone());
            }
            let rows = query.fetch_all(&self.pool).await?;
            let ids: Vec<String> = rows
                .iter()
                .map(|row| row.try_get::<String, _>("id"))
                .collect::<Result<_, _>>()?;
            let mut all_refs = self.load_external_refs_batch(&ids).await?;
            for row in rows {
                let id: String = row.try_get("id")?;
                let provider: String = row.try_get("hit_provider")?;
                let external_id: String = row.try_get("hit_external_id")?;
                let key = ExternalRef {
                    provider: provider_from_str(&provider),
                    external_id,
                };
                // A ref held by several works resolves to one, as the
                // single lookup (`LIMIT 1`) does.
                if out.contains_key(&key) {
                    continue;
                }
                let refs_of = all_refs.get(&id).cloned().unwrap_or_default();
                out.insert(key, Self::build_work(&row, refs_of)?);
            }
            all_refs.clear();
        }
        Ok(out)
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
            end_date: Some(Utc::now().trunc_subsecs(3) - chrono::Duration::days(7)),
            monitored: true,
            availability: Availability::Available,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        let mut work = sample_work(WorkKind::Movie, "The Sample Movie");

        repo.upsert(&work).await.expect("upsert");
        let mut fetched = repo.get(work.id).await.expect("get");

        // external_refs come back sorted by (provider, external_id); sort
        // the input the same way before comparing.
        work.external_refs
            .sort_by_key(|a| provider_to_str(&a.provider));
        fetched
            .external_refs
            .sort_by_key(|a| provider_to_str(&a.provider));

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

    fn repo_get_refs(work: &Work) -> Vec<ExternalRef> {
        let mut refs = work.external_refs.clone();
        refs.sort_by_key(|r| (format!("{:?}", r.provider), r.external_id.clone()));
        refs
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
        // Batched external-ref loading keeps each work's own refs, ordered.
        let by_id = |work: &Work| repo_get_refs(work);
        assert_eq!(by_id(&movies[0]), by_id(&movie_a));
        assert_eq!(by_id(&movies[1]), by_id(&movie_b));
    }

    #[tokio::test]
    async fn list_identities_matches_list_by_kind_without_folder_works() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        for i in 0..450 {
            repo.upsert(&sample_work(WorkKind::Movie, &format!("Movie {i:04}")))
                .await
                .unwrap();
        }
        repo.upsert(&sample_work(WorkKind::Series, "A Series"))
            .await
            .unwrap();
        let mut folder = sample_work(WorkKind::Movie, "Folder Backing Work");
        folder.external_refs = vec![ExternalRef {
            provider: folder_work_provider(),
            external_id: "f".to_string(),
        }];
        repo.upsert(&folder).await.unwrap();

        let identities = repo.list_identities(WorkKind::Movie).await.unwrap();
        let works = repo.list_by_kind(WorkKind::Movie, 1000, 0).await.unwrap();
        assert_eq!(identities.len(), 450);
        assert_eq!(
            identities.iter().map(|i| i.id).collect::<Vec<_>>(),
            works.iter().map(|w| w.id).collect::<Vec<_>>()
        );
        assert_eq!(identities[0].title, works[0].title);
        assert_eq!(identities[0].release_date, works[0].release_date);
    }

    #[tokio::test]
    async fn list_by_kind_loads_external_refs_across_batch_chunks() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        for i in 0..620 {
            repo.upsert(&sample_work(WorkKind::Movie, &format!("Movie {i:04}")))
                .await
                .unwrap();
        }
        let movies = repo.list_by_kind(WorkKind::Movie, 1000, 0).await.unwrap();
        assert_eq!(movies.len(), 620);
        assert!(movies.iter().all(|m| m.external_refs.len() == 2));
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
    async fn find_by_external_refs_matches_the_single_lookup() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxWorkRepo::new(pool);
        let work = sample_work(WorkKind::Movie, "Found Me");
        repo.upsert(&work).await.unwrap();
        let hit = ExternalRef {
            provider: ExternalProvider::Tmdb,
            external_id: "123".to_string(),
        };
        let other_hit = ExternalRef {
            provider: ExternalProvider::Other("anidb".to_string()),
            external_id: "abc".to_string(),
        };
        let miss = ExternalRef {
            provider: ExternalProvider::Tmdb,
            external_id: "does-not-exist".to_string(),
        };
        let found = repo
            .find_by_external_refs(&[hit.clone(), other_hit.clone(), miss.clone()])
            .await
            .unwrap();
        assert_eq!(found.len(), 2);
        assert!(!found.contains_key(&miss));
        let single = repo
            .find_by_external_ref(&hit.provider, &hit.external_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(found[&hit], single);
        assert_eq!(found[&other_hit].id, work.id);
        assert!(repo.find_by_external_refs(&[]).await.unwrap().is_empty());
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

    /// Through the write queue the work row and its external refs are still
    /// replaced together, and the call returns once they are committed.
    #[tokio::test]
    async fn upsert_through_the_write_queue_replaces_refs() {
        let pool = test_sqlite_pool().await;
        let queue = WriteQueue::spawn(pool.clone(), crate::WriteQueueConfig::default());
        let repo = SqlxWorkRepo::new(pool.clone()).with_write_queue(queue.clone());
        let mut work = sample_work(WorkKind::Movie, "Queued");
        repo.upsert(&work).await.unwrap();
        work.title = "Queued again".to_string();
        work.external_refs = vec![ExternalRef {
            provider: ExternalProvider::Imdb,
            external_id: "tt0000001".to_string(),
        }];
        repo.upsert(&work).await.unwrap();

        let plain = SqlxWorkRepo::new(pool);
        let stored = plain
            .find_by_external_ref(&ExternalProvider::Imdb, "tt0000001")
            .await
            .unwrap()
            .expect("found by its new ref");
        assert_eq!(stored.id, work.id);
        assert_eq!(stored.title, "Queued again");
        assert!(plain
            .find_by_external_ref(&ExternalProvider::Tmdb, "123")
            .await
            .unwrap()
            .is_none());
        queue.shutdown().await;
    }
}
