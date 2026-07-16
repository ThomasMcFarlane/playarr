use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::{WatchProgress, WatchState};
use uuid::Uuid;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

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
    backend: Backend,
}

impl SqlxWatchProgressRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
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
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT p.media_file_id, m.work_id, p.position_ms, p.duration_ms, p.state, \
                 p.updated_at FROM watch_progress p \
                 JOIN media_files m ON m.id = p.media_file_id \
                 WHERE p.user_id = ? AND p.media_file_id = ?"
            }
            Backend::Postgres => {
                "SELECT p.media_file_id, m.work_id, p.position_ms, p.duration_ms, p.state, \
                 p.updated_at FROM watch_progress p \
                 JOIN media_files m ON m.id = p.media_file_id \
                 WHERE p.user_id = $1 AND p.media_file_id = $2"
            }
        };
        let row = sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(media_file_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<WatchProgress>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT p.media_file_id, m.work_id, p.position_ms, p.duration_ms, p.state, \
                 p.updated_at FROM watch_progress p \
                 JOIN media_files m ON m.id = p.media_file_id \
                 WHERE p.user_id = ? ORDER BY p.updated_at DESC"
            }
            Backend::Postgres => {
                "SELECT p.media_file_id, m.work_id, p.position_ms, p.duration_ms, p.state, \
                 p.updated_at FROM watch_progress p \
                 JOIN media_files m ON m.id = p.media_file_id \
                 WHERE p.user_id = $1 ORDER BY p.updated_at DESC"
            }
        };
        let rows = sqlx::query(sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn upsert(&self, user_id: Uuid, progress: &WatchProgress) -> Result<(), DbError> {
        let updated_at = progress.updated_at.unwrap_or_else(chrono::Utc::now);
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO watch_progress \
                 (user_id, media_file_id, position_ms, duration_ms, state, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (user_id, media_file_id) DO UPDATE SET \
                 position_ms = excluded.position_ms, duration_ms = excluded.duration_ms, \
                 state = excluded.state, updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO watch_progress \
                 (user_id, media_file_id, position_ms, duration_ms, state, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6) \
                 ON CONFLICT (user_id, media_file_id) DO UPDATE SET \
                 position_ms = EXCLUDED.position_ms, duration_ms = EXCLUDED.duration_ms, \
                 state = EXCLUDED.state, updated_at = EXCLUDED.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(progress.media_file_id.to_string())
            .bind(progress.position_ms as i64)
            .bind(progress.duration_ms as i64)
            .bind(state_to_str(progress.state))
            .bind(format_datetime(updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
