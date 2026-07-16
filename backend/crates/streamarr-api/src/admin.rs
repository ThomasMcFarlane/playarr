//! Admin `SourceInstance` registration -- `POST`/`GET`/`DELETE
//! /api/v1/admin/source-instances[/{id}]`. Closes the gap
//! `SourceInstanceRegistry`'s own doc comment calls out explicitly: the
//! registry was a real, working in-process store from the moment it was
//! written, but nothing ever called `upsert`/had a way to remove an entry
//! -- there was no way, short of editing `backend/src/main.rs` and
//! rebuilding, to actually tell a running Streamarr instance about a
//! `*arr` app to talk to. This is that missing "way".
//!
//! Every write here confirms the instance is actually reachable (the same
//! `health_check` call `HealthCheckArrPusher` already makes) before
//! accepting it -- an operator registering a mistyped URL or a stale API
//! key gets a clear 502 immediately, not a silent no-op that only surfaces
//! later as `arr-sync` reconciliation failures nobody's watching yet.

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use streamarr_arr_client::ArrConnector;
use streamarr_arr_sync::ArrClient;
use streamarr_model::{SourceInstance, SourceKind};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::AdminUser;
use crate::error::ApiError;
use crate::AppState;

async fn health_check(client: &ArrClient) -> Result<(), streamarr_arr_client::ArrClientError> {
    match client {
        ArrClient::Sonarr(c) => c.health_check().await,
        ArrClient::Radarr(c) => c.health_check().await,
        ArrClient::Lidarr(c) => c.health_check().await,
        ArrClient::Readarr(c) => c.health_check().await,
        ArrClient::Bazarr(c) => c.health_check().await,
        ArrClient::Prowlarr(c) => c.health_check().await,
        ArrClient::Whisparr(c) => c.health_check().await,
    }
}

/// Request body for registering (or re-registering, by re-POSTing with the
/// same `id` you got back) a `*arr` connection. `api_key` is write-only --
/// it is never echoed back in [`SourceInstanceResponse`].
#[derive(Debug, Deserialize, ToSchema)]
pub struct SourceInstanceRequest {
    /// Omit to create a new instance (a fresh id is assigned and returned);
    /// set to an id from a prior response to update that same instance in
    /// place (e.g. to rotate its API key).
    pub id: Option<Uuid>,
    pub kind: SourceKind,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub default_root_folder_id: Option<String>,
    #[serde(default)]
    pub default_quality_profile_id: Option<i64>,
    #[serde(default)]
    pub best_effort: bool,
}

/// The redacted, admin-facing projection of [`SourceInstance`] -- see that
/// type's own doc comment for why it isn't `ToSchema`-derived directly
/// (it carries the API key). `api_key` is never included, not even
/// redacted-looking -- the field simply doesn't exist on the response.
#[derive(Debug, Serialize, ToSchema)]
pub struct SourceInstanceResponse {
    pub id: Uuid,
    pub kind: SourceKind,
    pub name: String,
    pub base_url: String,
    pub priority: i32,
    pub default_root_folder_id: Option<String>,
    pub default_quality_profile_id: Option<i64>,
    pub best_effort: bool,
}

impl From<SourceInstance> for SourceInstanceResponse {
    fn from(instance: SourceInstance) -> Self {
        Self {
            id: instance.id,
            kind: instance.kind,
            name: instance.name,
            base_url: instance.base_url,
            priority: instance.priority,
            default_root_folder_id: instance.default_root_folder_id,
            default_quality_profile_id: instance.default_quality_profile_id,
            best_effort: instance.best_effort,
        }
    }
}

