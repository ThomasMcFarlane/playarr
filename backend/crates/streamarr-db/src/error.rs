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
