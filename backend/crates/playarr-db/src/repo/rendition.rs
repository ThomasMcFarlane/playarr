use std::path::PathBuf;

use async_trait::async_trait;
use playarr_model::{Rendition, RenditionStatus};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    format_datetime, parse_datetime, parse_uuid, produced_by_from_str, produced_by_to_str,
    rendition_status_from_str, rendition_status_to_str,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// CRUD surface over [`playarr_model::Rendition`] — the derived,
/// playback-ready encodes of a [`playarr_model::MediaFile`]. This is the
/// table both the Tdarr background pipeline (`playarr-transcode`'s
/// `TdarrDispatcher`) and the on-demand transcode path write into, so the
/// direct-play decision (`TranscodeOrchestrator::find_existing_rendition`)
/// can find a ready rendition regardless of which path produced it.
#[async_trait]
pub trait RenditionRepo: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<Rendition, DbError>;

    async fn list_for_media_file(&self, media_file_id: Uuid) -> Result<Vec<Rendition>, DbError>;

    /// Finds a `Ready` rendition for `media_file_id` matching `profile`, if
    /// one exists — the query `find_existing_rendition` in
    /// `playarr-transcode` is built around.
    async fn find_ready(
        &self,
        media_file_id: Uuid,
        profile: &str,
    ) -> Result<Option<Rendition>, DbError>;

    async fn upsert(&self, rendition: &Rendition) -> Result<(), DbError>;

    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    async fn mark_status(&self, id: Uuid, status: RenditionStatus) -> Result<(), DbError>;
}

pub struct SqlxRenditionRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxRenditionRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<Rendition, DbError> {
        let id: String = row.try_get("id")?;
        let media_file_id: String = row.try_get("media_file_id")?;
        let profile: String = row.try_get("profile")?;
        let container: String = row.try_get("container")?;
        let codec: String = row.try_get("codec")?;
        let bitrate: Option<i64> = row.try_get("bitrate")?;
        let output_path: String = row.try_get("output_path")?;
        let produced_by: String = row.try_get("produced_by")?;
        let produced_at: String = row.try_get("produced_at")?;
        let status: String = row.try_get("status")?;

        Ok(Rendition {
            id: parse_uuid(&id)?,
            media_file_id: parse_uuid(&media_file_id)?,
            profile,
            container,
            codec,
            // Bitrates are always written from a non-negative `u64` (see
            // `upsert`), so this cast back is lossless for any value this
            // repository itself ever stored.
            bitrate: bitrate.map(|b| b as u64),
            output_path: PathBuf::from(output_path),
            produced_by: produced_by_from_str(&produced_by)?,
            produced_at: parse_datetime(&produced_at)?,
            status: rendition_status_from_str(&status)?,
        })
    }
}

