//! Storage for playback analytics: raw session/event write path plus the
//! `stats_daily` rollup, backing the `playback_sessions` / `playback_events`
//! / `stats_daily` tables created by
//! `backend/migrations/sqlite/0002_analytics.sql`.
//!
//! This is a separate module (rather than folding into `crate::repo`)
//! because its write pattern is fundamentally different: analytics writes
//! are high-volume, append-mostly, and tolerant of eventual consistency in
//! a way the catalog/device repositories are not, so it's plausible this
//! ends up on a different pool/connection strategy (e.g. batched inserts)
//! later without disturbing `crate::repo`.

use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use playarr_model::{ClientPlatform, PlayMethod, PlaybackEvent, PlaybackSession, StopReason};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    decode_err, format_date, format_datetime, parse_date, parse_datetime, parse_uuid,
    play_method_from_str, play_method_to_str, playback_event_kind_discriminant,
    stop_reason_from_str, stop_reason_to_str, transcode_reason_from_str, transcode_reason_to_str,
};
use crate::error::DbError;
use crate::pool::DbPool;

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

/// The write/read boundary for playback analytics. `playarr-telemetry`'s
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

    /// Writes a batch of events in one transaction wrapping N of the same
    /// per-row inserts [`AnalyticsStore::record_event`] uses — cuts DB
    /// round-trips for [`playarr_telemetry`]'s `AnalyticsFlusher`, which
    /// coalesces the high-frequency, low-importance event kinds
    /// (heartbeat/pause/resume/seek/buffer/bitrate-change) rather than
    /// writing each one synchronously. A no-op (not an error) for an empty
    /// slice.
    async fn record_events_batch(&self, events: &[PlaybackEvent]) -> Result<(), DbError>;

    /// Filtered, paginated read of raw `playback_sessions` rows, newest
    /// first — backs the admin session-history endpoint. Unlike every
    /// other method on this trait, this one reads a full [`PlaybackSession`]
    /// back out, hence the `_from_str` decode counterparts in `crate::codec`
    /// this needed (`transcode_reason_from_str`/`stop_reason_from_str`).
    async fn list_sessions(&self, filter: &SessionFilter) -> Result<Vec<PlaybackSession>, DbError>;
}

/// Filter/pagination parameters for [`AnalyticsStore::list_sessions`].
#[derive(Debug, Clone, Default)]
pub struct SessionFilter {
    pub user_ids: Vec<Uuid>,
    pub play_methods: Vec<PlayMethod>,
    pub stop_reasons: Vec<SessionStopReasonFilter>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub min_bytes_streamed: Option<i64>,
    pub max_bytes_streamed: Option<i64>,
    pub limit: i64,
    pub offset: i64,
}

/// Storage-level stop-reason facets for [`SessionFilter`]. The two synthetic
/// variants represent groups of durable values rather than one
/// [`StopReason`]: `InProgress` is a `NULL` stop reason, while `Other`
/// matches every `other:<label>` value written by `stop_reason_to_str`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStopReasonFilter {
    Completed,
    UserStopped,
    Error,
    DeviceDisconnected,
    SessionRevoked,
    ConcurrentLimitExceeded,
    IdleTimeout,
    Other,
    InProgress,
}

impl SessionStopReasonFilter {
    fn stored_value(self) -> Option<&'static str> {
        match self {
            Self::Completed => Some("completed"),
            Self::UserStopped => Some("user_stopped"),
            Self::Error => Some("error"),
            Self::DeviceDisconnected => Some("device_disconnected"),
            Self::SessionRevoked => Some("session_revoked"),
            Self::ConcurrentLimitExceeded => Some("concurrent_limit_exceeded"),
            Self::IdleTimeout => Some("idle_timeout"),
            Self::Other | Self::InProgress => None,
        }
    }
}

pub struct SqlxAnalyticsStore {
    pool: DbPool,
}

impl SqlxAnalyticsStore {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    const SESSION_COLUMNS: &'static str = "id, user_id, device_id, media_file_id, rendition_id, \
         started_at, ended_at, play_method, transcode_reason, source_codec, source_container, \
         source_bitrate, target_codec, target_container, target_bitrate, client_platform, \
         client_version, ip_address, bytes_streamed, buffering_events, buffering_ms_total, \
         stop_reason";

