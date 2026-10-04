//! "Views" -- named, saved filter+sort presets over the catalog, surfaced
//! to Playarr as browsable shelves (e.g. "Newly Added", "Newly Released").
//! Global/admin-managed, not per-user -- see
//! `playarr_model::LibraryView`'s doc comment for the full rationale and
//! `playarr_catalog::CatalogService::resolve_view` for how a saved view
//! actually becomes real `Work` rows.
//!
//! Routes:
//! - `POST/GET /api/v1/admin/views` (create / full-projection list) --
//!   [`AdminUser`]-gated, same as `admin.rs`'s source-instance endpoints.
//! - `PUT/DELETE /api/v1/admin/views/{id}` (update / delete) -- also
//!   [`AdminUser`]-gated; delete 409s for a seeded default view (see
//!   [`delete_view_handler`]).
//! - `GET /api/v1/views` (minimal-projection list) and
//!   `GET /api/v1/views/{id}/resolve` (run it) -- [`CatalogViewer`]-gated,
//!   exactly like `catalog.rs`'s browse/search/detail endpoints: real
//!   Playarr streaming access OR an admin account.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};
use playarr_catalog::CatalogPage;
use playarr_model::{LibraryView, ViewCriteria, ViewSort, WorkKind};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{AdminUser, CatalogViewer};
use crate::error::ApiError;
use crate::AppState;

fn sort_to_str(sort: ViewSort) -> &'static str {
    match sort {
        ViewSort::TitleAscending => "title",
        ViewSort::TitleDescending => "title_desc",
        ViewSort::RecentlyAdded => "recent",
        ViewSort::OldestAdded => "oldest",
        ViewSort::RecentlyReleased => "released",
        ViewSort::LastPlayedByUser => "last_played",
    }
}

/// Unrecognized falls back to `TitleAscending` -- the same default
/// `library_views.sort`'s own storage layer falls back to (see
/// `playarr_db::repo::library_view::view_sort_key_from_str`'s legacy-
/// format handling), so an unrecognized key degrades the same way at every
/// layer rather than erroring the whole request over one bad element.
fn sort_key_from_str(raw: &str) -> ViewSort {
    match raw {
        "title_desc" => ViewSort::TitleDescending,
        "recent" => ViewSort::RecentlyAdded,
        "oldest" => ViewSort::OldestAdded,
        "released" => ViewSort::RecentlyReleased,
        "last_played" => ViewSort::LastPlayedByUser,
        _ => ViewSort::TitleAscending,
    }
}

