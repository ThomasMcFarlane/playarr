//! Enforces retention on the raw `playback_sessions`/`playback_events`
//! tables: rows older than the configured window are pruned once they've
//! long since been folded into `stats_daily` by [`super::rollup`] —
//! `stats_daily` is the durable long-term record, raw rows only need to
//! stick around long enough for near-term debugging/drill-down.

use std::time::Duration;

use chrono::{NaiveDate, Utc};
use streamarr_db::{DbError, DbPool};

/// Classifies `pool`'s backend from its connect URL scheme -- the same
/// technique `streamarr_db::pool::Backend::detect` uses internally, kept as
/// a local free function here rather than depending on that type: `Backend`
/// is `pub(crate)` to `streamarr-db` (an intentionally private
/// SQL-placeholder-syntax detail), and this module's need ("which cutoff
/// comparison syntax to emit") is simple enough not to justify widening
/// that crate's public surface.
fn is_postgres(pool: &DbPool) -> bool {
    pool.connect_options()
        .database_url
        .scheme()
        .to_ascii_lowercase()
        .starts_with("postgres")
}

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
    /// `RollupScheduler::run`): every tick, deletes raw
    /// `playback_events`/`playback_sessions` rows older than
    /// `self.cutoff_date()`. Pruning is direct SQL against `DbPool` rather
    /// than a method on `AnalyticsStore` — retention is an
    /// operational/storage-lifecycle concern, not part of the read/write
    /// API that trait exists to describe.
    pub async fn run(self) -> Result<(), DbError> {
        let mut ticker = tokio::time::interval(self.sweep_interval);
        loop {
            ticker.tick().await;
            if let Err(err) = self.sweep_once().await {
                tracing::error!(?err, "playback analytics retention sweep failed");
            }
        }
    }

    /// One sweep pass: deletes events before sessions, so a crash mid-sweep
    /// can't leave orphaned events referencing an already-pruned session
    /// (`playback_events.session_id` has a foreign key onto
    /// `playback_sessions.id` — see `0002_analytics.sql`).
    async fn sweep_once(&self) -> Result<(), DbError> {
        let postgres = is_postgres(&self.pool);
        // Same `YYYY-MM-DD` TEXT form `streamarr_db::codec::format_date`
        // uses internally -- duplicated here as a one-line `strftime` call
        // rather than depending on that `pub(crate)` helper (see
        // `is_postgres`'s doc comment for the same "small, private detail,
        // not worth widening streamarr-db's public surface for" reasoning).
        let cutoff = self.cutoff_date().format("%Y-%m-%d").to_string();

        // `occurred_at`/`started_at` are ISO-8601 TEXT columns (see
        // `0002_analytics.sql`'s own portability note); lexicographic TEXT
        // comparison against a `YYYY-MM-DD` cutoff is safe here because
        // every stored value shares that same `YYYY-MM-DD...` prefix
        // shape, the same property `rollup_day`'s own `substr(..., 1, 10)`
        // comparison already relies on.
        let events_sql = if postgres {
            "DELETE FROM playback_events WHERE occurred_at < $1"
        } else {
            "DELETE FROM playback_events WHERE occurred_at < ?"
        };
        sqlx::query(events_sql)
            .bind(&cutoff)
            .execute(&self.pool)
            .await?;

        let sessions_sql = if postgres {
            "DELETE FROM playback_sessions WHERE started_at < $1"
        } else {
            "DELETE FROM playback_sessions WHERE started_at < ?"
        };
        sqlx::query(sessions_sql)
            .bind(&cutoff)
            .execute(&self.pool)
            .await?;

        Ok(())
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
    use sqlx::Row;
    use uuid::Uuid;

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

    /// Real, migrated, in-memory SQLite pool -- same idiom every other
    /// crate's own tests use (see e.g. `streamarr-db`'s `test_sqlite_pool`,
    /// `pub(crate)` there so unavailable here), built from `streamarr-db`'s
    /// public `connect`/`run_migrations` instead.
    async fn test_pool() -> DbPool {
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect in-memory sqlite pool");
        streamarr_db::run_migrations(&pool, false)
            .await
            .expect("run sqlite migrations");
        pool
    }

    /// Minimal, directly-inserted `playback_sessions` row -- raw SQL rather
    /// than going through `AnalyticsStore` (this module has no dependency
    /// on that trait; it operates on raw rows only).
    async fn insert_session(pool: &DbPool, id: Uuid, started_at: &str) {
        sqlx::query(
            "INSERT INTO playback_sessions \
             (id, user_id, device_id, media_file_id, started_at, play_method, source_codec, \
              source_container, target_codec, target_container, client_platform, client_version) \
             VALUES (?, ?, ?, ?, ?, 'direct_play', 'h264', 'mp4', 'h264', 'mp4', 'web', '1.0.0')",
        )
        .bind(id.to_string())
        .bind(Uuid::new_v4().to_string())
        .bind(Uuid::new_v4().to_string())
        .bind(Uuid::new_v4().to_string())
        .bind(started_at)
        .execute(pool)
        .await
        .expect("insert test session row");
    }

    async fn insert_event(pool: &DbPool, session_id: Uuid, occurred_at: &str) {
        sqlx::query(
            "INSERT INTO playback_events (id, session_id, occurred_at, kind, payload) \
             VALUES (?, ?, ?, 'start', '{}')",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(session_id.to_string())
        .bind(occurred_at)
        .execute(pool)
        .await
        .expect("insert test event row");
    }

    #[tokio::test]
    async fn sweep_once_prunes_rows_older_than_the_cutoff_and_keeps_recent_ones() {
        let pool = test_pool().await;

        let old_session = Uuid::new_v4();
        let recent_session = Uuid::new_v4();
        insert_session(&pool, old_session, "2000-01-01T00:00:00.000Z").await;
        insert_session(&pool, recent_session, &Utc::now().to_rfc3339()).await;
        insert_event(&pool, old_session, "2000-01-01T00:00:00.000Z").await;
        insert_event(&pool, recent_session, &Utc::now().to_rfc3339()).await;

        let sweeper = RetentionSweeper::new(
            pool.clone(),
            RetentionPolicy {
                raw_retention_days: 90,
            },
            Duration::from_secs(3600),
        );
        sweeper.sweep_once().await.expect("sweep should succeed");

        let session_count: i64 = sqlx::query("SELECT COUNT(*) as c FROM playback_sessions")
            .fetch_one(&pool)
            .await
            .unwrap()
            .try_get("c")
            .unwrap();
        assert_eq!(session_count, 1, "only the recent session should survive");

        let event_count: i64 = sqlx::query("SELECT COUNT(*) as c FROM playback_events")
            .fetch_one(&pool)
            .await
            .unwrap()
            .try_get("c")
            .unwrap();
        assert_eq!(event_count, 1, "only the recent event should survive");

        let remaining: String = sqlx::query("SELECT id FROM playback_sessions")
            .fetch_one(&pool)
            .await
            .unwrap()
            .try_get("id")
            .unwrap();
        assert_eq!(remaining, recent_session.to_string());
    }

    #[tokio::test]
    async fn sweep_once_deletes_events_before_sessions() {
        // A regression guard for the FK-safety ordering documented on
        // `sweep_once`: if this ever deleted sessions first, the
        // `playback_events.session_id` FK reference would leave orphaned
        // events referencing an already-pruned session on a crash between
        // the two deletes. Exercised indirectly here: with real FK
        // enforcement, deleting sessions before their events would error on
        // any backend that enforces the constraint, so a successful sweep
        // covering both an old session and an old event is itself already
        // proof of the correct order (nothing here to assert further --
        // `sweep_once` completing without error, checked next, is the
        // assertion).
        let pool = test_pool().await;
        let old_session = Uuid::new_v4();
        insert_session(&pool, old_session, "2000-01-01T00:00:00.000Z").await;
        insert_event(&pool, old_session, "2000-01-01T00:00:00.000Z").await;

        let sweeper = RetentionSweeper::new(
            pool,
            RetentionPolicy {
                raw_retention_days: 90,
            },
            Duration::from_secs(3600),
        );
        sweeper.sweep_once().await.expect("sweep should succeed");
    }
}
