//! `streamarr-api` — the Axum HTTP server. Wires the OpenAPI-annotated
//! system routes ([`health`], [`readiness`], [`version`]) plus the real
//! catalog/requests/oauth/webhooks/playback routes through
//! `utoipa-axum`'s [`utoipa_axum::router::OpenApiRouter`] (so the route
//! table and the OpenAPI spec can never drift apart — every
//! `#[utoipa::path]`-annotated handler mounted via `routes!` contributes
//! its documented shape to the spec automatically), and layers the
//! [`version_gate`] middleware over the whole router.
//!
//! ## Regenerating `backend/openapi/streamarr.yaml`
//!
//! The OpenAPI spec is generated from the `#[utoipa::path]` annotations on
//! each handler, not hand-maintained. [`openapi_spec`] returns the live
//! `utoipa::openapi::OpenApi` value; `tests::openapi_spec_matches_checked_in_file`
//! is both the regeneration script and the drift check: run
//!
//! ```text
//! UPDATE_OPENAPI_SPEC=1 cargo test -p streamarr-api openapi_spec_matches_checked_in_file
//! ```
//!
//! to (re)write `backend/openapi/streamarr.yaml` from the live spec after
//! changing any route; run the same test without the env var (as CI does)
//! to confirm the checked-in file still matches.

pub mod admin;
pub mod auth_extractor;
pub mod catalog;
pub mod error;
pub mod health;
pub mod login;
pub mod oauth;
pub mod playback;
pub mod readiness;
pub mod requests;
pub mod source_registry;
pub mod version;
pub mod version_gate;
pub mod webhooks;

#[cfg(test)]
pub mod test_support;

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::FromRef;
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

pub use auth_extractor::{AdminUser, AuthUser};
pub use error::{ApiError, ErrorBody};
pub use playback::{InMemoryMediaFileLookup, MediaFileLookup, RepoBackedMediaFileLookup};
pub use readiness::ReadinessState;
pub use source_registry::SourceInstanceRegistry;
pub use version::VersionState;
pub use version_gate::{ClientCompatibilityTable, VersionGateLayer};

#[derive(OpenApi)]
#[openapi(
    info(title = "Streamarr API", version = "0.1.0"),
    tags(
        (name = "system", description = "Process health, readiness, and version endpoints"),
        (name = "auth", description = "Session login and access-token issuance"),
        (name = "oauth", description = "RFC 8628 OAuth 2.0 device authorization endpoints"),
        (name = "webhooks", description = "*arr webhook receiver"),
        (name = "catalog", description = "Catalog browse/search/detail"),
        (name = "requests", description = "Media request lifecycle: submit/approve/reject/list"),
        (name = "playback", description = "Playback negotiation: direct-play vs. transcode decision"),
        (name = "admin", description = "Admin-only configuration: registering *arr source instances")
    )
)]
pub struct ApiDoc;

/// The shared route table both [`openapi_spec`] and [`build_router`] build
/// from, so the two can never drift: `openapi_spec` calls
/// `split_for_parts` and keeps only the `OpenApi` half (for spec
/// regeneration/tests that don't want to boot a real, stateful router);
/// `build_router` keeps both halves after attaching real state and the
/// version-gate layer.
fn api_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(health::health_handler))
        .routes(routes!(readiness::readiness_handler))
        .routes(routes!(version::version_handler))
        .routes(routes!(oauth::device_code_handler))
        .routes(routes!(oauth::device_token_handler))
        .routes(routes!(login::login_handler))
        .routes(routes!(webhooks::arr_webhook_handler))
        .routes(routes!(catalog::browse_catalog_handler))
        .routes(routes!(catalog::get_work_handler))
        .routes(routes!(catalog::search_catalog_handler))
        .routes(routes!(requests::submit_request_handler))
        .routes(routes!(requests::list_requests_handler))
        .routes(routes!(requests::approve_request_handler))
        .routes(routes!(requests::reject_request_handler))
        .routes(routes!(playback::playback_info_handler))
        .routes(routes!(
            admin::create_source_instance_handler,
            admin::list_source_instances_handler
        ))
        .routes(routes!(admin::delete_source_instance_handler))
}

