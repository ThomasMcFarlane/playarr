use std::collections::HashSet;
use std::path::PathBuf;

use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
// `LeafRef` isn't re-exported at the `playarr_model` crate root (unlike
// `MediaFile`) — imported via its module path rather than adding that
// export, since `playarr-model` is outside this crate's scope.
use playarr_model::media::LeafRef;
use playarr_model::MediaFile;
use uuid::Uuid;

use crate::codec::{leaf_ref_from_str, leaf_ref_to_str, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// CRUD + lookup surface over [`playarr_model::MediaFile`] -- the on-disk
/// files a source *arr instance has imported. This is the table that
/// resolves "which file plays this episode/track/book/movie"
/// ([`MediaFileRepo::find_by_leaf`]), and the write path `arr-sync` re-syncs
/// against repeatedly ([`MediaFileRepo::upsert_by_source`]).
///
/// Kept separate from [`crate::repo::WorkRepo`] the same way
/// [`crate::repo::RenditionRepo`] is: a `MediaFile` is a leaf-level file,
/// not part of the `Work` aggregate itself, and its query patterns
/// (per-leaf lookup, upsert-on-sync keyed by source id) don't share a
/// trait cleanly with the aggregate root's.
#[async_trait]
pub trait MediaFileRepo: Send + Sync {
    /// Inserts a brand new row. Fails (via the backend's own UNIQUE
    /// violation, surfaced as `DbError::Backend`) if `media_file.id`
    /// already exists -- callers that don't know whether a row exists yet
    /// want [`MediaFileRepo::upsert_by_source`] instead.
    async fn create(&self, media_file: &MediaFile) -> Result<(), DbError>;

    async fn get_by_id(&self, id: Uuid) -> Result<MediaFile, DbError>;

    /// All `MediaFile`s belonging to `work_id`, across all of its leaves
    /// (the work itself for a movie, or every episode/track/book file for a
    /// series/artist/author).
    async fn list_by_work_id(&self, work_id: Uuid) -> Result<Vec<MediaFile>, DbError>;

    /// Every physical file imported by every normal source instance.
    async fn list_all(&self) -> Result<Vec<MediaFile>, DbError>;

    /// Distinct work ids that currently own at least one synced media file.
    /// This is the efficient catalogue-level answer to "is anything under
    /// this work actually playable?" without issuing one query per work.
    async fn list_work_ids(&self) -> Result<HashSet<Uuid>, DbError>;

    /// Number of media files per work (works without files are absent).
    /// One grouped query, for per-user progress maths on Home rails.
    async fn count_by_work(&self) -> Result<std::collections::HashMap<Uuid, u32>, DbError>;

    /// Every distinct `(work_id, source_instance_id)` pair across all media
    /// files, in one query. Lets catalogue browse apply source-instance and
    /// library-allow filters without one `list_by_work_id` round trip per
    /// candidate work.
    async fn list_work_source_instances(&self) -> Result<Vec<(Uuid, Uuid)>, DbError>;

    /// Finds the `MediaFile` for one specific leaf of `work_id` -- the core
    /// lookup that resolves "which file plays this episode/track/book/
    /// movie" for the playback path.
    async fn find_by_leaf(
        &self,
        work_id: Uuid,
        leaf_ref: LeafRef,
    ) -> Result<Option<MediaFile>, DbError>;

    /// Persists a fixed source-container runtime after a lazy metadata
    /// probe. Subsequent catalogue/detail reads reuse this value.
    async fn set_duration_ms(&self, id: Uuid, duration_ms: u64) -> Result<(), DbError>;

    /// Marks legacy files that a successful source refresh could not
    /// resolve as scanned (`0`). They remain eligible for a one-file lazy
    /// ffprobe, without making every scheduled reconciliation retry them.
    async fn mark_missing_durations_scanned(&self, work_id: Uuid) -> Result<(), DbError>;

    /// Insert-or-update keyed by `(source_instance_id, source_file_id)`
    /// rather than `MediaFile::id`: `arr-sync` calls this on every re-sync
    /// poll/webhook, and at that point it only knows the source app's own
    /// file id, not whatever row id (if any) this file was previously
    /// persisted under. Returns the authoritative persisted row -- on an
    /// update that's the pre-existing row (with its original `id`), not
    /// `media_file` as passed in.
    async fn upsert_by_source(&self, media_file: &MediaFile) -> Result<MediaFile, DbError>;
}

pub struct SqlxMediaFileRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxMediaFileRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<MediaFile, DbError> {
        let id: String = row.try_get("id")?;
        let work_id: String = row.try_get("work_id")?;
        let leaf_ref: String = row.try_get("leaf_ref")?;
        let path: String = row.try_get("path")?;
        let container: String = row.try_get("container")?;
        let codec: String = row.try_get("codec")?;
        let bitrate: Option<i64> = row.try_get("bitrate")?;
        let duration_ms: Option<i64> = row.try_get("duration_ms")?;
        let size_bytes: i64 = row.try_get("size_bytes")?;
        let source_instance_id: String = row.try_get("source_instance_id")?;
        let source_file_id: Option<String> = row.try_get("source_file_id")?;

        Ok(MediaFile {
            id: parse_uuid(&id)?,
            work_id: parse_uuid(&work_id)?,
            leaf_ref: leaf_ref_from_str(&leaf_ref)?,
            path: PathBuf::from(path),
            container,
            codec,
            // Bitrate/size are always written from non-negative `u64`s (see
            // `create`/`upsert_by_source` below), so casting back is
            // lossless for any value this repository itself ever stored.
            bitrate: bitrate.map(|b| b as u64),
            duration_ms: duration_ms.map(|duration| duration.max(0) as u64),
            size_bytes: size_bytes as u64,
            source_instance_id: parse_uuid(&source_instance_id)?,
            source_file_id,
        })
    }

    /// Looks up the row currently occupying the `upsert_by_source` conflict
    /// target. Split out so `upsert_by_source` can re-fetch the
    /// authoritative (possibly pre-existing) row after writing, without
    /// duplicating the query.
    async fn find_by_source_key(
        &self,
        source_instance_id: Uuid,
        source_file_id: &str,
    ) -> Result<Option<MediaFile>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE source_instance_id = ? AND source_file_id = ?"
            }
            Backend::Postgres => {
                "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE source_instance_id = $1 AND source_file_id = $2"
            }
        };
        let row = sqlx::query(sql)
            .bind(source_instance_id.to_string())
            .bind(source_file_id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }
}

