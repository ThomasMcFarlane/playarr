//! `streamarr-telemetry` — logging, request correlation, metrics, optional
//! OpenTelemetry export, playback analytics collection, and diagnostics
//! endpoints, wired together by [`init`].
//!
//! [`init`] is the one function this crate genuinely commits to being
//! functional today, not just correctly shaped: it builds a real
//! `tracing-subscriber` `Registry` with a JSON-formatted, env-filtered,
//! non-blocking stdout logging layer (see [`logging::subscriber`]) and
//! installs it as the process's global default subscriber. Everything
//! else in this crate (metrics registry, analytics collector, diagnostics
//! routers, the optional OTel layer) is real, callable, independently
//! testable code that `streamarr-bin` wires up around that subscriber —
//! see each module's doc comment for what's fully implemented versus
//! intentionally left as a documented skeleton.

pub mod analytics;
pub mod correlation;
pub mod diagnostics;
pub mod logging;
pub mod metrics;
pub mod otel;

use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{Layer, Registry};

/// Holds every resource the initialized telemetry stack needs to keep
/// alive for the life of the process (currently: the logging non-blocking
/// writer's flush thread). Keep this bound in `main` for as long as the
/// process runs; when it drops, buffered log lines are flushed.
pub struct TelemetryGuard {
    _logging_guard: logging::LoggingGuard,
}

/// Initializes the global `tracing` subscriber: a JSON stdout logging
/// layer gated by `config.log_filter`, plus the optional OTel export layer
/// from [`otel::build_otel_layer`] when `config.otlp_endpoint` is set.
/// Call exactly once, as early as possible in `main` — every `tracing::*`
/// call anywhere in the process (including other crates') routes through
/// whatever this installs as the global default.
pub fn init(config: &streamarr_config::Config) -> TelemetryGuard {
    let (fmt_layer, logging_guard) = logging::build_fmt_layer::<Registry>(&config.log_filter);

    // Every layer here is parameterized over the same base `Registry`
    // (rather than each `.with()` call changing the subscriber's type, the
    // way it would chaining `registry().with(a).with(b)` with two
    // differently-typed layers) and collected into one `Vec`, because
    // `Vec<Box<dyn Layer<S>>>` itself implements `Layer<S>`. That lets the
    // number of active layers vary at runtime (zero or one OTel layer,
    // depending on config) without the whole subscriber's type depending
    // on that runtime decision.
    let mut layers: Vec<Box<dyn Layer<Registry> + Send + Sync>> = vec![fmt_layer];
    if let Some(otel_layer) = otel::build_otel_layer::<Registry>(config) {
        layers.push(otel_layer);
    }

    tracing_subscriber::registry().with(layers).init();

    TelemetryGuard {
        _logging_guard: logging_guard,
    }
}
