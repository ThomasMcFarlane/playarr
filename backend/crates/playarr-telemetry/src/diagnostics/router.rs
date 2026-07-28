//! Diagnostics routes mounted on the main **public** API router — a small,
//! intentionally limited surface. Full metrics text and the full
//! [`super::snapshot::DiagnosticsSnapshot`] live behind
//! [`super::internal_router`] instead, bound on its own port, so raw
//! metrics never need to be exposed on a public-facing ingress.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};

use super::snapshot::ProcessClock;
use crate::metrics::MetricsRegistry;

#[derive(Clone)]
pub struct DiagnosticsState {
    pub clock: ProcessClock,
    pub metrics: MetricsRegistry,
    pub server_version: String,
}

pub fn router(state: DiagnosticsState) -> Router {
    Router::new()
        .route("/api/diagnostics/version", get(version_handler))
        .with_state(state)
}

async fn version_handler(State(state): State<DiagnosticsState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "server_version": state.server_version,
        "uptime_seconds": state.clock.uptime().as_secs(),
    }))
}
