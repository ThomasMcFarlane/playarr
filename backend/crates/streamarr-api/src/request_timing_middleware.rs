//! Axum middleware that times every request this router actually routes,
//! records the duration into `AppState::request_timing`, and emits a
//! per-request `tracing::info!` line (method, route template, response
//! status, duration) so the same numbers also show up in the normal JSON
//! stdout logs, not just the aggregated admin endpoint.
//!
//! Deliberately keyed on [`MatchedPath`] (the Axum *route template*, e.g.
//! `/api/v1/catalog/{id}`), not `req.uri().path()` -- see
//! `streamarr_telemetry::request_timing`'s module doc comment for why a
//! raw path with real ids interpolated would blow the recorder's key
//! space open. A request that never matched a route (a 404) simply has no
//! `MatchedPath` extension and is left unrecorded -- not specially cased,
//! just the natural consequence of looking the extension up and finding
//! nothing.
//!
//! Must be layered (via [`axum::middleware::from_fn_with_state`]) onto the
//! router returned by `api_router().with_state(state)` -- i.e. after every
//! route is already registered -- for `MatchedPath` to actually be
//! present by the time this middleware runs; see `crate::build_router`'s
//! doc comment for where this is wired in.

use std::time::Instant;

use axum::extract::{MatchedPath, Request, State};
use axum::middleware::Next;
use axum::response::Response;

use crate::AppState;

pub async fn record_request_timing(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|matched_path| matched_path.as_str().to_string());

    let start = Instant::now();
    let response = next.run(req).await;
    let duration = start.elapsed();

    if let Some(route) = route {
        let status = response.status().as_u16();
        let duration_ms = duration.as_secs_f64() * 1000.0;

        state
            .request_timing
            .record(method.clone(), route.clone(), duration);
        tracing::info!(
            %method,
            %route,
            status,
            duration_ms,
            "handled http request"
        );
    }

    response
}
