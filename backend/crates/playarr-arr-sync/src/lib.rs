//! `playarr-arr-sync` — keeps the Playarr Server catalog reconciled against
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
//! - [`media_sync`] is the file-level counterpart: once a pass reconciles a
//!   `Work`'s catalog identity, [`media_sync::MediaSync`] fetches that same
//!   entity's file data (episode/movie/track/book files) and upserts real
//!   `MediaFile` rows, resolving each *arr app's numeric child id to a
//!   Playarr Server `Uuid` along the way — see that module's doc comment.
//!
//! This split exists because *arr webhook payloads are thinly documented
//! and drift across app versions — treating them as ground truth would
//! mean the catalog silently diverges from reality the moment a payload
//! shape changes underneath us. Polling straight from each app's own REST
//! API (via `playarr-arr-client`) is slower to notice a change but can't
//! drift the same way.

pub mod arr_client;
pub mod artwork_prewarm;
pub mod embedding_sync;
pub mod media_sync;
pub mod poller;
pub mod webhook;

pub use arr_client::{work_kind_and_provider, ArrClient, RemoteWork};
pub use artwork_prewarm::ArtworkPrewarm;
pub use embedding_sync::{EmbeddingSync, EmbeddingSyncError};
pub use media_sync::{MediaSync, MediaSyncError};
pub use poller::{PollError, ReconciliationPoller, SyncOp, SyncRunStatus, SyncStatusReporter};
pub use webhook::{
    parse_webhook_signal, RefetchRequest, WebhookError, WebhookReceiver, WebhookSignal,
};
