//! Admin playback-activity diagnostics. The original local-only session
//! routes remain available for backwards compatibility; the
//! `/api/v1/admin/playback/activity/*` endpoints merge this node with every
//! reachable member of its peer group through signed peer-local endpoints.

use std::{collections::BTreeMap, time::Duration};

use axum::extract::{Path, Query, State};
use axum::Json;
use base64::Engine;
use chrono::{DateTime, SubsecRound, Utc};
use futures::future::join_all;
use playarr_catalog::{WorkChildren, WorkDetail};
use playarr_db::analytics::{SessionFilter, SessionStopReasonFilter};
use playarr_model::media::LeafRef;
use playarr_model::{
    ClientPlatform, PeerNode, PeerNodeStatus, PlayMethod, PlaybackSession, StopReason,
    TranscodeReason,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::admin_peer::{ensure_node_identity, own_peer_identity};
use crate::auth_extractor::AdminUser;
use crate::error::ApiError;
use crate::peer_extractor::PeerSignedRequest;
use crate::AppState;

const MAX_HISTORY_LIMIT: i64 = 500;
const HISTORY_SCAN_BATCH_SIZE: i64 = 256;
const PEER_ACTIVITY_TIMEOUT: Duration = Duration::from_secs(3);
const HISTORY_CURSOR_VERSION: u8 = 1;

/// One live session, enriched with the labels and route target used by the
/// administrator Activity and Tasks pages.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ActiveSessionView {
    pub session_id: Uuid,
    pub user_id: Uuid,
    /// Best-effort `UserRepo` lookup; `None` on a lookup miss/failure,
    /// never surfaced as an error -- a live-sessions view degrading to
    /// showing a bare id for one row is far better than failing the whole
    /// list over one bad lookup.
    pub user_display_name: Option<String>,
    pub device_id: Uuid,
    pub media_file_id: Uuid,
    /// Best-effort media-file lookup; provides the route target for the
    /// linked item title in Playarr Server Admin.
    pub work_id: Option<Uuid>,
    /// Best-effort `CatalogService` lookup. For child media, this names the
    /// actual episode, track, or book rather than only its parent work.
    pub media_title: Option<String>,
    pub peer_node_id: Uuid,
    pub peer_node_name: String,
    pub peer_node_is_self: bool,
    pub source_instance_id: Option<Uuid>,
    pub source_instance_name: Option<String>,
    /// Group-wide library id when the source is mapped to one; otherwise the
    /// node-local source-instance id is the effective standalone library id.
    pub library_id: Option<Uuid>,
    pub library_name: Option<String>,
    pub duration_ms: u64,
    pub play_method: PlayMethod,
    pub target_codec: String,
    pub target_container: String,
    pub client_platform: ClientPlatform,
    pub client_version: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub bytes_streamed: u64,
    pub buffering_events: u32,
    pub buffering_ms_total: u64,
}

/// Historical playback-session fields plus the same best-effort linked
/// user/media context as [`ActiveSessionView`]. The original raw-session
/// fields stay intact so enriching the endpoint remains backwards compatible.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SessionHistoryView {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_display_name: Option<String>,
    pub device_id: Uuid,
    pub media_file_id: Uuid,
    pub work_id: Option<Uuid>,
    pub media_title: Option<String>,
    pub peer_node_id: Uuid,
    pub peer_node_name: String,
    pub peer_node_is_self: bool,
    pub source_instance_id: Option<Uuid>,
    pub source_instance_name: Option<String>,
    pub library_id: Option<Uuid>,
    pub library_name: Option<String>,
    pub duration_ms: u64,
    pub rendition_id: Option<Uuid>,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
    pub play_method: PlayMethod,
    pub transcode_reason: Option<TranscodeReason>,
    pub source_codec: String,
    pub source_container: String,
    pub source_bitrate: Option<u64>,
    pub target_codec: String,
    pub target_container: String,
    pub target_bitrate: Option<u64>,
    pub client_platform: ClientPlatform,
    pub client_version: String,
    pub ip_address: Option<String>,
    pub bytes_streamed: u64,
    pub buffering_events: u32,
    pub buffering_ms_total: u64,
    pub stop_reason: Option<StopReason>,
}

struct SessionContext {
    user_display_name: Option<String>,
    work_id: Option<Uuid>,
    media_title: Option<String>,
    source_instance_id: Option<Uuid>,
    source_instance_name: Option<String>,
    library_id: Option<Uuid>,
    library_name: Option<String>,
}

#[derive(Debug, Clone)]
struct ActivityNode {
    id: Uuid,
    name: String,
    is_self: bool,
    group_id: Option<Uuid>,
}

/// A peer that could not contribute to a group-wide activity response.
/// Failures are row-level metadata rather than whole-request errors so an
/// administrator can still inspect every reachable node.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct UnavailableNodeView {
    pub peer_node_id: Uuid,
    pub peer_node_name: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaybackActivityActiveResponse {
    pub sessions: Vec<ActiveSessionView>,
    pub unavailable_nodes: Vec<UnavailableNodeView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaybackActivityHistoryResponse {
    pub sessions: Vec<SessionHistoryView>,
    pub unavailable_nodes: Vec<UnavailableNodeView>,
    pub has_more: bool,
    /// Opaque keyset continuation. Send this with the same filters to request
    /// the next page. `None` means the result has been exhausted.
    pub next_cursor: Option<String>,
    /// Stable inclusive upper bound applied to every node for this cursor
    /// sequence. This remains exposed for result labelling and compatibility;
    /// callers should continue with `next_cursor`, not an offset.
    pub snapshot_to: DateTime<Utc>,
}

/// One complete effective-library choice for the Activity filter. Grouped
/// sources collapse onto their portable group-library id; an ungrouped source
/// keeps its own source-instance id so standalone activity remains filterable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PlaybackActivityLibraryFacet {
    pub id: Uuid,
    pub name: String,
}

/// Filter choices whose completeness must not depend on the current Activity
/// result page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PlaybackActivityFacetsResponse {
    pub libraries: Vec<PlaybackActivityLibraryFacet>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackActivityStopReason {
    Completed,
    UserStopped,
    Error,
    DeviceDisconnected,
    SessionRevoked,
    ConcurrentLimitExceeded,
    IdleTimeout,
    Other,
    InProgress,
}

