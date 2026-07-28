//! Request correlation: propagating one id across a request's full
//! lifecycle — the Axum handler, any background work it spawns via
//! [`spawn::spawn_traced`], and any downstream *arr/Tdarr client calls it
//! makes — so every log line and span emitted while serving one request
//! can be queried together by `correlation_id`.

pub mod middleware;
pub mod spawn;

pub use middleware::{correlation_id_middleware, CORRELATION_ID_HEADER};
pub use spawn::spawn_traced;

use uuid::Uuid;

/// The tracing span field name every span in a request's lifecycle should
/// carry, so structured log queries filter on it consistently regardless
/// of which crate/module emitted the span.
pub const CORRELATION_ID_FIELD: &str = "correlation_id";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CorrelationId(pub Uuid);

impl CorrelationId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for CorrelationId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for CorrelationId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
