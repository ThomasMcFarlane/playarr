//! `playarr-transcode` — playback-time transcode decision-making
//! ([`TranscodeOrchestrator`]) and the background Tdarr dispatch path
//! ([`TdarrDispatcher`]).
//!
//! The orchestrator's three methods are meant to be tried in order, each
//! only reached if the previous one didn't resolve the request:
//! 1. [`TranscodeOrchestrator::can_direct_play`] — can the source
//!    `MediaFile` be served byte-for-byte? Cheapest, most common case.
//! 2. [`TranscodeOrchestrator::find_existing_rendition`] — is there
//!    already a ready [`playarr_model::Rendition`], produced either by
//!    the background Tdarr pipeline or a previous on-demand session?
//! 3. [`TranscodeOrchestrator::spawn_on_demand_transcode`] — last resort:
//!    start a new transcode just for this session.
//!
//! [`TranscodeSession`] state (create/lookup/expire) is kept in whatever
//! [`playarr_cache::CacheAndPubSub`] implementation the deployment is
//! wired with, rather than in `playarr-db` — sessions are ephemeral,
//! TTL'd, node-scoped process state, not durable rows.
//!
//! [`ActiveSessionCounter`] is a small in-process bridge between the two
//! halves of this crate: `TranscodeOrchestrator` increments/decrements it
//! as on-demand sessions come and go, and `TdarrDispatcher` reads it to
//! decide whether to throttle Tdarr's background workers. It deliberately
//! isn't derived by scanning the cache — [`playarr_cache::CacheAndPubSub`]
//! is a plain get/set/delete/pub-sub trait with no listing/count
//! primitive (see that crate's docs), and a hot per-session-lifecycle
//! counter belongs in-process rather than round-tripping a KV store on
//! every increment/decrement.
//!
//! The other bridge, optional and one-directional: `TranscodeOrchestrator`
//! can hold an [`mpsc::Sender<MediaFileImportEvent>`] (see
//! [`TranscodeOrchestrator::with_tdarr_notify`]) and fires one when
//! [`TranscodeOrchestrator::spawn_on_demand_transcode`] starts a live
//! session — the same channel `TdarrDispatcher` already consumes for real
//! *arr import events. Descriptor-pinned sources are the security exception:
//! their persisted pathname may later resolve to different content, so they
//! must not enqueue an unpinned background reopen. For ordinary sources,
//! this turns "someone is watching this file right now via a temporary,
//! TTL'd ffmpeg session" into "Tdarr goes and produces a durable, cached
//! `Rendition` for it in the background" per this crate's own three-step
//! lookup order above: once that `Rendition` is `Ready`, every subsequent
//! playback request for the same file+profile hits step 2 instead of
//! re-paying for step 3. Fire-and-forget (`try_send`, never awaited) so a
//! full or absent channel (Tdarr not configured, or a worker-role process
//! not running in this deployment) never affects playback itself —
//! `TdarrDispatcher::dispatch_one` already re-checks for an existing
//! `Ready` rendition before doing any real work, so redundant events from
//! multiple concurrent on-demand sessions for the same file are naturally
//! deduplicated on the receiving end.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use playarr_cache::CacheAndPubSub;
use playarr_db::RenditionRepo;
use playarr_model::{MediaFile, Rendition};
use playarr_tdarr_client::{AlterWorkerLimitRequest, ScanIndividualFileRequest, TdarrClient};
use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum TranscodeError {
    #[error(transparent)]
    Db(#[from] playarr_db::DbError),
    #[error("no on-demand transcode capacity available on this node")]
    NoCapacity,
    #[error("tdarr client error: {0}")]
    Tdarr(#[from] playarr_tdarr_client::TdarrClientError),
    #[error("cache error: {0}")]
    Cache(#[from] playarr_cache::CacheError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("failed to (de)serialize transcode session: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("transcode cleanup task failed: {0}")]
    CleanupTask(#[from] tokio::task::JoinError),
}

/// What a requesting client can play natively — the input to
/// [`TranscodeOrchestrator::can_direct_play`]. Built by `playarr-api`'s
/// playback negotiation handler from client-reported capabilities
/// (codecs/containers/max bitrate) rather than looked up from a static
/// per-`ClientPlatform` table, since real-world support varies per device/
/// OS/app-version more than platform alone predicts.
#[derive(Debug, Clone)]
pub struct ClientCapabilities {
    pub supported_containers: Vec<String>,
    pub supported_video_codecs: Vec<String>,
    pub supported_audio_codecs: Vec<String>,
    pub max_bitrate_bps: Option<u64>,
}

/// A live on-demand transcode: an ffmpeg (or equivalent) process on some
/// node, producing an HLS/DASH-style segmented output that this session's
/// player is consuming as it's produced. Distinct from
/// [`playarr_model::Rendition`] — a `Rendition` is a durable, complete
/// output on disk; a `TranscodeSession` is the ephemeral in-progress state
/// of *producing* one (or streaming without ever fully persisting it, for
/// a single playback).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscodeSession {
    pub id: Uuid,
    pub media_file_id: Uuid,
    pub profile: String,
    /// Which cluster node is actually running the transcode process. In a
    /// multi-node deployment, segment requests for this session must be
    /// routed to this exact node — the process (and its in-progress
    /// output) does not exist anywhere else.
    pub owning_node_id: String,
    /// The highest segment index produced so far; lets a reconnecting
    /// player (or a load balancer routing a segment request) know how far
    /// along the session is without querying the transcode process
    /// directly.
    pub current_segment: u32,
    /// Sessions are not renewed indefinitely — an idle on-demand transcode
    /// past this deadline is eligible for cleanup regardless of whether
    /// the owning node has otherwise noticed the client disconnected.
    pub expires_at: DateTime<Utc>,
}

/// A resolved ffmpeg target: the concrete codec/bitrate settings a named
/// rendition `profile` string (e.g. `"h264-1080p-8mbps"`) maps to.
///
/// TODO: this hardcodes a small, fixed set of profiles as a first real
/// implementation. A production system would resolve `profile` against a
/// configurable bitrate ladder (per-deployment, admin-editable) living in
/// `playarr-config`/`playarr-model` rather than baked into this crate;
/// tracked as follow-up, not blocking, since `spawn_on_demand_transcode`
/// needs *some* concrete mapping to build a correct ffmpeg command today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscodeTargetProfile {
    pub name: String,
    /// Display/selection height exposed to playback clients.
    pub height: u16,
    /// ffmpeg `-c:v` value, e.g. `"libx264"`.
    pub video_codec: String,
    /// ffmpeg `-c:a` value, e.g. `"aac"`.
    pub audio_codec: String,
    /// Relative bitrate within this profile's resolution tier.
    pub quality_level: TranscodeQualityLevel,
    pub video_bitrate_kbps: Option<u32>,
    pub audio_bitrate_kbps: Option<u32>,
}

/// Relative bitrate within a resolution tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscodeQualityLevel {
    Low,
    Medium,
    High,
}

impl TranscodeQualityLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "Low",
            Self::Medium => "Medium",
            Self::High => "High",
        }
    }
}

#[derive(Clone, Copy)]
struct TranscodeProfileSpec {
    name: &'static str,
    height: u16,
    quality_level: TranscodeQualityLevel,
    video_bitrate_kbps: u32,
    audio_bitrate_kbps: u32,
}

const SUPPORTED_PROFILE_SPECS: [TranscodeProfileSpec; 12] = [
    TranscodeProfileSpec {
        name: "h264-2160p-12mbps",
        height: 2160,
        quality_level: TranscodeQualityLevel::Low,
        video_bitrate_kbps: 12_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-2160p-20mbps",
        height: 2160,
        quality_level: TranscodeQualityLevel::Medium,
        video_bitrate_kbps: 20_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-2160p-35mbps",
        height: 2160,
        quality_level: TranscodeQualityLevel::High,
        video_bitrate_kbps: 35_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-1080p-4mbps",
        height: 1080,
        quality_level: TranscodeQualityLevel::Low,
        video_bitrate_kbps: 4_000,
        audio_bitrate_kbps: 128,
    },
    TranscodeProfileSpec {
        name: "h264-1080p-8mbps",
        height: 1080,
        quality_level: TranscodeQualityLevel::Medium,
        video_bitrate_kbps: 8_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-1080p-12mbps",
        height: 1080,
        quality_level: TranscodeQualityLevel::High,
        video_bitrate_kbps: 12_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-720p-2mbps",
        height: 720,
        quality_level: TranscodeQualityLevel::Low,
        video_bitrate_kbps: 2_000,
        audio_bitrate_kbps: 96,
    },
    TranscodeProfileSpec {
        name: "h264-720p-4mbps",
        height: 720,
        quality_level: TranscodeQualityLevel::Medium,
        video_bitrate_kbps: 4_000,
        audio_bitrate_kbps: 128,
    },
    TranscodeProfileSpec {
        name: "h264-720p-6mbps",
        height: 720,
        quality_level: TranscodeQualityLevel::High,
        video_bitrate_kbps: 6_000,
        audio_bitrate_kbps: 128,
    },
    TranscodeProfileSpec {
        name: "h264-480p-1mbps",
        height: 480,
        quality_level: TranscodeQualityLevel::Low,
        video_bitrate_kbps: 1_000,
        audio_bitrate_kbps: 96,
    },
    TranscodeProfileSpec {
        name: "h264-480p-2mbps",
        height: 480,
        quality_level: TranscodeQualityLevel::Medium,
        video_bitrate_kbps: 2_000,
        audio_bitrate_kbps: 96,
    },
    TranscodeProfileSpec {
        name: "h264-480p-3mbps",
        height: 480,
        quality_level: TranscodeQualityLevel::High,
        video_bitrate_kbps: 3_000,
        audio_bitrate_kbps: 128,
    },
];

impl TranscodeProfileSpec {
    fn resolve(self) -> TranscodeTargetProfile {
        TranscodeTargetProfile {
            name: self.name.to_string(),
            height: self.height,
            video_codec: "libx264".to_string(),
            audio_codec: "aac".to_string(),
            quality_level: self.quality_level,
            video_bitrate_kbps: Some(self.video_bitrate_kbps),
            audio_bitrate_kbps: Some(self.audio_bitrate_kbps),
        }
    }
}

