//! Persistence for the calendar's per-source cache: the last good entries per
//! instance and month (opaque JSON, owned by the API layer) and refresh health.

use chrono::{DateTime, Utc};
use sqlx::Row;

use crate::codec::{format_datetime, parse_datetime};
use crate::error::DbError;
use crate::pool::DbPool;
use crate::write_queue::{write_latest, WriteQueue};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredChunk {
    pub instance_id: String,
    pub month: String,
    pub fetched_at: DateTime<Utc>,
    pub entries_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StoredHealth {
    pub instance_id: String,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_attempt_at: Option<DateTime<Utc>>,
    pub last_error_state: Option<String>,
    pub last_error_message: Option<String>,
    pub consecutive_failures: u32,
}

#[derive(Clone)]
pub struct SqlxCalendarSourceCacheRepo {
    pool: DbPool,
    queue: Option<WriteQueue>,
}

impl SqlxCalendarSourceCacheRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool, queue: None }
    }

    /// Sends `put_chunk` and `put_health` through the shared write queue.
    pub fn with_write_queue(mut self, queue: WriteQueue) -> Self {
        self.queue = Some(queue);
        self
    }

    /// Latest fetch wins for one instance and month within a write-queue batch.
    pub async fn put_chunk(&self, chunk: &StoredChunk) -> Result<(), DbError> {
        let chunk_value = chunk.clone();
        write_latest(
            self.queue.as_ref(),
            &self.pool,
            format!("calendar_chunk:{}:{}", chunk.instance_id, chunk.month),
            chunk.fetched_at.timestamp_millis(),
            move |conn| {
                let chunk = chunk_value.clone();
                Box::pin(async move {
                    sqlx::query(
                        "INSERT INTO calendar_source_chunks (instance_id, month, fetched_at, entries_json) \
                         VALUES (?, ?, ?, ?) \
                         ON CONFLICT(instance_id, month) DO UPDATE SET \
                         fetched_at = excluded.fetched_at, entries_json = excluded.entries_json",
                    )
                    .bind(chunk.instance_id)
                    .bind(chunk.month)
                    .bind(format_datetime(chunk.fetched_at))
                    .bind(chunk.entries_json)
                    .execute(&mut *conn)
                    .await?;
                    Ok(())
                })
            },
        )
        .await
    }

    pub async fn all_chunks(&self) -> Result<Vec<StoredChunk>, DbError> {
        let rows = sqlx::query(
            "SELECT instance_id, month, fetched_at, entries_json FROM calendar_source_chunks",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let fetched_at: String = row.try_get("fetched_at")?;
                Ok(StoredChunk {
                    instance_id: row.try_get("instance_id")?,
                    month: row.try_get("month")?,
                    fetched_at: parse_datetime(&fetched_at)?,
                    entries_json: row.try_get("entries_json")?,
                })
            })
            .collect()
    }

    /// Drops chunks of months before `oldest_month` and of instances not in `keep`.
    pub async fn prune(&self, oldest_month: &str, keep: &[String]) -> Result<(), DbError> {
        // The refresher calls this every pass (every 15 s) and there is almost
        // never anything to drop; a DELETE that matches nothing still takes the
        // write lock, so look first.
        let has_old: i64 = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM calendar_source_chunks WHERE month < ?)",
        )
        .bind(oldest_month)
        .fetch_one(&self.pool)
        .await?;
        if has_old != 0 {
            sqlx::query("DELETE FROM calendar_source_chunks WHERE month < ?")
                .bind(oldest_month)
                .execute(&self.pool)
                .await?;
        }
        for table in ["calendar_source_chunks", "calendar_source_health"] {
            let existing: Vec<String> =
                sqlx::query_scalar(&format!("SELECT DISTINCT instance_id FROM {table}"))
                    .fetch_all(&self.pool)
                    .await?;
            for id in existing.into_iter().filter(|id| !keep.contains(id)) {
                sqlx::query(&format!("DELETE FROM {table} WHERE instance_id = ?"))
                    .bind(id)
                    .execute(&self.pool)
                    .await?;
            }
        }
        Ok(())
    }

    /// Latest attempt wins for one instance within a write-queue batch.
    pub async fn put_health(&self, health: &StoredHealth) -> Result<(), DbError> {
        let health_value = health.clone();
        let rank = health.last_attempt_at.map_or(0, |at| at.timestamp_millis());
        write_latest(
            self.queue.as_ref(),
            &self.pool,
            format!("calendar_health:{}", health.instance_id),
            rank,
            move |conn| {
                let health = health_value.clone();
                Box::pin(async move {
                    sqlx::query(
                        "INSERT INTO calendar_source_health (instance_id, last_success_at, last_attempt_at, \
                         last_error_state, last_error_message, consecutive_failures) VALUES (?, ?, ?, ?, ?, ?) \
                         ON CONFLICT(instance_id) DO UPDATE SET last_success_at = excluded.last_success_at, \
                         last_attempt_at = excluded.last_attempt_at, last_error_state = excluded.last_error_state, \
                         last_error_message = excluded.last_error_message, \
                         consecutive_failures = excluded.consecutive_failures",
                    )
                    .bind(health.instance_id)
                    .bind(health.last_success_at.map(format_datetime))
                    .bind(health.last_attempt_at.map(format_datetime))
                    .bind(health.last_error_state)
                    .bind(health.last_error_message)
                    .bind(i64::from(health.consecutive_failures))
                    .execute(&mut *conn)
                    .await?;
                    Ok(())
                })
            },
        )
        .await
    }

    pub async fn all_health(&self) -> Result<Vec<StoredHealth>, DbError> {
        let rows = sqlx::query(
            "SELECT instance_id, last_success_at, last_attempt_at, last_error_state, \
             last_error_message, consecutive_failures FROM calendar_source_health",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let success: Option<String> = row.try_get("last_success_at")?;
                let attempt: Option<String> = row.try_get("last_attempt_at")?;
                let failures: i64 = row.try_get("consecutive_failures")?;
                Ok(StoredHealth {
                    instance_id: row.try_get("instance_id")?,
                    last_success_at: success.as_deref().map(parse_datetime).transpose()?,
                    last_attempt_at: attempt.as_deref().map(parse_datetime).transpose()?,
                    last_error_state: row.try_get("last_error_state")?,
                    last_error_message: row.try_get("last_error_message")?,
                    consecutive_failures: failures.max(0) as u32,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;

    #[tokio::test]
    async fn chunks_and_health_round_trip_and_prune() {
        let repo = SqlxCalendarSourceCacheRepo::new(test_sqlite_pool().await);
        let now = Utc::now();
        for (id, month) in [("a", "2026-01"), ("a", "2026-10"), ("gone", "2026-10")] {
            repo.put_chunk(&StoredChunk {
                instance_id: id.into(),
                month: month.into(),
                fetched_at: now,
                entries_json: "[]".into(),
            })
            .await
            .unwrap();
        }
        repo.put_health(&StoredHealth {
            instance_id: "gone".into(),
            consecutive_failures: 3,
            last_error_message: Some("timed out".into()),
            ..Default::default()
        })
        .await
        .unwrap();
        assert_eq!(repo.all_chunks().await.unwrap().len(), 3);
        repo.prune("2026-07", &["a".to_string()]).await.unwrap();
        let left = repo.all_chunks().await.unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].month, "2026-10");
        assert!(repo.all_health().await.unwrap().is_empty());
        // A pass with nothing to drop leaves everything as it was.
        repo.prune("2026-07", &["a".to_string()]).await.unwrap();
        assert_eq!(repo.all_chunks().await.unwrap().len(), 1);
    }
}
