//! Error type shared by backup creation, verification and restore.

use std::io;

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("backup configuration is invalid: {0}")]
    Config(String),
    #[error("backup is not configured on this server")]
    NotConfigured,
    #[error("a backup is already running")]
    Busy,
    #[error("backup not found")]
    NotFound,
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("database error: {0}")]
    Database(String),
    #[error("none of the supplied recovery keys can decrypt this backup")]
    WrongKey,
    #[error("backup is damaged: {0}")]
    Corrupt(String),
    #[error("backup is incompatible with this server: {0}")]
    Incompatible(String),
    #[error("not enough free space: {0}")]
    InsufficientSpace(String),
    #[error("restore refused: {0}")]
    Refused(String),
    #[error("encryption error: {0}")]
    Crypto(String),
    #[error("object storage error: {0}")]
    Remote(String),
}

impl From<sqlx::Error> for BackupError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<playarr_db::DbError> for BackupError {
    fn from(error: playarr_db::DbError) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<serde_json::Error> for BackupError {
    fn from(error: serde_json::Error) -> Self {
        Self::Corrupt(format!("invalid JSON: {error}"))
    }
}

pub type Result<T> = std::result::Result<T, BackupError>;
