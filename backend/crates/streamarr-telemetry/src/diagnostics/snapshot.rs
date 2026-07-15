//! A point-in-time diagnostic snapshot of this process: build/version
//! info, uptime, and a copy of the current metrics text. What
//! `internal_router`'s `/diagnostics/snapshot` route returns, and what a
//! future `streamarr diagnostics bundle` CLI command (see `streamarr-bin`)
//! could embed for support purposes.

use serde::Serialize;
use std::time::{Duration, Instant};

use crate::metrics::MetricsRegistry;

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsSnapshot {
    pub server_version: String,
    pub uptime_seconds: u64,
    pub metrics_text: String,
}

/// Tracks process start time so [`capture`] can report uptime without
/// every caller threading a start `Instant` through by hand.
#[derive(Clone)]
pub struct ProcessClock {
    started_at: Instant,
}

impl ProcessClock {
    pub fn start_now() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }

    pub fn uptime(&self) -> Duration {
        self.started_at.elapsed()
    }
}

impl Default for ProcessClock {
    fn default() -> Self {
        Self::start_now()
    }
}

pub fn capture(
    clock: &ProcessClock,
    metrics: &MetricsRegistry,
    server_version: &str,
) -> DiagnosticsSnapshot {
    DiagnosticsSnapshot {
        server_version: server_version.to_string(),
        uptime_seconds: clock.uptime().as_secs(),
        metrics_text: metrics.render(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_reports_server_version_and_metrics() {
        let clock = ProcessClock::start_now();
        let metrics = MetricsRegistry::new();
        metrics.incr_counter(crate::metrics::names::HTTP_REQUESTS_TOTAL, 1);

        let snapshot = capture(&clock, &metrics, "0.1.0");

        assert_eq!(snapshot.server_version, "0.1.0");
        assert!(snapshot.metrics_text.contains("http_requests_total"));
    }
}
