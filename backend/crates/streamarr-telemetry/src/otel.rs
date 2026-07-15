//! Optional OpenTelemetry trace export, gated on `Config::otlp_endpoint`
//! being set. When it's `None` (the default for a single-node/dev
//! deployment), [`build_otel_layer`] returns `None` and `crate::init`
//! never adds an OTel layer to the subscriber at all — `streamarr-telemetry`
//! is fully functional (structured JSON logs, in-process metrics) with
//! zero OTel collector dependency at runtime.

use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::Layer;

use streamarr_config::Config;

/// Builds the OTLP trace export layer when `config.otlp_endpoint` is set;
/// returns `None` otherwise so callers skip adding a layer entirely rather
/// than adding one that's merely disabled.
///
/// Deliberately not wired to a live exporter yet: standing up a real
/// `opentelemetry_sdk::trace::SdkTracerProvider` + `opentelemetry-otlp`
/// exporter needs a reachable collector to meaningfully test against,
/// which this crate's own (offline, `cargo test`-run) test suite has no
/// business depending on. The intended shape, once wired:
///
/// ```ignore
/// let exporter = opentelemetry_otlp::SpanExporter::builder()
///     .with_tonic()
///     .with_endpoint(endpoint)
///     .build()?;
/// let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
///     .with_batch_exporter(exporter)
///     .build();
/// let tracer = provider.tracer("streamarr");
/// Some(Box::new(tracing_opentelemetry::layer().with_tracer(tracer)))
/// ```
///
/// The `provider` also needs to be kept alive for the process lifetime
/// (held on `TelemetryGuard`, mirroring `logging::LoggingGuard`) and shut
/// down on drop so buffered spans flush — that's why this function will
/// eventually need to return the provider alongside the layer, the same
/// way `logging::build_fmt_layer` returns a `LoggingGuard`.
pub fn build_otel_layer<S>(config: &Config) -> Option<Box<dyn Layer<S> + Send + Sync + 'static>>
where
    S: tracing::Subscriber + for<'span> LookupSpan<'span>,
{
    let _endpoint = config.otlp_endpoint.as_ref()?;
    None
}
