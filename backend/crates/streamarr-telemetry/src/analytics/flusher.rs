//! Drains the batched/coalesced side of [`super::collector::AnalyticsCollector::on_event`]'s
//! event channel and writes accumulated batches to the durable
//! `AnalyticsStore` on a fixed interval (or once a batch hits its size
//! cap) -- see that module's doc comment for why events flow through a
//! channel here instead of a synchronous write per event.
//!
//! Must run on **every** node, not leader-gated: the event channel is a
//! local, in-process `mpsc` fed only by this same node's own
//! `AnalyticsCollector`, so each node has its own buffered events that only
//! it can flush. Wrapping this in a leader-election gate (the way
//! `RollupScheduler`/`SessionReaper`/`RetentionSweeper` are, being genuine
//! cluster-wide singleton concerns) would silently drop every non-leader
//! node's buffered events.

use std::sync::Arc;
use std::time::Duration;

use streamarr_db::analytics::AnalyticsStore;
use streamarr_model::PlaybackEvent;
use tokio::sync::mpsc;

pub struct AnalyticsFlusher {
    store: Arc<dyn AnalyticsStore>,
    event_rx: mpsc::Receiver<PlaybackEvent>,
    flush_interval: Duration,
    max_batch: usize,
}

impl AnalyticsFlusher {
    pub fn new(
        store: Arc<dyn AnalyticsStore>,
        event_rx: mpsc::Receiver<PlaybackEvent>,
        flush_interval: Duration,
        max_batch: usize,
    ) -> Self {
        Self {
            store,
            event_rx,
            flush_interval,
            max_batch,
        }
    }

    /// Runs until every [`AnalyticsCollector`](super::collector::AnalyticsCollector)
    /// clone of the paired `Sender` is dropped (process shutdown), flushing
    /// whatever's buffered on the way out.
    pub async fn run(mut self) {
        let mut buf = Vec::with_capacity(self.max_batch);
        let mut ticker = tokio::time::interval(self.flush_interval);
        // `interval` fires immediately on its first tick; nothing has had a
        // chance to accumulate yet, so skip that one -- same idiom
        // `RollupScheduler`/`TdarrDispatcher` already use for their own
        // periodic loops.
        ticker.tick().await;

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    self.flush(&mut buf).await;
                }
                maybe_event = self.event_rx.recv() => match maybe_event {
                    Some(event) => {
                        buf.push(event);
                        if buf.len() >= self.max_batch {
                            self.flush(&mut buf).await;
                        }
                    }
                    None => {
                        tracing::info!(
                            "analytics event channel closed; flushing remaining buffer and exiting"
                        );
                        self.flush(&mut buf).await;
                        return;
                    }
                },
            }
        }
    }

    async fn flush(&self, buf: &mut Vec<PlaybackEvent>) {
        if buf.is_empty() {
            return;
        }
        if let Err(err) = self.store.record_events_batch(buf).await {
            tracing::error!(
                ?err,
                count = buf.len(),
                "failed to flush batched playback events; dropping batch"
            );
        }
        buf.clear();
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use chrono::Utc;
    use streamarr_db::analytics::{DailyStat, SessionFilter};
    use streamarr_db::DbError;
    use streamarr_model::{PlaybackEventKind, PlaybackSession, StopReason};
    use uuid::Uuid;

    use super::*;

    #[derive(Default)]
    struct FakeAnalyticsStore {
        batches: std::sync::Mutex<Vec<Vec<PlaybackEvent>>>,
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
            _session_id: Uuid,
            _session: &PlaybackSession,
            _stop_reason: StopReason,
        ) -> Result<(), DbError> {
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
            self.batches.lock().unwrap().push(events.to_vec());
            Ok(())
        }

        async fn list_sessions(
            &self,
            _filter: &SessionFilter,
        ) -> Result<Vec<PlaybackSession>, DbError> {
            Ok(Vec::new())
        }
    }

    fn sample_event() -> PlaybackEvent {
        PlaybackEvent {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            occurred_at: Utc::now(),
            kind: PlaybackEventKind::Heartbeat {
                position_ms: 1_000,
                bytes_streamed_total: None,
            },
        }
    }

    #[tokio::test]
    async fn flushes_once_max_batch_is_reached_without_waiting_for_the_timer() {
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, rx) = mpsc::channel(16);
        let flusher = AnalyticsFlusher::new(store.clone(), rx, Duration::from_secs(3600), 2);
        let handle = tokio::spawn(flusher.run());

        tx.send(sample_event()).await.unwrap();
        tx.send(sample_event()).await.unwrap();

        // Give the flusher's select loop a moment to process the second
        // send and flush -- no timer tick involved here (interval is set
        // to an hour), so this is purely exercising the max-batch path.
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if !store.batches.lock().unwrap().is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("flush should happen once max_batch is reached");

        assert_eq!(store.batches.lock().unwrap()[0].len(), 2);

        drop(tx);
        let _ = tokio::time::timeout(Duration::from_secs(5), handle).await;
    }

    #[tokio::test]
    async fn flushes_remaining_buffer_when_the_channel_closes() {
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, rx) = mpsc::channel(16);
        // Long interval, high batch cap -- only the channel-closed path
        // should trigger a flush here.
        let flusher = AnalyticsFlusher::new(store.clone(), rx, Duration::from_secs(3600), 500);
        let handle = tokio::spawn(flusher.run());

        tx.send(sample_event()).await.unwrap();
        drop(tx);

        tokio::time::timeout(Duration::from_secs(5), handle)
            .await
            .expect("run() should exit once the channel closes")
            .unwrap();

        assert_eq!(store.batches.lock().unwrap().len(), 1);
        assert_eq!(store.batches.lock().unwrap()[0].len(), 1);
    }

    #[tokio::test]
    async fn periodic_tick_flushes_a_partial_batch() {
        let store = Arc::new(FakeAnalyticsStore::default());
        let (tx, rx) = mpsc::channel(16);
        let flusher = AnalyticsFlusher::new(store.clone(), rx, Duration::from_millis(30), 500);
        let handle = tokio::spawn(flusher.run());

        tx.send(sample_event()).await.unwrap();

        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if !store.batches.lock().unwrap().is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the periodic tick should flush the partial batch");

        drop(tx);
        let _ = tokio::time::timeout(Duration::from_secs(5), handle).await;
    }
}
