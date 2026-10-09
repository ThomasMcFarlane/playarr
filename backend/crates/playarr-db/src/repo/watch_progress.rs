use async_trait::async_trait;
use playarr_model::{WatchProgress, WatchState};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::DbPool;
use crate::write_queue::{write_latest, WriteQueue};

#[async_trait]
pub trait WatchProgressRepo: Send + Sync {
    async fn get(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
    ) -> Result<Option<WatchProgress>, DbError>;

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<WatchProgress>, DbError>;

    async fn upsert(&self, user_id: Uuid, progress: &WatchProgress) -> Result<(), DbError>;
}

pub struct SqlxWatchProgressRepo {
    pool: DbPool,
    queue: Option<WriteQueue>,
}

impl SqlxWatchProgressRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool, queue: None }
    }

    /// Sends `upsert` through the shared write queue, so heartbeats arriving
    /// together share one commit.
    pub fn with_write_queue(mut self, queue: WriteQueue) -> Self {
        self.queue = Some(queue);
        self
    }

    fn from_row(row: &AnyRow) -> Result<WatchProgress, DbError> {
        let media_file_id: String = row.try_get("media_file_id")?;
        let work_id: String = row.try_get("work_id")?;
        let position_ms: i64 = row.try_get("position_ms")?;
        let duration_ms: i64 = row.try_get("duration_ms")?;
        let state: String = row.try_get("state")?;
        let updated_at: String = row.try_get("updated_at")?;

        Ok(WatchProgress {
            media_file_id: parse_uuid(&media_file_id)?,
            work_id: parse_uuid(&work_id)?,
            position_ms: position_ms.max(0) as u64,
            duration_ms: duration_ms.max(0) as u64,
            state: match state.as_str() {
                "unseen" => WatchState::Unseen,
                "part_watched" => WatchState::PartWatched,
                "watched" => WatchState::Watched,
                other => return Err(decode_err(format!("unknown watch state {other}"))),
            },
            updated_at: Some(parse_datetime(&updated_at)?),
        })
    }
}

fn state_to_str(state: WatchState) -> &'static str {
    match state {
        WatchState::Unseen => "unseen",
        WatchState::PartWatched => "part_watched",
        WatchState::Watched => "watched",
    }
}

