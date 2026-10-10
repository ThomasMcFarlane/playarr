use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

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
use crate::pool::DbPool;
use crate::write_queue::{write, WriteQueue};

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

    /// [`Self::list_by_work_id`] for many works at once, ordered by file id
    /// (so "the file of a leaf" is the lowest id, as `find_by_leaf` picks).
    /// The default asks one work at a time; the SQL repo answers in a few
    /// queries.
    async fn list_by_work_ids(&self, work_ids: &[Uuid]) -> Result<Vec<MediaFile>, DbError> {
        let mut out = Vec::new();
        for id in work_ids {
            out.extend(self.list_by_work_id(*id).await?);
        }
        out.sort_by_key(|f| f.id);
        Ok(out)
    }

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

    /// Reconciles `work_id`'s rows from `source_instance_id` with the source's
    /// current file listing (`keep_source_file_ids`, the full listing, never
    /// empty). A listed row that was marked missing is restored. A row the
    /// source no longer lists is deleted ONLY when exactly one surviving row
    /// exists for the same leaf (same instance first, then any) and it is the
    /// only stale row for that leaf; viewers' resume positions and playback
    /// choices move to the survivor first. Every other unlisted row is marked
    /// missing (hidden from playable views, kept with its progress). A pass
    /// that would touch over half of the instance's rows for the work, or over
    /// 200, changes nothing and reports `skipped`.
    async fn prune_superseded_files(
        &self,
        work_id: Uuid,
        source_instance_id: Uuid,
        keep_source_file_ids: &[String],
    ) -> Result<PruneOutcome, DbError>;

    /// Insert-or-update keyed by `(source_instance_id, source_file_id)`
    /// rather than `MediaFile::id`: `arr-sync` calls this on every re-sync
    /// poll/webhook, and at that point it only knows the source app's own
    /// file id, not whatever row id (if any) this file was previously
    /// persisted under. Returns the authoritative persisted row -- on an
    /// update that's the pre-existing row (with its original `id`), not
    /// `media_file` as passed in.
    async fn upsert_by_source(&self, media_file: &MediaFile) -> Result<MediaFile, DbError>;

    /// The file currently held under a source's own file id, if any. The
    /// default scans every file; the SQL repo answers from the unique index.
    async fn find_by_source(
        &self,
        source_instance_id: Uuid,
        source_file_id: &str,
    ) -> Result<Option<MediaFile>, DbError> {
        Ok(self.list_all().await?.into_iter().find(|f| {
            f.source_instance_id == source_instance_id
                && f.source_file_id.as_deref() == Some(source_file_id)
        }))
    }
}

/// What [`MediaFileRepo::prune_superseded_files`] did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PruneOutcome {
    /// Rows deleted after their progress moved to the replacement.
    pub deleted: usize,
    /// Rows hidden because the source dropped them with no safe replacement.
    pub marked_missing: usize,
    /// Rows restored because the source lists them again.
    pub restored: usize,
    /// Users whose resume position or playback choices moved to another file.
    pub moved_users: Vec<Uuid>,
    /// The per-pass guard refused the whole prune.
    pub skipped: bool,
}

/// Most rows one prune may touch for a work in one pass.
const MAX_PRUNE_ROWS: usize = 200;

/// Owned bind values for a `media_files` insert, so a queued write can run
/// again if its batch has to be retried.
struct MediaFileBinds {
    id: String,
    work_id: String,
    leaf_ref: String,
    path: String,
    container: String,
    codec: String,
    bitrate: Option<i64>,
    duration_ms: Option<i64>,
    size_bytes: i64,
    source_instance_id: String,
    source_file_id: Option<String>,
}

impl MediaFileBinds {
    fn new(media_file: &MediaFile) -> Self {
        Self {
            id: media_file.id.to_string(),
            work_id: media_file.work_id.to_string(),
            leaf_ref: leaf_ref_to_str(&media_file.leaf_ref),
            path: media_file.path.to_string_lossy().into_owned(),
            container: media_file.container.clone(),
            codec: media_file.codec.clone(),
            bitrate: media_file.bitrate.map(|b| b as i64),
            duration_ms: media_file.duration_ms.map(|duration| duration as i64),
            size_bytes: media_file.size_bytes as i64,
            source_instance_id: media_file.source_instance_id.to_string(),
            source_file_id: media_file.source_file_id.clone(),
        }
    }

