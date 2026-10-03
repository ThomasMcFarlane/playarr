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
use playarr_catalog::WorkChildren;
use playarr_model::discovery::{
    compute_actions, identity_key, merge_candidates, ActionContext, DiscoveryCandidate,
    DiscoveryKind, DiscoveryScope, DiscoveryTitle, ProviderState, ProviderStatus,
    SourceAvailability, SourceKindTag, TitleAction, TitleSource, WatchlistItem,
};
use playarr_model::{Availability, ExternalRef, WatchState, Work};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::CatalogViewer;
use crate::error::ApiError;
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

/// A title snapshot as sent by clients (from a search result or a title
/// page) to the watchlist and resolve endpoints.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TitleSnapshot {
    pub kind: DiscoveryKind,
    pub title: String,
    pub year: Option<i32>,
    pub work_id: Option<Uuid>,
    #[serde(default)]
    pub external_refs: Vec<ExternalRef>,
    pub poster_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ResolvedTitle {
    pub title: DiscoveryTitle,
    pub in_watchlist: bool,
    pub actions: Vec<TitleAction>,
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
            provider: SourceKindTag::Request,
            state: ProviderState::Unavailable,
            reason: Some("No request provider is configured".into()),
        },
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
        providers.extend(stub_provider_statuses());
        return Ok(Json(DiscoverResponse {
            titles: vec![],
            providers,
        }));
    }

    if scope != DiscoveryScope::Games {
        let allowed = viewer.allowed_libraries();
        let limit = params.limit.unwrap_or(25).clamp(1, 100);
        match state.catalog.search(q, limit, allowed.as_deref()).await {
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
    .map(|title| DiscoverTitle {
        in_watchlist: watch.contains(&title.title_key),
        title,
    })
    .collect();
    Ok(Json(DiscoverResponse { titles, providers }))
}

/// The library work (visible to the caller) matching a snapshot, by id first
/// and then by any external ref.
async fn find_library_work(
    state: &AppState,
    viewer: &CatalogViewer,
    snap: &TitleSnapshot,
) -> Result<Option<Work>, ApiError> {
    let allowed = viewer.allowed_libraries();
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
        if let Ok(detail) = state.catalog.get_by_id(id, allowed.as_deref()).await {
            return Ok(Some(detail.work));
        }
    }
    Ok(None)
}

async fn build_action_context(
    state: &AppState,
    viewer: &CatalogViewer,
    snap: &TitleSnapshot,
    work: Option<&Work>,
) -> Result<ActionContext, ApiError> {
    let mut ctx = ActionContext {
        kind: Some(snap.kind),
        can_request: true,
        request_unavailable_reason: Some("No request provider is configured".into()),
        ..Default::default()
    };
    let Some(work) = work else {
        return Ok(ctx);
    };
    ctx.library_work_id = Some(work.id);
    let allowed = viewer.allowed_libraries();
    let detail = state
        .catalog
        .get_by_id(work.id, allowed.as_deref())
        .await
        .ok();
    let progress = state.watch_progress.list_for_user(viewer.user_id).await?;
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

async fn resolve_snapshot(
    state: &AppState,
    viewer: &CatalogViewer,
    snap: &TitleSnapshot,
) -> Result<ResolvedTitle, ApiError> {
    let work = find_library_work(state, viewer, snap).await?;
    let mut candidates = Vec::new();
    // The snapshot itself is the carrier of identity when nothing else is
    // known, so a title that is not in any library still resolves.
    candidates.push(DiscoveryCandidate {
        kind: snap.kind,
        title: snap.title.clone(),
        year: snap.year,
        external_refs: snap.external_refs.clone(),
        poster_url: snap.poster_url.clone(),
        overview: None,
        source: TitleSource {
            source: SourceKindTag::Request,
            label: "Not in your library".into(),
            availability: SourceAvailability::Unavailable,
            reason: Some("No request provider is configured".into()),
            edition: None,
            work_id: None,
            provider_instance_id: None,
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
    let ctx = build_action_context(state, viewer, snap, work.as_ref()).await?;
    let actions = compute_actions(&ctx);
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
    Ok(ResolvedTitle {
        title,
        in_watchlist,
        actions,
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
    let work = find_library_work(&state, &viewer, &snap).await?;
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
            .oneshot(get("/api/v1/discover?q=heat", &token))
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
}
