//! Webhook-as-signal: the *arr apps can push a webhook on every catalog
//! change, but their payload shapes are thinly documented and drift across
//! versions, so we deliberately never trust the body as ground truth. A
//! webhook only ever tells us "something changed, roughly here" — the
//! [`ReconciliationPoller`](crate::poller::ReconciliationPoller) is the
//! actual source of truth, re-fetching the affected entity (or, on its
//! regular schedule, everything) straight from the source instance's API
//! via `playarr-arr-client`.

use serde_json::Value;
use playarr_model::SourceKind;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum WebhookError {
    #[error("webhook payload has no recognizable `eventType` field")]
    MissingEventType,
}

/// Everything we're willing to extract from a raw webhook body: which kind
/// of event it claims to be, and — if present — the source app's own id
/// for the primary affected entity. Nothing else from the payload is ever
/// read; in particular we never treat webhook-supplied titles, paths, file
/// info, or state as authoritative.
#[derive(Debug, Clone, PartialEq)]
pub struct WebhookSignal {
    pub source_kind: SourceKind,
    /// Raw event-type string (e.g. `"SeriesAdd"`, `"Download"`,
    /// `"EpisodeFileDelete"`). Deliberately not a closed enum: each *arr
    /// app's event vocabulary is app-specific and grows independently, and
    /// modeling it exhaustively would mean this crate breaks every time an
    /// *arr app adds an event type we don't otherwise care about.
    pub event_type: String,
    /// The source app's own numeric id for the entity the event concerns,
    /// when the payload shape we expect for `source_kind` has one.
    pub entity_id: Option<i64>,
}

/// Defensively extracts a [`WebhookSignal`] from a raw webhook body.
/// Unknown/extra/missing fields elsewhere in the payload are silently
/// ignored (that's the point of taking `serde_json::Value` rather than a
/// strongly-typed struct) — this only errors when the one thing we
/// actually depend on, the event type, is absent.
pub fn parse_webhook_signal(
    source_kind: SourceKind,
    body: &Value,
) -> Result<WebhookSignal, WebhookError> {
    let event_type = body
        .get("eventType")
        .and_then(Value::as_str)
        .ok_or(WebhookError::MissingEventType)?
        .to_string();

    let entity_id = extract_entity_id(source_kind, body);

    Ok(WebhookSignal {
        source_kind,
        event_type,
        entity_id,
    })
}

/// Each *arr app nests "the entity that changed" differently in its
/// webhook payload. This is a best-effort lookup, not a schema
/// contract — a miss just means the resulting [`RefetchRequest`] carries
/// `entity_id: None` and the poller falls back to a full pass for that
/// instance instead of a targeted one.
fn extract_entity_id(source_kind: SourceKind, body: &Value) -> Option<i64> {
    let pointer = match source_kind {
        SourceKind::Sonarr => "/series/id",
        SourceKind::Radarr => "/movie/id",
        SourceKind::Lidarr => "/artist/id",
        SourceKind::Readarr => "/author/id",
        // Whisparr V3 is a direct Sonarr fork, so its webhook payload is
        // expected to nest the primary entity the same way Sonarr's does
        // (`/series/id` for series-level events) -- but scene-add/import
        // events specifically are expected to nest under `/episode/id`
        // instead, mirroring Sonarr's own episode-centric payload shape for
        // download/import events. **Best-effort, unverified**: same
        // uncertainty-note style as `ReadarrBookFile`'s doc comment in
        // `playarr-arr-client` -- there is no real Whisparr instance to
        // confirm this against at implementation time, so treat this as a
        // reasonable guess by analogy, not a verified schema, and correct
        // it against a live instance before depending on it for anything
        // beyond "a targeted refetch is worth attempting."
        SourceKind::Whisparr => "/episode/id",
        // Bazarr's webhook support and payload shape is inconsistent
        // across its own versions; targeted refetch isn't reliable enough
        // to depend on an id pointer here, so it always falls back to a
        // full pass.
        SourceKind::Bazarr => return None,
        // Prowlarr's events are indexer/download-client health signals,
        // not media entities — there is no "entity" to point a targeted
        // refetch at.
        SourceKind::Prowlarr => return None,
    };
    body.pointer(pointer).and_then(Value::as_i64)
}

