//! Running a backup: preflight, snapshot, archive, atomic publish, retention.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use playarr_db::DbPool;
use serde::Serialize;
use tokio::sync::Mutex as AsyncMutex;

use crate::archive::{sha256_of, write_archive};
use crate::config::BackupConfig;
use crate::error::{BackupError, Result};
use crate::manifest::*;
use crate::s3::S3Store;
use crate::snapshot::{database_size_bytes, hash_file, take_snapshot};
use crate::store;

#[derive(Debug, Clone, Serialize)]
pub struct CurrentRun {
    pub id: String,
    pub started_at: DateTime<Utc>,
    pub trigger: String,
    pub phase: String,
    pub bytes_staged: u64,
}

type FaultHook = Arc<dyn Fn(&str) -> std::io::Result<()> + Send + Sync>;

#[derive(Clone)]
pub struct BackupService {
    config: Arc<BackupConfig>,
    pool: DbPool,
    server_version: String,
    current: Arc<Mutex<Option<CurrentRun>>>,
    gate: Arc<AsyncMutex<()>>,
    remote: Option<S3Store>,
    fault: Option<FaultHook>,
    free_space_override: Option<u64>,
}

impl BackupService {
    pub fn new(config: BackupConfig, pool: DbPool, server_version: impl Into<String>) -> Self {
        let remote = config.s3.clone().map(S3Store::new);
        Self {
            config: Arc::new(config),
            pool,
            server_version: server_version.into(),
            current: Arc::new(Mutex::new(None)),
            gate: Arc::new(AsyncMutex::new(())),
            remote,
            fault: None,
            free_space_override: None,
        }
    }

    pub fn config(&self) -> &BackupConfig {
        &self.config
    }

    pub fn current(&self) -> Option<CurrentRun> {
        self.current.lock().expect("backup state poisoned").clone()
    }

    /// Test hook: called at named points; returning an error simulates a
    /// destination or process failure there.
    #[doc(hidden)]
    pub fn with_fault_hook(mut self, hook: FaultHook) -> Self {
        self.fault = Some(hook);
        self
    }

    /// Test hook: pretend the destination has this much free space.
    #[doc(hidden)]
    pub fn with_free_space(mut self, bytes: u64) -> Self {
        self.free_space_override = Some(bytes);
        self
    }

    fn fault(&self, point: &str) -> Result<()> {
        match &self.fault {
            Some(hook) => hook(point).map_err(BackupError::from),
            None => Ok(()),
        }
    }

    fn set_phase(&self, phase: &str, bytes: Option<u64>) {
        if let Some(run) = self.current.lock().expect("backup state poisoned").as_mut() {
            run.phase = phase.to_string();
            if let Some(bytes) = bytes {
                run.bytes_staged = bytes;
            }
        }
    }

    /// Starts a run in the background and returns its id, or `Busy`.
    pub fn start(&self, trigger: &str) -> Result<String> {
        let guard = self
            .gate
            .clone()
            .try_lock_owned()
            .map_err(|_| BackupError::Busy)?;
        let id = new_backup_id();
        self.begin(&id, trigger);
        let service = self.clone();
        let trigger = trigger.to_string();
        let run_id = id.clone();
        tokio::spawn(async move {
            let _guard = guard;
            if let Err(error) = service.run_locked(run_id, &trigger).await {
                tracing::error!(%error, "backup failed");
            }
        });
        Ok(id)
    }

    /// Runs one backup and waits for it.
    pub async fn run_now(&self, trigger: &str) -> Result<Sidecar> {
        let _guard = self
            .gate
            .clone()
            .try_lock_owned()
            .map_err(|_| BackupError::Busy)?;
        let id = new_backup_id();
        self.begin(&id, trigger);
        self.run_locked(id, trigger).await
    }

    fn begin(&self, id: &str, trigger: &str) {
        *self.current.lock().expect("backup state poisoned") = Some(CurrentRun {
            id: id.to_string(),
            started_at: Utc::now(),
            trigger: trigger.to_string(),
            phase: "starting".to_string(),
            bytes_staged: 0,
        });
    }

