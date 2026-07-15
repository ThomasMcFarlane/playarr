//! `streamarr-requests` — the "please add this" lifecycle: a user submits
//! a [`MediaRequest`], an admin (or an auto-approve policy, later)
//! approves or rejects it, an approved request gets submitted to a source
//! *arr instance, and `streamarr-arr-sync`'s reconciliation poller drives
//! [`RequestService::sync_status`] as the underlying `Work`'s availability
//! changes until the request resolves to `Available` or `Failed`.
//!
//! ## Persistence: in-memory, by design, for now
//!
//! [`RequestRepo`] is implemented here by [`InMemoryRequestRepo`] rather
//! than a `sqlx`-backed store against a new `media_requests` table. That
//! was a deliberate choice, not a shortcut:
//!
//! - Every other `streamarr-db` repository (`WorkRepo`, `DeviceRepo`,
//!   `RenditionRepo`) is still an `unimplemented!()` skeleton as of this
//!   pass — there is no proven pattern yet in this workspace for issuing
//!   real queries through `sqlx::AnyPool` (in particular, `Any` does *not*
//!   rewrite bind-parameter placeholders between SQLite's `?`/`?N` and
//!   Postgres's `$N`, so a portable implementation needs a real answer to
//!   that before it's "real" rather than a landmine). Building that answer
//!   is `streamarr-db`'s job, not this crate's.
//! - `MediaRequest` is explicitly called out in `RequestRepo`'s own doc
//!   comment as a `streamarr-requests`-owned concept, not a shared
//!   cross-cutting aggregate — so it doesn't need to live in `streamarr-db`
//!   at all, unlike `Work`.
//! - [`InMemoryRequestRepo`] is a fully working implementation (thread-safe,
//!   enforces the same not-found semantics a SQL-backed repo would), not a
//!   mock — it's a legitimate choice for single-node deployments, mirroring
//!   `streamarr-cache::InMemory` for `CacheAndPubSub`.
//!
//! TODO(persistence): once `streamarr-db` has a working `sqlx::AnyPool`
//! query pattern proven out elsewhere (e.g. `WorkRepo`), add a
//! `SqlxRequestRepo` behind a new `backend/migrations/*/NNNN_media_requests.sql`
//! migration, following that pattern. `RequestService` itself doesn't need
//! to change — it only depends on the `RequestRepo` trait.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use streamarr_model::{Availability, ExternalRef, SourceInstance, WorkKind};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    #[error("request not found")]
    NotFound,
    #[error("request {0} is not in a state that allows this transition")]
    InvalidTransition(Uuid),
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
    /// No `SourceInstance` is configured (and enabled for requests) that
    /// can service this `WorkKind` at all.
    #[error("no source instance is configured and enabled for {kind:?} requests")]
    NoSourceInstance { kind: WorkKind },
    /// The specific Overseerr failure mode this crate exists to close: an
    /// instance exists and is enabled for requests, but an admin never
    /// finished configuring it (no default root folder and/or quality
    /// profile), so an approved request would silently fail (or worse,
    /// succeed with wrong settings) at the add call. Caught in
    /// [`RequestService::submit`] — before a request is even created — and
    /// re-checked in [`RequestService::approve`] in case configuration
    /// changed in between, instead of letting a request get stuck forever
    /// in `Submitted` with no explanation.
    #[error(
        "source instance '{instance_name}' ({instance_id}) is missing required defaults: {missing_fields}"
    )]
    SourceInstanceNotConfigured {
        instance_id: Uuid,
        instance_name: String,
        missing_fields: String,
    },
    #[error("failed to submit request to source instance: {0}")]
    ArrPush(#[from] ArrPushError),
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

/// A thread-safe, process-local [`RequestRepo`]. Fully functional — not a
/// test double: every method genuinely stores/retrieves rows and enforces
/// the same not-found semantics a SQL-backed repo would (see the module
/// doc comment for why this is the real implementation for this pass
/// rather than a stand-in for one). Safe under concurrent access via a
/// `std::sync::RwLock`; no `.await` point is ever reached while the lock is
/// held, so it can't deadlock or block the async runtime.
#[derive(Debug, Default)]
pub struct InMemoryRequestRepo {
    requests: RwLock<HashMap<Uuid, MediaRequest>>,
}

impl InMemoryRequestRepo {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl RequestRepo for InMemoryRequestRepo {
    async fn get(&self, id: Uuid) -> Result<MediaRequest, streamarr_db::DbError> {
        let requests = self.requests.read().expect("request store poisoned");
        requests
            .get(&id)
            .cloned()
            .ok_or(streamarr_db::DbError::NotFound)
    }

    async fn list_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<MediaRequest>, streamarr_db::DbError> {
        let requests = self.requests.read().expect("request store poisoned");
        let mut matches: Vec<MediaRequest> = requests
            .values()
            .filter(|request| request.requested_by == user_id)
            .cloned()
            .collect();
        matches.sort_by_key(|request| request.created_at);
        Ok(matches)
    }

    async fn list_pending(&self) -> Result<Vec<MediaRequest>, streamarr_db::DbError> {
        let requests = self.requests.read().expect("request store poisoned");
        let mut matches: Vec<MediaRequest> = requests
            .values()
            .filter(|request| request.status == RequestStatus::Pending)
            .cloned()
            .collect();
        matches.sort_by_key(|request| request.created_at);
        Ok(matches)
    }

    async fn upsert(&self, request: &MediaRequest) -> Result<(), streamarr_db::DbError> {
        let mut requests = self.requests.write().expect("request store poisoned");
        requests.insert(request.id, request.clone());
        Ok(())
    }
}

/// Resolves the [`SourceInstance`]s eligible to service a request of a
/// given [`WorkKind`] (`Movie` -> a Radarr instance, `Series` -> Sonarr,
/// `Artist` -> Lidarr, `Author` -> Readarr).
///
/// `SourceInstance` configuration doesn't have an owning repository
/// anywhere in the workspace yet — it isn't one of `streamarr-db`'s
/// `repo` traits (`Device`/`Rendition`/`Work`) and no admin-config crate
/// owns it either. Rather than reach for persistence that doesn't exist,
/// this crate defines the seam it needs: the API/worker composition root
/// injects a real implementation once instance configuration has a home.
#[async_trait]
pub trait SourceInstanceLookup: Send + Sync {
    /// All instances configured for `kind`, in no particular order —
    /// `RequestService` applies the `enabled_for_requests`/`priority`
    /// selection itself so every caller gets identical semantics.
    async fn instances_for(&self, kind: WorkKind) -> Result<Vec<SourceInstance>, RequestError>;
}

/// The result of successfully submitting a request's target to a source
/// instance. `external_id` is that app's own id for the created resource
/// (Radarr movie id, Sonarr series id, ...); `RequestService` doesn't
/// interpret it further, it's carried purely for logging/debugging.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArrPushOutcome {
    pub external_id: String,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum ArrPushError {
    #[error("source instance rejected the add request: {0}")]
    Rejected(String),
    #[error("source instance unreachable: {0}")]
    Unreachable(String),
}

/// What approving a request needs from an *arr instance: submit the
/// approved target as a monitored add. Modeled as a trait — rather than
/// this crate depending on `streamarr-arr-client` directly — so
/// `RequestService`'s tests exercise the full submit/approve/reject/
/// sync_status lifecycle against an in-process fake instead of a live *arr
/// HTTP server; wiremock-style HTTP-level testing of the actual add call
/// belongs to `streamarr-arr-client`'s own test suite, which owns the
/// per-app request/response shapes. The API/worker composition root
/// injects a real implementation that adapts `streamarr-arr-client`'s
/// per-app clients (Radarr/Sonarr/Lidarr/Readarr) to this one shape.
#[async_trait]
pub trait ArrPusher: Send + Sync {
    async fn push(
        &self,
        target: &RequestTarget,
        kind: WorkKind,
        instance: &SourceInstance,
    ) -> Result<ArrPushOutcome, ArrPushError>;
}

/// The request lifecycle: submit -> approve/reject -> (submitted ->)
/// available/failed. Each method returns the request's new state rather
/// than `()`, so callers (API handlers) can render the result without a
/// second read.
pub struct RequestService {
    request_repo: Arc<dyn RequestRepo>,
    source_instances: Arc<dyn SourceInstanceLookup>,
    arr_pusher: Arc<dyn ArrPusher>,
}

impl RequestService {
    /// `source_instances` and `arr_pusher` are the caller-injected seams
    /// documented on their trait definitions. The prior pass's constructor
    /// only took `request_repo` because neither seam had been designed yet;
    /// both are required to actually implement `submit`'s Overseerr-fix
    /// validation and `approve`'s push, so this pass extends the
    /// constructor rather than smuggling them in through method
    /// parameters (which would leak wiring concerns into every call site).
    pub fn new(
        request_repo: Arc<dyn RequestRepo>,
        source_instances: Arc<dyn SourceInstanceLookup>,
        arr_pusher: Arc<dyn ArrPusher>,
    ) -> Self {
        Self {
            request_repo,
            source_instances,
            arr_pusher,
        }
    }

    /// Picks the best `SourceInstance` for `kind` (enabled for requests,
    /// lowest `priority` first) and validates it has both defaults an add
    /// call needs. Shared by `submit` (fail fast, before a request is even
    /// created) and `approve` (authoritative at the moment of pushing,
    /// since configuration may have changed since `submit`).
    async fn resolve_configured_instance(
        &self,
        kind: WorkKind,
    ) -> Result<SourceInstance, RequestError> {
        let mut candidates: Vec<SourceInstance> = self
            .source_instances
            .instances_for(kind)
            .await?
            .into_iter()
            .filter(|instance| instance.enabled_for_requests)
            .collect();
        candidates.sort_by_key(|instance| instance.priority);

        let instance = candidates
            .into_iter()
            .next()
            .ok_or(RequestError::NoSourceInstance { kind })?;

        let mut missing = Vec::new();
        if instance.default_root_folder_id.is_none() {
            missing.push("default_root_folder_id");
        }
        if instance.default_quality_profile_id.is_none() {
            missing.push("default_quality_profile_id");
        }
        if !missing.is_empty() {
            return Err(RequestError::SourceInstanceNotConfigured {
                instance_id: instance.id,
                instance_name: instance.name.clone(),
                missing_fields: missing.join(", "),
            });
        }

        Ok(instance)
    }

    /// Creates a new `Pending` request. Whether it needs admin approval at
    /// all (vs. auto-approving) is a `Policy`-driven decision made by the
    /// caller (the API handler, informed by `streamarr-auth`), not by this
    /// method — `submit` always creates a `Pending` row.
    ///
    /// Before creating anything, validates that a `SourceInstance` exists,
    /// is enabled for requests, and has both `default_root_folder_id` and
    /// `default_quality_profile_id` set for `kind`. This is the specific
    /// Overseerr failure mode this crate is designed to close: rejecting a
    /// misconfigured request up front, with a clear, actionable error,
    /// rather than letting it sit `Pending`/`Submitted` forever with no
    /// explanation once an admin approves it.
    pub async fn submit(
        &self,
        requested_by: Uuid,
        kind: WorkKind,
        target: RequestTarget,
        note: Option<String>,
    ) -> Result<MediaRequest, RequestError> {
        self.resolve_configured_instance(kind).await?;

        let now = Utc::now();
        let request = MediaRequest {
            id: Uuid::new_v4(),
            requested_by,
            kind,
            target,
            source_instance_id: None,
            status: RequestStatus::Pending,
            note,
            created_at: now,
            updated_at: now,
            decided_by: None,
        };
        self.request_repo.upsert(&request).await?;
        Ok(request)
    }

    /// Approves a `Pending` request and submits it to the appropriate
    /// source instance (resolved from `target`'s kind and each
    /// `SourceInstance::enabled_for_requests`/`priority`), transitioning it
    /// to `Submitted`.
    ///
    /// If the push itself fails, the request is transitioned to `Failed`
    /// (persisted for audit/visibility — a follow-up read shows *why* the
    /// approval didn't stick rather than the request silently vanishing)
    /// and this method still returns `Err`, so the caller (an API handler)
    /// can report the failure immediately rather than treating a failed
    /// push as a successful state transition.
    pub async fn approve(
        &self,
        request_id: Uuid,
        decided_by: Uuid,
    ) -> Result<MediaRequest, RequestError> {
        let mut request = self.request_repo.get(request_id).await?;
        if request.status != RequestStatus::Pending {
            return Err(RequestError::InvalidTransition(request_id));
        }

        let instance = self.resolve_configured_instance(request.kind).await?;

        match self
            .arr_pusher
            .push(&request.target, request.kind, &instance)
            .await
        {
            Ok(_outcome) => {
                request.status = RequestStatus::Submitted;
                request.source_instance_id = Some(instance.id);
                request.decided_by = Some(decided_by);
                request.updated_at = Utc::now();
                self.request_repo.upsert(&request).await?;
                Ok(request)
            }
            Err(err) => {
                request.status = RequestStatus::Failed;
                request.decided_by = Some(decided_by);
                request.updated_at = Utc::now();
                if let Err(persist_err) = self.request_repo.upsert(&request).await {
                    tracing::error!(
                        request_id = %request_id,
                        error = %persist_err,
                        "failed to persist Failed status after arr push failure"
                    );
                }
                Err(RequestError::ArrPush(err))
            }
        }
    }

    /// Rejects a `Pending` request. Only `Pending` requests can be
    /// rejected — once a request has been approved (and possibly already
    /// pushed to a source instance), reversing it is a separate
    /// cancel/remove-from-arr concern, not a plain status flip.
    pub async fn reject(
        &self,
        request_id: Uuid,
        decided_by: Uuid,
        reason: Option<String>,
    ) -> Result<MediaRequest, RequestError> {
        let mut request = self.request_repo.get(request_id).await?;
        if request.status != RequestStatus::Pending {
            return Err(RequestError::InvalidTransition(request_id));
        }

        request.status = RequestStatus::Rejected;
        request.decided_by = Some(decided_by);
        if let Some(reason) = reason {
            request.note = Some(reason);
        }
        request.updated_at = Utc::now();
        self.request_repo.upsert(&request).await?;
        Ok(request)
    }

    /// Called by `streamarr-arr-sync` after a reconciliation pass observes
    /// `work_id`'s availability change, to advance any `Submitted` request
    /// pointing at it toward `Available`/`Failed`. Not called directly by
    /// API handlers.
    ///
    /// A no-op (returns the request unchanged) when the request isn't
    /// currently `Submitted` — `streamarr-arr-sync`'s reconciliation pass
    /// calls this for every request tied to a work that changed, not only
    /// ones it has pre-filtered to `Submitted`, so "nothing to do" is
    /// expected traffic, not an error.
    pub async fn sync_status(
        &self,
        request_id: Uuid,
        work_id: Uuid,
        availability: Availability,
    ) -> Result<MediaRequest, RequestError> {
        let mut request = self.request_repo.get(request_id).await?;

        if let RequestTarget::ExistingWork {
            work_id: target_work_id,
        } = &request.target
        {
            if *target_work_id != work_id {
                return Err(RequestError::InvalidTransition(request_id));
            }
        }

        if request.status != RequestStatus::Submitted {
            return Ok(request);
        }

        // TODO(failure-detection): `Availability` has no "this can never
        // be fulfilled" variant (e.g. a stalled/failed download), so
        // `sync_status` can currently only ever advance a `Submitted`
        // request to `Available`, never to `Failed`. Once
        // `streamarr-arr-sync` can observe that signal (e.g. from an *arr
        // queue/history status) it should get its own explicit path here
        // instead of being inferred from `Availability` alone.
        if availability == Availability::Available {
            request.status = RequestStatus::Available;
            request.updated_at = Utc::now();
            self.request_repo.upsert(&request).await?;
        }

        Ok(request)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use streamarr_model::{ExternalProvider, Sensitive, SourceKind};

    use super::*;

    fn source_instance(kind: streamarr_model::SourceKind) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind,
            name: format!("{kind:?} primary"),
            base_url: "http://localhost:7878".to_string(),
            api_key_encrypted: Sensitive::new("encrypted-key".to_string()),
            priority: 0,
            default_root_folder_id: Some("/data/media".to_string()),
            default_quality_profile_id: Some(1),
            enabled_for_requests: true,
            best_effort: false,
        }
    }

    /// A [`SourceInstanceLookup`] backed by a fixed, in-test-configured
    /// list — the fake half of the seam `RequestService` depends on so
    /// tests don't need real `SourceInstance` persistence.
    struct FakeSourceInstanceLookup {
        by_kind: HashMap<WorkKind, Vec<SourceInstance>>,
    }

    impl FakeSourceInstanceLookup {
        fn new(kind: WorkKind, instances: Vec<SourceInstance>) -> Self {
            let mut by_kind = HashMap::new();
            by_kind.insert(kind, instances);
            Self { by_kind }
        }
    }

    #[async_trait]
    impl SourceInstanceLookup for FakeSourceInstanceLookup {
        async fn instances_for(&self, kind: WorkKind) -> Result<Vec<SourceInstance>, RequestError> {
            Ok(self.by_kind.get(&kind).cloned().unwrap_or_default())
        }
    }

    /// A fake [`ArrPusher`]: the in-test double for the "push to arr" step
    /// the task calls out explicitly — this is what lets `RequestService`
    /// be tested without any live (or even wiremock) *arr HTTP server.
    /// Records every push it receives and can be configured to fail.
    struct FakeArrPusher {
        should_fail: bool,
        pushes: Mutex<Vec<(WorkKind, Uuid)>>,
    }

    impl FakeArrPusher {
        fn succeeding() -> Self {
            Self {
                should_fail: false,
                pushes: Mutex::new(Vec::new()),
            }
        }

        fn failing() -> Self {
            Self {
                should_fail: true,
                pushes: Mutex::new(Vec::new()),
            }
        }

        fn push_count(&self) -> usize {
            self.pushes.lock().unwrap().len()
        }
    }

    #[async_trait]
    impl ArrPusher for FakeArrPusher {
        async fn push(
            &self,
            _target: &RequestTarget,
            kind: WorkKind,
            instance: &SourceInstance,
        ) -> Result<ArrPushOutcome, ArrPushError> {
            self.pushes.lock().unwrap().push((kind, instance.id));
            if self.should_fail {
                return Err(ArrPushError::Rejected("root folder invalid".to_string()));
            }
            Ok(ArrPushOutcome {
                external_id: "123".to_string(),
            })
        }
    }

    fn external_target() -> RequestTarget {
        RequestTarget::External {
            external_ref: ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: "603".to_string(),
            },
        }
    }

    fn service_with(
        instance: SourceInstance,
        kind: WorkKind,
        pusher: Arc<dyn ArrPusher>,
    ) -> (RequestService, Arc<InMemoryRequestRepo>) {
        let repo = Arc::new(InMemoryRequestRepo::new());
        let lookup = Arc::new(FakeSourceInstanceLookup::new(kind, vec![instance]));
        let service = RequestService::new(repo.clone(), lookup, pusher);
        (service, repo)
    }

    #[tokio::test]
    async fn submit_creates_pending_request() {
        let instance = source_instance(SourceKind::Radarr);
        let (service, _repo) = service_with(
            instance,
            WorkKind::Movie,
            Arc::new(FakeArrPusher::succeeding()),
        );

        let user_id = Uuid::new_v4();
        let request = service
            .submit(
                user_id,
                WorkKind::Movie,
                external_target(),
                Some("please".to_string()),
            )
            .await
            .expect("submit should succeed");

        assert_eq!(request.status, RequestStatus::Pending);
        assert_eq!(request.requested_by, user_id);
        assert_eq!(request.kind, WorkKind::Movie);
        assert!(request.source_instance_id.is_none());
        assert!(request.decided_by.is_none());
    }

    #[tokio::test]
    async fn submit_rejects_when_no_instance_enabled_for_kind() {
        let repo = Arc::new(InMemoryRequestRepo::new());
        // Lookup with no instances configured at all for Movie.
        let lookup = Arc::new(FakeSourceInstanceLookup::new(WorkKind::Movie, vec![]));
        let service = RequestService::new(repo, lookup, Arc::new(FakeArrPusher::succeeding()));

        let err = service
            .submit(Uuid::new_v4(), WorkKind::Movie, external_target(), None)
            .await
            .expect_err("submit should fail with no configured instance");

        assert!(matches!(
            err,
            RequestError::NoSourceInstance {
                kind: WorkKind::Movie
            }
        ));
    }

    /// The specific Overseerr failure-mode fix: an instance exists and is
    /// enabled, but is missing its default root folder/quality profile.
    /// `submit` must reject with a clear, actionable error instead of
    /// creating a request that can never be successfully approved.
    #[tokio::test]
    async fn submit_rejects_when_instance_missing_defaults() {
        let mut instance = source_instance(SourceKind::Radarr);
        instance.default_root_folder_id = None;
        instance.default_quality_profile_id = None;
        let (service, repo) = service_with(
            instance.clone(),
            WorkKind::Movie,
            Arc::new(FakeArrPusher::succeeding()),
        );

        let err = service
            .submit(Uuid::new_v4(), WorkKind::Movie, external_target(), None)
            .await
            .expect_err("submit should fail when instance is unconfigured");

        match &err {
            RequestError::SourceInstanceNotConfigured {
                instance_id,
                instance_name,
                missing_fields,
            } => {
                assert_eq!(*instance_id, instance.id);
                assert_eq!(instance_name, &instance.name);
                assert!(missing_fields.contains("default_root_folder_id"));
                assert!(missing_fields.contains("default_quality_profile_id"));
            }
            other => panic!("expected SourceInstanceNotConfigured, got {other:?}"),
        }

        // And nothing was persisted: the whole point is failing fast
        // before a doomed request is ever created.
        assert!(repo.list_pending().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn submit_rejects_when_instance_missing_only_quality_profile() {
        let mut instance = source_instance(SourceKind::Sonarr);
        instance.default_quality_profile_id = None;
        let (service, _repo) = service_with(
            instance,
            WorkKind::Series,
            Arc::new(FakeArrPusher::succeeding()),
        );

        let err = service
            .submit(Uuid::new_v4(), WorkKind::Series, external_target(), None)
            .await
            .expect_err("submit should fail when profile missing");

        match &err {
            RequestError::SourceInstanceNotConfigured { missing_fields, .. } => {
                assert_eq!(missing_fields, "default_quality_profile_id");
            }
            other => panic!("expected SourceInstanceNotConfigured, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn submit_ignores_disabled_instances() {
        let mut disabled = source_instance(SourceKind::Radarr);
        disabled.enabled_for_requests = false;
        let (service, _repo) = service_with(
            disabled,
            WorkKind::Movie,
            Arc::new(FakeArrPusher::succeeding()),
        );

        let err = service
            .submit(Uuid::new_v4(), WorkKind::Movie, external_target(), None)
            .await
            .expect_err("submit should fail when the only instance is disabled");

        assert!(matches!(err, RequestError::NoSourceInstance { .. }));
    }

    #[tokio::test]
    async fn full_lifecycle_submit_approve_sync_status_to_available() {
        let instance = source_instance(SourceKind::Radarr);
        let instance_id = instance.id;
        let pusher = Arc::new(FakeArrPusher::succeeding());
        let (service, _repo) = service_with(instance, WorkKind::Movie, pusher.clone());

        let requester = Uuid::new_v4();
        let admin = Uuid::new_v4();

        // submit -> Pending
        let submitted = service
            .submit(requester, WorkKind::Movie, external_target(), None)
            .await
            .unwrap();
        assert_eq!(submitted.status, RequestStatus::Pending);

        // approve -> Submitted, pushed to the resolved instance exactly once
        let approved = service.approve(submitted.id, admin).await.unwrap();
        assert_eq!(approved.status, RequestStatus::Submitted);
        assert_eq!(approved.source_instance_id, Some(instance_id));
        assert_eq!(approved.decided_by, Some(admin));
        assert_eq!(pusher.push_count(), 1);

        // sync_status with an intermediate availability: no-op, stays Submitted
        let work_id = match &approved.target {
            RequestTarget::ExistingWork { work_id } => *work_id,
            RequestTarget::External { .. } => Uuid::new_v4(),
        };
        let still_submitted = service
            .sync_status(approved.id, work_id, Availability::Processing)
            .await
            .unwrap();
        assert_eq!(still_submitted.status, RequestStatus::Submitted);

        // sync_status with Available -> terminal Available
        let finished = service
            .sync_status(approved.id, work_id, Availability::Available)
            .await
            .unwrap();
        assert_eq!(finished.status, RequestStatus::Available);
        assert!(finished.updated_at >= approved.updated_at);
    }

    #[tokio::test]
    async fn approve_non_pending_request_is_invalid_transition() {
        let instance = source_instance(SourceKind::Radarr);
        let pusher = Arc::new(FakeArrPusher::succeeding());
        let (service, _repo) = service_with(instance, WorkKind::Movie, pusher);

        let submitted = service
            .submit(Uuid::new_v4(), WorkKind::Movie, external_target(), None)
            .await
            .unwrap();
        let admin = Uuid::new_v4();
        service.approve(submitted.id, admin).await.unwrap();

        // Already Submitted; approving again must fail.
        let err = service
            .approve(submitted.id, admin)
            .await
            .expect_err("double approval should fail");
        assert!(matches!(err, RequestError::InvalidTransition(id) if id == submitted.id));
    }

    #[tokio::test]
    async fn approve_push_failure_marks_request_failed_and_returns_err() {
        let instance = source_instance(SourceKind::Radarr);
        let pusher = Arc::new(FakeArrPusher::failing());
        let (service, repo) = service_with(instance, WorkKind::Movie, pusher.clone());

        let submitted = service
            .submit(Uuid::new_v4(), WorkKind::Movie, external_target(), None)
            .await
            .unwrap();
        let admin = Uuid::new_v4();

        let err = service
            .approve(submitted.id, admin)
            .await
            .expect_err("approve should surface the push failure");
        assert!(matches!(err, RequestError::ArrPush(_)));
        assert_eq!(pusher.push_count(), 1);

        // But the failure was still persisted for visibility.
        let persisted = repo.get(submitted.id).await.unwrap();
        assert_eq!(persisted.status, RequestStatus::Failed);
        assert_eq!(persisted.decided_by, Some(admin));
    }

    #[tokio::test]
    async fn reject_pending_request_sets_rejected_with_reason() {
        let instance = source_instance(SourceKind::Radarr);
        let (service, _repo) = service_with(
            instance,
            WorkKind::Movie,
            Arc::new(FakeArrPusher::succeeding()),
        );

        let submitted = service
            .submit(Uuid::new_v4(), WorkKind::Movie, external_target(), None)
            .await
            .unwrap();
        let admin = Uuid::new_v4();

        let rejected = service
            .reject(submitted.id, admin, Some("duplicate request".to_string()))
            .await
            .unwrap();

        assert_eq!(rejected.status, RequestStatus::Rejected);
        assert_eq!(rejected.decided_by, Some(admin));
        assert_eq!(rejected.note.as_deref(), Some("duplicate request"));
    }

    #[tokio::test]
    async fn reject_already_decided_request_is_invalid_transition() {
        let instance = source_instance(SourceKind::Radarr);
        let (service, _repo) = service_with(
            instance,
            WorkKind::Movie,
            Arc::new(FakeArrPusher::succeeding()),
        );

        let submitted = service
            .submit(Uuid::new_v4(), WorkKind::Movie, external_target(), None)
            .await
            .unwrap();
        let admin = Uuid::new_v4();
        service
            .reject(submitted.id, admin, None)
            .await
            .expect("first rejection succeeds");

        let err = service
            .reject(submitted.id, admin, None)
            .await
            .expect_err("second rejection should fail");
        assert!(matches!(err, RequestError::InvalidTransition(id) if id == submitted.id));
    }

    #[tokio::test]
    async fn sync_status_on_pending_request_is_a_no_op() {
        let instance = source_instance(SourceKind::Radarr);
        let (service, _repo) = service_with(
            instance,
            WorkKind::Movie,
            Arc::new(FakeArrPusher::succeeding()),
        );

        let submitted = service
            .submit(Uuid::new_v4(), WorkKind::Movie, external_target(), None)
            .await
            .unwrap();

        let unchanged = service
            .sync_status(submitted.id, Uuid::new_v4(), Availability::Available)
            .await
            .unwrap();
        assert_eq!(unchanged.status, RequestStatus::Pending);
    }

    #[tokio::test]
    async fn sync_status_rejects_mismatched_work_id() {
        let instance = source_instance(SourceKind::Radarr);
        let pusher = Arc::new(FakeArrPusher::succeeding());
        let (service, repo) = service_with(instance, WorkKind::Movie, pusher);

        let actual_work_id = Uuid::new_v4();
        let request = MediaRequest {
            id: Uuid::new_v4(),
            requested_by: Uuid::new_v4(),
            kind: WorkKind::Movie,
            target: RequestTarget::ExistingWork {
                work_id: actual_work_id,
            },
            source_instance_id: Some(Uuid::new_v4()),
            status: RequestStatus::Submitted,
            note: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            decided_by: Some(Uuid::new_v4()),
        };
        repo.upsert(&request).await.unwrap();

        let err = service
            .sync_status(request.id, Uuid::new_v4(), Availability::Available)
            .await
            .expect_err("mismatched work_id should fail");
        assert!(matches!(err, RequestError::InvalidTransition(id) if id == request.id));
    }

    #[tokio::test]
    async fn sync_status_on_missing_request_is_not_found() {
        let instance = source_instance(SourceKind::Radarr);
        let (service, _repo) = service_with(
            instance,
            WorkKind::Movie,
            Arc::new(FakeArrPusher::succeeding()),
        );

        let err = service
            .sync_status(Uuid::new_v4(), Uuid::new_v4(), Availability::Available)
            .await
            .expect_err("unknown request id should fail");
        assert!(matches!(
            err,
            RequestError::Db(streamarr_db::DbError::NotFound)
        ));
    }

    #[tokio::test]
    async fn in_memory_repo_get_missing_is_not_found() {
        let repo = InMemoryRequestRepo::new();
        let err = repo
            .get(Uuid::new_v4())
            .await
            .expect_err("should be NotFound");
        assert!(matches!(err, streamarr_db::DbError::NotFound));
    }

    #[tokio::test]
    async fn in_memory_repo_list_pending_only_returns_pending() {
        let repo = InMemoryRequestRepo::new();
        let now = Utc::now();
        let pending = MediaRequest {
            id: Uuid::new_v4(),
            requested_by: Uuid::new_v4(),
            kind: WorkKind::Movie,
            target: external_target(),
            source_instance_id: None,
            status: RequestStatus::Pending,
            note: None,
            created_at: now,
            updated_at: now,
            decided_by: None,
        };
        let mut rejected = pending.clone();
        rejected.id = Uuid::new_v4();
        rejected.status = RequestStatus::Rejected;

        repo.upsert(&pending).await.unwrap();
        repo.upsert(&rejected).await.unwrap();

        let result = repo.list_pending().await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, pending.id);
    }
}
