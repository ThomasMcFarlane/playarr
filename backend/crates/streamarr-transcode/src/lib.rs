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

use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use streamarr_db::RenditionRepo;
use streamarr_model::{MediaFile, Rendition};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum TranscodeError {
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
    #[error("no on-demand transcode capacity available on this node")]
    NoCapacity,
    #[error("tdarr client error: {0}")]
    Tdarr(#[from] streamarr_tdarr_client::TdarrClientError),
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

/// Decides, per playback request, whether the source file can be served
/// as-is, whether an existing rendition covers it, or whether a new
/// on-demand transcode needs to be started — and owns starting that
/// transcode when it does.
pub struct TranscodeOrchestrator {
    rendition_repo: Arc<dyn RenditionRepo>,
}

impl TranscodeOrchestrator {
    pub fn new(rendition_repo: Arc<dyn RenditionRepo>) -> Self {
        Self { rendition_repo }
    }

    /// Step 1: compares `media_file`'s container/codecs/bitrate against
    /// `capabilities`. A pure function (no I/O) so it can be called
    /// synchronously on the playback request's hot path.
    pub fn can_direct_play(
        &self,
        media_file: &MediaFile,
        capabilities: &ClientCapabilities,
    ) -> bool {
        let _ = (media_file, capabilities);
        unimplemented!("TranscodeOrchestrator::can_direct_play")
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
        let _ = (&self.rendition_repo, media_file_id, profile);
        unimplemented!("TranscodeOrchestrator::find_existing_rendition")
    }

    /// Step 3, last resort: starts a new [`TranscodeSession`] on
    /// `owning_node_id`. Returns once the process has started and (in a
    /// real implementation) the first output segment is ready to serve —
    /// not once the whole transcode completes. Errors with
    /// `TranscodeError::NoCapacity` when this node has no spare on-demand
    /// worker slot (policy for what happens next — queue, reject, route to
    /// another node — is the caller's, informed by
    /// `streamarr_model::Policy::can_transcode` and node load).
    pub async fn spawn_on_demand_transcode(
        &self,
        media_file_id: Uuid,
        profile: &str,
        owning_node_id: &str,
    ) -> Result<TranscodeSession, TranscodeError> {
        let _ = (&self.rendition_repo, media_file_id, profile, owning_node_id);
        unimplemented!("TranscodeOrchestrator::spawn_on_demand_transcode")
    }
}

/// The background path: proactively drives Tdarr to produce
/// [`Rendition`]s ahead of playback, so `TranscodeOrchestrator::find_existing_rendition`
/// has something to find instead of every session falling through to
/// on-demand. Runs as its own worker loop (role = `Worker`/`All`), separate
/// from the request-scoped `TranscodeOrchestrator`.
pub struct TdarrDispatcher {
    tdarr: streamarr_tdarr_client::TdarrClient,
    rendition_repo: Arc<dyn RenditionRepo>,
}

impl TdarrDispatcher {
    pub fn new(
        tdarr: streamarr_tdarr_client::TdarrClient,
        rendition_repo: Arc<dyn RenditionRepo>,
    ) -> Self {
        Self {
            tdarr,
            rendition_repo,
        }
    }

    /// Runs until cancelled: on an interval, checks Tdarr node/worker
    /// capacity (`TdarrClient::get_nodes`) and dispatches newly-imported
    /// `MediaFile`s that lack a `Ready` rendition for the configured
    /// default profile(s) via `TdarrClient::scan_individual_file`.
    pub async fn run(self) -> Result<(), TranscodeError> {
        let _ = (&self.tdarr, &self.rendition_repo);
        unimplemented!("TdarrDispatcher::run")
    }

    async fn dispatch_one(&self, media_file_id: Uuid) -> Result<(), TranscodeError> {
        let _ = (&self.tdarr, &self.rendition_repo, media_file_id);
        unimplemented!("TdarrDispatcher::dispatch_one")
    }
}