#[async_trait]
impl RenditionRepo for SqlxRenditionRepo {
    async fn get(&self, id: Uuid) -> Result<Rendition, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, media_file_id, profile, container, codec, bitrate, output_path, \
                 produced_by, produced_at, status FROM renditions WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT id, media_file_id, profile, container, codec, bitrate, output_path, \
                 produced_by, produced_at, status FROM renditions WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        Self::from_row(&row)
    }

    async fn list_for_media_file(&self, media_file_id: Uuid) -> Result<Vec<Rendition>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, media_file_id, profile, container, codec, bitrate, output_path, \
                 produced_by, produced_at, status FROM renditions \
                 WHERE media_file_id = ? ORDER BY produced_at DESC"
            }
            Backend::Postgres => {
                "SELECT id, media_file_id, profile, container, codec, bitrate, output_path, \
                 produced_by, produced_at, status FROM renditions \
                 WHERE media_file_id = $1 ORDER BY produced_at DESC"
            }
        };
        let rows = sqlx::query(sql)
            .bind(media_file_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn find_ready(
        &self,
        media_file_id: Uuid,
        profile: &str,
    ) -> Result<Option<Rendition>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, media_file_id, profile, container, codec, bitrate, output_path, \
                 produced_by, produced_at, status FROM renditions \
                 WHERE media_file_id = ? AND profile = ? AND status = 'ready' \
                 ORDER BY produced_at DESC LIMIT 1"
            }
            Backend::Postgres => {
                "SELECT id, media_file_id, profile, container, codec, bitrate, output_path, \
                 produced_by, produced_at, status FROM renditions \
                 WHERE media_file_id = $1 AND profile = $2 AND status = 'ready' \
                 ORDER BY produced_at DESC LIMIT 1"
            }
        };
        let row = sqlx::query(sql)
            .bind(media_file_id.to_string())
            .bind(profile)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn upsert(&self, rendition: &Rendition) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO renditions \
                 (id, media_file_id, profile, container, codec, bitrate, output_path, produced_by, produced_at, status) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 media_file_id = excluded.media_file_id, profile = excluded.profile, \
                 container = excluded.container, codec = excluded.codec, bitrate = excluded.bitrate, \
                 output_path = excluded.output_path, produced_by = excluded.produced_by, \
                 produced_at = excluded.produced_at, status = excluded.status"
            }
            Backend::Postgres => {
                "INSERT INTO renditions \
                 (id, media_file_id, profile, container, codec, bitrate, output_path, produced_by, produced_at, status) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
                 ON CONFLICT (id) DO UPDATE SET \
                 media_file_id = excluded.media_file_id, profile = excluded.profile, \
                 container = excluded.container, codec = excluded.codec, bitrate = excluded.bitrate, \
                 output_path = excluded.output_path, produced_by = excluded.produced_by, \
                 produced_at = excluded.produced_at, status = excluded.status"
            }
        };
        sqlx::query(sql)
            .bind(rendition.id.to_string())
            .bind(rendition.media_file_id.to_string())
            .bind(rendition.profile.as_str())
            .bind(rendition.container.as_str())
            .bind(rendition.codec.as_str())
            .bind(rendition.bitrate.map(|b| b as i64))
            .bind(rendition.output_path.to_string_lossy().into_owned())
            .bind(produced_by_to_str(rendition.produced_by))
            .bind(format_datetime(rendition.produced_at))
            .bind(rendition_status_to_str(rendition.status))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM renditions WHERE id = ?",
            Backend::Postgres => "DELETE FROM renditions WHERE id = $1",
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

    async fn mark_status(&self, id: Uuid, status: RenditionStatus) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "UPDATE renditions SET status = ? WHERE id = ?",
            Backend::Postgres => "UPDATE renditions SET status = $1 WHERE id = $2",
        };
        let result = sqlx::query(sql)
            .bind(rendition_status_to_str(status))
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, SubsecRound, Utc};
    use playarr_model::ProducedBy;

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_rendition(media_file_id: Uuid, status: RenditionStatus) -> Rendition {
        Rendition {
            id: Uuid::new_v4(),
            media_file_id,
            profile: "h264-1080p-8mbps".to_string(),
            container: "mp4".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(8_000_000),
            output_path: PathBuf::from("/data/renditions/out.mp4"),
            produced_by: ProducedBy::Tdarr,
            // Storage round-trips through millisecond precision (see
            // `codec::format_datetime`); truncate here so the fixture
            // matches what `get()` hands back.
            produced_at: Utc::now().trunc_subsecs(3),
            status,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRenditionRepo::new(pool);
        let rendition = sample_rendition(Uuid::new_v4(), RenditionStatus::Queued);

        repo.upsert(&rendition).await.expect("upsert");
        let fetched = repo.get(rendition.id).await.expect("get");
        assert_eq!(fetched, rendition);
    }

    #[tokio::test]
    async fn upsert_updates_existing_row() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRenditionRepo::new(pool);
        let mut rendition = sample_rendition(Uuid::new_v4(), RenditionStatus::Queued);
        repo.upsert(&rendition).await.unwrap();

        rendition.status = RenditionStatus::Ready;
        rendition.bitrate = Some(4_000_000);
        repo.upsert(&rendition).await.unwrap();

        let fetched = repo.get(rendition.id).await.unwrap();
        assert_eq!(fetched.status, RenditionStatus::Ready);
        assert_eq!(fetched.bitrate, Some(4_000_000));
    }

    #[tokio::test]
    async fn list_for_media_file_orders_newest_first() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRenditionRepo::new(pool);
        let media_file_id = Uuid::new_v4();

        let mut older = sample_rendition(media_file_id, RenditionStatus::Ready);
        older.produced_at = Utc::now() - Duration::hours(1);
        let newer = sample_rendition(media_file_id, RenditionStatus::Ready);
        let other_file = sample_rendition(Uuid::new_v4(), RenditionStatus::Ready);

        for r in [&older, &newer, &other_file] {
            repo.upsert(r).await.unwrap();
        }

        let renditions = repo.list_for_media_file(media_file_id).await.unwrap();
        assert_eq!(renditions.len(), 2);
        assert_eq!(renditions[0].id, newer.id);
        assert_eq!(renditions[1].id, older.id);
    }

    #[tokio::test]
    async fn find_ready_only_matches_ready_status() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRenditionRepo::new(pool);
        let media_file_id = Uuid::new_v4();

        let queued = sample_rendition(media_file_id, RenditionStatus::Queued);
        repo.upsert(&queued).await.unwrap();
        let none_yet = repo
            .find_ready(media_file_id, &queued.profile)
            .await
            .unwrap();
        assert!(none_yet.is_none());

        let ready = sample_rendition(media_file_id, RenditionStatus::Ready);
        repo.upsert(&ready).await.unwrap();
        let found = repo
            .find_ready(media_file_id, &ready.profile)
            .await
            .unwrap();
        assert_eq!(found.map(|r| r.id), Some(ready.id));

        let wrong_profile = repo
            .find_ready(media_file_id, "does-not-exist")
            .await
            .unwrap();
        assert!(wrong_profile.is_none());
    }

    #[tokio::test]
    async fn mark_status_updates_and_errors_on_missing() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRenditionRepo::new(pool);
        let rendition = sample_rendition(Uuid::new_v4(), RenditionStatus::Processing);
        repo.upsert(&rendition).await.unwrap();

        repo.mark_status(rendition.id, RenditionStatus::Failed)
            .await
            .unwrap();
        let fetched = repo.get(rendition.id).await.unwrap();
        assert_eq!(fetched.status, RenditionStatus::Failed);

        let err = repo
            .mark_status(Uuid::new_v4(), RenditionStatus::Ready)
            .await
            .unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRenditionRepo::new(pool);
        let rendition = sample_rendition(Uuid::new_v4(), RenditionStatus::Ready);
        repo.upsert(&rendition).await.unwrap();

        repo.delete(rendition.id).await.unwrap();
        let err = repo.get(rendition.id).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn delete_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRenditionRepo::new(pool);
        let err = repo.delete(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }
}
