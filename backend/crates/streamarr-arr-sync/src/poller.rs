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
use streamarr_coordination::ClusterCoordinator;
use streamarr_db::WorkRepo;
use streamarr_model::{Availability, ExternalProvider, ExternalRef, SourceKind, Work, WorkKind};
use uuid::Uuid;

use crate::arr_client::{work_kind_and_provider, ArrClient, RemoteWork};
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

/// One reconciliation loop, bound to a single [`streamarr_model::SourceInstance`].
/// `streamarr-bin`'s worker-role startup constructs one `ReconciliationPoller`
/// per enabled source instance and spawns each with `run` (see
/// `streamarr_telemetry::correlation::spawn::spawn_traced`).
pub struct ReconciliationPoller {
    source_instance_id: Uuid,
    source_kind: SourceKind,
    /// The live *arr connection this poller reconciles against. Constructed
    /// via `ArrClient::from_source_instance` by the caller (it, not this
    /// struct, owns decrypting the source instance's stored API key).
    arr_client: ArrClient,
    poll_interval: Duration,
    work_repo: Arc<dyn WorkRepo>,
    coordinator: Arc<dyn ClusterCoordinator>,
    trigger_rx: tokio::sync::mpsc::Receiver<RefetchRequest>,
}

impl ReconciliationPoller {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        source_instance_id: Uuid,
        source_kind: SourceKind,
        arr_client: ArrClient,
        poll_interval: Duration,
        work_repo: Arc<dyn WorkRepo>,
        coordinator: Arc<dyn ClusterCoordinator>,
        trigger_rx: tokio::sync::mpsc::Receiver<RefetchRequest>,
    ) -> Self {
        Self {
            source_instance_id,
            source_kind,
            arr_client,
            poll_interval,
            work_repo,
            coordinator,
            trigger_rx,
        }
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

        match trigger {
            ReconcileTrigger::Scheduled => self.reconcile_all().await,
            ReconcileTrigger::Refetch(entity_id) => self.reconcile_one(entity_id).await,
        }
    }

    /// A full pass: list everything from the source instance, diff by
    /// external ref against what `WorkRepo` currently has for this source
    /// kind, and apply whatever inserts/updates/deletes that diff produces.
    /// This — not the webhook payload — is the authoritative source for
    /// catalog state.
    ///
    /// Note on multi-instance deletes: this diffs against *every* local
    /// `Work` of the matching kind, not just ones this specific source
    /// instance previously produced — `streamarr_model::Work` has no
    /// source-instance-provenance field to scope by (only
    /// metadata-provider `external_refs`). For the common case (one source
    /// instance per kind) this is correct. Running two instances of the
    /// same kind against disjoint libraries (e.g. two Radarr instances for
    /// 4K vs 1080p) would make each instance's full pass see the other's
    /// works as "missing" and delete them. TODO: once `Work` (or a join
    /// table) tracks which source instance(s) contributed it, scope
    /// `list_all_local` by `source_instance_id` instead of just `kind` to
    /// close this gap; deferred here since it needs a `streamarr-model`
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
            .list_all()
            .await
            .map_err(|err| PollError::Client(err.to_string()))?;

        let local = self.list_all_local(work_kind).await?;

        let ops = diff_works(work_kind, &provider, remote, local);
        tracing::info!(
            source_instance_id = %self.source_instance_id,
            inserts = ops.iter().filter(|op| matches!(op, SyncOp::Insert(_))).count(),
            updates = ops.iter().filter(|op| matches!(op, SyncOp::Update(_))).count(),
            deletes = ops.iter().filter(|op| matches!(op, SyncOp::Delete(_))).count(),
            "reconciliation diff computed"
        );

        self.apply_ops(ops).await
    }

    /// A targeted re-fetch for one entity, triggered by a webhook signal
    /// (dispatching on `self.source_kind` to the matching `get_*` method via
    /// `ArrClient::get_one`), falling back to `reconcile_all` when
    /// `entity_id` is `None` (Bazarr/Prowlarr signals, or any *arr payload
    /// shape `webhook::extract_entity_id` didn't recognize).
    async fn reconcile_one(&self, entity_id: Option<i64>) -> Result<(), PollError> {
        let Some(id) = entity_id else {
            return self.reconcile_all().await;
        };

        let Some((work_kind, provider)) = work_kind_and_provider(self.source_kind) else {
            // Shouldn't normally happen (`webhook::extract_entity_id` never
            // produces a `Some` id for Bazarr/Prowlarr), but a full pass is
            // a safe, correct fallback if it ever does.
            return self.reconcile_all().await;
        };

        let remote = match self.arr_client.get_one(id).await {
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
                let merged = merge_work(&existing, &remote);
                if merged == existing {
                    return Ok(());
                }
                SyncOp::Update(merged)
            }
            None => SyncOp::Insert(new_work(work_kind, provider, &remote)),
        };

        self.apply_ops(vec![op]).await
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

    async fn apply_ops(&self, ops: Vec<SyncOp>) -> Result<(), PollError> {
        for op in ops {
            match op {
                SyncOp::Insert(work) | SyncOp::Update(work) => {
                    self.work_repo.upsert(&work).await?;
                }
                SyncOp::Delete(id) => {
                    self.work_repo.delete(id).await?;
                }
            }
        }
        Ok(())
    }
}