impl TranscodeTargetProfile {
    /// The real rendition ladder this server can currently produce.
    ///
    /// Playback clients use this rather than maintaining a second,
    /// potentially fictional quality list. Rows are ordered by resolution
    /// from UHD to SD, with Low/Medium/High bitrates inside each row.
    pub fn supported() -> Vec<Self> {
        SUPPORTED_PROFILE_SPECS
            .into_iter()
            .map(TranscodeProfileSpec::resolve)
            .collect()
    }

    /// Resolves a named profile to concrete ffmpeg settings, falling back
    /// to a conservative default (H.264/AAC, 4Mbps video) for any name
    /// this crate doesn't recognize, rather than failing outright — an
    /// unrecognized profile name is still a request that should degrade to
    /// *something* playable rather than erroring the whole playback
    /// attempt.
    pub fn resolve(profile: &str) -> Self {
        if let Some(spec) = SUPPORTED_PROFILE_SPECS
            .iter()
            .find(|spec| spec.name == profile)
        {
            return spec.resolve();
        }

        Self {
            name: profile.to_string(),
            height: 720,
            video_codec: "libx264".to_string(),
            audio_codec: "aac".to_string(),
            quality_level: TranscodeQualityLevel::Medium,
            video_bitrate_kbps: Some(4000),
            audio_bitrate_kbps: Some(128),
        }
    }
}

/// Fixed HLS segment duration, in seconds, for on-demand output.
pub const HLS_SEGMENT_SECONDS: u32 = 4;

/// Builds the ffmpeg argv for transcoding `input_path` into an HLS
/// rendition under `output_dir`, per `profile`. Pure (no I/O, no process
/// spawning) so it's unit-testable without an ffmpeg binary on `PATH` —
/// [`TranscodeOrchestrator::spawn_on_demand_transcode`] is the only
/// production caller, and just hands these args straight to
/// `tokio::process::Command`.
///
/// Uses `-hls_playlist_type event` (not `vod`): the player is tailing this
/// playlist *while* it's being produced (see [`TranscodeSession`]'s docs),
/// so segments must never be pruned out of the list (`-hls_list_size 0`)
/// and the playlist must not claim to be complete (`#EXT-X-ENDLIST`) until
/// ffmpeg actually finishes.
pub fn build_ffmpeg_hls_args(
    input_path: &Path,
    profile: &TranscodeTargetProfile,
    output_dir: &Path,
) -> Vec<String> {
    build_ffmpeg_hls_args_at(input_path, profile, output_dir, 0)
}

/// Builds the same live HLS command as [`build_ffmpeg_hls_args`], starting
/// from an absolute position in the source file. The replacement playlist's
/// own media timeline still begins at zero; callers must carry
/// `start_position_ms` separately when presenting source-relative time.
pub fn build_ffmpeg_hls_args_at(
    input_path: &Path,
    profile: &TranscodeTargetProfile,
    output_dir: &Path,
    start_position_ms: u64,
) -> Vec<String> {
    build_ffmpeg_hls_args_at_with_audio(input_path, profile, output_dir, start_position_ms, None)
}

/// Builds a live HLS command with one explicitly selected source audio
/// stream. `audio_stream_index` is ffprobe's global stream index, so the
/// mapping remains correct even when subtitle/data streams appear between
/// video and audio streams in the container.
pub fn build_ffmpeg_hls_args_at_with_audio(
    input_path: &Path,
    profile: &TranscodeTargetProfile,
    output_dir: &Path,
    start_position_ms: u64,
    audio_stream_index: Option<u32>,
) -> Vec<String> {
    let mut args = vec![
        // Overwrite without prompting — the per-session output directory
        // is freshly created, but ffmpeg still probes for an existing
        // playlist file otherwise and this keeps it non-interactive.
        "-y".to_string(),
    ];

    if start_position_ms > 0 {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", start_position_ms as f64 / 1000.0));
    }

    args.extend([
        "-i".to_string(),
        input_path.to_string_lossy().into_owned(),
        "-c:v".to_string(),
        profile.video_codec.clone(),
        // Browser MSE implementations generally accept 8-bit H.264 but
        // reject High 10 output. Without an explicit pixel format, libx264
        // preserves a 10-bit source as yuv420p10le, which produces valid TS
        // segments that Chrome/Safari still fail to append (Shaka 3014/3015).
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        audio_stream_index
            .map(|stream_index| format!("0:{stream_index}"))
            .unwrap_or_else(|| "0:a:0?".to_string()),
        "-sn".to_string(),
    ]);

    if profile.height > 0 {
        args.push("-vf".to_string());
        args.push(format!("scale=-2:min({}\\,ih)", profile.height));
    }

    if let Some(kbps) = profile.video_bitrate_kbps {
        args.push("-b:v".to_string());
        args.push(format!("{kbps}k"));
    }

    args.push("-c:a".to_string());
    args.push(profile.audio_codec.clone());

    if let Some(kbps) = profile.audio_bitrate_kbps {
        args.push("-b:a".to_string());
        args.push(format!("{kbps}k"));
    }

    args.push("-f".to_string());
    args.push("hls".to_string());
    args.push("-hls_time".to_string());
    args.push(HLS_SEGMENT_SECONDS.to_string());
    args.push("-hls_playlist_type".to_string());
    args.push("event".to_string());
    args.push("-hls_list_size".to_string());
    args.push("0".to_string());
    args.push("-hls_segment_filename".to_string());
    args.push(
        output_dir
            .join("segment_%05d.ts")
            .to_string_lossy()
            .into_owned(),
    );
    args.push(
        output_dir
            .join("playlist.m3u8")
            .to_string_lossy()
            .into_owned(),
    );

    args
}

/// Shared, process-local count of active on-demand transcode sessions.
/// See the module docs for why this isn't derived from the cache.
#[derive(Debug, Clone, Default)]
pub struct ActiveSessionCounter(Arc<AtomicUsize>);

impl ActiveSessionCounter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }

    pub fn increment(&self) -> usize {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Saturating decrement — never underflows below zero, so a stray
    /// double-decrement (e.g. racing cleanup paths) can't wrap around to
    /// `usize::MAX` and falsely report the node as saturated.
    pub fn decrement(&self) -> usize {
        let mut current = self.0.load(Ordering::SeqCst);
        loop {
            let next = current.saturating_sub(1);
            match self
                .0
                .compare_exchange_weak(current, next, Ordering::SeqCst, Ordering::SeqCst)
            {
                Ok(_) => return next,
                Err(actual) => current = actual,
            }
        }
    }
}

struct ActiveTranscodeProcess {
    child: Child,
    // The source path may point at `/proc/<api-pid>/fd/<fd>`. Keep the
    // descriptor open in the API process until the transcode has stopped,
    // otherwise ffmpeg can lose access to the pinned file mid-session.
    _source_guard: Option<std::fs::File>,
}

impl ActiveTranscodeProcess {
    async fn kill_and_reap(mut self) {
        // `start_kill` can report that an already-finished child no longer
        // needs a signal. Always wait as well so either path reaps it before
        // the source descriptor guard is released.
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }
}

#[derive(Clone)]
struct LocalSessionReaper {
    active_children: Arc<Mutex<HashMap<Uuid, ActiveTranscodeProcess>>>,
    reaping_sessions: Arc<Mutex<HashSet<Uuid>>>,
    session_lifecycle: Arc<Mutex<()>>,
    playback_transcodes: Arc<Mutex<HashMap<Uuid, Uuid>>>,
    active_sessions: ActiveSessionCounter,
    output_root: PathBuf,
}

impl LocalSessionReaper {
    async fn claim(&self, session_id: Uuid) -> bool {
        // A cache-miss lookup, explicit Stop, and the expiry watchdog can
        // converge on the same session. Exactly one of them owns cleanup at
        // a time; followers can return because the owner has already taken
        // responsibility for completing it.
        self.reaping_sessions.lock().await.insert(session_id)
    }

    async fn reap_claimed(&self, session_id: Uuid) -> Result<(), TranscodeError> {
        let result = self.reap_once(session_id).await;
        self.reaping_sessions.lock().await.remove(&session_id);
        result
    }

    fn spawn_claimed_reap(
        &self,
        session_id: Uuid,
    ) -> tokio::task::JoinHandle<Result<(), TranscodeError>> {
        let reaper = self.clone();
        tokio::spawn(async move {
            let result = reaper.reap_claimed(session_id).await;
            if let Err(err) = &result {
                tracing::warn!(
                    %session_id,
                    error = %err,
                    "failed to finish claimed transcode session cleanup",
                );
            }
            result
        })
    }

    async fn reap_once(&self, session_id: Uuid) -> Result<(), TranscodeError> {
        // Release the process-table mutex before waiting for the OS child.
        // The separate `reaping_sessions` gate prevents another cleanup path
        // from deleting output while this process may still be writing.
        let active_process = self.active_children.lock().await.remove(&session_id);
        if let Some(active_process) = active_process {
            active_process.kill_and_reap().await;
            self.active_sessions.decrement();
        }

        self.playback_transcodes
            .lock()
            .await
            .retain(|_, transcode_session_id| *transcode_session_id != session_id);

        match tokio::fs::remove_dir_all(self.output_root.join(session_id.to_string())).await {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(TranscodeError::Io(err)),
        }

        Ok(())
    }
}

const SESSION_WATCHDOG_MIN_RECHECK: Duration = Duration::from_millis(10);
const SESSION_WATCHDOG_CACHE_RETRY: Duration = Duration::from_millis(250);
const SESSION_WATCHDOG_MAX_CACHE_ERRORS: usize = 3;

fn session_watchdog_delay(expires_at: &DateTime<Utc>, maximum: Duration) -> Duration {
    expires_at
        .signed_duration_since(Utc::now())
        .to_std()
        .unwrap_or(Duration::ZERO)
        .clamp(SESSION_WATCHDOG_MIN_RECHECK, maximum)
}

