//! `GET /api/system/version` — returns the server's own version plus the
//! full client compatibility table, so clients can self-check whether
//! they're outdated without waiting to be rejected by
//! [`crate::version_gate`] on some other call.

use axum::extract::State;
use axum::Json;
use streamarr_model::VersionEnvelope;

use crate::{ApiError, AppState};

#[derive(Clone)]
pub struct VersionState {
    pub envelope: VersionEnvelope,
}

#[utoipa::path(
    get,
    path = "/api/system/version",
    tag = "system",
    responses(
        (status = 200, description = "Server version and client compatibility table", body = VersionEnvelope)
    )
)]
pub async fn version_handler(
    State(state): State<AppState>,
) -> Result<Json<VersionEnvelope>, ApiError> {
    let settings = state
        .system_settings_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load system settings: {err}")))?;
    let mut envelope = state.version.envelope.clone();
    envelope.instance_name = settings.instance_name;
    Ok(Json(envelope))
}