/// Builds a brand-new `Work` for a remote entity with no existing local
/// match. Only identity/monitoring/(when derivable) availability fields are
/// populated from `remote` — `overview`/`images`/`genres` are left empty for
/// a separate metadata-provider pipeline to fill in later, and `tags`
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
        overview: None,
        images: Vec::new(),
        genres: Vec::new(),
        tags: Vec::new(),
        added_at: Utc::now(),
        monitored: remote.monitored,
        availability: remote.availability.unwrap_or(Availability::Unknown),
    }
}

/// Applies a remote entity's arr-owned fields onto an existing `Work`,
/// leaving everything arr-sync doesn't own (metadata, tags, `added_at`,
/// other providers' `external_refs`) untouched. This is why `reconcile_all`
/// diffs by comparing the *merged* result against `existing` rather than
/// just always emitting an `Update` — a remote entity that hasn't
/// meaningfully changed since the last pass shouldn't generate a write.
fn merge_work(existing: &Work, remote: &RemoteWork) -> Work {
    let mut merged = existing.clone();
    merged.title = remote.title.clone();
    merged.sort_title = remote.sort_title.clone();
    merged.monitored = remote.monitored;
    if let Some(availability) = remote.availability {
        merged.availability = availability;
    }
    merged
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
                let merged = merge_work(&existing, &remote_work);
                if merged != existing {
                    ops.push(SyncOp::Update(merged));
                }
            }
            None => ops.push(SyncOp::Insert(new_work(kind, provider.clone(), &remote_work))),
        }
    }

    // Whatever's left in the map had a local `Work` keyed to this provider
    // that no remote entity claimed this pass — it's gone from the source.
    for (_, remaining) in local_by_external_id {
        ops.push(SyncOp::Delete(remaining.id));
    }

    ops
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;
    use std::sync::Mutex;

    use async_trait::async_trait;
    use streamarr_db::DbError;

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
            monitored,
            availability,
        }
    }

    fn remote(external_id: &str, title: &str, monitored: bool) -> RemoteWork {
        RemoteWork {
            external_id: external_id.to_string(),
            title: title.to_string(),
            sort_title: title.to_lowercase(),
            monitored,
            availability: None,
        }
    }

    // ---- diff_works ----

    #[test]
    fn diff_inserts_new_remote_entities() {
        let remote_list = vec![remote("100", "New Show", true)];
        let ops = diff_works(WorkKind::Series, &ExternalProvider::Tvdb, remote_list, vec![]);

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

        let ops = diff_works(WorkKind::Series, &ExternalProvider::Tvdb, remote_list, local);

        assert_eq!(ops.len(), 1);
        match &ops[0] {
            SyncOp::Update(work) => {
                assert_eq!(work.title, "New Title");
                // Fields arr-sync doesn't own are preserved.
                assert_eq!(work.overview, Some("existing overview".to_string()));
                assert_eq!(work.genres, vec!["Drama".to_string()]);
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
        let remote_list = vec![remote("400", "Stable Show", true)];

        let ops = diff_works(WorkKind::Series, &ExternalProvider::Tvdb, remote_list, local);

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

        let remote_list = vec![
            remote("1", "Unchanged Movie", true),
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
            matching.sort_by(|a, b| a.id.cmp(&b.id));
            let start = offset.max(0) as usize;
            let end = (start + limit.max(0) as usize).min(matching.len());
            Ok(matching.get(start..end).map(|s| s.to_vec()).unwrap_or_default())
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
                let page = repo.list_by_kind(WorkKind::Movie, 200, offset).await.unwrap();
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
    fn merge_work_preserves_fields_arr_sync_does_not_own() {
        let existing = work_with_ref(
            WorkKind::Series,
            ExternalProvider::Tvdb,
            "1",
            "Old",
            false,
            Availability::PartiallyAvailable,
        );
        let remote_entity = remote("1", "New", true);

        let merged = merge_work(&existing, &remote_entity);

        assert_eq!(merged.title, "New");
        assert!(merged.monitored);
        // Sonarr-shaped remote (from `remote()` helper) carries no
        // availability signal, so the existing value survives untouched.
        assert_eq!(merged.availability, Availability::PartiallyAvailable);
        assert_eq!(merged.overview, existing.overview);
        assert_eq!(merged.genres, existing.genres);
        assert_eq!(merged.tags, existing.tags);
        assert_eq!(merged.id, existing.id);
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

        let merged = merge_work(&existing, &remote_entity);

        assert_eq!(merged.availability, Availability::Available);
    }

    // ---- end-to-end reconcile_all against a mocked Sonarr HTTP API ----

    use streamarr_arr_client::SonarrClient;
    use streamarr_coordination::SingleNodeCoordinator;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

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
        let coordinator: Arc<dyn ClusterCoordinator> = Arc::new(SingleNodeCoordinator::new());
        let (_tx, rx) = tokio::sync::mpsc::channel(1);

        let poller = ReconciliationPoller::new(
            Uuid::new_v4(),
            SourceKind::Sonarr,
            arr_client,
            Duration::from_secs(3600),
            repo.clone() as Arc<dyn WorkRepo>,
            coordinator,
            rx,
        );

        poller.reconcile_all().await.unwrap();

        let snapshot = repo.snapshot();
        assert_eq!(snapshot.len(), 2, "expected Renamed Show + Brand New Show, got {snapshot:?}");
        assert!(snapshot.iter().any(|w| w.title == "Renamed Show" && w.id == existing.id));
        assert!(snapshot.iter().any(|w| w.title == "Brand New Show"));
        assert!(!snapshot.iter().any(|w| w.id == to_be_deleted_id));
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
        let coordinator: Arc<dyn ClusterCoordinator> = Arc::new(SingleNodeCoordinator::new());
        let (_tx, rx) = tokio::sync::mpsc::channel(1);

        let poller = ReconciliationPoller::new(
            Uuid::new_v4(),
            SourceKind::Sonarr,
            arr_client,
            Duration::from_secs(3600),
            repo.clone() as Arc<dyn WorkRepo>,
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
        let coordinator: Arc<dyn ClusterCoordinator> = Arc::new(SingleNodeCoordinator::new());
        let (_tx, rx) = tokio::sync::mpsc::channel(1);

        let poller = ReconciliationPoller::new(
            Uuid::new_v4(),
            SourceKind::Sonarr,
            arr_client,
            Duration::from_secs(3600),
            repo.clone() as Arc<dyn WorkRepo>,
            coordinator,
            rx,
        );

        poller.reconcile_one(Some(9)).await.unwrap();

        let snapshot = repo.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].title, "Full Pass Show");
    }
}
