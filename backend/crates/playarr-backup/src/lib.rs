//! Encrypted, consistent server backups and staged restore.
//!
//! Design: `docs/architecture/server-backups.md`.

pub mod archive;
pub mod config;
pub mod crypto;
pub mod error;
pub mod manifest;
pub mod restore;
#[cfg(test)]
mod restore_tests;
pub mod runner;
pub mod s3;
#[cfg(test)]
mod s3_tests;
pub mod snapshot;
pub mod store;
#[cfg(test)]
mod tests;

pub use config::BackupConfig;
pub use error::{BackupError, Result};
pub use runner::BackupService;
