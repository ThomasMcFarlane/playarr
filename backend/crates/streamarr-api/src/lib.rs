//! `streamarr-api` — the Axum HTTP server. Wires the OpenAPI-annotated
//! system routes ([`health`], [`readiness`], [`version`]) through
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
//! `utoipa::openapi::OpenApi` value; to (re)write the checked-in spec:
//!
//! ```ignore
//! let yaml = streamarr_api::openapi_spec().to_yaml().unwrap();
//! std::fs::write("backend/openapi/streamarr.yaml", yaml).unwrap();
//! ```
//!
//! (Wire this as a `just openapi` recipe, or a `streamarr openapi export`
//! CLI subcommand alongside `streamarr-bin`'s `update` subcommand, once
//! either exists — the snippet above is the whole implementation either
//! would need.)

pub mod health;
pub mod readiness;
pub mod version;
pub mod version_gate;

use axum::extract::FromRef;
use axum::Router;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

pub use readiness::ReadinessState;
pub use version::VersionState;
pub use version_gate::{ClientCompatibilityTable, VersionGateLayer};

#[derive(OpenApi)]
#[openapi(
    info(title = "Streamarr API", version = "0.1.0"),
    tags((name = "system", description = "Process health, readiness, and version endpoints"))
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
}

pub fn openapi_spec() -> utoipa::openapi::OpenApi {
    let (_router, api) = api_router().split_for_parts();
    api
}

#[derive(Clone)]
pub struct AppState {
    pub readiness: ReadinessState,
    pub version: VersionState,
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
pub fn build_router(
    state: AppState,
    version_gate: VersionGateLayer,
) -> (Router, utoipa::openapi::OpenApi) {
    let (router, api) = api_router().with_state(state).split_for_parts();
    (router.layer(version_gate), api)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use streamarr_model::VersionEnvelope;
    use tower::ServiceExt;

    fn test_state() -> AppState {
        AppState {
            readiness: ReadinessState::new(),
            version: VersionState {
                envelope: VersionEnvelope {
                    server_version: "0.1.0".to_string(),
                    api_version: "1".to_string(),
                    build_sha: None,
                    compatibility: vec![],
                },
            },
        }
    }

    fn test_version_gate() -> VersionGateLayer {
        VersionGateLayer::new(
            ClientCompatibilityTable::from_toml_str(
                r#"
[server]
version = "0.1.0"
apiVersion = "1"
"#,
            )
            .unwrap(),
        )
    }

    #[tokio::test]
    async fn health_endpoint_returns_200() {
        let (router, _api) = build_router(test_state(), test_version_gate());
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
    async fn readiness_endpoint_reflects_state() {
        let state = test_state();
        state.readiness.set_ready(true);
        let (router, _api) = build_router(state, test_version_gate());
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
        let (router, _api) = build_router(test_state(), test_version_gate());
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
    fn openapi_spec_includes_system_paths() {
        let spec = openapi_spec();
        let json = serde_json::to_string(&spec).unwrap();
        assert!(json.contains("/api/system/health"));
        assert!(json.contains("/api/system/version"));
    }
}