/// What a webhook signal turns into once we know which configured
/// [`playarr_model::SourceInstance`] it came from: an instruction for the
/// poller to re-fetch one entity (or, absent an id, run its next full pass
/// early) rather than waiting for the regular interval.
#[derive(Debug, Clone, PartialEq)]
pub struct RefetchRequest {
    pub source_instance_id: Uuid,
    pub source_kind: SourceKind,
    pub entity_id: Option<i64>,
    pub event_type: String,
}

/// Framework-agnostic webhook entry point: `playarr-api` wraps
/// [`WebhookReceiver::handle`] in an Axum handler (extracting the JSON
/// body and the `source_instance_id` path/route parameter) — this type has
/// no `axum` dependency of its own, so the parsing/triggering logic stays
/// testable without spinning up an HTTP server.
pub struct WebhookReceiver {
    trigger_tx: tokio::sync::mpsc::Sender<RefetchRequest>,
}

impl WebhookReceiver {
    pub fn new(trigger_tx: tokio::sync::mpsc::Sender<RefetchRequest>) -> Self {
        Self { trigger_tx }
    }

    /// Handles one inbound webhook call: parses defensively, then enqueues
    /// a [`RefetchRequest`] for the poller to act on. Does not itself
    /// perform any re-fetch — keeping retry/backoff/rate-limiting entirely
    /// in the poller means there is exactly one place that logic has to be
    /// gotten right, instead of duplicating it here under HTTP-response
    /// time pressure.
    pub async fn handle(
        &self,
        source_instance_id: Uuid,
        source_kind: SourceKind,
        body: Value,
    ) -> Result<(), WebhookError> {
        let signal = parse_webhook_signal(source_kind, &body)?;

        let request = RefetchRequest {
            source_instance_id,
            source_kind,
            entity_id: signal.entity_id,
            event_type: signal.event_type,
        };

        // Webhooks are a latency optimization on top of poll-as-truth, not
        // a delivery-guaranteed queue — if the poller's inbox is full
        // (it's backed up, or temporarily down), we drop the signal rather
        // than block the HTTP response on it. The next scheduled full pass
        // still catches whatever this would have refetched.
        if self.trigger_tx.try_send(request).is_err() {
            tracing::debug!(
                %source_instance_id,
                "refetch trigger channel full or closed; dropping webhook signal, relying on next scheduled poll"
            );
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_sonarr_series_id() {
        let body = json!({ "eventType": "SeriesAdd", "series": { "id": 42 } });
        let signal = parse_webhook_signal(SourceKind::Sonarr, &body).unwrap();
        assert_eq!(signal.event_type, "SeriesAdd");
        assert_eq!(signal.entity_id, Some(42));
    }

    #[test]
    fn extracts_whisparr_episode_id() {
        let body = json!({ "eventType": "Download", "episode": { "id": 77 } });
        let signal = parse_webhook_signal(SourceKind::Whisparr, &body).unwrap();
        assert_eq!(signal.event_type, "Download");
        assert_eq!(signal.entity_id, Some(77));
    }

    #[test]
    fn missing_event_type_errors() {
        let body = json!({ "series": { "id": 42 } });
        let err = parse_webhook_signal(SourceKind::Sonarr, &body).unwrap_err();
        assert!(matches!(err, WebhookError::MissingEventType));
    }

    #[test]
    fn unknown_shape_yields_no_entity_id_not_an_error() {
        let body = json!({ "eventType": "HealthIssue" });
        let signal = parse_webhook_signal(SourceKind::Prowlarr, &body).unwrap();
        assert_eq!(signal.entity_id, None);
    }

    #[test]
    fn extra_fields_are_ignored() {
        let body = json!({
            "eventType": "Download",
            "movie": { "id": 7, "title": "ignored" },
            "someFutureField": { "nested": true },
        });
        let signal = parse_webhook_signal(SourceKind::Radarr, &body).unwrap();
        assert_eq!(signal.entity_id, Some(7));
    }
}
