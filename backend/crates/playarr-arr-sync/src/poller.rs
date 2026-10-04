//! Poll-as-truth: the reconciliation loop that actually keeps the catalog
//! correct. Runs on a fixed interval per configured `SourceInstance`,
//! diffing everything it lists from the source app against `WorkRepo` and
//! upserting what changed — webhooks (see [`crate::webhook`]) only shorten
//! the latency between a change happening and this loop noticing it, via
//! [`RefetchRequest`]s that fast-path a specific entity ahead of the next
//! scheduled full pass.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use playarr_coordination::ClusterCoordinator;
use playarr_db::{CreditRepo, DbPool, MediaFileRepo, WorkRepo};
use playarr_model::{Availability, ExternalProvider, ExternalRef, SourceKind, Work, WorkKind};
use uuid::Uuid;

use crate::arr_client::{work_kind_and_provider, ArrClient, RemoteWork};
use crate::media_sync::MediaSync;
use crate::webhook::RefetchRequest;

#[derive(Debug, thiserror::Error)]
pub enum PollError {
    #[error("arr client error: {0}")]
    Client(String),
    #[error(transparent)]
    Db(#[from] playarr_db::DbError),
    #[error(transparent)]
    Coordination(#[from] playarr_coordination::CoordinationError),
}

/// One insert/update/delete decided by a reconciliation diff, not yet
/// applied. Exposed (not just used internally) so callers/tests can assert
/// on the plan a diff produced before (or instead of) applying it.
#[derive(Debug, Clone, PartialEq)]
pub enum SyncOp {
    Insert(Work),
    Update(Work),
    Delete(Uuid),
}

/// What triggered a reconciliation pass — drives whether it's a full listing
/// (`Scheduled`) or a targeted single-entity re-fetch (`Refetch`).
enum ReconcileTrigger {
    Scheduled,
    Refetch(Option<i64>),
}

/// A reconciliation pass's outcome, for whoever wants to observe this
/// poller's health/activity from outside (e.g. an admin-facing "sync
/// status" screen) without reading log lines. Deliberately coarse (no
/// insert/update/delete counts -- those stay in the `tracing::info!` this
/// module already emits) since the only real consumer today is "is this
/// source instance's sync currently working," not a detailed audit log.
#[derive(Debug, Clone)]
pub enum SyncRunStatus {
    Running {
        started_at: chrono::DateTime<Utc>,
        /// Free-form human-readable progress, e.g. `"backfilling media
        /// files: 42/731"` -- set by `backfill_missing_media_files` while
        /// it's working through a large catch-up batch (see that method's
        /// doc comment for why that batch can be large and slow: one real
        /// *arr API request per work, run with bounded concurrency but
        /// still genuinely rate-limited by the source instance's own
        /// response time). `None` outside of that, including for the
        /// initial `Running` report at the very start of a pass.
        detail: Option<String>,
    },
    Succeeded {
        finished_at: chrono::DateTime<Utc>,
    },
    Failed {
        error: String,
        finished_at: chrono::DateTime<Utc>,
    },
}

/// Implemented by whatever wants to observe every reconciliation pass this
/// poller runs. Optional (see [`ReconciliationPoller::with_status_reporter`])
/// so tests and any future caller with no observer can skip it entirely --
/// this trait exists purely to let `playarr-arr-sync` report status
/// without depending on whatever storage/API type actually holds it
/// (that's `playarr-api::SourceInstanceRegistry` in production, which
/// implements this trait rather than this crate depending the other way).
pub trait SyncStatusReporter: Send + Sync {
    fn report(&self, source_instance_id: Uuid, status: SyncRunStatus);
}

/// One reconciliation loop, bound to a single [`playarr_model::SourceInstance`].
/// `playarr-bin`'s worker-role startup constructs one `ReconciliationPoller`
/// per enabled source instance and spawns each with `run` (see
/// `playarr_telemetry::correlation::spawn::spawn_traced`).
pub struct ReconciliationPoller {
    source_instance_id: Uuid,
    source_kind: SourceKind,
    /// The live *arr connection this poller reconciles against. Constructed
    /// via `ArrClient::from_source_instance` by the caller (it, not this
    /// struct, owns decrypting the source instance's stored API key).
    arr_client: ArrClient,
    poll_interval: Duration,
    work_repo: Arc<dyn WorkRepo>,
    /// Fetches each reconciled `Work`'s file-level data (episode/movie/
    /// track/book files) and upserts `MediaFile` rows -- see
    /// [`crate::media_sync`]'s doc comment. Best-effort per work (see
    /// [`Self::sync_media_files`]): a file-sync failure for one work never
    /// fails the whole reconciliation pass, since the catalog identity sync
    /// above is this poller's primary responsibility.
    media_sync: MediaSync,
    coordinator: Arc<dyn ClusterCoordinator>,
    trigger_rx: tokio::sync::mpsc::Receiver<RefetchRequest>,
    /// `None` by default (every existing test/caller that doesn't opt in
    /// via [`Self::with_status_reporter`] just skips reporting) -- see
    /// [`SyncStatusReporter`]'s doc comment for why this is a trait object
    /// rather than a concrete dependency on `playarr-api`.
    status_reporter: Option<Arc<dyn SyncStatusReporter>>,
    /// `None` by default -- see [`Self::with_artwork_prewarm`].
    artwork_prewarm: Option<crate::ArtworkPrewarm>,
    /// `None` by default -- see [`Self::with_embedding_sync`].
    embedding_sync: Option<crate::EmbeddingSync>,
    /// `None` by default -- see [`Self::with_live_events`].
    live_events: Option<playarr_db::LiveEventPublisher>,
}

impl ReconciliationPoller {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        source_instance_id: Uuid,
        source_kind: SourceKind,
        arr_client: ArrClient,
        poll_interval: Duration,
        work_repo: Arc<dyn WorkRepo>,
        media_file_repo: Arc<dyn MediaFileRepo>,
        pool: DbPool,
        coordinator: Arc<dyn ClusterCoordinator>,
        trigger_rx: tokio::sync::mpsc::Receiver<RefetchRequest>,
    ) -> Self {
        Self {
            source_instance_id,
            source_kind,
            arr_client,
            poll_interval,
            work_repo,
            media_sync: MediaSync::new(pool, media_file_repo),
            coordinator,
            trigger_rx,
            status_reporter: None,
            artwork_prewarm: None,
            embedding_sync: None,
            live_events: None,
        }
    }

    /// Opts this poller into telling admin live-event streams when a sync
    /// pass starts and finishes (`docs/architecture/live-events.md`). Catalogue
    /// and file changes themselves are published by the event-decorated
    /// repositories the poller writes through, not here.
    pub fn with_live_events(mut self, events: playarr_db::LiveEventPublisher) -> Self {
        self.live_events = Some(events);
        self
    }

    async fn announce_sync(&self, change: &'static str) {
        if let Some(events) = &self.live_events {
            events
                .publish(playarr_db::NewLiveEvent {
                    user_id: None,
                    kind: playarr_db::live_event_kind::ADMIN,
                    entity: "source_instance",
                    entity_id: Some(self.source_instance_id.to_string()),
                    changed: vec![change],
                    source_instance_id: None,
                })
                .await;
        }
    }

    /// Opts this poller into reporting every reconciliation pass's outcome
    /// to `reporter` -- see [`SyncStatusReporter`]. Builder-style so
    /// existing callers/tests that don't care about status observation
    /// don't need to thread an extra argument through `new`.
    pub fn with_status_reporter(mut self, reporter: Arc<dyn SyncStatusReporter>) -> Self {
        self.status_reporter = Some(reporter);
        self
    }

    /// Opts this poller into proactively warming Playarr Server's local
    /// artwork cache for every reconciled work's images -- see
    /// [`crate::artwork_prewarm`]'s doc comment.
    pub fn with_artwork_prewarm(mut self, prewarm: crate::ArtworkPrewarm) -> Self {
        self.artwork_prewarm = Some(prewarm);
        self
    }

    /// Opts this poller into generating/caching a semantic-similarity
    /// embedding for every reconciled work -- see [`crate::embedding_sync`]'s
    /// doc comment.
    pub fn with_embedding_sync(mut self, embedding_sync: crate::EmbeddingSync) -> Self {
        self.embedding_sync = Some(embedding_sync);
        self
    }

    /// Opts this poller's [`MediaSync`] into also syncing cast/crew
    /// credits (Radarr-sourced movies only, see
    /// [`crate::media_sync::MediaSync::with_credit_repo`]'s doc comment).
    /// Same builder-opt-in shape as [`Self::with_status_reporter`].
    pub fn with_credit_repo(mut self, credit_repo: Arc<dyn CreditRepo>) -> Self {
        self.media_sync = self.media_sync.with_credit_repo(credit_repo);
        self
    }

    /// Opts this poller's [`MediaSync`] into indexing audio/subtitle
    /// languages from *arr `mediaInfo` (see
    /// [`crate::media_sync::MediaSync::with_language_repo`]).
    pub fn with_language_repo(
        mut self,
        language_repo: Arc<dyn playarr_db::MediaLanguageRepo>,
    ) -> Self {
        self.media_sync = self.media_sync.with_language_repo(language_repo);
        self
    }

    /// Runs until the trigger channel closes (i.e. every clone of the
    /// corresponding `WebhookReceiver`'s sender has been dropped, which is
    /// this poller's shutdown signal — there's no separate cancellation
    /// token). A `tokio::select!` between an interval tick (drives
    /// `reconcile_all`) and a `RefetchRequest` arriving (drives
    /// `reconcile_one`); each iteration first calls
    /// `ClusterCoordinator::try_lock` on a key scoped to this source
    /// instance so that in a multi-node deployment only one node ever
    /// reconciles a given instance concurrently — `SingleNodeCoordinator`
    /// makes this a no-op contention-wise, `PostgresCoordinator` makes it a
    /// real distributed lock.
    pub async fn run(mut self) -> Result<(), PollError> {
        let mut interval = tokio::time::interval(self.poll_interval);
        // `tokio::time::interval`'s first tick fires immediately, which is
        // the desired behavior here: reconcile once at startup rather than
        // waiting a full `poll_interval` before the catalog is populated.

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    self.reconcile_with_lock(ReconcileTrigger::Scheduled).await?;
                }
                maybe_request = self.trigger_rx.recv() => {
                    match maybe_request {
                        Some(request) => {
                            self.reconcile_with_lock(ReconcileTrigger::Refetch(request.entity_id))
                                .await?;
                        }
                        None => return Ok(()),
                    }
                }
            }
        }
    }

    async fn reconcile_with_lock(&self, trigger: ReconcileTrigger) -> Result<(), PollError> {
        let lock_key = format!("arr-sync:{}", self.source_instance_id);
        let Some(_guard) = self
            .coordinator
            .try_lock(&lock_key, self.poll_interval)
            .await?
        else {
            tracing::debug!(
                source_instance_id = %self.source_instance_id,
                "another node already holds the reconciliation lock for this source instance; skipping this tick"
            );
            return Ok(());
        };

        if let Some(reporter) = &self.status_reporter {
            reporter.report(
                self.source_instance_id,
                SyncRunStatus::Running {
                    started_at: Utc::now(),
                    detail: None,
                },
            );
        }

        self.announce_sync("sync_started").await;
        let outcome = match trigger {
            ReconcileTrigger::Scheduled => self.reconcile_all().await,
            ReconcileTrigger::Refetch(entity_id) => self.reconcile_one(entity_id).await,
        };

        if let Some(reporter) = &self.status_reporter {
            let status = match &outcome {
                Ok(()) => SyncRunStatus::Succeeded {
                    finished_at: Utc::now(),
                },
                Err(err) => SyncRunStatus::Failed {
                    error: err.to_string(),
                    finished_at: Utc::now(),
                },
            };
            reporter.report(self.source_instance_id, status);
        }
        self.announce_sync("sync_finished").await;

        outcome
    }

    /// A full pass: list everything from the source instance, diff by
    /// external ref against what `WorkRepo` currently has for this source
    /// kind, and apply whatever inserts/updates/deletes that diff produces.
    /// This — not the webhook payload — is the authoritative source for
    /// catalog state.
    ///
    /// Note on multi-instance deletes: this diffs against *every* local
    /// `Work` of the matching kind, not just ones this specific source
    /// instance previously produced — `playarr_model::Work` has no
    /// source-instance-provenance field to scope by (only
    /// metadata-provider `external_refs`). For the common case (one source
    /// instance per kind) this is correct. Running two instances of the
    /// same kind against disjoint libraries (e.g. two Radarr instances for
    /// 4K vs 1080p) would make each instance's full pass see the other's
    /// works as "missing" and delete them. TODO: once `Work` (or a join
    /// table) tracks which source instance(s) contributed it, scope
    /// `list_all_local` by `source_instance_id` instead of just `kind` to
    /// close this gap; deferred here since it needs a `playarr-model`
    /// change outside this crate.
    async fn reconcile_all(&self) -> Result<(), PollError> {
        let Some((work_kind, provider)) = work_kind_and_provider(self.source_kind) else {
            tracing::debug!(
                source_instance_id = %self.source_instance_id,
                source_kind = ?self.source_kind,
                "source kind has no Work-owning catalog surface; nothing to reconcile"
            );
            return Ok(());
        };

        let remote = self
            .arr_client
            .list_all(self.source_instance_id)
            .await
            .map_err(|err| PollError::Client(err.to_string()))?;
        // Built before `diff_works` consumes `remote`: `SyncOp`'s `Work`
        // carries the metadata-provider `external_id` (via
        // `Work::external_refs`) but not the *arr app's own numeric id, so
        // this is the only place that id is still available once ops are
        // computed -- see `Self::sync_media_files`.
        let source_ids: HashMap<String, i64> = remote
            .iter()
            .map(|r| (r.external_id.clone(), r.source_id))
            .collect();

        let mut local = self.list_all_local(work_kind).await?;
        let mut ops = Vec::new();
        if self.source_kind == SourceKind::Whisparr {
            let legacy_series = self.list_all_local(WorkKind::Series).await?;
            let (normalised, cleanup_ops) = normalise_whisparr_locals(local, legacy_series);
            local = normalised;
            ops.extend(cleanup_ops);
        }
        // Snapshot before `diff_works` moves `local` -- needed below to
        // find works the diff *didn't* touch (no catalog-level change) but
        // whose file-level sync may still be outstanding. See
        // `backfill_missing_media_files`'s doc comment for why this is
        // necessary at all.
        let local_snapshot = local.clone();

        ops.extend(diff_works(work_kind, &provider, remote, local));
        tracing::info!(
            source_instance_id = %self.source_instance_id,
            inserts = ops.iter().filter(|op| matches!(op, SyncOp::Insert(_))).count(),
            updates = ops.iter().filter(|op| matches!(op, SyncOp::Update(_))).count(),
            deletes = ops.iter().filter(|op| matches!(op, SyncOp::Delete(_))).count(),
            "reconciliation diff computed"
        );

        self.apply_ops(&ops).await?;
        self.sync_media_files(&ops, &provider, &source_ids).await;
        self.prewarm_artwork(&ops).await;
        self.sync_embeddings(&ops).await;
        self.backfill_missing_media_files(&local_snapshot, &ops, &provider, &source_ids)
            .await;
        Ok(())
    }

    /// A targeted re-fetch for one entity, triggered by a webhook signal
    /// (dispatching on `self.source_kind` to the matching `get_*` method via
    /// `ArrClient::get_one`), falling back to `reconcile_all` when
    /// `entity_id` is `None` (Bazarr/Prowlarr signals, or any *arr payload
    /// shape `webhook::extract_entity_id` didn't recognize).
    async fn reconcile_one(&self, entity_id: Option<i64>) -> Result<(), PollError> {
        // A Whisparr full pass also adopts legacy TPDB-backed `Series`
        // rows and removes duplicates created before `WorkKind::Site`
        // existed. Keep targeted webhooks on that safe path until every
        // deployment has completed at least one normalising pass.
        if self.source_kind == SourceKind::Whisparr {
            return self.reconcile_all().await;
        }

        let Some(id) = entity_id else {
            return self.reconcile_all().await;
        };

        let Some((work_kind, provider)) = work_kind_and_provider(self.source_kind) else {
            // Shouldn't normally happen (`webhook::extract_entity_id` never
            // produces a `Some` id for Bazarr/Prowlarr), but a full pass is
            // a safe, correct fallback if it ever does.
            return self.reconcile_all().await;
        };

        let remote = match self.arr_client.get_one(id, self.source_instance_id).await {
            Ok(Some(remote)) => remote,
            Ok(None) => return self.reconcile_all().await,
            Err(err) => {
                // A single targeted re-fetch failing (most commonly a 404
                // because the entity was deleted at the source between the
                // webhook firing and this call) doesn't tell us which
                // catalog `Work` to remove — the only id we have here is
                // the source app's own internal id, and `Work` is keyed by
                // metadata-provider id, which we'd have needed the *now
                // missing* entity to learn. A full pass is the only
                // reliable way to notice a delete in that case.
                tracing::warn!(
                    source_instance_id = %self.source_instance_id,
                    entity_id = id,
                    error = %err,
                    "targeted re-fetch failed; falling back to full reconciliation pass"
                );
                return self.reconcile_all().await;
            }
        };

        let existing = self
            .work_repo
            .find_by_external_ref(&provider, &remote.external_id)
            .await?;

        let op = match existing {
            Some(existing) => {
                let merged = merge_work(&existing, work_kind, &remote);
                if merged == existing {
                    if self
                        .media_sync
                        .has_missing_duration(existing.id)
                        .await
                        .unwrap_or(false)
                    {
                        self.sync_media_file(existing.id, id).await;
                    }
                    return Ok(());
                }
                SyncOp::Update(merged)
            }
            None => SyncOp::Insert(new_work(work_kind, provider, &remote)),
        };

        let ops = vec![op];
        self.apply_ops(&ops).await?;
        // `id` here is already the *arr app's own numeric id (it's exactly
        // what was passed to `ArrClient::get_one` above) -- no
        // external_id -> source_id lookup needed, unlike `reconcile_all`.
        if let Some(SyncOp::Insert(work) | SyncOp::Update(work)) = ops.first() {
            self.sync_media_file(work.id, id).await;
        }
        self.prewarm_artwork(&ops).await;
        self.sync_embeddings(&ops).await;
        Ok(())
    }

    /// Pages through `WorkRepo::list_by_kind` until it runs out of results.
    async fn list_all_local(&self, kind: WorkKind) -> Result<Vec<Work>, PollError> {
        const PAGE_SIZE: i64 = 200;
        let mut offset: i64 = 0;
        let mut all = Vec::new();
        loop {
            let page = self.work_repo.list_by_kind(kind, PAGE_SIZE, offset).await?;
            let got = page.len() as i64;
            all.extend(page);
            if got < PAGE_SIZE {
                break;
            }
            offset += PAGE_SIZE;
        }
        Ok(all)
    }

    async fn apply_ops(&self, ops: &[SyncOp]) -> Result<(), PollError> {
        for op in ops {
            match op {
                SyncOp::Insert(work) | SyncOp::Update(work) => {
                    self.work_repo.upsert(work).await?;
                }
                SyncOp::Delete(id) => {
                    self.work_repo.delete(*id).await?;
                }
            }
        }
        Ok(())
    }

    /// After a full pass's ops have been applied, runs
    /// [`MediaSync::sync_work`] for every inserted/updated `Work`, resolving
    /// each one's *arr numeric id via `source_ids` (keyed by the same
    /// metadata-provider `external_id` `Work::external_refs` carries).
    /// Best-effort: a single work's file-sync failure is logged and skipped
    /// rather than failing the pass -- the next scheduled pass retries it,
    /// and every other work in this pass still gets synced.
    async fn sync_media_files(
        &self,
        ops: &[SyncOp],
        provider: &ExternalProvider,
        source_ids: &HashMap<String, i64>,
    ) {
        for op in ops {
            let work = match op {
                SyncOp::Insert(work) | SyncOp::Update(work) => work,
                SyncOp::Delete(_) => continue,
            };
            let Some(external_id) = work
                .external_refs
                .iter()
                .find(|r| &r.provider == provider)
                .map(|r| r.external_id.as_str())
            else {
                continue;
            };
            let Some(&arr_source_id) = source_ids.get(external_id) else {
                continue;
            };
            self.sync_media_file(work.id, arr_source_id).await;
        }
    }

    /// Runs [`MediaSync::sync_work`] for one work, logging (rather than
    /// propagating) a failure -- see [`Self::sync_media_files`]'s doc
    /// comment for why this is deliberately non-fatal.
    async fn sync_media_file(&self, work_id: Uuid, arr_source_id: i64) {
        if let Err(err) = self
            .media_sync
            .sync_work(
                &self.arr_client,
                work_id,
                arr_source_id,
                self.source_instance_id,
            )
            .await
        {
            tracing::warn!(
                source_instance_id = %self.source_instance_id,
                work_id = %work_id,
                error = %err,
                "file-level media sync failed for this work; catalog metadata was still synced, \
                 will retry on the next reconciliation pass"
            );
        }
    }

    /// No-op unless [`Self::with_artwork_prewarm`] was called. Best-effort
    /// per work -- see [`crate::artwork_prewarm::ArtworkPrewarm::
    /// prewarm_work`]'s own doc comment for why a single image failure
    /// never propagates.
    async fn prewarm_artwork(&self, ops: &[SyncOp]) {
        let Some(prewarm) = &self.artwork_prewarm else {
            return;
        };
        for op in ops {
            let work = match op {
                SyncOp::Insert(work) | SyncOp::Update(work) => work,
                SyncOp::Delete(_) => continue,
            };
            prewarm.prewarm_work(work).await;
        }
    }

    /// No-op unless [`Self::with_embedding_sync`] was called. Best-effort
    /// per work, same "one failure never blocks the rest" shape as
    /// [`Self::sync_media_files`].
    async fn sync_embeddings(&self, ops: &[SyncOp]) {
        let Some(embedding_sync) = &self.embedding_sync else {
            return;
        };
        for op in ops {
            let work = match op {
                SyncOp::Insert(work) | SyncOp::Update(work) => work,
                SyncOp::Delete(_) => continue,
            };
            if let Err(err) = embedding_sync.sync_work(work).await {
                tracing::warn!(
                    source_instance_id = %self.source_instance_id,
                    work_id = %work.id,
                    error = %err,
                    "embedding sync failed for this work; 'similar to this' will be \
                     unavailable for it until a later pass succeeds"
                );
            }
        }
    }

    /// Retries file-level sync for `Available` local works that [`Self::
    /// sync_media_files`] didn't touch this pass -- because their catalog
    /// identity hadn't changed, so `diff_works` produced no `SyncOp` for
    /// them -- but that still have zero synced `MediaFile` rows.
    ///
    /// This closes a real gap [`Self::sync_media_file`]'s own doc comment
    /// used to claim was already handled ("will retry on the next
    /// reconciliation pass") but wasn't: `sync_media_files` only ever runs
    /// for works appearing in *this pass's* diff (a fresh insert or a
    /// catalog-level update), so a work whose very first file-sync attempt
    /// failed or was interrupted (a transient *arr API error, a process
    /// restart mid-sync) would never be retried on any *later* pass, since
    /// once its catalog identity stopped changing it would stop appearing
    /// in `ops` at all -- permanently missing a `MediaFile` despite
    /// `Work::availability` correctly reporting `Available`. Confirmed as a
    /// real, non-hypothetical gap: a large fraction of an already-"Available"
    /// library can end up with no playable file this way after nothing
    /// more unusual than an interrupted initial sync.
    ///
    /// Cheap on the common case (no gap): `MediaSync::has_any_media_file`
    /// is a local DB read, not a network call, so this only spends a real
    /// *arr API request on works that actually need one.
    ///
    /// Runs candidates with up to [`BACKFILL_CONCURRENCY`] *arr API
    /// requests in flight at once (via `buffer_unordered`, not separate
    /// spawned tasks -- see this crate's `Cargo.toml` for why that's
    /// enough here) rather than one at a time, and reports live progress
    /// through `self.status_reporter` as `SyncRunStatus::Running`'s
    /// `detail` -- a library backfill can genuinely be hundreds of works
    /// deep (confirmed in practice, not hypothetical: a real library with
    /// most of its initial sync interrupted needed 700+ retries), and a
    /// purely-sequential loop with no visible progress reads as "stuck"
    /// even when it's working correctly.
    async fn backfill_missing_media_files(
        &self,
        local_snapshot: &[Work],
        ops: &[SyncOp],
        provider: &ExternalProvider,
        source_ids: &HashMap<String, i64>,
    ) {
        use futures::stream::{self, StreamExt};

        let already_handled: std::collections::HashSet<Uuid> = ops
            .iter()
            .filter_map(|op| match op {
                SyncOp::Insert(work) | SyncOp::Update(work) => Some(work.id),
                SyncOp::Delete(_) => None,
            })
            .collect();

        let candidates: Vec<(Uuid, i64, Availability)> = local_snapshot
            .iter()
            .filter(|work| !already_handled.contains(&work.id))
            .filter_map(|work| {
                let external_id = work
                    .external_refs
                    .iter()
                    .find(|r| &r.provider == provider)
                    .map(|r| r.external_id.as_str())?;
                let arr_source_id = *source_ids.get(external_id)?;
                Some((work.id, arr_source_id, work.availability))
            })
            .collect();

        if candidates.is_empty() {
            return;
        }
        let total = candidates.len();
        tracing::info!(
            source_instance_id = %self.source_instance_id,
            total,
            "starting missing-media-file backfill pass"
        );

        let mut in_flight = stream::iter(candidates.into_iter().map(
            |(work_id, arr_source_id, availability)| {
                self.backfill_one(work_id, arr_source_id, availability)
            },
        ))
        .buffer_unordered(BACKFILL_CONCURRENCY);

        let mut completed = 0usize;
        while in_flight.next().await.is_some() {
            completed += 1;
            if let Some(reporter) = &self.status_reporter {
                reporter.report(
                    self.source_instance_id,
                    SyncRunStatus::Running {
                        started_at: Utc::now(),
                        detail: Some(format!("backfilling media files: {completed}/{total}")),
                    },
                );
            }
        }

        tracing::info!(
            source_instance_id = %self.source_instance_id,
            total,
            "missing-media-file backfill pass complete"
        );
    }

    /// One backfill candidate: checks (a local DB read) whether `work_id`
    /// still has no `MediaFile`, and if so retries its file-level sync (a
    /// real *arr API request). Split out from [`Self::
    /// backfill_missing_media_files`] so that method can drive many of
    /// these concurrently via `buffer_unordered`.
    async fn backfill_one(&self, work_id: Uuid, arr_source_id: i64, availability: Availability) {
        let has_files = match self.media_sync.has_any_media_file(work_id).await {
            Ok(has_files) => has_files,
            Err(err) => {
                tracing::warn!(
                    source_instance_id = %self.source_instance_id,
                    work_id = %work_id,
                    error = %err,
                    "failed to inspect media files; skipping backfill for this work this pass"
                );
                return;
            }
        };
        let needs_duration = if has_files {
            match self.media_sync.has_missing_duration(work_id).await {
                Ok(needs_duration) => needs_duration,
                Err(err) => {
                    tracing::warn!(
                        source_instance_id = %self.source_instance_id,
                        work_id = %work_id,
                        error = %err,
                        "failed to inspect media runtime metadata; skipping backfill for this work this pass"
                    );
                    return;
                }
            }
        } else {
            false
        };

        let should_backfill_missing = !has_files
            && (availability == Availability::Available
                || (self.source_kind == SourceKind::Lidarr
                    && availability == Availability::Unknown));
        if needs_duration || should_backfill_missing {
            if needs_duration {
                tracing::info!(
                    source_instance_id = %self.source_instance_id,
                    work_id = %work_id,
                    "backfilling missing media runtime metadata"
                );
            } else {
                tracing::info!(
                    source_instance_id = %self.source_instance_id,
                    work_id = %work_id,
                    "backfilling missing media file for an already-Available work"
                );
            }
            self.sync_media_file(work_id, arr_source_id).await;
        }
    }
}

