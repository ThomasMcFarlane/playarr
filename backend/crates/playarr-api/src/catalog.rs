//! Catalog endpoints: `GET /api/v1/catalog`, `GET /api/v1/catalog/{id}`,
//! `GET /api/v1/catalog/search` -- thin Axum handlers over
//! [`playarr_catalog::CatalogService`]. Gated by [`crate::auth_extractor::
//! CatalogViewer`]: real Playarr streaming access OR an admin account (the
//! latter for Playarr Server Admin's own "Library" verification screen) -- see
//! that extractor's doc comment. Deliberately more permissive than
//! [`crate::playback::playback_info_handler`], which stays `StreamingUser`-
//! only: an admin can *see* the catalog without being able to *play*
//! anything through it.
//!
//! Every handler here also threads [`CatalogViewer::allowed_libraries`]
//! through to the corresponding `CatalogService` method -- the per-user
//! library access control enforcement point for the catalog read path (see
//! `playarr_model::Policy::library_allow`'s doc comment). A restricted
//! caller's browse/search results silently omit works outside their
//! allowed set, and `get_work_handler` 404s (not 403s) for a work outside
//! it, indistinguishable from a genuinely nonexistent work.

use std::collections::{HashMap, HashSet};

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use playarr_catalog::{BrowseQuery, BrowseSort, WorkDetail};
use playarr_model::{
    Album, Availability, Book, Episode, ExternalProvider, Season, Track, Work, WorkKind,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::CatalogViewer;
use crate::error::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct BrowseQueryParams {
    pub kind: Option<WorkKind>,
    /// Return only works that own at least one synced media file. Playarr
    /// enables this; Playarr Server Admin leaves it unset so records without
    /// playable leaves remain visible for library reconciliation.
    pub available_only: Option<bool>,
    /// Restricts results to works with at least one synced file from this
    /// source instance -- the "library" filter (two source instances of the
    /// same kind, e.g. two Radarr instances, browse as separate libraries).
    /// See `playarr_catalog::BrowseQuery::source_instance_id`'s doc
    /// comment for how this is resolved.
    pub source_instance_id: Option<Uuid>,
    pub genre: Option<String>,
    pub tag: Option<String>,
    /// `"title"` (default) or `"date_added"` (`"recent"` remains a
    /// backwards-compatible alias for date-added descending).
    pub sort: Option<String>,
    /// `"asc"` (default for title) or `"desc"` (default for date added).
    pub order: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl From<BrowseQueryParams> for BrowseQuery {
    fn from(params: BrowseQueryParams) -> Self {
        let descending = matches!(params.order.as_deref(), Some("desc"));
        let sort = match params.sort.as_deref() {
            Some("recent") => BrowseSort::RecentlyAdded,
            Some("date_added") if matches!(params.order.as_deref(), Some("asc")) => {
                BrowseSort::OldestAdded
            }
            Some("date_added") => BrowseSort::RecentlyAdded,
            _ if descending => BrowseSort::TitleDescending,
            _ => BrowseSort::TitleAscending,
        };
        let defaults = BrowseQuery::default();
        BrowseQuery {
            kind: params.kind,
            available_only: params.available_only.unwrap_or(defaults.available_only),
            source_instance_id: params.source_instance_id,
            genre: params.genre,
            tag: params.tag,
            // Not (yet) exposed as its own HTTP query param -- only
            // `CatalogService::resolve_view` sets this today, from a saved
            // `LibraryView`'s `ViewCriteria::release_window_days`.
            release_window_days: defaults.release_window_days,
            // Not (yet) exposed as its own HTTP query param either -- same
            // placeholder treatment as `release_window_days` above, pending
            // whichever pass wires a `GroupLibrary`-aware browse filter
            // through to this DTO.
            group_library_ids: defaults.group_library_ids,
            sort,
            limit: params.limit.unwrap_or(defaults.limit),
            offset: params.offset.unwrap_or(defaults.offset),
            // Not settable via this HTTP query param -- `browse_catalog_handler`
            // overwrites this from the caller's own `Policy::library_allow`
            // after this conversion runs (a caller can't self-report their own
            // allowed libraries), so `defaults`' `None` here is just a
            // placeholder until that assignment happens.
            allowed_source_instance_ids: defaults.allowed_source_instance_ids,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct SearchQueryParams {
    pub q: String,
    pub limit: Option<i64>,
}

/// One peer's reported availability for a `Work`, per
/// `docs/architecture/peer-groups.md` §4.3's Rust sketch. Mirrors
/// [`playarr_catalog::AvailabilityBadge`] field-for-field: that type
/// can't implement `ToSchema` itself (`playarr-catalog` deliberately
/// doesn't depend on `utoipa`, same as every other type this file mirrors
/// for OpenAPI purposes), and [`SearchResponse`] below needs a real,
/// `ToSchema`-implementing type to actually return -- so, unlike
/// `CatalogPageSchema`/`WorkDetailSchema`'s purely-decorative mirrors, this
/// one is genuinely constructed (via the `From` impl below), not just
/// `#[allow(dead_code)]` documentation. Named without the `Schema` suffix
/// those use, matching the design doc's own naming for this DTO exactly.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AvailabilityBadge {
    pub peer_node_id: Uuid,
    pub peer_name: String,
    pub availability: Availability,
    pub updated_at: DateTime<Utc>,
}

impl From<playarr_catalog::AvailabilityBadge> for AvailabilityBadge {
    fn from(badge: playarr_catalog::AvailabilityBadge) -> Self {
        Self {
            peer_node_id: badge.peer_node_id,
            peer_name: badge.peer_name,
            availability: badge.availability,
            updated_at: badge.updated_at,
        }
    }
}

/// A title a full peer reports but this node has zero local record of at
/// all -- the partial-cache-node case (§4.3). Mirrors
/// [`playarr_catalog::RemoteOnlyWork`]; see [`AvailabilityBadge`]'s doc
/// comment for why this exists as a real, separately-constructed type
/// rather than a purely decorative mirror.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RemoteOnlyWork {
    pub provider: ExternalProvider,
    pub external_id: String,
    pub title: String,
    pub kind: WorkKind,
    pub release_date: Option<String>,
    pub available_on: Vec<AvailabilityBadge>,
}

impl From<playarr_catalog::RemoteOnlyWork> for RemoteOnlyWork {
    fn from(work: playarr_catalog::RemoteOnlyWork) -> Self {
        Self {
            provider: work.provider,
            external_id: work.external_id,
            title: work.title,
            kind: work.kind,
            release_date: work.release_date,
            available_on: work.available_on.into_iter().map(Into::into).collect(),
        }
    }
}

/// Doc-only mirror of [`playarr_catalog::CatalogPage`] -- the real type
/// already derives `Serialize` (and is what handlers actually return), it
/// just has no `ToSchema` (`playarr-catalog` doesn't depend on `utoipa`).
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct CatalogPageSchema {
    pub items: Vec<Work>,
    pub total: Option<i64>,
    /// Cross-peer availability for each work in `items`, keyed by `Work::id`
    /// (§4.3) -- empty for a deployment not part of a peer group.
    pub available_on: HashMap<Uuid, Vec<AvailabilityBadge>>,
    /// Titles a full peer reports but this node has zero local record of
    /// (§4.3's partial-cache-node case) -- empty unless the caller has a
    /// `Policy::group_library_allow` grant.
    pub remote_only: Vec<RemoteOnlyWork>,
}

/// `GET /api/v1/catalog/search`'s real response shape: locally-known
/// matches (`items`, from `CatalogService::search`, unchanged) plus the
/// partial-cache-node `remote_only` union (§4.3, from `CatalogService::
/// search_remote_only`) -- see [`search_catalog_handler`]. Unlike
/// `CatalogPageSchema`/`WorkDetailSchema` above, this genuinely is the real
/// wire type (not just a doc-only mirror): `CatalogService::search` itself
/// deliberately keeps returning a bare `Vec<Work>` (every existing caller/
/// test is unaffected), so combining it with `remote_only` for the HTTP
/// response has to happen here, in the API layer, rather than in
/// `playarr-catalog`.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SearchResponse {
    pub items: Vec<Work>,
    pub remote_only: Vec<RemoteOnlyWork>,
}

/// Doc-only mirror of `playarr_catalog::EpisodeDetail` -- the resolved
/// `MediaFile` id (via `MediaFileRepo::find_by_leaf`) that plays this
/// episode, `None` when no file has synced for it yet.
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct EpisodeDetailSchema {
    pub episode: Episode,
    pub media_file_id: Option<Uuid>,
    pub runtime_ms: Option<u64>,
}

#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct SeasonDetailSchema {
    pub season: Season,
    pub episodes: Vec<EpisodeDetailSchema>,
}

/// Doc-only mirror of `playarr_catalog::TrackDetail`; see
/// [`EpisodeDetailSchema`].
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct TrackDetailSchema {
    pub track: Track,
    pub media_file_id: Option<Uuid>,
    pub runtime_ms: Option<u64>,
}

#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct AlbumDetailSchema {
    pub album: Album,
    pub tracks: Vec<TrackDetailSchema>,
}

