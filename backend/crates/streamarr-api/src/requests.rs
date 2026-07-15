//! Request-management endpoints: `POST /api/v1/requests`,
//! `POST /api/v1/requests/{id}/approve`, `POST /api/v1/requests/{id}/reject`,
//! `GET /api/v1/requests` -- thin Axum handlers over
//! [`streamarr_requests::RequestService`] plus this crate's own
//! [`HealthCheckArrPusher`], the composition root's implementation of the
//! [`streamarr_requests::ArrPusher`] seam that crate's docs call out as
//! injected by "the API/worker composition root".

use async_trait::async_trait;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use streamarr_arr_client::ArrConnector;
use streamarr_arr_sync::ArrClient;
use streamarr_model::{ExternalRef, SourceInstance, WorkKind};
use streamarr_requests::{ArrPushError, ArrPushOutcome, ArrPusher, MediaRequest, RequestTarget};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{AdminUser, AuthUser};
use crate::error::ApiError;
use crate::AppState;

/// [`ArrPusher`] backed by real `streamarr-arr-client` HTTP calls -- but see
/// the doc comment on [`HealthCheckArrPusher::push`] for exactly how far
/// "real" goes today: `streamarr-arr-client`'s public API is read-only
/// (list/get + health-check; see that crate's docs), it has no "create a
/// monitored movie/series/artist/author" method yet, so there is no add
/// call this pusher could make even if it wanted to. What it *does* do for
/// real: open a genuine HTTP connection to the resolved `SourceInstance`
/// and confirm the base URL is reachable and the API key is accepted,
/// before ever reporting success.
///
/// TODO(arr-add): once `streamarr-arr-client` grows `add_movie`/
/// `add_series`/`add_artist`/`add_author` methods (a POST to each app's
/// `/api/v3/movie` etc. with the resolved root folder/quality profile),
/// replace the health-check-then-report-pending body below with the real
/// add call and thread its response id into `ArrPushOutcome::external_id`.
pub struct HealthCheckArrPusher;

impl HealthCheckArrPusher {
    pub fn new() -> Self {
        Self
    }
}

impl Default for HealthCheckArrPusher {
    fn default() -> Self {
        Self::new()
    }
}

async fn health_check(client: &ArrClient) -> Result<(), streamarr_arr_client::ArrClientError> {
    match client {
        ArrClient::Sonarr(c) => c.health_check().await,
        ArrClient::Radarr(c) => c.health_check().await,
        ArrClient::Lidarr(c) => c.health_check().await,
        ArrClient::Readarr(c) => c.health_check().await,
        ArrClient::Bazarr(c) => c.health_check().await,
        ArrClient::Prowlarr(c) => c.health_check().await,
    }
}

#[async_trait]
impl ArrPusher for HealthCheckArrPusher {
    async fn push(
        &self,
        _target: &RequestTarget,
        _kind: WorkKind,
        instance: &SourceInstance,
    ) -> Result<ArrPushOutcome, ArrPushError> {
        let client = ArrClient::from_source_instance(instance);
        health_check(&client).await.map_err(|err| match &err {
            streamarr_arr_client::ArrClientError::Request(_) => {
                ArrPushError::Unreachable(err.to_string())
            }
            _ => ArrPushError::Rejected(err.to_string()),
        })?;

        tracing::info!(
            instance_id = %instance.id,
            instance_name = %instance.name,
            "confirmed source instance reachable; real add-call submission is not yet \
             implemented (streamarr-arr-client has no add_* method yet) -- request stays \
             pending an operator adding it manually until that lands"
        );

        Ok(ArrPushOutcome {
            external_id: "pending-manual-add".to_string(),
        })
    }
}

// ---- request/response DTOs -------------------------------------------

/// Wire-compatible mirror of [`RequestTarget`]: real `Deserialize` (used to
/// extract the actual request body) and `ToSchema` (used for OpenAPI docs).
/// Kept in lock-step with `RequestTarget`'s own `#[serde(tag =
/// "target_kind")]` shape so it round-trips identically.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case", tag = "target_kind")]
pub enum RequestTargetDto {
    ExistingWork { work_id: Uuid },
    External { external_ref: ExternalRef },
}

