//! HTTP surface of the unified request model and the Ombi/Seerr integrations
//! (TASKS 280-287): the request list and admin decisions, integration CRUD,
//! the backend-mode setting and the signal-only webhook receiver. The sync
//! logic lives in [`crate::request_sync`].

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::{DateTime, Utc};
use playarr_model::discovery::DiscoveryKind;
use playarr_model::requests::{
    ExternalUser, IntegrationKind, MediaRequest, RequestBackend, RequestIntegration, RequestOrigin,
    RequestStatus, UserMappingStrategy, DEFAULT_POLL_INTERVAL_SECS, MIN_POLL_INTERVAL_SECS,
};
use playarr_model::Sensitive;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{AdminUser, CatalogViewer};
use crate::error::ApiError;
use crate::request_sync::{Decision, PullReport, SyncError};
use crate::AppState;

impl From<SyncError> for ApiError {
    fn from(e: SyncError) -> Self {
        let unprocessable =
            |code: &str, m: String| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, code, m);
        match e {
            SyncError::AlreadyRequested(_) => {
                ApiError::conflict("this title has already been requested")
            }
            SyncError::Unmapped(m) => {
                // The text can carry an integration name; the client gets neutral wording.
                tracing::info!(reason = %m, "requests: user not mapped");
                unprocessable(
                    "request_user_not_mapped",
                    "your account is not linked to a user in the request service; ask an administrator to map it"
                        .to_string(),
                )
            }
            SyncError::NoIntegration(k) => {
                tracing::info!(kind = k, "requests: no enabled integration");
                unprocessable(
                    "no_request_provider",
                    "no enabled request integration of that kind is configured".to_string(),
                )
            }
            SyncError::Remote(m) => {
                // The detail names the remote system; it stays in the log only.
                tracing::warn!(error = %m, "requests: remote failure");
                ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    "request_provider_failed",
                    "the request service could not complete the request",
                )
            }
            SyncError::Db(e) => e.into(),
            SyncError::NotFound => ApiError::not_found("request not found"),
        }
    }
}