impl From<PlaybackActivityStopReason> for SessionStopReasonFilter {
    fn from(reason: PlaybackActivityStopReason) -> Self {
        match reason {
            PlaybackActivityStopReason::Completed => Self::Completed,
            PlaybackActivityStopReason::UserStopped => Self::UserStopped,
            PlaybackActivityStopReason::Error => Self::Error,
            PlaybackActivityStopReason::DeviceDisconnected => Self::DeviceDisconnected,
            PlaybackActivityStopReason::SessionRevoked => Self::SessionRevoked,
            PlaybackActivityStopReason::ConcurrentLimitExceeded => Self::ConcurrentLimitExceeded,
            PlaybackActivityStopReason::IdleTimeout => Self::IdleTimeout,
            PlaybackActivityStopReason::Other => Self::Other,
            PlaybackActivityStopReason::InProgress => Self::InProgress,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct PlaybackActivityHistoryRequest {
    #[schema(required = false)]
    pub user_ids: Vec<Uuid>,
    #[schema(required = false)]
    pub play_methods: Vec<PlayMethod>,
    #[schema(required = false)]
    pub title_terms: Vec<String>,
    #[schema(required = false)]
    pub library_ids: Vec<Uuid>,
    #[schema(required = false)]
    pub peer_node_ids: Vec<Uuid>,
    #[schema(required = false)]
    pub stop_reasons: Vec<PlaybackActivityStopReason>,
    #[schema(required = false)]
    pub from: Option<DateTime<Utc>>,
    #[schema(required = false)]
    pub to: Option<DateTime<Utc>>,
    #[schema(required = false)]
    pub min_duration_ms: Option<i64>,
    #[schema(required = false)]
    pub max_duration_ms: Option<i64>,
    #[schema(required = false)]
    pub min_bytes_streamed: Option<i64>,
    #[schema(required = false)]
    pub max_bytes_streamed: Option<i64>,
    #[schema(required = false)]
    pub limit: i64,
    /// Opaque continuation returned as `next_cursor` by the previous page.
    /// Leave unset for the first page.
    #[schema(required = false)]
    pub cursor: Option<String>,
    /// Legacy first-page compatibility field. Only zero is accepted; use
    /// `cursor` for continuation.
    #[schema(required = false)]
    pub offset: i64,
}

impl Default for PlaybackActivityHistoryRequest {
    fn default() -> Self {
        Self {
            user_ids: Vec::new(),
            play_methods: Vec::new(),
            title_terms: Vec::new(),
            library_ids: Vec::new(),
            peer_node_ids: Vec::new(),
            stop_reasons: Vec::new(),
            from: None,
            to: None,
            min_duration_ms: None,
            max_duration_ms: None,
            min_bytes_streamed: None,
            max_bytes_streamed: None,
            limit: default_limit(),
            cursor: None,
            offset: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ActivityHistoryKey {
    started_at: DateTime<Utc>,
    peer_node_id: Uuid,
    session_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ActivityHistoryCursor {
    version: u8,
    snapshot_to: DateTime<Utc>,
    filter_fingerprint: String,
    membership_fingerprint: String,
    contributor_fingerprint: String,
    after: ActivityHistoryKey,
}

#[derive(Debug, Clone)]
struct ValidatedHistoryRequest {
    request: PlaybackActivityHistoryRequest,
    cursor: Option<ActivityHistoryCursor>,
    filter_fingerprint: String,
}

fn media_title(detail: &WorkDetail, leaf_ref: LeafRef) -> String {
    let child_title = match (&detail.children, leaf_ref) {
        (WorkChildren::Series(seasons), LeafRef::Episode(episode_id)) => seasons
            .iter()
            .flat_map(|season| season.episodes.iter().map(move |episode| (season, episode)))
            .find(|(_, episode)| episode.episode.id == episode_id)
            .map(|(season, episode)| {
                episode.episode.title.clone().unwrap_or_else(|| {
                    format!(
                        "S{:02}E{:02}",
                        season.season.season_number, episode.episode.episode_number
                    )
                })
            }),
        (WorkChildren::Artist(albums), LeafRef::Track(track_id)) => albums
            .iter()
            .flat_map(|album| &album.tracks)
            .find(|track| track.track.id == track_id)
            .map(|track| track.track.title.clone()),
        (WorkChildren::Author(books), LeafRef::Book(book_id)) => books
            .iter()
            .find(|book| book.book.id == book_id)
            .map(|book| book.book.title.clone()),
        _ => None,
    };

    match child_title {
        Some(title) => format!("{} — {title}", detail.work.title),
        None => detail.work.title.clone(),
    }
}

async fn session_context(state: &AppState, session: &PlaybackSession) -> SessionContext {
    let user_display_name = match state.user_repo.find_by_id(session.user_id).await {
        Ok(Some(user)) => Some(user.display_name),
        Ok(None) => None,
        Err(err) => {
            tracing::warn!(
                user_id = %session.user_id,
                error = %err,
                "admin playback activity: user lookup failed; leaving display name unset"
            );
            None
        }
    };

    let Some(media_file) = state.media_files.get(session.media_file_id).await else {
        return SessionContext {
            user_display_name,
            work_id: None,
            media_title: None,
            source_instance_id: None,
            source_instance_name: None,
            library_id: None,
            library_name: None,
        };
    };

    let work_id = Some(media_file.work_id);
    let media_title = match state.catalog.get_by_id(media_file.work_id, None).await {
        // `None` (unrestricted): this whole surface is admin-only diagnostics
        // ("every session, every user" per the module doc comment) -- a
        // per-viewer `library_allow` restriction doesn't apply to an admin's
        // global activity view.
        Ok(detail) => Some(media_title(&detail, media_file.leaf_ref)),
        Err(err) => {
            tracing::warn!(
                media_file_id = %session.media_file_id,
                work_id = %media_file.work_id,
                error = %err,
                "admin playback activity: work lookup failed; leaving media title unset"
            );
            None
        }
    };

    let source_instance = match state.source_instances.get(media_file.source_instance_id) {
        Some(source) => Some(source),
        None => match state
            .source_instance_repo
            .get(media_file.source_instance_id)
            .await
        {
            Ok(source) => source,
            Err(err) => {
                tracing::warn!(
                    source_instance_id = %media_file.source_instance_id,
                    error = %err,
                    "admin playback activity: durable source lookup failed; preserving raw source id"
                );
                None
            }
        },
    };
    let source_instance_id = Some(media_file.source_instance_id);
    let source_instance_name = source_instance.as_ref().map(|source| source.name.clone());
    let (library_id, library_name) = match source_instance {
        Some(source) => match source.group_library_id {
            Some(group_library_id) => match state.group_library_repo.get(group_library_id).await {
                Ok(Some(library)) => (Some(library.id), Some(library.name)),
                Ok(None) => (Some(group_library_id), Some(source.name)),
                Err(err) => {
                    tracing::warn!(
                        %group_library_id,
                        error = %err,
                        "admin playback activity: group-library lookup failed; preserving portable id"
                    );
                    (Some(group_library_id), Some(source.name))
                }
            },
            None => (Some(source.id), Some(source.name)),
        },
        None => (Some(media_file.source_instance_id), None),
    };

    SessionContext {
        user_display_name,
        work_id,
        media_title,
        source_instance_id,
        source_instance_name,
        library_id,
        library_name,
    }
}

fn duration_ms(
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    effective_now: DateTime<Utc>,
) -> u64 {
    ended_at
        .unwrap_or(effective_now)
        .signed_duration_since(started_at)
        .num_milliseconds()
        .max(0) as u64
}

async fn enrich_active(
    state: &AppState,
    session: PlaybackSession,
    node: &ActivityNode,
    effective_now: DateTime<Utc>,
) -> ActiveSessionView {
    let context = session_context(state, &session).await;
    ActiveSessionView {
        session_id: session.id,
        user_id: session.user_id,
        user_display_name: context.user_display_name,
        device_id: session.device_id,
        media_file_id: session.media_file_id,
        work_id: context.work_id,
        media_title: context.media_title,
        peer_node_id: node.id,
        peer_node_name: node.name.clone(),
        peer_node_is_self: node.is_self,
        source_instance_id: context.source_instance_id,
        source_instance_name: context.source_instance_name,
        library_id: context.library_id,
        library_name: context.library_name,
        duration_ms: duration_ms(session.started_at, session.ended_at, effective_now),
        play_method: session.play_method,
        target_codec: session.target_codec,
        target_container: session.target_container,
        client_platform: session.client_platform,
        client_version: session.client_version,
        started_at: session.started_at,
        bytes_streamed: session.bytes_streamed,
        buffering_events: session.buffering_events,
        buffering_ms_total: session.buffering_ms_total,
    }
}

async fn enrich_history(
    state: &AppState,
    session: PlaybackSession,
    node: &ActivityNode,
    effective_now: DateTime<Utc>,
) -> SessionHistoryView {
    let context = session_context(state, &session).await;
    SessionHistoryView {
        id: session.id,
        user_id: session.user_id,
        user_display_name: context.user_display_name,
        device_id: session.device_id,
        media_file_id: session.media_file_id,
        work_id: context.work_id,
        media_title: context.media_title,
        peer_node_id: node.id,
        peer_node_name: node.name.clone(),
        peer_node_is_self: node.is_self,
        source_instance_id: context.source_instance_id,
        source_instance_name: context.source_instance_name,
        library_id: context.library_id,
        library_name: context.library_name,
        duration_ms: duration_ms(session.started_at, session.ended_at, effective_now),
        rendition_id: session.rendition_id,
        started_at: session.started_at,
        ended_at: session.ended_at,
        play_method: session.play_method,
        transcode_reason: session.transcode_reason,
        source_codec: session.source_codec,
        source_container: session.source_container,
        source_bitrate: session.source_bitrate,
        target_codec: session.target_codec,
        target_container: session.target_container,
        target_bitrate: session.target_bitrate,
        client_platform: session.client_platform,
        client_version: session.client_version,
        ip_address: session.ip_address,
        bytes_streamed: session.bytes_streamed,
        buffering_events: session.buffering_events,
        buffering_ms_total: session.buffering_ms_total,
        stop_reason: session.stop_reason,
    }
}

async fn local_activity_node(state: &AppState) -> Result<ActivityNode, ApiError> {
    let identity = ensure_node_identity(&state.node_identity_repo).await?;
    let self_node = state
        .peer_node_repo
        .get(identity.peer_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to load self peer node: {err}")))?;
    let standalone_name = if self_node.is_none() {
        Some(
            state
                .system_settings_repo
                .get()
                .await
                .map_err(|err| {
                    ApiError::internal(format!("failed to load system settings: {err}"))
                })?
                .instance_name,
        )
    } else {
        None
    };

    Ok(ActivityNode {
        id: identity.peer_id,
        name: self_node
            .map(|node| node.name)
            .or(standalone_name)
            .expect("standalone system settings always provide an instance name"),
        is_self: true,
        group_id: identity.group_id,
    })
}

fn stamp_active_session(
    session: &mut ActiveSessionView,
    peer: &PeerNode,
    effective_now: DateTime<Utc>,
) {
    session.peer_node_id = peer.id;
    session.peer_node_name = peer.name.clone();
    session.peer_node_is_self = false;
    session.duration_ms = duration_ms(session.started_at, None, effective_now);
}

fn stamp_history_session(
    session: &mut SessionHistoryView,
    peer: &PeerNode,
    effective_now: DateTime<Utc>,
) {
    session.peer_node_id = peer.id;
    session.peer_node_name = peer.name.clone();
    session.peer_node_is_self = false;
    session.duration_ms = duration_ms(session.started_at, session.ended_at, effective_now);
}

fn accept_peer_history_response(
    peer: &PeerNode,
    response: PlaybackActivityHistoryResponse,
    request: &PlaybackActivityHistoryRequest,
    cursor: Option<&ActivityHistoryCursor>,
) -> Result<(Vec<SessionHistoryView>, bool), UnavailableNodeView> {
    let expected_snapshot = request
        .to
        .expect("validated history request always has an effective to");
    if response.snapshot_to != expected_snapshot {
        tracing::warn!(
            peer_node_id = %peer.id,
            expected_snapshot = %expected_snapshot,
            received_snapshot = %response.snapshot_to,
            "peer playback history response used a different snapshot; discarding its rows"
        );
        return Err(unavailable_node(
            peer,
            "history snapshot did not match the requested snapshot",
        ));
    }

    let has_more = response.has_more;
    let mut sessions = Vec::with_capacity(response.sessions.len());
    for mut session in response.sessions {
        if session.started_at != session.started_at.trunc_subsecs(3) {
            tracing::warn!(
                peer_node_id = %peer.id,
                session_id = %session.id,
                started_at = %session.started_at,
                "peer playback history row exceeded storage timestamp precision; discarding its rows"
            );
            return Err(unavailable_node(
                peer,
                "history row timestamp precision was invalid",
            ));
        }
        stamp_history_session(&mut session, peer, expected_snapshot);
        if cursor.is_some_and(|cursor| !history_session_is_after(&session, &cursor.after)) {
            tracing::warn!(
                peer_node_id = %peer.id,
                session_id = %session.id,
                "peer playback history response crossed the requested cursor frontier; discarding its rows"
            );
            return Err(unavailable_node(
                peer,
                "history cursor frontier was not honoured",
            ));
        }
        if history_view_matches(&session, request) {
            sessions.push(session);
        }
    }
    Ok((sessions, has_more))
}

fn compare_active_sessions(a: &ActiveSessionView, b: &ActiveSessionView) -> std::cmp::Ordering {
    b.started_at
        .cmp(&a.started_at)
        .then_with(|| a.peer_node_id.cmp(&b.peer_node_id))
        .then_with(|| a.session_id.cmp(&b.session_id))
}

fn compare_history_sessions(a: &SessionHistoryView, b: &SessionHistoryView) -> std::cmp::Ordering {
    b.started_at
        .cmp(&a.started_at)
        .then_with(|| a.peer_node_id.cmp(&b.peer_node_id))
        .then_with(|| a.id.cmp(&b.id))
}

fn history_key(session: &SessionHistoryView) -> ActivityHistoryKey {
    ActivityHistoryKey {
        started_at: session.started_at,
        peer_node_id: session.peer_node_id,
        session_id: session.id,
    }
}

/// Whether `session` sorts strictly after the cursor frontier in the global
/// `started_at DESC, peer_node_id ASC, session id ASC` order.
fn history_session_is_after(session: &SessionHistoryView, after: &ActivityHistoryKey) -> bool {
    session.started_at < after.started_at
        || (session.started_at == after.started_at
            && (session.peer_node_id > after.peer_node_id
                || (session.peer_node_id == after.peer_node_id && session.id > after.session_id)))
}

fn paginate_history_sessions(
    mut sessions: Vec<SessionHistoryView>,
    limit: usize,
    upstream_has_more: bool,
) -> (Vec<SessionHistoryView>, bool) {
    sessions.sort_by(compare_history_sessions);
    let has_more = upstream_has_more || sessions.len() > limit;
    sessions.truncate(limit);
    (sessions, has_more)
}

/// Every currently-active playback session, newest first -- backs the
/// admin Activity page's "live" section. Concurrently-active sessions are a
/// small set (dozens, not thousands), so the N+1 user/media lookups
/// `enrich_active` does per row are acceptable here.
#[utoipa::path(
    get,
    path = "/api/v1/admin/playback/sessions/active",
    tag = "admin",
    responses(
        (status = 200, description = "Every currently-active playback session", body = Vec<ActiveSessionView>, example = json!([
            {
                "session_id": "b3f1c2a4-6e8d-4a3b-9c1e-2f5d7a9b0c1d",
                "user_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                "user_display_name": "Jane Doe",
                "device_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
                "media_file_id": "9c858901-8a57-4791-81fe-4c455b099bc9",
                "work_id": "a7793a62-995b-42bd-aa93-ed3cd76f941e",
                "media_title": "The Sample Movie",
                "peer_node_id": "f29eaea2-5023-4a46-ae31-d84ea62f46c8",
                "peer_node_name": "Living Room",
                "peer_node_is_self": true,
                "source_instance_id": "3d33221e-a4f2-4317-8887-763c13e2474d",
                "source_instance_name": "Movies",
                "library_id": "fa76e5b3-dab8-43a3-bf2b-efb9f44e4e31",
                "library_name": "Movies",
                "duration_ms": 42000,
                "play_method": "direct_play",
                "target_codec": "h264",
                "target_container": "mp4",
                "client_platform": "web",
                "client_version": "1.4.2",
                "started_at": "2026-07-20T18:42:00Z",
                "bytes_streamed": 104857600,
                "buffering_events": 0,
                "buffering_ms_total": 0
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_active_sessions_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<ActiveSessionView>>, ApiError> {
    let effective_now = Utc::now();
    let node = local_activity_node(&state).await?;
    let mut sessions = state.session_registry.list_all();
    sessions.sort_by(|a, b| {
        b.started_at
            .cmp(&a.started_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    let mut views = Vec::with_capacity(sessions.len());
    for session in sessions {
        views.push(enrich_active(&state, session, &node, effective_now).await);
    }

    Ok(Json(views))
}

fn default_limit() -> i64 {
    100
}

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct SessionHistoryQuery {
    pub user_id: Option<Uuid>,
    pub from: Option<chrono::DateTime<chrono::Utc>>,
    pub to: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

/// Filtered, paginated and enriched session history -- backs the admin Activity
/// page's "history" section. `limit` is clamped to 500 server-side
/// regardless of what's requested, matching the two indexes
/// (`idx_playback_sessions_user_id`/`idx_playback_sessions_started_at`)
/// this query is built to actually use.
#[utoipa::path(
    get,
    path = "/api/v1/admin/playback/sessions/history",
    tag = "admin",
    params(SessionHistoryQuery),
    responses(
        (status = 200, description = "Filtered, paginated playback session history, newest first", body = Vec<SessionHistoryView>, example = json!([
            {
                "id": "b3f1c2a4-6e8d-4a3b-9c1e-2f5d7a9b0c1d",
                "user_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                "user_display_name": "Jane Doe",
                "device_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
                "media_file_id": "9c858901-8a57-4791-81fe-4c455b099bc9",
                "work_id": "a7793a62-995b-42bd-aa93-ed3cd76f941e",
                "media_title": "The Sample Movie",
                "peer_node_id": "f29eaea2-5023-4a46-ae31-d84ea62f46c8",
                "peer_node_name": "Living Room",
                "peer_node_is_self": true,
                "source_instance_id": "3d33221e-a4f2-4317-8887-763c13e2474d",
                "source_instance_name": "Movies",
                "library_id": "fa76e5b3-dab8-43a3-bf2b-efb9f44e4e31",
                "library_name": "Movies",
                "duration_ms": 5832000,
                "rendition_id": "6c9a5e2b-3d4f-4a8c-8e1b-7f2c9d3a5b6e",
                "started_at": "2026-07-20T18:42:00Z",
                "ended_at": "2026-07-20T20:19:12Z",
                "play_method": "transcode",
                "transcode_reason": "video_codec_not_supported",
                "source_codec": "hevc",
                "source_container": "mkv",
                "source_bitrate": 20000000,
                "target_codec": "h264",
                "target_container": "mp4",
                "target_bitrate": 4000000,
                "client_platform": "android-tv",
                "client_version": "2.1.0",
                "ip_address": "192.168.1.42",
                "bytes_streamed": 734003200,
                "buffering_events": 2,
                "buffering_ms_total": 1500,
                "stop_reason": "completed"
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_session_history_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(query): Query<SessionHistoryQuery>,
) -> Result<Json<Vec<SessionHistoryView>>, ApiError> {
    let filter = SessionFilter {
        user_ids: query.user_id.into_iter().collect(),
        from: query.from,
        to: query.to,
        limit: query.limit.min(500),
        offset: query.offset,
        ..Default::default()
    };
    let sessions = state.analytics_store.list_sessions(&filter).await?;
    let effective_now = query.to.unwrap_or_else(Utc::now);
    let node = local_activity_node(&state).await?;
    let mut views = Vec::with_capacity(sessions.len());
    for session in sessions {
        views.push(enrich_history(&state, session, &node, effective_now).await);
    }
    Ok(Json(views))
}

fn validate_range(name: &str, min: Option<i64>, max: Option<i64>) -> Result<(), ApiError> {
    if min.is_some_and(|value| value < 0) || max.is_some_and(|value| value < 0) {
        return Err(ApiError::bad_request(format!(
            "{name} bounds must be non-negative"
        )));
    }
    if min.zip(max).is_some_and(|(min, max)| min > max) {
        return Err(ApiError::bad_request(format!(
            "minimum {name} must not exceed maximum {name}"
        )));
    }
    Ok(())
}

#[derive(Serialize)]
struct ActivityHistoryFilterBinding {
    user_ids: Vec<Uuid>,
    play_methods: Vec<&'static str>,
    title_terms: Vec<String>,
    library_ids: Vec<Uuid>,
    peer_node_ids: Vec<Uuid>,
    stop_reasons: Vec<&'static str>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    min_duration_ms: Option<i64>,
    max_duration_ms: Option<i64>,
    min_bytes_streamed: Option<i64>,
    max_bytes_streamed: Option<i64>,
}

fn sorted_uuids(values: &[Uuid]) -> Vec<Uuid> {
    let mut values = values.to_vec();
    values.sort_unstable();
    values.dedup();
    values
}

fn play_method_wire_name(method: PlayMethod) -> &'static str {
    match method {
        PlayMethod::DirectPlay => "direct_play",
        PlayMethod::DirectStream => "direct_stream",
        PlayMethod::Transcode => "transcode",
    }
}

fn stop_reason_wire_name(reason: PlaybackActivityStopReason) -> &'static str {
    match reason {
        PlaybackActivityStopReason::Completed => "completed",
        PlaybackActivityStopReason::UserStopped => "user_stopped",
        PlaybackActivityStopReason::Error => "error",
        PlaybackActivityStopReason::DeviceDisconnected => "device_disconnected",
        PlaybackActivityStopReason::SessionRevoked => "session_revoked",
        PlaybackActivityStopReason::ConcurrentLimitExceeded => "concurrent_limit_exceeded",
        PlaybackActivityStopReason::IdleTimeout => "idle_timeout",
        PlaybackActivityStopReason::Other => "other",
        PlaybackActivityStopReason::InProgress => "in_progress",
    }
}

fn history_filter_fingerprint(request: &PlaybackActivityHistoryRequest) -> String {
    let mut play_methods: Vec<_> = request
        .play_methods
        .iter()
        .copied()
        .map(play_method_wire_name)
        .collect();
    play_methods.sort_unstable();
    play_methods.dedup();

    let mut title_terms = request.title_terms.clone();
    title_terms.sort_unstable();
    title_terms.dedup();

    let mut stop_reasons: Vec<_> = request
        .stop_reasons
        .iter()
        .copied()
        .map(stop_reason_wire_name)
        .collect();
    stop_reasons.sort_unstable();
    stop_reasons.dedup();

    let binding = ActivityHistoryFilterBinding {
        user_ids: sorted_uuids(&request.user_ids),
        play_methods,
        title_terms,
        library_ids: sorted_uuids(&request.library_ids),
        peer_node_ids: sorted_uuids(&request.peer_node_ids),
        stop_reasons,
        from: request.from,
        to: request.to,
        min_duration_ms: request.min_duration_ms,
        max_duration_ms: request.max_duration_ms,
        min_bytes_streamed: request.min_bytes_streamed,
        max_bytes_streamed: request.max_bytes_streamed,
    };
    let encoded =
        serde_json::to_vec(&binding).expect("activity history filter binding always serializes");
    hex::encode(Sha256::digest(encoded))
}

fn contributor_fingerprint(contributor_ids: &[Uuid]) -> String {
    let encoded = serde_json::to_vec(&sorted_uuids(contributor_ids))
        .expect("activity contributor ids always serialize");
    hex::encode(Sha256::digest(encoded))
}

fn validate_history_cursor_membership(
    cursor: Option<&ActivityHistoryCursor>,
    member_ids: &[Uuid],
) -> Result<(), ApiError> {
    if cursor
        .is_some_and(|cursor| cursor.membership_fingerprint != contributor_fingerprint(member_ids))
    {
        return Err(ApiError::conflict(
            "connected-server membership changed; restart activity history pagination",
        ));
    }
    Ok(())
}

fn validate_history_cursor_contributors(
    cursor: Option<&ActivityHistoryCursor>,
    contributor_ids: &[Uuid],
) -> Result<(), ApiError> {
    if cursor.is_some_and(|cursor| {
        cursor.contributor_fingerprint != contributor_fingerprint(contributor_ids)
    }) {
        return Err(ApiError::conflict(
            "connected-server availability changed; restart activity history pagination",
        ));
    }
    Ok(())
}

fn encode_history_cursor(cursor: &ActivityHistoryCursor) -> String {
    let encoded = serde_json::to_vec(cursor).expect("activity history cursor always serializes");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(encoded)
}

fn decode_history_cursor(value: &str) -> Result<ActivityHistoryCursor, ApiError> {
    if value.len() > 4_096 {
        return Err(ApiError::bad_request("invalid activity history cursor"));
    }
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| ApiError::bad_request("invalid activity history cursor"))?;
    let cursor: ActivityHistoryCursor = serde_json::from_slice(&decoded)
        .map_err(|_| ApiError::bad_request("invalid activity history cursor"))?;
    if cursor.version != HISTORY_CURSOR_VERSION
        || cursor.snapshot_to != cursor.snapshot_to.trunc_subsecs(3)
        || cursor.after.started_at != cursor.after.started_at.trunc_subsecs(3)
    {
        return Err(ApiError::bad_request("invalid activity history cursor"));
    }
    Ok(cursor)
}

fn validate_history_request(
    mut request: PlaybackActivityHistoryRequest,
    effective_now: DateTime<Utc>,
) -> Result<ValidatedHistoryRequest, ApiError> {
    if request.limit <= 0 {
        return Err(ApiError::bad_request("limit must be positive"));
    }
    if request.offset != 0 {
        return Err(ApiError::bad_request(
            "offset pagination is not supported; use cursor",
        ));
    }
    request.limit = request.limit.min(MAX_HISTORY_LIMIT);
    let cursor = request
        .cursor
        .as_deref()
        .map(decode_history_cursor)
        .transpose()?;

    // Playback timestamps are stored at millisecond precision. Normalising
    // request bounds to that same precision keeps the DB predicate and the
    // coordinator's defensive post-filter inclusive in exactly the same way.
    request.from = request.from.map(|from| from.trunc_subsecs(3));
    request.to = request.to.map(|to| to.trunc_subsecs(3));
    if let Some(cursor) = &cursor {
        if request
            .to
            .is_some_and(|requested_to| requested_to != cursor.snapshot_to)
        {
            return Err(ApiError::bad_request(
                "activity history cursor does not match the requested snapshot",
            ));
        }
        request.to = Some(cursor.snapshot_to);
    } else {
        request.to = Some(request.to.unwrap_or(effective_now).trunc_subsecs(3));
    }
    if request
        .from
        .zip(request.to)
        .is_some_and(|(from, to)| from > to)
    {
        return Err(ApiError::bad_request(
            "from must be earlier than or equal to to",
        ));
    }
    validate_range("duration", request.min_duration_ms, request.max_duration_ms)?;
    validate_range(
        "bytes_streamed",
        request.min_bytes_streamed,
        request.max_bytes_streamed,
    )?;

    request.title_terms = request
        .title_terms
        .into_iter()
        .map(|term| term.trim().to_lowercase())
        .filter(|term| !term.is_empty())
        .collect();

    let filter_fingerprint = history_filter_fingerprint(&request);
    if cursor
        .as_ref()
        .is_some_and(|cursor| cursor.filter_fingerprint != filter_fingerprint)
    {
        return Err(ApiError::bad_request(
            "activity history cursor does not match the requested filters",
        ));
    }

    Ok(ValidatedHistoryRequest {
        request,
        cursor,
        filter_fingerprint,
    })
}

fn stop_reason_matches(actual: &Option<StopReason>, expected: PlaybackActivityStopReason) -> bool {
    matches!(
        (actual, expected),
        (
            Some(StopReason::Completed),
            PlaybackActivityStopReason::Completed
        ) | (
            Some(StopReason::UserStopped),
            PlaybackActivityStopReason::UserStopped
        ) | (Some(StopReason::Error), PlaybackActivityStopReason::Error)
            | (
                Some(StopReason::DeviceDisconnected),
                PlaybackActivityStopReason::DeviceDisconnected
            )
            | (
                Some(StopReason::SessionRevoked),
                PlaybackActivityStopReason::SessionRevoked
            )
            | (
                Some(StopReason::ConcurrentLimitExceeded),
                PlaybackActivityStopReason::ConcurrentLimitExceeded
            )
            | (
                Some(StopReason::IdleTimeout),
                PlaybackActivityStopReason::IdleTimeout
            )
            | (
                Some(StopReason::Other(_)),
                PlaybackActivityStopReason::Other
            )
            | (None, PlaybackActivityStopReason::InProgress)
    )
}

fn history_view_matches(
    session: &SessionHistoryView,
    request: &PlaybackActivityHistoryRequest,
) -> bool {
    let title_matches = request.title_terms.is_empty()
        || session.media_title.as_ref().is_some_and(|title| {
            let title = title.to_lowercase();
            request.title_terms.iter().any(|term| title.contains(term))
        });
    let bytes_streamed = i64::try_from(session.bytes_streamed).unwrap_or(i64::MAX);
    let duration_ms = i64::try_from(session.duration_ms).unwrap_or(i64::MAX);

    (request.user_ids.is_empty() || request.user_ids.contains(&session.user_id))
        && (request.play_methods.is_empty() || request.play_methods.contains(&session.play_method))
        && title_matches
        && (request.library_ids.is_empty()
            || session
                .library_id
                .is_some_and(|id| request.library_ids.contains(&id)))
        && (request.peer_node_ids.is_empty()
            || request.peer_node_ids.contains(&session.peer_node_id))
        && (request.stop_reasons.is_empty()
            || request
                .stop_reasons
                .iter()
                .any(|reason| stop_reason_matches(&session.stop_reason, *reason)))
        && request.from.is_none_or(|from| session.started_at >= from)
        && request.to.is_none_or(|to| session.started_at <= to)
        && request.min_duration_ms.is_none_or(|min| duration_ms >= min)
        && request.max_duration_ms.is_none_or(|max| duration_ms <= max)
        && request
            .min_bytes_streamed
            .is_none_or(|min| bytes_streamed >= min)
        && request
            .max_bytes_streamed
            .is_none_or(|max| bytes_streamed <= max)
}

fn history_prefix_len(request: &PlaybackActivityHistoryRequest) -> usize {
    // Validation already checked that `limit` is positive and bounded.
    usize::try_from(request.limit + 1).expect("validated history prefix length fits usize")
}

async fn local_active_sessions(
    state: &AppState,
    node: &ActivityNode,
    effective_now: DateTime<Utc>,
) -> Vec<ActiveSessionView> {
    let mut sessions = state.session_registry.list_all();
    sessions.sort_by(|a, b| {
        b.started_at
            .cmp(&a.started_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    let mut views = Vec::with_capacity(sessions.len());
    for session in sessions {
        views.push(enrich_active(state, session, node, effective_now).await);
    }
    views
}

async fn local_history_prefix(
    state: &AppState,
    node: &ActivityNode,
    request: &PlaybackActivityHistoryRequest,
    cursor: Option<&ActivityHistoryCursor>,
) -> Result<PlaybackActivityHistoryResponse, ApiError> {
    let effective_now = request
        .to
        .expect("validated activity history request always has an effective to");
    if !request.peer_node_ids.is_empty() && !request.peer_node_ids.contains(&node.id) {
        return Ok(PlaybackActivityHistoryResponse {
            sessions: Vec::new(),
            unavailable_nodes: Vec::new(),
            has_more: false,
            next_cursor: None,
            snapshot_to: effective_now,
        });
    }

    let prefix_len = history_prefix_len(request);
    let base_filter = SessionFilter {
        user_ids: request.user_ids.clone(),
        play_methods: request.play_methods.clone(),
        stop_reasons: request
            .stop_reasons
            .iter()
            .copied()
            .map(SessionStopReasonFilter::from)
            .collect(),
        from: request.from,
        to: request.to,
        min_bytes_streamed: request.min_bytes_streamed,
        max_bytes_streamed: request.max_bytes_streamed,
        ..Default::default()
    };

    let mut raw_offset = 0;
    let mut matches = Vec::with_capacity(prefix_len.min(MAX_HISTORY_LIMIT as usize + 1));
    'scan: loop {
        let mut filter = base_filter.clone();
        filter.limit = HISTORY_SCAN_BATCH_SIZE;
        filter.offset = raw_offset;
        let sessions = state.analytics_store.list_sessions(&filter).await?;
        let fetched = i64::try_from(sessions.len()).unwrap_or(i64::MAX);

        for session in sessions {
            let view = enrich_history(state, session, node, effective_now).await;
            if history_view_matches(&view, request)
                && cursor.is_none_or(|cursor| history_session_is_after(&view, &cursor.after))
            {
                matches.push(view);
                if matches.len() >= prefix_len {
                    break 'scan;
                }
            }
        }

        if fetched < HISTORY_SCAN_BATCH_SIZE {
            break;
        }
        raw_offset = raw_offset
            .checked_add(fetched)
            .ok_or_else(|| ApiError::internal("playback history scan offset overflowed"))?;
    }

    Ok(PlaybackActivityHistoryResponse {
        has_more: matches.len()
            > usize::try_from(request.limit).expect("validated history limit fits usize"),
        sessions: matches,
        unavailable_nodes: Vec::new(),
        next_cursor: None,
        snapshot_to: effective_now,
    })
}

fn unavailable_node(peer: &PeerNode, error: impl Into<String>) -> UnavailableNodeView {
    UnavailableNodeView {
        peer_node_id: peer.id,
        peer_node_name: peer.name.clone(),
        error: error.into(),
    }
}

async fn fetch_peer_active(
    client: playarr_peer_sync::PeerClient,
    peer: PeerNode,
) -> Result<(PeerNode, PlaybackActivityActiveResponse), UnavailableNodeView> {
    let addresses = client.addresses_for_peer(peer.id, &peer.addresses);
    if addresses.is_empty() {
        return Err(unavailable_node(&peer, "no known address"));
    }

    for address in addresses {
        match tokio::time::timeout(
            PEER_ACTIVITY_TIMEOUT,
            client.signed_get::<PlaybackActivityActiveResponse>(
                &address,
                "/api/v1/peer/playback/activity/active",
            ),
        )
        .await
        {
            Ok(Ok(response)) => return Ok((peer, response)),
            Ok(Err(err)) => {
                tracing::warn!(
                    peer_node_id = %peer.id,
                    %address,
                    error = %err,
                    "peer playback activity request failed; trying next address"
                );
            }
            Err(_) => {
                tracing::warn!(
                    peer_node_id = %peer.id,
                    %address,
                    "peer playback activity request timed out; trying next address"
                );
            }
        }
    }
    Err(unavailable_node(
        &peer,
        "all known addresses timed out or failed",
    ))
}

async fn fetch_peer_history(
    client: playarr_peer_sync::PeerClient,
    peer: PeerNode,
    request: PlaybackActivityHistoryRequest,
) -> Result<(PeerNode, PlaybackActivityHistoryResponse), UnavailableNodeView> {
    let addresses = client.addresses_for_peer(peer.id, &peer.addresses);
    if addresses.is_empty() {
        return Err(unavailable_node(&peer, "no known address"));
    }

    for address in addresses {
        match tokio::time::timeout(
            PEER_ACTIVITY_TIMEOUT,
            client.signed_post::<_, PlaybackActivityHistoryResponse>(
                &address,
                "/api/v1/peer/playback/activity/history",
                &request,
            ),
        )
        .await
        {
            Ok(Ok(response)) => return Ok((peer, response)),
            Ok(Err(err)) => {
                tracing::warn!(
                    peer_node_id = %peer.id,
                    %address,
                    error = %err,
                    "peer playback history request failed; trying next address"
                );
            }
            Err(_) => {
                tracing::warn!(
                    peer_node_id = %peer.id,
                    %address,
                    "peer playback history request timed out; trying next address"
                );
            }
        }
    }
    Err(unavailable_node(
        &peer,
        "all known addresses timed out or failed",
    ))
}

async fn activity_peers(
    state: &AppState,
    local_node: &ActivityNode,
    selected_peer_ids: &[Uuid],
) -> Result<(Vec<PeerNode>, Vec<UnavailableNodeView>, Vec<Uuid>), ApiError> {
    let mut contributor_ids = Vec::new();
    if selected_peer_ids.is_empty() || selected_peer_ids.contains(&local_node.id) {
        contributor_ids.push(local_node.id);
    }
    let Some(group_id) = local_node.group_id else {
        return Ok((Vec::new(), Vec::new(), contributor_ids));
    };
    let nodes = state
        .peer_node_repo
        .list_all()
        .await
        .map_err(|err| ApiError::internal(format!("failed to list peer nodes: {err}")))?;

    let mut reachable = Vec::new();
    let mut unavailable = Vec::new();
    for peer in nodes {
        if peer.group_id != group_id
            || peer.id == local_node.id
            || peer.is_self
            || peer.status == PeerNodeStatus::Left
            || (!selected_peer_ids.is_empty() && !selected_peer_ids.contains(&peer.id))
        {
            continue;
        }
        contributor_ids.push(peer.id);
        if peer.status == PeerNodeStatus::Unreachable {
            unavailable.push(unavailable_node(&peer, "node is marked unreachable"));
        } else {
            reachable.push(peer);
        }
    }
    contributor_ids.sort_unstable();
    contributor_ids.dedup();
    Ok((reachable, unavailable, contributor_ids))
}

async fn activity_library_facets(
    state: &AppState,
    local_node: &ActivityNode,
) -> Result<Vec<PlaybackActivityLibraryFacet>, ApiError> {
    let mut libraries = BTreeMap::new();
    if let Some(group_id) = local_node.group_id {
        for library in state
            .group_library_repo
            .list_for_group(group_id)
            .await
            .map_err(|err| {
                ApiError::internal(format!(
                    "failed to list group libraries for playback activity: {err}"
                ))
            })?
        {
            libraries.insert(library.id, library.name);
        }
    }

    // Read the durable repository directly so a just-synchronised peer source
    // is immediately available even before the worker's periodic in-memory
    // registry refresh. A mapped source contributes its portable
    // group-library id; an ungrouped source is itself the effective library
    // used by activity rows. `or_insert` preserves the authoritative
    // GroupLibrary name above and gives a useful source-name fallback while a
    // mapped library row is missing or has not arrived yet.
    for source in state.source_instance_repo.list_all().await.map_err(|err| {
        ApiError::internal(format!(
            "failed to list source instances for playback activity: {err}"
        ))
    })? {
        libraries
            .entry(source.group_library_id.unwrap_or(source.id))
            .or_insert(source.name);
    }

    let mut libraries: Vec<_> = libraries
        .into_iter()
        .map(|(id, name)| PlaybackActivityLibraryFacet { id, name })
        .collect();
    libraries.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(libraries)
}

/// Complete library choices for the Activity filter. Unlike choices derived
/// from a history page, these remain available when the current filters return
/// no rows and include libraries known through peer synchronisation.
#[utoipa::path(
    get,
    path = "/api/v1/admin/playback/activity/facets",
    tag = "admin",
    responses(
        (status = 200, description = "Complete effective library choices for playback activity", body = PlaybackActivityFacetsResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn playback_activity_facets_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<PlaybackActivityFacetsResponse>, ApiError> {
    let local_node = local_activity_node(&state).await?;
    Ok(Json(PlaybackActivityFacetsResponse {
        libraries: activity_library_facets(&state, &local_node).await?,
    }))
}

/// Group-wide live playback sessions. A peer outage is represented in
/// `unavailable_nodes`; it does not discard sessions returned by this node or
/// any other reachable peer.
#[utoipa::path(
    get,
    path = "/api/v1/admin/playback/activity/active",
    tag = "admin",
    responses(
        (status = 200, description = "Live playback across the peer group", body = PlaybackActivityActiveResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn playback_activity_active_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<PlaybackActivityActiveResponse>, ApiError> {
    let effective_now = Utc::now();
    let local_node = local_activity_node(&state).await?;
    let mut sessions = local_active_sessions(&state, &local_node, effective_now).await;
    let (peers, mut unavailable_nodes, _) = activity_peers(&state, &local_node, &[]).await?;

    if !peers.is_empty() {
        let client = playarr_peer_sync::PeerClient::new_with_routes(
            state.peer_http.clone(),
            own_peer_identity(&state).await?,
            state.peer_transport_routes.clone(),
        );
        let calls = peers
            .into_iter()
            .map(|peer| fetch_peer_active(client.clone(), peer));
        for result in join_all(calls).await {
            match result {
                Ok((peer, response)) => {
                    for mut session in response.sessions {
                        stamp_active_session(&mut session, &peer, effective_now);
                        sessions.push(session);
                    }
                }
                Err(unavailable) => unavailable_nodes.push(unavailable),
            }
        }
    }

    sessions.sort_by(compare_active_sessions);
    unavailable_nodes.sort_by(|a, b| {
        a.peer_node_name
            .cmp(&b.peer_node_name)
            .then_with(|| a.peer_node_id.cmp(&b.peer_node_id))
    });
    Ok(Json(PlaybackActivityActiveResponse {
        sessions,
        unavailable_nodes,
    }))
}

/// Group-wide, filtered playback history. Each node applies storage filters
/// first, then scans deterministic batches until it has enough enriched
/// title/library/duration matches for correct global pagination.
#[utoipa::path(
    post,
    path = "/api/v1/admin/playback/activity/history",
    tag = "admin",
    request_body = PlaybackActivityHistoryRequest,
    responses(
        (status = 200, description = "Filtered playback history across the peer group", body = PlaybackActivityHistoryResponse),
        (status = 400, description = "Invalid range or pagination"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 409, description = "Connected-server membership or availability changed during pagination")
    )
)]
pub async fn playback_activity_history_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(request): Json<PlaybackActivityHistoryRequest>,
) -> Result<Json<PlaybackActivityHistoryResponse>, ApiError> {
    let validated = validate_history_request(request, Utc::now())?;
    let request = &validated.request;
    let local_node = local_activity_node(&state).await?;
    let (peers, mut unavailable_nodes, member_ids) =
        activity_peers(&state, &local_node, &request.peer_node_ids).await?;
    validate_history_cursor_membership(validated.cursor.as_ref(), &member_ids)?;
    let current_membership_fingerprint = contributor_fingerprint(&member_ids);
    let mut contributor_ids = Vec::new();
    if member_ids.binary_search(&local_node.id).is_ok() {
        contributor_ids.push(local_node.id);
    }

    let local =
        local_history_prefix(&state, &local_node, request, validated.cursor.as_ref()).await?;
    let mut sessions = local.sessions;
    let mut has_more = local.has_more;

    if !peers.is_empty() {
        let client = playarr_peer_sync::PeerClient::new_with_routes(
            state.peer_http.clone(),
            own_peer_identity(&state).await?,
            state.peer_transport_routes.clone(),
        );
        let calls = peers
            .into_iter()
            .map(|peer| fetch_peer_history(client.clone(), peer, request.clone()));
        for result in join_all(calls).await {
            match result {
                Ok((peer, response)) => {
                    match accept_peer_history_response(
                        &peer,
                        response,
                        request,
                        validated.cursor.as_ref(),
                    ) {
                        Ok((peer_sessions, peer_has_more)) => {
                            contributor_ids.push(peer.id);
                            has_more |= peer_has_more;
                            sessions.extend(peer_sessions);
                        }
                        Err(unavailable) => unavailable_nodes.push(unavailable),
                    }
                }
                Err(unavailable) => unavailable_nodes.push(unavailable),
            }
        }
    }
    contributor_ids.sort_unstable();
    contributor_ids.dedup();
    validate_history_cursor_contributors(validated.cursor.as_ref(), &contributor_ids)?;
    let current_contributor_fingerprint = contributor_fingerprint(&contributor_ids);

    let limit = usize::try_from(request.limit).expect("validated limit fits usize");
    let (sessions, mut has_more) = paginate_history_sessions(sessions, limit, has_more);
    if sessions.is_empty() {
        has_more = false;
    }
    let next_cursor = has_more.then(|| {
        encode_history_cursor(&ActivityHistoryCursor {
            version: HISTORY_CURSOR_VERSION,
            snapshot_to: request
                .to
                .expect("validated history request always has an effective to"),
            filter_fingerprint: validated.filter_fingerprint.clone(),
            membership_fingerprint: current_membership_fingerprint,
            contributor_fingerprint: current_contributor_fingerprint,
            after: history_key(
                sessions
                    .last()
                    .expect("a continuing activity history page is non-empty"),
            ),
        })
    });
    unavailable_nodes.sort_by(|a, b| {
        a.peer_node_name
            .cmp(&b.peer_node_name)
            .then_with(|| a.peer_node_id.cmp(&b.peer_node_id))
    });

    Ok(Json(PlaybackActivityHistoryResponse {
        sessions,
        unavailable_nodes,
        has_more,
        next_cursor,
        snapshot_to: request
            .to
            .expect("validated history request always has an effective to"),
    }))
}

/// Signed peer-local half of [`playback_activity_active_handler`]. It never
/// fans out again, preventing request loops.
#[utoipa::path(
    get,
    path = "/api/v1/peer/playback/activity/active",
    tag = "peer-groups",
    responses(
        (status = 200, description = "This peer's live playback sessions", body = PlaybackActivityActiveResponse),
        (status = 401, description = "Missing or invalid peer signature")
    )
)]
pub async fn peer_playback_activity_active_handler(
    State(state): State<AppState>,
    _signed: PeerSignedRequest,
) -> Result<Json<PlaybackActivityActiveResponse>, ApiError> {
    let effective_now = Utc::now();
    let local_node = local_activity_node(&state).await?;
    Ok(Json(PlaybackActivityActiveResponse {
        sessions: local_active_sessions(&state, &local_node, effective_now).await,
        unavailable_nodes: Vec::new(),
    }))
}

/// Signed peer-local half of [`playback_activity_history_handler`].
#[utoipa::path(
    post,
    path = "/api/v1/peer/playback/activity/history",
    tag = "peer-groups",
    request_body = PlaybackActivityHistoryRequest,
    responses(
        (status = 200, description = "This peer's filtered playback history prefix", body = PlaybackActivityHistoryResponse),
        (status = 400, description = "Invalid range or pagination"),
        (status = 401, description = "Missing or invalid peer signature")
    )
)]
pub async fn peer_playback_activity_history_handler(
    State(state): State<AppState>,
    signed: PeerSignedRequest,
) -> Result<Json<PlaybackActivityHistoryResponse>, ApiError> {
    let request: PlaybackActivityHistoryRequest = serde_json::from_slice(&signed.body)
        .map_err(|err| ApiError::bad_request(format!("invalid activity history request: {err}")))?;
    let validated = validate_history_request(request, Utc::now())?;
    let local_node = local_activity_node(&state).await?;
    Ok(Json(
        local_history_prefix(
            &state,
            &local_node,
            &validated.request,
            validated.cursor.as_ref(),
        )
        .await?,
    ))
}

/// Force-stops a live playback session -- the "let me stop it" half of the
/// admin Activity/Tasks in-progress-transcode view. Kills the underlying
/// ffmpeg process too, if this session has one (`TranscodeOrchestrator::
/// expire_playback_session` is a harmless no-op for direct-play/durable-
/// rendition sessions, which were never associated with a transcode
/// process in the first place -- see that method's own doc comment), then
/// finalizes the durable record with `StopReason::Other("admin_stopped")`
/// (not `UserStopped`, since the *viewer* didn't stop it -- an operator
/// did, from the admin UI, which callers reading session history should be
/// able to tell apart from a normal end-of-playback stop).
#[utoipa::path(
    post,
    path = "/api/v1/admin/playback/sessions/{session_id}/stop",
    tag = "admin",
    params(("session_id" = Uuid, Path, description = "PlaybackSession id (see ActiveSessionView::session_id)")),
    responses(
        (status = 204, description = "Session stopped (or was already gone -- stopping a session that already ended is not an error)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn stop_session_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(session_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, ApiError> {
    let Some(session) = state.session_registry.get(session_id) else {
        // Already stopped/expired on its own -- stopping a session that's
        // already gone achieves the caller's actual goal (nothing is
        // running), so this is success, not a 404.
        return Ok(axum::http::StatusCode::NO_CONTENT);
    };

    if let Err(err) = state.transcode.expire_playback_session(session_id).await {
        tracing::warn!(
            session_id = %session_id,
            error = %err,
            "admin stop-session: failed to stop the underlying transcode process; \
             still finalizing the playback session record"
        );
    }

    state
        .analytics
        .on_session_end(
            session_id,
            &session,
            StopReason::Other("admin_stopped".to_string()),
        )
        .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use chrono::SubsecRound;
    use playarr_model::media::LeafRef;
    use playarr_model::{
        ClientPlatform, GroupLibrary, PeerAddress, PeerGroup, PeerNode, PeerNodeStatus, PlayMethod,
        PlaybackSession, Sensitive, SourceInstance, SourceKind, StopReason, SystemSettings,
    };
    use tower::ServiceExt;
    use uuid::Uuid;
    use wiremock::matchers::{header_exists, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_streaming_user, test_state,
    };

    fn sample_session(
        user_id: Uuid,
        media_file_id: Uuid,
        started_at: chrono::DateTime<chrono::Utc>,
    ) -> PlaybackSession {
        PlaybackSession {
            id: Uuid::new_v4(),
            user_id,
            device_id: Uuid::new_v4(),
            media_file_id,
            rendition_id: None,
            started_at,
            ended_at: None,
            play_method: PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(8_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(8_000_000),
            client_platform: ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        }
    }

    async fn seed_peer_group_with_unreachable_node(
        state: &crate::test_support::TestState,
    ) -> (Uuid, Uuid) {
        let mut identity = crate::admin_peer::ensure_node_identity(&state.app.node_identity_repo)
            .await
            .unwrap();
        let group = PeerGroup {
            id: Uuid::new_v4(),
            name: "activity group".to_string(),
            created_at: chrono::Utc::now(),
        };
        state.app.peer_group_repo.create(&group).await.unwrap();
        identity.group_id = Some(group.id);
        state.app.node_identity_repo.put(&identity).await.unwrap();

        let now = chrono::Utc::now();
        let self_node = PeerNode {
            id: identity.peer_id,
            group_id: group.id,
            name: "Home Server".to_string(),
            addresses: Vec::new(),
            public_key: "self-public-key".to_string(),
            is_self: true,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        };
        state.app.peer_node_repo.upsert(&self_node).await.unwrap();

        let remote_id = Uuid::new_v4();
        let remote = PeerNode {
            id: remote_id,
            group_id: group.id,
            name: "Offline Server".to_string(),
            addresses: vec![PeerAddress {
                url: "https://offline.invalid".to_string(),
                priority: 0,
                label: "test".to_string(),
                client_reachable: false,
            }],
            public_key: "remote-public-key".to_string(),
            is_self: false,
            status: PeerNodeStatus::Unreachable,
            last_seen_at: None,
            last_sync_error: Some("offline".to_string()),
            joined_at: now,
            updated_at: now,
        };
        state.app.peer_node_repo.upsert(&remote).await.unwrap();
        (identity.peer_id, remote_id)
    }

    #[tokio::test]
    async fn active_sessions_requires_admin() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/sessions/active")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn active_sessions_lists_a_live_registry_entry() {
        use playarr_model::media::LeafRef;
        use playarr_model::{ClientPlatform, PlayMethod, PlaybackSession};

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let work_id = crate::test_support::seed_movie(&state, "Activity Test Movie").await;
        let media_file_id =
            crate::test_support::seed_media_file(&state, work_id, LeafRef::Work, Uuid::new_v4())
                .await;
        let media_file = state
            .media_file_repo
            .get_by_id(media_file_id)
            .await
            .unwrap();
        state.media_files.insert(media_file);

        let session = PlaybackSession {
            id: Uuid::new_v4(),
            user_id: admin_id,
            device_id: Uuid::new_v4(),
            media_file_id,
            rendition_id: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
            play_method: PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(8_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(8_000_000),
            client_platform: ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 1_234,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        };
        state.app.session_registry.insert(session.clone());

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/sessions/active")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let views: Vec<super::ActiveSessionView> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].session_id, session.id);
        assert_eq!(views[0].bytes_streamed, 1_234);
        assert_eq!(views[0].work_id, Some(work_id));
        assert_eq!(views[0].media_title.as_deref(), Some("Activity Test Movie"));
        // The seeded admin user has a real, persisted display name --
        // proves the enrichment lookup actually ran, not just passed
        // through the bare id.
        assert!(views[0].user_display_name.is_some());
    }

    #[tokio::test]
    async fn session_history_requires_admin() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/sessions/history")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn session_history_filters_by_user_id() {
        use playarr_model::{ClientPlatform, PlayMethod, PlaybackSession};

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let target_user = Uuid::new_v4();
        let other_user = Uuid::new_v4();
        seed_streaming_user(&state, target_user).await;
        seed_streaming_user(&state, other_user).await;

        for user_id in [target_user, other_user] {
            let session = PlaybackSession {
                id: Uuid::new_v4(),
                user_id,
                device_id: Uuid::new_v4(),
                media_file_id: Uuid::new_v4(),
                rendition_id: None,
                started_at: chrono::Utc::now(),
                ended_at: None,
                play_method: PlayMethod::DirectPlay,
                transcode_reason: None,
                source_codec: "h264".to_string(),
                source_container: "mp4".to_string(),
                source_bitrate: Some(8_000_000),
                target_codec: "h264".to_string(),
                target_container: "mp4".to_string(),
                target_bitrate: Some(8_000_000),
                client_platform: ClientPlatform::Web,
                client_version: "1.0.0".to_string(),
                ip_address: None,
                bytes_streamed: 0,
                buffering_events: 0,
                buffering_ms_total: 0,
                stop_reason: None,
            };
            state
                .app
                .analytics_store
                .record_session_start(&session)
                .await
                .unwrap();
        }

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/v1/admin/playback/sessions/history?user_id={target_user}"
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let sessions: Vec<super::SessionHistoryView> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].user_id, target_user);
        assert!(sessions[0].user_display_name.is_some());
    }

    #[tokio::test]
    async fn group_activity_facets_requires_admin() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/activity/facets")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn group_activity_facets_include_complete_deduped_effective_libraries() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        seed_peer_group_with_unreachable_node(&state).await;
        let group_id = state
            .app
            .node_identity_repo
            .get()
            .await
            .unwrap()
            .unwrap()
            .group_id
            .unwrap();
        let now = chrono::Utc::now();
        let movies_id = Uuid::new_v4();
        let archive_id = Uuid::new_v4();
        for (id, name) in [(movies_id, "Movies"), (archive_id, "Archive")] {
            state
                .app
                .group_library_repo
                .upsert(&GroupLibrary {
                    id,
                    group_id,
                    name: name.to_string(),
                    created_at: now,
                    updated_at: now,
                })
                .await
                .unwrap();
        }

        let missing_group_library_id = Uuid::new_v4();
        let standalone_source_id = Uuid::new_v4();
        for (id, name, group_library_id) in [
            (
                Uuid::new_v4(),
                "Mapped source label must not replace Movies",
                Some(movies_id),
            ),
            (
                Uuid::new_v4(),
                "Second mapped source must deduplicate",
                Some(movies_id),
            ),
            (
                Uuid::new_v4(),
                "TV fallback",
                Some(missing_group_library_id),
            ),
            (standalone_source_id, "Audiobooks", None),
        ] {
            state
                .app
                .source_instance_repo
                .upsert(&SourceInstance {
                    id,
                    kind: SourceKind::Radarr,
                    name: name.to_string(),
                    base_url: "https://source.invalid".to_string(),
                    api_key_encrypted: Sensitive::new("not-a-real-key".to_string()),
                    priority: 0,
                    default_root_folder_id: None,
                    folder_mappings: Default::default(),
                    default_quality_profile_id: None,
                    best_effort: false,
                    group_library_id,
                })
                .await
                .unwrap();
        }

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/activity/facets")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let response: super::PlaybackActivityFacetsResponse =
            serde_json::from_slice(&bytes).unwrap();

        assert_eq!(
            response.libraries,
            vec![
                super::PlaybackActivityLibraryFacet {
                    id: archive_id,
                    name: "Archive".to_string(),
                },
                super::PlaybackActivityLibraryFacet {
                    id: standalone_source_id,
                    name: "Audiobooks".to_string(),
                },
                super::PlaybackActivityLibraryFacet {
                    id: movies_id,
                    name: "Movies".to_string(),
                },
                super::PlaybackActivityLibraryFacet {
                    id: missing_group_library_id,
                    name: "TV fallback".to_string(),
                },
            ]
        );
    }

    #[tokio::test]
    async fn group_activity_active_returns_local_rows_and_marks_unreachable_peers() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let (self_peer_id, remote_peer_id) = seed_peer_group_with_unreachable_node(&state).await;

        let session = sample_session(admin_id, Uuid::new_v4(), chrono::Utc::now());
        state.app.session_registry.insert(session.clone());

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/activity/active")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: super::PlaybackActivityActiveResponse = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body.sessions.len(), 1);
        assert_eq!(body.sessions[0].session_id, session.id);
        assert_eq!(body.sessions[0].peer_node_id, self_peer_id);
        assert_eq!(body.sessions[0].peer_node_name, "Home Server");
        assert!(body.sessions[0].peer_node_is_self);
        assert_eq!(body.unavailable_nodes.len(), 1);
        assert_eq!(body.unavailable_nodes[0].peer_node_id, remote_peer_id);
        assert_eq!(body.unavailable_nodes[0].peer_node_name, "Offline Server");
    }

    #[tokio::test]
    async fn group_activity_active_fetches_a_signed_peer_and_stamps_its_trusted_identity() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let (_self_peer_id, remote_peer_id) = seed_peer_group_with_unreachable_node(&state).await;
        let mock = MockServer::start().await;

        let mut remote_peer = state
            .app
            .peer_node_repo
            .get(remote_peer_id)
            .await
            .unwrap()
            .unwrap();
        remote_peer.status = PeerNodeStatus::Active;
        remote_peer.name = "Authoritative Remote".to_string();
        remote_peer.addresses = vec![PeerAddress {
            url: mock.uri(),
            priority: 0,
            label: "test".to_string(),
            client_reachable: false,
        }];
        state.app.peer_node_repo.upsert(&remote_peer).await.unwrap();

        let now = chrono::Utc::now().trunc_subsecs(3);
        let claimed_node = super::ActivityNode {
            id: Uuid::new_v4(),
            name: "Untrusted Claim".to_string(),
            is_self: true,
            group_id: None,
        };
        let remote_session =
            sample_session(admin_id, Uuid::new_v4(), now - chrono::Duration::minutes(1));
        let remote_session_id = remote_session.id;
        let remote_view =
            super::enrich_active(&state.app, remote_session, &claimed_node, now).await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/playback/activity/active"))
            .and(header_exists(
                playarr_peer_sync::peer_client::PEER_ID_HEADER,
            ))
            .and(header_exists(
                playarr_peer_sync::peer_client::SIGNATURE_HEADER,
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                super::PlaybackActivityActiveResponse {
                    sessions: vec![remote_view],
                    unavailable_nodes: Vec::new(),
                },
            ))
            .mount(&mock)
            .await;

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/activity/active")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: super::PlaybackActivityActiveResponse = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body.sessions.len(), 1);
        assert_eq!(body.sessions[0].session_id, remote_session_id);
        assert_eq!(body.sessions[0].peer_node_id, remote_peer_id);
        assert_eq!(body.sessions[0].peer_node_name, "Authoritative Remote");
        assert!(!body.sessions[0].peer_node_is_self);
        assert!(body.unavailable_nodes.is_empty());
    }

    #[tokio::test]
    async fn trusted_peer_stamping_precedes_global_sort_and_pagination() {
        let (_router, state) = test_state().await;
        let now = chrono::Utc::now().trunc_subsecs(3);
        let local_node = super::ActivityNode {
            id: Uuid::parse_str("00000000-0000-4000-8000-000000000003").unwrap(),
            name: "Local".to_string(),
            is_self: true,
            group_id: None,
        };
        let trusted_peer = PeerNode {
            id: Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap(),
            group_id: Uuid::new_v4(),
            name: "Trusted Remote".to_string(),
            addresses: Vec::new(),
            public_key: "test-public-key".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        };

        let oldest_session = sample_session(
            Uuid::new_v4(),
            Uuid::new_v4(),
            now - chrono::Duration::minutes(3),
        );
        let middle_session = sample_session(
            Uuid::new_v4(),
            Uuid::new_v4(),
            now - chrono::Duration::minutes(2),
        );
        let newest_session = sample_session(
            Uuid::new_v4(),
            Uuid::new_v4(),
            now - chrono::Duration::minutes(1),
        );
        let oldest = super::enrich_history(&state.app, oldest_session, &local_node, now).await;
        let mut middle = super::enrich_history(&state.app, middle_session, &local_node, now).await;
        let newest = super::enrich_history(&state.app, newest_session, &local_node, now).await;

        // A peer response's claimed origin is not trusted; the coordinator
        // overwrites it from the signed request's durable PeerNode record.
        super::stamp_history_session(&mut middle, &trusted_peer, now);
        assert_eq!(middle.peer_node_id, trusted_peer.id);
        assert_eq!(middle.peer_node_name, "Trusted Remote");
        assert!(!middle.peer_node_is_self);

        let newest_id = newest.id;
        let middle_id = middle.id;
        let (page, has_more) =
            super::paginate_history_sessions(vec![oldest, middle, newest], 2, false);
        assert_eq!(
            page.iter().map(|session| session.id).collect::<Vec<_>>(),
            vec![newest_id, middle_id]
        );
        assert!(has_more);
    }

    #[test]
    fn peer_history_snapshot_mismatch_marks_the_peer_unavailable() {
        let expected_snapshot = chrono::Utc::now().trunc_subsecs(3);
        let peer = PeerNode {
            id: Uuid::new_v4(),
            group_id: Uuid::new_v4(),
            name: "Version-skewed peer".to_string(),
            addresses: Vec::new(),
            public_key: "test-public-key".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(expected_snapshot),
            last_sync_error: None,
            joined_at: expected_snapshot,
            updated_at: expected_snapshot,
        };
        let request = super::PlaybackActivityHistoryRequest {
            to: Some(expected_snapshot),
            ..Default::default()
        };
        let response = super::PlaybackActivityHistoryResponse {
            sessions: Vec::new(),
            unavailable_nodes: Vec::new(),
            has_more: true,
            next_cursor: None,
            snapshot_to: expected_snapshot + chrono::Duration::milliseconds(1),
        };

        let unavailable = super::accept_peer_history_response(&peer, response, &request, None)
            .expect_err("a peer using another snapshot must be rejected");
        assert_eq!(unavailable.peer_node_id, peer.id);
        assert_eq!(unavailable.peer_node_name, peer.name);
        assert_eq!(
            unavailable.error,
            "history snapshot did not match the requested snapshot"
        );
    }

    #[tokio::test]
    async fn peer_history_submillisecond_started_at_marks_the_peer_unavailable() {
        let (_router, state) = test_state().await;
        let snapshot_to = chrono::Utc::now().trunc_subsecs(3);
        let peer = PeerNode {
            id: Uuid::new_v4(),
            group_id: Uuid::new_v4(),
            name: "Version-skewed peer".to_string(),
            addresses: Vec::new(),
            public_key: "test-public-key".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(snapshot_to),
            last_sync_error: None,
            joined_at: snapshot_to,
            updated_at: snapshot_to,
        };
        let claimed_node = super::ActivityNode {
            id: peer.id,
            name: peer.name.clone(),
            is_self: false,
            group_id: Some(peer.group_id),
        };
        let session = sample_session(
            Uuid::new_v4(),
            Uuid::new_v4(),
            snapshot_to - chrono::Duration::seconds(1) + chrono::Duration::microseconds(123),
        );
        let response = super::PlaybackActivityHistoryResponse {
            sessions: vec![
                super::enrich_history(&state.app, session, &claimed_node, snapshot_to).await,
            ],
            unavailable_nodes: Vec::new(),
            has_more: false,
            next_cursor: None,
            snapshot_to,
        };
        let request = super::PlaybackActivityHistoryRequest {
            to: Some(snapshot_to),
            ..Default::default()
        };

        let unavailable = super::accept_peer_history_response(&peer, response, &request, None)
            .expect_err("a sub-millisecond peer row must not poison the next cursor");
        assert_eq!(unavailable.peer_node_id, peer.id);
        assert_eq!(
            unavailable.error,
            "history row timestamp precision was invalid"
        );
    }

    #[test]
    fn history_cursor_rejects_contributor_failure_and_recovery() {
        let snapshot_to = chrono::Utc::now().trunc_subsecs(3);
        let local_id = Uuid::new_v4();
        let remote_id = Uuid::new_v4();
        let member_ids = vec![local_id, remote_id];
        let cursor = super::ActivityHistoryCursor {
            version: super::HISTORY_CURSOR_VERSION,
            snapshot_to,
            filter_fingerprint: "filters".to_string(),
            membership_fingerprint: super::contributor_fingerprint(&member_ids),
            contributor_fingerprint: super::contributor_fingerprint(&member_ids),
            after: super::ActivityHistoryKey {
                started_at: snapshot_to,
                peer_node_id: local_id,
                session_id: Uuid::new_v4(),
            },
        };

        super::validate_history_cursor_membership(Some(&cursor), &member_ids).unwrap();
        let failed = super::validate_history_cursor_contributors(Some(&cursor), &[local_id])
            .expect_err("a formerly contributing peer going unavailable must invalidate the page");
        assert_eq!(failed.status, StatusCode::CONFLICT);

        let recovered_cursor = super::ActivityHistoryCursor {
            contributor_fingerprint: super::contributor_fingerprint(&[local_id]),
            ..cursor
        };
        let recovered =
            super::validate_history_cursor_contributors(Some(&recovered_cursor), &member_ids)
                .expect_err("a formerly unavailable peer recovering must invalidate the page");
        assert_eq!(recovered.status, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn history_cursor_does_not_skip_when_an_earlier_session_completes() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let now = chrono::Utc::now().trunc_subsecs(3);
        let mut sessions = Vec::new();
        for minutes_ago in [1, 2, 3] {
            let session = sample_session(
                admin_id,
                Uuid::new_v4(),
                now - chrono::Duration::minutes(minutes_ago),
            );
            state
                .app
                .analytics_store
                .record_session_start(&session)
                .await
                .unwrap();
            sessions.push(session);
        }

        let first_request = super::PlaybackActivityHistoryRequest {
            stop_reasons: vec![super::PlaybackActivityStopReason::InProgress],
            limit: 2,
            ..Default::default()
        };
        let first = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/playback/activity/history")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&first_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(first.into_body(), usize::MAX)
            .await
            .unwrap();
        let first: super::PlaybackActivityHistoryResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            first
                .sessions
                .iter()
                .map(|session| session.id)
                .collect::<Vec<_>>(),
            vec![sessions[0].id, sessions[1].id]
        );
        assert!(first.has_more);
        let cursor = first.next_cursor.expect("first page has a continuation");

        // This row sorted before the frontier. Removing it from the
        // in-progress filter would shift an offset page and skip the oldest
        // row; the keyset frontier remains anchored on `sessions[1]`.
        sessions[0].ended_at = Some(now);
        state
            .app
            .analytics_store
            .close_session(sessions[0].id, &sessions[0], StopReason::Completed)
            .await
            .unwrap();

        let next_request = super::PlaybackActivityHistoryRequest {
            stop_reasons: vec![super::PlaybackActivityStopReason::InProgress],
            limit: 2,
            cursor: Some(cursor),
            ..Default::default()
        };
        let next = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/playback/activity/history")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&next_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(next.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(next.into_body(), usize::MAX)
            .await
            .unwrap();
        let next: super::PlaybackActivityHistoryResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            next.sessions
                .iter()
                .map(|session| session.id)
                .collect::<Vec<_>>(),
            vec![sessions[2].id]
        );
        assert!(!next.has_more);
        assert!(next.next_cursor.is_none());
    }

    #[tokio::test]
    async fn history_cursor_rejects_a_peer_join_between_pages() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let (_, remote_id) = seed_peer_group_with_unreachable_node(&state).await;
        let mut remote = state
            .app
            .peer_node_repo
            .get(remote_id)
            .await
            .unwrap()
            .unwrap();
        remote.status = PeerNodeStatus::Left;
        state.app.peer_node_repo.upsert(&remote).await.unwrap();

        let now = chrono::Utc::now().trunc_subsecs(3);
        for minutes_ago in [1, 2] {
            let session = sample_session(
                admin_id,
                Uuid::new_v4(),
                now - chrono::Duration::minutes(minutes_ago),
            );
            state
                .app
                .analytics_store
                .record_session_start(&session)
                .await
                .unwrap();
        }
        let first_request = super::PlaybackActivityHistoryRequest {
            limit: 1,
            ..Default::default()
        };
        let first = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/playback/activity/history")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&first_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(first.into_body(), usize::MAX)
            .await
            .unwrap();
        let first: super::PlaybackActivityHistoryResponse = serde_json::from_slice(&bytes).unwrap();
        let cursor = first.next_cursor.expect("first page has a continuation");

        remote.status = PeerNodeStatus::Unreachable;
        state.app.peer_node_repo.upsert(&remote).await.unwrap();
        let next_request = super::PlaybackActivityHistoryRequest {
            limit: 1,
            cursor: Some(cursor),
            ..Default::default()
        };
        let next = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/playback/activity/history")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&next_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(next.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn history_cursor_rejects_a_peer_leave_between_pages() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let (_, remote_id) = seed_peer_group_with_unreachable_node(&state).await;
        let now = chrono::Utc::now().trunc_subsecs(3);
        for minutes_ago in [1, 2] {
            let session = sample_session(
                admin_id,
                Uuid::new_v4(),
                now - chrono::Duration::minutes(minutes_ago),
            );
            state
                .app
                .analytics_store
                .record_session_start(&session)
                .await
                .unwrap();
        }

        let first_request = super::PlaybackActivityHistoryRequest {
            limit: 1,
            ..Default::default()
        };
        let first = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/playback/activity/history")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&first_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(first.into_body(), usize::MAX)
            .await
            .unwrap();
        let first: super::PlaybackActivityHistoryResponse = serde_json::from_slice(&bytes).unwrap();
        let cursor = first.next_cursor.expect("first page has a continuation");

        let mut remote = state
            .app
            .peer_node_repo
            .get(remote_id)
            .await
            .unwrap()
            .unwrap();
        remote.status = PeerNodeStatus::Left;
        state.app.peer_node_repo.upsert(&remote).await.unwrap();
        let next_request = super::PlaybackActivityHistoryRequest {
            limit: 1,
            cursor: Some(cursor),
            ..Default::default()
        };
        let next = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/playback/activity/history")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&next_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(next.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn group_activity_history_applies_enriched_and_numeric_filters() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        state
            .app
            .system_settings_repo
            .upsert(&SystemSettings {
                instance_name: "Living Room".to_string(),
            })
            .await
            .unwrap();
        let identity = crate::admin_peer::ensure_node_identity(&state.app.node_identity_repo)
            .await
            .unwrap();

        let source_id = Uuid::new_v4();
        let group_library_id = Uuid::new_v4();
        let source = SourceInstance {
            id: source_id,
            kind: SourceKind::Radarr,
            name: "Movies".to_string(),
            base_url: "https://radarr.example.test".to_string(),
            api_key_encrypted: Sensitive::new("test-placeholder".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: Some(group_library_id),
        };
        // Deliberately persist without hydrating SourceInstanceRegistry. This
        // models the short interval after peer sync but before the worker's
        // cache refresh and proves activity still resolves the portable
        // group-library filter through the durable fallback.
        state
            .app
            .source_instance_repo
            .upsert(&source)
            .await
            .unwrap();
        let work_id = crate::test_support::seed_movie(&state, "Needle in the Haystack").await;
        let media_file_id =
            crate::test_support::seed_media_file(&state, work_id, LeafRef::Work, source_id).await;
        let media_file = state
            .media_file_repo
            .get_by_id(media_file_id)
            .await
            .unwrap();
        state.media_files.insert(media_file);

        let started_at = (chrono::Utc::now() - chrono::Duration::minutes(2)).trunc_subsecs(3);
        let mut session = sample_session(admin_id, media_file_id, started_at);
        session.ended_at = Some(started_at + chrono::Duration::minutes(1));
        session.play_method = PlayMethod::Transcode;
        session.bytes_streamed = 4_096;
        session.stop_reason = Some(StopReason::Other("admin_stopped".to_string()));
        state
            .app
            .analytics_store
            .record_session_start(&session)
            .await
            .unwrap();

        let request = super::PlaybackActivityHistoryRequest {
            user_ids: vec![admin_id],
            play_methods: vec![PlayMethod::Transcode],
            title_terms: vec!["  NEEDLE  ".to_string()],
            library_ids: vec![group_library_id],
            peer_node_ids: vec![identity.peer_id],
            stop_reasons: vec![super::PlaybackActivityStopReason::Other],
            from: Some(started_at),
            to: Some(started_at),
            min_duration_ms: Some(60_000),
            max_duration_ms: Some(60_000),
            min_bytes_streamed: Some(4_096),
            max_bytes_streamed: Some(4_096),
            limit: 10,
            cursor: None,
            offset: 0,
        };
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/playback/activity/history")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: super::PlaybackActivityHistoryResponse = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body.sessions.len(), 1);
        let row = &body.sessions[0];
        assert_eq!(row.id, session.id);
        assert_eq!(row.media_title.as_deref(), Some("Needle in the Haystack"));
        assert_eq!(row.source_instance_id, Some(source_id));
        assert_eq!(row.source_instance_name.as_deref(), Some("Movies"));
        assert_eq!(row.library_id, Some(group_library_id));
        assert_eq!(row.library_name.as_deref(), Some("Movies"));
        assert_eq!(row.duration_ms, 60_000);
        assert_eq!(row.peer_node_id, identity.peer_id);
        assert_eq!(row.peer_node_name, "Living Room");
        assert!(row.peer_node_is_self);
        assert!(!body.has_more);
        assert!(body.unavailable_nodes.is_empty());
        assert_eq!(body.snapshot_to, started_at);
    }

    #[tokio::test]
    async fn group_activity_history_returns_snapshot_for_an_empty_selected_server() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let snapshot_to = chrono::DateTime::parse_from_rfc3339("2026-07-29T12:34:56.789Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let request = super::PlaybackActivityHistoryRequest {
            peer_node_ids: vec![Uuid::new_v4()],
            to: Some(snapshot_to),
            ..Default::default()
        };

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/playback/activity/history")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: super::PlaybackActivityHistoryResponse = serde_json::from_slice(&bytes).unwrap();

        assert!(body.sessions.is_empty());
        assert!(!body.has_more);
        assert!(body.unavailable_nodes.is_empty());
        assert_eq!(body.snapshot_to, snapshot_to);
    }

    #[tokio::test]
    async fn group_activity_history_scans_past_a_full_non_matching_storage_batch() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let source_id = Uuid::new_v4();
        let work_id = crate::test_support::seed_movie(&state, "Late Matching Title").await;
        let media_file_id =
            crate::test_support::seed_media_file(&state, work_id, LeafRef::Work, source_id).await;
        let media_file = state
            .media_file_repo
            .get_by_id(media_file_id)
            .await
            .unwrap();
        state.media_files.insert(media_file);

        let now = chrono::Utc::now().trunc_subsecs(3);
        for index in 0..super::HISTORY_SCAN_BATCH_SIZE {
            let session = sample_session(
                admin_id,
                Uuid::new_v4(),
                now - chrono::Duration::seconds(index),
            );
            state
                .app
                .analytics_store
                .record_session_start(&session)
                .await
                .unwrap();
        }
        let matching = sample_session(
            admin_id,
            media_file_id,
            now - chrono::Duration::seconds(super::HISTORY_SCAN_BATCH_SIZE + 1),
        );
        state
            .app
            .analytics_store
            .record_session_start(&matching)
            .await
            .unwrap();

        let request = super::PlaybackActivityHistoryRequest {
            title_terms: vec!["matching title".to_string()],
            limit: 1,
            ..Default::default()
        };
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/playback/activity/history")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: super::PlaybackActivityHistoryResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            body.sessions
                .iter()
                .map(|session| session.id)
                .collect::<Vec<_>>(),
            vec![matching.id]
        );
    }

    #[tokio::test]
    async fn peer_activity_routes_reject_unsigned_requests() {
        let (router, _state) = test_state().await;

        let active = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/peer/playback/activity/active")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(active.status(), StatusCode::UNAUTHORIZED);

        let history = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/peer/playback/activity/history")
                    .header("Content-Type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(history.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn stop_session_requires_admin() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/admin/playback/sessions/{}/stop",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn stopping_an_unknown_session_is_still_a_no_op_success() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/admin/playback/sessions/{}/stop",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn stop_session_removes_it_from_the_live_registry_and_finalizes_history() {
        use playarr_model::{ClientPlatform, PlayMethod, PlaybackSession};

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let session = PlaybackSession {
            id: Uuid::new_v4(),
            user_id: admin_id,
            device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            rendition_id: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
            play_method: PlayMethod::Transcode,
            transcode_reason: None,
            source_codec: "h265".to_string(),
            source_container: "mkv".to_string(),
            source_bitrate: Some(20_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(4_000_000),
            client_platform: ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 5_000,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        };
        let session_id = session.id;
        state.app.session_registry.insert(session.clone());
        state
            .app
            .analytics_store
            .record_session_start(&session)
            .await
            .unwrap();

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/admin/playback/sessions/{session_id}/stop"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // Gone from the live registry -- a second "active sessions" list
        // must not still show it.
        assert!(state.app.session_registry.get(session_id).is_none());

        // Finalized in durable history with the admin-stop reason, not left
        // as a permanently-open row.
        let history = state
            .app
            .analytics_store
            .list_sessions(&playarr_db::analytics::SessionFilter {
                user_ids: vec![admin_id],
                limit: 10,
                ..Default::default()
            })
            .await
            .unwrap();
        let stopped = history
            .iter()
            .find(|s| s.id == session_id)
            .expect("stopped session should still be in history");
        assert!(stopped.ended_at.is_some());
        assert_eq!(
            stopped.stop_reason,
            Some(playarr_model::StopReason::Other(
                "admin_stopped".to_string()
            ))
        );
    }
}