/// Decides, per playback request, whether the source file can be served
/// as-is, whether an existing rendition covers it, or whether a new
/// on-demand transcode needs to be started — and owns starting that
/// transcode when it does.
pub struct TranscodeOrchestrator {
    rendition_repo: Arc<dyn RenditionRepo>,
    /// Backs [`TranscodeSession`] lifecycle (create/lookup/expire) — see
    /// the module docs for why sessions live here rather than in
    /// `playarr-db`.
    cache: Arc<dyn CacheAndPubSub>,
    active_sessions: ActiveSessionCounter,
    /// ffmpeg executable: a bare name resolved on `PATH` by default, or an
    /// absolute path. Overridable via [`Self::with_ffmpeg_binary`] so
    /// tests can point this at a harmless stand-in instead of a real
    /// ffmpeg install.
    ffmpeg_binary: String,
    /// Parent directory for per-session output; each session gets its own
    /// `output_root/<session-id>/` subdirectory.
    output_root: PathBuf,
    session_ttl: Duration,
    /// `None` means unlimited (no admission control) on-demand sessions
    /// for this node.
    max_concurrent_sessions: Option<usize>,
    /// Process handles for sessions this exact node spawned, so
    /// `expire_session` can actually terminate the ffmpeg process instead
    /// of only forgetting about it. Only ever contains sessions this
    /// instance itself spawned — a session owned by a different node (per
    /// `TranscodeSession::owning_node_id`) has no entry here even after
    /// this node's `lookup_session` finds it in the shared cache.
    ///
    /// TODO: expiring a session from a node that isn't its owner (e.g. an
    /// idle-sweep running on a different node in a multi-node deployment)
    /// currently only removes the cache row; it can't reach into the
    /// owning node's process table to kill the ffmpeg process. That needs
    /// a cross-node signal (e.g. a `CacheAndPubSub::publish` on a
    /// per-node control channel) once multi-node on-demand transcode is
    /// actually exercised — deferred, since today every node only ever
    /// expires sessions it owns.
    active_children: Arc<Mutex<HashMap<Uuid, ActiveTranscodeProcess>>>,
    /// Serialises converging cleanup paths per session without keeping the
    /// process-table mutex locked across child termination.
    reaping_sessions: Arc<Mutex<HashSet<Uuid>>>,
    /// Serialises cache lifecycle decisions (touch versus expiry) without
    /// being held while a child is killed or waited.
    session_lifecycle: Arc<Mutex<()>>,
    /// Links the durable/user-facing playback session id returned by the
    /// API to the ephemeral on-demand transcode process serving it. The
    /// ids are deliberately different domains: `PlaybackSession` is an
    /// analytics record, while `TranscodeSession` identifies an ffmpeg
    /// process and its HLS output directory.
    ///
    /// Keeping the association here lets a normal playback Stop/Error
    /// event terminate the exact process immediately. Re-associating the
    /// same playback session (for example after a quality change or a
    /// duplicate negotiation) expires the superseded process instead of
    /// leaving it running until its idle TTL.
    playback_transcodes: Arc<Mutex<HashMap<Uuid, Uuid>>>,
    /// See the module docs' "other bridge" section and
    /// [`Self::with_tdarr_notify`]. `None` (the default) means "don't
    /// notify Tdarr" — correct both when Tdarr isn't configured for this
    /// deployment and when this node doesn't also run the worker role.
    tdarr_notify: Option<mpsc::Sender<MediaFileImportEvent>>,
}

impl TranscodeOrchestrator {
    pub fn new(
        rendition_repo: Arc<dyn RenditionRepo>,
        cache: Arc<dyn CacheAndPubSub>,
        active_sessions: ActiveSessionCounter,
    ) -> Self {
        Self {
            rendition_repo,
            cache,
            active_sessions,
            ffmpeg_binary: "ffmpeg".to_string(),
            output_root: std::env::temp_dir().join("playarr-transcode"),
            session_ttl: Duration::from_secs(60),
            max_concurrent_sessions: None,
            active_children: Arc::new(Mutex::new(HashMap::new())),
            reaping_sessions: Arc::new(Mutex::new(HashSet::new())),
            session_lifecycle: Arc::new(Mutex::new(())),
            playback_transcodes: Arc::new(Mutex::new(HashMap::new())),
            tdarr_notify: None,
        }
    }

    pub fn with_ffmpeg_binary(mut self, ffmpeg_binary: impl Into<String>) -> Self {
        self.ffmpeg_binary = ffmpeg_binary.into();
        self
    }

    /// Wires this orchestrator to notify [`TdarrDispatcher`] (via the same
    /// channel `TdarrDispatcher::new` takes a receiver for) every time it
    /// starts a live on-demand session — see the module docs' "other
    /// bridge" section for why. Skipped entirely (stays `None`) when Tdarr
    /// isn't configured for this deployment.
    pub fn with_tdarr_notify(mut self, tdarr_notify: mpsc::Sender<MediaFileImportEvent>) -> Self {
        self.tdarr_notify = Some(tdarr_notify);
        self
    }

    pub fn with_output_root(mut self, output_root: impl Into<PathBuf>) -> Self {
        self.output_root = output_root.into();
        self
    }

    pub fn with_session_ttl(mut self, session_ttl: Duration) -> Self {
        self.session_ttl = session_ttl;
        self
    }

    pub fn with_max_concurrent_sessions(mut self, max: usize) -> Self {
        self.max_concurrent_sessions = Some(max);
        self
    }

    pub fn active_session_count(&self) -> usize {
        self.active_sessions.get()
    }

    /// Step 1: compares `media_file`'s container/codec/bitrate against
    /// `capabilities`. A pure function (no I/O) so it can be called
    /// synchronously on the playback request's hot path.
    ///
    /// `MediaFile` tracks a single `codec` field (the video codec — *arr
    /// apps report one primary encoding per file, not a separate audio
    /// codec), so this compares it against `supported_video_codecs`.
    /// Audio-codec compatibility can't be checked here without extending
    /// `playarr_model::MediaFile` with an audio-codec field, which is
    /// out of this crate's scope; `capabilities.supported_audio_codecs` is
    /// accepted but currently only informational for callers, not
    /// enforced by this check.
    pub fn can_direct_play(
        &self,
        media_file: &MediaFile,
        capabilities: &ClientCapabilities,
    ) -> bool {
        let container_ok = capabilities
            .supported_containers
            .iter()
            .any(|c| c.eq_ignore_ascii_case(&media_file.container));

        let codec_ok = capabilities
            .supported_video_codecs
            .iter()
            .chain(capabilities.supported_audio_codecs.iter())
            .any(|c| c.eq_ignore_ascii_case(&media_file.codec));

        // An unknown source bitrate (the source *arr instance didn't
        // report one) or an uncapped client can't fail this check — only
        // a known bitrate that's known to exceed a known cap blocks
        // direct play.
        let bitrate_ok = match (media_file.bitrate, capabilities.max_bitrate_bps) {
            (Some(file_bitrate), Some(max_bitrate)) => file_bitrate <= max_bitrate,
            _ => true,
        };

        container_ok && codec_ok && bitrate_ok
    }

    /// Step 2: looks up whether a `Ready` rendition already exists for
    /// this `(media_file_id, profile)` pair — via
    /// `RenditionRepo::find_ready` — regardless of whether the background
    /// Tdarr pipeline or a previous on-demand session produced it.
    pub async fn find_existing_rendition(
        &self,
        media_file_id: Uuid,
        profile: &str,
    ) -> Result<Option<Rendition>, TranscodeError> {
        let rendition = self
            .rendition_repo
            .find_ready(media_file_id, profile)
            .await?;
        Ok(rendition)
    }

    /// Step 3, last resort: starts a new [`TranscodeSession`] on
    /// `owning_node_id`. Returns once the ffmpeg process has been spawned
    /// (not once the whole transcode completes) and the session is
    /// recorded in the cache. Errors with `TranscodeError::NoCapacity`
    /// when this node has no spare on-demand worker slot per
    /// `with_max_concurrent_sessions` (policy for what happens next —
    /// queue, reject, route to another node — is the caller's, informed by
    /// `playarr_model::Policy::can_transcode` and node load).
    pub async fn spawn_on_demand_transcode(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
    ) -> Result<TranscodeSession, TranscodeError> {
        self.spawn_on_demand_transcode_at(media_file, profile, owning_node_id, 0)
            .await
    }

    /// Starts a short-lived HLS transcode at an absolute source timestamp.
    /// Used when a player seeks beyond the currently-produced live
    /// playlist: the old process is stopped by its playback session, and a
    /// replacement process begins encoding from this source position.
    pub async fn spawn_on_demand_transcode_at(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
    ) -> Result<TranscodeSession, TranscodeError> {
        self.spawn_on_demand_transcode_at_with_audio(
            media_file,
            profile,
            owning_node_id,
            start_position_ms,
            None,
        )
        .await
    }

    pub async fn spawn_on_demand_transcode_at_with_audio(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
        audio_stream_index: Option<u32>,
    ) -> Result<TranscodeSession, TranscodeError> {
        let source_path = playarr_model::resolve_media_path(&media_file.path);
        self.spawn_on_demand_transcode_from_path_at_with_audio(
            media_file,
            &source_path,
            None,
            profile,
            owning_node_id,
            start_position_ms,
            audio_stream_index,
        )
        .await
    }

    /// Starts a short-lived HLS transcode from an already-resolved source
    /// path. `source_path` is passed to ffmpeg verbatim, which permits API
    /// callers to supply a descriptor-pinned path such as
    /// `/proc/<api-pid>/fd/<fd>`. When present, `source_guard` owns that
    /// descriptor for the complete active process lifetime.
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_on_demand_transcode_from_path_at_with_audio(
        &self,
        media_file: &MediaFile,
        source_path: &Path,
        source_guard: Option<std::fs::File>,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
        audio_stream_index: Option<u32>,
    ) -> Result<TranscodeSession, TranscodeError> {
        if let Some(max) = self.max_concurrent_sessions {
            let active = self.active_sessions.get();
            if active >= max {
                return Err(TranscodeError::NoCapacity);
            }
        }

        let target_profile = TranscodeTargetProfile::resolve(profile);
        let session_id = Uuid::new_v4();
        let output_dir = self.output_root.join(session_id.to_string());
        tokio::fs::create_dir_all(&output_dir).await?;

        let args = build_ffmpeg_hls_args_at_with_audio(
            source_path,
            &target_profile,
            &output_dir,
            start_position_ms,
            audio_stream_index,
        );

        let mut command = Command::new(&self.ffmpeg_binary);
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            // Don't let a spawned ffmpeg outlive this process (e.g. on a
            // panic unwind) with nothing left to ever expire its session.
            .kill_on_drop(true);

        let child = command.spawn()?;
        let source_is_descriptor_pinned = source_guard.is_some();
        let active_process = ActiveTranscodeProcess {
            child,
            _source_guard: source_guard,
        };

        let now = Utc::now();
        let session = TranscodeSession {
            id: session_id,
            media_file_id: media_file.id,
            profile: profile.to_string(),
            owning_node_id: owning_node_id.to_string(),
            current_segment: 0,
            expires_at: now
                + chrono::Duration::from_std(self.session_ttl).unwrap_or(chrono::Duration::zero()),
        };

        if let Err(err) = self.store_session(&session).await {
            // We already spawned a real process — don't leak it if we
            // can't record the session anywhere lookups will find it.
            active_process.kill_and_reap().await;
            return Err(err);
        }

        self.active_children
            .lock()
            .await
            .insert(session.id, active_process);
        self.active_sessions.increment();
        self.spawn_session_watchdog(&session);

        // A descriptor-pinned source must never enqueue the persisted media
        // path for Tdarr: that asynchronous reopen would be unpinned and
        // could resolve to different content. Ordinary sources still notify
        // Tdarr so a future request can use a durable rendition. `try_send`,
        // never awaited: a full/closed channel must not affect playback.
        if !source_is_descriptor_pinned {
            if let Some(tdarr_notify) = &self.tdarr_notify {
                let _ = tdarr_notify.try_send(MediaFileImportEvent {
                    media_file: media_file.clone(),
                });
            }
        }

        Ok(session)
    }