/// Registers a new `*arr` connection, or updates an existing one in place
/// when `id` is set. Confirms the instance is actually reachable with the
/// given `base_url`/`api_key` before accepting it.
#[utoipa::path(
    post,
    path = "/api/v1/admin/source-instances",
    tag = "admin",
    request_body = SourceInstanceRequest,
    responses(
        (status = 200, description = "Registered (or updated) and confirmed reachable", body = SourceInstanceResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 502, description = "base_url/api_key rejected, or the instance could not be reached")
    )
)]
pub async fn create_source_instance_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<SourceInstanceRequest>,
) -> Result<Json<SourceInstanceResponse>, ApiError> {
    let instance = SourceInstance {
        id: body.id.unwrap_or_else(Uuid::new_v4),
        kind: body.kind,
        name: body.name,
        base_url: body.base_url,
        api_key_encrypted: streamarr_model::Sensitive::new(body.api_key),
        priority: body.priority,
        default_root_folder_id: body.default_root_folder_id,
        default_quality_profile_id: body.default_quality_profile_id,
        best_effort: body.best_effort,
    };

    let client = ArrClient::from_source_instance(&instance);
    health_check(&client).await.map_err(|err| {
        ApiError::bad_gateway(format!(
            "could not reach {:?} at {}: {err}",
            instance.kind, instance.base_url
        ))
    })?;

    // Write-through: the durable repo first, so a failed persist never
    // leaves `source_instances`' in-memory cache claiming something that
    // isn't actually saved to disk -- see `AppState::source_instance_repo`'s
    // doc comment.
    state
        .source_instance_repo
        .upsert(&instance)
        .await
        .map_err(|err| {
            ApiError::internal(format!(
                "failed to persist source instance {}: {err}",
                instance.id
            ))
        })?;

    state.source_instances.upsert(instance.clone());

    tracing::info!(
        instance_id = %instance.id,
        instance_kind = ?instance.kind,
        instance_name = %instance.name,
        "registered source instance (confirmed reachable)"
    );

    Ok(Json(instance.into()))
}

