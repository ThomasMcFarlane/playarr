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

    /// [`Self::list_for`] for many `(provider, external id)` pairs, keyed by
    /// the pair; pairs with no events are absent. The default asks one by
    /// one; the SQL repo answers in a few queries.
    async fn list_for_many(
        &self,
        refs: &[(String, String)],
    ) -> Result<std::collections::HashMap<(String, String), Vec<AvailabilityEvent>>, DbError> {
        let mut out = std::collections::HashMap::new();
        for (provider, external_id) in refs {
            let events = self.list_for(provider, external_id).await?;
            if !events.is_empty() {
                out.insert((provider.clone(), external_id.clone()), events);
            }
        }
        Ok(out)
    }
}

/// Moves whenever an event is stored, so a cache of statistics computed from
/// the events knows when to drop them.
static EVENT_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// The current counter; read it before reading events.
pub fn availability_event_generation() -> u64 {
    EVENT_GENERATION.load(std::sync::atomic::Ordering::Acquire)
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
        let added = result.rows_affected() > 0;
        if added {
            EVENT_GENERATION.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
        Ok(added)
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
            .map(|row| event_from_row(row, provider, external_id))
            .collect()
    }

    async fn list_for_many(
        &self,
        refs: &[(String, String)],
    ) -> Result<std::collections::HashMap<(String, String), Vec<AvailabilityEvent>>, DbError> {
        let mut out: std::collections::HashMap<(String, String), Vec<AvailabilityEvent>> =
            std::collections::HashMap::new();
        // One query per provider and chunk of ids, on the (provider, external_id) index.
        let mut by_provider: std::collections::BTreeMap<&str, Vec<&str>> = Default::default();
        for (provider, external_id) in refs {
            by_provider.entry(provider).or_default().push(external_id);
        }
        for (provider, ids) in by_provider {
            for chunk in ids.chunks(400) {
                let placeholders = vec!["?"; chunk.len()].join(", ");
                let sql = format!("SELECT external_id, source_instance_id, season_number, episode_number, item_id, event_type, occurred_at, air_at, is_upgrade FROM availability_events WHERE provider = ? AND external_id IN ({placeholders})");
                let mut query = sqlx::query(&sql).bind(provider);
                for id in chunk {
                    query = query.bind(*id);
                }
                for row in query.fetch_all(&self.pool).await? {
                    let external_id: String = row.try_get("external_id")?;
                    let event = event_from_row(&row, provider, &external_id)?;
                    out.entry((provider.to_string(), external_id))
                        .or_default()
                        .push(event);
                }
            }
        }
        Ok(out)
    }
}

fn event_from_row(
    row: &sqlx::any::AnyRow,
    provider: &str,
    external_id: &str,
) -> Result<AvailabilityEvent, DbError> {
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

    #[tokio::test]
    async fn list_for_many_matches_list_for_per_pair() {
        let repo = SqlxAvailabilityEventRepo::new(test_sqlite_pool().await);
        let mut a = event(AvailabilityEventType::Grab);
        a.external_id = "1".into();
        let mut b = event(AvailabilityEventType::Import);
        b.external_id = "2".into();
        let mut c = event(AvailabilityEventType::Import);
        c.external_id = "2".into();
        c.item_id = 8;
        let mut other_provider = event(AvailabilityEventType::Import);
        other_provider.provider = "tmdb".into();
        other_provider.external_id = "1".into();
        for e in [&a, &b, &c, &other_provider] {
            repo.record(e).await.unwrap();
        }
        let pairs: Vec<(String, String)> = vec![
            ("tvdb".into(), "1".into()),
            ("tvdb".into(), "2".into()),
            ("tvdb".into(), "3".into()),
            ("tmdb".into(), "1".into()),
        ];
        let many = repo.list_for_many(&pairs).await.unwrap();
        assert_eq!(many.len(), 3, "a pair without events is absent");
        for (provider, id) in &pairs {
            let single = repo.list_for(provider, id).await.unwrap();
            let batched = many
                .get(&(provider.clone(), id.clone()))
                .cloned()
                .unwrap_or_default();
            assert_eq!(single.len(), batched.len(), "{provider}/{id}");
        }
        assert!(repo.list_for_many(&[]).await.unwrap().is_empty());
    }
}