/// Doc-only mirror of `playarr_catalog::BookDetail`; see
/// [`EpisodeDetailSchema`].
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct BookDetailSchema {
    pub book: Book,
    pub media_file_id: Option<Uuid>,
}

/// Doc-only mirror of `playarr_catalog::WorkChildren`; see
/// [`CatalogPageSchema`].
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub enum WorkChildrenSchema {
    Movie,
    Series(Vec<SeasonDetailSchema>),
    Artist(Vec<AlbumDetailSchema>),
    Author(Vec<BookDetailSchema>),
}

#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct WorkDetailSchema {
    pub work: Work,
    pub children: WorkChildrenSchema,
    /// The resolved `MediaFile` id for a movie's own leaf (`LeafRef::Work`);
    /// always `None` for series/artist/author works, whose playable leaves
    /// are their children instead -- see `playarr_catalog::WorkDetail`.
    pub media_file_id: Option<Uuid>,
    /// Fixed source-container runtime for a movie. Series runtimes are
    /// exposed on each `EpisodeDetailSchema`.
    pub runtime_ms: Option<u64>,
    /// Cross-peer availability for `work` (§4.3) -- empty for a deployment
    /// not part of a peer group.
    pub available_on: Vec<AvailabilityBadge>,
}

#[utoipa::path(
    get,
    path = "/api/v1/catalog",
    tag = "catalog",
    params(BrowseQueryParams),
    responses(
        (status = 200, description = "A page of catalog works", body = CatalogPageSchema, example = json!({
            "items": [{
                "id": "4c9e2a1b-7f3d-4e6a-9b2c-8d5f1e3a7c90",
                "kind": "movie",
                "external_refs": [{"provider": "tmdb", "external_id": "155"}],
                "title": "The Test Film",
                "sort_title": "Test Film, The",
                "overview": "Sample Vigilante raises the stakes in his war on crime with the help of Lt. Jim Gordon and District Attorney Harvey Dent.",
                "images": [{
                    "kind": "poster",
                    "url": "https://image.tmdb.org/t/p/original/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
                    "width": 2000,
                    "height": 3000
                }],
                "genres": ["Action", "Crime", "Drama"],
                "tags": [],
                "added_at": "2024-01-15T10:30:00Z",
                "release_date": "2008-07-16T00:00:00Z",
                "monitored": true,
                "availability": "available"
            }],
            "total": 1
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn browse_catalog_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(params): Query<BrowseQueryParams>,
) -> Result<Json<playarr_catalog::CatalogPage>, ApiError> {
    let allowed = viewer.allowed_libraries();
    let mut query: BrowseQuery = params.into();
    query.allowed_source_instance_ids = allowed;
    // §4.3's partial-cache-node union: which `GroupLibrary`s this caller's
    // own `Policy::group_library_allow` grants -- an admin's `Vec::new()`
    // default union in nothing extra here, same conservative "no automatic
    // everything" choice `CatalogViewer::allowed_libraries` does NOT make
    // for `library_allow` (that one bypasses for `is_admin`); unlike that
    // check, this is choosing what to *additionally show*, not what to
    // *gate*, so there's no access-control reason to special-case admins.
    query.group_library_ids = viewer.policy.group_library_allow.clone();
    let page = state.catalog.browse(query).await?;
    Ok(Json(page))
}

#[utoipa::path(
    get,
    path = "/api/v1/catalog/kinds",
    tag = "catalog",
    responses(
        (status = 200, description = "Configured catalog kinds visible to the caller", body = Vec<WorkKind>, example = json!(["movie", "series"])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn catalog_kinds_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<Json<Vec<WorkKind>>, ApiError> {
    let allowed = viewer.allowed_libraries();
    let configured = state
        .source_instances
        .all()
        .into_iter()
        .filter(|instance| {
            allowed
                .as_ref()
                .is_none_or(|ids| ids.contains(&instance.id))
        })
        .filter_map(|instance| {
            playarr_arr_sync::arr_client::work_kind_and_provider(instance.kind)
                .map(|(kind, _)| kind)
        })
        .collect::<HashSet<_>>();
    let kinds = [
        WorkKind::Movie,
        WorkKind::Series,
        WorkKind::Site,
        WorkKind::Artist,
        WorkKind::Author,
    ]
    .into_iter()
    .filter(|kind| configured.contains(kind))
    .collect();
    Ok(Json(kinds))
}

#[utoipa::path(
    get,
    path = "/api/v1/catalog/{id}",
    tag = "catalog",
    params(("id" = Uuid, Path, description = "Work id")),
    responses(
        (status = 200, description = "A work and its full kind-specific tree", body = WorkDetailSchema, example = json!({
            "work": {
                "id": "4c9e2a1b-7f3d-4e6a-9b2c-8d5f1e3a7c90",
                "kind": "movie",
                "external_refs": [{"provider": "tmdb", "external_id": "155"}],
                "title": "The Test Film",
                "sort_title": "Test Film, The",
                "overview": "Sample Vigilante raises the stakes in his war on crime with the help of Lt. Jim Gordon and District Attorney Harvey Dent.",
                "images": [{
                    "kind": "poster",
                    "url": "https://image.tmdb.org/t/p/original/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
                    "width": 2000,
                    "height": 3000
                }],
                "genres": ["Action", "Crime", "Drama"],
                "tags": [],
                "added_at": "2024-01-15T10:30:00Z",
                "release_date": "2008-07-16T00:00:00Z",
                "monitored": true,
                "availability": "available"
            },
            "children": "Movie",
            "media_file_id": "5d8f2a91-3c7e-4b6a-8f1d-2e9c4a7b3f60",
            "runtime_ms": 9120000
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No work with this id")
    )
)]
pub async fn get_work_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkDetail>, ApiError> {
    let allowed = viewer.allowed_libraries();
    let detail = state.catalog.get_by_id(id, allowed.as_deref()).await?;
    Ok(Json(detail))
}

/// Also unions in the partial-cache-node [`RemoteOnlyWork`] case (§4.3):
/// titles a full peer reports but this node has zero local record of,
/// scoped to the caller's own `Policy::group_library_allow` -- see
/// `playarr_catalog::CatalogService::search_remote_only`'s doc comment.
#[utoipa::path(
    get,
    path = "/api/v1/catalog/search",
    tag = "catalog",
    params(SearchQueryParams),
    responses(
        (status = 200, description = "Matching works, plus any partial-cache-node remote-only titles", body = SearchResponse, example = json!({
            "items": [{
                "id": "4c9e2a1b-7f3d-4e6a-9b2c-8d5f1e3a7c90",
                "kind": "movie",
                "external_refs": [{"provider": "tmdb", "external_id": "155"}],
                "title": "The Test Film",
                "sort_title": "Test Film, The",
                "overview": "Sample Vigilante raises the stakes in his war on crime with the help of Lt. Jim Gordon and District Attorney Harvey Dent.",
                "images": [{
                    "kind": "poster",
                    "url": "https://image.tmdb.org/t/p/original/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
                    "width": 2000,
                    "height": 3000
                }],
                "genres": ["Action", "Crime", "Drama"],
                "tags": [],
                "added_at": "2024-01-15T10:30:00Z",
                "release_date": "2008-07-16T00:00:00Z",
                "monitored": true,
                "availability": "available"
            }],
            "remote_only": []
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn search_catalog_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(params): Query<SearchQueryParams>,
) -> Result<Json<SearchResponse>, ApiError> {
    let allowed = viewer.allowed_libraries();
    let limit = params.limit.unwrap_or(25);
    let items = state
        .catalog
        .search(&params.q, limit, allowed.as_deref())
        .await?;
    let remote_only = state
        .catalog
        .search_remote_only(&params.q, &viewer.policy.group_library_allow)
        .await?
        .into_iter()
        .map(RemoteOnlyWork::from)
        .collect();
    Ok(Json(SearchResponse { items, remote_only }))
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct SimilarQueryParams {
    pub limit: Option<i64>,
}

/// "What else is like this" -- semantic similarity over a locally-cached
/// embedding (see `playarr_model::embedding`'s module doc comment), not
/// genre/tag overlap. `404`s both for an unknown work id and for one that
/// hasn't been embedded yet (not yet synced, or this deployment hasn't
/// configured embedding generation) -- `playarr_catalog::CatalogService::
/// similar`'s doc comment covers why those collapse to one status here
/// rather than a distinct "not available" shape. Like `search`, a
/// restricted caller's results silently omit works outside their
/// `CatalogViewer::allowed_libraries` rather than surfacing them.
#[utoipa::path(
    get,
    path = "/api/v1/catalog/{id}/similar",
    tag = "catalog",
    params(("id" = Uuid, Path, description = "Work id"), SimilarQueryParams),
    responses(
        (status = 200, description = "Works ranked by semantic similarity to this one", body = Vec<Work>, example = json!([{
            "id": "6b1e4f83-2a9c-4d7e-8b3f-1c6a9e2d4b70",
            "kind": "movie",
            "external_refs": [{"provider": "tmdb", "external_id": "272"}],
            "title": "Sample Movie Hotel",
            "sort_title": "Sample Movie Hotel",
            "overview": "After training with his mentor, Sample Vigilante begins his fight to free crime-ridden Gotham City from corruption.",
            "images": [{
                "kind": "poster",
                "url": "https://image.tmdb.org/t/p/original/dr6x4GyyESClpG4RG3aSVSXVMlv.jpg",
                "width": 2000,
                "height": 3000
            }],
            "genres": ["Action", "Crime", "Drama"],
            "tags": [],
            "added_at": "2024-01-10T08:15:00Z",
            "release_date": "2005-06-15T00:00:00Z",
            "monitored": true,
            "availability": "available"
        }])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No work with this id, or it has no cached embedding yet")
    )
)]
pub async fn similar_works_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
    Query(params): Query<SimilarQueryParams>,
) -> Result<Json<Vec<Work>>, ApiError> {
    let allowed = viewer.allowed_libraries();
    let results = state
        .catalog
        .similar(id, params.limit.unwrap_or(20), allowed.as_deref())
        .await?;
    Ok(Json(results))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_media_file, seed_movie,
        seed_streaming_user, seed_streaming_user_with_library_allow, test_state,
    };
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use playarr_model::{media::LeafRef, Sensitive, SourceInstance, SourceKind};
    use tower::ServiceExt;

    fn source_instance(id: Uuid, kind: SourceKind) -> SourceInstance {
        SourceInstance {
            id,
            kind,
            name: format!("{kind:?}"),
            base_url: "http://localhost".to_string(),
            api_key_encrypted: Sensitive::new("test-key".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        }
    }

    #[tokio::test]
    async fn browse_returns_seeded_movie() {
        let (router, state) = test_state().await;
        let movie_id = seed_movie(&state, "Seeded Movie").await;
        let source_instance_id = Uuid::new_v4();
        seed_media_file(&state, movie_id, LeafRef::Work, source_instance_id).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog?kind=movie&available_only=true")
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
        let page: playarr_catalog::CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].title, "Seeded Movie");
    }

    #[tokio::test]
    async fn browse_filters_by_source_instance_id() {
        let (router, state) = test_state().await;
        let instance_a = Uuid::new_v4();
        let instance_b = Uuid::new_v4();

        let movie_a = seed_movie(&state, "From Instance A").await;
        let movie_b = seed_movie(&state, "From Instance B").await;
        seed_media_file(&state, movie_a, LeafRef::Work, instance_a).await;
        seed_media_file(&state, movie_b, LeafRef::Work, instance_b).await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![instance_a, instance_b]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog?source_instance_id={instance_a}"))
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
        let page: playarr_catalog::CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, movie_a);
    }

    #[tokio::test]
    async fn get_missing_work_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{}", Uuid::new_v4()))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn search_finds_seeded_movie_by_title() {
        let (router, state) = test_state().await;
        let movie_id = seed_movie(&state, "Findable Title").await;
        let source_instance_id = Uuid::new_v4();
        seed_media_file(&state, movie_id, LeafRef::Work, source_instance_id).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog/search?q=findable")
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
        let results: SearchResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(results.items.len(), 1);
        assert!(results.remote_only.is_empty());
    }

    #[tokio::test]
    async fn catalog_kinds_only_returns_configured_kinds_in_allowed_libraries() {
        let (router, state) = test_state().await;
        let radarr_id = Uuid::new_v4();
        let whisparr_id = Uuid::new_v4();
        let sonarr_id = Uuid::new_v4();
        state
            .source_instances
            .upsert(source_instance(radarr_id, SourceKind::Radarr));
        state
            .source_instances
            .upsert(source_instance(whisparr_id, SourceKind::Whisparr));
        state
            .source_instances
            .upsert(source_instance(sonarr_id, SourceKind::Sonarr));

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![radarr_id, whisparr_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog/kinds")
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
        let kinds: Vec<WorkKind> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(kinds, vec![WorkKind::Movie, WorkKind::Site]);
    }

    #[tokio::test]
    async fn browse_without_token_is_unauthorized() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn browse_allows_an_admin_caller_even_without_streaming_access() {
        let (router, state) = test_state().await;
        // `CatalogViewer` (unlike `StreamingUser`, which still gates
        // playback -- see catalog.rs's module doc comment) deliberately
        // *does* let `is_admin` in here: Playarr Server Admin's own "Library"
        // screen needs to browse the catalog to verify a source instance
        // actually synced, even for an account with no `can_stream` grant
        // at all (e.g. the bootstrap admin).
        let user_id = Uuid::new_v4();
        seed_admin_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn browse_without_streaming_or_admin_access_is_forbidden() {
        let (router, state) = test_state().await;
        // A logged-in caller who is neither a streaming user nor an admin
        // (an unknown/unseeded user id resolves to "no policy at all",
        // failing closed the same way as an explicit `can_stream: false,
        // is_admin: false` policy would) must still 403.
        let user_id = Uuid::new_v4();
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    /// Per-user library access control end-to-end for `browse`: a caller
    /// whose `Policy::library_allow` names only one of two source
    /// instances sees only that instance's content -- proves
    /// `CatalogViewer::allowed_libraries()` is actually threaded through
    /// `browse_catalog_handler` into `BrowseQuery::allowed_source_instance_ids`,
    /// not just accepted and ignored.
    #[tokio::test]
    async fn browse_restricts_to_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let allowed_movie = seed_movie(&state, "Allowed Library Movie").await;
        seed_media_file(&state, allowed_movie, LeafRef::Work, allowed_instance).await;
        let other_movie = seed_movie(&state, "Other Library Movie").await;
        seed_media_file(&state, other_movie, LeafRef::Work, other_instance).await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog")
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
        let page: playarr_catalog::CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, allowed_movie);
    }

    /// A caller with an empty `library_allow` (the default for a newly
    /// provisioned account -- see `users::default_policy`'s doc comment)
    /// sees nothing, not everything: deny-all, not all-allow.
    #[tokio::test]
    async fn browse_with_empty_library_allow_returns_nothing() {
        let (router, state) = test_state().await;
        let movie_id = seed_movie(&state, "Some Movie").await;
        seed_media_file(&state, movie_id, LeafRef::Work, Uuid::new_v4()).await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, Vec::new()).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog")
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
        let page: playarr_catalog::CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert!(page.items.is_empty());
    }

    /// An admin caller's `library_allow` is bypassed entirely (same
    /// bypass-everything-except-`can_stream` semantics `is_admin` has
    /// everywhere else on `Policy`) -- confirmed here by seeding an admin
    /// whose policy carries no library grants at all yet who still sees
    /// every work.
    #[tokio::test]
    async fn browse_admin_bypasses_library_allow() {
        let (router, state) = test_state().await;
        let movie_id = seed_movie(&state, "Admin Visible Movie").await;
        seed_media_file(&state, movie_id, LeafRef::Work, Uuid::new_v4()).await;

        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await; // library_allow: Vec::new()
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog")
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
        let page: playarr_catalog::CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(page.items.len(), 1);
    }

    /// Per `docs/architecture/peer-groups.md` §5.1: a caller whose `Policy::
    /// group_library_allow` names a `GroupLibrary` this node's own
    /// `SourceInstance` is mapped onto (via `SourceInstance::
    /// group_library_id`) sees that library's content -- even with an
    /// entirely empty `library_allow`, proving the group-library grant
    /// alone (resolved through `SourceInstanceRegistry::
    /// source_instance_ids_for_group_libraries`) is sufficient, not merely
    /// additive on top of a `library_allow` grant.
    #[tokio::test]
    async fn browse_allows_a_caller_via_group_library_allow_alone() {
        let (router, state) = test_state().await;
        let source_instance_id = Uuid::new_v4();
        let group_library_id = Uuid::new_v4();
        let mut instance = source_instance(source_instance_id, SourceKind::Radarr);
        instance.group_library_id = Some(group_library_id);
        state.source_instances.upsert(instance);

        let movie_id = seed_movie(&state, "Group Library Movie").await;
        seed_media_file(&state, movie_id, LeafRef::Work, source_instance_id).await;

        let user_id = Uuid::new_v4();
        crate::test_support::seed_streaming_user_with_group_library_allow(
            &state,
            user_id,
            vec![group_library_id],
        )
        .await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog")
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
        let page: playarr_catalog::CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, movie_id);
    }

    /// Same enforcement as `browse_restricts_to_the_callers_allowed_libraries`,
    /// through `GET /api/v1/catalog/search` instead of browse.
    #[tokio::test]
    async fn search_restricts_to_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let allowed_movie = seed_movie(&state, "Findable Allowed").await;
        seed_media_file(&state, allowed_movie, LeafRef::Work, allowed_instance).await;
        let other_movie = seed_movie(&state, "Findable Other").await;
        seed_media_file(&state, other_movie, LeafRef::Work, other_instance).await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog/search?q=findable")
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
        let results: SearchResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(results.items.len(), 1);
        assert_eq!(results.items[0].id, allowed_movie);
    }

    /// Same enforcement as the browse/search tests above, through `GET
    /// /api/v1/catalog/{id}` instead: a work outside the caller's allowed
    /// libraries 404s indistinguishably from a nonexistent one, while an
    /// allowed work still resolves normally.
    #[tokio::test]
    async fn get_work_outside_allowed_libraries_is_404() {
        let (router, state) = test_state().await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let allowed_movie = seed_movie(&state, "Detail Allowed").await;
        seed_media_file(&state, allowed_movie, LeafRef::Work, allowed_instance).await;
        let other_movie = seed_movie(&state, "Detail Other").await;
        seed_media_file(&state, other_movie, LeafRef::Work, other_instance).await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        let allowed_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{allowed_movie}"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed_response.status(), StatusCode::OK);

        let other_response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{other_movie}"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(other_response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn similar_ranks_by_cached_embedding_and_excludes_self() {
        let (router, state) = test_state().await;
        let target = seed_movie(&state, "Target Movie").await;
        let close = seed_movie(&state, "Close Movie").await;
        let far = seed_movie(&state, "Far Movie").await;

        for (work_id, vector) in [
            (target, vec![1.0, 0.0, 0.0]),
            (close, vec![0.9, 0.1, 0.0]),
            (far, vec![0.0, 0.0, 1.0]),
        ] {
            state
                .embedding_repo
                .upsert(&playarr_model::WorkEmbedding {
                    work_id,
                    model_id: "test".to_string(),
                    source_text: "x".to_string(),
                    vector,
                    updated_at: chrono::Utc::now(),
                })
                .await
                .unwrap();
        }

        // Admin (unrestricted `allowed_libraries`), not a plain streaming
        // user: none of these fixture movies have a synced `MediaFile`, so
        // a restricted caller (whose `library_allow` gates on synced-file
        // source instances) would see every candidate filtered out here --
        // this test is about ranking, not library ACL enforcement (see
        // `similar_restricts_to_the_callers_allowed_libraries` for that).
        let user_id = Uuid::new_v4();
        seed_admin_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{target}/similar"))
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
        let results: Vec<Work> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Close Movie");
        assert_eq!(results[1].title, "Far Movie");
    }

    /// Same enforcement as `search_restricts_to_the_callers_allowed_libraries`,
    /// through `GET /api/v1/catalog/{id}/similar` instead: a candidate work
    /// outside the caller's `library_allow` is silently omitted from the
    /// ranked results, while one inside it still surfaces normally.
    #[tokio::test]
    async fn similar_restricts_to_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let target = seed_movie(&state, "Similar Target").await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let allowed_match = seed_movie(&state, "Similar Allowed").await;
        seed_media_file(&state, allowed_match, LeafRef::Work, allowed_instance).await;
        let other_match = seed_movie(&state, "Similar Other").await;
        seed_media_file(&state, other_match, LeafRef::Work, other_instance).await;

        for (work_id, vector) in [
            (target, vec![1.0, 0.0, 0.0]),
            (allowed_match, vec![0.9, 0.1, 0.0]),
            (other_match, vec![0.8, 0.2, 0.0]),
        ] {
            state
                .embedding_repo
                .upsert(&playarr_model::WorkEmbedding {
                    work_id,
                    model_id: "test".to_string(),
                    source_text: "x".to_string(),
                    vector,
                    updated_at: chrono::Utc::now(),
                })
                .await
                .unwrap();
        }

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{target}/similar"))
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
        let results: Vec<Work> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, allowed_match);
    }

    #[tokio::test]
    async fn similar_without_a_cached_embedding_is_404() {
        let (router, state) = test_state().await;
        let target = seed_movie(&state, "No Embedding").await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{target}/similar"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