    /// Looks up a [`TranscodeSession`] by id, regardless of which node
    /// owns it — the cache entry is visible cluster-wide even though only
    /// the owning node has the actual ffmpeg process.
    /// The on-disk directory a live on-demand session's ffmpeg process
    /// writes its HLS playlist/segments into -- `playarr-api`'s media-
    /// serving routes use this to find the actual files a client's
    /// `playlist.m3u8`/segment requests resolve to. Same derivation
    /// `spawn_on_demand_transcode` already uses internally, exposed here
    /// rather than duplicated at the call site.
    pub fn session_output_dir(&self, session_id: Uuid) -> PathBuf {
        self.output_root.join(session_id.to_string())
    }

    /// Looks up a persisted [`Rendition`] by id -- `playarr-api`'s media-
    /// serving routes use this to resolve a `renditions/{id}/...` request
    /// to the on-disk directory `Rendition::output_path` points at.
    /// Delegates to the same `RenditionRepo` `find_existing_rendition`
    /// already wraps, rather than exposing that repo directly on
    /// `AppState` as a second, parallel path to the same data.
    pub async fn get_rendition(&self, id: Uuid) -> Result<Rendition, TranscodeError> {
        Ok(self.rendition_repo.get(id).await?)
    }

    /// Reads a live [`TranscodeSession`] without extending its idle expiry.
    ///
    /// Request paths that still need to authorise the caller must use this
    /// method first, then call [`Self::touch_session`] only after access is
    /// allowed. A missing cache entry also triggers owner-local process,
    /// descriptor, capacity, and output cleanup.
    pub async fn peek_session(
        &self,
        session_id: Uuid,
    ) -> Result<Option<TranscodeSession>, TranscodeError> {
        let reaper = self.local_session_reaper();
        let lifecycle = self.session_lifecycle.lock().await;
        if self.reaping_sessions.lock().await.contains(&session_id) {
            return Ok(None);
        }

        let key = Self::session_cache_key(session_id);
        let Some(bytes) = self.cache.get(&key).await? else {
            let claimed = reaper.claim(session_id).await;
            let cleanup = claimed.then(|| reaper.spawn_claimed_reap(session_id));
            drop(lifecycle);
            if let Some(cleanup) = cleanup {
                cleanup.await??;
            }
            return Ok(None);
        };
        let session = serde_json::from_slice(&bytes)?;
        drop(lifecycle);
        Ok(Some(session))
    }

    /// Extends an already-authorised session's idle expiry by one full
    /// `session_ttl` and returns the refreshed value. The cache is re-read
    /// first so authorisation that finishes after the old deadline cannot
    /// resurrect an expired process.
    pub async fn touch_session(
        &self,
        session: TranscodeSession,
    ) -> Result<Option<TranscodeSession>, TranscodeError> {
        let reaper = self.local_session_reaper();
        let lifecycle = self.session_lifecycle.lock().await;
        if self.reaping_sessions.lock().await.contains(&session.id) {
            return Ok(None);
        }

        let key = Self::session_cache_key(session.id);
        let Some(bytes) = self.cache.get(&key).await? else {
            let claimed = reaper.claim(session.id).await;
            let cleanup = claimed.then(|| reaper.spawn_claimed_reap(session.id));
            drop(lifecycle);
            if let Some(cleanup) = cleanup {
                cleanup.await??;
            }
            return Ok(None);
        };
        let mut current: TranscodeSession = serde_json::from_slice(&bytes)?;
        let same_session = current.id == session.id
            && current.media_file_id == session.media_file_id
            && current.profile == session.profile
            && current.owning_node_id == session.owning_node_id;
        if !same_session || current.expires_at <= Utc::now() {
            self.cache.delete(&key).await?;
            let claimed = reaper.claim(session.id).await;
            let cleanup = claimed.then(|| reaper.spawn_claimed_reap(session.id));
            drop(lifecycle);
            if let Some(cleanup) = cleanup {
                cleanup.await??;
            }
            return Ok(None);
        }

        current.expires_at = Utc::now()
            + chrono::Duration::from_std(self.session_ttl).unwrap_or(chrono::Duration::zero());
        self.store_session(&current).await?;
        drop(lifecycle);
        Ok(Some(current))
    }

    /// Compatibility lookup for callers that are already authorised: reads
    /// the session and immediately renews its idle expiry. Pre-authorisation
    /// request paths must use [`Self::peek_session`] instead.
    pub async fn lookup_session(
        &self,
        session_id: Uuid,
    ) -> Result<Option<TranscodeSession>, TranscodeError> {
        let Some(session) = self.peek_session(session_id).await? else {
            return Ok(None);
        };
        self.touch_session(session).await
    }

    /// Ends a [`TranscodeSession`]: removes it from the cache (so no
    /// further lookups find it) and, if this node owns the underlying
    /// process, kills it and releases its capacity slot.
    pub async fn expire_session(&self, session_id: Uuid) -> Result<(), TranscodeError> {
        let reaper = self.local_session_reaper();
        let lifecycle = self.session_lifecycle.lock().await;
        self.cache
            .delete(&Self::session_cache_key(session_id))
            .await?;
        let claimed = reaper.claim(session_id).await;
        let cleanup = claimed.then(|| reaper.spawn_claimed_reap(session_id));
        drop(lifecycle);
        if let Some(cleanup) = cleanup {
            cleanup.await?
        } else {
            Ok(())
        }
    }

    fn local_session_reaper(&self) -> LocalSessionReaper {
        LocalSessionReaper {
            active_children: Arc::clone(&self.active_children),
            reaping_sessions: Arc::clone(&self.reaping_sessions),
            session_lifecycle: Arc::clone(&self.session_lifecycle),
            playback_transcodes: Arc::clone(&self.playback_transcodes),
            active_sessions: self.active_sessions.clone(),
            output_root: self.output_root.clone(),
        }
    }

    fn spawn_session_watchdog(&self, session: &TranscodeSession) {
        let cache = Arc::clone(&self.cache);
        let reaper = self.local_session_reaper();
        let session_id = session.id;
        let key = Self::session_cache_key(session_id);
        let maximum_delay = self.session_ttl.max(SESSION_WATCHDOG_MIN_RECHECK);
        let mut delay = session_watchdog_delay(&session.expires_at, maximum_delay);

        tokio::spawn(async move {
            let mut consecutive_cache_errors = 0;
            let cleanup_claimed = loop {
                tokio::time::sleep(delay).await;
                let lifecycle = reaper.session_lifecycle.lock().await;
                match cache.get(&key).await {
                    Ok(None) => {
                        let claimed = reaper.claim(session_id).await;
                        drop(lifecycle);
                        break claimed;
                    }
                    Ok(Some(bytes)) => {
                        consecutive_cache_errors = 0;
                        match serde_json::from_slice::<TranscodeSession>(&bytes) {
                            Ok(refreshed) if refreshed.expires_at > Utc::now() => {
                                delay =
                                    session_watchdog_delay(&refreshed.expires_at, maximum_delay);
                                drop(lifecycle);
                            }
                            Ok(_) => {
                                let _ = cache.delete(&key).await;
                                let claimed = reaper.claim(session_id).await;
                                drop(lifecycle);
                                break claimed;
                            }
                            Err(err) => {
                                tracing::warn!(
                                    %session_id,
                                    error = %err,
                                    "reaping transcode session with invalid cached state",
                                );
                                let _ = cache.delete(&key).await;
                                let claimed = reaper.claim(session_id).await;
                                drop(lifecycle);
                                break claimed;
                            }
                        }
                    }
                    Err(err) => {
                        consecutive_cache_errors += 1;
                        tracing::warn!(
                            %session_id,
                            error = %err,
                            attempt = consecutive_cache_errors,
                            "failed to check transcode session expiry",
                        );
                        if consecutive_cache_errors >= SESSION_WATCHDOG_MAX_CACHE_ERRORS {
                            let claimed = reaper.claim(session_id).await;
                            drop(lifecycle);
                            break claimed;
                        }
                        delay = SESSION_WATCHDOG_CACHE_RETRY;
                        drop(lifecycle);
                    }
                }
            };

            if cleanup_claimed {
                if let Err(err) = reaper.reap_claimed(session_id).await {
                    tracing::warn!(
                        %session_id,
                        error = %err,
                        "failed to finish expired transcode session cleanup",
                    );
                }
            }
        });
    }

    /// Associates a user-facing playback session with its live ffmpeg
    /// session. If the playback session already pointed at another
    /// transcode (quality replacement or duplicate negotiation), the old
    /// process is stopped before this call returns.
    pub async fn associate_playback_session(
        &self,
        playback_session_id: Uuid,
        transcode_session_id: Uuid,
    ) -> Result<(), TranscodeError> {
        let superseded = self
            .playback_transcodes
            .lock()
            .await
            .insert(playback_session_id, transcode_session_id);

        if let Some(superseded) = superseded.filter(|id| *id != transcode_session_id) {
            self.expire_session(superseded).await?;
        }

        Ok(())
    }

    /// Stops the on-demand transcode, if any, that belongs to a
    /// user-facing playback session. Direct-play and durable-rendition
    /// sessions have no association and are therefore harmless no-ops.
    pub async fn expire_playback_session(
        &self,
        playback_session_id: Uuid,
    ) -> Result<(), TranscodeError> {
        let transcode_session_id = self
            .playback_transcodes
            .lock()
            .await
            .remove(&playback_session_id);

        if let Some(transcode_session_id) = transcode_session_id {
            self.expire_session(transcode_session_id).await?;
        }

        Ok(())
    }

