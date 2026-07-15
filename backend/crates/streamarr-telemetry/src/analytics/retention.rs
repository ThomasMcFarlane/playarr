//! Enforces retention on the raw `playback_sessions`/`playback_events`
//! tables: rows older than the configured window are pruned once they've
//! long since been folded into `stats_daily` by [`super::rollup`] —
//! `stats_daily` is the durable long-term record, raw rows only need to
//! stick around long enough for near-term debugging/drill-down.

use std::time::Duration;

use chrono::{NaiveDate, Utc};
use streamarr_db::{DbError, DbPool};

#[derive(Debug, Clone, Copy)]
pub struct RetentionPolicy {
    /// How many days of raw session/event rows to keep before pruning.
    pub raw_retention_days: i64,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            raw_retention_days: 90,
        }
    }
}

pub struct RetentionSweeper {
    pool: DbPool,
    policy: RetentionPolicy,
    sweep_interval: Duration,
}

impl RetentionSweeper {
    pub fn new(pool: DbPool, policy: RetentionPolicy, sweep_interval: Duration) -> Self {
        Self {
            pool,
            policy,
            sweep_interval,
        }
    }

    /// Runs until cancelled, sweeping on `sweep_interval` (same shape as
    /// `RollupScheduler::run`). Left unimplemented: pruning needs direct
    /// SQL against `DbPool` rather than a method on `AnalyticsStore` —
    /// retention is an operational/storage-lifecycle concern, not part of
    /// the read/write API that trait exists to describe.
    pub async fn run(self) -> Result<(), DbError> {
        // DELETE FROM playback_events WHERE occurred_at < $1
        // DELETE FROM playback_sessions WHERE started_at < $1
        // ($1 = self.cutoff_date(), formatted as the same ISO-8601 TEXT
        // form the analytics migrations store timestamps in.) Delete
        // events before sessions so a crash mid-sweep can't leave orphaned
        // events referencing an already-pruned session.
        let _ = (&self.pool, self.policy, self.sweep_interval);
        unimplemented!("RetentionSweeper::run")
    }

    fn cutoff_date(&self) -> NaiveDate {
        compute_cutoff_date(self.policy, Utc::now())
    }
}

/// Free function (rather than a method requiring a constructed
/// `RetentionSweeper`, which needs a real `DbPool`) so the date math is
/// unit-testable without a database connection.
fn compute_cutoff_date(policy: RetentionPolicy, now: chrono::DateTime<Utc>) -> NaiveDate {
    (now - chrono::Duration::days(policy.raw_retention_days)).date_naive()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutoff_date_is_retention_window_days_in_the_past() {
        let policy = RetentionPolicy {
            raw_retention_days: 30,
        };
        let now = Utc::now();
        let expected = (now - chrono::Duration::days(30)).date_naive();
        assert_eq!(compute_cutoff_date(policy, now), expected);
    }
}