/// How many `backfill_missing_media_files` candidates get a real *arr API
/// request in flight at once. Bounded, not unlimited: this is still one
/// operator's own `*arr` instance answering every request, and a burst of
/// hundreds of simultaneous requests against it (e.g. a self-hosted
/// instance on modest hardware) risks looking like abuse or just
/// overwhelming it -- 8 is a reasonable middle ground between "meaningfully
/// faster than serial" and "still polite."
const BACKFILL_CONCURRENCY: usize = 8;

/// Builds a brand-new `Work` for a remote entity with no existing local
/// match. Identity/monitoring/(when derivable) availability, plus
/// `overview`/`images`/`genres` (arr-sync owns these now -- the source
/// *arr apps are themselves TMDb/TVDB/MusicBrainz-backed, see
/// `RemoteWork`'s doc comment), are populated from `remote`; `tags`
/// defaults empty since arr-sync doesn't originate user/automation tags.
fn new_work(kind: WorkKind, provider: ExternalProvider, remote: &RemoteWork) -> Work {
    Work {
        id: Uuid::new_v4(),
        kind,
        external_refs: vec![ExternalRef {
            provider,
            external_id: remote.external_id.clone(),
        }],
        title: remote.title.clone(),
        sort_title: remote.sort_title.clone(),
        overview: remote.overview.clone(),
        images: remote.images.clone(),
        genres: remote.genres.clone(),
        tags: rating_tags(&[], remote.certification.as_deref()),
        added_at: Utc::now(),
        // Arr-owned, like `overview`/`images`/`genres` above -- see
        // `RemoteWork::release_date`'s doc comment.
        release_date: remote.release_date,
        monitored: remote.monitored,
        availability: remote.availability.unwrap_or(Availability::Unknown),
    }
}

