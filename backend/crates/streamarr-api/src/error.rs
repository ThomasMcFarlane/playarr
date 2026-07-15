//! A single `IntoResponse`-implementing error type every new (non-system)
//! handler in this crate maps its service-layer error into, so the wire
//! shape of an error response (`{"error": "<code>", "message": "<...>"}`)
//! and the status-code-per-failure-mode decisions live in one place rather
//! than being re-invented per handler.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ErrorBody {
    /// A short, stable, machine-matchable code -- e.g. `"not_found"`,
    /// `"invalid_transition"`. Deliberately not the `Display` text of the
    /// underlying error (which can change wording without that being a
    /// breaking API change); `message` carries that instead.
    pub error: String,
    pub message: String,
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub body: ErrorBody,
}

impl ApiError {
    pub fn new(status: StatusCode, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            body: ErrorBody {
                error: code.into(),
                message: message.into(),
            },
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "conflict", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

impl From<streamarr_db::DbError> for ApiError {
    fn from(err: streamarr_db::DbError) -> Self {
        match err {
            streamarr_db::DbError::NotFound => Self::not_found("record not found"),
            other => Self::internal(other.to_string()),
        }
    }
}

impl From<streamarr_catalog::CatalogError> for ApiError {
    fn from(err: streamarr_catalog::CatalogError) -> Self {
        match err {
            streamarr_catalog::CatalogError::NotFound => Self::not_found("work not found"),
            other => Self::internal(other.to_string()),
        }
    }
}

impl From<streamarr_requests::RequestError> for ApiError {
    fn from(err: streamarr_requests::RequestError) -> Self {
        use streamarr_requests::RequestError;
        match err {
            RequestError::NotFound => Self::not_found("request not found"),
            RequestError::Db(streamarr_db::DbError::NotFound) => {
                Self::not_found("request not found")
            }
            RequestError::Db(other) => Self::internal(other.to_string()),
            RequestError::InvalidTransition(id) => Self::new(
                StatusCode::CONFLICT,
                "invalid_transition",
                format!("request {id} is not in a state that allows this transition"),
            ),
            RequestError::NoSourceInstance { kind } => Self::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "no_source_instance",
                format!("no source instance is configured and enabled for {kind:?} requests"),
            ),
            RequestError::SourceInstanceNotConfigured { .. } => Self::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "source_instance_not_configured",
                err.to_string(),
            ),
            RequestError::ArrPush(inner) => Self::new(
                StatusCode::BAD_GATEWAY,
                "arr_push_failed",
                inner.to_string(),
            ),
        }
    }
}

impl From<streamarr_transcode::TranscodeError> for ApiError {
    fn from(err: streamarr_transcode::TranscodeError) -> Self {
        use streamarr_transcode::TranscodeError;
        match err {
            TranscodeError::NoCapacity => Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "no_transcode_capacity",
                "no on-demand transcode capacity available on this node",
            ),
            other => Self::internal(other.to_string()),
        }
    }
}

impl From<streamarr_auth::device_flow::DeviceFlowError> for ApiError {
    fn from(err: streamarr_auth::device_flow::DeviceFlowError) -> Self {
        use streamarr_auth::device_flow::DeviceFlowError;
        match err {
            DeviceFlowError::NotFound => Self::not_found("unknown or expired user code"),
            DeviceFlowError::Db(inner) => inner.into(),
        }
    }
}
