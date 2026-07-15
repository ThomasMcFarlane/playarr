//! `streamarr-transcode` — playback-time transcode decision-making
//! ([`TranscodeOrchestrator`]) and the background Tdarr dispatch path
//! ([`TdarrDispatcher`]).
//!
//! The orchestrator's three methods are meant to be tried in order, each
//! only reached if the previous one didn't resolve the request:
//! 1. [`TranscodeOrchestrator::can_direct_play`] — can the source
//!    `MediaFile` be served byte-for-byte? Cheapest, most common case.
//! 2. [`TranscodeOrchestrator::find_existing_rendition`] — is there
//!    already a ready [`streamarr_model::Rendition`], produced either by
//!    the background Tdarr pipeline or a previous on-demand session?
//! 3. [`TranscodeOrchestrator::spawn_on_demand_transcode`] — last resort:
//!    start a new transcode just for this session.
//!
//! [`TranscodeSession`] state (create/lookup/expire) is kept in whatever
//! [`streamarr_cache::CacheAndPubSub`] implementation the deployment is
//! wired with, rather than in `streamarr-db` — sessions are ephemeral,
//! TTL'd, node-scoped process state, not durable rows.
//!
//! [`ActiveSessionCounter`] is a small in-process bridge between the two
//! halves of this crate: `TranscodeOrchestrator` increments/decrements it
//! as on-demand sessions come and go, and `TdarrDispatcher` reads it to
//! decide whether to throttle Tdarr's background workers. It deliberately
//! isn't derived by scanning the cache — [`streamarr_cache::CacheAndPubSub`]
//! is a plain get/set/delete/pub-sub trait with no listing/count
//! primitive (see that crate's docs), and a hot per-session-lifecycle
//! counter belongs in-process rather than round-tripping a KV store on
//! every increment/decrement.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use streamarr_cache::CacheAndPubSub;
use streamarr_db::RenditionRepo;
use streamarr_model::{MediaFile, Rendition};
use streamarr_tdarr_client::{AlterWorkerLimitRequest, ScanIndividualFileRequest, TdarrClient};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum TranscodeError {
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
    #[error("no on-demand transcode capacity available on this node")]
    NoCapacity,
    #[error("tdarr client error: {0}")]
    Tdarr(#[from] streamarr_tdarr_client::TdarrClientError),
    #[error("cache error: {0}")]
    Cache(#[from] streamarr_cache::CacheError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("failed to (de)serialize transcode session: {0}")]
    Serialize(#[from] serde_json::Error),
}

/// What a requesting client can play natively — the input to
/// [`TranscodeOrchestrator::can_direct_play`]. Built by `streamarr-api`'s
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
/// [`streamarr_model::Rendition`] — a `Rendition` is a durable, complete
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
/// `streamarr-config`/`streamarr-model` rather than baked into this crate;
/// tracked as follow-up, not blocking, since `spawn_on_demand_transcode`
/// needs *some* concrete mapping to build a correct ffmpeg command today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscodeTargetProfile {
    pub name: String,
    /// ffmpeg `-c:v` value, e.g. `"libx264"`.
    pub video_codec: String,
    /// ffmpeg `-c:a` value, e.g. `"aac"`.
    pub audio_codec: String,
    pub video_bitrate_kbps: Option<u32>,
    pub audio_bitrate_kbps: Option<u32>,
}

impl TranscodeTargetProfile {
    /// Resolves a named profile to concrete ffmpeg settings, falling back
    /// to a conservative default (H.264/AAC, 4Mbps video) for any name
    /// this crate doesn't recognize, rather than failing outright — an
    /// unrecognized profile name is still a request that should degrade to
    /// *something* playable rather than erroring the whole playback
    /// attempt.
    pub fn resolve(profile: &str) -> Self {
        match profile {
            "h264-1080p-8mbps" => Self {
                name: profile.to_string(),
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
                video_bitrate_kbps: Some(8000),
                audio_bitrate_kbps: Some(192),
            },
            "h264-720p-4mbps" => Self {
                name: profile.to_string(),
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
                video_bitrate_kbps: Some(4000),
                audio_bitrate_kbps: Some(128),
            },
            "h264-480p-2mbps" => Self {
                name: profile.to_string(),
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
                video_bitrate_kbps: Some(2000),
                audio_bitrate_kbps: Some(96),
            },
            other => Self {
                name: other.to_string(),
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
                video_bitrate_kbps: Some(4000),
                audio_bitrate_kbps: Some(128),
            },
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
    let mut args = vec![
        // Overwrite without prompting — the per-session output directory
        // is freshly created, but ffmpeg still probes for an existing
        // playlist file otherwise and this keeps it non-interactive.
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().into_owned(),
        "-c:v".to_string(),
        profile.video_codec.clone(),
    ];

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
    args.push(output_dir.join("playlist.m3u8").to_string_lossy().into_owned());

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

/// Decides, per playback request, whether the source file can be served
/// as-is, whether an existing rendition covers it, or whether a new
/// on-demand transcode needs to be started — and owns starting that
/// transcode when it does.
pub struct TranscodeOrchestrator {
    rendition_repo: Arc<dyn RenditionRepo>,
    /// Backs [`TranscodeSession`] lifecycle (create/lookup/expire) — see
    /// the module docs for why sessions live here rather than in
    /// `streamarr-db`.
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
    active_children: Mutex<HashMap<Uuid, Child>>,
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
            output_root: std::env::temp_dir().join("streamarr-transcode"),
            session_ttl: Duration::from_secs(60),
            max_concurrent_sessions: None,
            active_children: Mutex::new(HashMap::new()),
        }
    }

    pub fn with_ffmpeg_binary(mut self, ffmpeg_binary: impl Into<String>) -> Self {
        self.ffmpeg_binary = ffmpeg_binary.into();
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
    /// `streamarr_model::MediaFile` with an audio-codec field, which is
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

        let video_codec_ok = capabilities
            .supported_video_codecs
            .iter()
            .any(|c| c.eq_ignore_ascii_case(&media_file.codec));

        // An unknown source bitrate (the source *arr instance didn't
        // report one) or an uncapped client can't fail this check — only
        // a known bitrate that's known to exceed a known cap blocks
        // direct play.
        let bitrate_ok = match (media_file.bitrate, capabilities.max_bitrate_bps) {
            (Some(file_bitrate), Some(max_bitrate)) => file_bitrate <= max_bitrate,
            _ => true,
        };

        container_ok && video_codec_ok && bitrate_ok
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
    /// `streamarr_model::Policy::can_transcode` and node load).
    pub async fn spawn_on_demand_transcode(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
    ) -> Result<TranscodeSession, TranscodeError> {
        if let Some(max) = self.max_concurrent_sessions {
            let active = self.active_children.lock().await.len();
            if active >= max {
                return Err(TranscodeError::NoCapacity);
            }
        }

        let target_profile = TranscodeTargetProfile::resolve(profile);
        let session_id = Uuid::new_v4();
        let output_dir = self.output_root.join(session_id.to_string());
        tokio::fs::create_dir_all(&output_dir).await?;

        let args = build_ffmpeg_hls_args(&media_file.path, &target_profile, &output_dir);

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
            let mut child = child;
            let _ = child.kill().await;
            return Err(err);
        }

        self.active_children.lock().await.insert(session.id, child);
        self.active_sessions.increment();

        Ok(session)
    }

    /// Looks up a [`TranscodeSession`] by id, regardless of which node
    /// owns it — the cache entry is visible cluster-wide even though only
    /// the owning node has the actual ffmpeg process.
    pub async fn lookup_session(
        &self,
        session_id: Uuid,
    ) -> Result<Option<TranscodeSession>, TranscodeError> {
        match self.cache.get(&Self::session_cache_key(session_id)).await? {
            Some(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            None => Ok(None),
        }
    }

    /// Ends a [`TranscodeSession`]: removes it from the cache (so no
    /// further lookups find it) and, if this node owns the underlying
    /// process, kills it and releases its capacity slot.
    pub async fn expire_session(&self, session_id: Uuid) -> Result<(), TranscodeError> {
        self.cache
            .delete(&Self::session_cache_key(session_id))
            .await?;

        if let Some(mut child) = self.active_children.lock().await.remove(&session_id) {
            // The process may have already exited on its own (transcode
            // finished, or crashed) — `kill` erroring in that case is
            // expected, not a failure of expiry itself.
            let _ = child.kill().await;
            self.active_sessions.decrement();
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
/// `scan_individual_file`. There is no `MediaFileRepo` in `streamarr-db`
/// yet for `TdarrDispatcher` to poll on its own, so dispatch is entirely
/// event-driven: whatever owns the import/upgrade event (an *arr webhook
/// handler, `streamarr-arr-sync`'s reconciliation poller, etc. — outside
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
    /// into. Streamarr currently assumes one Tdarr library per
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
    use streamarr_cache::InMemory;
    use streamarr_model::media::LeafRef;
    use streamarr_model::{ProducedBy, RenditionStatus};

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
        async fn get(&self, id: Uuid) -> Result<Rendition, streamarr_db::DbError> {
            self.renditions
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or(streamarr_db::DbError::NotFound)
        }

        async fn list_for_media_file(
            &self,
            media_file_id: Uuid,
        ) -> Result<Vec<Rendition>, streamarr_db::DbError> {
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
        ) -> Result<Option<Rendition>, streamarr_db::DbError> {
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

        async fn upsert(&self, rendition: &Rendition) -> Result<(), streamarr_db::DbError> {
            self.renditions
                .lock()
                .unwrap()
                .insert(rendition.id, rendition.clone());
            Ok(())
        }

        async fn delete(&self, id: Uuid) -> Result<(), streamarr_db::DbError> {
            self.renditions.lock().unwrap().remove(&id);
            Ok(())
        }

        async fn mark_status(
            &self,
            id: Uuid,
            status: RenditionStatus,
        ) -> Result<(), streamarr_db::DbError> {
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
        std::env::temp_dir().join(format!("streamarr-transcode-test-{}", Uuid::new_v4()))
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
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
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
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
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
        fn resolve_known_profile_maps_expected_codecs_and_bitrate() {
            let profile = TranscodeTargetProfile::resolve("h264-1080p-8mbps");
            assert_eq!(profile.video_codec, "libx264");
            assert_eq!(profile.audio_codec, "aac");
            assert_eq!(profile.video_bitrate_kbps, Some(8000));
            assert_eq!(profile.audio_bitrate_kbps, Some(192));
        }

        #[test]
        fn resolve_unknown_profile_falls_back_to_a_sane_default() {
            let profile = TranscodeTargetProfile::resolve("totally-unrecognized-profile");
            assert_eq!(profile.video_codec, "libx264");
            assert_eq!(profile.audio_codec, "aac");
            assert!(profile.video_bitrate_kbps.is_some());
        }
    }

    // ---- TranscodeSession lifecycle -----------------------------------

    mod session_lifecycle {
        use super::*;

        #[tokio::test]
        async fn spawn_creates_a_lookupable_session_and_expire_removes_it() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let counter = ActiveSessionCounter::new();
            let orchestrator = TranscodeOrchestrator::new(
                repo,
                Arc::new(InMemory::new()),
                counter.clone(),
            )
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

            let found = orchestrator
                .lookup_session(session.id)
                .await
                .expect("lookup should not error");
            assert_eq!(found, Some(session.clone()));

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
                orchestrator
                    .lookup_session(Uuid::new_v4())
                    .await
                    .unwrap(),
                None
            );
        }

        #[tokio::test]
        async fn expiring_an_unknown_session_is_not_an_error() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            orchestrator.expire_session(Uuid::new_v4()).await.unwrap();
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

            let dispatcher =
                TdarrDispatcher::new(tdarr, repo, counter, events_rx, test_config());

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

            let dispatcher =
                TdarrDispatcher::new(tdarr, repo, counter, events_rx, test_config());

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
            let dispatcher = TdarrDispatcher::new(
                tdarr,
                repo,
                ActiveSessionCounter::new(),
                events_rx,
                config,
            );

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