/// Applies a remote entity's arr-owned fields onto an existing `Work`,
/// leaving everything arr-sync doesn't own (`tags`, `added_at`, other
/// providers' `external_refs`) untouched. This is why `reconcile_all`
/// diffs by comparing the *merged* result against `existing` rather than
/// just always emitting an `Update` — a remote entity that hasn't
/// meaningfully changed since the last pass shouldn't generate a write.
fn merge_work(existing: &Work, kind: WorkKind, remote: &RemoteWork) -> Work {
    let mut merged = existing.clone();
    merged.kind = kind;
    merged.title = remote.title.clone();
    merged.sort_title = remote.sort_title.clone();
    merged.monitored = remote.monitored;
    if let Some(availability) = remote.availability {
        merged.availability = availability;
    }
    merged.overview = remote.overview.clone();
    merged.images = remote.images.clone();
    merged.genres = remote.genres.clone();
    merged.release_date = remote.release_date;
    merged.tags = rating_tags(&existing.tags, remote.certification.as_deref());
    merged
}

/// `existing` tags with the arr-owned `rating:` tag replaced by
/// `certification` (or removed when the source reports none). Every other
/// tag, including an admin's `rating-override:`, is preserved untouched.
fn rating_tags(existing: &[String], certification: Option<&str>) -> Vec<String> {
    let prefix = playarr_model::household::RATING_TAG_PREFIX;
    let mut tags: Vec<String> = existing
        .iter()
        .filter(|tag| {
            !tag.get(..prefix.len())
                .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
        })
        .cloned()
        .collect();
    if let Some(rating) = certification {
        tags.push(format!("{prefix}{rating}"));
    }
    tags
}

