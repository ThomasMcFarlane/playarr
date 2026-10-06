//! Storage for smart Start/Resume answers -- see `playarr_model::resume`.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::{ResumeDismissal, ResumeDismissalKind};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::DbPool;

#[async_trait]
pub trait ResumeDismissalRepo: Send + Sync {
    async fn list_for_series(
        &self,
        user_id: Uuid,
        series_work_id: Uuid,
    ) -> Result<Vec<ResumeDismissal>, DbError>;

    /// Every answer of the viewer, with the series it belongs to.
    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<(Uuid, ResumeDismissal)>, DbError>;

    /// Idempotent: re-recording the same answer refreshes its timestamp.
    async fn record(
        &self,
        user_id: Uuid,
        series_work_id: Uuid,
        kind: ResumeDismissalKind,
        episode_id: Uuid,
        at: DateTime<Utc>,
    ) -> Result<(), DbError>;

    /// Forget every answer for one series; returns how many were removed.
    async fn clear_for_series(&self, user_id: Uuid, series_work_id: Uuid) -> Result<u64, DbError>;
}

pub struct SqlxResumeDismissalRepo {
    pool: DbPool,
}

fn kind_to_str(kind: ResumeDismissalKind) -> &'static str {
    match kind {
        ResumeDismissalKind::MissedEpisode => "missed_episode",
        ResumeDismissalKind::RewatchContinueLast => "rewatch_continue_last",
        ResumeDismissalKind::RewatchContinueSeries => "rewatch_continue_series",
    }
}

impl SqlxResumeDismissalRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    fn from_row(row: &AnyRow) -> Result<(Uuid, ResumeDismissal), DbError> {
        let series: String = row.try_get("series_work_id")?;
        let episode: String = row.try_get("episode_id")?;
        let kind: String = row.try_get("kind")?;
        let created: String = row.try_get("created_at")?;
        let kind = match kind.as_str() {
            "missed_episode" => ResumeDismissalKind::MissedEpisode,
            "rewatch_continue_last" => ResumeDismissalKind::RewatchContinueLast,
            "rewatch_continue_series" => ResumeDismissalKind::RewatchContinueSeries,
            other => return Err(decode_err(format!("unknown resume dismissal kind {other}"))),
        };
        Ok((
            parse_uuid(&series)?,
            ResumeDismissal {
                kind,
                episode_id: parse_uuid(&episode)?,
                created_at: parse_datetime(&created)?,
            },
        ))
    }
}

const COLS: &str = "series_work_id, episode_id, kind, created_at";