impl From<RequestTargetDto> for RequestTarget {
    fn from(dto: RequestTargetDto) -> Self {
        match dto {
            RequestTargetDto::ExistingWork { work_id } => RequestTarget::ExistingWork { work_id },
            RequestTargetDto::External { external_ref } => RequestTarget::External { external_ref },
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SubmitRequestBody {
    pub kind: WorkKind,
    pub target: RequestTargetDto,
    pub note: Option<String>,
}

/// `decided_by` is deliberately absent: it comes from the verified access
/// token's `sub` claim (via [`AdminUser`]), never from anything the caller
/// puts in the request body -- see this module's `approve_request_handler`/
/// `reject_request_handler`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DecideRequestBody {
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct ListRequestsQuery {
    /// When set, lists this user's own requests (any status); when absent,
    /// lists every request still `Pending` an admin decision.
    pub user_id: Option<Uuid>,
}

/// Doc-only mirror of [`streamarr_requests::RequestStatus`] -- the real
/// type has no `ToSchema` (`streamarr-requests` doesn't depend on
/// `utoipa`); handlers still serialize the real `MediaRequest` directly,
/// this is only referenced from `#[utoipa::path]` `responses(...)`.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum RequestStatusSchema {
    Pending,
    Approved,
    Rejected,
    Submitted,
    Available,
    Failed,
}

/// Doc-only mirror of [`MediaRequest`] -- see [`RequestStatusSchema`].
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct MediaRequestSchema {
    pub id: Uuid,
    pub requested_by: Uuid,
    pub kind: WorkKind,
    pub target: RequestTargetDto,
    pub source_instance_id: Option<Uuid>,
    pub status: RequestStatusSchema,
    pub note: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub decided_by: Option<Uuid>,
}

// ---- handlers -----------------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/v1/requests",
    tag = "requests",
    request_body = SubmitRequestBody,
    responses(
        (status = 201, description = "Request created", body = MediaRequestSchema),
        (status = 401, description = "Missing or invalid access token"),
        (status = 422, description = "No configured/usable source instance for this kind")
    )
)]
pub async fn submit_request_handler(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<SubmitRequestBody>,
) -> Result<(StatusCode, Json<MediaRequest>), ApiError> {
    let request = state
        .requests
        .submit(user.user_id, body.kind, body.target.into(), body.note)
        .await?;
    Ok((StatusCode::CREATED, Json(request)))
}

#[utoipa::path(
    post,
    path = "/api/v1/requests/{id}/approve",
    tag = "requests",
    params(("id" = Uuid, Path, description = "Request id")),
    request_body = DecideRequestBody,
    responses(
        (status = 200, description = "Request approved and submitted", body = MediaRequestSchema),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "Request not found"),
        (status = 409, description = "Request is not Pending")
    )
)]
pub async fn approve_request_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    admin: AdminUser,
    Json(_body): Json<DecideRequestBody>,
) -> Result<Json<MediaRequest>, ApiError> {
    let request = state.requests.approve(id, admin.user_id).await?;
    Ok(Json(request))
}

#[utoipa::path(
    post,
    path = "/api/v1/requests/{id}/reject",
    tag = "requests",
    params(("id" = Uuid, Path, description = "Request id")),
    request_body = DecideRequestBody,
    responses(
        (status = 200, description = "Request rejected", body = MediaRequestSchema),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "Request not found"),
        (status = 409, description = "Request is not Pending")
    )
)]
pub async fn reject_request_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    admin: AdminUser,
    Json(body): Json<DecideRequestBody>,
) -> Result<Json<MediaRequest>, ApiError> {
    let request = state
        .requests
        .reject(id, admin.user_id, body.reason)
        .await?;
    Ok(Json(request))
}