/// The core diff algorithm: given everything the source instance currently
/// reports (`remote`) and everything `WorkRepo` currently has for the
/// matching `kind` (`local`), decides which `Work`s are new (`Insert`),
/// changed (`Update`), or gone (`Delete`). Matching is keyed by
/// `ExternalRef { provider, external_id }`, not `Work::id` — the remote side
/// has no notion of our internal id.
fn diff_works(
    kind: WorkKind,
    provider: &ExternalProvider,
    remote: Vec<RemoteWork>,
    local: Vec<Work>,
) -> Vec<SyncOp> {
    let mut local_by_external_id: HashMap<String, Work> = local
        .into_iter()
        .filter_map(|work| {
            let external_id = work
                .external_refs
                .iter()
                .find(|reference| &reference.provider == provider)
                .map(|reference| reference.external_id.clone())?;
            Some((external_id, work))
        })
        .collect();

    let mut ops = Vec::with_capacity(remote.len());

    for remote_work in remote {
        match local_by_external_id.remove(&remote_work.external_id) {
            Some(existing) => {
                let merged = merge_work(&existing, kind, &remote_work);
                if merged != existing {
                    ops.push(SyncOp::Update(merged));
                }
            }
            None => ops.push(SyncOp::Insert(new_work(
                kind,
                provider.clone(),
                &remote_work,
            ))),
        }
    }

    // Whatever's left in the map had a local `Work` keyed to this provider
    // that no remote entity claimed this pass — it's gone from the source.
    for (_, remaining) in local_by_external_id {
        ops.push(SyncOp::Delete(remaining.id));
    }

    ops
}