    async fn run_locked(&self, id: String, trigger: &str) -> Result<Sidecar> {
        tracing::info!(backup_id = %id, trigger, "backup started");
        let result = self.run_inner(&id).await;
        let phase = self
            .current
            .lock()
            .expect("backup state poisoned")
            .take()
            .map(|run| run.phase)
            .unwrap_or_default();
        match &result {
            Ok(sidecar) => tracing::info!(
                backup_id = %sidecar.manifest.backup_id,
                bytes = sidecar.archive_size,
                "backup completed"
            ),
            Err(error) => {
                let dir = &self.config.dir;
                let _ = std::fs::remove_dir_all(store::staging_dir(dir, &id));
                let _ = store::record_failure(
                    dir,
                    &store::FailureRecord {
                        id: id.clone(),
                        at: Utc::now(),
                        phase,
                        error: error.to_string(),
                    },
                );
            }
        }
        result
    }

    async fn run_inner(&self, id: &str) -> Result<Sidecar> {
        let dir = self.config.dir.clone();
        std::fs::create_dir_all(&dir)?;
        let _lock = store::acquire_lock(&dir)?;
        store::cleanup_stale(&dir, std::time::SystemTime::now());

        self.set_phase("preflight", None);
        let assets = self.plan_assets();
        let db_bytes = database_size_bytes(&self.pool).await?;
        let needed = db_bytes
            .saturating_add(assets.total_bytes())
            .saturating_mul(2);
        let available = match self.free_space_override {
            Some(bytes) => bytes,
            None => fs4::available_space(&dir)?,
        };
        if available < needed {
            return Err(BackupError::InsufficientSpace(format!(
                "{available} bytes available in the backup destination, about {needed} needed"
            )));
        }

        let stage = store::staging_dir(&dir, id);
        std::fs::create_dir_all(&stage)?;
        self.set_phase("snapshot", None);
        self.fault("before_snapshot")?;
        let snapshot = take_snapshot(&self.pool, &stage).await?;
        let mut files = snapshot.files.clone();
        let staged: u64 = files.iter().map(|file| file.size).sum();
        self.set_phase("assets", Some(staged));

        let mut unavailable = Vec::new();
        let mut partial = self.config.mode == BackupMode::Database;
        if self.config.mode == BackupMode::Full {
            match &assets {
                AssetPlan::Include { dir: source, .. } => {
                    let source = source.clone();
                    let target = stage.clone();
                    let copied = tokio::task::spawn_blocking(move || copy_assets(&source, &target))
                        .await
                        .map_err(|error| BackupError::Io(std::io::Error::other(error)))??;
                    files.extend(copied);
                }
                AssetPlan::TooLarge { bytes, .. } => {
                    partial = true;
                    unavailable.push(InventoryItem::new(
                        "artwork cache",
                        format!(
                            "{bytes} bytes exceeds PLAYARR_BACKUP_MAX_ASSET_MIB; \
                             artwork is re-fetched from providers after restore"
                        ),
                    ));
                }
                AssetPlan::None => {}
            }
        }

        self.set_phase("archive", None);
        let created_at = Utc::now();
        let manifest = Manifest {
            format_version: FORMAT_VERSION,
            backup_id: id.to_string(),
            created_at,
            server_version: self.server_version.clone(),
            engine: snapshot.engine,
            schema_version: snapshot.schema_version,
            mode: self.config.mode,
            partial,
            files,
            tables: snapshot.tables.clone(),
            included: inventory_included(&assets, self.config.mode, snapshot.engine),
            excluded: inventory_excluded(),
            unavailable,
            external_dependencies: self.external_dependencies().await,
            node: self.node_info().await,
        };
        let archive_name = archive_file_name(created_at, id);
        let partial_file = store::partial_path(&dir, &archive_name);
        let final_file = dir.join(&archive_name);

        let recipients = self.config.recipients.clone();
        let manifest_for_write = manifest.clone();
        let stage_for_write = stage.clone();
        let partial_for_write = partial_file.clone();
        let written = tokio::task::spawn_blocking(move || {
            write_archive(
                &manifest_for_write,
                &stage_for_write,
                &recipients,
                &partial_for_write,
            )
        })
        .await
        .map_err(|error| BackupError::Io(std::io::Error::other(error)))?;
        let written = match written {
            Ok(written) => written,
            Err(error) => {
                let _ = std::fs::remove_file(&partial_file);
                return Err(error);
            }
        };

        self.set_phase("publish", None);
        let publish = self.publish(
            &dir,
            &partial_file,
            &final_file,
            &manifest,
            &archive_name,
            &written,
        );
        let sidecar = match publish {
            Ok(sidecar) => sidecar,
            Err(error) => {
                let _ = std::fs::remove_file(&partial_file);
                let _ = std::fs::remove_file(&final_file);
                return Err(error);
            }
        };
        let _ = std::fs::remove_dir_all(&stage);

        // Retention only ever runs after a successful publish.
        self.set_phase("retention", None);
        if let Err(error) = store::apply_retention(
            &dir,
            self.config.keep_last,
            self.config.keep_days,
            Utc::now(),
        ) {
            tracing::warn!(%error, "backup retention failed; new backup is intact");
        }

        // Off-node replication never fails the run: the local backup is
        // already complete. A failure is recorded and the next run uploads
        // whatever the bucket still lacks.
        if let Some(remote) = &self.remote {
            self.set_phase("replicate", None);
            let result = match self.fault("before_replicate") {
                Ok(()) => {
                    remote
                        .sync(
                            &dir,
                            self.config.keep_last,
                            self.config.keep_days,
                            Utc::now(),
                        )
                        .await
                }
                Err(error) => Err(error),
            };
            match result {
                Ok(report) => tracing::info!(
                    uploaded = report.uploaded.len(),
                    removed = report.removed.len(),
                    "off-node backup copies are current"
                ),
                Err(error) => {
                    tracing::error!(%error, "off-node replication failed; local backup is intact");
                    let _ = store::record_failure(
                        &dir,
                        &store::FailureRecord {
                            id: id.to_string(),
                            at: Utc::now(),
                            phase: "replicate".to_string(),
                            error: error.to_string(),
                        },
                    );
                }
            }
        }
        Ok(sidecar)
    }