    fn session_cache_key(session_id: Uuid) -> String {
        format!("transcode-session:{session_id}")
    }

    async fn store_session(&self, session: &TranscodeSession) -> Result<(), TranscodeError> {
        let ttl = (session.expires_at - Utc::now())
            .to_std()
            .unwrap_or(Duration::ZERO);
        let bytes = serde_json::to_vec(session)?;
        self.cache
            .set(&Self::session_cache_key(session.id), bytes, Some(ttl))
            .await?;
        Ok(())
    }
}

/// A signal that a `MediaFile` was newly imported or upgraded — the
/// trigger for `TdarrDispatcher` to hand it to Tdarr via
/// `scan_individual_file`. There is no `MediaFileRepo` in `playarr-db`
/// yet for `TdarrDispatcher` to poll on its own, so dispatch is entirely
/// event-driven: whatever owns the import/upgrade event (an *arr webhook
/// handler, `playarr-arr-sync`'s reconciliation poller, etc. — outside
/// this crate) sends one of these on the channel `TdarrDispatcher::new`
/// takes a `Receiver` for.
#[derive(Debug, Clone)]
pub struct MediaFileImportEvent {
    pub media_file: MediaFile,
}

/// Static configuration for [`TdarrDispatcher`] — grouped into one struct
/// (rather than positional constructor args) since it's a handful of
/// deployment-specific knobs that are set once at startup, not values that
/// vary per call.
#[derive(Debug, Clone)]
pub struct TdarrDispatcherConfig {
    /// The Tdarr library database id `scan_individual_file` dispatches
    /// into. Playarr Server currently assumes one Tdarr library per
    /// deployment; if that stops being true this would need to become a
    /// per-`MediaFile` lookup instead of one fixed id.
    pub tdarr_db_id: String,
    /// The rendition profile checked via `RenditionRepo::find_ready`
    /// before dispatching — if a `Ready` rendition already exists for a
    /// `MediaFile` at this profile, there's nothing for Tdarr to do.
    pub default_profile: String,
    /// Which Tdarr worker pool `alter_worker_limit` throttles, e.g.
    /// `"transcodecpu"`.
    pub worker_process: String,
    /// Worker limit applied when the active on-demand session count is
    /// below `active_session_threshold`.
    pub default_worker_limit: i32,
    /// Worker limit applied at/above `active_session_threshold` —
    /// throttling background transcoding to leave CPU/GPU headroom for
    /// live on-demand playback.
    pub throttled_worker_limit: i32,
    pub active_session_threshold: usize,
    /// How often `TdarrDispatcher::run` re-checks session count and
    /// (re)applies the worker limit.
    pub throttle_check_interval: Duration,
}

/// The background path: proactively drives Tdarr to produce
/// [`Rendition`]s ahead of playback, so `TranscodeOrchestrator::find_existing_rendition`
/// has something to find instead of every session falling through to
/// on-demand. Runs as its own worker loop (role = `Worker`/`All`), separate
/// from the request-scoped `TranscodeOrchestrator`.
pub struct TdarrDispatcher {
    tdarr: TdarrClient,
    rendition_repo: Arc<dyn RenditionRepo>,
    active_sessions: ActiveSessionCounter,
    events_rx: mpsc::Receiver<MediaFileImportEvent>,
    config: TdarrDispatcherConfig,
}

impl TdarrDispatcher {
    pub fn new(
        tdarr: TdarrClient,
        rendition_repo: Arc<dyn RenditionRepo>,
        active_sessions: ActiveSessionCounter,
        events_rx: mpsc::Receiver<MediaFileImportEvent>,
        config: TdarrDispatcherConfig,
    ) -> Self {
        Self {
            tdarr,
            rendition_repo,
            active_sessions,
            events_rx,
            config,
        }
    }