#[async_trait]
impl ResumeDismissalRepo for SqlxResumeDismissalRepo {
    async fn list_for_series(
        &self,
        user_id: Uuid,
        series_work_id: Uuid,
    ) -> Result<Vec<ResumeDismissal>, DbError> {
        let sql = format!(
            "SELECT {COLS} FROM resume_dismissals WHERE user_id = ? AND series_work_id = ? \
                 ORDER BY created_at, episode_id"
        );
        let rows = sqlx::query(&sql)
            .bind(user_id.to_string())
            .bind(series_work_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|r| Self::from_row(r).map(|(_, d)| d))
            .collect()
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<(Uuid, ResumeDismissal)>, DbError> {
        let sql = format!(
                "SELECT {COLS} FROM resume_dismissals WHERE user_id = ? ORDER BY created_at, episode_id"
            );
        let rows = sqlx::query(&sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn record(
        &self,
        user_id: Uuid,
        series_work_id: Uuid,
        kind: ResumeDismissalKind,
        episode_id: Uuid,
        at: DateTime<Utc>,
    ) -> Result<(), DbError> {
        let sql = "INSERT INTO resume_dismissals (user_id, series_work_id, episode_id, kind, created_at) \
                 VALUES (?, ?, ?, ?, ?) \
                 ON CONFLICT (user_id, episode_id, kind) DO UPDATE SET \
                 created_at = excluded.created_at, series_work_id = excluded.series_work_id";
        sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(series_work_id.to_string())
            .bind(episode_id.to_string())
            .bind(kind_to_str(kind))
            .bind(format_datetime(at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn clear_for_series(&self, user_id: Uuid, series_work_id: Uuid) -> Result<u64, DbError> {
        let sql = "DELETE FROM resume_dismissals WHERE user_id = ? AND series_work_id = ?";
        let res = sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(series_work_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use chrono::SubsecRound;

    use super::*;
    use crate::pool::test_sqlite_pool;

    async fn seed_user(pool: &DbPool) -> Uuid {
        let policy_id = Uuid::new_v4();
        sqlx::query("INSERT INTO policies (id, name) VALUES (?, 'Test Policy')")
            .bind(policy_id.to_string())
            .execute(pool)
            .await
            .unwrap();
        let user_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users (id, username, display_name, password_hash, policy_id, created_at) \
             VALUES (?, ?, 'Test User', 'fakehash', ?, '2024-01-01T00:00:00.000Z')",
        )
        .bind(user_id.to_string())
        .bind(format!("test-{user_id}"))
        .bind(policy_id.to_string())
        .execute(pool)
        .await
        .unwrap();
        user_id
    }

    async fn seed_work(pool: &DbPool) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, availability) \
             VALUES (?, 'series', 'S', 's', '2024-01-01T00:00:00.000Z', 'available')",
        )
        .bind(id.to_string())
        .execute(pool)
        .await
        .unwrap();
        id
    }

    #[tokio::test]
    async fn record_list_clear_round_trip_scoped_per_user_and_series() {
        let pool = test_sqlite_pool().await;
        let (u1, u2) = (seed_user(&pool).await, seed_user(&pool).await);
        let (w1, w2) = (seed_work(&pool).await, seed_work(&pool).await);
        let repo = SqlxResumeDismissalRepo::new(pool);
        let (e1, e2) = (Uuid::new_v4(), Uuid::new_v4());
        let at = Utc::now().trunc_subsecs(3);
        repo.record(u1, w1, ResumeDismissalKind::MissedEpisode, e1, at)
            .await
            .unwrap();
        repo.record(u1, w1, ResumeDismissalKind::RewatchContinueSeries, e2, at)
            .await
            .unwrap();
        repo.record(
            u1,
            w2,
            ResumeDismissalKind::MissedEpisode,
            Uuid::new_v4(),
            at,
        )
        .await
        .unwrap();
        repo.record(
            u2,
            w1,
            ResumeDismissalKind::MissedEpisode,
            Uuid::new_v4(),
            at,
        )
        .await
        .unwrap();
        let listed = repo.list_for_series(u1, w1).await.unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed
            .iter()
            .any(|d| d.episode_id == e1 && d.kind == ResumeDismissalKind::MissedEpisode));
        assert_eq!(repo.list_for_user(u1).await.unwrap().len(), 3);
        assert_eq!(repo.clear_for_series(u1, w1).await.unwrap(), 2);
        assert!(repo.list_for_series(u1, w1).await.unwrap().is_empty());
        assert_eq!(repo.list_for_series(u1, w2).await.unwrap().len(), 1);
        assert_eq!(repo.list_for_series(u2, w1).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn recording_twice_refreshes_the_timestamp_without_duplicating() {
        let pool = test_sqlite_pool().await;
        let user = seed_user(&pool).await;
        let work = seed_work(&pool).await;
        let repo = SqlxResumeDismissalRepo::new(pool);
        let ep = Uuid::new_v4();
        let first = Utc::now().trunc_subsecs(3);
        let later = first + chrono::Duration::seconds(60);
        for at in [first, later] {
            repo.record(user, work, ResumeDismissalKind::MissedEpisode, ep, at)
                .await
                .unwrap();
        }
        let listed = repo.list_for_series(user, work).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].created_at, later);
    }
}
