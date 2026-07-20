//! Admin `TdarrConnection` registration -- `POST/GET/DELETE
//! /api/v1/admin/tdarr`. See `streamarr_model::tdarr`'s module doc
//! comment for why this is a **singleton** resource (no `{id}` path
//! segment, unlike `/api/v1/admin/source-instances`): there is only ever
//! one Tdarr connection, so `POST` always registers-or-replaces it and
//! `GET`/`DELETE` need no id to disambiguate.
//!
//! Same "confirm it's actually reachable before accepting it" discipline
//! `admin.rs`'s `*arr` registration uses -- `GET /api/v2/get-nodes` is
//! Tdarr's own closest thing to a health-check endpoint (Tdarr's REST API
//! has no dedicated one; see `streamarr_tdarr_client`'s doc comment), so
//! that's the connectivity probe here.
//!
//! Registering (or removing) a connection here takes effect without a
//! process restart: `streamarr-bin`'s worker-role boot watches this
//! table the same way it watches `source_instances` for newly-registered
//! `*arr` connections, and starts/stops the background `TdarrDispatcher`
//! accordingly -- see `main.rs`'s `spawn_tdarr_dispatcher_watcher`.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use streamarr_model::{Sensitive, TdarrConnection};
use utoipa::ToSchema;

use crate::auth_extractor::AdminUser;
use crate::error::ApiError;
use crate::AppState;

fn default_tdarr_db_id() -> String {
    "streamarr".to_string()
}
fn default_profile() -> String {
    "h264-720p-4mbps".to_string()
}
fn default_worker_process() -> String {
    "transcodecpu".to_string()
}
fn default_worker_limit() -> i32 {
    2
}
fn default_active_session_threshold() -> i32 {
    2
}
fn default_throttle_check_interval_secs() -> i64 {
    30
}

