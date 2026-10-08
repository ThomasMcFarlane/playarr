//! HTTP caching and compression for the JSON API.
//!
//! * [`json_cache_middleware`] gives every successful `GET` JSON response a strong `ETag` (a hash of
//!   the exact bytes sent) and answers a matching `If-None-Match` with `304 Not Modified`, so a
//!   revalidation costs a round trip but no body.
//! * It also sets `Cache-Control: private` (never a shared cache) and `Vary: Authorization`, so a
//!   browser that signs in as another user or profile (a different bearer token) can never be served
//!   the previous one's cached response.
//! * Library data (catalogue, calendar) changes only on a library sync, so it may be reused for a
//!   short while and served stale while it revalidates. Everything else, including every
//!   watch-state endpoint, is `no-cache`: always revalidated, so a watch-state change is visible on
//!   the next request.
//! * [`compression_layer`] gzips or brotli-encodes text and JSON, never media or images.
//!
//! A response that already carries its own `Cache-Control` or `ETag` (artwork, thumbnails, downloads)
//! is left exactly as the handler wrote it.

use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{
    HeaderValue, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, ETAG, IF_NONE_MATCH, VARY,
};
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use sha2::{Digest, Sha256};
use tower_http::compression::predicate::Predicate;
use tower_http::compression::CompressionLayer;

/// Responses larger than this are passed through untouched (never buffered for hashing).
const MAX_HASHED_BODY: usize = 8 * 1024 * 1024;

/// Library lists and details: reusable for 30 s, then served stale for up to 5 minutes while a
/// background revalidation refreshes them.
const LIBRARY_CACHE_CONTROL: &str = "private, max-age=30, stale-while-revalidate=300";
/// Everything per-user or mutable: stored, but revalidated on every use.
const REVALIDATE_CACHE_CONTROL: &str = "private, no-cache";

/// The `Cache-Control` a JSON `GET` under `path` should carry.
pub fn cache_control_for(path: &str) -> &'static str {
    let rest = path.strip_prefix("/api/v1/").unwrap_or(path);
    let first = rest.split('/').next().unwrap_or("");
    match first {
        // Library data only changes on a library sync. (Watch state lives under /playback and
        // /home, which are revalidated.)
        "catalog" | "calendar" => LIBRARY_CACHE_CONTROL,
        _ => REVALIDATE_CACHE_CONTROL,
    }
}

/// A strong validator for exactly these bytes.
pub fn strong_etag(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("\"{}\"", hex::encode(&digest[..16]))
}

/// `true` when `If-None-Match` (a comma-separated list, or `*`) names `etag`.
pub fn if_none_match_matches(header: &str, etag: &str) -> bool {
    header.split(',').map(str::trim).any(|candidate| {
        candidate == "*" || candidate == etag || candidate.strip_prefix("W/") == Some(etag)
    })
}

fn is_json(response: &Response) -> bool {
    response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"))
}

pub async fn json_cache_middleware(req: Request, next: Next) -> Response {
    let cacheable_request = req.method() == Method::GET && req.uri().path().starts_with("/api/");
    let path = req.uri().path().to_owned();
    let if_none_match = req
        .headers()
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let response = next.run(req).await;
    if !cacheable_request
        || response.status() != StatusCode::OK
        || !is_json(&response)
        || response.headers().contains_key(ETAG)
        || response.headers().contains_key(CACHE_CONTROL)
    {
        return response;
    }
    let exact = {
        use axum::body::HttpBody;
        response.body().size_hint().exact()
    };
    if exact.is_none_or(|size| size > MAX_HASHED_BODY as u64) {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = to_bytes(body, MAX_HASHED_BODY).await else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::empty())
            .unwrap_or_default();
    };
    let etag = strong_etag(&bytes);
    let cache_control = cache_control_for(&path);
    parts
        .headers
        .insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));
    parts
        .headers
        .append(VARY, HeaderValue::from_static("Authorization"));
    if let Ok(value) = HeaderValue::from_str(&etag) {
        parts.headers.insert(ETAG, value);
    }
    if if_none_match
        .as_deref()
        .is_some_and(|header| if_none_match_matches(header, &etag))
    {
        parts.status = StatusCode::NOT_MODIFIED;
        parts.headers.remove(CONTENT_LENGTH);
        parts.headers.remove(CONTENT_TYPE);
        return Response::from_parts(parts, Body::empty());
    }
    Response::from_parts(parts, Body::from(bytes))
}