    fn session_from_row(row: &AnyRow) -> Result<PlaybackSession, DbError> {
        let id: String = row.try_get("id")?;
        let user_id: String = row.try_get("user_id")?;
        let device_id: String = row.try_get("device_id")?;
        let media_file_id: String = row.try_get("media_file_id")?;
        let rendition_id: Option<String> = row.try_get("rendition_id")?;
        let started_at: String = row.try_get("started_at")?;
        let ended_at: Option<String> = row.try_get("ended_at")?;
        let play_method: String = row.try_get("play_method")?;
        let transcode_reason: Option<String> = row.try_get("transcode_reason")?;
        let source_codec: String = row.try_get("source_codec")?;
        let source_container: String = row.try_get("source_container")?;
        let source_bitrate: Option<i64> = row.try_get("source_bitrate")?;
        let target_codec: String = row.try_get("target_codec")?;
        let target_container: String = row.try_get("target_container")?;
        let target_bitrate: Option<i64> = row.try_get("target_bitrate")?;
        let client_platform: String = row.try_get("client_platform")?;
        let client_version: String = row.try_get("client_version")?;
        let ip_address: Option<String> = row.try_get("ip_address")?;
        let bytes_streamed: i64 = row.try_get("bytes_streamed")?;
        let buffering_events: i64 = row.try_get("buffering_events")?;
        let buffering_ms_total: i64 = row.try_get("buffering_ms_total")?;
        let stop_reason: Option<String> = row.try_get("stop_reason")?;

        Ok(PlaybackSession {
            id: parse_uuid(&id)?,
            user_id: parse_uuid(&user_id)?,
            device_id: parse_uuid(&device_id)?,
            media_file_id: parse_uuid(&media_file_id)?,
            rendition_id: rendition_id.map(|id| parse_uuid(&id)).transpose()?,
            started_at: parse_datetime(&started_at)?,
            ended_at: ended_at.map(|at| parse_datetime(&at)).transpose()?,
            play_method: play_method_from_str(&play_method)?,
            transcode_reason: transcode_reason.as_deref().map(transcode_reason_from_str),
            source_codec,
            source_container,
            source_bitrate: source_bitrate.map(|b| b as u64),
            target_codec,
            target_container,
            target_bitrate: target_bitrate.map(|b| b as u64),
            client_platform: ClientPlatform::from_wire_name(&client_platform).ok_or_else(|| {
                decode_err(format!("unknown client platform {client_platform:?}"))
            })?,
            client_version,
            ip_address,
            bytes_streamed: bytes_streamed.max(0) as u64,
            buffering_events: buffering_events.max(0) as u32,
            buffering_ms_total: buffering_ms_total.max(0) as u64,
            stop_reason: stop_reason.as_deref().map(stop_reason_from_str),
        })
    }

    /// SQLite uses positional `?` placeholders throughout, so the index is
    /// unused; [`AnalyticsStore::list_sessions`] builds its optional `WHERE`
    /// clause through this helper.
    fn placeholder(&self, _index: usize) -> String {
        "?".to_string()
    }

