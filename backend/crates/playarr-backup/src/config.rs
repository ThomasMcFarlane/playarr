//! Environment-driven backup configuration. Backups are off unless
//! `PLAYARR_BACKUP_DIR` is set. `PLAYARR_BACKUP_S3_*` adds an off-node replica
//! (see `s3.rs`).

use std::path::PathBuf;
use std::time::Duration;

use age::x25519::Recipient;

use crate::crypto::{fingerprint, parse_recipients};
use crate::error::{BackupError, Result};
use crate::manifest::BackupMode;
use crate::s3::S3Config;

pub const DEFAULT_KEEP_LAST: usize = 7;
pub const DEFAULT_KEEP_DAYS: i64 = 30;
pub const DEFAULT_INTERVAL_HOURS: u64 = 24;
pub const DEFAULT_MAX_ASSET_MIB: u64 = 4096;

#[derive(Debug, Clone)]
pub struct BackupConfig {
    pub dir: PathBuf,
    pub recipients: Vec<Recipient>,
    pub mode: BackupMode,
    /// `None` means manual runs only.
    pub interval: Option<Duration>,
    pub keep_last: usize,
    pub keep_days: i64,
    pub artwork_dir: Option<PathBuf>,
    pub max_asset_bytes: u64,
    /// Optional off-node replica (`PLAYARR_BACKUP_S3_*`). The local
    /// destination always stays.
    pub s3: Option<S3Config>,
}

impl BackupConfig {
    pub fn from_env() -> Result<Option<Self>> {
        Self::from_lookup(&|key| std::env::var(key).ok())
    }

    pub fn from_lookup(lookup: &dyn Fn(&str) -> Option<String>) -> Result<Option<Self>> {
        let Some(dir) = lookup("PLAYARR_BACKUP_DIR").filter(|value| !value.trim().is_empty())
        else {
            return Ok(None);
        };
        let raw_recipients = lookup("PLAYARR_BACKUP_RECIPIENTS").unwrap_or_default();
        let items: Vec<&str> = raw_recipients
            .split([',', '\n', ' '])
            .filter(|item| !item.is_empty())
            .collect();
        let recipients = parse_recipients(&items)?;

        let mode = match lookup("PLAYARR_BACKUP_MODE") {
            None => BackupMode::Full,
            Some(raw) => BackupMode::parse(&raw).ok_or_else(|| {
                BackupError::Config("PLAYARR_BACKUP_MODE must be `full` or `database`".to_string())
            })?,
        };
        let interval_hours = number(
            lookup,
            "PLAYARR_BACKUP_INTERVAL_HOURS",
            DEFAULT_INTERVAL_HOURS,
        )?;
        let keep_last = number(lookup, "PLAYARR_BACKUP_KEEP_LAST", DEFAULT_KEEP_LAST as u64)?;
        let keep_days = number(lookup, "PLAYARR_BACKUP_KEEP_DAYS", DEFAULT_KEEP_DAYS as u64)?;
        let max_asset_mib = number(
            lookup,
            "PLAYARR_BACKUP_MAX_ASSET_MIB",
            DEFAULT_MAX_ASSET_MIB,
        )?;

        Ok(Some(Self {
            dir: PathBuf::from(dir),
            recipients,
            mode,
            interval: (interval_hours > 0).then(|| Duration::from_secs(interval_hours * 3600)),
            keep_last: keep_last.max(1) as usize,
            keep_days: keep_days as i64,
            artwork_dir: None,
            max_asset_bytes: max_asset_mib.saturating_mul(1024 * 1024),
            s3: S3Config::from_lookup(lookup)?,
        }))
    }

    pub fn recipient_fingerprints(&self) -> Vec<String> {
        self.recipients.iter().map(fingerprint).collect()
    }
}

fn number(lookup: &dyn Fn(&str) -> Option<String>, key: &str, default: u64) -> Result<u64> {
    match lookup(key) {
        None => Ok(default),
        Some(raw) => raw
            .trim()
            .parse()
            .map_err(|_| BackupError::Config(format!("{key} must be a non-negative integer"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::generate_key;
    use std::collections::HashMap;

    fn lookup(map: HashMap<&'static str, String>) -> impl Fn(&str) -> Option<String> {
        move |key| map.get(key).cloned()
    }

    #[test]
    fn disabled_without_directory() {
        assert!(BackupConfig::from_lookup(&lookup(HashMap::new()))
            .unwrap()
            .is_none());
    }

    #[test]
    fn directory_without_recipient_is_rejected() {
        let map = HashMap::from([("PLAYARR_BACKUP_DIR", "/data/backups".to_string())]);
        assert!(BackupConfig::from_lookup(&lookup(map)).is_err());
    }

    #[test]
    fn defaults_and_overrides() {
        let key = generate_key();
        let map = HashMap::from([
            ("PLAYARR_BACKUP_DIR", "/data/backups".to_string()),
            ("PLAYARR_BACKUP_RECIPIENTS", key.public),
            ("PLAYARR_BACKUP_MODE", "database".to_string()),
            ("PLAYARR_BACKUP_INTERVAL_HOURS", "0".to_string()),
        ]);
        let config = BackupConfig::from_lookup(&lookup(map)).unwrap().unwrap();
        assert_eq!(config.mode, BackupMode::Database);
        assert!(config.interval.is_none());
        assert_eq!(config.keep_last, DEFAULT_KEEP_LAST);
        assert_eq!(config.recipient_fingerprints().len(), 1);
    }
}