    /// Runs until the event channel closes (process shutdown dropping the
    /// paired `Sender`): on `config.throttle_check_interval`, re-evaluates
    /// Tdarr worker limits against the active on-demand session count
    /// (`check_and_apply_throttle`); on each `MediaFileImportEvent`,
    /// dispatches that file to Tdarr if it needs it (`dispatch_one`).
    pub async fn run(mut self) -> Result<(), TranscodeError> {
        let mut throttle_interval = tokio::time::interval(self.config.throttle_check_interval);
        // `interval` fires immediately on its first tick; skip that one so
        // we don't hit Tdarr before anything has had a chance to change.
        throttle_interval.tick().await;

        loop {
            tokio::select! {
                _ = throttle_interval.tick() => {
                    if let Err(error) = self.check_and_apply_throttle().await {
                        tracing::warn!(%error, "tdarr worker-limit throttle check failed");
                    }
                }
                event = self.events_rx.recv() => {
                    match event {
                        Some(event) => {
                            if let Err(error) = self.dispatch_one(&event.media_file).await {
                                tracing::warn!(
                                    %error,
                                    media_file_id = %event.media_file.id,
                                    "failed to dispatch media file to tdarr",
                                );
                            }
                        }
                        None => {
                            tracing::info!("tdarr dispatcher event channel closed; shutting down");
                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    /// Hands one `MediaFile` to Tdarr via `scan_individual_file`, unless a
    /// `Ready` rendition already covers it at `config.default_profile`.
    async fn dispatch_one(&self, media_file: &MediaFile) -> Result<(), TranscodeError> {
        let already_ready = self
            .rendition_repo
            .find_ready(media_file.id, &self.config.default_profile)
            .await?
            .is_some();

        if already_ready {
            tracing::debug!(
                media_file_id = %media_file.id,
                "skipping tdarr dispatch: ready rendition already exists",
            );
            return Ok(());
        }

        let request = ScanIndividualFileRequest {
            db_id: self.config.tdarr_db_id.clone(),
            file_path: media_file.path.to_string_lossy().into_owned(),
        };
        self.tdarr.scan_individual_file(&request).await?;
        Ok(())
    }

    /// Raises/lowers every connected Tdarr node's `config.worker_process`
    /// worker limit based on whether the active on-demand session count
    /// has crossed `config.active_session_threshold` — background
    /// transcoding backs off to leave capacity for live playback when the
    /// node is busy serving on-demand sessions, and resumes at its normal
    /// limit once it isn't.
    async fn check_and_apply_throttle(&self) -> Result<(), TranscodeError> {
        let active = self.active_sessions.get();
        let target_limit = if active >= self.config.active_session_threshold {
            self.config.throttled_worker_limit
        } else {
            self.config.default_worker_limit
        };

        let nodes = self.tdarr.get_nodes().await?;
        for node in nodes {
            self.tdarr
                .alter_worker_limit(&AlterWorkerLimitRequest {
                    node_id: node.node_id,
                    process: self.config.worker_process.clone(),
                    worker_limit: target_limit,
                })
                .await?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;
    use std::sync::Mutex as StdMutex;

    use async_trait::async_trait;
    use playarr_cache::InMemory;
    use playarr_model::media::LeafRef;
    use playarr_model::{ProducedBy, RenditionStatus};

    // ---- shared test fixtures --------------------------------------

    #[derive(Default)]
    struct FakeRenditionRepo {
        renditions: StdMutex<StdHashMap<Uuid, Rendition>>,
    }

    impl FakeRenditionRepo {
        fn with_ready(media_file_id: Uuid, profile: &str) -> Self {
            let repo = Self::default();
            let rendition = Rendition {
                id: Uuid::new_v4(),
                media_file_id,
                profile: profile.to_string(),
                container: "mp4".to_string(),
                codec: "h264".to_string(),
                bitrate: Some(4_000_000),
                output_path: PathBuf::from("/renditions/out/playlist.m3u8"),
                produced_by: ProducedBy::Tdarr,
                produced_at: Utc::now(),
                status: RenditionStatus::Ready,
            };
            repo.renditions
                .lock()
                .unwrap()
                .insert(rendition.id, rendition);
            repo
        }
    }

    #[async_trait]
    impl RenditionRepo for FakeRenditionRepo {
        async fn get(&self, id: Uuid) -> Result<Rendition, playarr_db::DbError> {
            self.renditions
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or(playarr_db::DbError::NotFound)
        }

        async fn list_for_media_file(
            &self,
            media_file_id: Uuid,
        ) -> Result<Vec<Rendition>, playarr_db::DbError> {
            Ok(self
                .renditions
                .lock()
                .unwrap()
                .values()
                .filter(|r| r.media_file_id == media_file_id)
                .cloned()
                .collect())
        }

        async fn find_ready(
            &self,
            media_file_id: Uuid,
            profile: &str,
        ) -> Result<Option<Rendition>, playarr_db::DbError> {
            Ok(self
                .renditions
                .lock()
                .unwrap()
                .values()
                .find(|r| {
                    r.media_file_id == media_file_id
                        && r.profile == profile
                        && r.status == RenditionStatus::Ready
                })
                .cloned())
        }

        async fn upsert(&self, rendition: &Rendition) -> Result<(), playarr_db::DbError> {
            self.renditions
                .lock()
                .unwrap()
                .insert(rendition.id, rendition.clone());
            Ok(())
        }

        async fn delete(&self, id: Uuid) -> Result<(), playarr_db::DbError> {
            self.renditions.lock().unwrap().remove(&id);
            Ok(())
        }

        async fn mark_status(
            &self,
            id: Uuid,
            status: RenditionStatus,
        ) -> Result<(), playarr_db::DbError> {
            if let Some(rendition) = self.renditions.lock().unwrap().get_mut(&id) {
                rendition.status = status;
            }
            Ok(())
        }
    }

    fn sample_media_file() -> MediaFile {
        MediaFile {
            id: Uuid::new_v4(),
            work_id: Uuid::new_v4(),
            leaf_ref: LeafRef::Work,
            path: PathBuf::from("/media/movies/Sample (2024)/Sample.mkv"),
            container: "mkv".to_string(),
            codec: "hevc".to_string(),
            bitrate: Some(15_000_000),
            duration_ms: None,
            size_bytes: 4_000_000_000,
            source_instance_id: Uuid::new_v4(),
            source_file_id: Some("123".to_string()),
        }
    }

    fn sample_capabilities() -> ClientCapabilities {
        ClientCapabilities {
            supported_containers: vec!["mp4".to_string()],
            supported_video_codecs: vec!["h264".to_string()],
            supported_audio_codecs: vec!["aac".to_string()],
            max_bitrate_bps: Some(10_000_000),
        }
    }

    fn unique_tmp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("playarr-transcode-test-{}", Uuid::new_v4()))
    }

    fn test_orchestrator(rendition_repo: Arc<dyn RenditionRepo>) -> TranscodeOrchestrator {
        TranscodeOrchestrator::new(
            rendition_repo,
            Arc::new(InMemory::new()),
            ActiveSessionCounter::new(),
        )
        .with_ffmpeg_binary("/usr/bin/true")
        .with_output_root(unique_tmp_dir())
    }

    // ---- can_direct_play ---------------------------------------------

    mod can_direct_play {
        use super::*;

        #[test]
        fn direct_play_when_everything_matches() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(4_000_000);

            assert!(orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn audio_only_file_matches_audio_capabilities() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp3".to_string();
            media_file.codec = "mp3".to_string();
            media_file.bitrate = Some(320_000);
            let mut capabilities = sample_capabilities();
            capabilities.supported_containers.push("mp3".to_string());
            capabilities.supported_audio_codecs.push("mp3".to_string());

            assert!(orchestrator.can_direct_play(&media_file, &capabilities));
        }

        #[test]
        fn unsupported_container_forces_transcode() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mkv".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(4_000_000);

            assert!(!orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn unsupported_video_codec_forces_transcode() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "hevc".to_string();
            media_file.bitrate = Some(4_000_000);

            assert!(!orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn bitrate_over_client_cap_forces_transcode() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(20_000_000);

            assert!(!orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn container_comparison_is_case_insensitive() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "MP4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(4_000_000);

            assert!(orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn unknown_source_bitrate_does_not_block_direct_play() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = None;

            assert!(orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn uncapped_client_does_not_block_direct_play() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(50_000_000);

            let mut capabilities = sample_capabilities();
            capabilities.max_bitrate_bps = None;

            assert!(orchestrator.can_direct_play(&media_file, &capabilities));
        }
    }

    // ---- ffmpeg command construction ----------------------------------

    mod ffmpeg_args {
        use super::*;

        #[test]
        fn builds_expected_argv_with_bitrates() {
            let profile = TranscodeTargetProfile {
                name: "h264-720p-4mbps".to_string(),
                height: 720,
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
                quality_level: TranscodeQualityLevel::Medium,
                video_bitrate_kbps: Some(4000),
                audio_bitrate_kbps: Some(128),
            };

            let args = build_ffmpeg_hls_args(
                Path::new("/media/in.mkv"),
                &profile,
                Path::new("/tmp/session-1"),
            );

            let expected: Vec<String> = [
                "-y",
                "-i",
                "/media/in.mkv",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-sn",
                "-vf",
                "scale=-2:min(720\\,ih)",
                "-b:v",
                "4000k",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-f",
                "hls",
                "-hls_time",
                "4",
                "-hls_playlist_type",
                "event",
                "-hls_list_size",
                "0",
                "-hls_segment_filename",
                "/tmp/session-1/segment_%05d.ts",
                "/tmp/session-1/playlist.m3u8",
            ]
            .into_iter()
            .map(str::to_string)
            .collect();

            assert_eq!(args, expected);
        }

        #[test]
        fn omits_bitrate_flags_when_profile_has_none() {
            let profile = TranscodeTargetProfile {
                name: "custom".to_string(),
                height: 0,
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
                quality_level: TranscodeQualityLevel::Medium,
                video_bitrate_kbps: None,
                audio_bitrate_kbps: None,
            };

            let args = build_ffmpeg_hls_args(
                Path::new("/media/in.mkv"),
                &profile,
                Path::new("/tmp/session-2"),
            );

            assert!(!args.iter().any(|a| a == "-b:v"));
            assert!(!args.iter().any(|a| a == "-b:a"));
            assert!(args.iter().any(|a| a == "-c:v"));
            assert!(args.iter().any(|a| a == "-c:a"));
            assert_eq!(
                args[args.iter().position(|a| a == "-pix_fmt").unwrap() + 1],
                "yuv420p"
            );
        }

        #[test]
        fn input_and_output_paths_are_positioned_correctly() {
            let profile = TranscodeTargetProfile::resolve("h264-480p-2mbps");
            let args = build_ffmpeg_hls_args(
                Path::new("/library/movie.mkv"),
                &profile,
                Path::new("/tmp/session-3"),
            );

            let i_index = args.iter().position(|a| a == "-i").unwrap();
            assert_eq!(args[i_index + 1], "/library/movie.mkv");

            // The playlist path (the ffmpeg output) is always the final
            // argument.
            assert_eq!(args.last().unwrap(), "/tmp/session-3/playlist.m3u8");
        }

        #[test]
        fn source_seek_is_applied_before_input_with_millisecond_precision() {
            let profile = TranscodeTargetProfile::resolve("h264-720p-4mbps");
            let args = build_ffmpeg_hls_args_at(
                Path::new("/library/episode.mkv"),
                &profile,
                Path::new("/tmp/session-seek"),
                1_234_567,
            );

            let seek_index = args.iter().position(|arg| arg == "-ss").unwrap();
            let input_index = args.iter().position(|arg| arg == "-i").unwrap();
            assert_eq!(args[seek_index + 1], "1234.567");
            assert!(seek_index < input_index);
        }

        #[test]
        fn maps_the_selected_global_source_audio_stream() {
            let profile = TranscodeTargetProfile::resolve("h264-720p-4mbps");
            let args = build_ffmpeg_hls_args_at_with_audio(
                Path::new("/library/episode.mkv"),
                &profile,
                Path::new("/tmp/session-audio"),
                45_000,
                Some(4),
            );

            let maps = args
                .windows(2)
                .filter(|pair| pair[0] == "-map")
                .map(|pair| pair[1].as_str())
                .collect::<Vec<_>>();
            assert_eq!(maps, vec!["0:v:0", "0:4"]);
            assert!(args.iter().any(|arg| arg == "-sn"));
        }

        #[test]
        fn selected_quality_caps_the_real_output_height_without_upscaling() {
            let profile = TranscodeTargetProfile::resolve("h264-480p-2mbps");
            let args = build_ffmpeg_hls_args(
                Path::new("/library/episode.mkv"),
                &profile,
                Path::new("/tmp/session-quality"),
            );

            let filter_index = args.iter().position(|arg| arg == "-vf").unwrap();
            assert_eq!(args[filter_index + 1], "scale=-2:min(480\\,ih)");
        }

        #[test]
        fn resolve_known_profile_maps_expected_codecs_and_bitrate() {
            let profile = TranscodeTargetProfile::resolve("h264-1080p-8mbps");
            assert_eq!(profile.height, 1080);
            assert_eq!(profile.video_codec, "libx264");
            assert_eq!(profile.audio_codec, "aac");
            assert_eq!(profile.video_bitrate_kbps, Some(8000));
            assert_eq!(profile.audio_bitrate_kbps, Some(192));
        }

        #[test]
        fn resolve_unknown_profile_falls_back_to_a_sane_default() {
            let profile = TranscodeTargetProfile::resolve("totally-unrecognized-profile");
            assert_eq!(profile.height, 720);
            assert_eq!(profile.video_codec, "libx264");
            assert_eq!(profile.audio_codec, "aac");
            assert!(profile.video_bitrate_kbps.is_some());
        }

        #[test]
        fn supported_profiles_are_the_real_ladder_in_display_order() {
            let profiles = TranscodeTargetProfile::supported();
            assert_eq!(
                profiles
                    .iter()
                    .map(|profile| profile.height)
                    .collect::<Vec<_>>(),
                vec![2160, 2160, 2160, 1080, 1080, 1080, 720, 720, 720, 480, 480, 480]
            );
            assert_eq!(profiles[0].name, "h264-2160p-12mbps");
            assert_eq!(profiles[1].quality_level, TranscodeQualityLevel::Medium);
            assert_eq!(profiles[11].video_bitrate_kbps, Some(3000));
        }
    }

    // ---- TranscodeSession lifecycle -----------------------------------

    mod session_lifecycle {
        use super::*;

        #[cfg(unix)]
        #[tokio::test]
        async fn explicit_source_path_is_forwarded_to_ffmpeg() {
            use std::os::unix::fs::PermissionsExt;

            let test_root = unique_tmp_dir();
            std::fs::create_dir_all(&test_root).unwrap();
            let captured_args_path = test_root.join("ffmpeg-args.txt");
            let fake_ffmpeg_path = test_root.join("fake-ffmpeg");
            std::fs::write(
                &fake_ffmpeg_path,
                format!(
                    "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\n",
                    captured_args_path.display()
                ),
            )
            .unwrap();
            std::fs::set_permissions(&fake_ffmpeg_path, std::fs::Permissions::from_mode(0o700))
                .unwrap();

            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary(fake_ffmpeg_path.to_string_lossy())
            .with_output_root(test_root.join("output"));
            let media_file = sample_media_file();
            let source_path = Path::new("/proc/4242/fd/17");

            let session = orchestrator
                .spawn_on_demand_transcode_from_path_at_with_audio(
                    &media_file,
                    source_path,
                    None,
                    "h264-720p-4mbps",
                    "node-a",
                    12_345,
                    Some(7),
                )
                .await
                .unwrap();

            let captured_args = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    if let Ok(args) = tokio::fs::read_to_string(&captured_args_path).await {
                        break args;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("fake ffmpeg should capture its arguments");
            let captured_args = captured_args.lines().collect::<Vec<_>>();
            let input_index = captured_args
                .iter()
                .position(|arg| *arg == "-i")
                .expect("ffmpeg args should contain an input flag");
            assert_eq!(
                captured_args[input_index + 1],
                source_path.to_str().unwrap()
            );

            orchestrator.expire_session(session.id).await.unwrap();
            std::fs::remove_dir_all(test_root).unwrap();
        }

        #[cfg(target_os = "linux")]
        #[tokio::test]
        async fn source_guard_is_retained_until_session_expiry() {
            use std::os::fd::AsRawFd;

            let test_root = unique_tmp_dir();
            std::fs::create_dir_all(&test_root).unwrap();
            let source_file_path = test_root.join("pinned-source.mkv");
            let source_contents = b"descriptor-pinned source";
            std::fs::write(&source_file_path, source_contents).unwrap();
            let source_guard = std::fs::File::open(&source_file_path).unwrap();
            let descriptor_path = PathBuf::from(format!(
                "/proc/{}/fd/{}",
                std::process::id(),
                source_guard.as_raw_fd()
            ));
            std::fs::remove_file(&source_file_path).unwrap();

            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(test_root.join("output"));
            let media_file = sample_media_file();

            let session = orchestrator
                .spawn_on_demand_transcode_from_path_at_with_audio(
                    &media_file,
                    &descriptor_path,
                    Some(source_guard),
                    "h264-720p-4mbps",
                    "node-a",
                    0,
                    None,
                )
                .await
                .unwrap();

            assert_eq!(std::fs::read(&descriptor_path).unwrap(), source_contents);
            {
                let active_children = orchestrator.active_children.lock().await;
                let active_process = active_children
                    .get(&session.id)
                    .expect("spawned session should retain its active process");
                assert!(active_process._source_guard.is_some());
            }

            orchestrator.expire_session(session.id).await.unwrap();

            assert_ne!(
                std::fs::read(&descriptor_path).ok().as_deref(),
                Some(source_contents.as_slice())
            );
            std::fs::remove_dir_all(test_root).unwrap();
        }

        #[cfg(target_os = "linux")]
        #[tokio::test]
        async fn watchdog_reaps_pinned_source_after_passive_expiry() {
            use std::os::fd::AsRawFd;

            let test_root = unique_tmp_dir();
            std::fs::create_dir_all(&test_root).unwrap();
            let source_file_path = test_root.join("passively-expiring-source.mkv");
            let source_contents = b"passively expiring descriptor";
            std::fs::write(&source_file_path, source_contents).unwrap();
            let source_guard = std::fs::File::open(&source_file_path).unwrap();
            let descriptor_path = PathBuf::from(format!(
                "/proc/{}/fd/{}",
                std::process::id(),
                source_guard.as_raw_fd()
            ));
            std::fs::remove_file(&source_file_path).unwrap();

            let counter = ActiveSessionCounter::new();
            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                counter.clone(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(test_root.join("output"))
            .with_session_ttl(Duration::from_millis(30));
            let media_file = sample_media_file();

            let session = orchestrator
                .spawn_on_demand_transcode_from_path_at_with_audio(
                    &media_file,
                    &descriptor_path,
                    Some(source_guard),
                    "h264-720p-4mbps",
                    "node-a",
                    0,
                    None,
                )
                .await
                .unwrap();
            let output_dir = orchestrator.session_output_dir(session.id);

            assert_eq!(counter.get(), 1);
            assert!(orchestrator
                .active_children
                .lock()
                .await
                .contains_key(&session.id));
            assert_eq!(std::fs::read(&descriptor_path).unwrap(), source_contents);
            assert!(output_dir.exists());

            tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    let process_reaped = !orchestrator
                        .active_children
                        .lock()
                        .await
                        .contains_key(&session.id);
                    let descriptor_released = std::fs::read(&descriptor_path).ok().as_deref()
                        != Some(source_contents.as_slice());
                    if process_reaped
                        && descriptor_released
                        && counter.get() == 0
                        && !output_dir.exists()
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("watchdog should fully reap an idle pinned session");

            std::fs::remove_dir_all(test_root).unwrap();
        }

        #[cfg(target_os = "linux")]
        #[tokio::test]
        async fn aborted_expiry_request_does_not_cancel_claimed_cleanup() {
            use std::os::fd::AsRawFd;

            let test_root = unique_tmp_dir();
            std::fs::create_dir_all(&test_root).unwrap();
            let source_file_path = test_root.join("cancelled-expiry-source.mkv");
            let source_contents = b"cleanup must outlive its request";
            std::fs::write(&source_file_path, source_contents).unwrap();
            let source_guard = std::fs::File::open(&source_file_path).unwrap();
            let descriptor_path = PathBuf::from(format!(
                "/proc/{}/fd/{}",
                std::process::id(),
                source_guard.as_raw_fd()
            ));
            std::fs::remove_file(&source_file_path).unwrap();

            let counter = ActiveSessionCounter::new();
            let orchestrator = Arc::new(
                TranscodeOrchestrator::new(
                    Arc::new(FakeRenditionRepo::default()),
                    Arc::new(InMemory::new()),
                    counter.clone(),
                )
                .with_ffmpeg_binary("/usr/bin/true")
                .with_output_root(test_root.join("output")),
            );
            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode_from_path_at_with_audio(
                    &media_file,
                    &descriptor_path,
                    Some(source_guard),
                    "h264-720p-4mbps",
                    "node-a",
                    0,
                    None,
                )
                .await
                .unwrap();
            let output_dir = orchestrator.session_output_dir(session.id);

            // Hold the process table so detached cleanup cannot finish before
            // this test aborts the request that initiated expiry.
            let active_children = orchestrator.active_children.lock().await;
            let expiring_orchestrator = Arc::clone(&orchestrator);
            let session_id = session.id;
            let expiry_request =
                tokio::spawn(async move { expiring_orchestrator.expire_session(session_id).await });

            tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    if orchestrator
                        .reaping_sessions
                        .lock()
                        .await
                        .contains(&session.id)
                    {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("expiry should claim cleanup before the request is aborted");

            expiry_request.abort();
            assert!(expiry_request.await.unwrap_err().is_cancelled());
            drop(active_children);

            tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    let process_reaped = !orchestrator
                        .active_children
                        .lock()
                        .await
                        .contains_key(&session.id);
                    let claim_released = !orchestrator
                        .reaping_sessions
                        .lock()
                        .await
                        .contains(&session.id);
                    let descriptor_released = std::fs::read(&descriptor_path).ok().as_deref()
                        != Some(source_contents.as_slice());
                    if process_reaped
                        && claim_released
                        && descriptor_released
                        && counter.get() == 0
                        && !output_dir.exists()
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("detached cleanup should finish after its request is aborted");

            std::fs::remove_dir_all(test_root).unwrap();
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn descriptor_pinned_source_does_not_enqueue_tdarr_import() {
            let test_root = unique_tmp_dir();
            std::fs::create_dir_all(&test_root).unwrap();
            let source_file_path = test_root.join("pinned-source.mkv");
            std::fs::write(&source_file_path, b"source").unwrap();
            let source_guard = std::fs::File::open(&source_file_path).unwrap();
            let (tdarr_tx, mut tdarr_rx) = mpsc::channel(1);
            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(test_root.join("output"))
            .with_tdarr_notify(tdarr_tx);
            let media_file = sample_media_file();

            let session = orchestrator
                .spawn_on_demand_transcode_from_path_at_with_audio(
                    &media_file,
                    &source_file_path,
                    Some(source_guard),
                    "h264-720p-4mbps",
                    "node-a",
                    0,
                    None,
                )
                .await
                .unwrap();

            assert!(matches!(
                tdarr_rx.try_recv(),
                Err(mpsc::error::TryRecvError::Empty)
            ));

            orchestrator.expire_session(session.id).await.unwrap();
            std::fs::remove_dir_all(test_root).unwrap();
        }

        #[tokio::test]
        async fn peek_does_not_extend_the_idle_deadline() {
            let counter = ActiveSessionCounter::new();
            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                counter.clone(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(unique_tmp_dir())
            .with_session_ttl(Duration::from_millis(300));
            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "node-a")
                .await
                .unwrap();

            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(orchestrator
                .peek_session(session.id)
                .await
                .unwrap()
                .is_some());

            // The original deadline is now past. A renewing lookup at 100ms
            // would still be live here, but a non-touching peek must not be.
            tokio::time::sleep(Duration::from_millis(250)).await;
            assert_eq!(orchestrator.peek_session(session.id).await.unwrap(), None);
            assert_eq!(counter.get(), 0);
        }

        #[tokio::test]
        async fn touch_does_not_resurrect_a_session_that_expired_during_authorisation() {
            let counter = ActiveSessionCounter::new();
            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                counter.clone(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(unique_tmp_dir())
            .with_session_ttl(Duration::from_millis(30));
            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "node-a")
                .await
                .unwrap();
            let peeked = orchestrator
                .peek_session(session.id)
                .await
                .unwrap()
                .expect("new session should be visible before authorisation");

            tokio::time::sleep(Duration::from_millis(150)).await;

            assert_eq!(orchestrator.touch_session(peeked).await.unwrap(), None);
            assert_eq!(orchestrator.peek_session(session.id).await.unwrap(), None);
            assert_eq!(counter.get(), 0);
        }

        #[tokio::test]
        async fn spawn_creates_a_lookupable_session_and_expire_removes_it() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let counter = ActiveSessionCounter::new();
            let orchestrator =
                TranscodeOrchestrator::new(repo, Arc::new(InMemory::new()), counter.clone())
                    .with_ffmpeg_binary("/usr/bin/true")
                    .with_output_root(unique_tmp_dir());

            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "node-a")
                .await
                .expect("spawn should succeed with /usr/bin/true standing in for ffmpeg");

            assert_eq!(session.media_file_id, media_file.id);
            assert_eq!(session.profile, "h264-720p-4mbps");
            assert_eq!(session.owning_node_id, "node-a");
            assert_eq!(session.current_segment, 0);
            assert_eq!(counter.get(), 1);

            // `lookup_session` slides `expires_at` forward on every real
            // access (see its doc comment) -- compare everything else
            // exactly, and only assert `expires_at` moved forward rather
            // than expecting a byte-for-byte match against the
            // just-created `session`.
            let found = orchestrator
                .lookup_session(session.id)
                .await
                .expect("lookup should not error")
                .expect("session should be found");
            assert_eq!(found.id, session.id);
            assert_eq!(found.media_file_id, session.media_file_id);
            assert_eq!(found.profile, session.profile);
            assert_eq!(found.owning_node_id, session.owning_node_id);
            assert_eq!(found.current_segment, session.current_segment);
            assert!(found.expires_at >= session.expires_at);

            orchestrator
                .expire_session(session.id)
                .await
                .expect("expire should not error");
            assert_eq!(counter.get(), 0);

            let after_expiry = orchestrator
                .lookup_session(session.id)
                .await
                .expect("lookup should not error");
            assert_eq!(after_expiry, None);
        }

        #[tokio::test]
        async fn lookup_of_unknown_session_is_none() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            assert_eq!(
                orchestrator.lookup_session(Uuid::new_v4()).await.unwrap(),
                None
            );
        }

        #[tokio::test]
        async fn expiring_an_unknown_session_is_not_an_error() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            orchestrator.expire_session(Uuid::new_v4()).await.unwrap();
        }

        #[tokio::test]
        async fn expiring_a_playback_session_stops_its_associated_transcode() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let counter = ActiveSessionCounter::new();
            let orchestrator =
                TranscodeOrchestrator::new(repo, Arc::new(InMemory::new()), counter.clone())
                    .with_ffmpeg_binary("/usr/bin/true")
                    .with_output_root(unique_tmp_dir());
            let session = orchestrator
                .spawn_on_demand_transcode(&sample_media_file(), "h264-720p-4mbps", "node-a")
                .await
                .unwrap();
            let playback_session_id = Uuid::new_v4();

            orchestrator
                .associate_playback_session(playback_session_id, session.id)
                .await
                .unwrap();
            orchestrator
                .expire_playback_session(playback_session_id)
                .await
                .unwrap();

            assert_eq!(counter.get(), 0);
            assert_eq!(orchestrator.lookup_session(session.id).await.unwrap(), None);
            assert!(!orchestrator.session_output_dir(session.id).exists());
        }

        #[tokio::test]
        async fn replacing_a_playback_sessions_transcode_expires_the_old_one() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let counter = ActiveSessionCounter::new();
            let orchestrator =
                TranscodeOrchestrator::new(repo, Arc::new(InMemory::new()), counter.clone())
                    .with_ffmpeg_binary("/usr/bin/true")
                    .with_output_root(unique_tmp_dir());
            let media_file = sample_media_file();
            let first = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .unwrap();
            let second = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                .await
                .unwrap();
            let playback_session_id = Uuid::new_v4();

            orchestrator
                .associate_playback_session(playback_session_id, first.id)
                .await
                .unwrap();
            orchestrator
                .associate_playback_session(playback_session_id, second.id)
                .await
                .unwrap();

            assert_eq!(orchestrator.lookup_session(first.id).await.unwrap(), None);
            assert!(orchestrator
                .lookup_session(second.id)
                .await
                .unwrap()
                .is_some());
            assert_eq!(counter.get(), 1);
        }

        #[tokio::test]
        async fn session_passively_expires_once_its_ttl_elapses() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let orchestrator = TranscodeOrchestrator::new(
                repo,
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(unique_tmp_dir())
            .with_session_ttl(Duration::from_millis(20));

            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "node-a")
                .await
                .unwrap();

            tokio::time::sleep(Duration::from_millis(150)).await;

            let found = orchestrator.lookup_session(session.id).await.unwrap();
            assert_eq!(found, None);
        }

        /// The bug this guards against: a real on-demand session (a movie
        /// actually being watched) outlives a single `session_ttl` window
        /// because every real request re-touches it -- `session_ttl` is an
        /// *idle* deadline, not a hard cap on total session lifetime (see
        /// `TranscodeSession::expires_at`'s doc comment). Confirmed live
        /// before this fix: a real playback session played its first few
        /// segments fine, then 404'd mid-playback the moment the fixed 60s
        /// window from creation elapsed, regardless of how continuously it
        /// was being watched.
        #[tokio::test]
        async fn repeated_lookups_keep_an_actively_watched_session_alive_past_its_ttl() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let orchestrator = TranscodeOrchestrator::new(
                repo,
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(unique_tmp_dir())
            .with_session_ttl(Duration::from_millis(80));

            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "node-a")
                .await
                .unwrap();

            // Simulate a player polling the manifest/segments well past what
            // a single `session_ttl` window would allow if nothing refreshed
            // it -- 6 rounds x 40ms = 240ms, versus an 80ms TTL.
            for _ in 0..6 {
                tokio::time::sleep(Duration::from_millis(40)).await;
                let found = orchestrator
                    .lookup_session(session.id)
                    .await
                    .unwrap()
                    .expect("an actively-polled session must not expire between accesses");
                assert_eq!(found.id, session.id);
            }

            // Once real access actually stops, the session still expires
            // (this is deliberately idle cleanup, not immortality) --
            // roughly `session_ttl` after the last real lookup above.
            tokio::time::sleep(Duration::from_millis(150)).await;
            let found = orchestrator.lookup_session(session.id).await.unwrap();
            assert_eq!(found, None);
        }

        #[tokio::test]
        async fn no_capacity_error_once_max_concurrent_sessions_reached() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let orchestrator = TranscodeOrchestrator::new(
                repo,
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(unique_tmp_dir())
            .with_max_concurrent_sessions(1);

            let media_file = sample_media_file();
            orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .expect("first session should have capacity");

            let second = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                .await;

            assert!(matches!(second, Err(TranscodeError::NoCapacity)));
        }

        #[tokio::test]
        async fn find_existing_rendition_delegates_to_the_repo() {
            let media_file_id = Uuid::new_v4();
            let repo = Arc::new(FakeRenditionRepo::with_ready(
                media_file_id,
                "h264-720p-4mbps",
            ));
            let orchestrator = test_orchestrator(repo);

            let found = orchestrator
                .find_existing_rendition(media_file_id, "h264-720p-4mbps")
                .await
                .unwrap();
            assert!(found.is_some());

            let missing = orchestrator
                .find_existing_rendition(media_file_id, "some-other-profile")
                .await
                .unwrap();
            assert!(missing.is_none());
        }
    }

    // ---- TdarrDispatcher -----------------------------------------------

    mod tdarr_dispatcher {
        use super::*;
        use wiremock::matchers::{body_json, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        fn test_config() -> TdarrDispatcherConfig {
            TdarrDispatcherConfig {
                tdarr_db_id: "db-1".to_string(),
                default_profile: "h264-720p-4mbps".to_string(),
                worker_process: "transcodecpu".to_string(),
                default_worker_limit: 2,
                throttled_worker_limit: 0,
                active_session_threshold: 2,
                throttle_check_interval: Duration::from_millis(50),
            }
        }

        #[tokio::test]
        async fn dispatch_skips_tdarr_when_ready_rendition_already_exists() {
            // No mocks mounted: if `dispatch_one` calls Tdarr at all, the
            // request 404s and `dispatch_one` returns an `Err`, failing the
            // `.unwrap()` below — proving the ready-rendition guard
            // short-circuits before any HTTP call.
            let mock_server = MockServer::start().await;

            let media_file = sample_media_file();
            let repo = Arc::new(FakeRenditionRepo::with_ready(
                media_file.id,
                "h264-720p-4mbps",
            ));
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");
            let (_tx, events_rx) = mpsc::channel(1);

            let dispatcher = TdarrDispatcher::new(
                tdarr,
                repo,
                ActiveSessionCounter::new(),
                events_rx,
                test_config(),
            );

            dispatcher.dispatch_one(&media_file).await.unwrap();
        }

        #[tokio::test]
        async fn dispatch_calls_scan_individual_file_when_no_ready_rendition() {
            let mock_server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v2/scan-individual-file"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({ "status": "queued" })),
                )
                .expect(1)
                .mount(&mock_server)
                .await;

            let media_file = sample_media_file();
            let repo = Arc::new(FakeRenditionRepo::default());
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");
            let (_tx, events_rx) = mpsc::channel(1);

            let dispatcher = TdarrDispatcher::new(
                tdarr,
                repo,
                ActiveSessionCounter::new(),
                events_rx,
                test_config(),
            );

            dispatcher.dispatch_one(&media_file).await.unwrap();

            mock_server.verify().await;
        }

        #[tokio::test]
        async fn throttle_lowers_worker_limit_once_session_count_hits_threshold() {
            let mock_server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v2/get-nodes"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                    { "nodeID": "node-1", "nodeName": "worker-1", "workers": {} }
                ])))
                .mount(&mock_server)
                .await;

            Mock::given(method("POST"))
                .and(path("/api/v2/alter-worker-limit"))
                .and(body_json(serde_json::json!({
                    "nodeID": "node-1",
                    "process": "transcodecpu",
                    "worker_limit": 0
                })))
                .respond_with(ResponseTemplate::new(200))
                .expect(1)
                .mount(&mock_server)
                .await;

            let repo = Arc::new(FakeRenditionRepo::default());
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");
            let counter = ActiveSessionCounter::new();
            counter.increment();
            counter.increment();
            let (_tx, events_rx) = mpsc::channel(1);

            let dispatcher = TdarrDispatcher::new(tdarr, repo, counter, events_rx, test_config());

            dispatcher.check_and_apply_throttle().await.unwrap();

            mock_server.verify().await;
        }

        #[tokio::test]
        async fn throttle_keeps_default_worker_limit_below_threshold() {
            let mock_server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v2/get-nodes"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                    { "nodeID": "node-1", "nodeName": "worker-1", "workers": {} }
                ])))
                .mount(&mock_server)
                .await;