pub fn openapi_spec() -> utoipa::openapi::OpenApi {
    let (_router, api) = api_router().split_for_parts();
    api
}

/// Every service/repository handle the real routes in this crate depend
/// on. `streamarr-bin`'s `boot_api` is the composition root that
/// constructs one of these from `streamarr_config::Config`; every field
/// here is either `Arc<dyn Trait>` (when the owning crate defines a real
/// trait boundary — `RequestRepo`, `DeviceFlowHandler`, `MediaFileLookup`,
/// `UserDirectory`, real in production via `RepoBackedMediaFileLookup`,
/// real-but-in-memory in tests via `InMemoryMediaFileLookup`) or
/// `Arc<ConcreteType>` (when it only exposes a concrete service struct —
/// `CatalogService`, `RequestService`, `TranscodeOrchestrator`,
/// `WebhookReceiver`, `JwtIssuer`, `RefreshTokenService` — or is a
/// composition-root-owned type with no sibling implementation to abstract
/// over yet — `SourceInstanceRegistry`, `InMemoryAdminRegistry`).
#[derive(Clone)]
pub struct AppState {
    pub readiness: ReadinessState,
    pub version: VersionState,
    pub catalog: Arc<streamarr_catalog::CatalogService>,
    pub requests: Arc<streamarr_requests::RequestService>,
    pub request_repo: Arc<dyn streamarr_requests::RequestRepo>,
    pub transcode: Arc<streamarr_transcode::TranscodeOrchestrator>,
    pub device_flow: Arc<dyn streamarr_auth::DeviceFlowHandler>,
    pub webhook: Arc<streamarr_arr_sync::WebhookReceiver>,
    pub source_instances: Arc<SourceInstanceRegistry>,
    pub media_files: Arc<dyn MediaFileLookup>,
    /// Verifies the `Authorization: Bearer <token>` header every
    /// [`auth_extractor::AuthUser`]/[`auth_extractor::AdminUser`]
    /// extraction depends on -- the same issuer instance
    /// `POST /api/v1/auth/login` and the RFC 8628 device flow issue tokens
    /// through, so a token from either path verifies here identically.
    pub jwt: Arc<streamarr_auth::JwtIssuer>,
    /// Interim, pending-real-persistence admin resolution -- see
    /// `streamarr_auth::admin`'s doc comment. Backs
    /// [`auth_extractor::AdminUser`]'s 403 check.
    pub admin_registry: Arc<streamarr_auth::InMemoryAdminRegistry>,
    /// The operator's configured login trust tier for `POST
    /// /api/v1/auth/login` -- see `streamarr_auth::AuthMode`'s doc comment
    /// for what each tier requires, and `streamarr-bin`'s `boot_api` for
    /// how this pass resolves it (and the security implications of its
    /// default) from `STREAMARR_AUTH_MODE`.
    pub auth_mode: Arc<streamarr_auth::AuthMode>,
    /// Resolves the `User`s participating in login -- see
    /// `streamarr_auth::login::InMemoryUserDirectory`'s doc comment for why
    /// this is in-memory pending real `UserRepo` persistence.
    pub user_directory: Arc<dyn streamarr_auth::UserDirectory>,
    /// Issues/rotates refresh-token families for `POST /api/v1/auth/login`
    /// -- shared with the RFC 8628 device flow's own token issuance
    /// (`device_flow` above wraps a clone of the same underlying service),
    /// so both paths agree on `Device`/`Session` bookkeeping.
    pub sessions: Arc<streamarr_auth::RefreshTokenService>,
    /// Absolute lifetime of a refresh-token family minted by
    /// `POST /api/v1/auth/login` -- see
    /// `streamarr_auth::refresh::RefreshTokenRecord::expires_at`'s doc
    /// comment for why this is fixed at issuance rather than sliding.
    pub refresh_ttl: chrono::Duration,
    /// Stable-for-process-lifetime identifier for this node, threaded into
    /// `TranscodeSession::owning_node_id` so a segment request in a
    /// multi-node deployment can be routed back to whichever node actually
    /// holds the ffmpeg process.
    pub node_id: String,
}

