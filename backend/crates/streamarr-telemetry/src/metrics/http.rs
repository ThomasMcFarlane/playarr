//! The `/metrics` scrape endpoint, bound on `Config::metrics_bind_addr` —
//! a separate listener from the public API, per `streamarr-bin`'s startup
//! wiring, so it can be firewalled off from any public-facing ingress
//! without needing auth middleware of its own.

use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;

use super::MetricsRegistry;

pub fn router(registry: MetricsRegistry) -> Router {
    Router::new()
        .route("/metrics", get(metrics_handler))
        .with_state(registry)
}

async fn metrics_handler(State(registry): State<MetricsRegistry>) -> impl IntoResponse {
    (
        [("content-type", "text/plain; version=0.0.4")],
        registry.render(),
    )
}