            Mock::given(method("POST"))
                .and(path("/api/v2/alter-worker-limit"))
                .and(body_json(serde_json::json!({
                    "nodeID": "node-1",
                    "process": "transcodecpu",
                    "worker_limit": 2
                })))
                .respond_with(ResponseTemplate::new(200))
                .expect(1)
                .mount(&mock_server)
                .await;

            let repo = Arc::new(FakeRenditionRepo::default());
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");
            // Below `active_session_threshold` (2) from `test_config`.
            let counter = ActiveSessionCounter::new();
            counter.increment();
            let (_tx, events_rx) = mpsc::channel(1);

            let dispatcher = TdarrDispatcher::new(tdarr, repo, counter, events_rx, test_config());

            dispatcher.check_and_apply_throttle().await.unwrap();

            mock_server.verify().await;
        }

        #[tokio::test]
        async fn run_dispatches_incoming_events_then_exits_when_channel_closes() {
            let mock_server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v2/scan-individual-file"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({ "status": "queued" })),
                )
                .expect(1)
                .mount(&mock_server)
                .await;

            let media_file = sample_media_file();
            let repo = Arc::new(FakeRenditionRepo::default());
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");

            let mut config = test_config();
            // Long enough that the throttle branch never fires during this
            // test — it's exercised separately above.
            config.throttle_check_interval = Duration::from_secs(3600);

            let (tx, events_rx) = mpsc::channel(1);
            let dispatcher =
                TdarrDispatcher::new(tdarr, repo, ActiveSessionCounter::new(), events_rx, config);

            let handle = tokio::spawn(dispatcher.run());

            tx.send(MediaFileImportEvent {
                media_file: media_file.clone(),
            })
            .await
            .unwrap();
            drop(tx);

            let result = tokio::time::timeout(Duration::from_secs(5), handle).await;
            assert!(
                result.is_ok(),
                "dispatcher.run() should exit once the event channel closes"
            );
            assert!(result.unwrap().unwrap().is_ok());

            mock_server.verify().await;
        }
    }
}
