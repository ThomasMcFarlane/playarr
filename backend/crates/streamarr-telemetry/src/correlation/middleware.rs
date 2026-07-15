//! Axum middleware that assigns (or propagates) a [`super::CorrelationId`]
//! for every request.

use axum::extract::Request;
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::Response;
use uuid::Uuid;

use super::CorrelationId;

pub const CORRELATION_ID_HEADER: &str = "x-streamarr-correlation-id";

/// Reads `X-Streamarr-Correlation-Id` from the inbound request if present
/// (so a client- or upstream-proxy-supplied id survives end to end),
/// otherwise mints a new one. Records it onto the current tracing span,
/// stashes it in request extensions for handlers that want it directly,
/// and echoes it back on the response so the client can correlate its own
/// logs against the server's.
///
/// Note: recording onto `tracing::Span::current()` only has an effect if
/// the span that's current at this point in the middleware stack actually
/// declared a `correlation_id` field (e.g. via
/// `#[tracing::instrument(fields(correlation_id = tracing::field::Empty))]`
/// on the request span) — `record` on an undeclared field is a silent
/// no-op, not an error, so wire this middleware *and* a span with that
/// field declared together.
pub async fn correlation_id_middleware(mut request: Request, next: Next) -> Response {
    let correlation_id = request
        .headers()
        .get(CORRELATION_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .map(CorrelationId)
        .unwrap_or_else(CorrelationId::new);

    tracing::Span::current().record(
        super::CORRELATION_ID_FIELD,
        tracing::field::display(&correlation_id),
    );
    request.extensions_mut().insert(correlation_id);

    let mut response = next.run(request).await;

    if let Ok(header_value) = HeaderValue::from_str(&correlation_id.to_string()) {
        response
            .headers_mut()
            .insert(CORRELATION_ID_HEADER, header_value);
    }

    response
}
