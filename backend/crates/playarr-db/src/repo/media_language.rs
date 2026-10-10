//! Audio/subtitle language index per media file (task 180).
//!
//! Producers (`arr` mediaInfo at sync time, `probe` ffprobe, `sidecar`
//! subtitle files) each replace only their own rows; readers take the union.
//! `playarr_model::language` defines the canonical codes stored in `lang`.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

use async_trait::async_trait;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::parse_uuid;
use crate::error::DbError;
use crate::pool::DbPool;
use crate::write_queue::{write, WriteQueue};

pub const KIND_AUDIO: &str = "audio";
pub const KIND_SUBTITLE: &str = "subtitle";
pub const SOURCE_ARR: &str = "arr";
pub const SOURCE_PROBE: &str = "probe";
pub const SOURCE_SIDECAR: &str = "sidecar";

/// Languages known for one file, as sorted canonical codes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileLanguages {
    pub audio: Vec<String>,
    pub subtitles: Vec<String>,
}

/// One file's languages from one source, for
/// [`MediaLanguageRepo::replace_many`]. Same meaning as the arguments of
/// [`MediaLanguageRepo::replace`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LanguageUpdate {
    pub media_file_id: Uuid,
    pub source: String,
    pub audio: Option<Vec<String>>,
    pub subtitles: Option<Vec<String>>,
    pub scanned_ms: i64,
}

/// Files whose languages are compared and written together: one read of what
/// is stored and one write operation (one transaction, or one slot in the
/// shared write queue's commit) per this many files.
const REPLACE_BATCH: usize = 200;

/// Collapses updates for the same `(file, source)` into one that has the same
/// effect as applying them in order: a later kind overrides an earlier one, a
/// kind it leaves out (`None`) keeps the earlier value, and the last scan time
/// wins. One batch is planned against what is stored, so two entries for one
/// file would otherwise each be compared with the stale rows. Order of first
/// appearance is kept.
fn merge_duplicates(updates: &[LanguageUpdate]) -> Vec<LanguageUpdate> {
    let mut position: HashMap<(Uuid, &str), usize> = HashMap::new();
    let mut merged: Vec<LanguageUpdate> = Vec::with_capacity(updates.len());
    for update in updates {
        match position.get(&(update.media_file_id, update.source.as_str())) {
            Some(&index) => {
                let earlier = &mut merged[index];
                if update.audio.is_some() {
                    earlier.audio = update.audio.clone();
                }
                if update.subtitles.is_some() {
                    earlier.subtitles = update.subtitles.clone();
                }
                earlier.scanned_ms = update.scanned_ms;
            }
            None => {
                position.insert((update.media_file_id, update.source.as_str()), merged.len());
                merged.push(update.clone());
            }
        }
    }
    merged
}

/// Rows of `media_file_language_state` written by one statement.
const STATE_ROWS_PER_STATEMENT: usize = 100;

#[async_trait]
pub trait MediaLanguageRepo: Send + Sync {
    /// Replaces this `source`'s audio and subtitle rows for the file and
    /// records that the source has run. Pass `None` to leave a kind
    /// untouched (the sidecar producer only knows subtitles).
    async fn replace(
        &self,
        media_file_id: Uuid,
        source: &str,
        audio: Option<&[String]>,
        subtitles: Option<&[String]>,
        scanned_ms: i64,
    ) -> Result<(), DbError>;

    /// [`Self::replace`] for many files at once, with the same result as
    /// calling it for each in turn. The SQL repository reads what is stored
    /// for a whole batch in one query and writes the batch in one operation,
    /// instead of one read, one transaction and one commit sync per file.
    async fn replace_many(&self, updates: &[LanguageUpdate]) -> Result<(), DbError> {
        for update in updates {
            self.replace(
                update.media_file_id,
                &update.source,
                update.audio.as_deref(),
                update.subtitles.as_deref(),
                update.scanned_ms,
            )
            .await?;
        }
        Ok(())
    }

    async fn languages_for_file(&self, media_file_id: Uuid) -> Result<FileLanguages, DbError>;

    /// Whether `source` has run for the file (it may have found nothing).
    async fn has_state(&self, media_file_id: Uuid, source: &str) -> Result<bool, DbError>;

    /// Distinct `(work_id, lang)` pairs for `kind` across every file of
    /// every work, in one query (a series unions all of its episodes).
    async fn list_work_languages(&self, kind: &str) -> Result<Vec<(Uuid, String)>, DbError>;

    /// Number of distinct files per work, and per `(work, kind, lang)` how
    /// many files carry it -- backs the optional "every episode has X"
    /// semantics.
    async fn list_work_language_file_counts(
        &self,
        kind: &str,
    ) -> Result<(HashMap<Uuid, i64>, HashMap<(Uuid, String), i64>), DbError>;