#[async_trait]
impl WatchProgressRepo for SqlxWatchProgressRepo {
    async fn get(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
    ) -> Result<Option<WatchProgress>, DbError> {
        let sql = "SELECT p.media_file_id, m.work_id, p.position_ms, p.duration_ms, p.state, \
                 p.updated_at FROM watch_progress p \
                 JOIN media_files m ON m.id = p.media_file_id \
                 WHERE p.user_id = ? AND p.media_file_id = ?";
        let row = sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(media_file_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<WatchProgress>, DbError> {
        let sql = "SELECT p.media_file_id, m.work_id, p.position_ms, p.duration_ms, p.state, \
                 p.updated_at FROM watch_progress p \
                 JOIN media_files m ON m.id = p.media_file_id \
                 WHERE p.user_id = ? ORDER BY p.updated_at DESC";
        let rows = sqlx::query(sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }

    /// Heartbeats for the same user and item that land in one write-queue batch
    /// coalesce to the one with the newest `updated_at`. That is safe because
    /// each is an idempotent upsert of the latest position and the statement
    /// only accepts a row newer than the stored one, so applying the older
    /// ones first would change nothing. Returns after the write has committed.
    async fn upsert(&self, user_id: Uuid, progress: &WatchProgress) -> Result<(), DbError> {
        let updated_at = progress.updated_at.unwrap_or_else(chrono::Utc::now);
        let user = user_id.to_string();
        let media_file = progress.media_file_id.to_string();
        let position_ms = progress.position_ms as i64;
        let duration_ms = progress.duration_ms as i64;
        let state = state_to_str(progress.state);
        let updated = format_datetime(updated_at);
        let key = format!("watch_progress:{user}:{media_file}");
        write_latest(
            self.queue.as_ref(),
            &self.pool,
            key,
            updated_at.timestamp_millis(),
            move |conn| {
                let (user, media_file, updated) =
                    (user.clone(), media_file.clone(), updated.clone());
                Box::pin(async move {
                    let sql = "INSERT INTO watch_progress \
                         (user_id, media_file_id, position_ms, duration_ms, state, updated_at) \
                         VALUES (?, ?, ?, ?, ?, ?) \
                         ON CONFLICT (user_id, media_file_id) DO UPDATE SET \
                         position_ms = excluded.position_ms, duration_ms = excluded.duration_ms, \
                         state = excluded.state, updated_at = excluded.updated_at \
                         WHERE excluded.updated_at > watch_progress.updated_at";
                    sqlx::query(sql)
                        .bind(user)
                        .bind(media_file)
                        .bind(position_ms)
                        .bind(duration_ms)
                        .bind(state)
                        .bind(updated)
                        .execute(&mut *conn)
                        .await?;
                    Ok(())
                })
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::{PolicyRepo, SqlxPolicyRepo};
    use crate::write_queue::WriteQueueConfig;
    use chrono::{Duration as ChronoDuration, Utc};
    use std::sync::Arc;
    use std::time::Duration;

    struct Seed {
        pool: DbPool,
        path: std::path::PathBuf,
        users: Vec<Uuid>,
        files: Vec<(Uuid, Uuid)>,
    }

    impl Drop for Seed {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", self.path.display()));
            }
        }
    }

    /// A migrated file database (production pragmas) with `users` users and
    /// `files` media files, since progress rows reference both.
    async fn seed(users: usize, files: usize) -> Seed {
        let path = std::env::temp_dir().join(format!("playarr-wp-{}.db", Uuid::new_v4()));
        let pool = crate::pool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        crate::pool::run_migrations(&pool).await.unwrap();
        let policy = playarr_model::Policy {
            id: Uuid::new_v4(),
            name: "Default".to_string(),
            library_allow: vec![],
            group_library_allow: vec![],
            blocked_folders: vec![],
            max_rating: None,
            blocked_tags: vec![],
            allowed_tags: vec![],
            can_transcode: true,
            can_download: false,
            can_delete: false,
            can_share_public: false,
            can_request: false,
            device_allow: vec![],
            max_concurrent_sessions: None,
            household: Default::default(),
            access_schedule: None,
            can_stream: true,
            is_admin: false,
        };
        SqlxPolicyRepo::new(pool.clone())
            .upsert(&policy)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let source_instance = Uuid::new_v4();
        let mut user_ids = Vec::new();
        for i in 0..users {
            let id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO users (id, username, display_name, password_hash, policy_id, created_at, disabled) \
                 VALUES (?, ?, 'User', 'x', ?, '2024-01-01T00:00:00.000Z', 0)",
            )
            .bind(id.to_string())
            .bind(format!("user{i}"))
            .bind(policy.id.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
            user_ids.push(id);
        }
        let mut file_ids = Vec::new();
        for i in 0..files {
            let work = Uuid::new_v4();
            let file = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO works (id, kind, title, sort_title, added_at, availability) \
                 VALUES (?, 'movie', 'Test Work', 'Test Work', '2024-01-01T00:00:00.000Z', 'available')",
            )
            .bind(work.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO media_files (id, work_id, leaf_ref, path, container, codec, size_bytes, source_instance_id, source_file_id) \
                 VALUES (?, ?, 'work', ?, 'mkv', 'h264', 1, ?, ?)",
            )
            .bind(file.to_string())
            .bind(work.to_string())
            .bind(format!("/data/{i}.mkv"))
            .bind(source_instance.to_string())
            .bind(format!("f{i}"))
            .execute(&mut *tx)
            .await
            .unwrap();
            file_ids.push((file, work));
        }
        tx.commit().await.unwrap();
        Seed {
            pool,
            path,
            users: user_ids,
            files: file_ids,
        }
    }

    fn heartbeat(file: (Uuid, Uuid), position_ms: u64, at: chrono::DateTime<Utc>) -> WatchProgress {
        WatchProgress {
            media_file_id: file.0,
            work_id: file.1,
            position_ms,
            duration_ms: 7_200_000,
            state: WatchState::PartWatched,
            updated_at: Some(at),
        }
    }

    fn queue_for(seed: &Seed) -> WriteQueue {
        WriteQueue::spawn(
            seed.pool.clone(),
            WriteQueueConfig {
                max_wait: Duration::from_millis(300),
                ..WriteQueueConfig::default()
            },
        )
    }

    #[tokio::test]
    async fn queued_upsert_is_stored_before_it_returns() {
        let seed = seed(1, 1).await;
        let queue = queue_for(&seed);
        let repo = SqlxWatchProgressRepo::new(seed.pool.clone()).with_write_queue(queue.clone());
        let at = Utc::now();
        repo.upsert(seed.users[0], &heartbeat(seed.files[0], 5_000, at))
            .await
            .unwrap();
        // A repository without the queue reads it straight away.
        let plain = SqlxWatchProgressRepo::new(seed.pool.clone());
        let stored = plain
            .get(seed.users[0], seed.files[0].0)
            .await
            .unwrap()
            .expect("committed before the call returned");
        assert_eq!(stored.position_ms, 5_000);
        queue.shutdown().await;
    }

    /// Heartbeats for one user and item that share a batch collapse to the
    /// newest position; other users' rows in the same batch are untouched, and
    /// every caller succeeds.
    #[tokio::test]
    async fn heartbeats_for_one_item_in_a_batch_coalesce_to_the_newest() {
        let seed = seed(2, 1).await;
        let queue = queue_for(&seed);
        let repo =
            Arc::new(SqlxWatchProgressRepo::new(seed.pool.clone()).with_write_queue(queue.clone()));
        let start = Utc::now();
        let file = seed.files[0];
        // Submitted out of order on purpose: arrival order is not time order.
        let order = [3_i64, 9, 1, 7];
        let mut calls = Vec::new();
        for seconds in order {
            let repo = repo.clone();
            let user = seed.users[0];
            let progress = heartbeat(
                file,
                seconds as u64 * 1_000,
                start + ChronoDuration::seconds(seconds),
            );
            calls.push(tokio::spawn(
                async move { repo.upsert(user, &progress).await },
            ));
        }
        let other = heartbeat(file, 42_000, start + ChronoDuration::seconds(2));
        let other_user = seed.users[1];
        let other_repo = repo.clone();
        calls.push(tokio::spawn(async move {
            other_repo.upsert(other_user, &other).await
        }));
        for call in calls {
            call.await.unwrap().unwrap();
        }
        let first = repo.get(seed.users[0], file.0).await.unwrap().unwrap();
        assert_eq!(first.position_ms, 9_000, "the newest heartbeat wins");
        let second = repo.get(seed.users[1], file.0).await.unwrap().unwrap();
        assert_eq!(second.position_ms, 42_000);
        let stats = queue.stats();
        assert_eq!(stats.coalesced, 3);
        assert_eq!(stats.batches, 1);
        queue.shutdown().await;
    }

    #[tokio::test]
    async fn an_older_heartbeat_never_overwrites_a_newer_stored_position() {
        let seed = seed(1, 1).await;
        let queue = queue_for(&seed);
        let repo = SqlxWatchProgressRepo::new(seed.pool.clone()).with_write_queue(queue.clone());
        let now = Utc::now();
        let file = seed.files[0];
        repo.upsert(seed.users[0], &heartbeat(file, 20_000, now))
            .await
            .unwrap();
        repo.upsert(
            seed.users[0],
            &heartbeat(file, 10_000, now - ChronoDuration::seconds(5)),
        )
        .await
        .unwrap();
        let stored = repo.get(seed.users[0], file.0).await.unwrap().unwrap();
        assert_eq!(stored.position_ms, 20_000);
        queue.shutdown().await;
    }

    /// Evidence for the queue (run with `--ignored --nocapture`): 500 progress
    /// heartbeats from 25 users over 20 files, written one commit each versus
    /// through the shared queue, on a file database with the production pragmas.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn bench_500_heartbeats_direct_versus_queued() {
        let seed = seed(25, 20).await;
        let now = Utc::now();
        let direct = SqlxWatchProgressRepo::new(seed.pool.clone());
        let t = std::time::Instant::now();
        for (u, user) in seed.users.iter().enumerate() {
            for (f, file) in seed.files.iter().enumerate() {
                let p = heartbeat(*file, (u * 100 + f) as u64, now);
                direct.upsert(*user, &p).await.unwrap();
            }
        }
        let direct_elapsed = t.elapsed();

        let queue = WriteQueue::spawn(seed.pool.clone(), WriteQueueConfig::default());
        let repo =
            Arc::new(SqlxWatchProgressRepo::new(seed.pool.clone()).with_write_queue(queue.clone()));
        let later = now + ChronoDuration::seconds(10);
        let t = std::time::Instant::now();
        let mut tasks = Vec::new();
        for (u, user) in seed.users.iter().enumerate() {
            for (f, file) in seed.files.iter().enumerate() {
                let repo = repo.clone();
                let (user, file) = (*user, *file);
                tasks.push(tokio::spawn(async move {
                    let started = std::time::Instant::now();
                    repo.upsert(user, &heartbeat(file, (u * 100 + f + 1) as u64, later))
                        .await
                        .unwrap();
                    started.elapsed()
                }));
            }
        }
        let mut latencies = Vec::new();
        for task in tasks {
            latencies.push(task.await.unwrap());
        }
        let queued_elapsed = t.elapsed();
        latencies.sort();
        let stats = queue.stats();
        println!(
            "500 heartbeats: one commit each {direct_elapsed:?} (500 commits); queued {queued_elapsed:?} \
             in {} commits (max batch {}, avg commit {} ms); per-heartbeat latency p50 {:?} p99 {:?}",
            stats.batches,
            stats.max_batch,
            stats.commit_micros_total / stats.batches.max(1) / 1000,
            latencies[250],
            latencies[495],
        );
        queue.shutdown().await;
    }
}
