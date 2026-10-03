//! Export jobs: a node-local, time-limited staging area for the user's own
//! package. See `docs/architecture/user-portability.md`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, Utc};
use playarr_model::WatchState;
use playarr_portability::{
    PlaybackPreferenceRecord, Playlist, PlaylistEntry, UserDataPackage, WatchRecord,
    WatchlistRecord,
};
use serde::Serialize;
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use uuid::Uuid;

use super::resolve::Resolver;
use crate::error::ApiError;
use crate::AppState;

/// How long a finished package stays downloadable.
pub const EXPORT_TTL: Duration = Duration::minutes(30);
/// How long an expired job remains listed (without its file) so a stale
/// link answers "gone" rather than "unknown".
const TOMBSTONE_TTL: Duration = Duration::hours(24);
const MAX_JOBS_PER_USER: usize = 10;
const MAX_CONCURRENT_JOBS: usize = 2;
const MAX_RECORDS: usize = 500_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExportStatus {
    Queued,
    Running,
    Ready,
    Failed,
    Expired,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct ExportProgress {
    /// Current stage: `queued`, `watch_progress`, `playback_preferences`,
    /// `playlists`, `packaging` or `done`.
    pub stage: String,
    pub done: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct ExportCounts {
    pub watch_progress: usize,
    pub playback_preferences: usize,
    pub playlists: usize,
    pub playlist_items: usize,
    pub watchlist: usize,
    /// Rows left out because their content no longer exists or is outside
    /// this account's library permissions.
    pub skipped: usize,
}

#[derive(Debug, Clone)]
pub struct ExportJob {
    pub id: String,
    pub user_id: Uuid,
    pub status: ExportStatus,
    pub created_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub progress: ExportProgress,
    pub counts: ExportCounts,
    pub size_bytes: Option<u64>,
    pub file: Option<PathBuf>,
    pub error: Option<String>,
}

/// Node-local registry of export jobs and their temporary files.
pub struct ExportRegistry {
    jobs: Mutex<HashMap<String, ExportJob>>,
    permits: Arc<Semaphore>,
    dir: PathBuf,
}

impl Default for ExportRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ExportRegistry {
    pub fn new() -> Self {
        let base = std::env::temp_dir().join("playarr-user-exports");
        // Files left by an earlier process are far older than any live job's
        // time to live; remove those and nothing else.
        if let Ok(entries) = std::fs::read_dir(&base) {
            let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
            for entry in entries.flatten() {
                let old = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .is_ok_and(|modified| modified < cutoff);
                if old {
                    let path = entry.path();
                    let _ = if path.is_dir() {
                        std::fs::remove_dir_all(path)
                    } else {
                        std::fs::remove_file(path)
                    };
                }
            }
        }
        let dir = base.join(Uuid::new_v4().simple().to_string());
        let _ = std::fs::create_dir_all(&dir);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        Self {
            jobs: Mutex::new(HashMap::new()),
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT_JOBS)),
            dir,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, ExportJob>> {
        self.jobs.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Expires finished jobs past their time to live (deleting the file) and
    /// forgets old tombstones. Cheap; called on every request.
    pub fn sweep(&self) {
        let now = Utc::now();
        let mut jobs = self.lock();
        for job in jobs.values_mut() {
            if job.status == ExportStatus::Ready && job.expires_at.is_some_and(|at| at <= now) {
                if let Some(file) = job.file.take() {
                    let _ = std::fs::remove_file(file);
                }
                job.status = ExportStatus::Expired;
            }
        }
        jobs.retain(|_, job| match job.status {
            ExportStatus::Expired | ExportStatus::Failed => {
                job.finished_at.is_none_or(|at| now - at < TOMBSTONE_TTL)
            }
            _ => true,
        });
    }

    /// The caller's own jobs, newest first.
    pub fn list_for(&self, user_id: Uuid) -> Vec<ExportJob> {
        self.sweep();
        let mut jobs: Vec<ExportJob> = self
            .lock()
            .values()
            .filter(|job| job.user_id == user_id)
            .cloned()
            .collect();
        jobs.sort_by_key(|job| std::cmp::Reverse(job.created_at));
        jobs
    }

    /// `None` for an unknown id *and* for another user's id.
    pub fn get_for(&self, user_id: Uuid, id: &str) -> Option<ExportJob> {
        self.sweep();
        self.lock()
            .get(id)
            .filter(|job| job.user_id == user_id)
            .cloned()
    }

    pub fn remove_for(&self, user_id: Uuid, id: &str) -> bool {
        let mut jobs = self.lock();
        match jobs.get(id) {
            Some(job) if job.user_id == user_id => {
                if let Some(file) = &job.file {
                    let _ = std::fs::remove_file(file);
                }
                jobs.remove(id);
                true
            }
            _ => false,
        }
    }

    /// Test hook: make a ready job's download window end now.
    #[cfg(test)]
    pub fn expire_now(&self, id: &str) {
        self.update(id, |job| {
            job.expires_at = Some(Utc::now() - Duration::seconds(1))
        });
    }

    fn update(&self, id: &str, change: impl FnOnce(&mut ExportJob)) {
        if let Some(job) = self.lock().get_mut(id) {
            change(job);
        }
    }

    /// Starts a job for `user_id`, or returns the user's unfinished one.
    pub fn start(
        self: &Arc<Self>,
        state: AppState,
        user_id: Uuid,
        allowed: Option<Vec<Uuid>>,
    ) -> ExportJob {
        self.sweep();
        let job = {
            let mut jobs = self.lock();
            if let Some(active) = jobs.values().find(|job| {
                job.user_id == user_id
                    && matches!(job.status, ExportStatus::Queued | ExportStatus::Running)
            }) {
                return active.clone();
            }
            // Bound the per-user history; the oldest entries make room.
            let mut own: Vec<(String, DateTime<Utc>)> = jobs
                .values()
                .filter(|job| job.user_id == user_id)
                .map(|job| (job.id.clone(), job.created_at))
                .collect();
            own.sort_by_key(|(_, created)| *created);
            while own.len() >= MAX_JOBS_PER_USER {
                let (oldest, _) = own.remove(0);
                if let Some(old) = jobs.remove(&oldest) {
                    if let Some(file) = old.file {
                        let _ = std::fs::remove_file(file);
                    }
                }
            }
            let job = ExportJob {
                id: playarr_auth::secret::opaque_token(),
                user_id,
                status: ExportStatus::Queued,
                created_at: Utc::now(),
                finished_at: None,
                expires_at: None,
                progress: ExportProgress {
                    stage: "queued".into(),
                    done: 0,
                    total: 0,
                },
                counts: ExportCounts::default(),
                size_bytes: None,
                file: None,
                error: None,
            };
            jobs.insert(job.id.clone(), job.clone());
            job
        };
        let registry = Arc::clone(self);
        let id = job.id.clone();
        tokio::spawn(async move {
            let Ok(_permit) = registry.permits.clone().acquire_owned().await else {
                return;
            };
            registry.update(&id, |job| job.status = ExportStatus::Running);
            let outcome = registry.run(&state, &id, user_id, allowed).await;
            registry.update(&id, |job| {
                job.finished_at = Some(Utc::now());
                match outcome {
                    Ok((path, size, counts)) => {
                        job.status = ExportStatus::Ready;
                        job.expires_at = Some(Utc::now() + EXPORT_TTL);
                        job.file = Some(path);
                        job.size_bytes = Some(size);
                        job.counts = counts;
                        job.progress = ExportProgress {
                            stage: "done".into(),
                            done: 1,
                            total: 1,
                        };
                    }
                    Err(message) => {
                        job.status = ExportStatus::Failed;
                        job.error = Some(message);
                    }
                }
            });
        });
        job
    }

    async fn run(
        &self,
        state: &AppState,
        id: &str,
        user_id: Uuid,
        allowed: Option<Vec<Uuid>>,
    ) -> Result<(PathBuf, u64, ExportCounts), String> {
        let progress = |stage: &str, done: usize, total: usize| {
            self.update(id, |job| {
                job.progress = ExportProgress {
                    stage: stage.to_owned(),
                    done,
                    total,
                }
            });
        };
        let (package, counts) = build_package(state, user_id, allowed, &progress)
            .await
            .map_err(|e| e.body.message)?;
        progress("packaging", 0, 1);
        let path = self.dir.join(format!("{id}.zip"));
        let write_path = path.clone();
        let size = tokio::task::spawn_blocking(move || -> Result<u64, String> {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let file = options.open(&write_path).map_err(|e| e.to_string())?;
            let mut writer = std::io::BufWriter::new(file);
            playarr_portability::write_package(&package, &mut writer).map_err(|e| e.to_string())?;
            let file = writer.into_inner().map_err(|e| e.to_string())?;
            file.metadata().map(|m| m.len()).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok((path, size, counts))
    }
}

/// Builds the package for exactly one user. Each source is read once, at
/// the start, which is the snapshot the package describes.
pub async fn build_package(
    state: &AppState,
    user_id: Uuid,
    allowed: Option<Vec<Uuid>>,
    progress: &(dyn Fn(&str, usize, usize) + Sync),
) -> Result<(UserDataPackage, ExportCounts), ApiError> {
    let started = Utc::now();
    let user = state
        .user_repo
        .find_by_id(user_id)
        .await?
        .ok_or_else(|| ApiError::not_found("account not found"))?;
    let instance_name = state
        .system_settings_repo
        .get()
        .await
        .map(|s| s.instance_name)
        .unwrap_or_default();

    // The snapshot: every table read once, in this order.
    let all_progress = state.watch_progress.list_for_user(user_id).await?;
    let all_prefs = state
        .user_repo
        .list_media_playback_preferences(user_id)
        .await?;
    let playlists: Vec<_> = state
        .playlist_repo
        .list_visible_to_user(user_id)
        .await?
        .into_iter()
        .filter(|p| p.owner_user_id == Some(user_id))
        .collect();
    let watchlist = state.watchlist_repo.list(user_id).await?;
    let mut playlist_items = Vec::with_capacity(playlists.len());
    for playlist in &playlists {
        playlist_items.push(state.playlist_repo.list_items(playlist.id).await?);
    }

    let total_rows = all_progress.len()
        + all_prefs.len()
        + playlist_items.iter().map(Vec::len).sum::<usize>()
        + playlists.len()
        + watchlist.len();
    if total_rows > MAX_RECORDS {
        return Err(ApiError::bad_request(
            "this account has more data than a single export can hold",
        ));
    }

    let mut package = UserDataPackage::new(started);
    package.generator.name = "playarr-server".into();
    package.generator.version = env!("CARGO_PKG_VERSION").into();
    package.source.instance_name = instance_name;
    package.owner.display_name = user.display_name.clone();
    package.preferences.preferred_audio_language = Some(user.preferred_audio_language.clone());

    let mut counts = ExportCounts::default();
    let mut resolver = Resolver::new(state, allowed);

    let total = all_progress.len();
    progress("watch_progress", 0, total);
    for (index, row) in all_progress.iter().enumerate() {
        if row.state != WatchState::Unseen {
            match state.media_file_repo.get_by_id(row.media_file_id).await {
                Ok(file) => match resolver.item_for_media_file(&file).await {
                    Some(item) => package.watch_progress.push(WatchRecord {
                        item,
                        state: match row.state {
                            WatchState::Watched => "watched",
                            _ => "part_watched",
                        }
                        .into(),
                        position_ms: row.position_ms,
                        duration_ms: row.duration_ms,
                        updated_at: row.updated_at,
                    }),
                    None => counts.skipped += 1,
                },
                Err(_) => counts.skipped += 1,
            }
        }
        if index % 50 == 0 {
            progress("watch_progress", index, total);
        }
    }
    counts.watch_progress = package.watch_progress.len();

    progress("playback_preferences", 0, all_prefs.len());
    for pref in &all_prefs {
        let item = match state.media_file_repo.get_by_id(pref.media_file_id).await {
            Ok(file) => resolver.item_for_media_file(&file).await,
            Err(_) => None,
        };
        match item {
            Some(item) => package.playback_preferences.push(PlaybackPreferenceRecord {
                item,
                quality_id: pref.quality_id.clone(),
                audio_track_id: pref.audio_track_id.clone(),
                subtitle_track_id: pref.subtitle_track_id.clone(),
            }),
            None => counts.skipped += 1,
        }
    }
    counts.playback_preferences = package.playback_preferences.len();

    progress("playlists", 0, playlists.len());
    for (index, (playlist, items)) in playlists.iter().zip(playlist_items).enumerate() {
        let mut entries = Vec::new();
        let mut items = items;
        items.sort_by_key(|item| item.position);
        for item in items {
            match resolver
                .item_for_playlist_entry(item.work_id, item.track_id)
                .await
            {
                Some(portable) => entries.push(PlaylistEntry {
                    position: entries.len() as i32,
                    added_at: item.added_at,
                    item: portable,
                }),
                None => counts.skipped += 1,
            }
        }
        counts.playlist_items += entries.len();
        package.playlists.push(Playlist {
            id: playlist.id,
            name: playlist.name.clone(),
            media_type: match playlist.media_type {
                playarr_model::PlaylistMediaType::Video => "video",
                playarr_model::PlaylistMediaType::Audio => "audio",
            }
            .into(),
            parent_id: playlist.parent_playlist_id,
            created_at: playlist.created_at,
            updated_at: playlist.updated_at,
            items: entries,
        });
        progress("playlists", index + 1, playlists.len());
    }
    counts.playlists = package.playlists.len();

    // The watchlist holds titles whether or not they are in a library, so
    // every row is exported from its own snapshot (no library lookup needed).
    for row in watchlist {
        package.watchlist.push(WatchlistRecord {
            item: super::resolve::item_for_watchlist(&row),
            added_at: row.added_at,
        });
    }
    counts.watchlist = package.watchlist.len();
    Ok((package, counts))
}
