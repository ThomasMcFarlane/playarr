//! Authenticated, Playarr Server-owned source-artwork cache.
//!
//! Clients address artwork by a known catalogue identity
//! (`Work` id + `ImageKind`), never by supplying a URL. The handler resolves
//! the authoritative remote URL from the persisted `Work`, then delegates
//! the actual "download once with strict size/content-type/time limits and
//! atomically commit to durable local storage" work to
//! [`playarr_artwork::ArtworkCache`] -- the same shared implementation
//! `playarr-arr-sync`'s proactive prewarm job uses (see that crate's
//! `artwork_prewarm` module), via [`playarr_artwork::shared`] so both
//! this on-demand route and any concurrent prewarm pass dedupe against the
//! same in-flight-download lock. This keeps metadata-provider URLs and any
//! redirects out of Playarr while avoiding an arbitrary-URL proxy/SSRF
//! surface.

use std::path::Path as FsPath;

use axum::body::Body;
use axum::extract::Query;
use axum::extract::{Path, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, ETAG, IF_NONE_MATCH};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use playarr_artwork::{ArtworkCacheError, ArtworkStyle, CachedArtwork};
use playarr_catalog::WorkChildren;
use playarr_model::{ImageAsset, ImageKind, Sensitive};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth_extractor::CatalogViewer;
use crate::error::ApiError;
use crate::AppState;

const ARTWORK_CACHE_CONTROL: &str = "private, max-age=604800, stale-while-revalidate=2592000";

impl From<ArtworkCacheError> for ApiError {
    fn from(err: ArtworkCacheError) -> Self {
        match err {
            ArtworkCacheError::InvalidUrl(msg) => ApiError::internal(msg),
            ArtworkCacheError::Unreachable(msg) => ApiError::new(
                StatusCode::BAD_GATEWAY,
                "artwork_source_unreachable",
                format!("could not download source artwork: {msg}"),
            ),
            ArtworkCacheError::SourceError(status) => ApiError::new(
                StatusCode::BAD_GATEWAY,
                "artwork_source_error",
                format!("source artwork returned HTTP {status}"),
            ),
            ArtworkCacheError::TooLarge => ApiError::new(
                StatusCode::BAD_GATEWAY,
                "artwork_too_large",
                "source artwork exceeds the 12 MiB cache limit",
            ),
            ArtworkCacheError::InvalidContentType(content_type) => ApiError::new(
                StatusCode::BAD_GATEWAY,
                "invalid_artwork_content_type",
                format!("source artwork returned unsupported content type {content_type:?}"),
            ),
            ArtworkCacheError::Empty => ApiError::new(
                StatusCode::BAD_GATEWAY,
                "empty_artwork",
                "source artwork returned an empty body",
            ),
            ArtworkCacheError::Io(msg) => ApiError::internal(msg),
            ArtworkCacheError::Style(err) => ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "artwork_style_failed",
                format!("could not apply artwork style: {err}"),
            ),
        }
    }
}

/// Optional style preset for `GET /api/v1/artwork/...` routes.
///
/// Clients request a named product look (`style=stage`) instead of
/// re-implementing greyscale/contrast/brightness/fade per platform. Omit or
/// pass `original` for the raw cached source bytes.
#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
pub struct ArtworkQuery {
    /// Named bake: `original` (default) or `stage` (TV key-art greyscale blend).
    #[serde(default)]
    pub style: Option<String>,
}

fn parse_artwork_style(raw: Option<&str>) -> Result<ArtworkStyle, ApiError> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(ArtworkStyle::Original);
    };
    raw.parse::<ArtworkStyle>().map_err(|_| {
        ApiError::bad_request(format!(
            "unsupported artwork style {raw:?}; expected original or stage"
        ))
    })
}

fn parse_image_kind(raw: &str) -> Result<ImageKind, ApiError> {
    match raw {
        "poster" => Ok(ImageKind::Poster),
        "backdrop" => Ok(ImageKind::Backdrop),
        "banner" => Ok(ImageKind::Banner),
        "logo" => Ok(ImageKind::Logo),
        "thumb" => Ok(ImageKind::Thumb),
        _ => Err(ApiError::bad_request(format!(
            "unsupported artwork kind {raw}"
        ))),
    }
}

