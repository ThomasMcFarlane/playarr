//! Liveness: "is this process alive and able to respond to HTTP at all".
//! Deliberately checks nothing else — a container orchestrator restarting
//! the process because *this* check fails should only ever happen when the
//! process is truly wedged, not because a downstream dependency (DB,
//! Redis, an *arr instance) is having a bad day. That's what
//! [`crate::readiness`] is for.

use axum::http::StatusCode;

#[utoipa::path(
    get,
    path = "/api/system/health",
    tag = "system",
    responses(
        (status = 200, description = "The process is alive and serving HTTP requests")
    )
)]
pub async fn health_handler() -> StatusCode {
    StatusCode::OK
}