    /// Files with no `probe` state and no `arr`-reported audio language:
    /// the backfill queue for ffprobe.
    async fn files_needing_probe(&self, limit: i64) -> Result<Vec<(Uuid, PathBuf)>, DbError>;

    /// Files whose sidecar scan never ran or is older than `before_ms`.
    async fn files_needing_sidecar_scan(
        &self,
        before_ms: i64,
        limit: i64,
    ) -> Result<Vec<(Uuid, PathBuf)>, DbError>;
}

pub struct SqlxMediaLanguageRepo {
    pool: DbPool,
    queue: Option<WriteQueue>,
}

/// What one update has to write once it was compared with what is stored.
struct PlannedUpdate {
    id: String,
    source: String,
    /// Kinds whose languages differ, with the languages to store.
    changed: Vec<(&'static str, Vec<String>)>,
    scanned_ms: i64,
}

impl SqlxMediaLanguageRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool, queue: None }
    }

    /// Sends writes through the shared write queue, so they commit together
    /// with other writers' instead of each taking the database's write lock
    /// and a commit sync of its own.
    pub fn with_write_queue(mut self, queue: WriteQueue) -> Self {
        self.queue = Some(queue);
        self
    }

    /// Compares one batch of updates with what is stored (two reads for the
    /// whole batch) and returns only those that need a write.
    async fn plan(&self, updates: &[LanguageUpdate]) -> Result<Vec<PlannedUpdate>, DbError> {
        let marks = vec!["?"; updates.len()].join(", ");
        let select = format!(
            "SELECT media_file_id, source, kind, lang FROM media_file_languages \
             WHERE media_file_id IN ({marks})"
        );
        let mut query = sqlx::query(&select);
        for update in updates {
            query = query.bind(update.media_file_id.to_string());
        }
        let mut existing: HashMap<(String, String, String), BTreeSet<String>> = HashMap::new();
        for row in query.fetch_all(&self.pool).await? {
            let id: String = row.try_get("media_file_id")?;
            let source: String = row.try_get("source")?;
            let kind: String = row.try_get("kind")?;
            let lang: String = row.try_get("lang")?;
            existing.entry((id, source, kind)).or_default().insert(lang);
        }
        // `arr` state is only ever tested for existence.
        let select = format!(
            "SELECT media_file_id FROM media_file_language_state \
             WHERE source = '{SOURCE_ARR}' AND media_file_id IN ({marks})"
        );
        let mut query = sqlx::query(&select);
        for update in updates {
            query = query.bind(update.media_file_id.to_string());
        }
        let mut has_arr_state: BTreeSet<String> = BTreeSet::new();
        for row in query.fetch_all(&self.pool).await? {
            has_arr_state.insert(row.try_get("media_file_id")?);
        }

        let mut planned = Vec::new();
        for update in updates {
            let id = update.media_file_id.to_string();
            let changed: Vec<(&'static str, Vec<String>)> = [
                (KIND_AUDIO, update.audio.as_ref()),
                (KIND_SUBTITLE, update.subtitles.as_ref()),
            ]
            .into_iter()
            .filter_map(|(kind, langs)| Some((kind, langs?)))
            .filter(|(kind, langs)| {
                let wanted: BTreeSet<&String> = langs.iter().collect();
                let have: BTreeSet<&String> = existing
                    .get(&(id.clone(), update.source.clone(), (*kind).to_string()))
                    .map(|set| set.iter().collect())
                    .unwrap_or_default();
                wanted != have
            })
            .map(|(kind, langs)| (kind, langs.clone()))
            .collect();
            // An unchanged re-sync of a file that already has `arr` state needs
            // no write at all.
            if changed.is_empty() && update.source == SOURCE_ARR && has_arr_state.contains(&id) {
                continue;
            }
            planned.push(PlannedUpdate {
                id,
                source: update.source.clone(),
                changed,
                scanned_ms: update.scanned_ms,
            });
        }
        Ok(planned)
    }

    /// Writes planned updates in one operation: the changed languages, then
    /// every file's state in as few statements as the bind limit allows.
    async fn apply(&self, planned: Vec<PlannedUpdate>) -> Result<(), DbError> {
        if planned.is_empty() {
            return Ok(());
        }
        let planned = std::sync::Arc::new(planned);
        write(self.queue.as_ref(), &self.pool, move |conn| {
            let planned = planned.clone();
            Box::pin(async move {
                for update in planned.iter() {
                    for (kind, langs) in &update.changed {
                        sqlx::query(
                            "DELETE FROM media_file_languages \
                             WHERE media_file_id = ? AND source = ? AND kind = ?",
                        )
                        .bind(&update.id)
                        .bind(&update.source)
                        .bind(*kind)
                        .execute(&mut *conn)
                        .await?;
                        for lang in langs {
                            sqlx::query(
                                "INSERT INTO media_file_languages (media_file_id, kind, lang, source) \
                                 VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
                            )
                            .bind(&update.id)
                            .bind(*kind)
                            .bind(lang)
                            .bind(&update.source)
                            .execute(&mut *conn)
                            .await?;
                        }
                    }
                }
                // Three binds per row; far below SQLite's limit.
                for chunk in planned.chunks(STATE_ROWS_PER_STATEMENT) {
                    let values = vec!["(?, ?, ?)"; chunk.len()].join(", ");
                    let sql = format!(
                        "INSERT INTO media_file_language_state (media_file_id, source, scanned_ms) \
                         VALUES {values} \
                         ON CONFLICT (media_file_id, source) DO UPDATE SET \
                         scanned_ms = excluded.scanned_ms"
                    );
                    let mut query = sqlx::query(&sql);
                    for update in chunk {
                        query = query
                            .bind(&update.id)
                            .bind(&update.source)
                            .bind(update.scanned_ms);
                    }
                    query.execute(&mut *conn).await?;
                }
                Ok(())
            })
        })
        .await
    }

    /// The placeholder for the n-th (1-based) bind parameter (`?` on SQLite).
    fn p(&self, _n: usize) -> String {
        "?".to_string()
    }

    fn rows_to_files(rows: &[sqlx::any::AnyRow]) -> Result<Vec<(Uuid, PathBuf)>, DbError> {
        rows.iter()
            .map(|row| {
                let id: String = row.try_get("id")?;
                let path: String = row.try_get("path")?;
                Ok((parse_uuid(&id)?, PathBuf::from(path)))
            })
            .collect()
    }
}