#[async_trait]
impl MediaFileRepo for SqlxMediaFileRepo {
    async fn create(&self, media_file: &MediaFile) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO media_files \
                 (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO media_files \
                 (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
            }
        };
        sqlx::query(sql)
            .bind(media_file.id.to_string())
            .bind(media_file.work_id.to_string())
            .bind(leaf_ref_to_str(&media_file.leaf_ref))
            .bind(media_file.path.to_string_lossy().into_owned())
            .bind(media_file.container.as_str())
            .bind(media_file.codec.as_str())
            .bind(media_file.bitrate.map(|b| b as i64))
            .bind(media_file.duration_ms.map(|duration| duration as i64))
            .bind(media_file.size_bytes as i64)
            .bind(media_file.source_instance_id.to_string())
            .bind(media_file.source_file_id.as_deref())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_by_id(&self, id: Uuid) -> Result<MediaFile, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        Self::from_row(&row)
    }

    async fn list_by_work_id(&self, work_id: Uuid) -> Result<Vec<MediaFile>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE work_id = ? ORDER BY leaf_ref, path"
            }
            Backend::Postgres => {
                "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE work_id = $1 ORDER BY leaf_ref, path"
            }
        };
        let rows = sqlx::query(sql)
            .bind(work_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn list_all(&self) -> Result<Vec<MediaFile>, DbError> {
        let rows = sqlx::query(
            "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
             source_instance_id, source_file_id FROM media_files \
             ORDER BY source_instance_id, path",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn count_by_work(&self) -> Result<std::collections::HashMap<Uuid, u32>, DbError> {
        let rows = sqlx::query("SELECT work_id, COUNT(*) AS n FROM media_files GROUP BY work_id")
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|row| {
                let raw: String = row.try_get("work_id")?;
                let n: i64 = row.try_get("n")?;
                Ok((parse_uuid(&raw)?, n.max(0) as u32))
            })
            .collect()
    }

    async fn list_work_ids(&self) -> Result<HashSet<Uuid>, DbError> {
        let rows = sqlx::query("SELECT DISTINCT work_id FROM media_files")
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|row| {
                let raw: String = row.try_get("work_id")?;
                parse_uuid(&raw)
            })
            .collect()
    }

    async fn list_work_source_instances(&self) -> Result<Vec<(Uuid, Uuid)>, DbError> {
        let rows = sqlx::query("SELECT DISTINCT work_id, source_instance_id FROM media_files")
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|row| {
                let work: String = row.try_get("work_id")?;
                let source: String = row.try_get("source_instance_id")?;
                Ok((parse_uuid(&work)?, parse_uuid(&source)?))
            })
            .collect()
    }

    async fn find_by_leaf(
        &self,
        work_id: Uuid,
        leaf_ref: LeafRef,
    ) -> Result<Option<MediaFile>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE work_id = ? AND leaf_ref = ? ORDER BY id LIMIT 1"
            }
            Backend::Postgres => {
                "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE work_id = $1 AND leaf_ref = $2 ORDER BY id LIMIT 1"
            }
        };
        let row = sqlx::query(sql)
            .bind(work_id.to_string())
            .bind(leaf_ref_to_str(&leaf_ref))
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn set_duration_ms(&self, id: Uuid, duration_ms: u64) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "UPDATE media_files SET duration_ms = ? WHERE id = ?",
            Backend::Postgres => "UPDATE media_files SET duration_ms = $1 WHERE id = $2",
        };
        let result = sqlx::query(sql)
            .bind(duration_ms as i64)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    async fn mark_missing_durations_scanned(&self, work_id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE media_files SET duration_ms = 0 WHERE work_id = ? AND duration_ms IS NULL"
            }
            Backend::Postgres => {
                "UPDATE media_files SET duration_ms = 0 WHERE work_id = $1 AND duration_ms IS NULL"
            }
        };
        sqlx::query(sql)
            .bind(work_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn upsert_by_source(&self, media_file: &MediaFile) -> Result<MediaFile, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO media_files \
                 (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (source_instance_id, source_file_id) DO UPDATE SET \
                 work_id = excluded.work_id, leaf_ref = excluded.leaf_ref, path = excluded.path, \
                 container = excluded.container, codec = excluded.codec, bitrate = excluded.bitrate, \
                 duration_ms = CASE \
                   WHEN excluded.duration_ms IS NULL OR excluded.duration_ms <= 0 \
                   THEN COALESCE(media_files.duration_ms, excluded.duration_ms) \
                   ELSE excluded.duration_ms \
                 END, size_bytes = excluded.size_bytes"
            }
            Backend::Postgres => {
                "INSERT INTO media_files \
                 (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (source_instance_id, source_file_id) DO UPDATE SET \
                 work_id = excluded.work_id, leaf_ref = excluded.leaf_ref, path = excluded.path, \
                 container = excluded.container, codec = excluded.codec, bitrate = excluded.bitrate, \
                 duration_ms = CASE \
                   WHEN excluded.duration_ms IS NULL OR excluded.duration_ms <= 0 \
                   THEN COALESCE(media_files.duration_ms, excluded.duration_ms) \
                   ELSE excluded.duration_ms \
                 END, size_bytes = excluded.size_bytes"
            }
        };
        sqlx::query(sql)
            .bind(media_file.id.to_string())
            .bind(media_file.work_id.to_string())
            .bind(leaf_ref_to_str(&media_file.leaf_ref))
            .bind(media_file.path.to_string_lossy().into_owned())
            .bind(media_file.container.as_str())
            .bind(media_file.codec.as_str())
            .bind(media_file.bitrate.map(|b| b as i64))
            .bind(media_file.duration_ms.map(|duration| duration as i64))
            .bind(media_file.size_bytes as i64)
            .bind(media_file.source_instance_id.to_string())
            .bind(media_file.source_file_id.as_deref())
            .execute(&self.pool)
            .await?;

        // `id` is deliberately absent from `DO UPDATE SET` above: on a
        // conflict-update, the pre-existing row's id is the authoritative
        // one, not whatever fresh id the caller happened to generate this
        // time around (the caller doesn't know the persisted id up front --
        // that's the whole reason this method keys off
        // `source_instance_id`/`source_file_id` rather than `id`, unlike
        // `WorkRepo::upsert`). Re-fetch to hand back whichever row is now
        // authoritative.
        match media_file.source_file_id.as_deref() {
            Some(source_file_id) => self
                .find_by_source_key(media_file.source_instance_id, source_file_id)
                .await?
                .ok_or(DbError::NotFound),
            // No `source_file_id`: the unique index never matches an
            // existing row for it (standard SQL treats NULL as distinct
            // from every other value, including another NULL), so this call
            // always just inserted a fresh row under `media_file.id`.
            None => self.get_by_id(media_file.id).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;

    /// `media_files.work_id` has a `REFERENCES works (id)` foreign key
    /// (see `0005_media_files.sql`), and sqlx-sqlite enables
    /// `PRAGMA foreign_keys = ON` by default -- so every test needs a real
    /// parent row in `works` before it can insert a `media_files` row
    /// pointing at it. Bypasses `WorkRepo` (out of scope for this module)
    /// with a minimal direct insert.
    async fn insert_work(pool: &DbPool, work_id: Uuid) {
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, availability) \
             VALUES (?, 'movie', 'Test Work', 'Test Work', '2024-01-01T00:00:00.000Z', 'available')",
        )
        .bind(work_id.to_string())
        .execute(pool)
        .await
        .expect("insert parent work row");
    }

    fn sample_media_file(
        work_id: Uuid,
        leaf_ref: LeafRef,
        source_instance_id: Uuid,
        source_file_id: Option<&str>,
    ) -> MediaFile {
        MediaFile {
            id: Uuid::new_v4(),
            work_id,
            leaf_ref,
            path: PathBuf::from("/data/media/movie.mkv"),
            container: "mkv".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(8_000_000),
            duration_ms: Some(7_200_000),
            // Deliberately bigger than `u32::MAX` to exercise the full
            // `u64` round trip through the `i64` storage column.
            size_bytes: 4_294_967_296,
            source_instance_id,
            source_file_id: source_file_id.map(|s| s.to_string()),
        }
    }

    #[tokio::test]
    async fn create_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool);
        let media_file = sample_media_file(work_id, LeafRef::Work, Uuid::new_v4(), Some("17"));

        repo.create(&media_file).await.expect("create");
        let fetched = repo.get_by_id(media_file.id).await.expect("get_by_id");
        assert_eq!(fetched, media_file);
    }

    #[tokio::test]
    async fn create_duplicate_id_fails() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool);
        let media_file = sample_media_file(work_id, LeafRef::Work, Uuid::new_v4(), Some("1"));
        repo.create(&media_file).await.unwrap();

        let err = repo.create(&media_file).await.unwrap_err();
        assert!(matches!(err, DbError::Backend(_)));
    }

    #[tokio::test]
    async fn get_by_id_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxMediaFileRepo::new(pool);
        let err = repo.get_by_id(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn list_by_work_id_returns_every_leaf_for_the_work() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        let other_work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        insert_work(&pool, other_work_id).await;
        let repo = SqlxMediaFileRepo::new(pool);

        let episode_id = Uuid::new_v4();
        let movie_file = sample_media_file(work_id, LeafRef::Work, Uuid::new_v4(), Some("m1"));
        let episode_file = sample_media_file(
            work_id,
            LeafRef::Episode(episode_id),
            Uuid::new_v4(),
            Some("e1"),
        );
        let other_work_file =
            sample_media_file(other_work_id, LeafRef::Work, Uuid::new_v4(), Some("o1"));

        for f in [&movie_file, &episode_file, &other_work_file] {
            repo.create(f).await.unwrap();
        }

        let files = repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(files.len(), 2);
        let ids: Vec<Uuid> = files.iter().map(|f| f.id).collect();
        assert!(ids.contains(&movie_file.id));
        assert!(ids.contains(&episode_file.id));
        assert!(!ids.contains(&other_work_file.id));

        let playable_work_ids = repo.list_work_ids().await.unwrap();
        assert_eq!(playable_work_ids.len(), 2);
        assert!(playable_work_ids.contains(&work_id));
        assert!(playable_work_ids.contains(&other_work_id));

        // Both files of `work_id` come from the same source instance (the
        // helper's `Uuid` arg), so the pair set is deduplicated per work.
        let pairs = repo.list_work_source_instances().await.unwrap();
        assert!(pairs.iter().any(|(w, _)| *w == work_id));
        assert!(pairs.iter().any(|(w, _)| *w == other_work_id));
        let mut expected: Vec<(Uuid, Uuid)> = [&movie_file, &episode_file, &other_work_file]
            .iter()
            .map(|f| (f.work_id, f.source_instance_id))
            .collect();
        expected.sort();
        expected.dedup();
        let mut got = pairs;
        got.sort();
        assert_eq!(got, expected);
    }

    #[tokio::test]
    async fn find_by_leaf_matches_and_misses() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool);

        let episode_id = Uuid::new_v4();
        let episode_file = sample_media_file(
            work_id,
            LeafRef::Episode(episode_id),
            Uuid::new_v4(),
            Some("e1"),
        );
        repo.create(&episode_file).await.unwrap();

        let found = repo
            .find_by_leaf(work_id, LeafRef::Episode(episode_id))
            .await
            .unwrap();
        assert_eq!(found.map(|f| f.id), Some(episode_file.id));

        let wrong_leaf = repo
            .find_by_leaf(work_id, LeafRef::Episode(Uuid::new_v4()))
            .await
            .unwrap();
        assert!(wrong_leaf.is_none());

        let wrong_kind = repo.find_by_leaf(work_id, LeafRef::Work).await.unwrap();
        assert!(wrong_kind.is_none());
    }

    #[tokio::test]
    async fn set_duration_ms_persists_lazy_probe_result() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool);
        let mut media_file =
            sample_media_file(work_id, LeafRef::Work, Uuid::new_v4(), Some("duration"));
        media_file.duration_ms = None;
        repo.create(&media_file).await.unwrap();

        repo.set_duration_ms(media_file.id, 5_432_100)
            .await
            .unwrap();

        let fetched = repo.get_by_id(media_file.id).await.unwrap();
        assert_eq!(fetched.duration_ms, Some(5_432_100));
    }

    #[tokio::test]
    async fn mark_missing_durations_scanned_uses_zero_without_overwriting_runtime() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool);

        let mut unknown =
            sample_media_file(work_id, LeafRef::Work, Uuid::new_v4(), Some("unknown"));
        unknown.duration_ms = None;
        repo.create(&unknown).await.unwrap();
        let known = sample_media_file(
            work_id,
            LeafRef::Episode(Uuid::new_v4()),
            Uuid::new_v4(),
            Some("known"),
        );
        repo.create(&known).await.unwrap();

        repo.mark_missing_durations_scanned(work_id).await.unwrap();

        assert_eq!(
            repo.get_by_id(unknown.id).await.unwrap().duration_ms,
            Some(0)
        );
        assert_eq!(
            repo.get_by_id(known.id).await.unwrap().duration_ms,
            known.duration_ms
        );
    }

    #[tokio::test]
    async fn upsert_by_source_inserts_when_new() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool);
        let media_file =
            sample_media_file(work_id, LeafRef::Work, Uuid::new_v4(), Some("source-1"));

        let persisted = repo.upsert_by_source(&media_file).await.unwrap();
        assert_eq!(persisted, media_file);

        let fetched = repo.get_by_id(media_file.id).await.unwrap();
        assert_eq!(fetched, media_file);
    }

    #[tokio::test]
    async fn upsert_by_source_updates_existing_row_on_conflict() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool);
        let source_instance_id = Uuid::new_v4();

        let original = sample_media_file(
            work_id,
            LeafRef::Work,
            source_instance_id,
            Some("same-source-file"),
        );
        let first = repo.upsert_by_source(&original).await.unwrap();
        assert_eq!(first.id, original.id);

        // Re-sync: same (source_instance_id, source_file_id) but a freshly
        // generated `id` and changed fields, exactly like `arr-sync` would
        // build from a fresh poll of the source *arr instance.
        let mut resynced = sample_media_file(
            work_id,
            LeafRef::Work,
            source_instance_id,
            Some("same-source-file"),
        );
        resynced.bitrate = Some(4_000_000);
        resynced.duration_ms = Some(0);
        resynced.size_bytes = 123;
        resynced.codec = "hevc".to_string();
        assert_ne!(resynced.id, original.id);

        let updated = repo.upsert_by_source(&resynced).await.unwrap();

        // The persisted id stays the original row's id, not the fresh one
        // generated for this resync.
        assert_eq!(updated.id, original.id);
        assert_eq!(updated.bitrate, Some(4_000_000));
        assert_eq!(updated.size_bytes, 123);
        assert_eq!(updated.codec, "hevc");
        assert_eq!(updated.duration_ms, original.duration_ms);

        // Only one row exists for this work -- the second call updated it
        // in place rather than inserting a second row.
        let files = repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].id, original.id);

        // The freshly generated id from the resync call was never
        // persisted as its own row.
        let err = repo.get_by_id(resynced.id).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn upsert_by_source_without_source_file_id_always_inserts() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool);
        let source_instance_id = Uuid::new_v4();

        let first = sample_media_file(work_id, LeafRef::Work, source_instance_id, None);
        let second = sample_media_file(work_id, LeafRef::Work, source_instance_id, None);

        repo.upsert_by_source(&first).await.unwrap();
        repo.upsert_by_source(&second).await.unwrap();

        let files = repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(files.len(), 2);
        let ids: Vec<Uuid> = files.iter().map(|f| f.id).collect();
        assert!(ids.contains(&first.id));
        assert!(ids.contains(&second.id));
    }
}
