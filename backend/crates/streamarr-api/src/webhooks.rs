//! The *arr webhook receiver: `POST /webhooks/{instance_id}` -- looks up
//! `instance_id` against [`crate::source_registry::SourceInstanceRegistry`]
//! to learn which `SourceKind` (and therefore which payload shape) it is,
//! then hands the raw body to [`streamarr_arr_sync::WebhookReceiver`],
//! which defensively extracts a [`streamarr_arr_sync::RefetchRequest`] and
//! enqueues it for the reconciliation poller -- see that crate's docs for
//! why the webhook body itself is never trusted as authoritative.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde_json::Value;
use uuid::Uuid;

use crate::error::ApiError;
use crate::AppState;

#[utoipa::path(
    post,
    path = "/webhooks/{instance_id}",
    tag = "webhooks",
    params(("instance_id" = Uuid, Path, description = "Configured SourceInstance id")),
    request_body = Value,
    responses(
        (status = 202, description = "Signal parsed and enqueued for the reconciliation poller"),
        (status = 400, description = "Payload has no recognizable eventType"),
        (status = 404, description = "Unknown source_instance_id")
    )
)]
pub async fn arr_webhook_handler(
    State(state): State<AppState>,
    Path(instance_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> Result<StatusCode, ApiError> {
    let instance = state
        .source_instances
        .get(instance_id)
        .ok_or_else(|| ApiError::not_found(format!("unknown source instance {instance_id}")))?;

    state
        .webhook
        .handle(instance_id, instance.kind, body)
        .await
        .map_err(|err| ApiError::bad_request(err.to_string()))?;

    Ok(StatusCode::ACCEPTED)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::Request;
    use streamarr_model::{Sensitive, SourceKind};
    use tower::ServiceExt;

    fn source_instance(id: Uuid, kind: SourceKind) -> streamarr_model::SourceInstance {
        streamarr_model::SourceInstance {
            id,
            kind,
            name: "test".to_string(),
            base_url: "http://localhost".to_string(),
            api_key_encrypted: Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: None,
            default_quality_profile_id: None,
            enabled_for_requests: false,
            best_effort: false,
        }
    }

    #[tokio::test]
    async fn unknown_instance_is_404() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/webhooks/{}", Uuid::new_v4()))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"eventType":"Download"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn known_instance_with_valid_payload_is_accepted() {
        let (router, state) = test_state().await;
        let instance_id = Uuid::new_v4();
        state
            .source_instances
            .upsert(source_instance(instance_id, SourceKind::Sonarr));

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/webhooks/{instance_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"eventType":"SeriesAdd","series":{"id":1}}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
    }

    #[tokio::test]
    async fn missing_event_type_is_bad_request() {
        let (router, state) = test_state().await;
        let instance_id = Uuid::new_v4();
        state
            .source_instances
            .upsert(source_instance(instance_id, SourceKind::Radarr));

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/webhooks/{instance_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"movie":{"id":1}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
