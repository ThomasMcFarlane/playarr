//! Storage for playback analytics: raw session/event write path plus the
//! `stats_daily` rollup, backing the `playback_sessions` / `playback_events`
//! / `stats_daily` tables created by
//! `backend/migrations/{sqlite,postgres}/0002_analytics.sql`.
//!
//! This is a separate module (rather than folding into `crate::repo`)
//! because its write pattern is fundamentally different: analytics writes
//! are high-volume, append-mostly, and tolerant of eventual consistency in
//! a way the catalog/device repositories are not, so it's plausible this
//! ends up on a different pool/connection strategy (e.g. batched inserts)
//! later without disturbing `crate::repo`.

use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::Row;
use streamarr_model::{ClientPlatform, PlaybackEvent, PlaybackSession, StopReason};
use uuid::Uuid;

use crate::codec::{
    decode_err, format_date, format_datetime, parse_date, parse_datetime, play_method_from_str,
    play_method_to_str, playback_event_kind_discriminant, stop_reason_to_str,
    transcode_reason_to_str,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// One row of the `stats_daily` rollup table: playback volume for a single
/// (day, client platform, play method) bucket.
#[derive(Debug, Clone, PartialEq)]
pub struct DailyStat {
    pub day: NaiveDate,
    pub client_platform: String,
    pub play_method: String,
    pub sessions_count: i64,
    pub unique_users_count: i64,
    pub unique_devices_count: i64,
    pub total_playback_seconds: i64,
    pub transcode_sessions_count: i64,
    pub buffering_events_total: i64,
    pub buffering_ms_total: i64,
    pub bytes_streamed_total: i64,
}

/// The write/read boundary for playback analytics. `streamarr-telemetry`'s
/// `analytics::collector` calls the write methods as sessions/events come
/// in off the playback path; `analytics::rollup` calls `rollup_day`
/// periodically (and `analytics::retention` uses `get_daily_stats` plus a
/// prune method to enforce retention windows on the raw tables).
#[async_trait]
pub trait AnalyticsStore: Send + Sync {
    /// Inserts the initial row for a session at playback start. Later
    /// mutations to the same session go through `close_session` rather
    /// than a second `record_session_start` call.
    async fn record_session_start(&self, session: &PlaybackSession) -> Result<(), DbError>;

    async fn record_event(&self, event: &PlaybackEvent) -> Result<(), DbError>;

    /// Finalizes a session: sets `ended_at`/`stop_reason` and whatever
    /// aggregate counters (`bytes_streamed`, `buffering_ms_total`, ...) the
    /// caller has accumulated for it.
    async fn close_session(
        &self,
        session_id: Uuid,
        session: &PlaybackSession,
        stop_reason: StopReason,
    ) -> Result<(), DbError>;

    /// Recomputes `stats_daily` rows for `day` from the raw
    /// `playback_sessions`/`playback_events` tables. Idempotent — safe to
    /// re-run for a day that already has rollup rows (e.g. after a late
    /// session closes).
    async fn rollup_day(&self, day: NaiveDate) -> Result<(), DbError>;

    async fn get_daily_stats(
        &self,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<DailyStat>, DbError>;
}

pub struct SqlxAnalyticsStore {
    pool: DbPool,
    backend: Backend,
}

impl SqlxAnalyticsStore {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

/// Per-`(client_platform, play_method)` accumulator used by `rollup_day`.
/// Aggregation happens in Rust rather than in a single SQL `GROUP BY`
/// because `total_playback_seconds` needs `ended_at - started_at`, and
/// SQLite/Postgres compute date/time differences with entirely different
/// syntax (`julianday(...)` vs. interval subtraction) — doing the diff in
/// Rust keeps the raw-row SELECT (the only part that runs against the
/// database) identical in shape across both backends, at the cost of
/// pulling a day's raw session rows into memory. Revisit with DB-side
/// aggregation if `rollup_day` shows up in profiling at scale.
#[derive(Default)]
struct Bucket {
    sessions: i64,
    users: HashSet<String>,
    devices: HashSet<String>,
    playback_seconds: i64,
    transcode_sessions: i64,
    buffering_events: i64,
    buffering_ms: i64,
    bytes_streamed: i64,
}

#[async_trait]
impl AnalyticsStore for SqlxAnalyticsStore {
    async fn record_session_start(&self, session: &PlaybackSession) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO playback_sessions \
                 (id, user_id, device_id, media_file_id, rendition_id, started_at, ended_at, \
                  play_method, transcode_reason, source_codec, source_container, source_bitrate, \
                  target_codec, target_container, target_bitrate, client_platform, client_version, \
                  ip_address, bytes_streamed, buffering_events, buffering_ms_total, stop_reason) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO playback_sessions \
                 (id, user_id, device_id, media_file_id, rendition_id, started_at, ended_at, \
                  play_method, transcode_reason, source_codec, source_container, source_bitrate, \
                  target_codec, target_container, target_bitrate, client_platform, client_version, \
                  ip_address, bytes_streamed, buffering_events, buffering_ms_total, stop_reason) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, \
                  $17, $18, $19, $20, $21, $22)"
            }
        };
        sqlx::query(sql)
            .bind(session.id.to_string())
            .bind(session.user_id.to_string())
            .bind(session.device_id.to_string())
            .bind(session.media_file_id.to_string())
            .bind(session.rendition_id.map(|id| id.to_string()))
            .bind(format_datetime(session.started_at))
            .bind(session.ended_at.map(format_datetime))
            .bind(play_method_to_str(session.play_method))
            .bind(
                session
                    .transcode_reason
                    .as_ref()
                    .map(transcode_reason_to_str),
            )
            .bind(session.source_codec.as_str())
            .bind(session.source_container.as_str())
            .bind(session.source_bitrate.map(|b| b as i64))
            .bind(session.target_codec.as_str())
            .bind(session.target_container.as_str())
            .bind(session.target_bitrate.map(|b| b as i64))
            .bind(session.client_platform.wire_name())
            .bind(session.client_version.as_str())
            .bind(session.ip_address.as_deref())
            .bind(session.bytes_streamed as i64)
            .bind(session.buffering_events as i64)
            .bind(session.buffering_ms_total as i64)
            .bind(session.stop_reason.as_ref().map(stop_reason_to_str))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn record_event(&self, event: &PlaybackEvent) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO playback_events (id, session_id, occurred_at, kind, payload) \
                 VALUES (?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO playback_events (id, session_id, occurred_at, kind, payload) \
                 VALUES ($1, $2, $3, $4, $5)"
            }
        };
        let payload = serde_json::to_string(&event.kind)?;
        sqlx::query(sql)
            .bind(event.id.to_string())
            .bind(event.session_id.to_string())
            .bind(format_datetime(event.occurred_at))
            .bind(playback_event_kind_discriminant(&event.kind))
            .bind(payload)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn close_session(
        &self,
        session_id: Uuid,
        session: &PlaybackSession,
        stop_reason: StopReason,
    ) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE playback_sessions \
                 SET ended_at = ?, stop_reason = ?, bytes_streamed = ?, buffering_events = ?, \
                 buffering_ms_total = ? WHERE id = ?"
            }
            Backend::Postgres => {
                "UPDATE playback_sessions \
                 SET ended_at = $1, stop_reason = $2, bytes_streamed = $3, buffering_events = $4, \
                 buffering_ms_total = $5 WHERE id = $6"
            }
        };
        // `session.ended_at` should normally already be `Some(..)` by the
        // time a caller closes a session; fall back to "now" rather than
        // erroring so a caller that forgot to set it still gets a
        // consistent, monotonic `ended_at` instead of a `NULL` one.
        let ended_at = session.ended_at.unwrap_or_else(chrono::Utc::now);
        let result = sqlx::query(sql)
            .bind(format_datetime(ended_at))
            .bind(stop_reason_to_str(&stop_reason))
            .bind(session.bytes_streamed as i64)
            .bind(session.buffering_events as i64)
            .bind(session.buffering_ms_total as i64)
            .bind(session_id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    async fn rollup_day(&self, day: NaiveDate) -> Result<(), DbError> {
        let day_str = format_date(day);

        // `substr(col, 1, 10)` pulls the `YYYY-MM-DD` prefix off the
        // ISO-8601 `started_at` TEXT column; `substr` is standard SQL and
        // behaves identically on SQLite and Postgres, so only the
        // placeholder differs here.
        let select_sql = match self.backend {
            Backend::Sqlite => {
                "SELECT user_id, device_id, started_at, ended_at, play_method, client_platform, \
                 buffering_events, buffering_ms_total, bytes_streamed \
                 FROM playback_sessions WHERE substr(started_at, 1, 10) = ?"
            }
            Backend::Postgres => {
                "SELECT user_id, device_id, started_at, ended_at, play_method, client_platform, \
                 buffering_events, buffering_ms_total, bytes_streamed \
                 FROM playback_sessions WHERE substr(started_at, 1, 10) = $1"
            }
        };
        let rows = sqlx::query(select_sql)
            .bind(&day_str)
            .fetch_all(&self.pool)
            .await?;

        let mut buckets: HashMap<(String, String), Bucket> = HashMap::new();
        for row in rows {
            let user_id: String = row.try_get("user_id")?;
            let device_id: String = row.try_get("device_id")?;
            let started_at: String = row.try_get("started_at")?;
            let ended_at: Option<String> = row.try_get("ended_at")?;
            let play_method: String = row.try_get("play_method")?;
            let client_platform: String = row.try_get("client_platform")?;
            let buffering_events: i64 = row.try_get("buffering_events")?;
            let buffering_ms_total: i64 = row.try_get("buffering_ms_total")?;
            let bytes_streamed: i64 = row.try_get("bytes_streamed")?;

            let playback_seconds = match &ended_at {
                Some(ended_at) => {
                    let started = parse_datetime(&started_at)?;
                    let ended = parse_datetime(ended_at)?;
                    (ended - started).num_seconds().max(0)
                }
                // Session hasn't closed yet as of this rollup; it
                // contributes to `sessions_count` but not (yet) to
                // playback-seconds. It'll be counted once a later rollup
                // runs after it closes.
                None => 0,
            };

            // Validate against the codec so a corrupt row fails loudly
            // instead of silently mis-bucketing.
            play_method_from_str(&play_method)?;
            if ClientPlatform::from_wire_name(&client_platform).is_none() {
                return Err(decode_err(format!(
                    "unknown client platform {client_platform:?}"
                )));
            }

            let bucket = buckets
                .entry((client_platform, play_method.clone()))
                .or_default();
            bucket.sessions += 1;
            bucket.users.insert(user_id);
            bucket.devices.insert(device_id);
            bucket.playback_seconds += playback_seconds;
            if play_method == "transcode" {
                bucket.transcode_sessions += 1;
            }
            bucket.buffering_events += buffering_events;
            bucket.buffering_ms += buffering_ms_total;
            bucket.bytes_streamed += bytes_streamed;
        }

        let mut tx = self.pool.begin().await?;

        let delete_sql = match self.backend {
            Backend::Sqlite => "DELETE FROM stats_daily WHERE day = ?",
            Backend::Postgres => "DELETE FROM stats_daily WHERE day = $1",
        };
        sqlx::query(delete_sql)
            .bind(&day_str)
            .execute(&mut *tx)
            .await?;

        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO stats_daily \
                 (day, client_platform, play_method, sessions_count, unique_users_count, \
                  unique_devices_count, total_playback_seconds, transcode_sessions_count, \
                  buffering_events_total, buffering_ms_total, bytes_streamed_total) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO stats_daily \
                 (day, client_platform, play_method, sessions_count, unique_users_count, \
                  unique_devices_count, total_playback_seconds, transcode_sessions_count, \
                  buffering_events_total, buffering_ms_total, bytes_streamed_total) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
            }
        };
        for ((client_platform, play_method), bucket) in buckets {
            sqlx::query(insert_sql)
                .bind(&day_str)
                .bind(client_platform)
                .bind(play_method)
                .bind(bucket.sessions)
                .bind(bucket.users.len() as i64)
                .bind(bucket.devices.len() as i64)
                .bind(bucket.playback_seconds)
                .bind(bucket.transcode_sessions)
                .bind(bucket.buffering_events)
                .bind(bucket.buffering_ms)
                .bind(bucket.bytes_streamed)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    async fn get_daily_stats(
        &self,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<DailyStat>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT day, client_platform, play_method, sessions_count, unique_users_count, \
                 unique_devices_count, total_playback_seconds, transcode_sessions_count, \
                 buffering_events_total, buffering_ms_total, bytes_streamed_total \
                 FROM stats_daily WHERE day BETWEEN ? AND ? \
                 ORDER BY day, client_platform, play_method"
            }
            Backend::Postgres => {
                "SELECT day, client_platform, play_method, sessions_count, unique_users_count, \
                 unique_devices_count, total_playback_seconds, transcode_sessions_count, \
                 buffering_events_total, buffering_ms_total, bytes_streamed_total \
                 FROM stats_daily WHERE day BETWEEN $1 AND $2 \
                 ORDER BY day, client_platform, play_method"
            }
        };
        let rows = sqlx::query(sql)
            .bind(format_date(from))
            .bind(format_date(to))
            .fetch_all(&self.pool)
            .await?;

        rows.into_iter()
            .map(|row| {
                let day: String = row.try_get("day")?;
                Ok(DailyStat {
                    day: parse_date(&day)?,
                    client_platform: row.try_get("client_platform")?,
                    play_method: row.try_get("play_method")?,
                    sessions_count: row.try_get("sessions_count")?,
                    unique_users_count: row.try_get("unique_users_count")?,
                    unique_devices_count: row.try_get("unique_devices_count")?,
                    total_playback_seconds: row.try_get("total_playback_seconds")?,
                    transcode_sessions_count: row.try_get("transcode_sessions_count")?,
                    buffering_events_total: row.try_get("buffering_events_total")?,
                    buffering_ms_total: row.try_get("buffering_ms_total")?,
                    bytes_streamed_total: row.try_get("bytes_streamed_total")?,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use streamarr_model::PlaybackEventKind;

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_session(platform: ClientPlatform) -> PlaybackSession {
        PlaybackSession {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            rendition_id: None,
            started_at: Utc::now(),
            ended_at: None,
            play_method: streamarr_model::PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(8_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(8_000_000),
            client_platform: platform,
            client_version: "1.0.0".to_string(),
            ip_address: Some("127.0.0.1".to_string()),
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        }
    }

    #[tokio::test]
    async fn record_event_persists_row() {
        let pool = test_sqlite_pool().await;
        let store = SqlxAnalyticsStore::new(pool);
        let session = sample_session(ClientPlatform::Web);
        store.record_session_start(&session).await.unwrap();

        let event = PlaybackEvent {
            id: Uuid::new_v4(),
            session_id: session.id,
            occurred_at: Utc::now(),
            kind: PlaybackEventKind::Seek {
                from_ms: 1_000,
                to_ms: 5_000,
            },
        };
        store.record_event(&event).await.unwrap();

        // No read method is exposed on the trait for raw events (by
        // design — see the module doc); assert directly against the pool
        // to confirm the write actually landed.
        let row = sqlx::query("SELECT kind, payload FROM playback_events WHERE id = ?")
            .bind(event.id.to_string())
            .fetch_one(&store.pool)
            .await
            .unwrap();
        let kind: String = row.try_get("kind").unwrap();
        let payload: String = row.try_get("payload").unwrap();
        assert_eq!(kind, "seek");
        let decoded: PlaybackEventKind = serde_json::from_str(&payload).unwrap();
        assert_eq!(decoded, event.kind);
    }

    #[tokio::test]
    async fn close_session_updates_row_and_errors_on_missing() {
        let pool = test_sqlite_pool().await;
        let store = SqlxAnalyticsStore::new(pool);
        let mut session = sample_session(ClientPlatform::AndroidTv);
        store.record_session_start(&session).await.unwrap();

        session.ended_at = Some(Utc::now());
        session.bytes_streamed = 1_234;
        session.buffering_events = 2;
        session.buffering_ms_total = 500;
        store
            .close_session(session.id, &session, StopReason::Completed)
            .await
            .unwrap();

        let row =
            sqlx::query("SELECT stop_reason, bytes_streamed FROM playback_sessions WHERE id = ?")
                .bind(session.id.to_string())
                .fetch_one(&store.pool)
                .await
                .unwrap();
        let stop_reason: Option<String> = row.try_get("stop_reason").unwrap();
        assert_eq!(stop_reason.as_deref(), Some("completed"));
        let bytes_streamed: i64 = row.try_get("bytes_streamed").unwrap();
        assert_eq!(bytes_streamed, 1_234);

        let err = store
            .close_session(Uuid::new_v4(), &session, StopReason::Completed)
            .await
            .unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn rollup_day_and_get_daily_stats_aggregate_correctly() {
        let pool = test_sqlite_pool().await;
        let store = SqlxAnalyticsStore::new(pool);
        let day = Utc::now().date_naive();

        // Two DirectPlay/Web sessions from different users, one Transcode
        // session from AndroidTv.
        let mut web_1 = sample_session(ClientPlatform::Web);
        web_1.started_at = day.and_hms_opt(10, 0, 0).unwrap().and_utc();
        web_1.ended_at = Some(day.and_hms_opt(10, 10, 0).unwrap().and_utc());
        web_1.buffering_events = 1;
        web_1.buffering_ms_total = 200;
        web_1.bytes_streamed = 1_000;

        let mut web_2 = sample_session(ClientPlatform::Web);
        web_2.started_at = day.and_hms_opt(11, 0, 0).unwrap().and_utc();
        web_2.ended_at = Some(day.and_hms_opt(11, 5, 0).unwrap().and_utc());
        web_2.bytes_streamed = 2_000;

        let mut tv = sample_session(ClientPlatform::AndroidTv);
        tv.play_method = streamarr_model::PlayMethod::Transcode;
        tv.started_at = day.and_hms_opt(12, 0, 0).unwrap().and_utc();
        tv.ended_at = Some(day.and_hms_opt(12, 2, 0).unwrap().and_utc());
        tv.bytes_streamed = 500;

        for s in [&web_1, &web_2, &tv] {
            store.record_session_start(s).await.unwrap();
        }

        store.rollup_day(day).await.unwrap();
        // Idempotency: re-running for the same day must not double-count.
        store.rollup_day(day).await.unwrap();

        let stats = store.get_daily_stats(day, day).await.unwrap();
        assert_eq!(stats.len(), 2);

        let web_stat = stats
            .iter()
            .find(|s| s.client_platform == "web")
            .expect("web bucket present");
        assert_eq!(web_stat.sessions_count, 2);
        assert_eq!(web_stat.unique_users_count, 2);
        assert_eq!(web_stat.unique_devices_count, 2);
        assert_eq!(web_stat.total_playback_seconds, 600 + 300);
        assert_eq!(web_stat.transcode_sessions_count, 0);
        assert_eq!(web_stat.buffering_events_total, 1);
        assert_eq!(web_stat.buffering_ms_total, 200);
        assert_eq!(web_stat.bytes_streamed_total, 3_000);

        let tv_stat = stats
            .iter()
            .find(|s| s.client_platform == "android-tv")
            .expect("android-tv bucket present");
        assert_eq!(tv_stat.sessions_count, 1);
        assert_eq!(tv_stat.transcode_sessions_count, 1);
        assert_eq!(tv_stat.total_playback_seconds, 120);
    }

    #[tokio::test]
    async fn get_daily_stats_filters_by_range() {
        let pool = test_sqlite_pool().await;
        let store = SqlxAnalyticsStore::new(pool);
        let day = Utc::now().date_naive();
        let earlier = day - chrono::Duration::days(3);

        let mut session = sample_session(ClientPlatform::Ios);
        session.started_at = earlier.and_hms_opt(9, 0, 0).unwrap().and_utc();
        session.ended_at = Some(earlier.and_hms_opt(9, 1, 0).unwrap().and_utc());
        store.record_session_start(&session).await.unwrap();
        store.rollup_day(earlier).await.unwrap();

        let in_range = store.get_daily_stats(earlier, earlier).await.unwrap();
        assert_eq!(in_range.len(), 1);

        let out_of_range = store.get_daily_stats(day, day).await.unwrap();
        assert!(out_of_range.is_empty());
    }
}