/// Request body for registering (or re-registering, to update in place --
/// e.g. to rotate the API key) the Tdarr connection. `api_key` is
/// write-only -- it is never echoed back in [`TdarrConnectionResponse`].
#[derive(Debug, Deserialize, ToSchema)]
pub struct TdarrConnectionRequest {
    pub base_url: String,
    pub api_key: String,
    #[serde(default = "default_tdarr_db_id")]
    pub tdarr_db_id: String,
    #[serde(default = "default_profile")]
    pub default_profile: String,
    #[serde(default = "default_worker_process")]
    pub worker_process: String,
    #[serde(default = "default_worker_limit")]
    pub default_worker_limit: i32,
    /// Worker limit applied while `active_session_threshold` or more
    /// on-demand sessions are live. Defaults to `0` -- pause background
    /// transcoding entirely rather than compete with live playback.
    #[serde(default)]
    pub throttled_worker_limit: i32,
    #[serde(default = "default_active_session_threshold")]
    pub active_session_threshold: i32,
    #[serde(default = "default_throttle_check_interval_secs")]
    pub throttle_check_interval_secs: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct TdarrConnectionResponse {
    pub base_url: String,
    pub tdarr_db_id: String,
    pub default_profile: String,
    pub worker_process: String,
    pub default_worker_limit: i32,
    pub throttled_worker_limit: i32,
    pub active_session_threshold: i32,
    pub throttle_check_interval_secs: i64,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<TdarrConnection> for TdarrConnectionResponse {
    fn from(connection: TdarrConnection) -> Self {
        Self {
            base_url: connection.base_url,
            tdarr_db_id: connection.tdarr_db_id,
            default_profile: connection.default_profile,
            worker_process: connection.worker_process,
            default_worker_limit: connection.default_worker_limit,
            throttled_worker_limit: connection.throttled_worker_limit,
            active_session_threshold: connection.active_session_threshold,
            throttle_check_interval_secs: connection.throttle_check_interval_secs,
            updated_at: connection.updated_at,
        }
    }
}

/// Registers (or updates) Streamarr's Tdarr connection. Confirms Tdarr is
/// actually reachable with the given `base_url`/`api_key` before
/// accepting it.
#[utoipa::path(
    post,
    path = "/api/v1/admin/tdarr",
    tag = "admin",
    request_body(content = TdarrConnectionRequest, example = json!({
        "base_url": "http://tdarr.local:8265",
        "api_key": "s3cr3t-api-key",
        "tdarr_db_id": "streamarr",
        "default_profile": "h264-720p-4mbps",
        "worker_process": "transcodecpu",
        "default_worker_limit": 2,
        "throttled_worker_limit": 0,
        "active_session_threshold": 2,
        "throttle_check_interval_secs": 30
    })),
    responses(
        (status = 200, description = "Registered (or updated) and confirmed reachable", body = TdarrConnectionResponse, example = json!({
            "base_url": "http://tdarr.local:8265",
            "tdarr_db_id": "streamarr",
            "default_profile": "h264-720p-4mbps",
            "worker_process": "transcodecpu",
            "default_worker_limit": 2,
            "throttled_worker_limit": 0,
            "active_session_threshold": 2,
            "throttle_check_interval_secs": 30,
            "updated_at": "2025-01-15T12:00:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 502, description = "base_url/api_key rejected, or Tdarr could not be reached")
    )
)]
pub async fn create_tdarr_connection_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<TdarrConnectionRequest>,
) -> Result<Json<TdarrConnectionResponse>, ApiError> {
    let client =
        streamarr_tdarr_client::TdarrClient::new(body.base_url.clone(), body.api_key.clone());
    client.get_nodes().await.map_err(|err| {
        ApiError::bad_gateway(format!("could not reach Tdarr at {}: {err}", body.base_url))
    })?;

    let connection = TdarrConnection {
        base_url: body.base_url,
        api_key_encrypted: Sensitive::new(body.api_key),
        tdarr_db_id: body.tdarr_db_id,
        default_profile: body.default_profile,
        worker_process: body.worker_process,
        default_worker_limit: body.default_worker_limit,
        throttled_worker_limit: body.throttled_worker_limit,
        active_session_threshold: body.active_session_threshold,
        throttle_check_interval_secs: body.throttle_check_interval_secs,
        updated_at: chrono::Utc::now(),
    };

    state
        .tdarr_connection_repo
        .upsert(&connection)
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist tdarr connection: {err}")))?;

    tracing::info!(
        base_url = %connection.base_url,
        "registered tdarr connection (confirmed reachable)"
    );

    Ok(Json(connection.into()))
}

/// The currently-registered Tdarr connection, if any.
#[utoipa::path(
    get,
    path = "/api/v1/admin/tdarr",
    tag = "admin",
    responses(
        (status = 200, description = "The registered connection", body = TdarrConnectionResponse, example = json!({
            "base_url": "http://tdarr.local:8265",
            "tdarr_db_id": "streamarr",
            "default_profile": "h264-720p-4mbps",
            "worker_process": "transcodecpu",
            "default_worker_limit": 2,
            "throttled_worker_limit": 0,
            "active_session_threshold": 2,
            "throttle_check_interval_secs": 30,
            "updated_at": "2025-01-15T12:00:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No Tdarr connection has been registered yet")
    )
)]
pub async fn get_tdarr_connection_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<TdarrConnectionResponse>, ApiError> {
    let connection = state
        .tdarr_connection_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load tdarr connection: {err}")))?
        .ok_or_else(|| ApiError::not_found("no Tdarr connection has been registered yet"))?;
    Ok(Json(connection.into()))
}

/// De-registers the Tdarr connection. The background dispatch loop stops
/// on its next watch tick (see this module's doc comment); already-cached
/// `Rendition`s are untouched.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/tdarr",
    tag = "admin",
    responses(
        (status = 204, description = "Removed (or was already absent)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn delete_tdarr_connection_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<StatusCode, ApiError> {
    state
        .tdarr_connection_repo
        .delete()
        .await
        .map_err(|err| ApiError::internal(format!("failed to delete tdarr connection: {err}")))?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_streaming_user, test_state,
    };
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn create_without_token_is_unauthorized() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/tdarr")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"base_url": "http://tdarr.local:8265", "api_key": "key"})
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn create_requires_admin() {
        let (router, state) = test_state().await;
        let user_id = uuid::Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/tdarr")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({"base_url": "http://tdarr.local:8265", "api_key": "key"})
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn create_confirms_reachability_before_accepting() {
        let (router, state) = test_state().await;
        let admin_id = uuid::Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/tdarr")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({
                            "base_url": "http://unreachable.invalid:8265",
                            "api_key": "key"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    }

    #[tokio::test]
    async fn create_read_delete_round_trip_as_admin() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v2/get-nodes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;

        let (router, state) = test_state().await;
        let admin_id = uuid::Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let create_body = serde_json::json!({
            "base_url": server.uri(),
            "api_key": "test-key",
            "tdarr_db_id": "my-library",
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/tdarr")
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
        let created: TdarrConnectionResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(created.base_url, server.uri());
        assert_eq!(created.tdarr_db_id, "my-library");
        // Defaults applied server-side.
        assert_eq!(created.default_profile, "h264-720p-4mbps");
        assert_eq!(created.default_worker_limit, 2);

        // Read it back.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/tdarr")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Delete it.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/api/v1/admin/tdarr")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // Now 404s.
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/tdarr")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn get_with_nothing_registered_is_404() {
        let (router, state) = test_state().await;
        let admin_id = uuid::Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/tdarr")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
