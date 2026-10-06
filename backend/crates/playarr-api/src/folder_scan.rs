//! Scanner for unsorted folders: walks every administrator-enabled root
//! folder for media files that no source application manages, probes the new
//! and changed ones, and keeps `folder_media_entries` in step with the disk.
//!
//! Scans are incremental: a file whose size and modification time match the
//! stored row is not probed again, and files that vanished (or that a source
//! application now manages) are removed. One `library` live event per root is
//! published when anything changed.
//!
//! Safety: symbolic links are never followed, hidden entries are skipped and
//! every stored path is a normalised root-relative path, so a browse request
//! can never name anything outside its root.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Utc};
use futures::StreamExt;
use playarr_arr_sync::{work_kind_and_provider, ArrClient};
use playarr_db::{live_event_kind, DiscoveredRoot, NewLiveEvent};
use playarr_model::{
    FolderFileMetadata, FolderScanStatus, ScannedFolderFile, SourceInstance, SourceRootFolder,
    WorkKind, FOLDER_SOURCE_FILE_PREFIX,
};
use serde::Serialize;
use serde_json::Value;
use tokio::process::Command;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::physical_path::map_source_path;
use crate::{ApiError, AppState};

const MAX_DEPTH: usize = 32;
const PROBE_CONCURRENCY: usize = 4;
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(8);
const DEFAULT_INTERVAL_SECS: u64 = 900;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "m4v", "mov", "avi", "wmv", "webm", "ts", "m2ts", "mpg", "mpeg", "flv",
];
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "wma", "alac", "aiff",
];

static IN_FLIGHT: LazyLock<Mutex<HashSet<Uuid>>> = LazyLock::new(Default::default);

/// Result of one scan of one root.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct ScanSummary {
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    pub unchanged: u64,
    /// Files that could not be probed as playable media.
    pub skipped: u64,
}

impl ScanSummary {
    pub fn changed(&self) -> bool {
        self.added + self.updated + self.removed > 0
    }
}

struct InFlightGuard(Uuid);

impl InFlightGuard {
    fn try_acquire(root_id: Uuid) -> Option<Self> {
        IN_FLIGHT
            .lock()
            .ok()?
            .insert(root_id)
            .then_some(Self(root_id))
    }
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = IN_FLIGHT.lock() {
            set.remove(&self.0);
        }
    }
}

/// Whether a scan of this root is running right now (this process).
pub fn is_scanning(root_id: Uuid) -> bool {
    IN_FLIGHT
        .lock()
        .map(|set| set.contains(&root_id))
        .unwrap_or(false)
}

/// Deterministic namespace-based id: stable across rescans and restarts.
pub(crate) fn stable_id(namespace: Uuid, name: &str) -> Uuid {
    Uuid::new_v5(&namespace, name.as_bytes())
}

pub(crate) fn extensions_for(kind: WorkKind) -> &'static [&'static str] {
    match kind {
        WorkKind::Movie | WorkKind::Series | WorkKind::Site => VIDEO_EXTENSIONS,
        WorkKind::Artist | WorkKind::Author => AUDIO_EXTENSIONS,
    }
}

fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "@eaDir" | "lost+found" | "$RECYCLE.BIN" | "System Volume Information"
        )
}

#[derive(Debug, Clone)]
struct WalkedFile {
    relative_path: String,
    absolute: PathBuf,
    size_bytes: u64,
    modified_at: Option<DateTime<Utc>>,
}

/// Walks `root` without following symbolic links.
fn walk(root: &Path, extensions: &[&str]) -> std::io::Result<Vec<WalkedFile>> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), String::new(), 0usize)];
    while let Some((dir, prefix, depth)) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            // The root itself must be readable; a subdirectory that is not
            // is skipped rather than failing the whole scan.
            Err(error) if depth == 0 => return Err(error),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if is_ignored_name(&name) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if file_type.is_dir() {
                if depth < MAX_DEPTH {
                    stack.push((entry.path(), relative, depth + 1));
                }
            } else if file_type.is_file() {
                let supported = Path::new(&name)
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| {
                        extensions
                            .iter()
                            .any(|candidate| candidate.eq_ignore_ascii_case(ext))
                    });
                if !supported {
                    continue;
                }
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                out.push(WalkedFile {
                    relative_path: relative,
                    absolute: entry.path(),
                    size_bytes: metadata.len(),
                    modified_at: metadata.modified().ok().map(to_utc_millis),
                });
            }
        }
    }
    out.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(out)
}

