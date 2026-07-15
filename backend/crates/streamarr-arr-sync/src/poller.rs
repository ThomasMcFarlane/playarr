//! Poll-as-truth: the reconciliation loop that actually keeps the catalog
//! correct. Runs on a fixed interval per configured `SourceInstance`,
//! diffing everything it lists from the source app against `WorkRepo` and
//! upserting what changed — webhooks (see [`crate::webhook`]) only shorten
//! the latency between a change happening and this loop noticing it, via
//! [`RefetchRequest`]s that fast-path a specific entity ahead of the next
//! scheduled full pass.

use std::sync::Arc;
use std::time::Duration;

use streamarr_coordination::ClusterCoordinator;
use streamarr_db::WorkRepo;
use streamarr_model::SourceKind;
use uuid::Uuid;

use crate::webhook::RefetchRequest;

#[derive(Debug, thiserror::Error)]
pub enum PollError {
    #[error("arr client error: {0}")]
    Client(String),
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
    #[error(transparent)]
    Coordination(#[from] streamarr_coordination::CoordinationError),
}

/// One reconciliation loop, bound to a single [`streamarr_model::SourceInstance`].
/// `streamarr-bin`'s worker-role startup constructs one `ReconciliationPoller`
/// per enabled source instance and spawns each with `run` (see
/// `streamarr_telemetry::correlation::spawn::spawn_traced`).
pub struct ReconciliationPoller {
    source_instance_id: Uuid,
    source_kind: SourceKind,
    poll_interval: Duration,
    work_repo: Arc<dyn WorkRepo>,
    coordinator: Arc<dyn ClusterCoordinator>,
    trigger_rx: tokio::sync::mpsc::Receiver<RefetchRequest>,
}

impl ReconciliationPoller {
    pub fn new(
        source_instance_id: Uuid,
        source_kind: SourceKind,
        poll_interval: Duration,
        work_repo: Arc<dyn WorkRepo>,
        coordinator: Arc<dyn ClusterCoordinator>,
        trigger_rx: tokio::sync::mpsc::Receiver<RefetchRequest>,
    ) -> Self {
        Self {
            source_instance_id,
            source_kind,
            poll_interval,
            work_repo,
            coordinator,
            trigger_rx,
        }
    }

    /// Runs until the process shuts down (or the trigger channel closes).
    /// Intended shape: a `tokio::select!` between an interval tick (drives
    /// `reconcile_all`) and a `RefetchRequest` arriving (drives
    /// `reconcile_one`), with each iteration first calling
    /// `ClusterCoordinator::try_lock` on a key scoped to this source
    /// instance (e.g. `"arr-sync:{source_instance_id}"`) so that in a
    /// multi-node deployment only one node ever reconciles a given
    /// instance concurrently — `SingleNodeCoordinator` makes this a no-op
    /// contention-wise, `PostgresCoordinator` makes it a real distributed
    /// lock.
    pub async fn run(mut self) -> Result<(), PollError> {
        let _ = (
            &self.work_repo,
            &self.coordinator,
            self.source_instance_id,
            self.source_kind,
            self.poll_interval,
        );
        let _ = &mut self.trigger_rx;
        unimplemented!("ReconciliationPoller::run")
    }

    /// A full pass: list everything from the source instance (dispatching
    /// on `self.source_kind` to the matching `streamarr-arr-client`
    /// struct's `list_*` method), diff by external ref against
    /// `WorkRepo::find_by_external_ref`, and `WorkRepo::upsert` whatever is
    /// new or changed. This — not the webhook payload — is the
    /// authoritative source for catalog state.
    async fn reconcile_all(&self) -> Result<(), PollError> {
        unimplemented!("ReconciliationPoller::reconcile_all")
    }

    /// A targeted re-fetch for one entity, triggered by a webhook signal
    /// (dispatching on `self.source_kind` to the matching `get_*` method,
    /// e.g. `SonarrClient::get_series`), falling back to `reconcile_all`
    /// when `entity_id` is `None` (Bazarr/Prowlarr signals, or any *arr
    /// payload shape `webhook::extract_entity_id` didn't recognize).
    async fn reconcile_one(&self, entity_id: Option<i64>) -> Result<(), PollError> {
        match entity_id {
            Some(_id) => unimplemented!("ReconciliationPoller::reconcile_one (targeted)"),
            None => self.reconcile_all().await,
        }
    }
}