fn source_url_from_images(
    images: &[ImageAsset],
    owner: &str,
    kind: ImageKind,
) -> Result<reqwest::Url, ApiError> {
    let raw = images
        .iter()
        .find(|image| image.kind == kind)
        .map(|image| image.url.as_str())
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "{} artwork is not available for {owner}",
                playarr_artwork::image_kind_segment(kind),
            ))
        })?;
    let url = reqwest::Url::parse(raw)
        .map_err(|_| ApiError::internal("stored artwork URL is invalid"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(ApiError::internal(
            "stored artwork URL must be an absolute HTTP(S) URL",
        ));
    }
    Ok(url)
}

#[cfg(test)]
fn source_url(work: &playarr_model::Work, kind: ImageKind) -> Result<reqwest::Url, ApiError> {
    source_url_from_images(&work.images, &format!("work {}", work.id), kind)
}

enum ArtworkSource {
    Public(reqwest::Url),
    Arr {
        cache_key: String,
        url: reqwest::Url,
        api_key: Sensitive<String>,
    },
}

fn artwork_source_from_images(
    state: &AppState,
    images: &[ImageAsset],
    owner: &str,
    kind: ImageKind,
) -> Result<ArtworkSource, ApiError> {
    let raw = images
        .iter()
        .find(|image| image.kind == kind)
        .map(|image| image.url.as_str())
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "{} artwork is not available for {owner}",
                playarr_artwork::image_kind_segment(kind),
            ))
        })?;

    if let Some(locator) = playarr_artwork::parse_arr_artwork_locator(raw) {
        let instance = state
            .source_instances
            .get(locator.source_instance_id)
            .ok_or_else(|| ApiError::internal("artwork source instance is not registered"))?;
        let url =
            playarr_artwork::resolve_arr_artwork_url(&instance.base_url, instance.kind, &locator)
                .ok_or_else(|| ApiError::internal("artwork source instance URL is invalid"))?;
        return Ok(ArtworkSource::Arr {
            cache_key: raw.to_string(),
            url,
            api_key: instance.api_key_encrypted,
        });
    }

    source_url_from_images(images, owner, kind).map(ArtworkSource::Public)
}

async fn ensure_artwork_cached(
    owner_id: Uuid,
    kind: ImageKind,
    source: ArtworkSource,
    style: ArtworkStyle,
) -> Result<CachedArtwork, ApiError> {
    let cache = playarr_artwork::shared();
    match source {
        ArtworkSource::Public(url) => Ok(cache.ensure_styled(owner_id, kind, &url, style).await?),
        ArtworkSource::Arr {
            cache_key,
            url,
            api_key,
        } => Ok(cache
            .ensure_styled_with_api_key(owner_id, kind, &cache_key, &url, &api_key, style)
            .await?),
    }
}

async fn artwork_response(
    path: &FsPath,
    content_type: &'static str,
    url_hash: u64,
    style: ArtworkStyle,
    headers: &HeaderMap,
) -> Result<Response, ApiError> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| ApiError::internal(format!("could not read cached artwork: {error}")))?;
    let etag = format!(
        "\"{url_hash:016x}-{}-{:x}\"",
        style.as_str(),
        metadata.len()
    );
    if headers
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(',').any(|candidate| candidate.trim() == etag))
    {
        return Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(ETAG, etag)
            .header(CACHE_CONTROL, ARTWORK_CACHE_CONTROL)
            .body(Body::empty())
            .map_err(|error| ApiError::internal(error.to_string()));
    }

    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| ApiError::internal(format!("could not read cached artwork: {error}")))?;
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, HeaderValue::from_static(content_type))
        .header(CONTENT_LENGTH, bytes.len())
        .header(ETAG, etag)
        .header(CACHE_CONTROL, ARTWORK_CACHE_CONTROL)
        .body(Body::from(bytes))
        .map_err(|error| ApiError::internal(error.to_string()))
}

