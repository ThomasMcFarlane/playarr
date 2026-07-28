//! Periodic rollup: recomputes `stats_daily` (via
//! `AnalyticsStore::rollup_day`) for recently-active days, so dashboard
//! queries stay close to real-time instead of only updating once a day.

use std::sync::Arc;
use std::time::Duration;

use chrono::{NaiveDate, Utc};
use playarr_db::analytics::AnalyticsStore;
use playarr_db::DbError;

pub struct RollupScheduler {
    store: Arc<dyn AnalyticsStore>,
    interval: Duration,
}

impl RollupScheduler {
    pub fn new(store: Arc<dyn AnalyticsStore>, interval: Duration) -> Self {
        Self { store, interval }
    }

    /// Runs until the task is aborted/cancelled by its owner (this never
    /// returns `Ok` on its own): every `interval`, rolls up both yesterday
    /// and today. Yesterday catches sessions that closed after local
    /// midnight but before this tick; today keeps `stats_daily` from
    /// lagging a full day behind for still-in-progress days.
    pub async fn run(self) -> Result<(), DbError> {
        let mut ticker = tokio::time::interval(self.interval);
        loop {
            ticker.tick().await;
            if let Err(err) = self.rollup_recent().await {
                tracing::error!(?err, "stats_daily rollup pass failed");
            }
        }
    }

    async fn rollup_recent(&self) -> Result<(), DbError> {
        let today = Utc::now().date_naive();
        let yesterday = today - chrono::Duration::days(1);
        self.rollup_days(&[yesterday, today]).await
    }

    async fn rollup_days(&self, days: &[NaiveDate]) -> Result<(), DbError> {
        for day in days {
            self.store.rollup_day(*day).await?;
        }
        Ok(())
    }
}
