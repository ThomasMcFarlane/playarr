//! `streamarr-requests` — the "please add this" lifecycle: a user submits
//! a [`MediaRequest`], an admin (or an auto-approve policy, later)
//! approves or rejects it, an approved request gets submitted to a source
//! *arr instance, and `streamarr-arr-sync`'s reconciliation poller drives
//! [`RequestService::sync_status`] as the underlying `Work`'s availability
//! changes until the request resolves to `Available` or `Failed`.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use streamarr_model::{Availability, ExternalRef, WorkKind};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    #[error("request not found")]
    NotFound,
    #[error("request {0} is not in a state that allows this transition")]
    InvalidTransition(Uuid),
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
}

/// What a [`MediaRequest`] points at: either something already known to
/// the catalog (e.g. requesting a specific missing season of an existing
/// `Work`) or something entirely new, identified only by an external
/// provider ref until it's approved and actually added to a source
/// instance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "target_kind")]
pub enum RequestTarget {
    ExistingWork { work_id: Uuid },
    External { external_ref: ExternalRef },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestStatus {
    /// Awaiting admin decision.
    Pending,
    /// Approved, not yet submitted to a source instance.
    Approved,
    Rejected,
    /// Approved and submitted to a source instance; waiting for it to
    /// become available.
    Submitted,
    /// Terminal success: `streamarr-arr-sync` observed the target reach
    /// `Availability::Available`.
    Available,
    /// Terminal failure: submission to the source instance failed, or the
    /// source instance itself later reports it can't be fulfilled.
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaRequest {
    pub id: Uuid,
    pub requested_by: Uuid,
    pub kind: WorkKind,
    pub target: RequestTarget,
    /// Populated once `submit` (the admin-approval-triggered kind, not
    /// `RequestService::submit`) has actually sent this to a source
    /// instance.
    pub source_instance_id: Option<Uuid>,
    pub status: RequestStatus,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub decided_by: Option<Uuid>,
}

/// Persistence boundary for [`MediaRequest`]. Kept in this crate (rather
/// than alongside `WorkRepo`/`DeviceRepo`/`RenditionRepo` in
/// `streamarr-db`) because requests are a `streamarr-requests`-owned
/// concept — the table exists to serve this crate's lifecycle, not as a
/// shared cross-cutting aggregate the way `Work` is.
#[async_trait]
pub trait RequestRepo: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<MediaRequest, streamarr_db::DbError>;
    async fn list_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<MediaRequest>, streamarr_db::DbError>;
    async fn list_pending(&self) -> Result<Vec<MediaRequest>, streamarr_db::DbError>;
    async fn upsert(&self, request: &MediaRequest) -> Result<(), streamarr_db::DbError>;
}

/// The request lifecycle: submit -> approve/reject -> (submitted ->)
/// available/failed. Each method returns the request's new state rather
/// than `()`, so callers (API handlers) can render the result without a
/// second read.
pub struct RequestService {
    request_repo: std::sync::Arc<dyn RequestRepo>,
}

impl RequestService {
    pub fn new(request_repo: std::sync::Arc<dyn RequestRepo>) -> Self {
        Self { request_repo }
    }

    /// Creates a new `Pending` request. Whether it needs admin approval at
    /// all (vs. auto-approving) is a `Policy`-driven decision made by the
    /// caller (the API handler, informed by `streamarr-auth`), not by this
    /// method — `submit` always creates a `Pending` row.
    pub async fn submit(
        &self,
        requested_by: Uuid,
        kind: WorkKind,
        target: RequestTarget,
        note: Option<String>,
    ) -> Result<MediaRequest, RequestError> {
        let _ = (&self.request_repo, requested_by, kind, target, note);
        unimplemented!("RequestService::submit")
    }

    /// Approves a `Pending` request and submits it to the appropriate
    /// source instance (resolved from `target`'s kind and each
    /// `SourceInstance::enabled_for_requests`/`priority`), transitioning it
    /// to `Submitted`.
    pub async fn approve(
        &self,
        request_id: Uuid,
        decided_by: Uuid,
    ) -> Result<MediaRequest, RequestError> {
        let _ = (&self.request_repo, request_id, decided_by);
        unimplemented!("RequestService::approve")
    }

    pub async fn reject(
        &self,
        request_id: Uuid,
        decided_by: Uuid,
        reason: Option<String>,
    ) -> Result<MediaRequest, RequestError> {
        let _ = (&self.request_repo, request_id, decided_by, reason);
        unimplemented!("RequestService::reject")
    }

    /// Called by `streamarr-arr-sync` after a reconciliation pass observes
    /// `work_id`'s availability change, to advance any `Submitted` request
    /// pointing at it toward `Available`/`Failed`. Not called directly by
    /// API handlers.
    pub async fn sync_status(
        &self,
        request_id: Uuid,
        work_id: Uuid,
        availability: Availability,
    ) -> Result<MediaRequest, RequestError> {
        let _ = (&self.request_repo, request_id, work_id, availability);
        unimplemented!("RequestService::sync_status")
    }
}
