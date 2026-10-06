//! Grab and import events behind the availability-lag statistic.

use async_trait::async_trait;
use playarr_model::{AvailabilityEvent, AvailabilityEventType};
use sqlx::Row;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::DbPool;

#[async_trait]
pub trait AvailabilityEventRepo: Send + Sync {
    /// Idempotent: a webhook retry stores nothing. Returns whether a row was added.
    async fn record(&self, event: &AvailabilityEvent) -> Result<bool, DbError>;

    async fn list_for(
        &self,
        provider: &str,
        external_id: &str,
    ) -> Result<Vec<AvailabilityEvent>, DbError>;
}

pub struct SqlxAvailabilityEventRepo {
    pool: DbPool,
}

impl SqlxAvailabilityEventRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

fn type_str(t: AvailabilityEventType) -> &'static str {
    match t {
        AvailabilityEventType::Grab => "grab",
        AvailabilityEventType::Import => "import",
    }
}

#[async_trait]
impl AvailabilityEventRepo for SqlxAvailabilityEventRepo {
    async fn record(&self, e: &AvailabilityEvent) -> Result<bool, DbError> {
        let sql = "INSERT INTO availability_events (source_instance_id, provider, external_id, season_number, episode_number, item_id, event_type, occurred_at, air_at, is_upgrade) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING";
        let result = sqlx::query(sql)
            .bind(e.source_instance_id.to_string())
            .bind(&e.provider)
            .bind(&e.external_id)
            .bind(e.season_number)
            .bind(e.episode_number)
            .bind(e.item_id)
            .bind(type_str(e.event_type))
            .bind(format_datetime(e.occurred_at))
            .bind(e.air_at.map(format_datetime))
            .bind(i64::from(e.is_upgrade))
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_for(
        &self,
        provider: &str,
        external_id: &str,
    ) -> Result<Vec<AvailabilityEvent>, DbError> {
        let sql = "SELECT source_instance_id, season_number, episode_number, item_id, event_type, occurred_at, air_at, is_upgrade FROM availability_events WHERE provider = ? AND external_id = ?";
        let rows = sqlx::query(sql)
            .bind(provider)
            .bind(external_id)
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|row| {
                let source: String = row.try_get("source_instance_id")?;
                let event_type: String = row.try_get("event_type")?;
                let occurred_at: String = row.try_get("occurred_at")?;
                let air_at: Option<String> = row.try_get("air_at")?;
                let is_upgrade: i64 = row.try_get("is_upgrade")?;
                Ok(AvailabilityEvent {
                    source_instance_id: parse_uuid(&source)?,
                    provider: provider.to_string(),
                    external_id: external_id.to_string(),
                    season_number: row.try_get("season_number")?,
                    episode_number: row.try_get("episode_number")?,
                    item_id: row.try_get("item_id")?,
                    event_type: match event_type.as_str() {
                        "grab" => AvailabilityEventType::Grab,
                        "import" => AvailabilityEventType::Import,
                        other => return Err(decode_err(format!("unknown event type {other:?}"))),
                    },
                    occurred_at: parse_datetime(&occurred_at)?,
                    air_at: air_at.as_deref().map(parse_datetime).transpose()?,
                    is_upgrade: is_upgrade != 0,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;
    use chrono::Utc;
    use uuid::Uuid;

    fn event(kind: AvailabilityEventType) -> AvailabilityEvent {
        AvailabilityEvent {
            source_instance_id: Uuid::new_v4(),
            provider: "tvdb".into(),
            external_id: "42".into(),
            season_number: 1,
            episode_number: 2,
            item_id: 7,
            event_type: kind,
            occurred_at: Utc::now(),
            air_at: Some(Utc::now()),
            is_upgrade: false,
        }
    }

    #[tokio::test]
    async fn records_idempotently_and_lists_by_work() {
        let repo = SqlxAvailabilityEventRepo::new(test_sqlite_pool().await);
        let grab = event(AvailabilityEventType::Grab);
        assert!(repo.record(&grab).await.unwrap());
        assert!(!repo.record(&grab).await.unwrap(), "retry stores nothing");
        let mut other = event(AvailabilityEventType::Import);
        other.air_at = None;
        other.is_upgrade = true;
        repo.record(&other).await.unwrap();
        let mut unrelated = event(AvailabilityEventType::Import);
        unrelated.external_id = "99".into();
        repo.record(&unrelated).await.unwrap();

        let listed = repo.list_for("tvdb", "42").await.unwrap();
        assert_eq!(listed.len(), 2);
        let import = listed
            .iter()
            .find(|e| e.event_type == AvailabilityEventType::Import)
            .unwrap();
        assert!(import.air_at.is_none() && import.is_upgrade);
    }
}
