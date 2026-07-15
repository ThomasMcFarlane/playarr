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

use async_trait::async_trait;
use chrono::NaiveDate;
use streamarr_model::{PlaybackEvent, PlaybackSession, StopReason};
use uuid::Uuid;

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
}

impl SqlxAnalyticsStore {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AnalyticsStore for SqlxAnalyticsStore {
    async fn record_session_start(&self, _session: &PlaybackSession) -> Result<(), DbError> {
        // INSERT INTO playback_sessions (...) VALUES (...)
        let _ = &self.pool;
        unimplemented!("SqlxAnalyticsStore::record_session_start")
    }

    async fn record_event(&self, _event: &PlaybackEvent) -> Result<(), DbError> {
        // INSERT INTO playback_events (id, session_id, occurred_at, kind, payload)
        // VALUES ($1, $2, $3, $4, $5)
        unimplemented!("SqlxAnalyticsStore::record_event")
    }

    async fn close_session(
        &self,
        _session_id: Uuid,
        _session: &PlaybackSession,
        _stop_reason: StopReason,
    ) -> Result<(), DbError> {
        // UPDATE playback_sessions
        // SET ended_at = $2, stop_reason = $3, bytes_streamed = $4,
        //     buffering_events = $5, buffering_ms_total = $6
        // WHERE id = $1
        unimplemented!("SqlxAnalyticsStore::close_session")
    }

    async fn rollup_day(&self, _day: NaiveDate) -> Result<(), DbError> {
        // INSERT INTO stats_daily (day, client_platform, play_method, sessions_count, ...)
        // SELECT date(started_at), client_platform, play_method, count(*), ...
        // FROM playback_sessions WHERE date(started_at) = $1
        // GROUP BY client_platform, play_method
        // ON CONFLICT (day, client_platform, play_method) DO UPDATE SET ...
        unimplemented!("SqlxAnalyticsStore::rollup_day")
    }

    async fn get_daily_stats(
        &self,
        _from: NaiveDate,
        _to: NaiveDate,
    ) -> Result<Vec<DailyStat>, DbError> {
        // SELECT * FROM stats_daily WHERE day BETWEEN $1 AND $2 ORDER BY day
        unimplemented!("SqlxAnalyticsStore::get_daily_stats")
    }
}