/// Empty/omitted both fall back to `[TitleAscending]` -- see
/// `LibraryView::sort`'s own doc comment for why this is never actually
/// empty once it reaches the domain type.
fn sort_list_from_dto(raw: &[String]) -> Vec<ViewSort> {
    if raw.is_empty() {
        vec![ViewSort::TitleAscending]
    } else {
        raw.iter().map(|s| sort_key_from_str(s)).collect()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct ViewCriteriaDto {
    pub kind: Option<WorkKind>,
    pub source_instance_id: Option<Uuid>,
    pub genre: Option<String>,
    pub tag: Option<String>,
    #[serde(default)]
    pub available_only: bool,
    /// Only include works whose `release_date` falls within the last N
    /// days. `None` = no window restriction.
    pub release_window_days: Option<i64>,
    /// Canonical audio language codes (e.g. `"ja"`); empty = any.
    #[serde(default)]
    pub audio_languages: Vec<String>,
    /// Canonical subtitle language codes; empty = any.
    #[serde(default)]
    pub subtitle_languages: Vec<String>,
    /// Require every listed language instead of any of them.
    #[serde(default)]
    pub language_match_all: bool,
    /// Require each wanted language on every file of the work.
    #[serde(default)]
    pub language_every_file: bool,
    /// Hide works the viewer has already watched (per-user).
    #[serde(default)]
    pub unwatched_only: bool,
}

impl From<ViewCriteriaDto> for ViewCriteria {
    fn from(dto: ViewCriteriaDto) -> Self {
        ViewCriteria {
            kind: dto.kind,
            source_instance_id: dto.source_instance_id,
            genre: dto.genre,
            tag: dto.tag,
            available_only: dto.available_only,
            release_window_days: dto.release_window_days,
            audio_languages: dto.audio_languages,
            subtitle_languages: dto.subtitle_languages,
            language_match_all: dto.language_match_all,
            language_every_file: dto.language_every_file,
            unwatched_only: dto.unwatched_only,
        }
    }
}

impl From<ViewCriteria> for ViewCriteriaDto {
    fn from(criteria: ViewCriteria) -> Self {
        ViewCriteriaDto {
            kind: criteria.kind,
            source_instance_id: criteria.source_instance_id,
            genre: criteria.genre,
            tag: criteria.tag,
            available_only: criteria.available_only,
            release_window_days: criteria.release_window_days,
            audio_languages: criteria.audio_languages,
            subtitle_languages: criteria.subtitle_languages,
            language_match_all: criteria.language_match_all,
            language_every_file: criteria.language_every_file,
            unwatched_only: criteria.unwatched_only,
        }
    }
}

/// Request body for both create (`POST /api/v1/admin/views`) and update
/// (`PUT /api/v1/admin/views/{id}`). Structurally has no `is_default`/
/// `default_order` fields, so an admin can never set them through this
/// endpoint -- enforced by omission, not a runtime check (see
/// [`create_view_handler`]/[`update_view_handler`]'s doc comments).
#[derive(Debug, Deserialize, ToSchema)]
pub struct LibraryViewRequest {
    pub name: String,
    pub criteria: ViewCriteriaDto,
    /// Ordered, most-significant first -- each element one of `"title"` |
    /// `"title_desc"` | `"recent"` | `"oldest"` | `"released"` |
    /// `"last_played"`, same free-string convention as
    /// `catalog::BrowseQueryParams::sort`, not a typed enum on the wire.
    /// Empty/omitted defaults to `["title"]`. `"last_played"` orders by
    /// *each resolving viewer's own* last-played time (see
    /// `playarr_model::ViewSort::LastPlayedByUser`'s doc comment) --
    /// picking it here means every caller who resolves this view sees it
    /// personalized to them, not a single shared order.
    #[serde(default)]
    pub sort: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LibraryViewResponse {
    pub id: Uuid,
    pub name: String,
    pub criteria: ViewCriteriaDto,
    /// Same ordered, most-significant-first string list `LibraryViewRequest::sort` accepts.
    pub sort: Vec<String>,
    pub is_default: bool,
    pub default_order: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<LibraryView> for LibraryViewResponse {
    fn from(view: LibraryView) -> Self {
        LibraryViewResponse {
            id: view.id,
            name: view.name,
            criteria: view.criteria.into(),
            sort: view
                .sort
                .iter()
                .copied()
                .map(sort_to_str)
                .map(String::from)
                .collect(),
            is_default: view.is_default,
            default_order: view.default_order,
            created_at: view.created_at,
            updated_at: view.updated_at,
        }
    }
}

/// Public/Playarr-facing list projection -- deliberately doesn't expose
/// `criteria` (Playarr never needs to interpret filter internals, only
/// call `resolve`).
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ViewSummary {
    pub id: Uuid,
    pub name: String,
    pub is_default: bool,
    pub default_order: Option<i32>,
}

impl From<LibraryView> for ViewSummary {
    fn from(view: LibraryView) -> Self {
        ViewSummary {
            id: view.id,
            name: view.name,
            is_default: view.is_default,
            default_order: view.default_order,
        }
    }
}

/// Shared display ordering for both the admin (`GET /api/v1/admin/views`)
/// and public (`GET /api/v1/views`) list handlers, so Playarr's shelf order
/// always matches what the admin UI shows: seeded default views first
/// (ordered by `default_order` ascending), then every admin-created custom
/// view, alphabetically by name (case-insensitive). Deliberately computed
/// here rather than in SQL -- see `playarr_db::repo::library_view::
/// LibraryViewRepo::list`'s own doc comment for why.
fn sort_views_for_display(mut views: Vec<LibraryView>) -> Vec<LibraryView> {
    views.sort_by(|a, b| match (a.is_default, b.is_default) {
        (true, true) => a.default_order.cmp(&b.default_order),
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (false, false) => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    views
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct ResolveViewQueryParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Doc-only mirror of `playarr_catalog::CatalogPage` -- see
/// `catalog::CatalogPageSchema`'s own doc comment for why this can't just
/// derive `ToSchema` on the real type.
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct CatalogPageSchema {
    pub items: Vec<playarr_model::Work>,
    pub total: Option<i64>,
}

/// Creates a new, admin-authored view. `is_default` is always `false` and
/// `default_order` is always `None` for a view created through this
/// endpoint -- both are set only by the boot-time seed step (see
/// `playarr_db::repo::library_view::seed_default_views`).
#[utoipa::path(
    post,
    path = "/api/v1/admin/views",
    tag = "views",
    request_body(content = LibraryViewRequest, example = json!({
        "name": "Newly Added Action",
        "criteria": {
            "kind": "movie",
            "source_instance_id": null,
            "genre": "Action",
            "tag": null,
            "available_only": true,
            "release_window_days": 30
        },
        "sort": ["recent"]
    })),
    responses(
        (status = 200, description = "The created view", body = LibraryViewResponse, example = json!({
            "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "name": "Newly Added Action",
            "criteria": {
                "kind": "movie",
                "source_instance_id": null,
                "genre": "Action",
                "tag": null,
                "available_only": true,
                "release_window_days": 30
            },
            "sort": ["recent"],
            "is_default": false,
            "default_order": null,
            "created_at": "2026-01-15T12:00:00Z",
            "updated_at": "2026-01-15T12:00:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn create_view_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<LibraryViewRequest>,
) -> Result<Json<LibraryViewResponse>, ApiError> {
    let now = Utc::now();
    let view = LibraryView {
        id: Uuid::new_v4(),
        name: body.name,
        criteria: body.criteria.into(),
        sort: sort_list_from_dto(&body.sort),
        is_default: false,
        default_order: None,
        created_at: now,
        updated_at: now,
    };
    state.library_view_repo.upsert(&view).await?;
    Ok(Json(view.into()))
}

/// Every view, full projection (including `criteria`) -- the admin list
/// screen. Ordered by [`sort_views_for_display`].
#[utoipa::path(
    get,
    path = "/api/v1/admin/views",
    tag = "views",
    responses(
        (status = 200, description = "Every view, full projection, in display order", body = Vec<LibraryViewResponse>, example = json!([
            {
                "id": "8f14e45f-ceea-467e-adc0-8b95e6b0a0f1",
                "name": "Newly Added",
                "criteria": {
                    "kind": null,
                    "source_instance_id": null,
                    "genre": null,
                    "tag": null,
                    "available_only": true,
                    "release_window_days": null
                },
                "sort": ["recent"],
                "is_default": true,
                "default_order": 0,
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z"
            },
            {
                "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "name": "Newly Added Action",
                "criteria": {
                    "kind": "movie",
                    "source_instance_id": null,
                    "genre": "Action",
                    "tag": null,
                    "available_only": true,
                    "release_window_days": 30
                },
                "sort": ["recent"],
                "is_default": false,
                "default_order": null,
                "created_at": "2026-01-15T12:00:00Z",
                "updated_at": "2026-01-15T12:00:00Z"
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_admin_views_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<LibraryViewResponse>>, ApiError> {
    let views = state.library_view_repo.list().await?;
    Ok(Json(
        sort_views_for_display(views)
            .into_iter()
            .map(LibraryViewResponse::from)
            .collect(),
    ))
}

/// Updates a view's `name`/`criteria`/`sort` in place, preserving `id`/
/// `is_default`/`default_order`/`created_at`. This means an admin **can**
/// rename/retune a default view's criteria -- only deletion is blocked (see
/// [`delete_view_handler`]) since Playarr's Home shelves depend on the id
/// remaining resolvable.
#[utoipa::path(
    put,
    path = "/api/v1/admin/views/{id}",
    tag = "views",
    params(("id" = Uuid, Path, description = "View id")),
    request_body(content = LibraryViewRequest, example = json!({
        "name": "Renamed View",
        "criteria": {
            "kind": "movie",
            "source_instance_id": null,
            "genre": "Comedy",
            "tag": null,
            "available_only": true,
            "release_window_days": null
        },
        "sort": ["title"]
    })),
    responses(
        (status = 200, description = "The updated view", body = LibraryViewResponse, example = json!({
            "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "name": "Renamed View",
            "criteria": {
                "kind": "movie",
                "source_instance_id": null,
                "genre": "Comedy",
                "tag": null,
                "available_only": true,
                "release_window_days": null
            },
            "sort": ["title"],
            "is_default": false,
            "default_order": null,
            "created_at": "2026-01-15T12:00:00Z",
            "updated_at": "2026-01-20T09:45:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No view with this id")
    )
)]
pub async fn update_view_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<LibraryViewRequest>,
) -> Result<Json<LibraryViewResponse>, ApiError> {
    let existing = state.library_view_repo.get(id).await?;
    let updated = LibraryView {
        id: existing.id,
        name: body.name,
        criteria: body.criteria.into(),
        sort: sort_list_from_dto(&body.sort),
        is_default: existing.is_default,
        default_order: existing.default_order,
        created_at: existing.created_at,
        updated_at: Utc::now(),
    };
    state.library_view_repo.upsert(&updated).await?;
    state.home_rails_cache.invalidate_all().await;
    Ok(Json(updated.into()))
}

/// Deletes a custom (non-default) view. Rejects with `409 Conflict` for a
/// seeded default view -- Playarr's Home shelves depend on those ids
/// remaining resolvable; an admin who wants to change one should rename/
/// retune it via [`update_view_handler`] instead.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/views/{id}",
    tag = "views",
    params(("id" = Uuid, Path, description = "View id")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No view with this id"),
        (status = 409, description = "This is a seeded default view and cannot be deleted")
    )
)]
pub async fn delete_view_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let existing = state.library_view_repo.get(id).await?;
    if existing.is_default {
        return Err(ApiError::conflict("default views cannot be deleted"));
    }
    state.library_view_repo.delete(id).await?;
    // Custom Home rails built on this view go with it.
    state.home_rail_repo.delete_for_view(id).await?;
    state.home_rails_cache.invalidate_all().await;
    Ok(StatusCode::NO_CONTENT)
}

/// Every view, minimal projection -- the Playarr-facing shelf list. Ordered
/// by [`sort_views_for_display`], identically to the admin list, so
/// Playarr's shelf order always matches what the admin UI shows.
#[utoipa::path(
    get,
    path = "/api/v1/views",
    tag = "views",
    responses(
        (status = 200, description = "Every view, minimal projection, in display order", body = Vec<ViewSummary>, example = json!([
            {
                "id": "8f14e45f-ceea-467e-adc0-8b95e6b0a0f1",
                "name": "Newly Added",
                "is_default": true,
                "default_order": 0
            },
            {
                "id": "0c85e0f1-9c6e-4b3a-9a6b-4a1f2e9c7d3b",
                "name": "Newly Released",
                "is_default": true,
                "default_order": 1
            },
            {
                "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "name": "Newly Added Action",
                "is_default": false,
                "default_order": null
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn list_views_handler(
    State(state): State<AppState>,
    _viewer: CatalogViewer,
) -> Result<Json<Vec<ViewSummary>>, ApiError> {
    let views = state.library_view_repo.list().await?;
    Ok(Json(
        sort_views_for_display(views)
            .into_iter()
            .map(ViewSummary::from)
            .collect(),
    ))
}

/// Runs a saved view's criteria+sort against the live catalog (via
/// `CatalogService::resolve_view`) and returns a page of results, identical
/// in shape to `GET /api/v1/catalog`. Also passes `viewer.allowed_libraries()`
/// through, so a resolved view is silently narrowed to the caller's
/// per-user library access control ceiling exactly like `GET /api/v1/
/// catalog` itself is -- a saved view is just a stored `BrowseQuery` shape,
/// not a separate enforcement boundary (see `CatalogService::resolve_view`'s
/// doc comment).
#[utoipa::path(
    get,
    path = "/api/v1/views/{id}/resolve",
    tag = "views",
    params(("id" = Uuid, Path, description = "View id"), ResolveViewQueryParams),
    responses(
        (status = 200, description = "A page of catalog works matching this view", body = CatalogPageSchema, example = json!({
            "items": [
                {
                    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                    "kind": "movie",
                    "external_refs": [
                        { "provider": "tmdb", "external_id": "603" }
                    ],
                    "title": "Sample Movie Kilo",
                    "sort_title": "Matrix, The",
                    "overview": "A computer hacker learns about the true nature of reality.",
                    "images": [
                        {
                            "kind": "poster",
                            "url": "https://image.tmdb.org/t/p/original/poster.jpg",
                            "width": 500,
                            "height": 750
                        }
                    ],
                    "genres": ["Action", "Science Fiction"],
                    "tags": [],
                    "added_at": "2026-01-10T08:30:00Z",
                    "release_date": "1999-03-31T00:00:00Z",
                    "monitored": true,
                    "availability": "available"
                }
            ],
            "total": 1
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No view with this id")
    )
)]
pub async fn resolve_view_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
    Query(params): Query<ResolveViewQueryParams>,
) -> Result<Json<CatalogPage>, ApiError> {
    let view = state.library_view_repo.get(id).await?;
    let defaults = playarr_catalog::BrowseQuery::default();
    let gate = state
        .household
        .gate_for(&viewer.policy, viewer.user_id)
        .await
        .map(|g| playarr_catalog::SharedGate(g));
    let page = state
        .catalog
        .resolve_view_with(
            &view,
            Some(viewer.user_id),
            params.limit.unwrap_or(defaults.limit),
            params.offset.unwrap_or(defaults.offset),
            viewer.allowed_libraries(),
            gate,
        )
        .await?;
    Ok(Json(page))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_media_file, seed_movie,
        seed_streaming_user, seed_streaming_user_with_library_allow, test_state,
    };
    use axum::body::Body;
    use axum::http::Request;
    use playarr_model::media::LeafRef;
    use tower::ServiceExt;

    #[tokio::test]
    async fn create_requires_admin() {
        let (router, state) = test_state().await;
        let token = mint_access_token(&state, Uuid::new_v4());

        let body = serde_json::json!({
            "name": "My View",
            "criteria": {},
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/views")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn create_without_token_is_unauthorized() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/views")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"name": "x", "criteria": {}}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn create_update_delete_round_trip_as_admin() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let create_body = serde_json::json!({
            "name": "Action Movies",
            "criteria": { "kind": "movie", "genre": "Action" },
            "sort": ["recent"],
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/views")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(create_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: LibraryViewResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(created.name, "Action Movies");
        assert!(!created.is_default);
        assert_eq!(created.default_order, None);

        // List (admin projection) contains it.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/views")
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
        let listed: Vec<LibraryViewResponse> = serde_json::from_slice(&bytes).unwrap();
        assert!(listed.iter().any(|v| v.id == created.id));

        // Update.
        let update_body = serde_json::json!({
            "name": "Renamed",
            "criteria": { "kind": "movie", "genre": "Comedy" },
            "sort": ["title"],
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/admin/views/{}", created.id))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(update_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let updated: LibraryViewResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.criteria.genre.as_deref(), Some("Comedy"));

        // Delete.
        let response = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/admin/views/{}", created.id))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn deleting_a_default_view_is_conflict() {
        // `test_state()` already seeds the two real defaults ("Newly
        // Added"/"Newly Released" -- see its own doc comment on real-boot
        // parity), so this test exercises deletion against one of *those*
        // rather than manufacturing a same-named duplicate (which would
        // collide with `library_views`' unique `name` index).
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let default_view = state
            .app
            .library_view_repo
            .get(playarr_db::repo::NEWLY_ADDED_VIEW_ID)
            .await
            .unwrap();
        assert!(default_view.is_default);

        let response = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/admin/views/{}", default_view.id))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn public_list_is_reachable_by_streaming_only_caller() {
        // `test_state()` already seeds the two real defaults, so a fresh
        // custom view brings the total to three, not one -- see
        // `deleting_a_default_view_is_conflict`'s doc comment.
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let view = playarr_model::LibraryView {
            id: Uuid::new_v4(),
            name: "Custom".to_string(),
            criteria: ViewCriteria::default(),
            sort: vec![ViewSort::TitleAscending],
            is_default: false,
            default_order: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        state.app.library_view_repo.upsert(&view).await.unwrap();

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/views")
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
        let summaries: Vec<ViewSummary> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(summaries.len(), 3);
        assert!(summaries
            .iter()
            .any(|v| v.name == "Custom" && !v.is_default));
    }

    #[tokio::test]
    async fn public_list_orders_defaults_first_then_alphabetical_custom() {
        // Builds on top of `test_state()`'s already-seeded "Newly Added"
        // (order 0) / "Newly Released" (order 1) defaults rather than
        // manufacturing same-named duplicates -- see
        // `deleting_a_default_view_is_conflict`'s doc comment.
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let now = Utc::now();
        let zeta = playarr_model::LibraryView {
            id: Uuid::new_v4(),
            name: "Zeta Custom".to_string(),
            criteria: ViewCriteria::default(),
            sort: vec![ViewSort::TitleAscending],
            is_default: false,
            default_order: None,
            created_at: now,
            updated_at: now,
        };
        let alpha = playarr_model::LibraryView {
            id: Uuid::new_v4(),
            name: "Alpha Custom".to_string(),
            criteria: ViewCriteria::default(),
            sort: vec![ViewSort::TitleAscending],
            is_default: false,
            default_order: None,
            created_at: now,
            updated_at: now,
        };
        for v in [&zeta, &alpha] {
            state.app.library_view_repo.upsert(v).await.unwrap();
        }

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/views")
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
        let summaries: Vec<ViewSummary> = serde_json::from_slice(&bytes).unwrap();
        let names: Vec<&str> = summaries.iter().map(|v| v.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "Newly Added",
                "Newly Released",
                "Alpha Custom",
                "Zeta Custom"
            ]
        );
    }

    #[tokio::test]
    async fn resolve_filters_by_kind_and_genre() {
        let (router, state) = test_state().await;
        let action_movie = seed_movie(&state, "Action Movie").await;
        let _comedy_movie = seed_movie(&state, "Comedy Movie").await;
        let source_instance_id = Uuid::new_v4();
        seed_media_file(&state, action_movie, LeafRef::Work, source_instance_id).await;

        // Tag the seeded movie with a genre by upserting through the real
        // WorkRepo the same way test_support's seed_movie does -- easiest
        // is to fetch and mutate.
        let mut work = state.work_repo.get(action_movie).await.unwrap();
        work.genres = vec!["Action".to_string()];
        state.work_repo.upsert(&work).await.unwrap();

        let view = playarr_model::LibraryView {
            id: Uuid::new_v4(),
            name: "Action Only".to_string(),
            criteria: ViewCriteria {
                kind: Some(WorkKind::Movie),
                genre: Some("Action".to_string()),
                ..Default::default()
            },
            sort: vec![ViewSort::TitleAscending],
            is_default: false,
            default_order: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        state.app.library_view_repo.upsert(&view).await.unwrap();

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/views/{}/resolve", view.id))
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
        let page: CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, action_movie);
    }

    /// `resolve_view_handler` threads `CatalogViewer::allowed_libraries()`
    /// into `CatalogService::resolve_view` -- a restricted caller resolving
    /// a wide-open ("everything") view still only sees works from their
    /// allowed source instance, exactly like `GET /api/v1/catalog` itself.
    #[tokio::test]
    async fn resolve_restricts_to_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let allowed_movie = seed_movie(&state, "View Allowed Movie").await;
        seed_media_file(&state, allowed_movie, LeafRef::Work, allowed_instance).await;
        let other_movie = seed_movie(&state, "View Other Movie").await;
        seed_media_file(&state, other_movie, LeafRef::Work, other_instance).await;

        let view = playarr_model::LibraryView {
            id: Uuid::new_v4(),
            name: "Everything".to_string(),
            criteria: ViewCriteria::default(),
            sort: vec![ViewSort::TitleAscending],
            is_default: false,
            default_order: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        state.app.library_view_repo.upsert(&view).await.unwrap();

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/views/{}/resolve", view.id))
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
        let page: CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, allowed_movie);
    }

    #[tokio::test]
    async fn resolve_recently_released_sorts_by_release_date_not_added_at() {
        let (router, state) = test_state().await;

        // Seed two movies whose added_at/release_date orderings diverge --
        // this is the test that would have caught "Newly Released is
        // secretly just Newly Added".
        let older_release_recently_added = seed_movie(&state, "Old Film, Recently Synced").await;
        let mut w1 = state
            .work_repo
            .get(older_release_recently_added)
            .await
            .unwrap();
        w1.added_at = Utc::now();
        w1.release_date = Some(Utc::now() - chrono::Duration::days(3650));
        state.work_repo.upsert(&w1).await.unwrap();
        let source_instance_1 = Uuid::new_v4();
        seed_media_file(
            &state,
            older_release_recently_added,
            LeafRef::Work,
            source_instance_1,
        )
        .await;

        let newer_release_added_long_ago = seed_movie(&state, "New Film, Synced Long Ago").await;
        let mut w2 = state
            .work_repo
            .get(newer_release_added_long_ago)
            .await
            .unwrap();
        w2.added_at = Utc::now() - chrono::Duration::days(3650);
        w2.release_date = Some(Utc::now());
        state.work_repo.upsert(&w2).await.unwrap();
        let source_instance_2 = Uuid::new_v4();
        seed_media_file(
            &state,
            newer_release_added_long_ago,
            LeafRef::Work,
            source_instance_2,
        )
        .await;

        // `test_state()` already seeds a real "Newly Released" default
        // (`ViewSort::RecentlyReleased`) -- reuse it rather than
        // manufacturing a same-named duplicate, which would collide with
        // `library_views`' unique `name` index.
        let view = state
            .app
            .library_view_repo
            .get(playarr_db::repo::NEWLY_RELEASED_VIEW_ID)
            .await
            .unwrap();
        assert_eq!(view.sort, vec![ViewSort::RecentlyReleased]);

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(
            &state,
            user_id,
            vec![source_instance_1, source_instance_2],
        )
        .await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/views/{}/resolve", view.id))
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
        let page: CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(page.items.len(), 2);
        // Most-recently-*released* first, not most-recently-*added* first.
        assert_eq!(page.items[0].id, newer_release_added_long_ago);
        assert_eq!(page.items[1].id, older_release_recently_added);
    }

    #[tokio::test]
    async fn resolve_missing_view_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/views/{}/resolve", Uuid::new_v4()))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
