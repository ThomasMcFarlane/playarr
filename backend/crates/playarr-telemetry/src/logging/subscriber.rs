//! Builds the JSON logging layer: the one piece of `playarr-telemetry`
//! the task's correctness bar calls out explicitly as needing to be
//! genuinely functional, not just shaped like a subscriber. `crate::init`
//! composes this with the optional [`crate::otel`] layer and calls
//! `.init()` on the result.

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::{EnvFilter, Layer};

/// Owns the non-blocking writer's background flush thread. Keep this
/// alive for the life of the process (`TelemetryGuard` holds it) —
/// dropping it stops the thread and flushes any buffered log lines.
pub struct LoggingGuard {
    _appender_guard: WorkerGuard,
}

/// Builds the stdout JSON logging layer, gated by an `EnvFilter` parsed
/// from `log_filter` (falling back to `"info"` if it fails to parse rather
/// than panicking process startup over a config typo).
///
/// The writer is non-blocking *and* lossy: under sustained log pressure,
/// lines are dropped rather than applying backpressure to the async tasks
/// producing them — playback and API latency must never be gated on log
/// I/O keeping up.
pub fn build_fmt_layer<S>(
    log_filter: &str,
) -> (Box<dyn Layer<S> + Send + Sync + 'static>, LoggingGuard)
where
    S: tracing::Subscriber + for<'span> LookupSpan<'span>,
{
    let env_filter = EnvFilter::try_new(log_filter).unwrap_or_else(|_| EnvFilter::new("info"));

    let (non_blocking, appender_guard) =
        tracing_appender::non_blocking::NonBlockingBuilder::default()
            .lossy(true)
            .finish(std::io::stdout());

    let fmt_layer = tracing_subscriber::fmt::layer()
        .json()
        .with_writer(non_blocking)
        .with_target(true)
        .with_current_span(true)
        .with_span_list(true)
        .with_filter(env_filter);

    (
        Box::new(fmt_layer),
        LoggingGuard {
            _appender_guard: appender_guard,
        },
    )
}
