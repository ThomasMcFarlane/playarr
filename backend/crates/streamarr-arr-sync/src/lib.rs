//! `streamarr-arr-sync` — keeps the Streamarr catalog reconciled against
//! the configured *arr source instances, on a **webhook-as-signal,
//! poll-as-truth** design:
//!
//! - [`webhook`] never trusts an inbound webhook body as authoritative. It
//!   defensively extracts only an event type and (when recognizable) an
//!   entity id, and turns that into a [`webhook::RefetchRequest`] — a hint
//!   for the poller, not a data update.
//! - [`poller`] is the actual source of truth: [`poller::ReconciliationPoller`]
//!   runs a scheduled full pass per source instance, and drains
//!   `RefetchRequest`s to fast-path specific entities in between passes.
//!
//! This split exists because *arr webhook payloads are thinly documented
//! and drift across app versions — treating them as ground truth would
//! mean the catalog silently diverges from reality the moment a payload
//! shape changes underneath us. Polling straight from each app's own REST
//! API (via `streamarr-arr-client`) is slower to notice a change but can't
//! drift the same way.

pub mod arr_client;
pub mod poller;
pub mod webhook;

pub use arr_client::{work_kind_and_provider, ArrClient, RemoteWork};
pub use poller::{PollError, ReconciliationPoller, SyncOp};
pub use webhook::{
    parse_webhook_signal, RefetchRequest, WebhookError, WebhookReceiver, WebhookSignal,
};
