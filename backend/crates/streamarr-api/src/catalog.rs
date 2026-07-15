//! Catalog endpoints: `GET /api/v1/catalog`, `GET /api/v1/catalog/{id}`,
//! `GET /api/v1/catalog/search` -- thin Axum handlers over
//! [`streamarr_catalog::CatalogService`].

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use streamarr_catalog::{BrowseQuery, BrowseSort, WorkDetail};
use streamarr_model::{Album, Book, Episode, Season, Track, Work, WorkKind};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct BrowseQueryParams {
    pub kind: Option<WorkKind>,
    pub genre: Option<String>,
    pub tag: Option<String>,
    /// `"title"` (default) or `"recent"`.
    pub sort: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl From<BrowseQueryParams> for BrowseQuery {
    fn from(params: BrowseQueryParams) -> Self {
        let sort = match params.sort.as_deref() {
            Some("recent") => BrowseSort::RecentlyAdded,
            _ => BrowseSort::TitleAscending,
        };
        let defaults = BrowseQuery::default();
        BrowseQuery {
            kind: params.kind,
            genre: params.genre,
            tag: params.tag,
            sort,
            limit: params.limit.unwrap_or(defaults.limit),
            offset: params.offset.unwrap_or(defaults.offset),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct SearchQueryParams {
    pub q: String,
    pub limit: Option<i64>,
}

/// Doc-only mirror of [`streamarr_catalog::CatalogPage`] -- the real type
/// already derives `Serialize` (and is what handlers actually return), it
/// just has no `ToSchema` (`streamarr-catalog` doesn't depend on `utoipa`).
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct CatalogPageSchema {
    pub items: Vec<Work>,
    pub total: Option<i64>,
}

#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct SeasonDetailSchema {
    pub season: Season,
    pub episodes: Vec<Episode>,
}

#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct AlbumDetailSchema {
    pub album: Album,
    pub tracks: Vec<Track>,
}

/// Doc-only mirror of `streamarr_catalog::WorkChildren`; see
/// [`CatalogPageSchema`].
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub enum WorkChildrenSchema {
    Movie,
    Series(Vec<SeasonDetailSchema>),
    Artist(Vec<AlbumDetailSchema>),
    Author(Vec<Book>),
}

#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct WorkDetailSchema {
    pub work: Work,
    pub children: WorkChildrenSchema,
}

#[utoipa::path(
    get,
    path = "/api/v1/catalog",
    tag = "catalog",
    params(BrowseQueryParams),
    responses(
        (status = 200, description = "A page of catalog works", body = CatalogPageSchema)
    )
)]
pub async fn browse_catalog_handler(
    State(state): State<AppState>,
    Query(params): Query<BrowseQueryParams>,
) -> Result<Json<streamarr_catalog::CatalogPage>, ApiError> {
    let page = state.catalog.browse(params.into()).await?;
    Ok(Json(page))
}

#[utoipa::path(
    get,
    path = "/api/v1/catalog/{id}",
    tag = "catalog",
    params(("id" = Uuid, Path, description = "Work id")),
    responses(
        (status = 200, description = "A work and its full kind-specific tree", body = WorkDetailSchema),
        (status = 404, description = "No work with this id")
    )
)]
pub async fn get_work_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkDetail>, ApiError> {
    let detail = state.catalog.get_by_id(id).await?;
    Ok(Json(detail))
}

#[utoipa::path(
    get,
    path = "/api/v1/catalog/search",
    tag = "catalog",
    params(SearchQueryParams),
    responses(
        (status = 200, description = "Matching works", body = Vec<Work>)
    )
)]
pub async fn search_catalog_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchQueryParams>,
) -> Result<Json<Vec<Work>>, ApiError> {
    let results = state
        .catalog
        .search(&params.q, params.limit.unwrap_or(25))
        .await?;
    Ok(Json(results))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{seed_movie, test_state};
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn browse_returns_seeded_movie() {
        let (router, state) = test_state().await;
        seed_movie(&state, "Seeded Movie").await;

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog?kind=movie")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let page: streamarr_catalog::CatalogPage = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].title, "Seeded Movie");
    }

    #[tokio::test]
    async fn get_missing_work_is_404() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{}", Uuid::new_v4()))
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
        seed_movie(&state, "Findable Title").await;

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog/search?q=findable")
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
    }
}