/// Compress only text-like responses: JSON, text, manifests. Images and media are already
/// compressed, and event streams must not be buffered.
#[derive(Clone, Copy)]
pub struct CompressibleContent;

impl Predicate for CompressibleContent {
    fn should_compress<B>(&self, response: &axum::http::Response<B>) -> bool
    where
        B: axum::body::HttpBody,
    {
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        let compressible = content_type.starts_with("application/json")
            || content_type.starts_with("application/problem+json")
            || content_type.starts_with("application/x-mpegurl")
            || content_type.starts_with("application/vnd.apple.mpegurl")
            || content_type.starts_with("application/dash+xml")
            || content_type.starts_with("text/vtt")
            || content_type.starts_with("text/calendar")
            || content_type.starts_with("text/plain");
        compressible
            && !response
                .headers()
                .contains_key(axum::http::header::CONTENT_RANGE)
    }
}

pub fn compression_layer() -> CompressionLayer<
    tower_http::compression::predicate::And<
        tower_http::compression::predicate::SizeAbove,
        CompressibleContent,
    >,
> {
    CompressionLayer::new().gzip(true).br(true).compress_when(
        tower_http::compression::predicate::SizeAbove::new(256).and(CompressibleContent),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::{get, post};
    use axum::Router;
    use tower::ServiceExt;

    fn app() -> Router {
        Router::new()
            .route(
                "/api/v1/catalog",
                get(|| async { axum::Json(serde_json::json!({"items": [1, 2, 3]})) }),
            )
            .route(
                "/api/v1/playback/progress",
                get(|| async { axum::Json(serde_json::json!({"p": 1})) }),
            )
            .route(
                "/api/v1/artwork/x",
                get(|| async {
                    (
                        [
                            (CACHE_CONTROL, "private, max-age=1"),
                            (CONTENT_TYPE, "application/json"),
                        ],
                        "{}",
                    )
                }),
            )
            .route(
                "/api/v1/catalog",
                post(|| async { axum::Json(serde_json::json!({"ok": true})) }),
            )
            .layer(axum::middleware::from_fn(json_cache_middleware))
    }

    async fn call(method: Method, uri: &str, inm: Option<&str>) -> Response {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(value) = inm {
            builder = builder.header(IF_NONE_MATCH, value);
        }
        app()
            .oneshot(builder.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    #[test]
    fn classifies_library_data_and_everything_else() {
        assert_eq!(cache_control_for("/api/v1/catalog"), LIBRARY_CACHE_CONTROL);
        assert_eq!(
            cache_control_for("/api/v1/catalog/abc"),
            LIBRARY_CACHE_CONTROL
        );
        assert_eq!(cache_control_for("/api/v1/calendar"), LIBRARY_CACHE_CONTROL);
        for path in [
            "/api/v1/playback/progress",
            "/api/v1/home/rails",
            "/api/v1/playlists",
            "/api/v1/users/me",
        ] {
            assert_eq!(cache_control_for(path), REVALIDATE_CACHE_CONTROL, "{path}");
        }
        assert!(!LIBRARY_CACHE_CONTROL.contains("public"));
    }

    #[tokio::test]
    async fn json_get_gets_a_strong_etag_private_cache_control_and_vary_authorization() {
        let response = call(Method::GET, "/api/v1/catalog", None).await;
        assert_eq!(response.status(), StatusCode::OK);
        let etag = response.headers()[ETAG].to_str().unwrap().to_owned();
        assert!(etag.starts_with('"') && !etag.starts_with("W/"));
        assert_eq!(response.headers()[CACHE_CONTROL], LIBRARY_CACHE_CONTROL);
        assert_eq!(response.headers()[VARY], "Authorization");
    }

    #[tokio::test]
    async fn watch_state_endpoints_are_always_revalidated() {
        let response = call(Method::GET, "/api/v1/playback/progress", None).await;
        assert_eq!(response.headers()[CACHE_CONTROL], "private, no-cache");
    }

    #[tokio::test]
    async fn matching_if_none_match_returns_304_without_a_body() {
        let first = call(Method::GET, "/api/v1/catalog", None).await;
        let etag = first.headers()[ETAG].to_str().unwrap().to_owned();
        let second = call(Method::GET, "/api/v1/catalog", Some(&etag)).await;
        assert_eq!(second.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(second.headers()[ETAG].to_str().unwrap(), etag);
        assert!(to_bytes(second.into_body(), 1024).await.unwrap().is_empty());
        let stale = call(Method::GET, "/api/v1/catalog", Some("\"other\"")).await;
        assert_eq!(stale.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn changed_bytes_change_the_etag() {
        assert_ne!(strong_etag(b"{\"a\":1}"), strong_etag(b"{\"a\":2}"));
        assert_eq!(strong_etag(b"{\"a\":1}"), strong_etag(b"{\"a\":1}"));
    }

    #[tokio::test]
    async fn handler_cache_headers_and_non_get_are_left_alone() {
        let artwork = call(Method::GET, "/api/v1/artwork/x", None).await;
        assert_eq!(artwork.headers()[CACHE_CONTROL], "private, max-age=1");
        assert!(artwork.headers().get(ETAG).is_none());
        let post = call(Method::POST, "/api/v1/catalog", None).await;
        assert!(post.headers().get(ETAG).is_none() && post.headers().get(CACHE_CONTROL).is_none());
    }

    #[tokio::test]
    async fn compresses_json_but_not_images_and_keeps_the_identity_etag() {
        let big = "x".repeat(4096);
        let json_body = serde_json::json!({ "blob": big }).to_string();
        let png_body = vec![7u8; 4096];
        let app = Router::new()
            .route(
                "/api/v1/catalog",
                get({
                    let json_body = json_body.clone();
                    move || {
                        let json_body = json_body.clone();
                        async move { ([(CONTENT_TYPE, "application/json")], json_body) }
                    }
                }),
            )
            .route(
                "/api/v1/img",
                get(move || {
                    let b = png_body.clone();
                    async move { ([(CONTENT_TYPE, "image/png")], b) }
                }),
            )
            .layer(axum::middleware::from_fn(json_cache_middleware))
            .layer(compression_layer());
        let request = |uri: &str| {
            Request::builder()
                .uri(uri)
                .header("accept-encoding", "gzip")
                .body(Body::empty())
                .unwrap()
        };
        let json = app
            .clone()
            .oneshot(request("/api/v1/catalog"))
            .await
            .unwrap();
        assert_eq!(json.headers()[axum::http::header::CONTENT_ENCODING], "gzip");
        assert_eq!(
            json.headers()[ETAG].to_str().unwrap(),
            strong_etag(json_body.as_bytes())
        );
        assert!(to_bytes(json.into_body(), usize::MAX).await.unwrap().len() < 400);
        let image = app.oneshot(request("/api/v1/img")).await.unwrap();
        assert!(image
            .headers()
            .get(axum::http::header::CONTENT_ENCODING)
            .is_none());
    }

    #[test]
    fn if_none_match_parsing() {
        assert!(if_none_match_matches("\"a\", \"b\"", "\"b\""));
        assert!(if_none_match_matches("*", "\"b\""));
        assert!(if_none_match_matches("W/\"b\"", "\"b\""));
        assert!(!if_none_match_matches("\"a\"", "\"b\""));
    }
}
