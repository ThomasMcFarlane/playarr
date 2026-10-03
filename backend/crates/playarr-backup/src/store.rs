//! The backup destination: listing, atomic publish helpers, retention,
//! failure records and the cross-process lock.

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{BackupError, Result};
use crate::manifest::{sidecar_file_name, Sidecar, ARCHIVE_EXTENSION, ARCHIVE_PREFIX};

const STAGING_PREFIX: &str = ".staging-";
const FAILURES_DIR: &str = "failures";
const LOCK_NAME: &str = ".backup.lock";
/// Staging directories and partial archives older than this are leftovers of
/// an interrupted run and are removed.
const STALE_AFTER_HOURS: i64 = 24;
const FAILURE_RETENTION_DAYS: i64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRecord {
    pub sidecar: Sidecar,
    /// The archive named by the sidecar exists with the recorded size.
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FailureRecord {
    pub id: String,
    pub at: DateTime<Utc>,
    pub phase: String,
    pub error: String,
}

pub struct LockGuard {
    _file: File,
}

/// Holds an exclusive advisory lock on the destination so two servers (or two
/// processes) sharing it never write at once. Released when dropped or when the
/// process dies.
pub fn acquire_lock(dir: &Path) -> Result<LockGuard> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LOCK_NAME))?;
    match file.try_lock() {
        Ok(()) => Ok(LockGuard { _file: file }),
        Err(std::fs::TryLockError::WouldBlock) => Err(BackupError::Busy),
        Err(std::fs::TryLockError::Error(error)) => Err(error.into()),
    }
}

pub fn staging_dir(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{STAGING_PREFIX}{id}"))
}

pub fn partial_path(dir: &Path, archive_name: &str) -> PathBuf {
    dir.join(format!("{archive_name}.partial"))
}

pub fn fsync_dir(dir: &Path) -> Result<()> {
    File::open(dir)?.sync_all()?;
    Ok(())
}

/// Lists every sidecar in the destination, newest first. Unreadable sidecars
/// are skipped (they cannot be trusted as a commit marker).
pub fn list_backups(dir: &Path) -> Result<Vec<BackupRecord>> {
    let mut records = Vec::new();
    let read = match std::fs::read_dir(dir) {
        Ok(read) => read,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(records),
        Err(error) => return Err(error.into()),
    };
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(ARCHIVE_PREFIX)
            || !name.ends_with(&format!(".{ARCHIVE_EXTENSION}.json"))
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        let Ok(sidecar) = serde_json::from_slice::<Sidecar>(&bytes) else {
            continue;
        };
        let complete = std::fs::metadata(dir.join(&sidecar.archive_name))
            .map(|meta| meta.len() == sidecar.archive_size)
            .unwrap_or(false);
        records.push(BackupRecord { sidecar, complete });
    }
    records.sort_by(|a, b| {
        b.sidecar
            .manifest
            .created_at
            .cmp(&a.sidecar.manifest.created_at)
    });
    Ok(records)
}

pub fn find_backup(dir: &Path, id: &str) -> Result<BackupRecord> {
    list_backups(dir)?
        .into_iter()
        .find(|record| record.sidecar.manifest.backup_id == id)
        .ok_or(BackupError::NotFound)
}

pub fn write_sidecar(dir: &Path, sidecar: &Sidecar) -> Result<()> {
    let final_path = dir.join(sidecar_file_name(&sidecar.archive_name));
    let temp = dir.join(format!("{}.tmp", sidecar_file_name(&sidecar.archive_name)));
    std::fs::write(&temp, serde_json::to_vec_pretty(sidecar)?)?;
    File::open(&temp)?.sync_all()?;
    std::fs::rename(&temp, &final_path)?;
    fsync_dir(dir)?;
    Ok(())
}

pub fn record_failure(dir: &Path, failure: &FailureRecord) -> Result<()> {
    let failures = dir.join(FAILURES_DIR);
    std::fs::create_dir_all(&failures)?;
    let name = format!(
        "{}-{}.json",
        failure.at.format("%Y%m%dT%H%M%SZ"),
        failure.id
    );
    std::fs::write(failures.join(name), serde_json::to_vec_pretty(failure)?)?;
    Ok(())
}

pub fn list_failures(dir: &Path, limit: usize) -> Vec<FailureRecord> {
    let mut failures: Vec<FailureRecord> = std::fs::read_dir(dir.join(FAILURES_DIR))
        .map(|read| {
            read.flatten()
                .filter_map(|entry| std::fs::read(entry.path()).ok())
                .filter_map(|bytes| serde_json::from_slice(&bytes).ok())
                .collect()
        })
        .unwrap_or_default();
    failures.sort_by_key(|failure| std::cmp::Reverse(failure.at));
    failures.truncate(limit);
    failures
}

/// Deletes the archive and sidecar of one backup. The last complete backup is
/// never removed.
pub fn delete_backup(dir: &Path, id: &str) -> Result<()> {
    let target = find_backup(dir, id)?;
    let others_complete = list_backups(dir)?
        .into_iter()
        .filter(|record| record.complete && record.sidecar.manifest.backup_id != id)
        .count();
    if target.complete && others_complete == 0 {
        return Err(BackupError::Refused(
            "this is the only complete backup; create another before deleting it".to_string(),
        ));
    }
    remove_backup_files(dir, &target.sidecar);
    Ok(())
}

fn remove_backup_files(dir: &Path, sidecar: &Sidecar) {
    // Sidecar first: without it the archive is no longer advertised.
    let _ = std::fs::remove_file(dir.join(sidecar_file_name(&sidecar.archive_name)));
    let _ = std::fs::remove_file(dir.join(&sidecar.archive_name));
}