    fn bind<'q>(
        &self,
        query: sqlx::query::Query<'q, sqlx::Any, sqlx::any::AnyArguments<'q>>,
    ) -> sqlx::query::Query<'q, sqlx::Any, sqlx::any::AnyArguments<'q>> {
        query
            .bind(self.id.clone())
            .bind(self.work_id.clone())
            .bind(self.leaf_ref.clone())
            .bind(self.path.clone())
            .bind(self.container.clone())
            .bind(self.codec.clone())
            .bind(self.bitrate)
            .bind(self.duration_ms)
            .bind(self.size_bytes)
            .bind(self.source_instance_id.clone())
            .bind(self.source_file_id.clone())
    }
}

pub struct SqlxMediaFileRepo {
    pool: DbPool,
    queue: Option<WriteQueue>,
}

impl SqlxMediaFileRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool, queue: None }
    }

    /// Sends the repository's writes through the shared write queue so they
    /// share a commit with other small writes. Each call still returns only
    /// after its own write has committed.
    pub fn with_write_queue(mut self, queue: WriteQueue) -> Self {
        self.queue = Some(queue);
        self
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
        let sql = "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE source_instance_id = ? AND source_file_id = ?";
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
        let row = Arc::new(MediaFileBinds::new(media_file));
        write(self.queue.as_ref(), &self.pool, move |conn| {
            let row = row.clone();
            Box::pin(async move {
                let sql = "INSERT INTO media_files \
                     (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
                row.bind(sqlx::query(sql)).execute(&mut *conn).await?;
                Ok(())
            })
        })
        .await
    }

    async fn get_by_id(&self, id: Uuid) -> Result<MediaFile, DbError> {
        let sql = "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files WHERE id = ?";
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        Self::from_row(&row)
    }

    async fn list_by_work_id(&self, work_id: Uuid) -> Result<Vec<MediaFile>, DbError> {
        let sql = "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE work_id = ? AND missing_since IS NULL ORDER BY leaf_ref, path";
        let rows = sqlx::query(sql)
            .bind(work_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn list_by_work_ids(&self, work_ids: &[Uuid]) -> Result<Vec<MediaFile>, DbError> {
        let mut out = Vec::new();
        for chunk in work_ids.chunks(400) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE work_id IN ({placeholders}) AND missing_since IS NULL ORDER BY id"
            );
            let mut query = sqlx::query(&sql);
            for id in chunk {
                query = query.bind(id.to_string());
            }
            for row in query.fetch_all(&self.pool).await? {
                out.push(Self::from_row(&row)?);
            }
        }
        out.sort_by_key(|f| f.id);
        Ok(out)
    }

    async fn list_all(&self) -> Result<Vec<MediaFile>, DbError> {
        let rows = sqlx::query(
            "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
             source_instance_id, source_file_id FROM media_files \
             WHERE missing_since IS NULL ORDER BY source_instance_id, path",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn count_by_work(&self) -> Result<std::collections::HashMap<Uuid, u32>, DbError> {
        let rows = sqlx::query("SELECT work_id, COUNT(*) AS n FROM media_files WHERE missing_since IS NULL GROUP BY work_id")
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
        let rows =
            sqlx::query("SELECT DISTINCT work_id FROM media_files WHERE missing_since IS NULL")
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
        let rows = sqlx::query("SELECT DISTINCT work_id, source_instance_id FROM media_files WHERE missing_since IS NULL")
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
        let sql = "SELECT id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                 source_instance_id, source_file_id FROM media_files \
                 WHERE work_id = ? AND leaf_ref = ? AND missing_since IS NULL ORDER BY id LIMIT 1";
        let row = sqlx::query(sql)
            .bind(work_id.to_string())
            .bind(leaf_ref_to_str(&leaf_ref))
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn set_duration_ms(&self, id: Uuid, duration_ms: u64) -> Result<(), DbError> {
        let id = id.to_string();
        let affected = write(self.queue.as_ref(), &self.pool, move |conn| {
            let id = id.clone();
            Box::pin(async move {
                let result = sqlx::query("UPDATE media_files SET duration_ms = ? WHERE id = ?")
                    .bind(duration_ms as i64)
                    .bind(id)
                    .execute(&mut *conn)
                    .await?;
                Ok(result.rows_affected())
            })
        })
        .await?;
        if affected == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    async fn mark_missing_durations_scanned(&self, work_id: Uuid) -> Result<(), DbError> {
        let work_id = work_id.to_string();
        write(self.queue.as_ref(), &self.pool, move |conn| {
            let work_id = work_id.clone();
            Box::pin(async move {
                sqlx::query(
                    "UPDATE media_files SET duration_ms = 0 WHERE work_id = ? AND duration_ms IS NULL",
                )
                .bind(work_id)
                .execute(&mut *conn)
                .await?;
                Ok(())
            })
        })
        .await
    }

    async fn prune_superseded_files(
        &self,
        work_id: Uuid,
        source_instance_id: Uuid,
        keep_source_file_ids: &[String],
    ) -> Result<PruneOutcome, DbError> {
        if keep_source_file_ids.is_empty() {
            return Ok(PruneOutcome::default());
        }
        struct Row {
            id: String,
            leaf_ref: String,
            mine: bool,
            listed: bool,
            missing: bool,
        }
        let keep: HashSet<&str> = keep_source_file_ids.iter().map(String::as_str).collect();
        let me = source_instance_id.to_string();
        // Nothing to do (the common case) costs one read, no write.
        let rows: Vec<Row> = sqlx::query(
            "SELECT id, leaf_ref, source_instance_id, source_file_id, missing_since \
             FROM media_files WHERE work_id = ?",
        )
        .bind(work_id.to_string())
        .fetch_all(&self.pool)
        .await?
        .iter()
        .map(|row| {
            let instance: String = row.try_get("source_instance_id")?;
            let source_file_id: Option<String> = row.try_get("source_file_id")?;
            let missing_since: Option<String> = row.try_get("missing_since")?;
            Ok(Row {
                id: row.try_get("id")?,
                leaf_ref: row.try_get("leaf_ref")?,
                mine: instance == me && source_file_id.is_some(),
                listed: source_file_id.as_deref().is_some_and(|f| keep.contains(f)),
                missing: missing_since.is_some(),
            })
        })
        .collect::<Result<_, sqlx::Error>>()?;

        let live_mine = rows.iter().filter(|r| r.mine && !r.missing).count();
        let stale: Vec<&Row> = rows
            .iter()
            .filter(|r| r.mine && !r.missing && !r.listed)
            .collect();
        let restore: Vec<String> = rows
            .iter()
            .filter(|r| r.mine && r.missing && r.listed)
            .map(|r| r.id.clone())
            .collect();
        if stale.len() > MAX_PRUNE_ROWS || stale.len() * 2 > live_mine {
            if !stale.is_empty() {
                tracing::warn!(
                    %work_id, stale = stale.len(), rows = live_mine,
                    "not pruning source files: too many rows would change in one pass"
                );
            }
            return Ok(PruneOutcome {
                skipped: !stale.is_empty(),
                ..PruneOutcome::default()
            });
        }
        if stale.is_empty() && restore.is_empty() {
            return Ok(PruneOutcome::default());
        }

        // (stale id, survivor to move progress to and delete into, or None to mark missing)
        let mut plan: Vec<(String, Option<String>)> = Vec::new();
        for s in &stale {
            let same_leaf = |r: &&Row| r.leaf_ref == s.leaf_ref && !r.missing && r.listed;
            let same_instance: Vec<&Row> =
                rows.iter().filter(|r| r.mine).filter(same_leaf).collect();
            let candidates: Vec<&Row> = if same_instance.is_empty() {
                rows.iter().filter(|r| !r.mine).filter(same_leaf).collect()
            } else {
                same_instance
            };
            let stale_in_leaf = stale.iter().filter(|o| o.leaf_ref == s.leaf_ref).count();
            let survivor =
                (candidates.len() == 1 && stale_in_leaf == 1).then(|| candidates[0].id.clone());
            plan.push((s.id.clone(), survivor));
        }
        let outcome_deleted = plan.iter().filter(|(_, s)| s.is_some()).count();
        let outcome_missing = plan.len() - outcome_deleted;
        let restored = restore.len();
        let plan = Arc::new(plan);
        let restore = Arc::new(restore);
        let now = chrono::Utc::now().to_rfc3339();
        let moved: Vec<String> = write(self.queue.as_ref(), &self.pool, move |conn| {
            let plan = plan.clone();
            let restore = restore.clone();
            let now = now.clone();
            Box::pin(async move {
                let mut moved: Vec<String> = Vec::new();
                for id in restore.iter() {
                    sqlx::query("UPDATE media_files SET missing_since = NULL WHERE id = ?")
                        .bind(id.clone())
                        .execute(&mut *conn)
                        .await?;
                }
                for (stale_id, survivor) in plan.iter() {
                    let Some(survivor) = survivor else {
                        sqlx::query("UPDATE media_files SET missing_since = ? WHERE id = ?")
                            .bind(now.clone())
                            .bind(stale_id.clone())
                            .execute(&mut *conn)
                            .await?;
                        continue;
                    };
                    for table in ["watch_progress", "user_media_playback_preferences"] {
                        let users = sqlx::query(&format!(
                            "SELECT user_id FROM {table} WHERE media_file_id = ?"
                        ))
                        .bind(stale_id.clone())
                        .fetch_all(&mut *conn)
                        .await?;
                        for u in users {
                            moved.push(u.try_get("user_id")?);
                        }
                        // Keep a viewer's place and choices; a user who already
                        // has their own on the survivor keeps that one.
                        sqlx::query(&format!(
                            "UPDATE {table} SET media_file_id = ? WHERE media_file_id = ? \
                             AND NOT EXISTS (SELECT 1 FROM {table} other \
                               WHERE other.user_id = {table}.user_id AND other.media_file_id = ?)"
                        ))
                        .bind(survivor.clone())
                        .bind(stale_id.clone())
                        .bind(survivor.clone())
                        .execute(&mut *conn)
                        .await?;
                    }
                    for sql in [
                        "DELETE FROM media_file_languages WHERE media_file_id = ?",
                        "DELETE FROM media_file_language_state WHERE media_file_id = ?",
                        "DELETE FROM media_files WHERE id = ?",
                    ] {
                        sqlx::query(sql)
                            .bind(stale_id.clone())
                            .execute(&mut *conn)
                            .await?;
                    }
                }
                Ok(moved)
            })
        })
        .await?;
        let mut moved_users: Vec<Uuid> = moved
            .iter()
            .filter_map(|u| Uuid::parse_str(u).ok())
            .collect();
        moved_users.sort();
        moved_users.dedup();
        Ok(PruneOutcome {
            deleted: outcome_deleted,
            marked_missing: outcome_missing,
            restored,
            moved_users,
            skipped: false,
        })
    }

    async fn find_by_source(
        &self,
        source_instance_id: Uuid,
        source_file_id: &str,
    ) -> Result<Option<MediaFile>, DbError> {
        self.find_by_source_key(source_instance_id, source_file_id)
            .await
    }

    async fn upsert_by_source(&self, media_file: &MediaFile) -> Result<MediaFile, DbError> {
        let sql = "INSERT INTO media_files \
                 (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (source_instance_id, source_file_id) DO UPDATE SET \
                 work_id = excluded.work_id, leaf_ref = excluded.leaf_ref, path = excluded.path, \
                 container = excluded.container, codec = excluded.codec, bitrate = excluded.bitrate, \
                 duration_ms = CASE \
                   WHEN excluded.duration_ms IS NULL OR excluded.duration_ms <= 0 \
                   THEN COALESCE(media_files.duration_ms, excluded.duration_ms) \
                   ELSE excluded.duration_ms \
                 END, size_bytes = excluded.size_bytes, \
                 missing_since = NULL";
        let row = Arc::new(MediaFileBinds::new(media_file));
        write(self.queue.as_ref(), &self.pool, move |conn| {
            let row = row.clone();
            Box::pin(async move {
                row.bind(sqlx::query(sql)).execute(&mut *conn).await?;
                Ok(())
            })
        })
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
    async fn list_by_work_ids_returns_the_files_of_every_asked_work_by_id() {
        let pool = test_sqlite_pool().await;
        let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        for work in [a, b, c] {
            insert_work(&pool, work).await;
        }
        let repo = SqlxMediaFileRepo::new(pool);
        let mut created = Vec::new();
        for (work, source) in [(a, "a1"), (a, "a2"), (b, "b1"), (c, "c1")] {
            let file = sample_media_file(
                work,
                LeafRef::Episode(Uuid::new_v4()),
                Uuid::new_v4(),
                Some(source),
            );
            repo.create(&file).await.unwrap();
            created.push(file);
        }
        let listed = repo.list_by_work_ids(&[a, b]).await.unwrap();
        let mut expected: Vec<Uuid> = created
            .iter()
            .filter(|f| f.work_id != c)
            .map(|f| f.id)
            .collect();
        expected.sort();
        assert_eq!(listed.iter().map(|f| f.id).collect::<Vec<_>>(), expected);
        assert!(repo.list_by_work_ids(&[]).await.unwrap().is_empty());
        // The same rows as one call per work.
        let mut singly = repo.list_by_work_id(a).await.unwrap();
        singly.extend(repo.list_by_work_id(b).await.unwrap());
        singly.sort_by_key(|f| f.id);
        assert_eq!(
            singly.iter().map(|f| f.id).collect::<Vec<_>>(),
            listed.iter().map(|f| f.id).collect::<Vec<_>>()
        );
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

    /// The queued repository behaves like the direct one: it inserts, updates
    /// in place keeping the original id, and still reports a missing row.
    #[tokio::test]
    async fn queued_writes_behave_like_direct_ones() {
        let pool = test_sqlite_pool().await;
        let queue = WriteQueue::spawn(pool.clone(), crate::WriteQueueConfig::default());
        let repo = SqlxMediaFileRepo::new(pool.clone()).with_write_queue(queue.clone());
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let source_instance = Uuid::new_v4();

        let first = sample_media_file(work_id, LeafRef::Work, source_instance, Some("file-1"));
        let stored = repo.upsert_by_source(&first).await.unwrap();
        assert_eq!(stored.id, first.id);

        let mut again = sample_media_file(work_id, LeafRef::Work, source_instance, Some("file-1"));
        again.size_bytes = 99;
        let updated = repo.upsert_by_source(&again).await.unwrap();
        assert_eq!(updated.id, first.id, "the original id is kept");
        assert_eq!(updated.size_bytes, 99);

        repo.set_duration_ms(first.id, 1_234).await.unwrap();
        assert_eq!(
            repo.get_by_id(first.id).await.unwrap().duration_ms,
            Some(1_234)
        );
        assert!(matches!(
            repo.set_duration_ms(Uuid::new_v4(), 1).await,
            Err(DbError::NotFound)
        ));
        queue.shutdown().await;
    }

    async fn seed_user(pool: &DbPool) -> String {
        let user = Uuid::new_v4().to_string();
        let policy = Uuid::new_v4().to_string();
        for sql in [
            format!("INSERT INTO policies (id, name) VALUES ('{policy}', 'p')"),
            format!(
                "INSERT INTO users (id, username, display_name, password_hash, policy_id, created_at, disabled) \
                 VALUES ('{user}', 'u', 'U', 'x', '{policy}', '2024-01-01T00:00:00.000Z', 0)"
            ),
        ] {
            sqlx::query(&sql).execute(pool).await.unwrap();
        }
        user
    }

    async fn seed_progress(pool: &DbPool, user: &str, file: Uuid) {
        sqlx::query(
            "INSERT INTO watch_progress (user_id, media_file_id, position_ms, duration_ms, state, updated_at) \
             VALUES (?, ?, 5, 10, 'in_progress', '2024-01-01T00:00:00.000Z')",
        )
        .bind(user)
        .bind(file.to_string())
        .execute(pool)
        .await
        .unwrap();
    }

    async fn progress_file(pool: &DbPool, user: &str) -> String {
        let row: (String,) =
            sqlx::query_as("SELECT media_file_id FROM watch_progress WHERE user_id = ?")
                .bind(user)
                .fetch_one(pool)
                .await
                .unwrap();
        row.0
    }

    /// An upgrade gives the file a new source id. With exactly one survivor
    /// for the leaf the old row is deleted and the viewer's place moves to it;
    /// another instance's rows are left alone and an empty listing is a no-op.
    #[tokio::test]
    async fn prune_replaces_a_superseded_row_and_moves_progress() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool.clone());
        let instance = Uuid::new_v4();
        let leaf = LeafRef::Episode(Uuid::new_v4());
        let old = repo
            .upsert_by_source(&sample_media_file(work_id, leaf, instance, Some("1")))
            .await
            .unwrap();
        let new = repo
            .upsert_by_source(&sample_media_file(work_id, leaf, instance, Some("2")))
            .await
            .unwrap();
        let other = repo
            .upsert_by_source(&sample_media_file(work_id, leaf, Uuid::new_v4(), Some("1")))
            .await
            .unwrap();
        let user = seed_user(&pool).await;
        seed_progress(&pool, &user, old.id).await;
        sqlx::query("INSERT INTO media_file_language_state (media_file_id, source, scanned_ms) VALUES (?, 'arr', 1)")
            .bind(old.id.to_string())
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            repo.prune_superseded_files(work_id, instance, &[])
                .await
                .unwrap(),
            PruneOutcome::default(),
            "an empty listing must not change anything"
        );
        // Candidates: new (same instance) is the only survivor; `other` is
        // another instance and is not preferred over it.
        let outcome = repo
            .prune_superseded_files(work_id, instance, &["2".to_string()])
            .await
            .unwrap();
        assert_eq!(outcome.deleted, 1);
        assert_eq!(outcome.marked_missing, 0);
        assert_eq!(outcome.moved_users, vec![Uuid::parse_str(&user).unwrap()]);
        let ids: Vec<Uuid> = repo
            .list_by_work_id(work_id)
            .await
            .unwrap()
            .iter()
            .map(|f| f.id)
            .collect();
        assert!(!ids.contains(&old.id));
        assert!(ids.contains(&new.id) && ids.contains(&other.id));
        assert_eq!(progress_file(&pool, &user).await, new.id.to_string());
        let state: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM media_file_language_state WHERE media_file_id = ?",
        )
        .bind(old.id.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(state.0, 0);
        assert_eq!(
            repo.prune_superseded_files(work_id, instance, &["2".to_string()])
                .await
                .unwrap(),
            PruneOutcome::default()
        );
    }

    /// A row the source dropped with no replacement is never deleted: it is
    /// marked missing (hidden from playable views, progress kept), and comes
    /// back when the source lists the same file id again.
    #[tokio::test]
    async fn prune_marks_a_row_without_a_survivor_missing_and_restores_it() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool.clone());
        let instance = Uuid::new_v4();
        let kept = repo
            .upsert_by_source(&sample_media_file(
                work_id,
                LeafRef::Episode(Uuid::new_v4()),
                instance,
                Some("1"),
            ))
            .await
            .unwrap();
        let gone_leaf = LeafRef::Episode(Uuid::new_v4());
        let gone_file = sample_media_file(work_id, gone_leaf, instance, Some("2"));
        let gone = repo.upsert_by_source(&gone_file).await.unwrap();
        // A third row keeps the change under the per-pass guard.
        repo.upsert_by_source(&sample_media_file(
            work_id,
            LeafRef::Episode(Uuid::new_v4()),
            instance,
            Some("3"),
        ))
        .await
        .unwrap();
        let user = seed_user(&pool).await;
        seed_progress(&pool, &user, gone.id).await;

        let outcome = repo
            .prune_superseded_files(work_id, instance, &["1".to_string(), "3".to_string()])
            .await
            .unwrap();
        assert_eq!((outcome.deleted, outcome.marked_missing), (0, 1));
        assert!(outcome.moved_users.is_empty());
        let listed = repo.list_by_work_id(work_id).await.unwrap();
        assert!(
            listed.iter().all(|f| f.id != gone.id),
            "missing row is hidden"
        );
        assert!(repo
            .find_by_leaf(work_id, gone_leaf)
            .await
            .unwrap()
            .is_none());
        assert!(!repo.list_work_ids().await.unwrap().is_empty());
        assert_eq!(repo.count_by_work().await.unwrap()[&work_id], 2);
        // Row and progress are intact.
        assert_eq!(repo.get_by_id(gone.id).await.unwrap().id, gone.id);
        assert_eq!(progress_file(&pool, &user).await, gone.id.to_string());
        assert!(listed.iter().any(|f| f.id == kept.id));
        // Idempotent: already missing rows are not touched again.
        assert_eq!(
            repo.prune_superseded_files(work_id, instance, &["1".to_string(), "3".to_string()])
                .await
                .unwrap(),
            PruneOutcome::default()
        );

        // The source lists it again (same id): the mark clears.
        repo.upsert_by_source(&gone_file).await.unwrap();
        let back = repo.list_by_work_id(work_id).await.unwrap();
        assert!(back.iter().any(|f| f.id == gone.id));
    }

    /// Two rows for one leaf with a single stale one is ambiguous (a book with
    /// several files): nothing moves and nothing is deleted.
    #[tokio::test]
    async fn prune_does_not_move_progress_between_several_files_of_one_leaf() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool.clone());
        let instance = Uuid::new_v4();
        let leaf = LeafRef::Episode(Uuid::new_v4());
        let mut ids = Vec::new();
        for id in ["1", "2", "3", "4"] {
            ids.push(
                repo.upsert_by_source(&sample_media_file(work_id, leaf, instance, Some(id)))
                    .await
                    .unwrap(),
            );
        }
        let user = seed_user(&pool).await;
        seed_progress(&pool, &user, ids[0].id).await;
        let outcome = repo
            .prune_superseded_files(
                work_id,
                instance,
                &["2".to_string(), "3".to_string(), "4".to_string()],
            )
            .await
            .unwrap();
        assert_eq!((outcome.deleted, outcome.marked_missing), (0, 1));
        assert!(outcome.moved_users.is_empty());
        assert_eq!(progress_file(&pool, &user).await, ids[0].id.to_string());
    }

    /// Touching more than half of an instance's rows for a work in one pass
    /// (a source returning a bad listing) changes nothing.
    #[tokio::test]
    async fn prune_guard_skips_a_pass_that_would_remove_most_rows() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let repo = SqlxMediaFileRepo::new(pool.clone());
        let instance = Uuid::new_v4();
        for id in ["1", "2", "3", "4"] {
            repo.upsert_by_source(&sample_media_file(
                work_id,
                LeafRef::Episode(Uuid::new_v4()),
                instance,
                Some(id),
            ))
            .await
            .unwrap();
        }
        let outcome = repo
            .prune_superseded_files(work_id, instance, &["1".to_string()])
            .await
            .unwrap();
        assert!(outcome.skipped);
        assert_eq!(repo.list_by_work_id(work_id).await.unwrap().len(), 4);
    }

    /// After progress moves to a replacement file, the viewer gets a watch
    /// event and the library gets a files event (which also makes the cached
    /// home rails stale, as they follow library events).
    #[tokio::test]
    async fn prune_publishes_watch_and_library_events_for_moved_progress() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        insert_work(&pool, work_id).await;
        let events = crate::LiveEventPublisher::from_pool(pool.clone());
        let repo = crate::repo::EventingMediaFileRepo::new(
            Arc::new(SqlxMediaFileRepo::new(pool.clone())),
            events.clone(),
        );
        let instance = Uuid::new_v4();
        let leaf = LeafRef::Episode(Uuid::new_v4());
        let old = repo
            .upsert_by_source(&sample_media_file(work_id, leaf, instance, Some("1")))
            .await
            .unwrap();
        repo.upsert_by_source(&sample_media_file(work_id, leaf, instance, Some("2")))
            .await
            .unwrap();
        let user = seed_user(&pool).await;
        seed_progress(&pool, &user, old.id).await;
        let before = events.repo().list_after(0, 1000).await.unwrap().len();

        repo.prune_superseded_files(work_id, instance, &["2".to_string()])
            .await
            .unwrap();
        let all = events.repo().list_after(0, 1000).await.unwrap();
        let new: Vec<_> = all.iter().skip(before).collect();
        assert!(new
            .iter()
            .any(|e| e.kind == "library" && e.changed.iter().any(|c| c == "files")));
        assert!(new
            .iter()
            .any(|e| e.kind == "watch" && e.user_id == Uuid::parse_str(&user).ok()));
    }
}
