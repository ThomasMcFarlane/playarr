//! Bridges live playback events into both the [`SessionRegistry`] (for
//! immediate "what's active" queries) and `streamarr-db`'s durable
//! `AnalyticsStore` (for history/rollups) — the single place a playback
//! event fans out to both, so callers only ever report an event once and
//! can't accidentally update one without the other.

use std::sync::Arc;

use streamarr_db::analytics::AnalyticsStore;
use streamarr_db::DbError;
use streamarr_model::{PlaybackEvent, PlaybackSession, StopReason};
use uuid::Uuid;

use super::registry::SessionRegistry;

pub struct AnalyticsCollector {
    registry: Arc<dyn SessionRegistry>,
    store: Arc<dyn AnalyticsStore>,
}

impl AnalyticsCollector {
    pub fn new(registry: Arc<dyn SessionRegistry>, store: Arc<dyn AnalyticsStore>) -> Self {
        Self { registry, store }
    }

    /// Called once, at playback start.
    pub async fn on_session_start(&self, session: PlaybackSession) -> Result<(), DbError> {
        self.store.record_session_start(&session).await?;
        self.registry.insert(session);
        Ok(())
    }

    /// Called for every timeline event (seek, buffer, bitrate change,
    /// heartbeat, ...) over the session's lifetime.
    pub async fn on_event(&self, event: PlaybackEvent) -> Result<(), DbError> {
        self.store.record_event(&event).await
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