    fn publish(
        &self,
        dir: &Path,
        partial_file: &Path,
        final_file: &Path,
        manifest: &Manifest,
        archive_name: &str,
        written: &crate::archive::WrittenArchive,
    ) -> Result<Sidecar> {
        self.fault("after_archive")?;
        // Read the bytes back from the destination and compare with what was
        // produced, so a short or corrupted write is never published.
        let on_disk = sha256_of(partial_file)?;
        if on_disk != written.sha256 || std::fs::metadata(partial_file)?.len() != written.size {
            return Err(BackupError::Corrupt(
                "archive read back from the destination does not match what was written"
                    .to_string(),
            ));
        }
        std::fs::rename(partial_file, final_file)?;
        store::fsync_dir(dir)?;
        self.fault("before_sidecar")?;
        let sidecar = Sidecar {
            manifest: manifest.clone(),
            archive_name: archive_name.to_string(),
            archive_sha256: written.sha256.clone(),
            archive_size: written.size,
        };
        store::write_sidecar(dir, &sidecar)?;
        Ok(sidecar)
    }

    fn plan_assets(&self) -> AssetPlan {
        if self.config.mode != BackupMode::Full {
            return AssetPlan::None;
        }
        let Some(dir) = self.config.artwork_dir.clone().filter(|dir| dir.is_dir()) else {
            return AssetPlan::None;
        };
        let bytes = directory_size(&dir);
        if bytes > self.config.max_asset_bytes {
            AssetPlan::TooLarge { bytes }
        } else {
            AssetPlan::Include { dir, bytes }
        }
    }

