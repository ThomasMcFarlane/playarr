//! Administrator read/write API for instance-wide Streamarr settings.

use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use streamarr_model::SystemSettings;
use utoipa::ToSchema;

use crate::{AdminUser, ApiError, AppState};

const MAX_INSTANCE_NAME_CHARS: usize = 100;

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateSystemSettingsRequest {
    pub instance_name: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/system-settings",
    tag = "admin",
    responses(
        (status = 200, description = "Current instance-wide settings", body = SystemSettings, example = json!({
            "instance_name": "Streamarr"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn get_system_settings_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<SystemSettings>, ApiError> {
    let settings = state
        .system_settings_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load system settings: {err}")))?;
    Ok(Json(settings))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/system-settings",
    tag = "admin",
    request_body(content = UpdateSystemSettingsRequest, example = json!({
        "instance_name": "REGION-A Cinema"
    })),
    responses(
        (status = 200, description = "Updated instance-wide settings", body = SystemSettings, example = json!({
            "instance_name": "REGION-A Cinema"
        })),
        (status = 400, description = "Instance name is empty or longer than 100 characters"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn update_system_settings_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<UpdateSystemSettingsRequest>,
) -> Result<Json<SystemSettings>, ApiError> {
    let instance_name = body.instance_name.trim();
    if instance_name.is_empty() {
        return Err(ApiError::bad_request("instance name must not be empty"));
    }
    if instance_name.chars().count() > MAX_INSTANCE_NAME_CHARS {
        return Err(ApiError::bad_request(
            "instance name must be 100 characters or fewer",
        ));
    }

    let settings = SystemSettings {
        instance_name: instance_name.to_string(),
    };
    state
        .system_settings_repo
        .upsert(&settings)
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist system settings: {err}")))?;
    Ok(Json(settings))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{bearer_header, mint_access_token, seed_admin_user, test_state};
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use uuid::Uuid;

    #[tokio::test]
    async fn settings_require_an_admin() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/system-settings")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn admin_can_update_name_and_public_version_reflects_it() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/v1/admin/system-settings")
                    .header("authorization", bearer_header(&token))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"instance_name":"  REGION-A Cinema  "}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let settings: SystemSettings = serde_json::from_slice(&body).unwrap();
        assert_eq!(settings.instance_name, "REGION-A Cinema");

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/system/version")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let envelope: streamarr_model::VersionEnvelope = serde_json::from_slice(&body).unwrap();
        assert_eq!(envelope.instance_name, "REGION-A Cinema");
    }

    #[tokio::test]
    async fn update_rejects_blank_instance_name() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let response = router
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/v1/admin/system-settings")
                    .header("authorization", bearer_header(&token))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"instance_name":"   "}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
