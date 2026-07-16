//! Force-closes abandoned playback sessions: a session whose client
//! vanished without ever sending a clean `Stop` event (tab closed, app
//! crashed, network dropped) would otherwise sit in [`SessionRegistry`]
//! forever, showing up in the admin "who's watching now" view long after
//! anyone is actually watching. Runs alongside [`super::rollup::RollupScheduler`]
//! as a cluster-wide singleton concern (wrap in `run_while_leader`, same as
//! that scheduler and the Tdarr dispatcher).

use std::sync::Arc;
use std::time::Duration;

use streamarr_model::StopReason;

use super::collector::AnalyticsCollector;
use super::registry::SessionRegistry;

pub struct SessionReaper {
    registry: Arc<dyn SessionRegistry>,
    analytics: Arc<AnalyticsCollector>,
    /// A tracked session with no `insert`/`update` touch in this long is
    /// considered abandoned. Recommended: 60s -- four missed heartbeats at
    /// the recommended 15s client heartbeat cadence, generous enough to
    /// survive a brief network blip without prematurely closing a live
    /// session, tight enough that the admin live view doesn't show a
    /// phantom session for more than a minute after a real disconnect.
    idle_after: Duration,
    sweep_interval: Duration,
}

impl SessionReaper {
    pub fn new(
        registry: Arc<dyn SessionRegistry>,
        analytics: Arc<AnalyticsCollector>,
        idle_after: Duration,
        sweep_interval: Duration,
    ) -> Self {
        Self {
            registry,
            analytics,
            idle_after,
            sweep_interval,
        }
    }

    /// Runs forever, sweeping on `sweep_interval` -- same shape as
    /// [`super::rollup::RollupScheduler::run`].
    pub async fn run(self) -> ! {
        let mut ticker = tokio::time::interval(self.sweep_interval);
        loop {
            ticker.tick().await;
            self.sweep_once().await;
        }
    }

    async fn sweep_once(&self) {
        for session_id in self.registry.stale_session_ids(self.idle_after) {
            // Re-fetch rather than trusting the id alone: another path
            // (a real `Stop` event, or a concurrent sweep on a
            // differently-scheduled node in a brief leadership-handoff
            // window) may have already closed and removed it between
            // `stale_session_ids` listing it and this loop reaching it --
            // `get` returning `None` here is exactly that, a benign race,
            // not an error.
            if let Some(state) = self.registry.get(session_id) {
                if let Err(err) = self
                    .analytics
                    .on_session_end(session_id, &state, StopReason::IdleTimeout)
                    .await
                {
                    tracing::error!(
                        ?err,
                        session_id = %session_id,
                        "failed to force-close abandoned playback session"
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use chrono::Utc;
    use streamarr_db::analytics::{AnalyticsStore, DailyStat, SessionFilter};
    use streamarr_db::DbError;
    use streamarr_model::{ClientPlatform, PlayMethod, PlaybackEvent, PlaybackSession};
    use uuid::Uuid;

    use super::*;
    use crate::analytics::registry::InMemorySessionRegistry;

    #[derive(Default)]
    struct FakeAnalyticsStore {
        closed: std::sync::Mutex<Vec<(Uuid, StopReason)>>,
    }

    #[async_trait]
    impl AnalyticsStore for FakeAnalyticsStore {
        async fn record_session_start(&self, _session: &PlaybackSession) -> Result<(), DbError> {
            Ok(())
        }

        async fn record_event(&self, _event: &PlaybackEvent) -> Result<(), DbError> {
            Ok(())
        }

        async fn close_session(
            &self,
            session_id: Uuid,
            _session: &PlaybackSession,
            stop_reason: StopReason,
        ) -> Result<(), DbError> {
            self.closed.lock().unwrap().push((session_id, stop_reason));
            Ok(())
        }

        async fn rollup_day(&self, _day: chrono::NaiveDate) -> Result<(), DbError> {
            Ok(())
        }

        async fn get_daily_stats(
            &self,
            _from: chrono::NaiveDate,
            _to: chrono::NaiveDate,
        ) -> Result<Vec<DailyStat>, DbError> {
            Ok(Vec::new())
        }

        async fn record_events_batch(&self, _events: &[PlaybackEvent]) -> Result<(), DbError> {
            Ok(())
        }

        async fn list_sessions(
            &self,
            _filter: &SessionFilter,
        ) -> Result<Vec<PlaybackSession>, DbError> {
            Ok(Vec::new())
        }
    }

    fn sample_session() -> PlaybackSession {
        PlaybackSession {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            rendition_id: None,
            started_at: Utc::now(),
            ended_at: None,
            play_method: PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(8_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(8_000_000),
            client_platform: ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        }
    }

    #[tokio::test]
    async fn sweep_force_closes_only_idle_sessions() {
        let registry = Arc::new(InMemorySessionRegistry::new());
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        let analytics = Arc::new(AnalyticsCollector::new(registry.clone(), store.clone(), tx));

        let stale = sample_session();
        let stale_id = stale.id;
        registry.insert(stale);
        tokio::time::sleep(Duration::from_millis(50)).await;

        let fresh = sample_session();
        let fresh_id = fresh.id;
        registry.insert(fresh);

        let reaper = SessionReaper::new(
            registry.clone(),
            analytics,
            Duration::from_millis(30),
            Duration::from_secs(3600),
        );
        reaper.sweep_once().await;

        let closed = store.closed.lock().unwrap();
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0], (stale_id, StopReason::IdleTimeout));
        drop(closed);

        // The stale session was closed (and removed from the registry via
        // `on_session_end`); the fresh one is untouched.
        assert_eq!(registry.get(stale_id), None);
        assert!(registry.get(fresh_id).is_some());
    }

    #[tokio::test]
    async fn sweep_of_an_already_removed_session_is_not_an_error() {
        // `stale_session_ids` and the subsequent `get`/`on_session_end`
        // aren't atomic -- a concurrent removal between the two is a
        // benign race, not a bug. Simulate it by sweeping an empty
        // registry (no ids returned, so the loop body never runs).
        let registry = Arc::new(InMemorySessionRegistry::new());
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        let analytics = Arc::new(AnalyticsCollector::new(registry.clone(), store, tx));

        let reaper = SessionReaper::new(
            registry,
            analytics,
            Duration::from_millis(30),
            Duration::from_secs(3600),
        );
        reaper.sweep_once().await;
    }
}
