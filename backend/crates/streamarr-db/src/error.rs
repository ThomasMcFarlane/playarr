//! The one error type every `streamarr-db` trait method returns.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("record not found")]
    NotFound,

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("migration failed: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    /// JSON (de)serialization of a column value (e.g. `Work::images`,
    /// `PlaybackEvent::kind`'s payload) failed. Kept distinct from
    /// `Backend` because it's a data-shape problem, not a connectivity/SQL
    /// one.
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error(transparent)]
    Backend(#[from] sqlx::Error),
}

impl DbError {
    /// True when this is a database-reported constraint violation (`UNIQUE`
    /// or `FOREIGN KEY`) rather than a transient/connection failure (a
    /// network blip, pool exhaustion, the database briefly unreachable,
    /// a bad query, ...).
    ///
    /// `streamarr-peer-sync::account_sync::sync_accounts` uses this to
    /// decide whether one bad synced row should be isolated -- logged to
    /// `sync_conflict_log` and skipped, with the rest of the page still
    /// applying -- rather than aborting/retrying the whole sync pass. The
    /// motivating case: two peers each independently create a `users` row
    /// with the same `username`. Different `id`s, so `UserRepo::
    /// apply_synced`'s `ON CONFLICT (id)` upsert can't catch it -- the
    /// failing constraint is `users.username`'s own `UNIQUE` index, a
    /// different column entirely -- and the raw `sqlx::Error` propagates
    /// out of `apply_synced` instead. A transient error must still
    /// propagate and abort the pass exactly as before this method existed:
    /// skipping a row that merely failed to apply for connectivity reasons
    /// would silently drop a perfectly good write, not a genuinely
    /// conflicting one. See `docs/architecture/peer-groups.md` §3.5.
    pub fn is_constraint_violation(&self) -> bool {
        match self {
            DbError::Backend(err) => err
                .as_database_error()
                .map(|db_err| db_err.is_unique_violation() || db_err.is_foreign_key_violation())
                .unwrap_or(false),
            _ => false,
        }
    }
}
