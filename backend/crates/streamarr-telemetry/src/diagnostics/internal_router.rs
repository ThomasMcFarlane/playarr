//! The operator-only diagnostics/metrics surface: full metrics text plus
//! the full [`DiagnosticsSnapshot`]. Bound on `Config::metrics_bind_addr`
//! (a separate listener from the public API's `http_bind_addr`) by
//! `streamarr-bin`'s startup, so it can be kept off any public-facing
//! load balancer/ingress entirely rather than needing auth middleware of
//! its own to stay safe.

use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};

use super::snapshot::{self, DiagnosticsSnapshot, ProcessClock};
use crate::metrics::MetricsRegistry;

#[derive(Clone)]
pub struct InternalDiagnosticsState {
    pub clock: ProcessClock,
    pub metrics: MetricsRegistry,
    pub server_version: String,
}

pub fn router(state: InternalDiagnosticsState) -> Router {
    Router::new()
        .route("/metrics", get(metrics_handler))
        .route("/diagnostics/snapshot", get(snapshot_handler))
        .with_state(state)
}

async fn metrics_handler(State(state): State<InternalDiagnosticsState>) -> impl IntoResponse {
    (
        [("content-type", "text/plain; version=0.0.4")],
        state.metrics.render(),
    )
}

async fn snapshot_handler(
    State(state): State<InternalDiagnosticsState>,
) -> Json<DiagnosticsSnapshot> {
    Json(snapshot::capture(
        &state.clock,
        &state.metrics,
        &state.server_version,
    ))
}