/// Every currently-registered `*arr` connection.
#[utoipa::path(
    get,
    path = "/api/v1/admin/source-instances",
    tag = "admin",
    responses(
        (status = 200, description = "All registered source instances", body = Vec<SourceInstanceResponse>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_source_instances_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Json<Vec<SourceInstanceResponse>> {
    Json(
        state
            .source_instances
            .all()
            .into_iter()
            .map(SourceInstanceResponse::from)
            .collect(),
    )
}

/// De-registers a `*arr` connection. `arr-sync` stops polling it on its
/// next reconciliation tick; already-imported catalog data is untouched.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/source-instances/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Source instance id")),
    responses(
        (status = 204, description = "Removed (or was already absent)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn delete_source_instance_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, ApiError> {
    // Same write-through-first ordering as create, and the same repo --
    // see `AppState::source_instance_repo`'s doc comment. A `NotFound` from
    // the repo is not a caller-facing failure here: deleting an
    // already-absent row is exactly as much a no-op as
    // `SourceInstanceRegistry::remove` already treats it (that method
    // returns `Option` and callers here have never checked it either).
    match state.source_instance_repo.delete(id).await {
        Ok(()) | Err(streamarr_db::DbError::NotFound) => {}
        Err(err) => {
            return Err(ApiError::internal(format!(
                "failed to delete source instance {id}: {err}"
            )))
        }
    }

    state.source_instances.remove(id);
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Asks this source instance's running `ReconciliationPoller` to do a full
/// sync right now, instead of waiting for its next scheduled (every 300s)
/// pass -- the "Sync now" action every `*arr` app itself exposes per
/// configured connection. Fire-and-forget: a `202` means the request
/// reached the poller, not that the resulting sync has finished yet.
#[utoipa::path(
    post,
    path = "/api/v1/admin/source-instances/{id}/sync",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Source instance id")),
    responses(
        (status = 202, description = "Sync request handed to the running reconciliation poller"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No source instance registered with this id"),
        (status = 503, description = "No reconciliation poller is currently running for this instance yet")
    )
)]
pub async fn sync_source_instance_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, ApiError> {
    state.source_instances.trigger_sync(id)?;
    Ok(axum::http::StatusCode::ACCEPTED)
}

/// One source instance's most recently reported reconciliation outcome --
/// see `streamarr_arr_sync::SyncRunStatus`. `status`/`error`/`finished_at`
/// are `None` together when no poller has reported anything for this
/// instance yet (e.g. it was registered less than ~10s ago).
#[derive(Debug, Serialize, ToSchema)]
pub struct SourceInstanceSyncStatusResponse {
    pub source_instance_id: Uuid,
    pub name: String,
    pub kind: SourceKind,
    /// `"running"` | `"succeeded"` | `"failed"`, or absent if unreported.
    pub status: Option<&'static str>,
    /// Only set when `status` is `"failed"`.
    pub error: Option<String>,
    /// Only set when `status` is `"running"` and the poller has something
    /// more specific to report than "running" alone -- see
    /// `streamarr_arr_sync::SyncRunStatus::Running`'s doc comment (e.g. a
    /// large missing-media-file backfill's live "N/total" progress).
    pub detail: Option<String>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub finished_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Every registered source instance's last-known sync status in one call --
/// backs the admin "Tasks" screen. Purely in-memory/runtime, like `POST
/// .../sync`'s underlying trigger channel: nothing here survives a restart,
/// and an instance with no poller running yet (or one that's never
/// completed a pass) simply has `status: null`, not a synthetic "idle" or
/// "unknown" state.
#[utoipa::path(
    get,
    path = "/api/v1/admin/source-instances/sync-status",
    tag = "admin",
    responses(
        (status = 200, description = "Every registered instance's last-known sync status", body = Vec<SourceInstanceSyncStatusResponse>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn sync_status_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<SourceInstanceSyncStatusResponse>>, ApiError> {
    use streamarr_arr_sync::SyncRunStatus;

    let responses = state
        .source_instances
        .all_sync_statuses()
        .into_iter()
        .map(|(instance, status)| {
            let (status_label, error, detail, started_at, finished_at) = match status {
                None => (None, None, None, None, None),
                Some(SyncRunStatus::Running { started_at, detail }) => {
                    (Some("running"), None, detail, Some(started_at), None)
                }
                Some(SyncRunStatus::Succeeded { finished_at }) => {
                    (Some("succeeded"), None, None, None, Some(finished_at))
                }
                Some(SyncRunStatus::Failed { error, finished_at }) => {
                    (Some("failed"), Some(error), None, None, Some(finished_at))
                }
            };
            SourceInstanceSyncStatusResponse {
                source_instance_id: instance.id,
                name: instance.name,
                kind: instance.kind,
                status: status_label,
                error,
                detail,
                started_at,
                finished_at,
            }
        })
        .collect();

    Ok(Json(responses))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use uuid::Uuid;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::test_support::{bearer_header, mint_access_token, seed_admin_user, test_state};

    #[tokio::test]
    async fn register_confirms_reachability_before_accepting() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/system/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "version": "4.0.0"
            })))
            .mount(&mock)
            .await;

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let body = serde_json::json!({
            "kind": "radarr",
            "name": "Live Radarr",
            "base_url": mock.uri(),
            "api_key": "test-key",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/source-instances")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["name"], "Live Radarr");
        assert!(
            json.get("api_key").is_none(),
            "api_key must never be echoed back"
        );
        assert_eq!(state.app.source_instances.all().len(), 1);
    }

    #[tokio::test]
    async fn register_rejects_unreachable_instance() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let body = serde_json::json!({
            "kind": "sonarr",
            "name": "Unreachable Sonarr",
            "base_url": "http://127.0.0.1:1",
            "api_key": "test-key",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/source-instances")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(state.app.source_instances.all().len(), 0);
    }

    #[tokio::test]
    async fn list_and_delete_round_trip() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let instance = streamarr_model::SourceInstance {
            id: Uuid::new_v4(),
            kind: streamarr_model::SourceKind::Prowlarr,
            name: "Prowlarr".to_string(),
            base_url: "http://localhost:9696".to_string(),
            api_key_encrypted: streamarr_model::Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: None,
            default_quality_profile_id: None,
            best_effort: false,
        };
        state.app.source_instances.upsert(instance.clone());

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/source-instances")
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
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json.as_array().unwrap().len(), 1);

        let response = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/admin/source-instances/{}", instance.id))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(state.app.source_instances.all().len(), 0);
    }

    #[tokio::test]
    async fn sync_reports_not_found_for_unknown_instance() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/admin/source-instances/{}/sync",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn sync_reports_poller_not_running_when_none_is_registered() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let instance = streamarr_model::SourceInstance {
            id: Uuid::new_v4(),
            kind: streamarr_model::SourceKind::Prowlarr,
            name: "Prowlarr".to_string(),
            base_url: "http://localhost:9696".to_string(),
            api_key_encrypted: streamarr_model::Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: None,
            default_quality_profile_id: None,
            best_effort: false,
        };
        state.app.source_instances.upsert(instance.clone());

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/admin/source-instances/{}/sync",
                        instance.id
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn non_admin_is_rejected() {
        let (router, state) = test_state().await;
        let token = mint_access_token(&state, Uuid::new_v4());

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/source-instances")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}
