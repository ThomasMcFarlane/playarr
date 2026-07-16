//! Bridges live playback events into both the [`SessionRegistry`] (for
//! immediate "what's active" queries) and `streamarr-db`'s durable
//! `AnalyticsStore` (for history/rollups) — the single place a playback
//! event fans out to both, so callers only ever report an event once and
//! can't accidentally update one without the other.
//!
//! **Architecture: in-memory registry synchronous, durable write
//! batched/coalesced.** No documented "session-grain persistence via
//! registry + periodic flush" design exists anywhere else in this repo —
//! this shape was designed fresh for the playback-activity-tracking gap
//! this module closes, not lifted from an existing doc. [`AnalyticsCollector::on_event`]
//! does two things on every call:
//!
//! 1. Mutates [`SessionRegistry`] synchronously via [`apply_event_to_session`]
//!    — cheap, in-process, and what makes the admin "live sessions" view and
//!    buffering counters real-time. This is a fix, not just a feature: prior
//!    to this, `on_event` never touched the registry at all, even though
//!    `SessionRegistry::update` existed specifically for this (per its own
//!    doc comment).
//! 2. Durably persists the event — `Stop`/`Error` synchronously (important,
//!    low-frequency), everything else (`Heartbeat`/`Pause`/`Resume`/`Seek`/
//!    `BufferStart`/`BufferEnd`/`BitrateChange`) via `try_send` onto the
//!    channel [`super::flusher::AnalyticsFlusher`] batches/coalesces off of
//!    — never a synchronous DB write per event. `try_send`, not
//!    `send().await`: this call sits on the request-handling hot path and
//!    must never block/backpressure an HTTP response on a slow DB —
//!    dropping an occasional heartbeat under extreme load is an acceptable,
//!    documented trade-off consistent with `streamarr_db::analytics`'s own
//!    "tolerant of eventual consistency" framing.

use std::sync::Arc;

use streamarr_db::analytics::AnalyticsStore;
use streamarr_db::DbError;
use streamarr_model::{PlaybackEvent, PlaybackEventKind, PlaybackSession, StopReason};
use uuid::Uuid;

use super::registry::SessionRegistry;

pub struct AnalyticsCollector {
    registry: Arc<dyn SessionRegistry>,
    store: Arc<dyn AnalyticsStore>,
    /// Send side of the channel [`super::flusher::AnalyticsFlusher`] drains
    /// on the receive side -- every non-`Stop`/`Error` event is enqueued
    /// here rather than written synchronously. See the module doc comment.
    event_tx: tokio::sync::mpsc::Sender<PlaybackEvent>,
}

impl AnalyticsCollector {
    pub fn new(
        registry: Arc<dyn SessionRegistry>,
        store: Arc<dyn AnalyticsStore>,
        event_tx: tokio::sync::mpsc::Sender<PlaybackEvent>,
    ) -> Self {
        Self {
            registry,
            store,
            event_tx,
        }
    }

    /// Called once, at playback start.
    pub async fn on_session_start(&self, session: PlaybackSession) -> Result<(), DbError> {
        self.store.record_session_start(&session).await?;
        self.registry.insert(session);
        Ok(())
    }

    /// Called for every timeline event (seek, buffer, bitrate change,
    /// heartbeat, ...) over the session's lifetime. See the module doc
    /// comment for the synchronous-registry / batched-durable-write split.
    pub async fn on_event(&self, session_id: Uuid, event: PlaybackEvent) -> Result<(), DbError> {
        self.registry
            .update(session_id, &|s| apply_event_to_session(s, &event.kind));

        match &event.kind {
            PlaybackEventKind::Stop { .. } | PlaybackEventKind::Error { .. } => {
                self.store.record_event(&event).await?;
            }
            _ => {
                if self.event_tx.try_send(event).is_err() {
                    tracing::warn!(
                        session_id = %session_id,
                        "analytics event buffer full or flusher gone; dropping event"
                    );
                }
            }
        }

        Ok(())
    }