#[async_trait]
impl MediaLanguageRepo for SqlxMediaLanguageRepo {
    async fn replace(
        &self,
        media_file_id: Uuid,
        source: &str,
        audio: Option<&[String]>,
        subtitles: Option<&[String]>,
        scanned_ms: i64,
    ) -> Result<(), DbError> {
        // Read what the source already stored *before* taking the write lock.
        // A reconciliation pass re-syncs every file and almost always finds
        // the same languages; writing them again would queue behind every
        // other writer on the single SQLite write lock (and fsync once per
        // file) for no change. Only kinds that actually differ are rewritten.
        let update = LanguageUpdate {
            media_file_id,
            source: source.to_string(),
            audio: audio.map(<[String]>::to_vec),
            subtitles: subtitles.map(<[String]>::to_vec),
            scanned_ms,
        };
        let planned = self.plan(std::slice::from_ref(&update)).await?;
        self.apply(planned).await
    }

    async fn replace_many(&self, updates: &[LanguageUpdate]) -> Result<(), DbError> {
        let updates = merge_duplicates(updates);
        for batch in updates.chunks(REPLACE_BATCH) {
            let planned = self.plan(batch).await?;
            self.apply(planned).await?;
        }
        Ok(())
    }

    async fn languages_for_file(&self, media_file_id: Uuid) -> Result<FileLanguages, DbError> {
        let sql = format!(
            "SELECT DISTINCT kind, lang FROM media_file_languages WHERE media_file_id = {} ORDER BY lang",
            self.p(1)
        );
        let rows = sqlx::query(&sql)
            .bind(media_file_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        let mut out = FileLanguages::default();
        for row in rows {
            let kind: String = row.try_get("kind")?;
            let lang: String = row.try_get("lang")?;
            if kind == KIND_AUDIO {
                out.audio.push(lang);
            } else {
                out.subtitles.push(lang);
            }
        }
        Ok(out)
    }

    async fn has_state(&self, media_file_id: Uuid, source: &str) -> Result<bool, DbError> {
        let sql = format!(
            "SELECT 1 AS one FROM media_file_language_state WHERE media_file_id = {} AND source = {}",
            self.p(1),
            self.p(2)
        );
        let row = sqlx::query(&sql)
            .bind(media_file_id.to_string())
            .bind(source)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.is_some())
    }

    async fn list_work_languages(&self, kind: &str) -> Result<Vec<(Uuid, String)>, DbError> {
        let sql = format!(
            "SELECT DISTINCT m.work_id AS work_id, l.lang AS lang \
             FROM media_file_languages l JOIN media_files m ON m.id = l.media_file_id \
             WHERE l.kind = {}",
            self.p(1)
        );
        let rows = sqlx::query(&sql).bind(kind).fetch_all(&self.pool).await?;
        rows.iter()
            .map(|row| {
                let work_id: String = row.try_get("work_id")?;
                let lang: String = row.try_get("lang")?;
                Ok((parse_uuid(&work_id)?, lang))
            })
            .collect()
    }