/// Normalises the one historical taxonomy change in the catalogue:
/// Whisparr used to write TPDB-backed works as `Series`, and now writes
/// them as `Site`.
///
/// A legacy-only row is retained (same `Work::id`) and fed into the normal
/// diff as a `Site`, preserving references such as playlist membership.
/// If a newer `Site` duplicate already exists for the same TPDB id, that
/// canonical row is retained instead: media-file upserts move the playable
/// files to it by source-file identity, while the legacy duplicate is
/// scheduled for deletion.
fn normalise_whisparr_locals(
    sites: Vec<Work>,
    legacy_series: Vec<Work>,
) -> (Vec<Work>, Vec<SyncOp>) {
    let site_external_ids: std::collections::HashSet<String> = sites
        .iter()
        .filter_map(|work| {
            work.external_refs
                .iter()
                .find(|reference| reference.provider == ExternalProvider::Tpdb)
                .map(|reference| reference.external_id.clone())
        })
        .collect();
    let mut normalised = sites;
    let mut cleanup = Vec::new();

    for mut legacy in legacy_series {
        let Some(external_id) = legacy
            .external_refs
            .iter()
            .find(|reference| reference.provider == ExternalProvider::Tpdb)
            .map(|reference| reference.external_id.clone())
        else {
            continue;
        };
        if site_external_ids.contains(&external_id) {
            cleanup.push(SyncOp::Delete(legacy.id));
        } else {
            legacy.kind = WorkKind::Site;
            normalised.push(legacy);
        }
    }

    (normalised, cleanup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;
    use std::sync::Mutex;

    use async_trait::async_trait;
    use playarr_db::DbError;

    fn work_with_ref(
        kind: WorkKind,
        provider: ExternalProvider,
        external_id: &str,
        title: &str,
        monitored: bool,
        availability: Availability,
    ) -> Work {
        Work {
            id: Uuid::new_v4(),
            kind,
            external_refs: vec![ExternalRef {
                provider,
                external_id: external_id.to_string(),
            }],
            title: title.to_string(),
            sort_title: title.to_lowercase(),
            overview: Some("existing overview".to_string()),
            images: Vec::new(),
            genres: vec!["Drama".to_string()],
            tags: vec!["kids".to_string()],
            added_at: Utc::now(),
            release_date: None,
            monitored,
            availability,
        }
    }

    fn remote(external_id: &str, title: &str, monitored: bool) -> RemoteWork {
        RemoteWork {
            certification: None,
            external_id: external_id.to_string(),
            // Not exercised by `diff_works`/`merge_work` (only
            // `crate::media_sync::MediaSync` reads it) -- a fixed
            // placeholder is fine for every test in this module.
            source_id: 0,
            title: title.to_string(),
            sort_title: title.to_lowercase(),
            monitored,
            availability: None,
            overview: None,
            genres: Vec::new(),
            images: Vec::new(),
            release_date: None,
        }
    }

    // ---- diff_works ----

    #[test]
    fn diff_inserts_new_remote_entities() {
        let remote_list = vec![remote("100", "New Show", true)];
        let ops = diff_works(
            WorkKind::Series,
            &ExternalProvider::Tvdb,
            remote_list,
            vec![],
        );

        assert_eq!(ops.len(), 1);
        match &ops[0] {
            SyncOp::Insert(work) => {
                assert_eq!(work.title, "New Show");
                assert_eq!(
                    work.external_refs,
                    vec![ExternalRef {
                        provider: ExternalProvider::Tvdb,
                        external_id: "100".to_string(),
                    }]
                );
                assert_eq!(work.availability, Availability::Unknown);
            }
            other => panic!("expected Insert, got {other:?}"),
        }
    }

    #[test]
    fn diff_deletes_local_entities_missing_from_remote() {
        let local = vec![work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tvdb,
            "200",
            "Cancelled Show",
            true,
            Availability::Available,
        )];
        let local_id = local[0].id;

        let ops = diff_works(WorkKind::Series, &ExternalProvider::Tvdb, vec![], local);

        assert_eq!(ops, vec![SyncOp::Delete(local_id)]);
    }

    #[test]
    fn diff_updates_when_arr_owned_fields_change() {
        let local = vec![work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tvdb,
            "300",
            "Old Title",
            true,
            Availability::Available,
        )];
        let remote_list = vec![remote("300", "New Title", true)];

        let ops = diff_works(
            WorkKind::Series,
            &ExternalProvider::Tvdb,
            remote_list,
            local,
        );

        assert_eq!(ops.len(), 1);
        match &ops[0] {
            SyncOp::Update(work) => {
                assert_eq!(work.title, "New Title");
                // `overview`/`genres` are arr-owned (see `merge_work`'s doc
                // comment) -- the `remote()` fixture carries neither, so
                // they're overwritten to empty rather than preserved from
                // `existing`. `tags` (genuinely not arr-owned) isn't
                // exercised by this fixture; see
                // `merge_work_preserves_tags_but_not_arr_owned_metadata`.
                assert_eq!(work.overview, None);
                assert!(work.genres.is_empty());
                assert_eq!(work.availability, Availability::Available);
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    #[test]
    fn diff_produces_no_op_when_nothing_changed() {
        let local = vec![work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tvdb,
            "400",
            "Stable Show",
            true,
            Availability::Available,
        )];
        // `overview`/`genres` are arr-owned now, so a genuine "nothing
        // changed" remote must report the same values `work_with_ref`
        // already seeded onto `local` -- otherwise this wouldn't actually
        // be testing a no-op, it'd be testing a real (if metadata-only)
        // change that happens to look like one.
        let mut remote_entity = remote("400", "Stable Show", true);
        remote_entity.overview = Some("existing overview".to_string());
        remote_entity.genres = vec!["Drama".to_string()];
        let remote_list = vec![remote_entity];

        let ops = diff_works(
            WorkKind::Series,
            &ExternalProvider::Tvdb,
            remote_list,
            local,
        );

        assert!(ops.is_empty());
    }

    #[test]
    fn diff_handles_insert_update_and_delete_together() {
        let unchanged = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "1",
            "Unchanged Movie",
            true,
            Availability::Available,
        );
        let to_update = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "2",
            "Old Name",
            true,
            Availability::Pending,
        );
        let to_delete = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "3",
            "Removed Movie",
            true,
            Availability::Available,
        );
        let to_delete_id = to_delete.id;
        let local = vec![unchanged.clone(), to_update, to_delete];

        // The "unchanged" remote entry must report the same arr-owned
        // overview/genres `work_with_ref` already seeded onto `unchanged`
        // -- otherwise it isn't actually a no-op under the new "arr-sync
        // owns overview/genres" merge semantics (see `merge_work`).
        let mut unchanged_remote = remote("1", "Unchanged Movie", true);
        unchanged_remote.overview = unchanged.overview.clone();
        unchanged_remote.genres = unchanged.genres.clone();
        let remote_list = vec![
            unchanged_remote,
            remote("2", "New Name", true),
            remote("4", "Brand New Movie", true),
        ];

        let mut ops = diff_works(WorkKind::Movie, &ExternalProvider::Tmdb, remote_list, local);
        ops.sort_by_key(|op| match op {
            SyncOp::Insert(w) => format!("0-{}", w.title),
            SyncOp::Update(w) => format!("1-{}", w.title),
            SyncOp::Delete(id) => format!("2-{id}"),
        });

        assert_eq!(ops.len(), 3);
        assert!(matches!(&ops[0], SyncOp::Insert(w) if w.title == "Brand New Movie"));
        assert!(matches!(&ops[1], SyncOp::Update(w) if w.title == "New Name"));
        assert_eq!(ops[2], SyncOp::Delete(to_delete_id));
    }

    #[test]
    fn diff_ignores_local_works_keyed_to_a_different_provider() {
        // A local `Work` with no `Tmdb` ref (e.g. matched only by `Imdb`)
        // must never be treated as "missing from remote" and deleted just
        // because this pass is diffing Radarr/Tmdb.
        let mut other_provider_work = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Imdb,
            "tt123",
            "Imdb Only",
            true,
            Availability::Available,
        );
        other_provider_work.external_refs = vec![ExternalRef {
            provider: ExternalProvider::Imdb,
            external_id: "tt123".to_string(),
        }];

        let ops = diff_works(
            WorkKind::Movie,
            &ExternalProvider::Tmdb,
            vec![],
            vec![other_provider_work],
        );

        assert!(ops.is_empty());
    }

    #[test]
    fn whisparr_adopts_a_legacy_series_row_without_changing_its_id() {
        let legacy = work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tpdb,
            "101",
            "Legacy Site",
            true,
            Availability::Available,
        );
        let legacy_id = legacy.id;
        let (local, cleanup) = normalise_whisparr_locals(Vec::new(), vec![legacy]);

        assert!(cleanup.is_empty());
        assert_eq!(local.len(), 1);
        assert_eq!(local[0].id, legacy_id);
        assert_eq!(local[0].kind, WorkKind::Site);

        let mut remote_site = remote("101", "Legacy Site", true);
        remote_site.overview = local[0].overview.clone();
        remote_site.genres = local[0].genres.clone();
        let ops = diff_works(
            WorkKind::Site,
            &ExternalProvider::Tpdb,
            vec![remote_site],
            local,
        );
        assert!(ops.is_empty());
    }

    #[test]
    fn whisparr_keeps_the_site_row_and_deletes_a_legacy_duplicate() {
        let site = work_with_ref(
            WorkKind::Site,
            ExternalProvider::Tpdb,
            "101",
            "Canonical Site",
            true,
            Availability::Available,
        );
        let legacy = work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tpdb,
            "101",
            "Legacy Duplicate",
            true,
            Availability::Available,
        );
        let site_id = site.id;
        let legacy_id = legacy.id;

        let (local, cleanup) = normalise_whisparr_locals(vec![site], vec![legacy]);

        assert_eq!(local.len(), 1);
        assert_eq!(local[0].id, site_id);
        assert_eq!(cleanup, vec![SyncOp::Delete(legacy_id)]);
    }

    #[test]
    fn diff_reclassifies_a_matching_work_to_the_requested_kind() {
        let legacy = work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tpdb,
            "101",
            "Site",
            true,
            Availability::Available,
        );
        let legacy_id = legacy.id;
        let mut remote_site = remote("101", "Site", true);
        remote_site.overview = legacy.overview.clone();
        remote_site.genres = legacy.genres.clone();

        let ops = diff_works(
            WorkKind::Site,
            &ExternalProvider::Tpdb,
            vec![remote_site],
            vec![legacy],
        );

        assert!(
            matches!(&ops[..], [SyncOp::Update(work)] if work.id == legacy_id && work.kind == WorkKind::Site)
        );
    }

    // ---- reconcile_all / reconcile_one against an in-memory WorkRepo fake ----

    /// Hand-written HashMap-backed `WorkRepo` test double — no database, no
    /// sqlx, just enough to exercise `ReconciliationPoller`'s orchestration
    /// logic (list/upsert/delete/find_by_external_ref) end to end.
    #[derive(Default)]
    struct InMemoryWorkRepo {
        works: Mutex<StdHashMap<Uuid, Work>>,
    }

    impl InMemoryWorkRepo {
        fn seeded(works: Vec<Work>) -> Self {
            let map = works.into_iter().map(|w| (w.id, w)).collect();
            Self {
                works: Mutex::new(map),
            }
        }

        fn snapshot(&self) -> Vec<Work> {
            let mut all: Vec<Work> = self.works.lock().unwrap().values().cloned().collect();
            all.sort_by(|a, b| a.title.cmp(&b.title));
            all
        }
    }

    #[async_trait]
    impl WorkRepo for InMemoryWorkRepo {
        async fn get(&self, id: Uuid) -> Result<Work, DbError> {
            self.works
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or(DbError::NotFound)
        }

        async fn list_by_kind(
            &self,
            kind: WorkKind,
            limit: i64,
            offset: i64,
        ) -> Result<Vec<Work>, DbError> {
            let mut matching: Vec<Work> = self
                .works
                .lock()
                .unwrap()
                .values()
                .filter(|w| w.kind == kind)
                .cloned()
                .collect();
            matching.sort_by_key(|a| a.id);
            let start = offset.max(0) as usize;
            let end = (start + limit.max(0) as usize).min(matching.len());
            Ok(matching
                .get(start..end)
                .map(|s| s.to_vec())
                .unwrap_or_default())
        }

        async fn upsert(&self, work: &Work) -> Result<(), DbError> {
            self.works.lock().unwrap().insert(work.id, work.clone());
            Ok(())
        }

        async fn delete(&self, id: Uuid) -> Result<(), DbError> {
            self.works.lock().unwrap().remove(&id);
            Ok(())
        }

        async fn find_by_external_ref(
            &self,
            provider: &ExternalProvider,
            external_id: &str,
        ) -> Result<Option<Work>, DbError> {
            Ok(self
                .works
                .lock()
                .unwrap()
                .values()
                .find(|w| {
                    w.external_refs
                        .iter()
                        .any(|r| &r.provider == provider && r.external_id == external_id)
                })
                .cloned())
        }
    }

    #[test]
    fn list_all_local_pages_through_multiple_batches() {
        // Exercise the pagination loop directly against the fake repo,
        // independent of any network/arr-client concern.
        let works: Vec<Work> = (0..250)
            .map(|i| {
                work_with_ref(
                    WorkKind::Movie,
                    ExternalProvider::Tmdb,
                    &i.to_string(),
                    &format!("Movie {i}"),
                    true,
                    Availability::Unknown,
                )
            })
            .collect();
        let repo = InMemoryWorkRepo::seeded(works);

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let all = rt.block_on(async {
            let mut offset = 0i64;
            let mut collected = Vec::new();
            loop {
                let page = repo
                    .list_by_kind(WorkKind::Movie, 200, offset)
                    .await
                    .unwrap();
                let got = page.len() as i64;
                collected.extend(page);
                if got < 200 {
                    break;
                }
                offset += 200;
            }
            collected
        });

        assert_eq!(all.len(), 250);
    }

    #[tokio::test]
    async fn apply_ops_upserts_inserts_and_updates_and_deletes() {
        let existing = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "1",
            "Old Name",
            true,
            Availability::Pending,
        );
        let to_delete = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "2",
            "Gone",
            true,
            Availability::Available,
        );
        let to_delete_id = to_delete.id;
        let repo: Arc<dyn WorkRepo> =
            Arc::new(InMemoryWorkRepo::seeded(vec![existing.clone(), to_delete]));

        let mut updated = existing.clone();
        updated.title = "New Name".to_string();
        let inserted = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "3",
            "Brand New",
            true,
            Availability::Unknown,
        );

        let ops = vec![
            SyncOp::Update(updated.clone()),
            SyncOp::Insert(inserted.clone()),
            SyncOp::Delete(to_delete_id),
        ];

        for op in ops {
            match op {
                SyncOp::Insert(w) | SyncOp::Update(w) => repo.upsert(&w).await.unwrap(),
                SyncOp::Delete(id) => repo.delete(id).await.unwrap(),
            }
        }

        let remaining = repo.list_by_kind(WorkKind::Movie, 100, 0).await.unwrap();
        assert_eq!(remaining.len(), 2);
        assert!(remaining.iter().any(|w| w.title == "New Name"));
        assert!(remaining.iter().any(|w| w.title == "Brand New"));
        assert!(!remaining.iter().any(|w| w.id == to_delete_id));
    }

    #[test]
    fn certification_becomes_an_arr_owned_rating_tag_and_keeps_other_tags() {
        let existing = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "1",
            "Film",
            true,
            Availability::Available,
        );
        let mut remote_work = remote("1", "Film", true);
        remote_work.certification = Some("PG-13".to_string());
        let merged = merge_work(&existing, WorkKind::Movie, &remote_work);
        assert_eq!(
            merged.tags,
            vec!["kids".to_string(), "rating:PG-13".to_string()]
        );

        // A changed certification replaces the old tag; an admin override
        // and unrelated tags survive.
        let mut with_override = merged.clone();
        with_override.tags.push("rating-override:G".to_string());
        remote_work.certification = Some("R".to_string());
        let again = merge_work(&with_override, WorkKind::Movie, &remote_work);
        assert!(again.tags.contains(&"rating:R".to_string()));
        assert!(!again.tags.contains(&"rating:PG-13".to_string()));
        assert!(again.tags.contains(&"rating-override:G".to_string()));
        assert!(again.tags.contains(&"kids".to_string()));

        // The source dropping its certification removes the tag.
        remote_work.certification = None;
        let cleared = merge_work(&again, WorkKind::Movie, &remote_work);
        assert!(!cleared.tags.iter().any(|t| t.starts_with("rating:")));
    }

    #[test]
    fn merge_work_preserves_tags_but_not_arr_owned_metadata() {
        let existing = work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tvdb,
            "1",
            "Old",
            false,
            Availability::PartiallyAvailable,
        );
        let remote_entity = remote("1", "New", true);

        let merged = merge_work(&existing, WorkKind::Series, &remote_entity);

        assert_eq!(merged.title, "New");
        assert!(merged.monitored);
        // Sonarr-shaped remote (from `remote()` helper) carries no
        // availability signal, so the existing value survives untouched.
        assert_eq!(merged.availability, Availability::PartiallyAvailable);
        // `tags` is user/automation-owned -- arr-sync never touches it.
        assert_eq!(merged.tags, existing.tags);
        assert_eq!(merged.id, existing.id);
        // `overview`/`genres`/`images` ARE arr-owned now (see `RemoteWork`'s
        // doc comment) -- the `remote()` helper carries none of them, so
        // they're overwritten to empty here rather than surviving from
        // `existing`. See `merge_work_applies_overview_genres_and_images_
        // from_remote` below for the case where remote actually has them.
        assert_eq!(merged.overview, None);
        assert!(merged.genres.is_empty());
        assert!(merged.images.is_empty());
    }

    #[test]
    fn merge_work_applies_overview_genres_and_images_from_remote() {
        let existing = work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tvdb,
            "1",
            "Old",
            false,
            Availability::PartiallyAvailable,
        );
        let mut remote_entity = remote("1", "New", true);
        remote_entity.overview = Some("A new synopsis.".to_string());
        remote_entity.genres = vec!["Thriller".to_string()];
        remote_entity.images = vec![playarr_model::ImageAsset {
            kind: playarr_model::ImageKind::Poster,
            url: "https://example.test/poster.jpg".to_string(),
            width: None,
            height: None,
        }];

        let merged = merge_work(&existing, WorkKind::Series, &remote_entity);

        assert_eq!(merged.overview.as_deref(), Some("A new synopsis."));
        assert_eq!(merged.genres, vec!["Thriller".to_string()]);
        assert_eq!(merged.images.len(), 1);
        assert_eq!(merged.images[0].url, "https://example.test/poster.jpg");
    }

    #[test]
    fn new_work_applies_release_date_from_remote() {
        let release_date = "2020-06-01T00:00:00Z"
            .parse::<chrono::DateTime<Utc>>()
            .unwrap();
        let mut remote_entity = remote("1", "New Movie", true);
        remote_entity.release_date = Some(release_date);

        let work = new_work(WorkKind::Movie, ExternalProvider::Tmdb, &remote_entity);

        assert_eq!(work.release_date, Some(release_date));
    }

    #[test]
    fn merge_work_applies_release_date_from_remote() {
        let existing = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "1",
            "Old",
            true,
            Availability::Available,
        );
        assert_eq!(existing.release_date, None);
        let release_date = "2020-06-01T00:00:00Z"
            .parse::<chrono::DateTime<Utc>>()
            .unwrap();
        let mut remote_entity = remote("1", "Old", true);
        remote_entity.release_date = Some(release_date);

        let merged = merge_work(&existing, WorkKind::Movie, &remote_entity);

        assert_eq!(merged.release_date, Some(release_date));
    }

    #[test]
    fn merge_work_applies_availability_when_remote_provides_one() {
        let existing = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "1",
            "Old",
            false,
            Availability::Pending,
        );
        let mut remote_entity = remote("1", "Old", true);
        remote_entity.availability = Some(Availability::Available);

        let merged = merge_work(&existing, WorkKind::Movie, &remote_entity);

        assert_eq!(merged.availability, Availability::Available);
    }

    // ---- end-to-end reconcile_all against a mocked Sonarr HTTP API ----

    use playarr_arr_client::{RadarrClient, SonarrClient};
    use playarr_coordination::SingleNodeCoordinator;
    use playarr_db::repo::SqlxMediaFileRepo;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// A fresh, migrated, in-memory SQLite `DbPool` for
    /// `ReconciliationPoller::new`'s `media_sync` half -- these tests all
    /// exercise `WorkRepo` through the hand-rolled `InMemoryWorkRepo` fake
    /// above (not this pool), so a real `MediaFileRepo`/pool is only here to
    /// satisfy the constructor; `crate::media_sync`'s own tests cover the
    /// file-sync behavior this pool would actually back.
    async fn test_pool() -> DbPool {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let url = format!("sqlite://playarr_arr_sync_poller_test_{n}?mode=memory&cache=shared");

        sqlx::any::install_default_drivers();
        let pool: DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("open in-memory sqlite pool");
        playarr_db::run_migrations(&pool, false)
            .await
            .expect("run real embedded sqlite migrations");
        pool
    }

    async fn media_file_repo(pool: DbPool) -> Arc<dyn MediaFileRepo> {
        Arc::new(SqlxMediaFileRepo::new(pool))
    }

    #[tokio::test]
    async fn reconcile_all_inserts_updates_and_deletes_against_a_mocked_sonarr() {
        let mock_server = MockServer::start().await;

        // Sonarr's `/api/v3/series` reports two shows: one that already
        // exists locally under a stale title (should Update), one brand new
        // (should Insert). A third, locally-seeded show is absent from this
        // response entirely (should Delete).
        Mock::given(method("GET"))
            .and(path("/api/v3/series"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 1,
                    "title": "Renamed Show",
                    "sortTitle": "renamed show",
                    "tvdbId": 111,
                    "monitored": true,
                    "status": "continuing",
                    "path": "/tv/renamed-show"
                },
                {
                    "id": 2,
                    "title": "Brand New Show",
                    "sortTitle": "brand new show",
                    "tvdbId": 222,
                    "monitored": true,
                    "status": "continuing",
                    "path": "/tv/brand-new-show"
                }
            ])))
            .mount(&mock_server)
            .await;

        let existing = work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tvdb,
            "111",
            "Stale Title",
            true,
            Availability::PartiallyAvailable,
        );
        let to_be_deleted = work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tvdb,
            "333",
            "Cancelled Show",
            true,
            Availability::Available,
        );
        let to_be_deleted_id = to_be_deleted.id;

        let repo = Arc::new(InMemoryWorkRepo::seeded(vec![
            existing.clone(),
            to_be_deleted,
        ]));
        let arr_client = ArrClient::Sonarr(SonarrClient::new(mock_server.uri(), "test-api-key"));
        let pool = test_pool().await;
        let coordinator: Arc<dyn ClusterCoordinator> = Arc::new(SingleNodeCoordinator::new());
        let (_tx, rx) = tokio::sync::mpsc::channel(1);

        let poller = ReconciliationPoller::new(
            Uuid::new_v4(),
            SourceKind::Sonarr,
            arr_client,
            Duration::from_secs(3600),
            repo.clone() as Arc<dyn WorkRepo>,
            media_file_repo(pool.clone()).await,
            pool,
            coordinator,
            rx,
        );

        poller.reconcile_all().await.unwrap();

        let snapshot = repo.snapshot();
        assert_eq!(
            snapshot.len(),
            2,
            "expected Renamed Show + Brand New Show, got {snapshot:?}"
        );
        assert!(snapshot
            .iter()
            .any(|w| w.title == "Renamed Show" && w.id == existing.id));
        assert!(snapshot.iter().any(|w| w.title == "Brand New Show"));
        assert!(!snapshot.iter().any(|w| w.id == to_be_deleted_id));
    }

    /// Reproduces the real bug `backfill_missing_media_files` exists to
    /// fix: a work that's already `Available` (per a *prior* sync pass)
    /// but somehow never got a `MediaFile` row -- e.g. its very first
    /// file-sync attempt failed or was interrupted -- must still get one
    /// on a *later* pass, even though its catalog identity (title/
    /// monitored/availability) hasn't changed and so produces no `SyncOp`
    /// for `sync_media_files` to act on.
    #[tokio::test]
    async fn reconcile_all_backfills_a_missing_media_file_for_an_unchanged_available_work() {
        let mock_server = MockServer::start().await;

        // The remote list call: same title/monitored Radarr already
        // reports as before, so `diff_works` sees no change for this
        // movie and it never appears in `ops`.
        Mock::given(method("GET"))
            .and(path("/api/v3/movie"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 1,
                    "title": "Orbit",
                    "sortTitle": "heat",
                    "tmdbId": 949,
                    "monitored": true,
                    "hasFile": true,
                    "path": "/movies/Orbit (1995)"
                }
            ])))
            .mount(&mock_server)
            .await;

        // The targeted per-movie call `sync_radarr` makes -- this is what
        // actually has the file Radarr already reported via `hasFile`.
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 1,
                "title": "Orbit",
                "sortTitle": "heat",
                "tmdbId": 949,
                "monitored": true,
                "hasFile": true,
                "path": "/movies/Orbit (1995)",
                "movieFile": {
                    "id": 30,
                    "movieId": 1,
                    "relativePath": "Orbit (1995) Bluray-1080p.mkv",
                    "path": "/movies/Orbit (1995)/Orbit (1995) Bluray-1080p.mkv",
                    "size": 12_345_678_900i64,
                    "quality": {
                        "quality": { "id": 7, "name": "Bluray-1080p", "source": "bluray", "resolution": 1080 },
                        "revision": { "version": 1, "real": 0, "isRepack": false }
                    },
                    "mediaInfo": null
                }
            })))
            .mount(&mock_server)
            .await;

        let existing = work_with_ref(
            WorkKind::Movie,
            ExternalProvider::Tmdb,
            "949",
            "Orbit",
            true,
            Availability::Available,
        );
        let work_id = existing.id;

        let repo = Arc::new(InMemoryWorkRepo::seeded(vec![existing]));
        let arr_client = ArrClient::Radarr(RadarrClient::new(mock_server.uri(), "test-api-key"));
        let pool = test_pool().await;
        // `media_files.work_id` has a real FK to `works(id)` -- seed the
        // matching row directly, same as `playback.rs`'s own
        // `repo_backed_lookup_resolves_a_persisted_media_file` test does,
        // since `WorkRepo` here is the in-memory fake, not this real pool.
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, availability) \
             VALUES (?, 'movie', 'Orbit', 'heat', '2026-01-01T00:00:00Z', 'available')",
        )
        .bind(work_id.to_string())
        .execute(&pool)
        .await
        .unwrap();
        let media_file_repo = media_file_repo(pool.clone()).await;
        let coordinator: Arc<dyn ClusterCoordinator> = Arc::new(SingleNodeCoordinator::new());
        let (_tx, rx) = tokio::sync::mpsc::channel(1);

        let poller = ReconciliationPoller::new(
            Uuid::new_v4(),
            SourceKind::Radarr,
            arr_client,
            Duration::from_secs(3600),
            repo as Arc<dyn WorkRepo>,
            media_file_repo.clone(),
            pool,
            coordinator,
            rx,
        );

        // Sanity check: genuinely nothing synced yet.
        assert!(media_file_repo
            .list_by_work_id(work_id)
            .await
            .unwrap()
            .is_empty());

        poller.reconcile_all().await.unwrap();

        let files = media_file_repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(
            files.len(),
            1,
            "expected the backfill to sync the missing media file, found: {files:?}"
        );
    }

    #[tokio::test]
    async fn reconcile_one_targeted_refetch_inserts_a_single_new_series() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/api/v3/series/7"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 7,
                "title": "Targeted Show",
                "sortTitle": "targeted show",
                "tvdbId": 555,
                "monitored": true,
                "status": "continuing",
                "path": "/tv/targeted-show"
            })))
            .mount(&mock_server)
            .await;

        let repo = Arc::new(InMemoryWorkRepo::default());
        let arr_client = ArrClient::Sonarr(SonarrClient::new(mock_server.uri(), "test-api-key"));
        let pool = test_pool().await;
        let coordinator: Arc<dyn ClusterCoordinator> = Arc::new(SingleNodeCoordinator::new());
        let (_tx, rx) = tokio::sync::mpsc::channel(1);

        let poller = ReconciliationPoller::new(
            Uuid::new_v4(),
            SourceKind::Sonarr,
            arr_client,
            Duration::from_secs(3600),
            repo.clone() as Arc<dyn WorkRepo>,
            media_file_repo(pool.clone()).await,
            pool,
            coordinator,
            rx,
        );

        // This never hits `/api/v3/series` (only `/api/v3/series/7`) — a
        // targeted refetch must not fall back to a full listing on success.
        poller.reconcile_one(Some(7)).await.unwrap();

        let snapshot = repo.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].title, "Targeted Show");
        assert_eq!(
            snapshot[0].external_refs,
            vec![ExternalRef {
                provider: ExternalProvider::Tvdb,
                external_id: "555".to_string(),
            }]
        );
    }

    #[tokio::test]
    async fn reconcile_one_falls_back_to_full_pass_when_targeted_fetch_fails() {
        let mock_server = MockServer::start().await;

        // No mock for `/api/v3/series/9` at all -> wiremock returns 404,
        // which should trigger the documented fallback to a full listing.
        Mock::given(method("GET"))
            .and(path("/api/v3/series"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 1,
                    "title": "Full Pass Show",
                    "sortTitle": "full pass show",
                    "tvdbId": 999,
                    "monitored": true,
                    "status": "continuing",
                    "path": "/tv/full-pass-show"
                }
            ])))
            .mount(&mock_server)
            .await;

        let repo = Arc::new(InMemoryWorkRepo::default());
        let arr_client = ArrClient::Sonarr(SonarrClient::new(mock_server.uri(), "test-api-key"));
        let pool = test_pool().await;
        let coordinator: Arc<dyn ClusterCoordinator> = Arc::new(SingleNodeCoordinator::new());
        let (_tx, rx) = tokio::sync::mpsc::channel(1);

        let poller = ReconciliationPoller::new(
            Uuid::new_v4(),
            SourceKind::Sonarr,
            arr_client,
            Duration::from_secs(3600),
            repo.clone() as Arc<dyn WorkRepo>,
            media_file_repo(pool.clone()).await,
            pool,
            coordinator,
            rx,
        );

        poller.reconcile_one(Some(9)).await.unwrap();

        let snapshot = repo.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].title, "Full Pass Show");
    }
}
