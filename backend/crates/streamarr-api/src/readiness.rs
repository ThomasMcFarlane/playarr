//! Readiness: "is this process ready to serve real traffic" — distinct
//! from [`crate::health`]'s liveness check because a process can be
//! perfectly alive while still starting up (migrations running, DB pool
//! not yet connected) or having lost a critical dependency it can't serve
//! requests without. A load balancer/orchestrator should stop routing
//! traffic on a readiness failure without restarting the process the way
//! it would for a liveness failure.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;

/// Flips to `true` once `streamarr-bin`'s startup sequence has finished
/// (migrations applied, DB pool connected) and back to `false` if a
/// critical dependency is later found to be unreachable. Cheap,
/// lock-free — safe to check on every readiness probe without contending
/// with request-handling code.
#[derive(Clone, Default)]
pub struct ReadinessState {
    ready: Arc<AtomicBool>,
}

impl ReadinessState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_ready(&self, ready: bool) {
        self.ready.store(ready, Ordering::SeqCst);
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }
}

#[utoipa::path(
    get,
    path = "/api/system/ready",
    tag = "system",
    responses(
        (status = 200, description = "Ready to serve traffic"),
        (status = 503, description = "Not ready yet (or no longer ready)")
    )
)]
pub async fn readiness_handler(State(state): State<ReadinessState>) -> StatusCode {
    if state.is_ready() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_not_ready_and_reflects_set_ready() {
        let state = ReadinessState::new();
        assert!(!state.is_ready());
        state.set_ready(true);
        assert!(state.is_ready());
        state.set_ready(false);
        assert!(!state.is_ready());
    }
}