    async fn external_dependencies(&self) -> ExternalDependencies {
        let roots: Vec<String> = sqlx::query_scalar(
            "SELECT COALESCE(local_path_override, reported_path) FROM source_root_folders ORDER BY 1",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();
        ExternalDependencies {
            library_roots: roots,
            required_secrets: vec![
                "DATABASE_URL".to_string(),
                "PLAYARR_JWT_SECRET".to_string(),
                "TLS certificate and key, or ACME configuration (if served over HTTPS)".to_string(),
            ],
        }
    }

    async fn node_info(&self) -> NodeInfo {
        let peer_id: Option<String> =
            sqlx::query_scalar("SELECT peer_id FROM node_identity LIMIT 1")
                .fetch_optional(&self.pool)
                .await
                .ok()
                .flatten();
        let instance_name: Option<String> =
            sqlx::query_scalar("SELECT instance_name FROM system_settings LIMIT 1")
                .fetch_optional(&self.pool)
                .await
                .ok()
                .flatten();
        NodeInfo {
            peer_id,
            instance_name,
        }
    }

    /// Runs scheduled backups until the task is dropped. The next run is due
    /// one interval after the newest complete backup, so restarts do not
    /// reset the schedule and a missed run happens promptly.
    pub async fn run_schedule(self) {
        let Some(interval) = self.config.interval else {
            return;
        };
        loop {
            let due_in = self.time_until_due(interval);
            if due_in.is_zero() {
                match self.run_now("schedule").await {
                    Ok(_) | Err(BackupError::Busy) => {}
                    Err(error) => tracing::warn!(%error, "scheduled backup failed"),
                }
                // A failed run is retried after a short pause, not in a loop.
                tokio::time::sleep(Duration::from_secs(900)).await;
            } else {
                tokio::time::sleep(due_in.min(Duration::from_secs(300))).await;
            }
        }
    }

    fn time_until_due(&self, interval: Duration) -> Duration {
        let newest = store::list_backups(&self.config.dir)
            .ok()
            .and_then(|records| {
                records
                    .into_iter()
                    .find(|record| record.complete)
                    .map(|record| record.sidecar.manifest.created_at)
            });
        match newest {
            None => Duration::ZERO,
            Some(created_at) => {
                let due = created_at
                    + chrono::Duration::from_std(interval).unwrap_or(chrono::Duration::hours(24));
                (due - Utc::now()).to_std().unwrap_or(Duration::ZERO)
            }
        }
    }
}

fn new_backup_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

enum AssetPlan {
    None,
    Include { dir: PathBuf, bytes: u64 },
    TooLarge { bytes: u64 },
}

impl AssetPlan {
    fn total_bytes(&self) -> u64 {
        match self {
            AssetPlan::Include { bytes, .. } => *bytes,
            _ => 0,
        }
    }
}

fn directory_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut pending = vec![dir.to_path_buf()];
    while let Some(current) = pending.pop() {
        let Ok(read) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in read.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                total += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            }
        }
    }
    total
}

/// Copies regular files (no symlinks, no in-progress temporary files) into
/// `assets/artwork` under the staging directory, hashing each as it is copied.
fn copy_assets(source: &Path, stage: &Path) -> Result<Vec<FileEntry>> {
    let mut entries = Vec::new();
    let mut pending = vec![(source.to_path_buf(), String::new())];
    while let Some((current, prefix)) = pending.pop() {
        let Ok(read) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if file_type.is_dir() {
                pending.push((entry.path(), relative));
            } else if file_type.is_file() && !name.contains(".tmp") {
                let archive_path = format!("assets/artwork/{relative}");
                if !is_safe_relative_path(&archive_path) {
                    continue;
                }
                let target = stage.join(&archive_path);
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                // A file can vanish between listing and copy (cache eviction).
                if std::fs::copy(entry.path(), &target).is_err() {
                    let _ = std::fs::remove_file(&target);
                    continue;
                }
                let (size, sha256) = hash_file(&target)?;
                entries.push(FileEntry {
                    path: archive_path,
                    size,
                    sha256,
                });
            }
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

fn inventory_included(assets: &AssetPlan, mode: BackupMode, engine: Engine) -> Vec<InventoryItem> {
    let mut items = vec![
        InventoryItem::new(
            "database",
            match engine {
                Engine::Sqlite => "consistent SQLite snapshot (catalogue, libraries and source configuration, users, permissions, profiles, history, progress, playlists, preferences, peer identity, settings)",
                Engine::Postgres => "single-snapshot PostgreSQL row export in foreign-key order (catalogue, libraries and source configuration, users, permissions, profiles, history, progress, playlists, preferences, peer identity, settings)",
            },
        ),
    ];
    if matches!(assets, AssetPlan::Include { .. }) && mode == BackupMode::Full {
        items.push(InventoryItem::new(
            "artwork cache",
            "server-managed artwork files",
        ));
    }
    items
}

fn inventory_excluded() -> Vec<InventoryItem> {
    vec![
        InventoryItem::new(
            "media libraries",
            "files owned by libraries and media managers are never copied; see external dependencies",
        ),
        InventoryItem::new(
            "derived caches",
            "thumbnails, subtitle conversions, transcode and HLS output and download staging are regenerated on demand",
        ),
        InventoryItem::new(
            "coordination state",
            "leader lease and cache entries are ephemeral",
        ),
        InventoryItem::new(
            "runtime secrets",
            "environment and Secret values (database URL, JWT secret, TLS and ACME material) are never stored in the archive",
        ),
    ]
}