/// Truncates to whole milliseconds, the precision the database stores.
fn to_utc_millis(time: SystemTime) -> DateTime<Utc> {
    let at: DateTime<Utc> = time.into();
    DateTime::from_timestamp_millis(at.timestamp_millis()).unwrap_or(at)
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Probe {
    pub container: Option<String>,
    pub duration_ms: Option<u64>,
    pub bitrate: Option<u64>,
    pub has_video: bool,
    pub has_audio: bool,
    pub metadata: FolderFileMetadata,
}

fn tag(tags: Option<&serde_json::Map<String, Value>>, keys: &[&str]) -> Option<String> {
    let tags = tags?;
    keys.iter().find_map(|key| {
        tags.iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(key))
            .and_then(|(_, value)| value.as_str())
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    })
}

fn number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

pub(crate) fn parse_probe(output: &[u8]) -> Result<Probe, String> {
    let json: Value = serde_json::from_slice(output).map_err(|e| format!("invalid probe: {e}"))?;
    let format = json.get("format");
    let streams = json
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut probe = Probe {
        container: format
            .and_then(|f| f.get("format_name"))
            .and_then(Value::as_str)
            .and_then(|names| names.split(',').next())
            .map(str::to_string),
        duration_ms: number(format.and_then(|f| f.get("duration")))
            .filter(|seconds| *seconds > 0.0)
            .map(|seconds| (seconds * 1000.0).round() as u64),
        bitrate: number(format.and_then(|f| f.get("bit_rate")))
            .filter(|bits| *bits > 0.0)
            .map(|bits| bits as u64),
        ..Probe::default()
    };
    let format_tags = format
        .and_then(|f| f.get("tags"))
        .and_then(Value::as_object);
    probe.metadata.title = tag(format_tags, &["title"]);
    probe.metadata.artist = tag(format_tags, &["artist", "album_artist"]);
    probe.metadata.album = tag(format_tags, &["album"]);
    probe.metadata.year = tag(format_tags, &["date", "year"])
        .and_then(|date| date.get(..4).and_then(|y| y.parse::<i32>().ok()));
    for stream in &streams {
        let codec = stream
            .get("codec_name")
            .and_then(Value::as_str)
            .map(str::to_string);
        match stream.get("codec_type").and_then(Value::as_str) {
            // Embedded cover art is reported as a video stream.
            Some("video")
                if stream
                    .pointer("/disposition/attached_pic")
                    .and_then(Value::as_i64)
                    != Some(1) =>
            {
                if !probe.has_video {
                    probe.has_video = true;
                    probe.metadata.video_codec = codec;
                    probe.metadata.width = number(stream.get("width")).map(|w| w as u32);
                    probe.metadata.height = number(stream.get("height")).map(|h| h as u32);
                }
            }
            Some("audio") if !probe.has_audio => {
                probe.has_audio = true;
                probe.metadata.audio_codec = codec;
                probe.metadata.audio_channels = number(stream.get("channels")).map(|c| c as u32);
            }
            _ => {}
        }
    }
    Ok(probe)
}

async fn probe_file(path: &Path) -> Result<Probe, String> {
    let binary = std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let output = tokio::time::timeout(
        PROBE_TIMEOUT,
        Command::new(&binary)
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                "-i",
            ])
            .arg(path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "probe timed out".to_string())?
    .map_err(|error| format!("could not start {binary}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "probe failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    parse_probe(&output.stdout)
}

/// "Sample_Clip.01" -> "Sample Clip 01".
pub(crate) fn title_from_file_name(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);
    let cleaned: String = stem
        .chars()
        .map(|c| if matches!(c, '_' | '.') { ' ' } else { c })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        stem.to_string()
    } else {
        collapsed
    }
}

/// Paths that a source application already manages, in both the namespace the
/// application reported and this node's mapped form.
async fn managed_paths(state: &AppState, self_peer_id: Option<Uuid>) -> HashSet<String> {
    let mut set = HashSet::new();
    let Ok(files) = state.media_file_repo.list_all().await else {
        return set;
    };
    for file in files {
        if file
            .source_file_id
            .as_deref()
            .is_some_and(|id| id.starts_with(FOLDER_SOURCE_FILE_PREFIX))
        {
            continue;
        }
        let raw = file.path.to_string_lossy().into_owned();
        if let (Some(peer), Some(source)) = (
            self_peer_id,
            state.source_instances.get(file.source_instance_id),
        ) {
            let (mapped, _) = map_source_path(
                &raw,
                source.default_root_folder_id.as_deref(),
                source.folder_mappings.get(&peer).map(String::as_str),
            );
            set.insert(mapped);
        }
        set.insert(raw);
    }
    set
}

