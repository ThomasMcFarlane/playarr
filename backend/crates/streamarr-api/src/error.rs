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

#[derive(Debug, Clone)]
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

    pub fn bad_gateway(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "source_instance_unreachable",
            message,
        )
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

impl From<streamarr_transcode::TranscodeError> for ApiError {
    fn from(err: streamarr_transcode::TranscodeError) -> Self {
        use streamarr_transcode::TranscodeError;
        match err {
            TranscodeError::NoCapacity => Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "no_transcode_capacity",
                "no on-demand transcode capacity available on this node",
            ),
            TranscodeError::Db(streamarr_db::DbError::NotFound) => {
                Self::not_found("rendition not found")
            }
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

impl From<crate::source_registry::SyncTriggerError> for ApiError {
    fn from(err: crate::source_registry::SyncTriggerError) -> Self {
        use crate::source_registry::SyncTriggerError;
        match err {
            SyncTriggerError::NotFound => Self::not_found("source instance not found"),
            SyncTriggerError::PollerNotRunning => Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "poller_not_running",
                "no reconciliation poller is currently running for this source instance yet -- \
                 it may still be starting up (checked every 10s after registration)",
            ),
        }
    }
}

impl From<streamarr_auth::RefreshError> for ApiError {
    fn from(err: streamarr_auth::RefreshError) -> Self {
        use streamarr_auth::RefreshError;
        match err {
            // Every "this refresh token doesn't work anymore" reason maps
            // to the same 401 -- same "don't leak which part was wrong"
            // rationale as `LoginError`'s mapping just below. A caller
            // whose refresh token is dead (expired, reused, family
            // revoked, or simply unknown) has one correct next step either
            // way: send the user through a real login again.
            RefreshError::UnknownToken
            | RefreshError::Expired
            | RefreshError::ReuseDetected
            | RefreshError::FamilyRevoked => Self::new(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "refresh token is invalid or expired",
            ),
            RefreshError::Db(inner) => inner.into(),
            RefreshError::Jwt(err) => Self::internal(err.to_string()),
        }
    }
}

impl From<streamarr_auth::LoginError> for ApiError {
    fn from(err: streamarr_auth::LoginError) -> Self {
        use streamarr_auth::LoginError;
        match err {
            // The caller's request was malformed for the operator's
            // configured trust tier (e.g. no credentials at all under
            // `AuthMode::FullAccount`) -- a client bug, not a failed auth
            // attempt, so `400` fits better than `401`.
            LoginError::CredentialsRequired | LoginError::PinRequired => {
                Self::bad_request(err.to_string())
            }
            // A real, failed authentication attempt -- deliberately mapped
            // to the same `401`/`unauthorized` code regardless of which
            // specific reason it was, so a response never tells an
            // attacker which part of a guess was wrong (matches
            // `evaluate_login`'s own "without leaking which part was
            // wrong" behavior for unknown-username vs. wrong-password).
            LoginError::UntrustedNetwork
            | LoginError::InvalidCredentials
            | LoginError::InvalidPin
            | LoginError::AccountDisabled => {
                Self::new(StatusCode::UNAUTHORIZED, "unauthorized", err.to_string())
            }
            LoginError::Directory(message) => Self::internal(message),
            LoginError::Session(inner) => Self::internal(inner.to_string()),
        }
    }
}