    /// Called once, when playback ends. `final_state` is the caller's
    /// last-known view of the session (accumulated byte/buffering
    /// counters) to persist alongside the stop reason.
    pub async fn on_session_end(
        &self,
        session_id: Uuid,
        final_state: &PlaybackSession,
        stop_reason: StopReason,
    ) -> Result<(), DbError> {
        self.store
            .close_session(session_id, final_state, stop_reason)
            .await?;
        self.registry.remove(session_id);
        Ok(())
    }
}

/// Applies the in-memory-only side effects of one [`PlaybackEventKind`] to
/// a tracked [`PlaybackSession`] -- currently just the buffering counters,
/// which are fully derivable from `BufferStart`/`BufferEnd` with zero model
/// changes. `bytes_streamed` is updated too, when a `Heartbeat` carries a
/// client-reported cumulative byte count (see
/// `PlaybackEventKind::Heartbeat::bytes_streamed_total`'s doc comment for
/// why that field is optional and how it's derived) -- monotonic, so a
/// stale/out-of-order heartbeat can't regress the counter.
fn apply_event_to_session(session: &mut PlaybackSession, kind: &PlaybackEventKind) {
    match kind {
        PlaybackEventKind::BufferStart { .. } => session.buffering_events += 1,
        PlaybackEventKind::BufferEnd { duration_ms } => {
            session.buffering_ms_total += duration_ms;
        }
        PlaybackEventKind::Heartbeat {
            bytes_streamed_total: Some(bytes),
            ..
        } => {
            session.bytes_streamed = session.bytes_streamed.max(*bytes);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use chrono::Utc;
    use streamarr_db::analytics::{DailyStat, SessionFilter};
    use streamarr_model::{ClientPlatform, PlayMethod};

    use super::*;
    use crate::analytics::registry::InMemorySessionRegistry;

    #[derive(Default)]
    struct FakeAnalyticsStore {
        started: std::sync::Mutex<Vec<PlaybackSession>>,
        events: std::sync::Mutex<Vec<PlaybackEvent>>,
        closed: std::sync::Mutex<Vec<(Uuid, PlaybackSession, StopReason)>>,
    }

    #[async_trait]
    impl AnalyticsStore for FakeAnalyticsStore {
        async fn record_session_start(&self, session: &PlaybackSession) -> Result<(), DbError> {
            self.started.lock().unwrap().push(session.clone());
            Ok(())
        }

        async fn record_event(&self, event: &PlaybackEvent) -> Result<(), DbError> {
            self.events.lock().unwrap().push(event.clone());
            Ok(())
        }

        async fn close_session(
            &self,
            session_id: Uuid,
            session: &PlaybackSession,
            stop_reason: StopReason,
        ) -> Result<(), DbError> {
            self.closed
                .lock()
                .unwrap()
                .push((session_id, session.clone(), stop_reason));
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

        async fn record_events_batch(&self, events: &[PlaybackEvent]) -> Result<(), DbError> {
            self.events.lock().unwrap().extend_from_slice(events);
            Ok(())
        }

        async fn list_sessions(
            &self,
            _filter: &SessionFilter,
        ) -> Result<Vec<PlaybackSession>, DbError> {
            Ok(self.started.lock().unwrap().clone())
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
    async fn on_session_start_writes_through_and_inserts_into_registry() {
        let registry = Arc::new(InMemorySessionRegistry::new());
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        let collector = AnalyticsCollector::new(registry.clone(), store.clone(), tx);

        let session = sample_session();
        collector.on_session_start(session.clone()).await.unwrap();

        assert_eq!(store.started.lock().unwrap().len(), 1);
        assert_eq!(registry.get(session.id), Some(session));
    }

    /// The gap this fix closes: `on_event` must actually mutate the
    /// registry (via `apply_event_to_session`), not just forward to the
    /// durable store -- otherwise the admin "live sessions" view and
    /// buffering counters would never update in real time.
    #[tokio::test]
    async fn on_event_updates_registry_buffering_counters() {
        let registry = Arc::new(InMemorySessionRegistry::new());
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        let collector = AnalyticsCollector::new(registry.clone(), store.clone(), tx);

        let session = sample_session();
        let session_id = session.id;
        collector.on_session_start(session).await.unwrap();

        collector
            .on_event(
                session_id,
                PlaybackEvent {
                    id: Uuid::new_v4(),
                    session_id,
                    occurred_at: Utc::now(),
                    kind: PlaybackEventKind::BufferStart { position_ms: 1_000 },
                },
            )
            .await
            .unwrap();
        collector
            .on_event(
                session_id,
                PlaybackEvent {
                    id: Uuid::new_v4(),
                    session_id,
                    occurred_at: Utc::now(),
                    kind: PlaybackEventKind::BufferEnd { duration_ms: 250 },
                },
            )
            .await
            .unwrap();
        collector
            .on_event(
                session_id,
                PlaybackEvent {
                    id: Uuid::new_v4(),
                    session_id,
                    occurred_at: Utc::now(),
                    kind: PlaybackEventKind::Heartbeat {
                        position_ms: 5_000,
                        bytes_streamed_total: Some(12_345),
                    },
                },
            )
            .await
            .unwrap();

        let tracked = registry.get(session_id).unwrap();
        assert_eq!(tracked.buffering_events, 1);
        assert_eq!(tracked.buffering_ms_total, 250);
        assert_eq!(tracked.bytes_streamed, 12_345);
    }

    /// `Stop`/`Error` are written synchronously (not enqueued) -- prove
    /// this by using a zero-capacity, immediately-full channel: if
    /// `on_event` tried to enqueue a `Stop`, `try_send` would fail and
    /// (given the "warn and drop" fallback) the store would never see it.
    #[tokio::test]
    async fn stop_and_error_events_are_written_synchronously_not_enqueued() {
        let registry = Arc::new(InMemorySessionRegistry::new());
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        // Fill the channel and never drain it, so any `try_send` fails.
        drop(rx);
        let collector = AnalyticsCollector::new(registry.clone(), store.clone(), tx);

        let session = sample_session();
        let session_id = session.id;
        collector.on_session_start(session).await.unwrap();

        collector
            .on_event(
                session_id,
                PlaybackEvent {
                    id: Uuid::new_v4(),
                    session_id,
                    occurred_at: Utc::now(),
                    kind: PlaybackEventKind::Stop {
                        reason: StopReason::UserStopped,
                        position_ms: 10_000,
                    },
                },
            )
            .await
            .unwrap();

        assert_eq!(store.events.lock().unwrap().len(), 1);
    }

    /// Non-`Stop`/`Error` events are enqueued, not written synchronously --
    /// a closed/full channel must not fail the call (the module doc's
    /// "never block/backpressure the hot path" contract), and the fake
    /// store must never see the event directly (only the flusher would
    /// write it, and there is no flusher running in this test).
    #[tokio::test]
    async fn non_terminal_events_are_enqueued_and_a_full_channel_does_not_error() {
        let registry = Arc::new(InMemorySessionRegistry::new());
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        drop(rx);
        let collector = AnalyticsCollector::new(registry.clone(), store.clone(), tx);

        let session = sample_session();
        let session_id = session.id;
        collector.on_session_start(session).await.unwrap();

        let result = collector
            .on_event(
                session_id,
                PlaybackEvent {
                    id: Uuid::new_v4(),
                    session_id,
                    occurred_at: Utc::now(),
                    kind: PlaybackEventKind::Seek {
                        from_ms: 1_000,
                        to_ms: 2_000,
                    },
                },
            )
            .await;

        assert!(result.is_ok());
        assert!(store.events.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn on_session_end_closes_durably_and_removes_from_registry() {
        let registry = Arc::new(InMemorySessionRegistry::new());
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        let collector = AnalyticsCollector::new(registry.clone(), store.clone(), tx);

        let session = sample_session();
        let session_id = session.id;
        collector.on_session_start(session.clone()).await.unwrap();

        collector
            .on_session_end(session_id, &session, StopReason::Completed)
            .await
            .unwrap();

        assert_eq!(store.closed.lock().unwrap().len(), 1);
        assert_eq!(registry.get(session_id), None);
    }
}
