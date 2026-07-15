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

    #[error(transparent)]
    Backend(#[from] sqlx::Error),
}