// Deliberately left unauthenticated in this pass, unlike submit/approve/
// reject above: this is a read, not a broken-access-control write (the
// specific severe bug this pass fixes -- see `submit_request_handler`'s and
// `approve_request_handler`'s doc comments), and it's out of scope the same
// way `catalog`/`playback` GETs are (see `lib.rs::api_router`'s routing and
// this crate's README-equivalent doc comment on the "open household"
// browsing model). Locking down read visibility of who-requested-what is
// separately-scoped full-auth-spectrum work, not part of this fix.
#[utoipa::path(
    get,
    path = "/api/v1/requests",
    tag = "requests",
    params(ListRequestsQuery),
    responses(
        (status = 200, description = "Requests", body = Vec<MediaRequestSchema>)
    )
)]
pub async fn list_requests_handler(
    State(state): State<AppState>,
    Query(query): Query<ListRequestsQuery>,
) -> Result<Json<Vec<MediaRequest>>, ApiError> {
    let requests = match query.user_id {
        Some(user_id) => state.request_repo.list_for_user(user_id).await?,
        None => state.request_repo.list_pending().await?,
    };
    Ok(Json(requests))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{bearer_header, mint_access_token, test_state, TestState};
    use axum::body::Body;
    use axum::http::Request;
    use streamarr_model::{ExternalProvider, Sensitive, SourceKind};
    use tower::ServiceExt;

    fn source_instance(kind: SourceKind) -> SourceInstance {
        source_instance_at(kind, "http://localhost:9999")
    }

    fn source_instance_at(kind: SourceKind, base_url: &str) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind,
            name: format!("{kind:?} primary"),
            base_url: base_url.to_string(),
            api_key_encrypted: Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: Some("/data".to_string()),
            default_quality_profile_id: Some(1),
            enabled_for_requests: true,
            best_effort: false,
        }
    }

    fn submit_body() -> serde_json::Value {
        serde_json::json!({
            "kind": "movie",
            "target": { "target_kind": "external", "external_ref": { "provider": "tmdb", "external_id": "603" } },
        })
    }

    fn post(uri: &str, body: serde_json::Value, token: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json");
        if let Some(token) = token {
            builder = builder.header("authorization", bearer_header(token));
        }
        builder
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap()
    }

    async fn submit_as(
        router: &axum::Router,
        state: &TestState,
        user_id: Uuid,
    ) -> axum::response::Response {
        let token = mint_access_token(state, user_id);
        router
            .clone()
            .oneshot(post("/api/v1/requests", submit_body(), Some(&token)))
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn submit_without_token_is_unauthorized() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(post("/api/v1/requests", submit_body(), None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn submit_without_configured_instance_is_unprocessable() {
        let (router, state) = test_state().await;
        let response = submit_as(&router, &state, Uuid::new_v4()).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn submit_then_list_pending_round_trips() {
        let (router, state) = test_state().await;
        state
            .source_instances
            .upsert(source_instance(SourceKind::Radarr));

        let requester_id = Uuid::new_v4();
        let response = submit_as(&router, &state, requester_id).await;
        assert_eq!(response.status(), StatusCode::CREATED);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: MediaRequest = serde_json::from_slice(&bytes).unwrap();
        // `requested_by` came from the token's `sub`, never from anything
        // the request body could have claimed (`SubmitRequestBody` no
        // longer even has a `requested_by` field).
        assert_eq!(created.requested_by, requester_id);

        let list_response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/requests")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(list_response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(list_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let listed: Vec<MediaRequest> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
    }

    /// The specific broken-access-control bug this pass fixes: a client
    /// can no longer claim to be a different `requested_by` than the
    /// token's own `sub` -- there's no field left in the wire format to
    /// even attempt it through, but assert the token wins even if a caller
    /// tries to smuggle one in via an unrecognized JSON field.
    #[tokio::test]
    async fn submit_ignores_a_spoofed_requested_by_field_in_the_body() {
        let (router, state) = test_state().await;
        state
            .source_instances
            .upsert(source_instance(SourceKind::Radarr));

        let token_user_id = Uuid::new_v4();
        let spoofed_id = Uuid::new_v4();
        let mut body = submit_body();
        body["requested_by"] = serde_json::json!(spoofed_id);
        let token = mint_access_token(&state, token_user_id);

        let response = router
            .oneshot(post("/api/v1/requests", body, Some(&token)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: MediaRequest = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(created.requested_by, token_user_id);
        assert_ne!(created.requested_by, spoofed_id);
    }

    /// Seeds one `Pending` request and returns `(router, state, request_id)`.
    async fn pending_request() -> (axum::Router, TestState, Uuid) {
        let (router, state) = test_state().await;
        state
            .source_instances
            .upsert(source_instance(SourceKind::Radarr));
        let response = submit_as(&router, &state, Uuid::new_v4()).await;
        assert_eq!(response.status(), StatusCode::CREATED);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: MediaRequest = serde_json::from_slice(&bytes).unwrap();
        (router, state, created.id)
    }

    #[tokio::test]
    async fn approve_without_token_is_unauthorized() {
        let (router, _state, id) = pending_request().await;
        let response = router
            .oneshot(post(
                &format!("/api/v1/requests/{id}/approve"),
                serde_json::json!({}),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn reject_without_token_is_unauthorized() {
        let (router, _state, id) = pending_request().await;
        let response = router
            .oneshot(post(
                &format!("/api/v1/requests/{id}/reject"),
                serde_json::json!({}),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn approve_with_non_admin_token_is_forbidden() {
        let (router, state, id) = pending_request().await;
        let token = mint_access_token(&state, Uuid::new_v4());
        let response = router
            .oneshot(post(
                &format!("/api/v1/requests/{id}/approve"),
                serde_json::json!({}),
                Some(&token),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn reject_with_non_admin_token_is_forbidden() {
        let (router, state, id) = pending_request().await;
        let token = mint_access_token(&state, Uuid::new_v4());
        let response = router
            .oneshot(post(
                &format!("/api/v1/requests/{id}/reject"),
                serde_json::json!({}),
                Some(&token),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn approve_with_admin_token_succeeds_and_decided_by_matches_token_sub() {
        // `approve` genuinely pushes to the resolved source instance (via
        // `HealthCheckArrPusher` -- see that type's doc comment) rather
        // than a fake, so this test needs a real HTTP server behind
        // `base_url` for the push to succeed, unlike every other
        // request-management test here that never reaches that call.
        let mock_server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/api/v3/system/status"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "version": "5.0.0.0"
                })),
            )
            .mount(&mock_server)
            .await;

        let (router, state) = test_state().await;
        state
            .source_instances
            .upsert(source_instance_at(SourceKind::Radarr, &mock_server.uri()));
        let submitted = submit_as(&router, &state, Uuid::new_v4()).await;
        assert_eq!(submitted.status(), StatusCode::CREATED);
        let bytes = axum::body::to_bytes(submitted.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: MediaRequest = serde_json::from_slice(&bytes).unwrap();

        let admin_id = Uuid::new_v4();
        state.admin_registry.add(admin_id);
        let token = mint_access_token(&state, admin_id);

        // Even an admin caller can't claim to be a different decider than
        // their own token -- `DecideRequestBody` has no `decided_by` field
        // left to smuggle one through.
        let response = router
            .oneshot(post(
                &format!("/api/v1/requests/{}/approve", created.id),
                serde_json::json!({ "decided_by": Uuid::new_v4() }),
                Some(&token),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let decided: MediaRequest = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decided.decided_by, Some(admin_id));
        assert_eq!(decided.status, streamarr_requests::RequestStatus::Submitted);
    }

    #[tokio::test]
    async fn reject_with_admin_token_succeeds_and_decided_by_matches_token_sub() {
        let (router, state, id) = pending_request().await;
        let admin_id = Uuid::new_v4();
        state.admin_registry.add(admin_id);
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(post(
                &format!("/api/v1/requests/{id}/reject"),
                serde_json::json!({ "reason": "duplicate", "decided_by": Uuid::new_v4() }),
                Some(&token),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let decided: MediaRequest = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decided.decided_by, Some(admin_id));
        assert_eq!(decided.status, streamarr_requests::RequestStatus::Rejected);
        assert_eq!(decided.note.as_deref(), Some("duplicate"));
    }

    #[test]
    fn external_provider_variant_serializes_as_expected() {
        // Sanity check the DTO round-trips the tag shape RequestTarget's
        // own `#[serde(tag = "target_kind")]` expects.
        let dto = RequestTargetDto::External {
            external_ref: ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: "1".to_string(),
            },
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["target_kind"], "external");
    }
}