/// Applies retention after a successful run. Keeps the newest `keep_last`
/// complete backups and any complete backup younger than `keep_days`, and
/// always at least one complete backup. Incomplete records (sidecar without a
/// matching archive) are cleared. Returns the ids removed.
pub fn apply_retention(
    dir: &Path,
    keep_last: usize,
    keep_days: i64,
    now: DateTime<Utc>,
) -> Result<Vec<String>> {
    let records = list_backups(dir)?;
    let cutoff = now - Duration::days(keep_days);
    let mut removed = Vec::new();
    let mut kept_complete = 0usize;
    for record in &records {
        if !record.complete {
            remove_backup_files(dir, &record.sidecar);
            removed.push(record.sidecar.manifest.backup_id.clone());
            continue;
        }
        let within_count = kept_complete < keep_last.max(1);
        let within_age = keep_days > 0 && record.sidecar.manifest.created_at >= cutoff;
        if kept_complete == 0 || within_count || within_age {
            kept_complete += 1;
        } else {
            remove_backup_files(dir, &record.sidecar);
            removed.push(record.sidecar.manifest.backup_id.clone());
        }
    }
    prune_failures(dir, now);
    Ok(removed)
}

fn prune_failures(dir: &Path, now: DateTime<Utc>) {
    let cutoff = now - Duration::days(FAILURE_RETENTION_DAYS);
    for failure in list_failures(dir, usize::MAX) {
        if failure.at < cutoff {
            let name = format!(
                "{}-{}.json",
                failure.at.format("%Y%m%dT%H%M%SZ"),
                failure.id
            );
            let _ = std::fs::remove_file(dir.join(FAILURES_DIR).join(name));
        }
    }
}

/// Removes staging directories and partial archives left by interrupted runs.
pub fn cleanup_stale(dir: &Path, now: std::time::SystemTime) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let leftover = name.starts_with(STAGING_PREFIX)
            || name.ends_with(".partial")
            || name.ends_with(".json.tmp");
        if !leftover {
            continue;
        }
        let age_ok = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age.as_secs() as i64 >= STALE_AFTER_HOURS * 3600)
            .unwrap_or(false);
        if age_ok {
            let path = entry.path();
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(path);
            } else {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::*;

    pub fn sample(dir: &Path, id: &str, age_days: i64, write_archive: bool) -> Sidecar {
        let created_at = Utc::now() - Duration::days(age_days);
        let manifest = Manifest {
            format_version: FORMAT_VERSION,
            backup_id: id.to_string(),
            created_at,
            server_version: "test".into(),
            engine: Engine::Sqlite,
            schema_version: 1,
            mode: BackupMode::Full,
            partial: false,
            files: vec![],
            tables: vec![],
            included: vec![],
            excluded: vec![],
            unavailable: vec![],
            external_dependencies: ExternalDependencies::default(),
            node: NodeInfo {
                peer_id: None,
                instance_name: None,
            },
        };
        let archive_name = archive_file_name(created_at, id);
        if write_archive {
            std::fs::write(dir.join(&archive_name), b"12345").unwrap();
        }
        let sidecar = Sidecar {
            manifest,
            archive_name,
            archive_sha256: "00".into(),
            archive_size: 5,
        };
        write_sidecar(dir, &sidecar).unwrap();
        sidecar
    }

    #[test]
    fn retention_keeps_newest_and_never_the_last_good() {
        let dir = tempfile::tempdir().unwrap();
        for (id, age) in [("a", 0), ("b", 1), ("c", 40), ("d", 60)] {
            sample(dir.path(), id, age, true);
        }
        let removed = apply_retention(dir.path(), 2, 30, Utc::now()).unwrap();
        assert_eq!(removed, vec!["c".to_string(), "d".to_string()]);

        // Everything old and a keep_last of 1: the newest complete one survives.
        let dir = tempfile::tempdir().unwrap();
        sample(dir.path(), "old", 400, true);
        let removed = apply_retention(dir.path(), 1, 30, Utc::now()).unwrap();
        assert!(removed.is_empty());
        assert_eq!(list_backups(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn incomplete_records_do_not_count_as_good_backups() {
        let dir = tempfile::tempdir().unwrap();
        sample(dir.path(), "good", 5, true);
        sample(dir.path(), "broken", 0, false);
        let records = list_backups(dir.path()).unwrap();
        assert_eq!(records.len(), 2);
        assert!(!records[0].complete);
        // Retention clears the broken record but keeps the good archive.
        let removed = apply_retention(dir.path(), 1, 0, Utc::now()).unwrap();
        assert_eq!(removed, vec!["broken".to_string()]);
        assert!(list_backups(dir.path()).unwrap()[0].complete);
    }

    #[test]
    fn last_complete_backup_cannot_be_deleted() {
        let dir = tempfile::tempdir().unwrap();
        sample(dir.path(), "only", 0, true);
        assert!(matches!(
            delete_backup(dir.path(), "only"),
            Err(BackupError::Refused(_))
        ));
        sample(dir.path(), "second", 1, true);
        delete_backup(dir.path(), "second").unwrap();
    }

    #[test]
    fn second_lock_is_refused_while_the_first_is_held() {
        let dir = tempfile::tempdir().unwrap();
        let first = acquire_lock(dir.path()).unwrap();
        assert!(matches!(acquire_lock(dir.path()), Err(BackupError::Busy)));
        drop(first);
        acquire_lock(dir.path()).unwrap();
    }
}