#[utoipa::path(
    get,
    path = "/api/v1/artwork/work/{work_id}/{kind}",
    tag = "catalog",
    params(
        ("work_id" = Uuid, Path, description = "Work id"),
        ("kind" = String, Path, description = "poster, backdrop, banner, logo, or thumb"),
        ArtworkQuery
    ),
    responses(
        (status = 200, description = "Playarr Server-cached source artwork (optionally style-baked)", content_type = "image/*"),
        (status = 304, description = "The caller already has the current cached artwork"),
        (status = 400, description = "Unsupported artwork kind or style"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "Unknown work or unavailable artwork kind"),
        (status = 422, description = "Source artwork could not be styled"),
        (status = 502, description = "The metadata-provider artwork could not be safely cached")
    )
)]
pub async fn work_artwork_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path((work_id, kind)): Path<(Uuid, String)>,
    Query(query): Query<ArtworkQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let kind = parse_image_kind(&kind)?;
    let style = parse_artwork_style(query.style.as_deref())?;
    let allowed = viewer.allowed_libraries();
    let detail = state.catalog.get_by_id(work_id, allowed.as_deref()).await?;
    let source = artwork_source_from_images(
        &state,
        &detail.work.images,
        &format!("work {}", detail.work.id),
        kind,
    )?;
    let cached = ensure_artwork_cached(work_id, kind, source, style).await?;
    artwork_response(
        &cached.path,
        cached.content_type,
        cached.url_hash,
        style,
        &headers,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v1/artwork/album/{artist_work_id}/{album_id}/{kind}",
    tag = "catalog",
    params(
        ("artist_work_id" = Uuid, Path, description = "Artist work id"),
        ("album_id" = Uuid, Path, description = "Album id"),
        ("kind" = String, Path, description = "poster, backdrop, banner, logo, or thumb"),
        ArtworkQuery
    ),
    responses(
        (status = 200, description = "Playarr Server-cached album artwork (optionally style-baked)", content_type = "image/*"),
        (status = 304, description = "The caller already has the current cached artwork"),
        (status = 400, description = "Unsupported artwork kind or style"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "Unknown artist, album, or unavailable artwork kind"),
        (status = 422, description = "Source artwork could not be styled"),
        (status = 502, description = "The metadata-provider artwork could not be safely cached")
    )
)]
pub async fn album_artwork_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path((artist_work_id, album_id, kind)): Path<(Uuid, Uuid, String)>,
    Query(query): Query<ArtworkQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let kind = parse_image_kind(&kind)?;
    let style = parse_artwork_style(query.style.as_deref())?;
    let allowed = viewer.allowed_libraries();
    let detail = state
        .catalog
        .get_by_id(artist_work_id, allowed.as_deref())
        .await?;
    let WorkChildren::Artist(albums) = detail.children else {
        return Err(ApiError::not_found(format!(
            "artist {artist_work_id} was not found"
        )));
    };
    let album = albums
        .iter()
        .find(|album| album.album.id == album_id)
        .ok_or_else(|| ApiError::not_found(format!("album {album_id} was not found")))?;
    let source = artwork_source_from_images(
        &state,
        &album.album.images,
        &format!("album {}", album.album.id),
        kind,
    )?;
    let cached = ensure_artwork_cached(album_id, kind, source, style).await?;
    artwork_response(
        &cached.path,
        cached.content_type,
        cached.url_hash,
        style,
        &headers,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_media_file, seed_movie, seed_streaming_user,
        seed_streaming_user_with_library_allow, test_state,
    };
    use axum::body::Body;
    use axum::http::Request;
    use playarr_model::{Availability, ImageAsset, SourceInstance, SourceKind, Work, WorkKind};
    use tower::ServiceExt;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn work_with_image(url: &str) -> Work {
        Work {
            id: Uuid::new_v4(),
            kind: WorkKind::Movie,
            external_refs: vec![],
            title: "Test".to_string(),
            sort_title: "Test".to_string(),
            overview: None,
            images: vec![ImageAsset {
                kind: ImageKind::Poster,
                url: url.to_string(),
                width: None,
                height: None,
            }],
            genres: vec![],
            tags: vec![],
            added_at: chrono::Utc::now(),
            release_date: None,
            monitored: true,
            availability: Availability::Available,
        }
    }

    #[test]
    fn only_known_image_kinds_are_accepted() {
        assert_eq!(parse_image_kind("poster").unwrap(), ImageKind::Poster);
        assert!(parse_image_kind("anything").is_err());
    }

    #[test]
    fn artwork_style_query_accepts_stage_and_defaults_to_original() {
        assert_eq!(
            parse_artwork_style(None).unwrap(),
            playarr_artwork::ArtworkStyle::Original
        );
        assert_eq!(
            parse_artwork_style(Some("stage")).unwrap(),
            playarr_artwork::ArtworkStyle::Stage
        );
        assert!(parse_artwork_style(Some("blur-extra")).is_err());
    }

    #[test]
    fn source_url_is_resolved_only_from_the_known_work() {
        let work = work_with_image("https://artworks.thetvdb.com/poster.jpg");
        assert_eq!(
            source_url(&work, ImageKind::Poster).unwrap().as_str(),
            "https://artworks.thetvdb.com/poster.jpg"
        );
        assert!(source_url(&work, ImageKind::Backdrop).is_err());
    }

    #[test]
    fn non_http_source_urls_are_rejected() {
        let work = work_with_image("file:///etc/passwd");
        assert!(source_url(&work, ImageKind::Poster).is_err());
    }

    // `content_type_extension`/`stable_url_hash` moved to
    // `playarr-artwork` along with the rest of the download-and-cache
    // logic (see that crate's own tests) -- this module only keeps the
    // API-layer concerns (kind parsing, resolving a URL off a `Work`) as
    // unit tests now.

    #[tokio::test]
    async fn artwork_route_requires_catalog_access() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Artwork Test").await;

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/artwork/work/{work_id}/poster"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn artwork_route_does_not_proxy_an_unattached_url() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "No Artwork").await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/artwork/work/{work_id}/poster"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn source_artwork_is_atomically_written_to_the_playarr_cache() {
        // Full round trip through the real route (rather than calling
        // `playarr_artwork::ArtworkCache` directly, which is now
        // `playarr-artwork`'s own responsibility to test) -- confirms
        // this crate's handler actually wires the shared cache in
        // correctly and serves back what it wrote.
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/poster.jpg"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "image/jpeg")
                    .set_body_bytes([0xff, 0xd8, 0xff, 0xd9]),
            )
            .expect(1)
            .mount(&mock)
            .await;

        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Artwork Fetch Test").await;
        let mut work = state.work_repo.get(work_id).await.unwrap();
        work.images = vec![ImageAsset {
            kind: ImageKind::Poster,
            url: format!("{}/poster.jpg", mock.uri()),
            width: None,
            height: None,
        }];
        state.work_repo.upsert(&work).await.unwrap();
        let source_instance_id = Uuid::new_v4();
        seed_media_file(
            &state,
            work_id,
            playarr_model::media::LeafRef::Work,
            source_instance_id,
        )
        .await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/artwork/work/{work_id}/poster"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(CONTENT_TYPE).unwrap(), "image/jpeg");
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], [0xff, 0xd8, 0xff, 0xd9]);
    }

    #[tokio::test]
    async fn arr_local_artwork_is_fetched_with_the_source_api_key() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/mediacover/artist/7/fanart.jpg"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("location", "/MediaCover/7/fanart-final.jpg"),
            )
            .expect(1)
            .mount(&mock)
            .await;
        Mock::given(method("GET"))
            .and(path("/MediaCover/7/fanart-final.jpg"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "image/jpeg")
                    .set_body_bytes([0xff, 0xd8, 0xff, 0xd9]),
            )
            .expect(1)
            .mount(&mock)
            .await;

        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Authenticated Artwork Fetch Test").await;
        let source_instance_id = Uuid::new_v4();
        state.source_instances.upsert(SourceInstance {
            id: source_instance_id,
            kind: SourceKind::Lidarr,
            name: "Test Lidarr".to_string(),
            base_url: mock.uri(),
            api_key_encrypted: Sensitive::new("test-key".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        });
        let mut work = state.work_repo.get(work_id).await.unwrap();
        work.images = vec![ImageAsset {
            kind: ImageKind::Backdrop,
            url: playarr_artwork::arr_artwork_locator(
                source_instance_id,
                "/MediaCover/7/fanart.jpg",
            )
            .unwrap(),
            width: None,
            height: None,
        }];
        state.work_repo.upsert(&work).await.unwrap();
        seed_media_file(
            &state,
            work_id,
            playarr_model::media::LeafRef::Work,
            source_instance_id,
        )
        .await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);
        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/artwork/work/{work_id}/backdrop"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(CONTENT_TYPE).unwrap(), "image/jpeg");
    }
}