    fn placeholders(&self, count: usize, next_index: &mut usize) -> String {
        (0..count)
            .map(|_| {
                let placeholder = self.placeholder(*next_index);
                *next_index += 1;
                placeholder
            })
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Per-`(client_platform, play_method)` accumulator used by `rollup_day`.
/// Aggregation happens in Rust rather than in a single SQL `GROUP BY`
/// because `total_playback_seconds` needs `ended_at - started_at`, and
/// date/time differences need engine-specific syntax (`julianday(...)`) —
/// doing the diff in Rust keeps the raw-row SELECT (the only part that runs
/// against the database) plain, at the cost of
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
        let sql = "INSERT INTO playback_sessions \
                 (id, user_id, device_id, media_file_id, rendition_id, started_at, ended_at, \
                  play_method, transcode_reason, source_codec, source_container, source_bitrate, \
                  target_codec, target_container, target_bitrate, client_platform, client_version, \
                  ip_address, bytes_streamed, buffering_events, buffering_ms_total, stop_reason) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
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
        let sql = "INSERT INTO playback_events (id, session_id, occurred_at, kind, payload) \
                 VALUES (?, ?, ?, ?, ?)";
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
        let sql = "UPDATE playback_sessions \
                 SET ended_at = ?, stop_reason = ?, bytes_streamed = ?, buffering_events = ?, \
                 buffering_ms_total = ? WHERE id = ?";
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
        // ISO-8601 `started_at` TEXT column.
        let select_sql =
            "SELECT user_id, device_id, started_at, ended_at, play_method, client_platform, \
                 buffering_events, buffering_ms_total, bytes_streamed \
                 FROM playback_sessions WHERE substr(started_at, 1, 10) = ?";
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

        let delete_sql = "DELETE FROM stats_daily WHERE day = ?";
        sqlx::query(delete_sql)
            .bind(&day_str)
            .execute(&mut *tx)
            .await?;

        let insert_sql = "INSERT INTO stats_daily \
                 (day, client_platform, play_method, sessions_count, unique_users_count, \
                  unique_devices_count, total_playback_seconds, transcode_sessions_count, \
                  buffering_events_total, buffering_ms_total, bytes_streamed_total) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
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
        let sql = "SELECT day, client_platform, play_method, sessions_count, unique_users_count, \
                 unique_devices_count, total_playback_seconds, transcode_sessions_count, \
                 buffering_events_total, buffering_ms_total, bytes_streamed_total \
                 FROM stats_daily WHERE day BETWEEN ? AND ? \
                 ORDER BY day, client_platform, play_method";
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

    async fn record_events_batch(&self, events: &[PlaybackEvent]) -> Result<(), DbError> {
        if events.is_empty() {
            return Ok(());
        }

        let sql = "INSERT INTO playback_events (id, session_id, occurred_at, kind, payload) \
                 VALUES (?, ?, ?, ?, ?)";

        let mut tx = self.pool.begin().await?;
        for event in events {
            let payload = serde_json::to_string(&event.kind)?;
            sqlx::query(sql)
                .bind(event.id.to_string())
                .bind(event.session_id.to_string())
                .bind(format_datetime(event.occurred_at))
                .bind(playback_event_kind_discriminant(&event.kind))
                .bind(payload)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn list_sessions(&self, filter: &SessionFilter) -> Result<Vec<PlaybackSession>, DbError> {
        let mut conditions: Vec<String> = Vec::new();
        let mut next_index = 1;

        if !filter.user_ids.is_empty() {
            let placeholders = self.placeholders(filter.user_ids.len(), &mut next_index);
            conditions.push(format!("user_id IN ({placeholders})"));
        }
        if !filter.play_methods.is_empty() {
            let placeholders = self.placeholders(filter.play_methods.len(), &mut next_index);
            conditions.push(format!("play_method IN ({placeholders})"));
        }
        if !filter.stop_reasons.is_empty() {
            let mut stop_conditions = Vec::with_capacity(filter.stop_reasons.len());
            for reason in &filter.stop_reasons {
                match reason {
                    SessionStopReasonFilter::Other => {
                        stop_conditions.push("stop_reason LIKE 'other:%'".to_string());
                    }
                    SessionStopReasonFilter::InProgress => {
                        stop_conditions.push("stop_reason IS NULL".to_string());
                    }
                    _ => {
                        stop_conditions
                            .push(format!("stop_reason = {}", self.placeholder(next_index)));
                        next_index += 1;
                    }
                }
            }
            conditions.push(format!("({})", stop_conditions.join(" OR ")));
        }
        if filter.from.is_some() {
            conditions.push(format!("started_at >= {}", self.placeholder(next_index)));
            next_index += 1;
        }
        if filter.to.is_some() {
            conditions.push(format!("started_at <= {}", self.placeholder(next_index)));
            next_index += 1;
        }
        if filter.min_bytes_streamed.is_some() {
            conditions.push(format!(
                "bytes_streamed >= {}",
                self.placeholder(next_index)
            ));
            next_index += 1;
        }
        if filter.max_bytes_streamed.is_some() {
            conditions.push(format!(
                "bytes_streamed <= {}",
                self.placeholder(next_index)
            ));
            next_index += 1;
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        let limit_placeholder = self.placeholder(next_index);
        next_index += 1;
        let offset_placeholder = self.placeholder(next_index);

        let sql = format!(
            "SELECT {} FROM playback_sessions {where_clause} \
             ORDER BY started_at DESC, id ASC \
             LIMIT {limit_placeholder} OFFSET {offset_placeholder}",
            Self::SESSION_COLUMNS,
        );

        let mut query = sqlx::query(&sql);
        for user_id in &filter.user_ids {
            query = query.bind(user_id.to_string());
        }
        for play_method in &filter.play_methods {
            query = query.bind(play_method_to_str(*play_method));
        }
        for stop_reason in &filter.stop_reasons {
            if let Some(stored_value) = stop_reason.stored_value() {
                query = query.bind(stored_value);
            }
        }
        if let Some(from) = filter.from {
            query = query.bind(format_datetime(from));
        }
        if let Some(to) = filter.to {
            query = query.bind(format_datetime(to));
        }
        if let Some(min_bytes_streamed) = filter.min_bytes_streamed {
            query = query.bind(min_bytes_streamed);
        }
        if let Some(max_bytes_streamed) = filter.max_bytes_streamed {
            query = query.bind(max_bytes_streamed);
        }
        query = query.bind(filter.limit).bind(filter.offset);

        let rows = query.fetch_all(&self.pool).await?;
        rows.iter().map(Self::session_from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use playarr_model::PlaybackEventKind;

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
            play_method: playarr_model::PlayMethod::DirectPlay,
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
        tv.play_method = playarr_model::PlayMethod::Transcode;
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

    #[tokio::test]
    async fn record_events_batch_writes_every_event_in_one_transaction() {
        let pool = test_sqlite_pool().await;
        let store = SqlxAnalyticsStore::new(pool);
        let session = sample_session(ClientPlatform::Web);
        store.record_session_start(&session).await.unwrap();

        let events = vec![
            PlaybackEvent {
                id: Uuid::new_v4(),
                session_id: session.id,
                occurred_at: Utc::now(),
                kind: PlaybackEventKind::Heartbeat {
                    position_ms: 1_000,
                    bytes_streamed_total: Some(2_000),
                },
            },
            PlaybackEvent {
                id: Uuid::new_v4(),
                session_id: session.id,
                occurred_at: Utc::now(),
                kind: PlaybackEventKind::BufferStart { position_ms: 2_000 },
            },
        ];
        store.record_events_batch(&events).await.unwrap();

        let count: i64 = sqlx::query("SELECT COUNT(*) as c FROM playback_events")
            .fetch_one(&store.pool)
            .await
            .unwrap()
            .try_get("c")
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn record_events_batch_is_a_no_op_for_an_empty_slice() {
        let pool = test_sqlite_pool().await;
        let store = SqlxAnalyticsStore::new(pool);
        store.record_events_batch(&[]).await.unwrap();
    }

    #[tokio::test]
    async fn list_sessions_filters_by_user_and_date_range_newest_first() {
        let pool = test_sqlite_pool().await;
        let store = SqlxAnalyticsStore::new(pool);

        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();
        let now = Utc::now();

        let mut older = sample_session(ClientPlatform::Web);
        older.user_id = user_a;
        older.started_at = now - chrono::Duration::hours(2);

        let mut newer = sample_session(ClientPlatform::Web);
        newer.user_id = user_a;
        newer.started_at = now - chrono::Duration::hours(1);
        newer.play_method = playarr_model::PlayMethod::Transcode;
        newer.transcode_reason = Some(playarr_model::TranscodeReason::VideoCodecNotSupported);
        newer.stop_reason = None;

        let mut other_user = sample_session(ClientPlatform::Web);
        other_user.user_id = user_b;
        other_user.started_at = now;

        for s in [&older, &newer, &other_user] {
            store.record_session_start(s).await.unwrap();
        }

        let filter = SessionFilter {
            user_ids: vec![user_a],
            limit: 10,
            offset: 0,
            ..Default::default()
        };
        let results = store.list_sessions(&filter).await.unwrap();
        assert_eq!(results.len(), 2);
        // Newest first.
        assert_eq!(results[0].id, newer.id);
        assert_eq!(results[1].id, older.id);
        assert_eq!(
            results[0].transcode_reason,
            Some(playarr_model::TranscodeReason::VideoCodecNotSupported)
        );

        let date_filtered = store
            .list_sessions(&SessionFilter {
                from: Some(now - chrono::Duration::minutes(90)),
                limit: 10,
                offset: 0,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(date_filtered.len(), 2);
        assert!(date_filtered.iter().all(|s| s.id != older.id));

        let limited = store
            .list_sessions(&SessionFilter {
                limit: 1,
                offset: 0,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].id, other_user.id);
    }

    #[tokio::test]
    async fn list_sessions_combines_multi_value_facets_and_numeric_bounds() {
        let pool = test_sqlite_pool().await;
        let store = SqlxAnalyticsStore::new(pool);
        let now = Utc::now();
        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();
        let user_c = Uuid::new_v4();

        let mut completed = sample_session(ClientPlatform::Web);
        completed.user_id = user_a;
        completed.started_at = now - chrono::Duration::minutes(3);
        completed.ended_at = Some(now - chrono::Duration::minutes(2));
        completed.bytes_streamed = 100;
        completed.stop_reason = Some(StopReason::Completed);

        let mut other = sample_session(ClientPlatform::Web);
        other.user_id = user_b;
        other.started_at = now - chrono::Duration::minutes(2);
        other.ended_at = Some(now - chrono::Duration::minutes(1));
        other.play_method = PlayMethod::Transcode;
        other.bytes_streamed = 1_000;
        other.stop_reason = Some(StopReason::Other("admin_stopped".to_string()));

        let mut in_progress = sample_session(ClientPlatform::Web);
        in_progress.user_id = user_c;
        in_progress.started_at = now - chrono::Duration::minutes(1);
        in_progress.play_method = PlayMethod::DirectStream;
        in_progress.bytes_streamed = 500;

        for session in [&completed, &other, &in_progress] {
            store.record_session_start(session).await.unwrap();
        }

        let results = store
            .list_sessions(&SessionFilter {
                user_ids: vec![user_a, user_b],
                play_methods: vec![PlayMethod::DirectPlay, PlayMethod::Transcode],
                stop_reasons: vec![
                    SessionStopReasonFilter::Completed,
                    SessionStopReasonFilter::Other,
                ],
                // Inclusive on both sides: the matching row sits exactly on
                // the shared minimum/maximum boundary.
                min_bytes_streamed: Some(1_000),
                max_bytes_streamed: Some(1_000),
                limit: 10,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(
            results.iter().map(|session| session.id).collect::<Vec<_>>(),
            vec![other.id]
        );

        let in_progress_results = store
            .list_sessions(&SessionFilter {
                stop_reasons: vec![SessionStopReasonFilter::InProgress],
                limit: 10,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(
            in_progress_results
                .iter()
                .map(|session| session.id)
                .collect::<Vec<_>>(),
            vec![in_progress.id]
        );
    }

    #[tokio::test]
    async fn list_sessions_uses_id_as_a_stable_timestamp_tie_breaker() {
        let pool = test_sqlite_pool().await;
        let store = SqlxAnalyticsStore::new(pool);
        let started_at = Utc::now();
        let lower_id = Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap();
        let higher_id = Uuid::parse_str("00000000-0000-4000-8000-000000000002").unwrap();

        let mut higher = sample_session(ClientPlatform::Web);
        higher.id = higher_id;
        higher.started_at = started_at;
        let mut lower = sample_session(ClientPlatform::Web);
        lower.id = lower_id;
        lower.started_at = started_at;

        // Insert in the opposite order to the expected result so row/insertion
        // order cannot accidentally satisfy the assertion.
        store.record_session_start(&higher).await.unwrap();
        store.record_session_start(&lower).await.unwrap();

        let first_page = store
            .list_sessions(&SessionFilter {
                limit: 1,
                ..Default::default()
            })
            .await
            .unwrap();
        let second_page = store
            .list_sessions(&SessionFilter {
                limit: 1,
                offset: 1,
                ..Default::default()
            })
            .await
            .unwrap();

        assert_eq!(first_page[0].id, lower_id);
        assert_eq!(second_page[0].id, higher_id);
    }
}