    async fn list_work_language_file_counts(
        &self,
        kind: &str,
    ) -> Result<(HashMap<Uuid, i64>, HashMap<(Uuid, String), i64>), DbError> {
        let totals = sqlx::query("SELECT work_id, COUNT(*) AS n FROM media_files GROUP BY work_id")
            .fetch_all(&self.pool)
            .await?;
        let mut file_totals = HashMap::new();
        for row in totals {
            let work_id: String = row.try_get("work_id")?;
            let n: i64 = row.try_get("n")?;
            file_totals.insert(parse_uuid(&work_id)?, n);
        }
        let sql = format!(
            "SELECT m.work_id AS work_id, l.lang AS lang, COUNT(DISTINCT m.id) AS n \
             FROM media_file_languages l JOIN media_files m ON m.id = l.media_file_id \
             WHERE l.kind = {} GROUP BY m.work_id, l.lang",
            self.p(1)
        );
        let rows = sqlx::query(&sql).bind(kind).fetch_all(&self.pool).await?;
        let mut with_lang = HashMap::new();
        for row in rows {
            let work_id: String = row.try_get("work_id")?;
            let lang: String = row.try_get("lang")?;
            let n: i64 = row.try_get("n")?;
            with_lang.insert((parse_uuid(&work_id)?, lang), n);
        }
        Ok((file_totals, with_lang))
    }

    async fn files_needing_probe(&self, limit: i64) -> Result<Vec<(Uuid, PathBuf)>, DbError> {
        let sql = format!(
            "SELECT m.id AS id, m.path AS path FROM media_files m \
             WHERE NOT EXISTS (SELECT 1 FROM media_file_language_state s \
                 WHERE s.media_file_id = m.id AND s.source = '{SOURCE_PROBE}') \
             AND NOT EXISTS (SELECT 1 FROM media_file_languages l \
                 WHERE l.media_file_id = m.id AND l.source = '{SOURCE_ARR}' AND l.kind = '{KIND_AUDIO}') \
             ORDER BY m.id LIMIT {}",
            self.p(1)
        );
        let rows = sqlx::query(&sql).bind(limit).fetch_all(&self.pool).await?;
        Self::rows_to_files(&rows)
    }

