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
use crate::pool::{Backend, DbPool};

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
    backend: Backend,
}

impl SqlxMediaLanguageRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    /// `?` or `$n` for the n-th (1-based) bind parameter.
    fn p(&self, n: usize) -> String {
        match self.backend {
            Backend::Sqlite => "?".to_string(),
            Backend::Postgres => format!("${n}"),
        }
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
        let id = media_file_id.to_string();

        // Read what the source already stored *before* taking the write lock.
        // A reconciliation pass re-syncs every file and almost always finds
        // the same languages; writing them again would queue behind every
        // other writer on the single SQLite write lock (and fsync once per
        // file) for no change. Only kinds that actually differ are rewritten.
        let select = format!(
            "SELECT kind, lang FROM media_file_languages WHERE media_file_id = {} AND source = {}",
            self.p(1),
            self.p(2)
        );
        let existing_rows = sqlx::query(&select)
            .bind(&id)
            .bind(source)
            .fetch_all(&self.pool)
            .await?;
        let mut existing: HashMap<String, BTreeSet<String>> = HashMap::new();
        for row in &existing_rows {
            let kind: String = row.try_get("kind")?;
            let lang: String = row.try_get("lang")?;
            existing.entry(kind).or_default().insert(lang);
        }
        let changed: Vec<(&str, &[String])> = [(KIND_AUDIO, audio), (KIND_SUBTITLE, subtitles)]
            .into_iter()
            .filter_map(|(kind, langs)| Some((kind, langs?)))
            .filter(|(kind, langs)| {
                let wanted: BTreeSet<&String> = langs.iter().collect();
                let have: BTreeSet<&String> = existing
                    .get(*kind)
                    .map(|set| set.iter().collect())
                    .unwrap_or_default();
                wanted != have
            })
            .collect();
        // `arr` state is only ever tested for existence, so an unchanged
        // re-sync of a file that already has it needs no write at all.
        if changed.is_empty()
            && source == SOURCE_ARR
            && self.has_state(media_file_id, source).await?
        {
            return Ok(());
        }

        let mut tx = self.pool.begin().await?;
        for (kind, langs) in changed {
            let delete = format!(
                "DELETE FROM media_file_languages WHERE media_file_id = {} AND source = {} AND kind = {}",
                self.p(1),
                self.p(2),
                self.p(3)
            );
            sqlx::query(&delete)
                .bind(&id)
                .bind(source)
                .bind(kind)
                .execute(&mut *tx)
                .await?;
            for lang in langs {
                let insert = format!(
                    "INSERT INTO media_file_languages (media_file_id, kind, lang, source) \
                     VALUES ({}, {}, {}, {}) ON CONFLICT DO NOTHING",
                    self.p(1),
                    self.p(2),
                    self.p(3),
                    self.p(4)
                );
                sqlx::query(&insert)
                    .bind(&id)
                    .bind(kind)
                    .bind(lang)
                    .bind(source)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        let state = format!(
            "INSERT INTO media_file_language_state (media_file_id, source, scanned_ms) \
             VALUES ({}, {}, {}) \
             ON CONFLICT (media_file_id, source) DO UPDATE SET scanned_ms = {}",
            self.p(1),
            self.p(2),
            self.p(3),
            match self.backend {
                Backend::Sqlite => "excluded.scanned_ms",
                Backend::Postgres => "EXCLUDED.scanned_ms",
            }
        );
        sqlx::query(&state)
            .bind(&id)
            .bind(source)
            .bind(scanned_ms)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
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
        crate::pool::run_migrations(&pool, false).await.unwrap();
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
