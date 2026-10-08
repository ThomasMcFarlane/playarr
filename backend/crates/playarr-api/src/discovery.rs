//! Unified discovery search, per-profile watchlist and source-aware title
//! actions -- see `docs/architecture/discovery-watchlist.md`.
//!
//! Routes (all [`CatalogViewer`]-gated):
//! - `GET /api/v1/discover` -- merged, source-attributed search results plus a
//!   status per provider; a failing provider never fails the search.
//! - `POST /api/v1/discover/resolve` -- re-resolve one title snapshot for the
//!   caller: current library match, `actions[]` and watchlist membership.
//! - `GET/POST /api/v1/watchlist`, `DELETE /api/v1/watchlist/{title_key}`.
//!
//! Library results are filtered through the caller's allowed libraries, so a
//! restricted title never appears (its existence is not leaked).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Datelike, Utc};
use playarr_arr_client::{LookupTitle, RadarrClient, SonarrClient};
use playarr_catalog::WorkChildren;
use playarr_model::discovery::{
    compute_actions, identity_key, merge_candidates, ActionContext, DiscoveryCandidate,
    DiscoveryKind, DiscoveryScope, DiscoveryTitle, ProviderState, ProviderStatus,
    SourceAvailability, SourceKindTag, TitleAction, TitleSnapshot, TitleSource, WatchlistItem,
};
use playarr_model::{
    Availability, ExternalProvider, ExternalRef, SourceInstance, SourceKind, WatchState, Work,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use playarr_model::requests::{IntegrationKind, RequestBackend};

use crate::auth_extractor::CatalogViewer;
use crate::error::ApiError;
use crate::source_cache::{Fetched, SwrCache};
use crate::AppState;

const MAX_QUERY_LEN: usize = 200;

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct DiscoverQueryParams {
    pub q: String,
    /// `media` (default), `games` or `all`.
    pub scope: Option<DiscoveryScope>,
    /// Restrict to one kind.
    pub kind: Option<DiscoveryKind>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DiscoverResponse {
    pub titles: Vec<DiscoverTitle>,
    pub providers: Vec<ProviderStatus>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DiscoverTitle {
    #[serde(flatten)]
    pub title: DiscoveryTitle,
    pub in_watchlist: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ResolvedTitle {
    pub title: DiscoveryTitle,
    pub in_watchlist: bool,
    pub actions: Vec<TitleAction>,
    /// An existing request for this title ("Requested by X - status"), from
    /// Playarr, Ombi or Seerr. The requester's name is only included for
    /// administrators and the requester themself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<RequestOverlay>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RequestOverlay {
    pub request_id: uuid::Uuid,
    pub status: playarr_model::requests::RequestStatus,
    pub origin: playarr_model::requests::RequestOrigin,
    pub requested_by: Option<String>,
    pub mine: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct WatchlistEntry {
    #[serde(flatten)]
    pub resolved: ResolvedTitle,
    pub added_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct WatchlistResponse {
    pub items: Vec<WatchlistEntry>,
}

fn year_of(work: &Work) -> Option<i32> {
    work.release_date.map(|d| d.year())
}

fn library_candidate(work: &Work) -> DiscoveryCandidate {
    let (availability, reason) = match work.availability {
        Availability::Available | Availability::PartiallyAvailable => {
            (SourceAvailability::Available, None)
        }
        Availability::Processing => (
            SourceAvailability::Upcoming,
            Some("Downloading or importing".to_string()),
        ),
        Availability::Pending => (
            SourceAvailability::Upcoming,
            Some("Monitored, not downloaded yet".to_string()),
        ),
        Availability::Deleted => (
            SourceAvailability::Unavailable,
            Some("Removed from the library".to_string()),
        ),
        Availability::Unknown => (SourceAvailability::Unavailable, None),
    };
    DiscoveryCandidate {
        kind: work.kind.into(),
        title: work.title.clone(),
        year: year_of(work),
        external_refs: work.external_refs.clone(),
        poster_url: work
            .images
            .iter()
            .find(|i| i.kind == playarr_model::ImageKind::Poster)
            .map(|i| i.url.clone()),
        overview: work.overview.clone(),
        source: TitleSource {
            source: SourceKindTag::Library,
            label: "Library".into(),
            availability,
            reason,
            edition: None,
            work_id: Some(work.id),
            provider_instance_id: None,
        },
    }
}

/// Providers that are not built yet report an explicit unavailable status.
fn stub_provider_statuses() -> Vec<ProviderStatus> {
    vec![
        ProviderStatus {
            provider: SourceKindTag::LiveTv,
            state: ProviderState::Unavailable,
            reason: Some("Live TV guide is not available yet (tasks 27-28)".into()),
        },
        ProviderStatus {
            provider: SourceKindTag::Game,
            state: ProviderState::Unavailable,
            reason: Some("Games catalogue is not available yet (task 22)".into()),
        },
    ]
}

const REQUEST_LOOKUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
/// How long a search waits for a request catalogue that has not answered this
/// term before. The lookup carries on in the background and the next search of
/// the term is served from the cache.
const SEARCH_LOOKUP_DEADLINE: std::time::Duration = std::time::Duration::from_millis(2500);

/// Search lookups per request instance and term: fresh for ten minutes, served
/// stale (and refreshed in the background) for a day.
static SEARCH_LOOKUPS: SwrCache<(Uuid, String), Vec<LookupTitle>> = SwrCache::new(
    std::time::Duration::from_secs(10 * 60),
    std::time::Duration::from_secs(24 * 60 * 60),
    512,
);

/// Cached lookup for the search path. Never reports a source failure.
async fn cached_search_lookup(instance: &SourceInstance, term: &str) -> Option<Vec<LookupTitle>> {
    let key = (instance.id, term.trim().to_lowercase());
    let instance = instance.clone();
    let term = term.to_string();
    SEARCH_LOOKUPS
        .get(key, SEARCH_LOOKUP_DEADLINE, move || async move {
            let Some(client) = RequestLookup::for_instance(&instance) else {
                return Fetched::Failed;
            };
            match tokio::time::timeout(REQUEST_LOOKUP_TIMEOUT, client.lookup(&term)).await {
                Ok(Ok(hits)) => Fetched::Ok(hits),
                Ok(Err(err)) => {
                    tracing::warn!(instance = %instance.name, %err, "discovery: search lookup failed");
                    Fetched::Failed
                }
                Err(_) => {
                    tracing::warn!(instance = %instance.name, "discovery: search lookup timed out");
                    Fetched::Failed
                }
            }
        })
        .await
}
const NO_REQUEST_PROVIDER: &str = "No request provider is configured";

/// Radarr (movies) and Sonarr (series) instances, lowest priority value first.
fn request_instances(state: &AppState, kind: DiscoveryKind) -> Vec<SourceInstance> {
    let wanted = match kind {
        DiscoveryKind::Movie => SourceKind::Radarr,
        DiscoveryKind::Series => SourceKind::Sonarr,
        _ => return Vec::new(),
    };
    let mut found: Vec<_> = state
        .source_instances
        .all()
        .into_iter()
        .filter(|i| i.kind == wanted)
        .collect();
    found.sort_by_key(|i| i.priority);
    found
}

fn can_request(state: &AppState, viewer: &CatalogViewer) -> bool {
    viewer.policy.is_admin || viewer.policy.can_request || state.discovery_requests_allow_all_users
}

enum RequestLookup {
    Radarr(RadarrClient),
    Sonarr(SonarrClient),
}

impl RequestLookup {
    fn for_instance(instance: &SourceInstance) -> Option<Self> {
        let key = instance.api_key_encrypted.expose_secret().to_string();
        match instance.kind {
            SourceKind::Radarr => Some(Self::Radarr(RadarrClient::new(&instance.base_url, key))),
            SourceKind::Sonarr => Some(Self::Sonarr(SonarrClient::new(&instance.base_url, key))),
            _ => None,
        }
    }

    async fn lookup(
        &self,
        term: &str,
    ) -> Result<Vec<LookupTitle>, playarr_arr_client::ArrClientError> {
        match self {
            Self::Radarr(c) => c.lookup_movie(term).await,
            Self::Sonarr(c) => c.lookup_series(term).await,
        }
    }

    async fn add(
        &self,
        hit: &LookupTitle,
        root: &str,
        profile: i64,
    ) -> Result<serde_json::Value, playarr_arr_client::ArrClientError> {
        match self {
            Self::Radarr(c) => c.add_movie(hit, root, profile).await,
            Self::Sonarr(c) => c.add_series(hit, root, profile).await,
        }
    }
}

fn lookup_candidate(
    instance: &SourceInstance,
    kind: DiscoveryKind,
    hit: &LookupTitle,
) -> DiscoveryCandidate {
    let mut refs = Vec::new();
    let mut push = |provider, id: String| {
        refs.push(ExternalRef {
            provider,
            external_id: id,
        })
    };
    if let Some(id) = hit.tmdb_id {
        push(ExternalProvider::Tmdb, id.to_string());
    }
    if let Some(id) = hit.tvdb_id {
        push(ExternalProvider::Tvdb, id.to_string());
    }
    if let Some(id) = &hit.imdb_id {
        push(ExternalProvider::Imdb, id.clone());
    }
    let (availability, reason) = if hit.arr_id.is_some() {
        (
            SourceAvailability::Upcoming,
            Some("Already requested".to_string()),
        )
    } else {
        (SourceAvailability::Requestable, None)
    };
    DiscoveryCandidate {
        kind,
        title: hit.title.clone(),
        year: hit.year,
        external_refs: refs,
        poster_url: hit.poster_url.clone(),
        overview: hit.overview.clone(),
        source: TitleSource {
            source: SourceKindTag::Request,
            label: instance.name.clone(),
            availability,
            reason,
            edition: None,
            work_id: None,
            provider_instance_id: Some(instance.id),
        },
    }
}

/// Searches every request catalogue that applies to the requested kinds.
async fn request_provider_search(
    state: &AppState,
    q: &str,
    kind_filter: Option<DiscoveryKind>,
    may_request: bool,
) -> (Vec<DiscoveryCandidate>, ProviderStatus) {
    let mut instances = Vec::new();
    for kind in [DiscoveryKind::Movie, DiscoveryKind::Series] {
        if kind_filter.is_none_or(|k| k == kind) {
            // One instance per kind answers: the highest-priority one.
            if let Some(first) = request_instances(state, kind).into_iter().next() {
                instances.push((kind, first));
            }
        }
    }
    if instances.is_empty() {
        return (
            Vec::new(),
            ProviderStatus {
                provider: SourceKindTag::Request,
                state: ProviderState::Unavailable,
                reason: Some(NO_REQUEST_PROVIDER.into()),
            },
        );
    }
    let lookups = instances.iter().map(|(kind, instance)| async move {
        (instance, *kind, cached_search_lookup(instance, q).await)
    });
    let mut candidates = Vec::new();
    for (instance, kind, hits) in futures::future::join_all(lookups).await {
        // Not answered yet or the source is down: users never see a source
        // error. The lookup finishes in the background; health is admin-only.
        if let Some(hits) = hits {
            candidates.extend(hits.iter().map(|h| {
                let mut candidate = lookup_candidate(instance, kind, h);
                // Clients show a Request action only for `requestable`
                // sources, so a viewer without the grant must not get one.
                if !may_request && candidate.source.availability == SourceAvailability::Requestable
                {
                    candidate.source.availability = SourceAvailability::Unavailable;
                    candidate.source.reason =
                        Some("Your account is not allowed to request titles".into());
                }
                candidate
            }))
        }
    }
    let status = ProviderStatus {
        provider: SourceKindTag::Request,
        state: ProviderState::Ok,
        reason: None,
    };
    (candidates, status)
}

#[utoipa::path(
    get,
    path = "/api/v1/discover",
    tag = "discovery",
    params(DiscoverQueryParams),
    responses(
        (status = 200, description = "Merged, source-attributed titles plus provider status", body = DiscoverResponse),
        (status = 400, description = "Query too long"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn discover_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(params): Query<DiscoverQueryParams>,
) -> Result<Json<DiscoverResponse>, ApiError> {
    let q = params.q.trim();
    if q.chars().count() > MAX_QUERY_LEN {
        return Err(ApiError::bad_request("query is too long"));
    }
    let scope = params.scope.unwrap_or_default();
    let mut providers = Vec::new();
    let mut candidates: Vec<DiscoveryCandidate> = Vec::new();

    if q.is_empty() {
        providers.push(ProviderStatus {
            provider: SourceKindTag::Library,
            state: ProviderState::Ok,
            reason: None,
        });
        providers.push(ProviderStatus {
            provider: SourceKindTag::Request,
            state: if request_instances(&state, DiscoveryKind::Movie).is_empty()
                && request_instances(&state, DiscoveryKind::Series).is_empty()
            {
                ProviderState::Unavailable
            } else {
                ProviderState::Ok
            },
            reason: None,
        });
        providers.extend(stub_provider_statuses());
        return Ok(Json(DiscoverResponse {
            titles: vec![],
            providers,
        }));
    }

    if scope != DiscoveryScope::Games {
        let allowed = viewer.allowed_libraries();
        let gate = state
            .household
            .gate_for(&viewer.policy, viewer.user_id)
            .await;
        let limit = params.limit.unwrap_or(25).clamp(1, 100);
        match state
            .catalog
            .search_with(
                q,
                limit,
                crate::household::access(allowed.as_deref(), gate.as_deref()),
            )
            .await
        {
            Ok(works) => {
                candidates.extend(works.iter().map(library_candidate));
                providers.push(ProviderStatus {
                    provider: SourceKindTag::Library,
                    state: ProviderState::Ok,
                    reason: None,
                });
            }
            Err(err) => {
                tracing::warn!(%err, "discovery: library search failed");
                providers.push(ProviderStatus {
                    provider: SourceKindTag::Library,
                    state: ProviderState::Unavailable,
                    reason: Some("Library search failed".into()),
                });
            }
        }
        match state
            .catalog
            .search_remote_only(q, &viewer.policy.group_library_allow)
            .await
        {
            Ok(remote) => {
                for r in remote {
                    let kind: DiscoveryKind = r.kind.into();
                    let year = r
                        .release_date
                        .as_deref()
                        .and_then(|d| d.get(..4))
                        .and_then(|y| y.parse().ok());
                    let label = r
                        .available_on
                        .first()
                        .map(|b| b.peer_name.clone())
                        .unwrap_or_else(|| "Peer".into());
                    candidates.push(DiscoveryCandidate {
                        kind,
                        title: r.title,
                        year,
                        external_refs: vec![ExternalRef {
                            provider: r.provider,
                            external_id: r.external_id,
                        }],
                        poster_url: None,
                        overview: None,
                        source: TitleSource {
                            source: SourceKindTag::Peer,
                            label,
                            availability: SourceAvailability::Available,
                            reason: Some("Available from a peer server".into()),
                            edition: None,
                            work_id: None,
                            provider_instance_id: None,
                        },
                    });
                }
            }
            Err(err) => {
                tracing::warn!(%err, "discovery: peer search failed");
                providers.push(ProviderStatus {
                    provider: SourceKindTag::Peer,
                    state: ProviderState::Unavailable,
                    reason: Some("Peer search failed".into()),
                });
            }
        }
    }
    if scope != DiscoveryScope::Games {
        let (found, status) =
            request_provider_search(&state, q, params.kind, can_request(&state, &viewer)).await;
        candidates.extend(found);
        providers.push(status);
    }
    providers.extend(stub_provider_statuses());

    let watch: Vec<String> = state
        .watchlist_repo
        .list(viewer.user_id)
        .await?
        .into_iter()
        .map(|i| i.title_key)
        .collect();
    let titles = merge_candidates(
        candidates
            .into_iter()
            .filter(|c| scope.includes(c.kind) && params.kind.is_none_or(|k| k == c.kind))
            .collect(),
    )
    .into_iter()
    .map(|mut title| {
        // A title already playable from the library is not requestable.
        if title.sources.iter().any(|s| {
            s.source == SourceKindTag::Library && s.availability == SourceAvailability::Available
        }) {
            title.sources.retain(|s| s.source != SourceKindTag::Request);
        }
        title
    })
    .map(|title| DiscoverTitle {
        in_watchlist: watch.contains(&title.title_key),
        title,
    })
    .collect();
    Ok(Json(DiscoverResponse { titles, providers }))
}

/// The library work (visible to the caller) matching a snapshot, by id first
/// and then by any external ref.
/// Per-request memo for resolving many snapshots for one viewer (the
/// calendar resolves hundreds): the viewer's household gate, the request
/// backend and the viewer's watch progress do not change within a request, so
/// they are read once instead of once per title.
#[derive(Default)]
pub(crate) struct ResolveMemo {
    gate: tokio::sync::OnceCell<Option<std::sync::Arc<crate::household::HouseholdGate>>>,
    backend: tokio::sync::OnceCell<RequestBackend>,
    progress: tokio::sync::OnceCell<Vec<playarr_model::WatchProgress>>,
    /// Work details read this request. The viewer's access does not change
    /// within a request, so a title's detail is loaded (and its cached JSON
    /// decoded) once however many steps need it.
    details: tokio::sync::Mutex<
        std::collections::HashMap<Uuid, Option<std::sync::Arc<playarr_catalog::WorkDetail>>>,
    >,
}

impl ResolveMemo {
    async fn gate(
        &self,
        state: &AppState,
        viewer: &CatalogViewer,
    ) -> Option<std::sync::Arc<crate::household::HouseholdGate>> {
        self.gate
            .get_or_init(|| async {
                state
                    .household
                    .gate_for(&viewer.policy, viewer.user_id)
                    .await
            })
            .await
            .clone()
    }

    pub(crate) async fn detail(
        &self,
        state: &AppState,
        viewer: &CatalogViewer,
        id: Uuid,
    ) -> Option<std::sync::Arc<playarr_catalog::WorkDetail>> {
        if let Some(found) = self.details.lock().await.get(&id) {
            return found.clone();
        }
        let allowed = viewer.allowed_libraries();
        let gate = self.gate(state, viewer).await;
        let loaded = state
            .catalog
            .get_by_id_with(
                id,
                crate::household::access(allowed.as_deref(), gate.as_deref()),
            )
            .await
            .ok()
            .map(std::sync::Arc::new);
        self.details.lock().await.insert(id, loaded.clone());
        loaded
    }

    async fn backend(&self, state: &AppState) -> RequestBackend {
        *self
            .backend
            .get_or_init(|| async { state.request_sync.backend().await })
            .await
    }

    async fn progress(
        &self,
        state: &AppState,
        viewer: &CatalogViewer,
    ) -> Result<&Vec<playarr_model::WatchProgress>, ApiError> {
        self.progress
            .get_or_try_init(|| async {
                Ok(state.watch_progress.list_for_user(viewer.user_id).await?)
            })
            .await
    }
}

async fn find_library_work(
    state: &AppState,
    viewer: &CatalogViewer,
    snap: &TitleSnapshot,
    memo: &ResolveMemo,
) -> Result<Option<Work>, ApiError> {
    let mut ids: Vec<Uuid> = snap.work_id.into_iter().collect();
    for r in &snap.external_refs {
        if let Ok(Some(work)) = state
            .work_repo
            .find_by_external_ref(&r.provider, &r.external_id)
            .await
        {
            if DiscoveryKind::from(work.kind) == snap.kind && !ids.contains(&work.id) {
                ids.push(work.id);
            }
        }
    }
    for id in ids {
        if let Some(detail) = memo.detail(state, viewer, id).await {
            return Ok(Some(detail.work.clone()));
        }
    }
    Ok(None)
}

fn ref_id(snap: &TitleSnapshot, p: ExternalProvider) -> Option<String> {
    snap.external_refs
        .iter()
        .find(|r| r.provider == p)
        .map(|r| r.external_id.clone())
}

async fn request_overlay(
    state: &AppState,
    viewer: &CatalogViewer,
    snap: &TitleSnapshot,
) -> Option<RequestOverlay> {
    let num = |p| ref_id(snap, p).and_then(|v| v.parse::<i64>().ok());
    let row = state
        .request_sync
        .requests
        .find_match(
            snap.kind,
            num(ExternalProvider::Tmdb),
            num(ExternalProvider::Tvdb),
            ref_id(snap, ExternalProvider::Imdb).as_deref(),
        )
        .await
        .ok()
        .flatten()?;
    let mine = row.requester_user_id == Some(viewer.user_id);
    Some(RequestOverlay {
        request_id: row.id,
        status: row.status,
        origin: row.origin,
        requested_by: if viewer.policy.is_admin || mine {
            row.requester_label
        } else {
            None
        },
        mine,
    })
}

/// The request provider a viewer's request goes to: the Ombi/Seerr
/// integration when the backend mode selects one, else the first Radarr/Sonarr.
async fn request_provider(
    state: &AppState,
    kind: DiscoveryKind,
    memo: &ResolveMemo,
) -> Option<(Uuid, String)> {
    use playarr_model::requests::IntegrationKind;
    let wanted = match memo.backend(state).await {
        RequestBackend::Ombi => Some(IntegrationKind::Ombi),
        RequestBackend::Seerr => Some(IntegrationKind::Seerr),
        _ => None,
    };
    if let Some(k) = wanted {
        return state
            .request_sync
            .enabled_integration(k)
            .await
            .map(|i| (i.id, i.name));
    }
    request_instances(state, kind)
        .into_iter()
        .find(|i| i.default_root_folder_id.is_some() && i.default_quality_profile_id.is_some())
        .map(|i| (i.id, i.name))
}

async fn build_action_context(
    state: &AppState,
    viewer: &CatalogViewer,
    snap: &TitleSnapshot,
    work: Option<&Work>,
    memo: &ResolveMemo,
) -> Result<ActionContext, ApiError> {
    let mut ctx = ActionContext {
        kind: Some(snap.kind),
        can_request: can_request(state, viewer),
        request_instance_id: request_provider(state, snap.kind, memo)
            .await
            .map(|(id, _)| id),
        request_unavailable_reason: Some(NO_REQUEST_PROVIDER.into()),
        ..Default::default()
    };
    if ctx.request_instance_id.is_none()
        && !request_instances(state, snap.kind).is_empty()
        && memo.backend(state).await == playarr_model::requests::RequestBackend::Direct
    {
        ctx.request_unavailable_reason =
            Some("The request provider has no default root folder or quality profile".into());
    }
    let Some(work) = work else {
        return Ok(ctx);
    };
    ctx.library_work_id = Some(work.id);
    let detail = memo.detail(state, viewer, work.id).await;
    let progress = memo.progress(state, viewer).await?;
    let for_work: Vec<_> = progress.iter().filter(|p| p.work_id == work.id).collect();
    // list_for_user is newest first.
    ctx.resume = for_work
        .iter()
        .find(|p| p.state == WatchState::PartWatched)
        .map(|p| (p.media_file_id, p.position_ms));
    let watched = |file: Uuid| {
        for_work
            .iter()
            .any(|p| p.media_file_id == file && p.state == WatchState::Watched)
    };
    ctx.playable_media_file_id = match detail.as_ref().map(|d| (&d.children, d.media_file_id)) {
        Some((WorkChildren::Movie, file)) => file,
        Some((WorkChildren::Series(seasons), _)) => {
            let files: Vec<Uuid> = seasons
                .iter()
                .flat_map(|s| s.episodes.iter().filter_map(|e| e.media_file_id))
                .collect();
            files
                .iter()
                .copied()
                .find(|f| !watched(*f))
                .or_else(|| files.first().copied())
        }
        _ => None,
    };
    Ok(ctx)
}

pub(crate) async fn resolve_snapshot(
    state: &AppState,
    viewer: &CatalogViewer,
    snap: &TitleSnapshot,
) -> Result<ResolvedTitle, ApiError> {
    resolve_snapshot_with(state, viewer, snap, &ResolveMemo::default()).await
}

/// [`resolve_snapshot`] sharing a [`ResolveMemo`] across many titles.
pub(crate) async fn resolve_snapshot_with(
    state: &AppState,
    viewer: &CatalogViewer,
    snap: &TitleSnapshot,
    memo: &ResolveMemo,
) -> Result<ResolvedTitle, ApiError> {
    let work = find_library_work(state, viewer, snap, memo).await?;
    let mut candidates = Vec::new();
    // The snapshot itself is the carrier of identity when nothing else is
    // known, so a title that is not in any library still resolves.
    let request_instance = request_provider(state, snap.kind, memo).await;
    candidates.push(DiscoveryCandidate {
        kind: snap.kind,
        title: snap.title.clone(),
        year: snap.year,
        external_refs: snap.external_refs.clone(),
        poster_url: snap.poster_url.clone(),
        overview: None,
        source: TitleSource {
            source: SourceKindTag::Request,
            label: request_instance
                .as_ref()
                .map(|i| i.1.clone())
                .unwrap_or_else(|| "Not in your library".into()),
            availability: if request_instance.is_some() {
                SourceAvailability::Requestable
            } else {
                SourceAvailability::Unavailable
            },
            reason: request_instance
                .is_none()
                .then(|| NO_REQUEST_PROVIDER.to_string()),
            edition: None,
            work_id: None,
            provider_instance_id: request_instance.map(|i| i.0),
        },
    });
    if let Some(w) = &work {
        candidates.push(library_candidate(w));
        // A title in the library is not "not in your library".
        candidates.remove(0);
        candidates[0].external_refs = {
            let mut refs = w.external_refs.clone();
            for r in &snap.external_refs {
                if !refs.contains(r) {
                    refs.push(r.clone());
                }
            }
            refs
        };
    }
    let mut merged = merge_candidates(candidates);
    let title = merged.remove(0);
    let ctx = build_action_context(state, viewer, snap, work.as_ref(), memo).await?;
    let mut actions = compute_actions(&ctx);
    let in_watchlist = {
        let mut keys = vec![
            title.title_key.clone(),
            identity_key(snap.kind, &snap.title, snap.year, &snap.external_refs),
        ];
        keys.dedup();
        let mut found = false;
        for k in keys {
            if state
                .watchlist_repo
                .get(viewer.user_id, &k)
                .await?
                .is_some()
            {
                found = true;
                break;
            }
        }
        found
    };
    let request = request_overlay(state, viewer, snap).await;
    if let Some(r) = &request {
        if r.status != playarr_model::requests::RequestStatus::Declined
            && r.status != playarr_model::requests::RequestStatus::Failed
        {
            for a in actions
                .iter_mut()
                .filter(|a| a.action == playarr_model::discovery::ActionKind::Request)
            {
                a.enabled = false;
                a.reason = Some(match (&r.requested_by, r.mine) {
                    (_, true) => format!("You requested this - {}", r.status.as_str()),
                    (Some(by), _) => format!("Requested by {by} - {}", r.status.as_str()),
                    _ => format!("Already requested - {}", r.status.as_str()),
                });
            }
        }
    }
    Ok(ResolvedTitle {
        title,
        in_watchlist,
        actions,
        request,
    })
}

#[utoipa::path(
    post,
    path = "/api/v1/discover/resolve",
    tag = "discovery",
    request_body = TitleSnapshot,
    responses(
        (status = 200, description = "Title resolved for the caller with source-aware actions", body = ResolvedTitle),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn resolve_title_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Json(snap): Json<TitleSnapshot>,
) -> Result<Json<ResolvedTitle>, ApiError> {
    Ok(Json(resolve_snapshot(&state, &viewer, &snap).await?))
}

#[utoipa::path(
    get,
    path = "/api/v1/watchlist",
    tag = "discovery",
    responses(
        (status = 200, description = "The caller's watchlist, newest first, with current actions", body = WatchlistResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn list_watchlist_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<Json<WatchlistResponse>, ApiError> {
    let rows = state.watchlist_repo.list(viewer.user_id).await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let snap = TitleSnapshot {
            kind: row.kind,
            title: row.title.clone(),
            year: row.year,
            work_id: row.work_id,
            external_refs: row.external_refs.clone(),
            poster_url: row.poster_url.clone(),
        };
        let mut resolved = resolve_snapshot(&state, &viewer, &snap).await?;
        // Keep the stored key so clients can remove exactly what they added.
        resolved.title.title_key = row.title_key.clone();
        resolved.in_watchlist = true;
        items.push(WatchlistEntry {
            resolved,
            added_at: row.added_at,
        });
    }
    Ok(Json(WatchlistResponse { items }))
}

#[utoipa::path(
    post,
    path = "/api/v1/watchlist",
    tag = "discovery",
    request_body = TitleSnapshot,
    responses(
        (status = 200, description = "Added (idempotent)", body = ResolvedTitle),
        (status = 400, description = "Empty title"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn add_watchlist_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Json(snap): Json<TitleSnapshot>,
) -> Result<Json<ResolvedTitle>, ApiError> {
    if snap.title.trim().is_empty() {
        return Err(ApiError::bad_request("title must not be empty"));
    }
    // Only keep a work id the caller may actually see.
    let work = find_library_work(&state, &viewer, &snap, &ResolveMemo::default()).await?;
    let mut refs = snap.external_refs.clone();
    if let Some(w) = &work {
        for r in &w.external_refs {
            if !refs.contains(r) {
                refs.push(r.clone());
            }
        }
    }
    let title_key = identity_key(snap.kind, &snap.title, snap.year, &refs);
    let item = WatchlistItem {
        title_key,
        kind: snap.kind,
        title: snap.title.trim().to_string(),
        year: snap.year,
        work_id: work.as_ref().map(|w| w.id),
        external_refs: refs,
        poster_url: snap.poster_url.clone(),
        added_at: Utc::now(),
    };
    state.watchlist_repo.add(viewer.user_id, &item).await?;
    let mut resolved = resolve_snapshot(&state, &viewer, &snap).await?;
    resolved.title.title_key = item.title_key;
    resolved.in_watchlist = true;
    Ok(Json(resolved))
}

#[utoipa::path(
    delete,
    path = "/api/v1/watchlist/{title_key}",
    tag = "discovery",
    params(("title_key" = String, Path, description = "Identity key from the watchlist entry")),
    responses(
        (status = 204, description = "Removed (idempotent)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn remove_watchlist_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(title_key): Path<String>,
) -> Result<StatusCode, ApiError> {
    state
        .watchlist_repo
        .remove(viewer.user_id, &title_key)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RequestResult {
    pub status: String,
    /// The Radarr/Sonarr instance, or the Ombi/Seerr integration, that took the request.
    pub provider_instance_id: Uuid,
    /// The unified request row, so clients can show its status.
    #[serde(default)]
    pub request_id: Option<Uuid>,
    /// Where the request stands upstream (an Ombi/Seerr request may be pending approval).
    #[serde(default)]
    pub request_status: Option<playarr_model::requests::RequestStatus>,
}

/// Picks the lookup hit that is the snapshot's title: by external id first,
/// else by normalised name and year.
fn pick_lookup_hit<'a>(snap: &TitleSnapshot, hits: &'a [LookupTitle]) -> Option<&'a LookupTitle> {
    let ext = |p: ExternalProvider| {
        snap.external_refs
            .iter()
            .find(|r| r.provider == p)
            .map(|r| r.external_id.clone())
    };
    let (tmdb, tvdb, imdb) = (
        ext(ExternalProvider::Tmdb),
        ext(ExternalProvider::Tvdb),
        ext(ExternalProvider::Imdb),
    );
    let id_matches = |wanted: &Option<String>, have: Option<i64>| {
        wanted
            .as_deref()
            .is_some_and(|w| have.map(|v| v.to_string()).as_deref() == Some(w))
    };
    hits.iter()
        .find(|h| {
            id_matches(&tmdb, h.tmdb_id)
                || id_matches(&tvdb, h.tvdb_id)
                || imdb
                    .as_deref()
                    .is_some_and(|i| h.imdb_id.as_deref() == Some(i))
        })
        .or_else(|| {
            let wanted = playarr_model::discovery::normalise_title(&snap.title);
            hits.iter().find(|h| {
                playarr_model::discovery::normalise_title(&h.title) == wanted
                    && (snap.year.is_none() || h.year == snap.year)
            })
        })
}

#[utoipa::path(
    post,
    path = "/api/v1/discover/request",
    tag = "discovery",
    request_body = TitleSnapshot,
    responses(
        (status = 200, description = "The title was added to the request provider and is being searched for", body = RequestResult),
        (status = 403, description = "The caller may not request titles"),
        (status = 404, description = "The request provider does not know this title"),
        (status = 409, description = "Already in the library or already requested"),
        (status = 422, description = "No usable request provider is configured for this kind of title"),
        (status = 502, description = "The request provider did not accept the request")
    )
)]
pub async fn request_title_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Json(snap): Json<TitleSnapshot>,
) -> Result<Json<RequestResult>, ApiError> {
    if !can_request(&state, &viewer) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "request_not_allowed",
            "Your account is not allowed to request titles",
        ));
    }
    if find_library_work(&state, &viewer, &snap, &ResolveMemo::default())
        .await?
        .is_some()
    {
        return Err(ApiError::conflict("this title is already in the library"));
    }
    let unprocessable =
        |code: &str, message: &str| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, code, message);
    let new_title = new_title_from_snapshot(&state, &viewer, &snap).await?;
    let backend = state.request_sync.backend().await;
    if let Some(kind) = match backend {
        RequestBackend::Ombi => Some(IntegrationKind::Ombi),
        RequestBackend::Seerr => Some(IntegrationKind::Seerr),
        _ => None,
    } {
        let integration = state
            .request_sync
            .enabled_integration(kind)
            .await
            .ok_or_else(|| unprocessable("no_request_provider", NO_REQUEST_PROVIDER))?;
        let row = state.request_sync.push(&new_title, &integration).await?;
        return Ok(Json(RequestResult {
            status: "requested".into(),
            provider_instance_id: integration.id,
            request_id: Some(row.id),
            request_status: Some(row.status),
        }));
    }
    let instances = request_instances(&state, snap.kind);
    if instances.is_empty() {
        return Err(unprocessable("no_request_provider", NO_REQUEST_PROVIDER));
    }
    let Some(instance) = instances
        .iter()
        .find(|i| i.default_root_folder_id.is_some() && i.default_quality_profile_id.is_some())
    else {
        return Err(unprocessable(
            "request_provider_not_configured",
            "The request provider has no default root folder or quality profile",
        ));
    };
    let (root, profile) = (
        instance.default_root_folder_id.clone().unwrap_or_default(),
        instance.default_quality_profile_id.unwrap_or_default(),
    );
    let client = RequestLookup::for_instance(instance)
        .ok_or_else(|| unprocessable("no_request_provider", NO_REQUEST_PROVIDER))?;
    let term = snap
        .external_refs
        .iter()
        .find_map(|r| match (&r.provider, snap.kind) {
            (ExternalProvider::Tmdb, DiscoveryKind::Movie) => {
                Some(format!("tmdb:{}", r.external_id))
            }
            (ExternalProvider::Tvdb, DiscoveryKind::Series) => {
                Some(format!("tvdb:{}", r.external_id))
            }
            _ => None,
        })
        .unwrap_or_else(|| snap.title.clone());
    let hits = tokio::time::timeout(REQUEST_LOOKUP_TIMEOUT, client.lookup(&term))
        .await
        .map_err(|_| ApiError::bad_gateway("the request provider timed out"))?
        .map_err(|err| {
            tracing::warn!(%err, "discovery: request lookup failed");
            ApiError::bad_gateway("the request provider could not look the title up")
        })?;
    let hit = pick_lookup_hit(&snap, &hits)
        .ok_or_else(|| ApiError::not_found("the request provider does not know this title"))?;
    if hit.arr_id.is_some() {
        return Err(ApiError::conflict("this title has already been requested"));
    }
    client.add(hit, &root, profile).await.map_err(|err| {
        tracing::warn!(%err, "discovery: request add failed");
        ApiError::bad_gateway("the request provider did not accept the request")
    })?;
    // The title now exists in the provider: cached search hits are out of date.
    SEARCH_LOOKUPS.clear();
    let row = state
        .request_sync
        .record_direct(&new_title, instance.id)
        .await?;
    if backend == RequestBackend::DirectMirror {
        for integration in state
            .request_sync
            .integrations
            .list()
            .await?
            .into_iter()
            .filter(|i| i.enabled)
        {
            // Best effort: a failed mirror is recorded on the row and retried.
            if let Err(err) = state.request_sync.mirror(row.id, &integration).await {
                tracing::warn!(%err, integration = %integration.name, "requests: mirror failed");
            }
        }
    }
    Ok(Json(RequestResult {
        status: "requested".into(),
        provider_instance_id: instance.id,
        request_id: Some(row.id),
        request_status: Some(row.status),
    }))
}

async fn new_title_from_snapshot(
    state: &AppState,
    viewer: &CatalogViewer,
    snap: &TitleSnapshot,
) -> Result<crate::request_sync::NewTitle, ApiError> {
    use playarr_model::requests::LocalUserRef;
    let num = |p| ref_id(snap, p).and_then(|v| v.parse::<i64>().ok());
    let user = state.user_repo.find_by_id(viewer.user_id).await?;
    let label = user.as_ref().map(|u| {
        if u.display_name.is_empty() {
            u.username.clone()
        } else {
            u.display_name.clone()
        }
    });
    Ok(crate::request_sync::NewTitle {
        kind: snap.kind,
        title: snap.title.clone(),
        year: snap.year,
        tmdb_id: num(ExternalProvider::Tmdb),
        tvdb_id: num(ExternalProvider::Tvdb),
        imdb_id: ref_id(snap, ExternalProvider::Imdb),
        poster_url: snap.poster_url.clone(),
        seasons: Vec::new(),
        user: user.map(|u| LocalUserRef {
            id: u.id,
            username: u.username,
            email: u.email,
        }),
        requester_label: label,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_media_file, seed_streaming_user,
        seed_streaming_user_with_library_allow, test_state, TestState,
    };
    use axum::body::Body;
    use axum::http::Request;
    use playarr_model::discovery::ActionKind;
    use playarr_model::media::LeafRef;
    use playarr_model::{ExternalProvider, WatchProgress};
    use tower::ServiceExt;

    async fn json_body<T: serde::de::DeserializeOwned>(response: axum::response::Response) -> T {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    async fn seed_work(state: &TestState, title: &str, tmdb: &str) -> Uuid {
        let work = Work {
            id: Uuid::new_v4(),
            kind: playarr_model::WorkKind::Movie,
            external_refs: vec![ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: tmdb.into(),
            }],
            title: title.into(),
            sort_title: title.into(),
            overview: None,
            images: vec![],
            genres: vec![],
            tags: vec![],
            added_at: Utc::now(),
            release_date: None,
            end_date: None,
            monitored: true,
            availability: Availability::Available,
        };
        let id = work.id;
        state.work_repo.upsert(&work).await.unwrap();
        id
    }

    fn get(uri: &str, token: &str) -> Request<Body> {
        Request::builder()
            .uri(uri)
            .header("Authorization", bearer_header(token))
            .body(Body::empty())
            .unwrap()
    }

    fn post(uri: &str, token: &str, body: serde_json::Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .header("Authorization", bearer_header(token))
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    #[tokio::test]
    async fn discover_requires_auth() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/discover?q=x")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn discover_returns_library_title_with_provider_statuses() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        let instance = Uuid::new_v4();
        let work = seed_work(&state, "Orbit", "949").await;
        seed_media_file(&state, work, LeafRef::Work, instance).await;
        seed_streaming_user_with_library_allow(&state, user, vec![instance]).await;
        let token = mint_access_token(&state, user);

        let response = router
            .clone()
            .oneshot(get("/api/v1/discover?q=orbit", &token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: DiscoverResponse = json_body(response).await;
        assert_eq!(body.titles.len(), 1);
        assert_eq!(body.titles[0].title.title_key, "tmdb:movie:949");
        assert_eq!(
            body.titles[0].title.sources[0].source,
            SourceKindTag::Library
        );
        assert!(body
            .providers
            .iter()
            .any(|p| p.provider == SourceKindTag::Game && p.state == ProviderState::Unavailable));
    }

    #[tokio::test]
    async fn restricted_user_does_not_see_other_library_titles() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        let work = seed_work(&state, "Secret Film", "1").await;
        seed_media_file(&state, work, LeafRef::Work, Uuid::new_v4()).await;
        seed_streaming_user_with_library_allow(&state, user, vec![Uuid::new_v4()]).await;
        let token = mint_access_token(&state, user);
        let response = router
            .oneshot(get("/api/v1/discover?q=secret", &token))
            .await
            .unwrap();
        let body: DiscoverResponse = json_body(response).await;
        assert!(body.titles.is_empty());
    }

    #[tokio::test]
    async fn games_scope_excludes_media_and_media_scope_excludes_games() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_work(&state, "Doom", "2").await;
        seed_streaming_user(&state, user).await;
        let token = mint_access_token(&state, user);
        let response = router
            .clone()
            .oneshot(get("/api/v1/discover?q=doom&scope=games", &token))
            .await
            .unwrap();
        let body: DiscoverResponse = json_body(response).await;
        assert!(body.titles.is_empty());
        let game = body
            .providers
            .iter()
            .find(|p| p.provider == SourceKindTag::Game)
            .unwrap();
        assert_eq!(game.state, ProviderState::Unavailable);
        assert!(game.reason.is_some());
    }

    #[tokio::test]
    async fn empty_query_returns_no_titles() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        let token = mint_access_token(&state, user);
        let response = router
            .oneshot(get("/api/v1/discover?q=%20", &token))
            .await
            .unwrap();
        let body: DiscoverResponse = json_body(response).await;
        assert!(body.titles.is_empty());
    }

    #[tokio::test]
    async fn watchlist_add_list_resolve_resume_and_remove() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        let instance = Uuid::new_v4();
        let work = seed_work(&state, "Orbit", "949").await;
        let file = seed_media_file(&state, work, LeafRef::Work, instance).await;
        seed_streaming_user_with_library_allow(&state, user, vec![instance]).await;
        let token = mint_access_token(&state, user);

        // Add by external ref only: the server finds the library work.
        let snapshot = serde_json::json!({
            "kind": "movie", "title": "Orbit", "year": 1995,
            "external_refs": [{"provider": "tmdb", "external_id": "949"}]
        });
        let response = router
            .clone()
            .oneshot(post("/api/v1/watchlist", &token, snapshot.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let added: ResolvedTitle = json_body(response).await;
        assert!(added.in_watchlist);
        let play = added
            .actions
            .iter()
            .find(|a| a.action == ActionKind::Play)
            .unwrap();
        assert!(play.enabled);
        assert_eq!(play.work_id, Some(work));
        assert_eq!(play.media_file_id, Some(file));

        // Idempotent.
        router
            .clone()
            .oneshot(post("/api/v1/watchlist", &token, snapshot))
            .await
            .unwrap();
        let listed: WatchlistResponse = json_body(
            router
                .clone()
                .oneshot(get("/api/v1/watchlist", &token))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(listed.items.len(), 1);

        // Progress turns Play into Resume with the saved position.
        state
            .app
            .watch_progress
            .upsert(
                user,
                &WatchProgress {
                    media_file_id: file,
                    work_id: work,
                    position_ms: 61_000,
                    duration_ms: 3_600_000,
                    state: WatchState::PartWatched,
                    updated_at: Some(Utc::now()),
                },
            )
            .await
            .unwrap();
        let listed: WatchlistResponse = json_body(
            router
                .clone()
                .oneshot(get("/api/v1/watchlist", &token))
                .await
                .unwrap(),
        )
        .await;
        let resume = listed.items[0]
            .resolved
            .actions
            .iter()
            .find(|a| a.action == ActionKind::Resume)
            .unwrap();
        assert!(resume.enabled);
        assert_eq!(resume.position_ms, Some(61_000));
        assert_eq!(resume.media_file_id, Some(file));

        let key = listed.items[0].resolved.title.title_key.clone();
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/watchlist/{key}"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let listed: WatchlistResponse = json_body(
            router
                .oneshot(get("/api/v1/watchlist", &token))
                .await
                .unwrap(),
        )
        .await;
        assert!(listed.items.is_empty());
    }

    #[tokio::test]
    async fn out_of_library_title_explains_disabled_actions() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        let token = mint_access_token(&state, user);
        let response = router
            .oneshot(post(
                "/api/v1/discover/resolve",
                &token,
                serde_json::json!({"kind": "movie", "title": "Unknown", "year": 2030,
                    "external_refs": [{"provider": "tmdb", "external_id": "999999"}]}),
            ))
            .await
            .unwrap();
        let resolved: ResolvedTitle = json_body(response).await;
        let play = resolved
            .actions
            .iter()
            .find(|a| a.action == ActionKind::Play)
            .unwrap();
        assert!(!play.enabled && play.reason.is_some());
        let record = resolved
            .actions
            .iter()
            .find(|a| a.action == ActionKind::Record)
            .unwrap();
        assert!(!record.enabled && record.reason.is_some());
        assert!(!resolved.in_watchlist);
    }

    #[tokio::test]
    async fn watchlists_are_per_profile() {
        let (router, state) = test_state().await;
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        seed_streaming_user(&state, a).await;
        seed_streaming_user(&state, b).await;
        let (ta, tb) = (mint_access_token(&state, a), mint_access_token(&state, b));
        router
            .clone()
            .oneshot(post(
                "/api/v1/watchlist",
                &ta,
                serde_json::json!({"kind": "movie", "title": "Only A", "year": 2001}),
            ))
            .await
            .unwrap();
        let for_b: WatchlistResponse =
            json_body(router.oneshot(get("/api/v1/watchlist", &tb)).await.unwrap()).await;
        assert!(for_b.items.is_empty());
    }

    fn radarr_instance(base_url: &str, with_defaults: bool) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind: SourceKind::Radarr,
            name: "Radarr 4K".into(),
            base_url: base_url.into(),
            api_key_encrypted: playarr_model::Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: with_defaults.then(|| "/movies".to_string()),
            folder_mappings: Default::default(),
            default_quality_profile_id: with_defaults.then_some(4),
            best_effort: false,
            group_library_id: None,
        }
    }

    async fn mock_radarr(hits: serde_json::Value) -> wiremock::MockServer {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/lookup"))
            .respond_with(ResponseTemplate::new(200).set_body_json(hits))
            .mount(&server)
            .await;
        server
    }

    #[tokio::test]
    async fn discover_offers_requestable_titles_and_hides_request_for_library_titles() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        let instance = Uuid::new_v4();
        let work = seed_work(&state, "Orbit", "949").await;
        seed_media_file(&state, work, LeafRef::Work, instance).await;
        seed_streaming_user_with_library_allow(&state, user, vec![instance]).await;
        grant_can_request(&state, user).await;
        let server = mock_radarr(serde_json::json!([
            {"title": "Orbit", "year": 1995, "tmdbId": 949, "id": 0},
            {"title": "Orbit 2", "year": 2030, "tmdbId": 5000, "id": 0},
            {"title": "Orbit Wave", "year": 2001, "tmdbId": 5001, "id": 9}
        ]))
        .await;
        state
            .source_instances
            .upsert(radarr_instance(&server.uri(), true));
        let token = mint_access_token(&state, user);
        let body: DiscoverResponse = json_body(
            router
                .oneshot(get("/api/v1/discover?q=orbit", &token))
                .await
                .unwrap(),
        )
        .await;
        let by_key = |k: &str| body.titles.iter().find(|t| t.title.title_key == k).unwrap();
        let orbit = by_key("tmdb:movie:949");
        assert!(orbit
            .title
            .sources
            .iter()
            .all(|s| s.source == SourceKindTag::Library));
        let sequel = by_key("tmdb:movie:5000");
        assert_eq!(
            sequel.title.sources[0].availability,
            SourceAvailability::Requestable
        );
        assert_eq!(sequel.title.sources[0].label, "Radarr 4K");
        let tracked = by_key("tmdb:movie:5001");
        assert_eq!(
            tracked.title.sources[0].availability,
            SourceAvailability::Upcoming
        );
        assert!(body
            .providers
            .iter()
            .any(|p| p.provider == SourceKindTag::Request && p.state == ProviderState::Ok));
    }

    #[tokio::test]
    async fn search_hides_requestable_for_user_without_can_request() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        let server = mock_radarr(serde_json::json!([
            {"title": "Orbit 2", "year": 2030, "tmdbId": 5000, "id": 0}
        ]))
        .await;
        state
            .source_instances
            .upsert(radarr_instance(&server.uri(), true));
        let token = mint_access_token(&state, user);
        let body: DiscoverResponse = json_body(
            router
                .oneshot(get("/api/v1/discover?q=orbit", &token))
                .await
                .unwrap(),
        )
        .await;
        let sequel = body
            .titles
            .iter()
            .find(|t| t.title.title_key == "tmdb:movie:5000")
            .unwrap();
        assert_eq!(
            sequel.title.sources[0].availability,
            SourceAvailability::Unavailable
        );
        assert!(sequel.title.sources[0]
            .reason
            .as_deref()
            .unwrap()
            .contains("not allowed"));
    }

    #[tokio::test]
    async fn unreachable_request_provider_degrades_without_failing_search() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        // Nothing listens here.
        state
            .source_instances
            .upsert(radarr_instance("http://127.0.0.1:9", true));
        let token = mint_access_token(&state, user);
        let response = router
            .oneshot(get("/api/v1/discover?q=anything", &token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: DiscoverResponse = json_body(response).await;
        let status = body
            .providers
            .iter()
            .find(|p| p.provider == SourceKindTag::Request)
            .unwrap();
        // Users never see a source error: the failure is logged, health is admin-only.
        assert_eq!(status.state, ProviderState::Ok);
        assert!(status.reason.is_none());
    }

    #[tokio::test]
    async fn repeated_search_is_served_from_the_cache_without_asking_the_source() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/lookup"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                serde_json::json!([{"title": "Orbit 2", "year": 2030, "tmdbId": 5000, "id": 0}]),
            ))
            .expect(1)
            .mount(&server)
            .await;
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        state
            .source_instances
            .upsert(radarr_instance(&server.uri(), true));
        let token = mint_access_token(&state, user);
        for _ in 0..2 {
            let response = router
                .clone()
                .oneshot(get("/api/v1/discover?q=cache-me", &token))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }
        // The first search may have answered before the lookup finished only if
        // it was slow; either way the source is asked once for the term.
        server.verify().await;
    }

    #[tokio::test]
    async fn slow_request_provider_does_not_hold_the_search() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/lookup"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(std::time::Duration::from_secs(4))
                    .set_body_json(serde_json::json!([{"title": "Orbit 2", "year": 2030, "tmdbId": 5000, "id": 0}])),
            )
            .mount(&server)
            .await;
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        state
            .source_instances
            .upsert(radarr_instance(&server.uri(), true));
        let token = mint_access_token(&state, user);
        let started = std::time::Instant::now();
        let response = router
            .oneshot(get("/api/v1/discover?q=slow-one", &token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(started.elapsed() < std::time::Duration::from_millis(3500));
        let body: DiscoverResponse = json_body(response).await;
        let status = body
            .providers
            .iter()
            .find(|p| p.provider == SourceKindTag::Request)
            .unwrap();
        assert!(status.reason.is_none());
    }

    async fn grant_can_request(state: &TestState, user: Uuid) {
        let stored = state.user_repo.find_by_id(user).await.unwrap().unwrap();
        let mut policy = state
            .policy_repo
            .find_by_id(stored.policy_id)
            .await
            .unwrap()
            .unwrap();
        assert!(!policy.can_request, "least privilege by default");
        policy.can_request = true;
        state.policy_repo.upsert(&policy).await.unwrap();
    }

    fn missing_title() -> serde_json::Value {
        serde_json::json!({"kind": "movie", "title": "Orbit 2", "year": 2030,
            "external_refs": [{"provider": "tmdb", "external_id": "5000"}]})
    }

    #[tokio::test]
    async fn admin_can_request_and_provider_receives_destination() {
        use crate::test_support::seed_admin_user;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, ResponseTemplate};
        let (router, state) = test_state().await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let server = mock_radarr(serde_json::json!([
            {"title": "Orbit 2", "year": 2030, "tmdbId": 5000, "id": 0}
        ]))
        .await;
        Mock::given(method("POST"))
            .and(path("/api/v3/movie"))
            .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({"id": 3})))
            .expect(1)
            .mount(&server)
            .await;
        state
            .source_instances
            .upsert(radarr_instance(&server.uri(), true));
        let token = mint_access_token(&state, admin);

        let resolved: ResolvedTitle = json_body(
            router
                .clone()
                .oneshot(post("/api/v1/discover/resolve", &token, missing_title()))
                .await
                .unwrap(),
        )
        .await;
        let request = resolved
            .actions
            .iter()
            .find(|a| a.action == ActionKind::Request)
            .unwrap();
        assert!(request.enabled);

        let response = router
            .oneshot(post("/api/v1/discover/request", &token, missing_title()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let posted = server
            .received_requests()
            .await
            .unwrap()
            .into_iter()
            .find(|r| r.method.as_str() == "POST")
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&posted.body).unwrap();
        assert_eq!(body["tmdbId"], 5000);
        assert_eq!(body["rootFolderPath"], "/movies");
        assert_eq!(body["qualityProfileId"], 4);
    }

    #[tokio::test]
    async fn regular_user_cannot_request_and_sees_why() {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        let server = mock_radarr(serde_json::json!([])).await;
        state
            .source_instances
            .upsert(radarr_instance(&server.uri(), true));
        let token = mint_access_token(&state, user);
        let resolved: ResolvedTitle = json_body(
            router
                .clone()
                .oneshot(post("/api/v1/discover/resolve", &token, missing_title()))
                .await
                .unwrap(),
        )
        .await;
        let request = resolved
            .actions
            .iter()
            .find(|a| a.action == ActionKind::Request)
            .unwrap();
        assert!(!request.enabled);
        assert!(request.reason.as_deref().unwrap().contains("not allowed"));
        let response = router
            .oneshot(post("/api/v1/discover/request", &token, missing_title()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn user_with_can_request_grant_can_request_and_sees_enabled_action() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, ResponseTemplate};
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        grant_can_request(&state, user).await;

        let server = mock_radarr(serde_json::json!([
            {"title": "Orbit 2", "year": 2030, "tmdbId": 5000, "id": 0}
        ]))
        .await;
        Mock::given(method("POST"))
            .and(path("/api/v3/movie"))
            .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({"id": 3})))
            .expect(1)
            .mount(&server)
            .await;
        state
            .source_instances
            .upsert(radarr_instance(&server.uri(), true));
        let token = mint_access_token(&state, user);
        let resolved: ResolvedTitle = json_body(
            router
                .clone()
                .oneshot(post("/api/v1/discover/resolve", &token, missing_title()))
                .await
                .unwrap(),
        )
        .await;
        let request = resolved
            .actions
            .iter()
            .find(|a| a.action == ActionKind::Request)
            .unwrap();
        assert!(request.enabled);
        let response = router
            .oneshot(post("/api/v1/discover/request", &token, missing_title()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn request_conflicts_and_configuration_errors_are_explicit() {
        use crate::test_support::seed_admin_user;
        let (router, state) = test_state().await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);

        // No provider at all.
        let response = router
            .clone()
            .oneshot(post("/api/v1/discover/request", &token, missing_title()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

        // Provider without defaults.
        let server = mock_radarr(serde_json::json!([
            {"title": "Orbit 2", "year": 2030, "tmdbId": 5000, "id": 12}
        ]))
        .await;
        let mut bare = radarr_instance(&server.uri(), false);
        state.source_instances.upsert(bare.clone());
        let response = router
            .clone()
            .oneshot(post("/api/v1/discover/request", &token, missing_title()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

        // Already tracked by the provider.
        bare.default_root_folder_id = Some("/movies".into());
        bare.default_quality_profile_id = Some(4);
        state.source_instances.upsert(bare);
        let response = router
            .oneshot(post("/api/v1/discover/request", &token, missing_title()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
}