pub(crate) async fn self_peer_id(state: &AppState) -> Option<Uuid> {
    state
        .node_identity_repo
        .get()
        .await
        .ok()
        .flatten()
        .map(|identity| identity.peer_id)
}

/// The directory to walk for `root` on this node: the explicit override,
/// else the reported path mapped through the source's folder mapping.
pub(crate) fn resolve_local_root(
    root: &SourceRootFolder,
    source: Option<&SourceInstance>,
    self_peer_id: Option<Uuid>,
) -> PathBuf {
    if let Some(path) = &root.local_path_override {
        return path.clone();
    }
    if let (Some(source), Some(peer)) = (source, self_peer_id) {
        if let Some(mapped_root) = source.folder_mappings.get(&peer) {
            let (mapped, applied) = map_source_path(
                &root.reported_path,
                source.default_root_folder_id.as_deref(),
                Some(mapped_root.as_str()),
            );
            if applied {
                return PathBuf::from(mapped);
            }
        }
    }
    PathBuf::from(&root.reported_path)
}

/// Scans one root. Returns `Ok(None)` when a scan of it is already running.
pub async fn scan_root(state: &AppState, root_id: Uuid) -> Result<Option<ScanSummary>, ApiError> {
    let Some(_guard) = InFlightGuard::try_acquire(root_id) else {
        return Ok(None);
    };
    let root = state
        .folder_repo
        .get_root(root_id)
        .await
        .map_err(|_| ApiError::not_found("unknown folder root"))?;
    state
        .folder_repo
        .set_scan_state(root_id, FolderScanStatus::Scanning, None, None)
        .await?;
    let outcome = scan_root_inner(state, &root).await;
    match outcome {
        Ok(summary) => {
            state
                .folder_repo
                .set_scan_state(root_id, FolderScanStatus::Ready, None, Some(Utc::now()))
                .await?;
            if summary.changed() {
                state
                    .live_events
                    .publish(NewLiveEvent::for_library(
                        live_event_kind::LIBRARY,
                        "folder_root",
                        root_id,
                        &["entries"],
                        Some(root.source_instance_id),
                    ))
                    .await;
            }
            publish_admin_event(state, root_id).await;
            Ok(Some(summary))
        }
        Err(message) => {
            tracing::warn!(%root_id, error = %message, "folder scan failed");
            state
                .folder_repo
                .set_scan_state(root_id, FolderScanStatus::Failed, Some(&message), None)
                .await?;
            publish_admin_event(state, root_id).await;
            Err(ApiError::new(
                axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                "folder_scan_failed",
                message,
            ))
        }
    }
}

async fn publish_admin_event(state: &AppState, root_id: Uuid) {
    state
        .live_events
        .publish(NewLiveEvent {
            user_id: None,
            kind: live_event_kind::ADMIN,
            entity: "folder_root",
            entity_id: Some(root_id.to_string()),
            changed: vec!["scan"],
            source_instance_id: None,
        })
        .await;
}