impl FromRef<AppState> for ReadinessState {
    fn from_ref(state: &AppState) -> Self {
        state.readiness.clone()
    }
}

impl FromRef<AppState> for VersionState {
    fn from_ref(state: &AppState) -> Self {
        state.version.clone()
    }
}

/// Builds the full Axum router: every system route, the version-gate
/// middleware layered over the whole thing, and the OpenAPI spec those
/// routes contributed to. `streamarr-bin` mounts the returned `Router`
/// directly; the `OpenApi` value is what [`openapi_spec`] also exposes
/// standalone for spec regeneration/tests that don't want to boot a real
/// router.
///
/// Also mounts bare `/healthz` and `/readyz` aliases for
/// [`health::health_handler`]/[`readiness::readiness_handler`], outside the
/// OpenAPI-tracked route table (they're container/orchestrator liveness
/// probe conventions, not public API surface) — `infra/docker/backend.Dockerfile`'s
/// `HEALTHCHECK` curls `/healthz` regardless of role, so the full API
/// router needs to answer it too, not just the worker-only minimal
/// listener `streamarr-bin` serves when it isn't running this router at
/// all. `/api/system/health` and `/api/system/ready` are unaffected by
/// this — both keep working exactly as before.
///
/// CORS is wide open (`CorsLayer::permissive` -- any origin/method/header,
/// no credentials) by design, not an oversight: this API is Bearer-token
/// authenticated, never cookie/session-authenticated, so there is no CSRF
/// surface a stricter origin allow-list would actually protect (the token
/// itself is the access control; a browser page on an unrelated origin
/// still can't produce a valid one). It also still matters even now that
/// the standalone Web app is co-hosted (see `web_assets_dir` below): the
/// packaged TV-web shells (webOS/Tizen/VIDAA) run from their own app/webview
/// origin and always call the API cross-origin, and a split reverse-proxy
/// deployment (UI on one host, API on another) is still a legitimate setup
/// this must keep working for. Layered outermost (after `version_gate` in
/// this builder chain, which axum applies innermost-first) so a preflight
/// `OPTIONS` request is answered before it ever reaches auth/version-gate
/// logic that would otherwise reject it for having no `Authorization`
/// header.
///
/// `web_assets_dir`, when `Some`, mounts the standalone Web app's built
/// static assets (`clients/tv-web/web/dist`) as this router's fallback —
/// any request that doesn't match an `/api/*` route, `/healthz`, or
/// `/readyz` is served a static file from that directory, falling back to
/// `index.html` for anything not found on disk (React Router's
/// client-side routes, e.g. `/library/{id}`, aren't real files). This is
/// what lets the API and the Web UI live on one origin, one port, one
/// `docker run` — the same story every `*arr` app ships, rather than
/// requiring a separately-hosted web client pointed at this API via CORS.
/// `streamarr-bin` resolves the directory (env override or a path next to
/// the binary) and passes `None` when it can't find a built `index.html`
/// there, in which case this router serves API-only, exactly as before.
pub fn build_router(
    state: AppState,
    version_gate: VersionGateLayer,
    web_assets_dir: Option<PathBuf>,
) -> (Router, utoipa::openapi::OpenApi) {
    let readiness_for_alias = state.readiness.clone();
    let (router, api) = api_router().with_state(state).split_for_parts();
    let router = router
        .route("/healthz", axum::routing::get(health::health_handler))
        .route(
            "/readyz",
            axum::routing::get(move || {
                let readiness = readiness_for_alias.clone();
                async move { readiness::readiness_handler(axum::extract::State(readiness)).await }
            }),
        );

    let router = router.layer(version_gate).layer(CorsLayer::permissive());

    let router = match web_assets_dir {
        Some(dir) => {
            // Deliberately `.fallback(...)`, not `.not_found_service(...)`:
            // the latter is tower-http's helper for a real "not found" page
            // and always forces a 404 status onto whatever it serves
            // (`SetStatus::new(fallback, StatusCode::NOT_FOUND)` -- see its
            // own doc comment). React Router's client-side routes (e.g.
            // `/library/{id}`) are not 404s -- they're real pages the SPA
            // shell renders once loaded -- so this needs `index.html`
            // served with its own natural 200, which plain `.fallback(...)`
            // preserves.
            let index_html = ServeFile::new(dir.join("index.html"));
            router.fallback_service(ServeDir::new(dir).fallback(index_html))
        }
        None => router,
    };

    (router, api)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use streamarr_model::VersionEnvelope;
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_endpoint_returns_200() {
        let (router, _state) = test_support::test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/system/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn healthz_alias_returns_200() {
        let (router, _state) = test_support::test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn readyz_alias_reflects_state() {
        let (router, state) = test_support::test_state().await;
        let not_ready = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(not_ready.status(), StatusCode::SERVICE_UNAVAILABLE);

        state.app.readiness.set_ready(true);
        let ready = router
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ready.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn readiness_endpoint_reflects_state() {
        let (router, state) = test_support::test_state().await;
        state.app.readiness.set_ready(true);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/system/ready")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn version_endpoint_returns_envelope_json() {
        let (router, _state) = test_support::test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/system/version")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let envelope: VersionEnvelope = serde_json::from_slice(&body).unwrap();
        assert_eq!(envelope.server_version, "0.1.0");
    }

    #[test]
    fn openapi_spec_includes_every_route_group() {
        let spec = openapi_spec();
        let json = serde_json::to_string(&spec).unwrap();
        assert!(json.contains("/api/system/health"));
        assert!(json.contains("/api/system/version"));
        assert!(json.contains("/api/v1/oauth/device/code"));
        assert!(json.contains("/api/v1/oauth/token"));
        assert!(json.contains("/api/v1/auth/login"));
        assert!(json.contains("/webhooks/{instance_id}"));
        assert!(json.contains("/api/v1/catalog"));
        assert!(json.contains("/api/v1/catalog/{id}"));
        assert!(json.contains("/api/v1/catalog/search"));
        assert!(json.contains("/api/v1/requests"));
        assert!(json.contains("/api/v1/requests/{id}/approve"));
        assert!(json.contains("/api/v1/requests/{id}/reject"));
        assert!(json.contains("/api/v1/playback/{media_file_id}"));
    }

    /// Regenerates (with `UPDATE_OPENAPI_SPEC=1`) or verifies (without it)
    /// `backend/openapi/streamarr.yaml` against the live utoipa spec. This
    /// is the "small #[test]" the crate doc comment describes as the
    /// regeneration mechanism.
    #[test]
    fn openapi_spec_matches_checked_in_file() {
        let yaml = openapi_spec().to_yaml().expect("serialize OpenAPI to YAML");
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../openapi/streamarr.yaml");

        if std::env::var("UPDATE_OPENAPI_SPEC").is_ok() {
            std::fs::write(&path, &yaml).expect("write backend/openapi/streamarr.yaml");
            return;
        }

        let checked_in = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(
            checked_in, yaml,
            "backend/openapi/streamarr.yaml is out of date with the live utoipa spec; \
             regenerate with `UPDATE_OPENAPI_SPEC=1 cargo test -p streamarr-api openapi_spec_matches_checked_in_file`"
        );
    }
}