/// A request as shown to a signed-in user. Household rule: only the
/// requester's own entries name them; other people's requests are listed (to
/// administrators) or summarised without a name.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RequestView {
    pub id: Uuid,
    pub title: String,
    pub kind: DiscoveryKind,
    pub year: Option<i32>,
    pub poster_url: Option<String>,
    pub tmdb_id: Option<i64>,
    pub tvdb_id: Option<i64>,
    pub seasons: Vec<i32>,
    pub status: RequestStatus,
    pub origin: RequestOrigin,
    /// The requester's name; visible to administrators and to the requester.
    pub requested_by: Option<String>,
    pub mine: bool,
    pub status_note: Option<String>,
    /// Systems tracking the request (`playarr`, `radarr/sonarr`, `ombi`, `seerr`); administrators only.
    pub systems: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub fn view_of(r: &MediaRequest, viewer: Uuid, admin: bool) -> RequestView {
    let mine = r.requester_user_id == Some(viewer);
    let mut systems = Vec::new();
    if admin {
        systems.push(r.origin.as_str().to_string());
        if r.direct_instance_id.is_some() && r.origin != RequestOrigin::Playarr {
            systems.push("playarr".into());
        }
        if r.direct_instance_id.is_some() {
            systems.push("arr".into());
        }
        for (k, set) in [
            ("ombi", r.ombi_request_id.is_some()),
            ("seerr", r.seerr_request_id.is_some()),
        ] {
            if set && !systems.iter().any(|s| s == k) {
                systems.push(k.into());
            }
        }
        systems.dedup();
    }
    RequestView {
        id: r.id,
        title: r.title.clone(),
        kind: r.kind,
        year: r.year,
        poster_url: r.poster_url.clone(),
        tmdb_id: r.tmdb_id,
        tvdb_id: r.tvdb_id,
        seasons: r.seasons.clone(),
        status: r.status,
        origin: r.origin,
        requested_by: if admin || mine {
            r.requester_label.clone()
        } else {
            None
        },
        mine,
        status_note: if admin || mine {
            r.status_note.clone()
        } else {
            None
        },
        systems,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct ListRequestsQuery {
    /// Administrators only: `false` lists every request, default lists their own.
    pub mine: Option<bool>,
}

#[utoipa::path(
    get,
    path = "/api/v1/requests",
    tag = "requests",
    params(ListRequestsQuery),
    responses((status = 200, description = "Requests, newest first. Administrators get every request unless mine=true.", body = Vec<RequestView>))
)]
pub async fn list_requests_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(q): Query<ListRequestsQuery>,
) -> Result<Json<Vec<RequestView>>, ApiError> {
    let admin = viewer.policy.is_admin;
    let all = admin && q.mine != Some(true);
    let rows = if all {
        state.request_sync.requests.list().await?
    } else {
        state
            .request_sync
            .requests
            .list_for_user(viewer.user_id)
            .await?
    };
    Ok(Json(
        rows.iter()
            .map(|r| view_of(r, viewer.user_id, admin))
            .collect(),
    ))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DecisionBody {
    pub decision: Decision,
    pub reason: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/requests/{id}/decision",
    tag = "requests",
    params(("id" = Uuid, Path, description = "Request id")),
    request_body = DecisionBody,
    responses(
        (status = 200, description = "Decision applied here and in Ombi/Seerr", body = RequestView),
        (status = 404, description = "Unknown request"),
        (status = 502, description = "Ombi or Seerr rejected the change")
    )
)]
pub async fn decide_request_handler(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<RequestView>, ApiError> {
    let row = state
        .request_sync
        .decide(id, body.decision, body.reason.as_deref())
        .await?;
    Ok(Json(view_of(&row, admin.user_id, true)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/requests/{id}",
    tag = "requests",
    params(("id" = Uuid, Path, description = "Request id")),
    responses(
        (status = 204, description = "Removed here and in Ombi/Seerr"),
        (status = 404, description = "Unknown request"),
        (status = 502, description = "Ombi or Seerr could not remove it")
    )
)]
pub async fn remove_request_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    state.request_sync.remove(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct IntegrationView {
    pub id: Uuid,
    pub kind: IntegrationKind,
    pub name: String,
    pub base_url: String,
    pub api_key_set: bool,
    pub api_key_env: Option<String>,
    pub enabled: bool,
    pub poll_interval_secs: u32,
    pub mapping: UserMappingStrategy,
    /// Playarr user id -> external user id.
    pub user_map: BTreeMap<String, String>,
    /// Path to configure as the webhook in Ombi or Seerr.
    pub webhook_path: String,
    /// Shared secret the webhook must send (`Authorization: Bearer ...`).
    pub webhook_secret: String,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

fn integration_view(i: &RequestIntegration) -> IntegrationView {
    IntegrationView {
        id: i.id,
        kind: i.kind,
        name: i.name.clone(),
        base_url: i.base_url.clone(),
        api_key_set: !i.api_key.expose_secret().is_empty()
            || i.api_key_env.as_deref().is_some_and(|e| !e.is_empty()),
        api_key_env: i.api_key_env.clone(),
        enabled: i.enabled,
        poll_interval_secs: i.poll_interval_secs,
        mapping: i.mapping,
        user_map: i.user_map.clone(),
        webhook_path: format!("/api/v1/requests/webhook/{}", i.id),
        webhook_secret: i.webhook_secret.expose_secret().clone(),
        last_sync_at: i.last_sync_at,
        last_error: i.last_error.clone(),
    }
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct IntegrationInput {
    pub kind: IntegrationKind,
    pub name: String,
    pub base_url: String,
    /// Omit on update to keep the stored key.
    pub api_key: Option<String>,
    /// Environment variable (mounted from a Kubernetes Secret) holding the key.
    pub api_key_env: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub poll_interval_secs: Option<u32>,
    pub mapping: Option<UserMappingStrategy>,
    #[serde(default)]
    pub user_map: BTreeMap<String, String>,
    /// Replace the webhook secret with a fresh one.
    #[serde(default)]
    pub rotate_webhook_secret: bool,
}

fn default_true() -> bool {
    true
}

fn new_secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn validate(input: &IntegrationInput) -> Result<(), ApiError> {
    if input.name.trim().is_empty() {
        return Err(ApiError::bad_request("name must not be empty"));
    }
    let url = input.base_url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(ApiError::bad_request(
            "base_url must start with http:// or https://",
        ));
    }
    Ok(())
}

fn apply(input: IntegrationInput, existing: Option<RequestIntegration>) -> RequestIntegration {
    let prev = existing.as_ref();
    let api_key = match input.api_key.as_deref().map(str::trim) {
        Some(k) if !k.is_empty() => k.to_string(),
        _ => prev
            .map(|p| p.api_key.expose_secret().clone())
            .unwrap_or_default(),
    };
    let secret = match prev {
        Some(p) if !input.rotate_webhook_secret && !p.webhook_secret.expose_secret().is_empty() => {
            p.webhook_secret.expose_secret().clone()
        }
        _ => new_secret(),
    };
    RequestIntegration {
        id: prev.map(|p| p.id).unwrap_or_else(Uuid::new_v4),
        kind: input.kind,
        name: input.name.trim().to_string(),
        base_url: input.base_url.trim().trim_end_matches('/').to_string(),
        api_key: Sensitive::new(api_key),
        api_key_env: input
            .api_key_env
            .map(|e| e.trim().to_string())
            .filter(|e| !e.is_empty()),
        enabled: input.enabled,
        poll_interval_secs: input
            .poll_interval_secs
            .unwrap_or(DEFAULT_POLL_INTERVAL_SECS)
            .max(MIN_POLL_INTERVAL_SECS),
        mapping: input.mapping.unwrap_or(UserMappingStrategy::Email),
        user_map: input.user_map,
        webhook_secret: Sensitive::new(secret),
        last_sync_at: prev.and_then(|p| p.last_sync_at),
        last_error: prev.and_then(|p| p.last_error.clone()),
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/request-integrations",
    tag = "requests",
    responses((status = 200, description = "Configured Ombi/Seerr integrations", body = Vec<IntegrationView>))
)]
pub async fn list_integrations_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<IntegrationView>>, ApiError> {
    let list = state.request_sync.integrations.list().await?;
    Ok(Json(list.iter().map(integration_view).collect()))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/request-integrations",
    tag = "requests",
    request_body = IntegrationInput,
    responses((status = 201, description = "Created", body = IntegrationView), (status = 400, description = "Invalid input"))
)]
pub async fn create_integration_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<IntegrationInput>,
) -> Result<(StatusCode, Json<IntegrationView>), ApiError> {
    validate(&input)?;
    let i = apply(input, None);
    state.request_sync.integrations.upsert(&i).await?;
    Ok((StatusCode::CREATED, Json(integration_view(&i))))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/request-integrations/{id}",
    tag = "requests",
    params(("id" = Uuid, Path, description = "Integration id")),
    request_body = IntegrationInput,
    responses((status = 200, description = "Updated", body = IntegrationView), (status = 404, description = "Unknown integration"))
)]
pub async fn update_integration_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(input): Json<IntegrationInput>,
) -> Result<Json<IntegrationView>, ApiError> {
    validate(&input)?;
    let existing = state
        .request_sync
        .integrations
        .get(id)
        .await?
        .ok_or_else(|| ApiError::not_found("integration not found"))?;
    let i = apply(input, Some(existing));
    state.request_sync.integrations.upsert(&i).await?;
    Ok(Json(integration_view(&i)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/request-integrations/{id}",
    tag = "requests",
    params(("id" = Uuid, Path, description = "Integration id")),
    responses((status = 204, description = "Deleted; imported requests are kept"), (status = 404, description = "Unknown integration"))
)]
pub async fn delete_integration_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    if state.request_sync.integrations.delete(id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found("integration not found"))
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IntegrationTestResult {
    pub ok: bool,
    pub version: Option<String>,
    pub error: Option<String>,
    pub external_users: usize,
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/request-integrations/{id}/test",
    tag = "requests",
    params(("id" = Uuid, Path, description = "Integration id")),
    responses((status = 200, description = "Connection test result", body = IntegrationTestResult), (status = 404, description = "Unknown integration"))
)]
pub async fn test_integration_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<IntegrationTestResult>, ApiError> {
    let i = state
        .request_sync
        .integrations
        .get(id)
        .await?
        .ok_or_else(|| ApiError::not_found("integration not found"))?;
    let client = state.request_sync.client(&i);
    let outcome = async {
        let version = client.test().await?;
        let users = client.users().await?;
        Ok::<_, playarr_arr_client::ArrClientError>((version, users.len()))
    };
    let result = match tokio::time::timeout(std::time::Duration::from_secs(20), outcome).await {
        Ok(Ok((version, n))) => IntegrationTestResult {
            ok: true,
            version: Some(version),
            error: None,
            external_users: n,
        },
        Ok(Err(e)) => IntegrationTestResult {
            ok: false,
            version: None,
            error: Some(e.to_string()),
            external_users: 0,
        },
        Err(_) => IntegrationTestResult {
            ok: false,
            version: None,
            error: Some("timed out".into()),
            external_users: 0,
        },
    };
    Ok(Json(result))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/request-integrations/{id}/users",
    tag = "requests",
    params(("id" = Uuid, Path, description = "Integration id")),
    responses((status = 200, description = "Users of the external system, for the mapping editor", body = Vec<ExternalUser>), (status = 404, description = "Unknown integration"), (status = 502, description = "The external system is unreachable"))
)]
pub async fn integration_users_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<ExternalUser>>, ApiError> {
    let i = state
        .request_sync
        .integrations
        .get(id)
        .await?
        .ok_or_else(|| ApiError::not_found("integration not found"))?;
    let users = state
        .request_sync
        .client(&i)
        .users()
        .await
        .map_err(|e| SyncError::Remote(e.to_string()))?;
    Ok(Json(users))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/request-integrations/{id}/sync",
    tag = "requests",
    params(("id" = Uuid, Path, description = "Integration id")),
    responses((status = 200, description = "Pull finished", body = PullReport), (status = 404, description = "Unknown integration"), (status = 502, description = "The external system failed"))
)]
pub async fn sync_integration_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<PullReport>, ApiError> {
    Ok(Json(state.request_sync.pull(id).await?))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RequestSettings {
    pub backend: RequestBackend,
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/request-settings",
    tag = "requests",
    responses((status = 200, description = "Where Playarr sends user requests", body = RequestSettings))
)]
pub async fn get_request_settings_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Json<RequestSettings> {
    Json(RequestSettings {
        backend: state.request_sync.backend().await,
    })
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/request-settings",
    tag = "requests",
    request_body = RequestSettings,
    responses((status = 200, description = "Saved", body = RequestSettings), (status = 422, description = "The chosen backend has no enabled integration"))
)]
pub async fn put_request_settings_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<RequestSettings>,
) -> Result<Json<RequestSettings>, ApiError> {
    let needed = match body.backend {
        RequestBackend::Ombi => Some(IntegrationKind::Ombi),
        RequestBackend::Seerr => Some(IntegrationKind::Seerr),
        _ => None,
    };
    if let Some(kind) = needed {
        if state.request_sync.enabled_integration(kind).await.is_none() {
            return Err(SyncError::NoIntegration(kind.as_str()).into());
        }
    }
    state.request_sync.set_backend(body.backend).await?;
    Ok(Json(body))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WebhookAck {
    pub accepted: bool,
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    let raw = headers
        .get("authorization")
        .or_else(|| headers.get("x-webhook-secret"))?
        .to_str()
        .ok()?
        .trim();
    Some(
        raw.strip_prefix("Bearer ")
            .unwrap_or(raw)
            .trim()
            .to_string(),
    )
}

#[utoipa::path(
    post,
    path = "/api/v1/requests/webhook/{integration_id}",
    tag = "requests",
    params(("integration_id" = Uuid, Path, description = "Integration id")),
    request_body = serde_json::Value,
    responses(
        (status = 202, description = "Signal accepted; a pull runs in the background (the body is never trusted)", body = WebhookAck),
        (status = 401, description = "Missing or wrong webhook secret"),
        (status = 404, description = "Unknown integration")
    )
)]
pub async fn requests_webhook_handler(
    State(state): State<AppState>,
    Path(integration_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<WebhookAck>), ApiError> {
    let i = state
        .request_sync
        .integrations
        .get(integration_id)
        .await?
        .ok_or_else(|| ApiError::not_found("integration not found"))?;
    let secret = i.webhook_secret.expose_secret();
    let given = bearer(&headers).unwrap_or_default();
    if secret.is_empty()
        || given.len() != secret.len()
        || !constant_time_eq(given.as_bytes(), secret.as_bytes())
    {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "invalid webhook secret",
        ));
    }
    if i.enabled {
        let sync = state.request_sync.clone();
        tokio::spawn(async move {
            if let Err(e) = sync.pull(integration_id).await {
                tracing::warn!(error = %e, "requests: webhook-triggered pull failed");
            }
        });
    }
    Ok((
        StatusCode::ACCEPTED,
        Json(WebhookAck {
            accepted: i.enabled,
        }),
    ))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