async fn scan_root_inner(state: &AppState, root: &SourceRootFolder) -> Result<ScanSummary, String> {
    let self_peer = self_peer_id(state).await;
    let source = state.source_instances.get(root.source_instance_id);
    let local = resolve_local_root(root, source.as_ref(), self_peer);
    let canonical = tokio::fs::canonicalize(&local)
        .await
        .map_err(|_| "this root folder is not available on this server".to_string())?;
    if !tokio::fs::metadata(&canonical)
        .await
        .map(|m| m.is_dir())
        .unwrap_or(false)
    {
        return Err("this root folder is not a directory on this server".to_string());
    }

    let extensions = extensions_for(root.work_kind);
    let walk_root = canonical.clone();
    let walked = tokio::task::spawn_blocking(move || walk(&walk_root, extensions))
        .await
        .map_err(|e| format!("scan task failed: {e}"))?
        .map_err(|e| format!("could not read this root folder: {e}"))?;

    let managed = managed_paths(state, self_peer).await;
    let index: HashMap<String, _> = state
        .folder_repo
        .scan_index(root.id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|row| (row.relative_path.clone(), row))
        .collect();

    let mut summary = ScanSummary::default();
    let mut seen = HashSet::new();
    let mut to_probe = Vec::new();
    for file in walked {
        let absolute_text = file.absolute.to_string_lossy().into_owned();
        if managed.contains(&absolute_text) {
            continue;
        }
        seen.insert(file.relative_path.clone());
        match index.get(&file.relative_path) {
            Some(row)
                if row.size_bytes == file.size_bytes && row.modified_at == file.modified_at =>
            {
                summary.unchanged += 1;
            }
            existing => to_probe.push((file, existing.is_some())),
        }
    }

    let kind = root.work_kind;
    let wants_video = matches!(kind, WorkKind::Movie | WorkKind::Series | WorkKind::Site);
    let probed = futures::stream::iter(to_probe)
        .map(|(file, existed)| async move {
            let probe = probe_file(&file.absolute).await;
            (file, existed, probe)
        })
        .buffer_unordered(PROBE_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

    let now = Utc::now();
    for (file, existed, probe) in probed {
        let probe = match probe {
            Ok(p) if (wants_video && p.has_video) || (!wants_video && p.has_audio) => p,
            _ => {
                summary.skipped += 1;
                // A file that stopped being playable must not linger.
                if existed {
                    seen.remove(&file.relative_path);
                }
                continue;
            }
        };
        let file_name = file
            .relative_path
            .rsplit('/')
            .next()
            .unwrap_or(&file.relative_path)
            .to_string();
        let title = probe
            .metadata
            .title
            .clone()
            .unwrap_or_else(|| title_from_file_name(&file_name));
        let extension = Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .or(probe.container.clone())
            .unwrap_or_default();
        let codec = if wants_video {
            probe.metadata.video_codec.clone()
        } else {
            probe.metadata.audio_codec.clone()
        }
        .unwrap_or_default();
        let key = stable_id(root.id, &file.relative_path);
        let scanned = ScannedFolderFile {
            entry_id: stable_id(key, "entry"),
            work_id: stable_id(key, "work"),
            media_file_id: stable_id(key, "file"),
            root_folder_id: root.id,
            source_instance_id: root.source_instance_id,
            physical_path: file.absolute.clone(),
            relative_path: file.relative_path.clone(),
            work_kind: kind,
            sort_title: title.to_lowercase(),
            title,
            container: extension,
            codec,
            bitrate: probe.bitrate,
            duration_ms: probe.duration_ms,
            size_bytes: file.size_bytes,
            modified_at: file.modified_at,
            metadata: probe.metadata,
            scanned_at: now,
        };
        state
            .folder_repo
            .upsert_scanned_file(&scanned)
            .await
            .map_err(|e| e.to_string())?;
        if existed {
            summary.updated += 1;
        } else {
            summary.added += 1;
        }
    }

    let gone: Vec<String> = index
        .keys()
        .filter(|path| !seen.contains(*path))
        .cloned()
        .collect();
    if !gone.is_empty() {
        summary.removed = state
            .folder_repo
            .remove_entries(root.id, &gone)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(summary)
}

/// Asks every media-owning source for its root folders and records them
/// (inactive roots keep their scan cache). Roots start disabled: an
/// administrator opts each one in.
pub async fn discover_roots(state: &AppState) -> Result<Vec<Uuid>, ApiError> {
    let mut failed = Vec::new();
    for source in state.source_instances.all() {
        let Some((kind, _)) = work_kind_and_provider(source.kind) else {
            continue;
        };
        let remote = tokio::time::timeout(
            DISCOVERY_TIMEOUT,
            ArrClient::from_source_instance(&source).list_root_folders(),
        )
        .await;
        let remote = match remote {
            Ok(Ok(remote)) => remote,
            Ok(Err(error)) => {
                tracing::warn!(source_instance_id = %source.id, %error, "root folder discovery failed");
                failed.push(source.id);
                continue;
            }
            Err(_) => {
                tracing::warn!(source_instance_id = %source.id, "root folder discovery timed out");
                failed.push(source.id);
                continue;
            }
        };
        let roots = remote
            .into_iter()
            .map(|root| DiscoveredRoot {
                id: stable_id(source.id, &format!("root:{}", root.id)),
                source_root_id: root.id.to_string(),
                display_name: root_display_name(&root.path, &source.name),
                reported_path: root.path,
                work_kind: kind,
                accessible: root.accessible,
                free_space_bytes: root.free_space.and_then(|v| u64::try_from(v).ok()),
                total_space_bytes: root.total_space.and_then(|v| u64::try_from(v).ok()),
            })
            .collect::<Vec<_>>();
        // One source failing to record must not stop the others.
        if let Err(error) = state
            .folder_repo
            .sync_discovered_roots(source.id, &roots)
            .await
        {
            tracing::warn!(source_instance_id = %source.id, %error, "recording discovered root folders failed");
            failed.push(source.id);
        }
    }
    Ok(failed)
}

pub(crate) fn root_display_name(path: &str, fallback: &str) -> String {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

/// Background loop: discover roots, then rescan every enabled root, forever.
/// `PLAYARR_FOLDER_SCAN_INTERVAL_SECS=0` disables it (admins can still scan
/// a root on demand).
pub async fn run_folder_scanner(state: AppState) {
    let interval = std::env::var("PLAYARR_FOLDER_SCAN_INTERVAL_SECS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(DEFAULT_INTERVAL_SECS);
    if interval == 0 {
        return;
    }
    tokio::time::sleep(Duration::from_secs(20)).await;
    loop {
        if let Err(error) = discover_roots(&state).await {
            tracing::warn!(error = %error.body.message, "folder root discovery failed");
        }
        scan_enabled_roots(&state).await;
        tokio::time::sleep(Duration::from_secs(interval)).await;
    }
}

pub async fn scan_enabled_roots(state: &AppState) {
    let roots = match state.folder_repo.list_roots().await {
        Ok(roots) => roots,
        Err(error) => {
            tracing::warn!(%error, "could not list folder roots");
            return;
        }
    };
    for root in roots
        .into_iter()
        .filter(|root| root.scan_enabled && root.active)
    {
        if let Err(error) = scan_root(state, root.id).await {
            tracing::debug!(root_id = %root.id, error = %error.body.message, "folder scan did not complete");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_are_cleaned_from_file_names() {
        assert_eq!(title_from_file_name("Sample_Clip.01.mkv"), "Sample Clip 01");
        assert_eq!(title_from_file_name("Sample Clip 01.mp4"), "Sample Clip 01");
    }

    #[test]
    fn probe_output_is_parsed_and_cover_art_is_not_video() {
        let json =
            br#"{"format":{"format_name":"matroska,webm","duration":"2.500000","bit_rate":"128000",
            "tags":{"TITLE":"Sample Track","ARTIST":"Sample Artist","date":"2020-05-01"}},
            "streams":[{"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}},
                       {"codec_type":"audio","codec_name":"flac","channels":2}]}"#;
        let probe = parse_probe(json).unwrap();
        assert!(!probe.has_video && probe.has_audio);
        assert_eq!(probe.container.as_deref(), Some("matroska"));
        assert_eq!(probe.duration_ms, Some(2500));
        assert_eq!(probe.bitrate, Some(128000));
        assert_eq!(probe.metadata.title.as_deref(), Some("Sample Track"));
        assert_eq!(probe.metadata.year, Some(2020));
        assert_eq!(probe.metadata.audio_channels, Some(2));
    }

    #[test]
    fn walk_skips_hidden_unsupported_and_symlinked_entries() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("Sub/Deep")).unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::write(root.join("a.mkv"), b"x").unwrap();
        std::fs::write(root.join("notes.txt"), b"x").unwrap();
        std::fs::write(root.join(".secret.mkv"), b"x").unwrap();
        std::fs::write(root.join(".hidden/b.mkv"), b"x").unwrap();
        std::fs::write(root.join("Sub/Deep/c.MP4"), b"x").unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("d.mkv"), b"x").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.path(), root.join("Link")).unwrap();
            std::os::unix::fs::symlink(outside.path().join("d.mkv"), root.join("link.mkv"))
                .unwrap();
        }
        let found = walk(root, VIDEO_EXTENSIONS).unwrap();
        let names: Vec<_> = found.iter().map(|f| f.relative_path.as_str()).collect();
        assert_eq!(names, vec!["Sub/Deep/c.MP4", "a.mkv"]);
    }
}
