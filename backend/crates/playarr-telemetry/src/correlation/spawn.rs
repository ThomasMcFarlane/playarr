//! [`spawn_traced`] — spawn a future onto Tokio with a tracing span
//! entered for its entire lifetime, so background work (a spawned
//! reconciliation pass, an on-demand transcode session) shows up nested
//! under the request/job span that triggered it instead of as an
//! untraceable orphan task once it leaves the handler that spawned it.

use std::future::Future;

use tokio::task::JoinHandle;
use tracing::{Instrument, Span};

/// Spawns `future` with `span` entered around its whole execution.
/// Equivalent to `tokio::spawn(future.instrument(span))` spelled out as
/// its own function so call sites read as "spawn, traced" rather than
/// requiring every caller to remember the `.instrument()` incantation (and
/// to import the `Instrument` trait) themselves.
pub fn spawn_traced<F>(span: Span, future: F) -> JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    tokio::spawn(future.instrument(span))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn spawned_future_runs_and_returns_its_output() {
        let span = tracing::info_span!("test_span");
        let handle = spawn_traced(span, async { 1 + 1 });
        assert_eq!(handle.await.unwrap(), 2);
    }
}