    async fn files_needing_sidecar_scan(
        &self,
        before_ms: i64,
        limit: i64,
    ) -> Result<Vec<(Uuid, PathBuf)>, DbError> {
        let sql = format!(
            "SELECT m.id AS id, m.path AS path FROM media_files m \
             LEFT JOIN media_file_language_state s \
                 ON s.media_file_id = m.id AND s.source = '{SOURCE_SIDECAR}' \
             WHERE s.media_file_id IS NULL OR s.scanned_ms < {} \
             ORDER BY COALESCE(s.scanned_ms, 0), m.id LIMIT {}",
            self.p(1),
            self.p(2)
        );
        let rows = sqlx::query(&sql)
            .bind(before_ms)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        Self::rows_to_files(&rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;

    async fn pool() -> DbPool {
        let pool = test_sqlite_pool().await;
        // Single-connection pool: rows below skip the works/sources parents.
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn insert_file(pool: &DbPool, id: Uuid, work: Uuid, path: &str) {
        sqlx::query(
            "INSERT INTO media_files (id, work_id, leaf_ref, path, container, codec, size_bytes, source_instance_id) \
             VALUES (?, ?, ?, ?, 'mkv', 'h264', 1, ?)",
        )
        .bind(id.to_string())
        .bind(work.to_string())
        .bind(work.to_string())
        .bind(path)
        .bind(Uuid::new_v4().to_string())
        .execute(pool)
        .await
        .unwrap();
    }

    fn langs(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn sources_replace_only_their_own_rows_and_readers_union_them() {
        let pool = pool().await;
        let repo = SqlxMediaLanguageRepo::new(pool.clone());
        let (file, work) = (Uuid::new_v4(), Uuid::new_v4());
        insert_file(&pool, file, work, "/m/a.mkv").await;

        repo.replace(
            file,
            SOURCE_ARR,
            Some(&langs(&["en", "ja"])),
            Some(&langs(&["en"])),
            10,
        )
        .await
        .unwrap();
        repo.replace(file, SOURCE_SIDECAR, None, Some(&langs(&["fr"])), 20)
            .await
            .unwrap();
        let found = repo.languages_for_file(file).await.unwrap();
        assert_eq!(found.audio, langs(&["en", "ja"]));
        assert_eq!(found.subtitles, langs(&["en", "fr"]));

        // A re-sync replaces the arr rows without touching the sidecar rows.
        repo.replace(file, SOURCE_ARR, Some(&langs(&["en"])), Some(&[]), 30)
            .await
            .unwrap();
        let found = repo.languages_for_file(file).await.unwrap();
        assert_eq!(found.audio, langs(&["en"]));
        assert_eq!(found.subtitles, langs(&["fr"]));

        let mut pairs = repo.list_work_languages(KIND_SUBTITLE).await.unwrap();
        pairs.sort();
        assert_eq!(pairs, vec![(work, "fr".to_string())]);
        assert!(repo.has_state(file, SOURCE_ARR).await.unwrap());
        assert!(!repo.has_state(file, SOURCE_PROBE).await.unwrap());
    }

    async fn state_scanned_ms(pool: &DbPool, file: Uuid, source: &str) -> i64 {
        sqlx::query_scalar(
            "SELECT scanned_ms FROM media_file_language_state WHERE media_file_id = ? AND source = ?",
        )
        .bind(file.to_string())
        .bind(source)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn unchanged_arr_resync_writes_nothing() {
        let pool = pool().await;
        let repo = SqlxMediaLanguageRepo::new(pool.clone());
        let file = Uuid::new_v4();
        repo.replace(file, SOURCE_ARR, Some(&langs(&["en", "ja"])), Some(&[]), 10)
            .await
            .unwrap();
        // Same set in a different order: no write, so scanned_ms stays put.
        repo.replace(file, SOURCE_ARR, Some(&langs(&["ja", "en"])), Some(&[]), 99)
            .await
            .unwrap();
        assert_eq!(state_scanned_ms(&pool, file, SOURCE_ARR).await, 10);
        let found = repo.languages_for_file(file).await.unwrap();
        assert_eq!(found.audio, langs(&["en", "ja"]));
        assert!(found.subtitles.is_empty());
    }

    #[tokio::test]
    async fn changed_kind_is_rewritten_and_other_kind_kept() {
        let pool = pool().await;
        let repo = SqlxMediaLanguageRepo::new(pool.clone());
        let file = Uuid::new_v4();
        repo.replace(
            file,
            SOURCE_ARR,
            Some(&langs(&["en"])),
            Some(&langs(&["fr"])),
            10,
        )
        .await
        .unwrap();
        repo.replace(
            file,
            SOURCE_ARR,
            Some(&langs(&["en"])),
            Some(&langs(&["de"])),
            20,
        )
        .await
        .unwrap();
        let found = repo.languages_for_file(file).await.unwrap();
        assert_eq!(found.audio, langs(&["en"]));
        assert_eq!(found.subtitles, langs(&["de"]));
        assert_eq!(state_scanned_ms(&pool, file, SOURCE_ARR).await, 20);
    }

    #[tokio::test]
    async fn empty_result_still_records_state_and_clears_rows() {
        let pool = pool().await;
        let repo = SqlxMediaLanguageRepo::new(pool.clone());
        let file = Uuid::new_v4();
        repo.replace(file, SOURCE_PROBE, Some(&[]), Some(&[]), 5)
            .await
            .unwrap();
        assert!(repo.has_state(file, SOURCE_PROBE).await.unwrap());
        repo.replace(file, SOURCE_PROBE, Some(&langs(&["en"])), Some(&[]), 6)
            .await
            .unwrap();
        repo.replace(file, SOURCE_PROBE, Some(&[]), Some(&[]), 7)
            .await
            .unwrap();
        assert_eq!(
            repo.languages_for_file(file).await.unwrap(),
            FileLanguages::default()
        );
        // Non-arr sources keep bumping their scan time (the sidecar queue ages on it).
        assert_eq!(state_scanned_ms(&pool, file, SOURCE_PROBE).await, 7);
    }

    #[tokio::test]
    async fn delete_uses_the_primary_key_prefix_index() {
        let pool = pool().await;
        let plan: Vec<(i64, i64, i64, String)> = sqlx::query_as(
            "EXPLAIN QUERY PLAN DELETE FROM media_file_languages WHERE media_file_id = ? AND source = ? AND kind = ?",
        )
        .bind("x")
        .bind("arr")
        .bind("audio")
        .fetch_all(&pool)
        .await
        .unwrap();
        let detail = plan
            .iter()
            .map(|r| r.3.clone())
            .collect::<Vec<_>>()
            .join("; ");
        assert!(
            detail.contains("SEARCH") && detail.contains("autoindex"),
            "plan: {detail}"
        );
        assert!(!detail.contains("SCAN"), "plan: {detail}");
    }

    #[tokio::test]
    async fn backfill_queues_skip_files_already_described() {
        let pool = pool().await;
        let repo = SqlxMediaLanguageRepo::new(pool.clone());
        let (described, bare, probed) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        for (i, id) in [described, bare, probed].into_iter().enumerate() {
            insert_file(&pool, id, Uuid::new_v4(), &format!("/m/{i}.mkv")).await;
        }
        repo.replace(described, SOURCE_ARR, Some(&langs(&["en"])), Some(&[]), 1)
            .await
            .unwrap();
        repo.replace(probed, SOURCE_PROBE, Some(&[]), Some(&[]), 1)
            .await
            .unwrap();

        let needing: Vec<Uuid> = repo
            .files_needing_probe(10)
            .await
            .unwrap()
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        assert_eq!(needing, vec![bare]);

        // Sidecar queue: everything unscanned, then only stale entries.
        assert_eq!(
            repo.files_needing_sidecar_scan(100, 10)
                .await
                .unwrap()
                .len(),
            3
        );
        repo.replace(bare, SOURCE_SIDECAR, None, Some(&[]), 50)
            .await
            .unwrap();
        assert_eq!(
            repo.files_needing_sidecar_scan(40, 10).await.unwrap().len(),
            2
        );
        assert_eq!(
            repo.files_needing_sidecar_scan(60, 10).await.unwrap().len(),
            3
        );
    }

    #[tokio::test]
    async fn file_counts_support_every_file_semantics() {
        let pool = pool().await;
        let repo = SqlxMediaLanguageRepo::new(pool.clone());
        let work = Uuid::new_v4();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        insert_file(&pool, a, work, "/m/a.mkv").await;
        insert_file(&pool, b, work, "/m/b.mkv").await;
        repo.replace(
            a,
            SOURCE_ARR,
            Some(&langs(&["en"])),
            Some(&langs(&["en"])),
            1,
        )
        .await
        .unwrap();
        repo.replace(b, SOURCE_ARR, Some(&langs(&["en"])), Some(&[]), 1)
            .await
            .unwrap();
        let (totals, with) = repo
            .list_work_language_file_counts(KIND_SUBTITLE)
            .await
            .unwrap();
        assert_eq!(totals[&work], 2);
        assert_eq!(with[&(work, "en".to_string())], 1);
    }

    fn update(file: Uuid, source: &str, audio: &[&str], subs: &[&str], at: i64) -> LanguageUpdate {
        LanguageUpdate {
            media_file_id: file,
            source: source.to_string(),
            audio: Some(langs(audio)),
            subtitles: Some(langs(subs)),
            scanned_ms: at,
        }
    }

    /// Row 9952: a batch is applied exactly as the same updates one at a time.
    #[tokio::test]
    async fn replace_many_matches_replace_one_by_one() {
        let (batched_pool, one_pool) = (pool().await, pool().await);
        let (batched, one) = (
            SqlxMediaLanguageRepo::new(batched_pool.clone()),
            SqlxMediaLanguageRepo::new(one_pool.clone()),
        );
        let files: Vec<Uuid> = (0..450).map(|_| Uuid::new_v4()).collect();
        let first: Vec<_> = files
            .iter()
            .enumerate()
            .map(|(i, file)| match i % 3 {
                0 => update(*file, SOURCE_ARR, &["en", "ja"], &["en"], 10),
                1 => update(*file, SOURCE_PROBE, &["fr"], &[], 10),
                _ => LanguageUpdate {
                    audio: None,
                    ..update(*file, SOURCE_SIDECAR, &[], &["de", "es"], 10)
                },
            })
            .collect();
        // The second round changes some files, repeats others, and adds a
        // second source to a few.
        let second: Vec<_> = files
            .iter()
            .enumerate()
            .map(|(i, file)| match i % 3 {
                0 if i % 2 == 0 => update(*file, SOURCE_ARR, &["en"], &["en", "fr"], 20),
                0 => update(*file, SOURCE_ARR, &["ja", "en"], &["en"], 20),
                1 => update(*file, SOURCE_PROBE, &["fr"], &[], 20),
                _ => update(*file, SOURCE_ARR, &["it"], &[], 20),
            })
            .collect();
        for round in [&first, &second] {
            batched.replace_many(round).await.unwrap();
            for u in round {
                one.replace(
                    u.media_file_id,
                    &u.source,
                    u.audio.as_deref(),
                    u.subtitles.as_deref(),
                    u.scanned_ms,
                )
                .await
                .unwrap();
            }
        }
        async fn dump(
            pool: &DbPool,
        ) -> (
            Vec<(String, String, String, String)>,
            Vec<(String, String, i64)>,
        ) {
            let languages = sqlx::query_as(
                "SELECT media_file_id, kind, lang, source FROM media_file_languages ORDER BY 1, 2, 3, 4",
            )
            .fetch_all(pool)
            .await
            .unwrap();
            let state = sqlx::query_as(
                "SELECT media_file_id, source, scanned_ms FROM media_file_language_state ORDER BY 1, 2",
            )
            .fetch_all(pool)
            .await
            .unwrap();
            (languages, state)
        }
        assert_eq!(dump(&batched_pool).await, dump(&one_pool).await);
    }

    /// Query count: a batch of files is one queue operation, not one per file,
    /// and a whole batch that changed nothing (`arr` re-sync) submits none.
    #[tokio::test]
    async fn replace_many_is_one_write_operation_per_batch() {
        let pool = pool().await;
        let queue = WriteQueue::spawn(
            pool.clone(),
            crate::write_queue::WriteQueueConfig::default(),
        );
        let repo = SqlxMediaLanguageRepo::new(pool.clone()).with_write_queue(queue.clone());
        let files: Vec<Uuid> = (0..REPLACE_BATCH + 50).map(|_| Uuid::new_v4()).collect();
        let sidecar: Vec<_> = files
            .iter()
            .map(|f| LanguageUpdate {
                audio: None,
                ..update(*f, SOURCE_SIDECAR, &[], &["en"], 1)
            })
            .collect();
        let before = queue.stats().ops;
        repo.replace_many(&sidecar).await.unwrap();
        assert_eq!(
            queue.stats().ops - before,
            2,
            "two batches, not one write per file"
        );
        for file in &files {
            assert_eq!(state_scanned_ms(&pool, *file, SOURCE_SIDECAR).await, 1);
        }

        // Re-scanning unchanged sidecars still advances the scan time, once
        // per batch.
        let rescan: Vec<_> = sidecar
            .iter()
            .cloned()
            .map(|u| LanguageUpdate { scanned_ms: 2, ..u })
            .collect();
        let before = queue.stats().ops;
        repo.replace_many(&rescan).await.unwrap();
        assert_eq!(queue.stats().ops - before, 2);
        assert_eq!(state_scanned_ms(&pool, files[7], SOURCE_SIDECAR).await, 2);

        let arr: Vec<_> = files
            .iter()
            .map(|f| update(*f, SOURCE_ARR, &["en"], &[], 1))
            .collect();
        repo.replace_many(&arr).await.unwrap();
        let before = queue.stats().ops;
        let again: Vec<_> = arr
            .iter()
            .cloned()
            .map(|u| LanguageUpdate { scanned_ms: 9, ..u })
            .collect();
        repo.replace_many(&again).await.unwrap();
        assert_eq!(
            queue.stats().ops - before,
            0,
            "unchanged arr re-sync writes nothing"
        );

        // A single `replace` goes through the queue too: one operation.
        let before = queue.stats().ops;
        repo.replace(files[0], SOURCE_PROBE, Some(&langs(&["fr"])), Some(&[]), 3)
            .await
            .unwrap();
        assert_eq!(queue.stats().ops - before, 1);
        queue.shutdown().await;
    }

    /// Two entries for one file and source in a batch act as if applied in
    /// order (the later one wins; a kind it leaves out keeps the earlier one).
    #[tokio::test]
    async fn replace_many_with_a_repeated_file_matches_applying_them_in_order() {
        let (batched_pool, one_pool) = (pool().await, pool().await);
        let (batched, one) = (
            SqlxMediaLanguageRepo::new(batched_pool.clone()),
            SqlxMediaLanguageRepo::new(one_pool.clone()),
        );
        let file = Uuid::new_v4();
        let updates = vec![
            update(file, SOURCE_PROBE, &["en"], &["fr"], 1),
            LanguageUpdate {
                audio: None,
                ..update(file, SOURCE_PROBE, &[], &["de"], 2)
            },
            update(file, SOURCE_SIDECAR, &["ja"], &[], 3),
        ];
        batched.replace_many(&updates).await.unwrap();
        for u in &updates {
            one.replace(
                u.media_file_id,
                &u.source,
                u.audio.as_deref(),
                u.subtitles.as_deref(),
                u.scanned_ms,
            )
            .await
            .unwrap();
        }
        let (a, b) = (
            batched.languages_for_file(file).await.unwrap(),
            one.languages_for_file(file).await.unwrap(),
        );
        assert_eq!(a, b);
        assert_eq!(a.audio, langs(&["en", "ja"]));
        assert_eq!(a.subtitles, langs(&["de"]));
        assert_eq!(state_scanned_ms(&batched_pool, file, SOURCE_PROBE).await, 2);
        assert_eq!(state_scanned_ms(&one_pool, file, SOURCE_PROBE).await, 2);
    }

    /// The batch reads are index lookups on `media_file_id`, never scans.
    #[tokio::test]
    async fn the_batch_reads_use_the_primary_keys() {
        let pool = pool().await;
        for sql in [
            "EXPLAIN QUERY PLAN SELECT media_file_id, source, kind, lang FROM media_file_languages WHERE media_file_id IN (?, ?)",
            "EXPLAIN QUERY PLAN SELECT media_file_id FROM media_file_language_state WHERE source = 'arr' AND media_file_id IN (?, ?)",
        ] {
            let rows = sqlx::query(sql)
                .bind("a")
                .bind("b")
                .fetch_all(&pool)
                .await
                .unwrap();
            let plan: Vec<String> = rows
                .iter()
                .map(|row| row.try_get::<String, _>("detail").unwrap())
                .collect();
            assert!(
                plan.iter().any(|step| step.contains("SEARCH") && step.contains("media_file_id=?")),
                "{sql}: {plan:?}"
            );
            assert!(!plan.iter().any(|step| step.starts_with("SCAN")), "{sql}: {plan:?}");
        }
    }

    /// Opt-in timing harness: `cargo test -p playarr-db -- --ignored --nocapture language_replace_bench`.
    /// 3,000 works, 30,000 files, 4 language rows per file, on a file-backed
    /// WAL database with a competing writer, then a full unchanged re-sync.
    #[tokio::test]
    #[ignore]
    async fn language_replace_bench() {
        use std::time::Instant;
        let path = std::env::temp_dir().join(format!("playarr-lang-bench-{}.db", Uuid::new_v4()));
        let pool = crate::pool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        crate::pool::run_migrations(&pool).await.unwrap();
        let repo = SqlxMediaLanguageRepo::new(pool.clone());
        let files: Vec<Uuid> = (0..30_000).map(|_| Uuid::new_v4()).collect();
        let (audio, subs) = (langs(&["en", "ja"]), langs(&["en", "fr"]));
        // Seed in one transaction (setup, not measured).
        let mut tx = pool.begin().await.unwrap();
        for file in &files {
            for (kind, list) in [(KIND_AUDIO, &audio), (KIND_SUBTITLE, &subs)] {
                for lang in list {
                    sqlx::query("INSERT INTO media_file_languages (media_file_id, kind, lang, source) VALUES (?, ?, ?, 'arr')")
                        .bind(file.to_string())
                        .bind(kind)
                        .bind(lang)
                        .execute(&mut *tx)
                        .await
                        .unwrap();
                }
            }
            sqlx::query("INSERT INTO media_file_language_state (media_file_id, source, scanned_ms) VALUES (?, 'arr', 1)")
                .bind(file.to_string())
                .execute(&mut *tx)
                .await
                .unwrap();
        }
        tx.commit().await.unwrap();

        sqlx::query("CREATE TABLE bench_other (id INTEGER PRIMARY KEY, v INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        let writer_pool = pool.clone();
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop2 = stop.clone();
        let writer = tokio::spawn(async move {
            let mut n = 0i64;
            while !stop2.load(std::sync::atomic::Ordering::Relaxed) {
                n += 1;
                sqlx::query("INSERT OR REPLACE INTO bench_other (id, v) VALUES (?, ?)")
                    .bind(n % 500)
                    .bind(n)
                    .execute(&writer_pool)
                    .await
                    .unwrap();
                tokio::time::sleep(std::time::Duration::from_millis(2)).await;
            }
        });
        let sample = &files[..5_000];
        let started = Instant::now();
        let mut worst = std::time::Duration::ZERO;
        for file in sample {
            let one = Instant::now();
            repo.replace(*file, SOURCE_ARR, Some(&audio), Some(&subs), 2)
                .await
                .unwrap();
            worst = worst.max(one.elapsed());
        }
        println!(
            "unchanged re-sync of {} of {} files with a competing writer: {:?} (worst single replace {:?})",
            sample.len(),
            files.len(),
            started.elapsed(),
            worst
        );
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        writer.await.unwrap();
        let plan: Vec<(i64, i64, i64, String)> = sqlx::query_as(
            "EXPLAIN QUERY PLAN DELETE FROM media_file_languages WHERE media_file_id = ? AND source = ? AND kind = ?",
        )
        .bind("x")
        .bind("arr")
        .bind("audio")
        .fetch_all(&pool)
        .await
        .unwrap();
        println!("delete plan: {plan:?}");
        let _ = std::fs::remove_file(&path);
    }
}
