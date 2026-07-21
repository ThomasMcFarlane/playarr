//! `SourceInstanceRegistry` — the admin-facing store of configured `*arr`
//! connections. Backs `admin.rs`'s create/list/delete/sync endpoints, the
//! webhook receiver's `instance_id -> SourceKind` lookup (`GET`ting a
//! [`SourceInstance`] by id rather than by kind), and `streamarr-bin`'s
//! worker boot sequence (which reconciliation pollers to spawn).
//!
//! This registry is a real, thread-safe, in-process store -- not a mock --
//! that starts empty and is populated via [`SourceInstanceRegistry::upsert`].
//! It is the fast in-memory read path only: the durable copy of the same
//! data lives behind `streamarr_db::SourceInstanceRepo`
//! (`AppState::source_instance_repo`), which every write in `admin.rs` goes
//! through *before* this registry, and which `streamarr-bin`'s `boot_api`
//! reads from to hydrate this registry on every boot -- so a registered
//! `*arr` connection survives a restart even though this type itself still
//! holds nothing durable. This registry also still exclusively owns the
//! per-poller trigger-sender bookkeeping ([`SyncTriggerError`]/
//! [`SourceInstanceRegistry::trigger_sync`]/
//! [`SourceInstanceRegistry::register_trigger`]), which is inherently
//! runtime-only (a live channel into a currently-running
//! `ReconciliationPoller`) and has no durable counterpart to hydrate from.

use std::sync::Arc;

use dashmap::DashMap;
use streamarr_arr_sync::{RefetchRequest, SyncRunStatus, SyncStatusReporter};
use streamarr_model::SourceInstance;
use uuid::Uuid;

/// Why [`SourceInstanceRegistry::trigger_sync`] couldn't ask a
/// `ReconciliationPoller` to sync right now.
#[derive(Debug, thiserror::Error)]
pub enum SyncTriggerError {
    #[error("no source instance registered with this id")]
    NotFound,
    /// The instance exists, but no poller has registered a trigger sender
    /// for it yet (e.g. it was registered less than ~10s ago and
    /// `streamarr-bin`'s worker supervisor loop hasn't spawned its
    /// `ReconciliationPoller` yet — see `boot_worker`'s doc comment in
    /// `backend/src/main.rs`), or the poller that owned that sender has
    /// since exited.
    #[error("no reconciliation poller is currently running for this source instance")]
    PollerNotRunning,
}

#[derive(Default)]
pub struct SourceInstanceRegistry {
    by_id: DashMap<Uuid, SourceInstance>,
    /// One sender per currently-running `ReconciliationPoller`, registered
    /// by `streamarr-bin`'s `spawn_poller_for` right after constructing
    /// each poller's trigger channel. This is what makes a manual "sync
    /// now" from the admin UI (`POST
    /// /api/v1/admin/source-instances/{id}/sync`) reach a real, live
    /// poller rather than just flipping a flag nothing reads -- the same
    /// channel `webhook.rs`'s `WebhookReceiver` fast-paths a targeted
    /// re-fetch through, reused here for an operator-initiated full
    /// re-fetch (`RefetchRequest { entity_id: None, .. }`, which
    /// `ReconciliationPoller::reconcile_one` falls back to `reconcile_all`
    /// for).
    trigger_senders: DashMap<Uuid, tokio::sync::mpsc::Sender<RefetchRequest>>,
    /// The most recent [`SyncRunStatus`] reported for each source instance
    /// -- this registry implements [`SyncStatusReporter`] itself (see
    /// below) so `streamarr-bin`'s `spawn_poller_for` can hand a
    /// `ReconciliationPoller` this same `Arc<SourceInstanceRegistry>`
    /// (already threaded through that call site) as its status sink,
    /// without a new type or a new piece of wiring. Backs the admin
    /// "Tasks" screen (`GET /api/v1/admin/source-instances/{id}/sync-
    /// status`) -- purely in-memory/runtime, like `trigger_senders`: it
    /// resets on restart, same as "is a poller currently running for this
    /// instance" does.
    sync_status: DashMap<Uuid, SyncRunStatus>,
}

impl SourceInstanceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn upsert(&self, instance: SourceInstance) {
        self.by_id.insert(instance.id, instance);
    }

    /// Removes a registered instance, if present. `arr-sync` simply stops
    /// polling it on its next reconciliation tick -- already-imported
    /// catalog data from it is untouched (there is no cascading delete).
    pub fn remove(&self, id: Uuid) -> Option<SourceInstance> {
        self.trigger_senders.remove(&id);
        self.by_id.remove(&id).map(|(_, instance)| instance)
    }

    /// Registers the trigger-sender half of a freshly-spawned
    /// `ReconciliationPoller`'s channel, so `trigger_sync` can reach it
    /// later. Called exactly once per poller spawn, by
    /// `streamarr-bin::spawn_poller_for`.
    pub fn register_trigger(&self, id: Uuid, sender: tokio::sync::mpsc::Sender<RefetchRequest>) {
        self.trigger_senders.insert(id, sender);
    }

    /// Asks the running `ReconciliationPoller` for `id` to do an immediate
    /// full reconciliation pass, out of band from its normal interval --
    /// the backing action for a "Sync now" button. Fire-and-forget: this
    /// only confirms the request was *handed to* the poller, not that the
    /// resulting sync has finished (mirrors the poller's own scheduled-tick
    /// path, which is also fire-and-forget from every other caller's
    /// perspective).
    pub fn trigger_sync(&self, id: Uuid) -> Result<(), SyncTriggerError> {
        let instance = self.by_id.get(&id).ok_or(SyncTriggerError::NotFound)?;
        let sender = self
            .trigger_senders
            .get(&id)
            .ok_or(SyncTriggerError::PollerNotRunning)?;
        sender
            .try_send(RefetchRequest {
                source_instance_id: id,
                source_kind: instance.kind,
                entity_id: None,
                event_type: "manual-sync".to_string(),
            })
            .map_err(|_| SyncTriggerError::PollerNotRunning)
    }

    pub fn get(&self, id: Uuid) -> Option<SourceInstance> {
        self.by_id.get(&id).map(|entry| entry.clone())
    }

    /// Every configured instance, in no particular order — the set
    /// `streamarr-bin`'s worker boot sequence iterates to spawn one
    /// `ReconciliationPoller` per instance.
    pub fn all(&self) -> Vec<SourceInstance> {
        self.by_id
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// The most recently reported [`SyncRunStatus`] for `id`, if any poller
    /// has reported one yet (nothing until its first reconciliation pass
    /// starts -- there is no synthetic "Idle" state).
    pub fn sync_status(&self, id: Uuid) -> Option<SyncRunStatus> {
        self.sync_status.get(&id).map(|entry| entry.clone())
    }

    /// Every instance's last-known sync status, paired with the instance
    /// itself -- backs the admin "Tasks" screen's one-shot "show me
    /// everything" list rather than a per-instance round trip each.
    pub fn all_sync_statuses(&self) -> Vec<(SourceInstance, Option<SyncRunStatus>)> {
        self.by_id
            .iter()
            .map(|entry| {
                let status = self.sync_status(*entry.key());
                (entry.value().clone(), status)
            })
            .collect()
    }

    /// Every local [`SourceInstance`] id whose `group_library_id` is one of
    /// `group_library_ids` -- resolves a `Policy::group_library_allow` grant
    /// (a group-wide, portable identity minted once across a whole peer
    /// group, `docs/architecture/peer-groups.md` §5.1) down to the
    /// node-local `SourceInstance` ids it actually maps to on *this* node,
    /// the same currency `Policy::library_allow`/`ensure_library_allowed`
    /// already enforce access in. An instance with no `group_library_id`
    /// set (not part of any cross-node grouping) never matches. `Vec::new()`
    /// without scanning the registry when `group_library_ids` is empty --
    /// the common case for a single, ungrouped node.
    pub fn source_instance_ids_for_group_libraries(&self, group_library_ids: &[Uuid]) -> Vec<Uuid> {
        if group_library_ids.is_empty() {
            return Vec::new();
        }
        self.by_id
            .iter()
            .filter(|entry| {
                entry
                    .value()
                    .group_library_id
                    .is_some_and(|id| group_library_ids.contains(&id))
            })
            .map(|entry| *entry.key())
            .collect()
    }

    /// The forward direction of [`Self::source_instance_ids_for_group_libraries`]
    /// above (that resolves a *portable* `GroupLibrary` grant down to the
    /// local `SourceInstance` ids it maps to on this node; this resolves a
    /// *local* `SourceInstance` selection up to the portable `GroupLibrary`
    /// ids it maps to) -- every distinct `group_library_id` among
    /// `source_instance_ids`. Used at invite-issuance time
    /// (`docs/architecture/peer-groups.md` §2.5/§6.2) to derive
    /// `UserInvite::group_library_allow`/`UserInviteRequest::
    /// group_library_allow` from the same admin-selected `library_allow`
    /// set, so an invite issued against a grouped library still grants
    /// correctly on whichever peer redeems it. An id with no locally
    /// registered `SourceInstance`, or a registered one with no
    /// `group_library_id` set (not part of any cross-node grouping), simply
    /// contributes nothing. `Vec::new()` without scanning the registry when
    /// `source_instance_ids` is empty -- the common case for a single,
    /// ungrouped node.
    pub fn group_library_ids_for_source_instances(&self, source_instance_ids: &[Uuid]) -> Vec<Uuid> {
        if source_instance_ids.is_empty() {
            return Vec::new();
        }
        let mut group_library_ids: Vec<Uuid> = self
            .by_id
            .iter()
            .filter(|entry| source_instance_ids.contains(entry.key()))
            .filter_map(|entry| entry.value().group_library_id)
            .collect();
        group_library_ids.sort();
        group_library_ids.dedup();
        group_library_ids
    }
}

impl SyncStatusReporter for SourceInstanceRegistry {
    fn report(&self, source_instance_id: Uuid, status: SyncRunStatus) {
        self.sync_status.insert(source_instance_id, status);
    }
}

pub type SharedSourceInstanceRegistry = Arc<SourceInstanceRegistry>;

#[cfg(test)]
mod tests {
    use super::*;
    use streamarr_model::{Sensitive, SourceKind};

    fn instance(kind: SourceKind) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind,
            name: format!("{kind:?}"),
            base_url: "http://localhost".to_string(),
            api_key_encrypted: Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: Some("/data".to_string()),
            default_quality_profile_id: Some(1),
            best_effort: false,
            group_library_id: None,
        }
    }

    #[test]
    fn trigger_sync_reports_not_found_for_unknown_instance() {
        let registry = SourceInstanceRegistry::new();
        assert!(matches!(
            registry.trigger_sync(Uuid::new_v4()),
            Err(SyncTriggerError::NotFound)
        ));
    }

    #[test]
    fn trigger_sync_reports_poller_not_running_before_a_poller_registers() {
        let registry = SourceInstanceRegistry::new();
        let radarr = instance(SourceKind::Radarr);
        registry.upsert(radarr.clone());

        assert!(matches!(
            registry.trigger_sync(radarr.id),
            Err(SyncTriggerError::PollerNotRunning)
        ));
    }

    #[tokio::test]
    async fn trigger_sync_reaches_a_registered_poller() {
        let registry = SourceInstanceRegistry::new();
        let radarr = instance(SourceKind::Radarr);
        registry.upsert(radarr.clone());

        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        registry.register_trigger(radarr.id, tx);

        registry.trigger_sync(radarr.id).unwrap();

        let request = rx
            .recv()
            .await
            .expect("trigger_sync should have sent a request");
        assert_eq!(request.source_instance_id, radarr.id);
        assert_eq!(request.entity_id, None);
    }

    #[test]
    fn removing_an_instance_also_drops_its_trigger_sender() {
        let registry = SourceInstanceRegistry::new();
        let radarr = instance(SourceKind::Radarr);
        registry.upsert(radarr.clone());
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        registry.register_trigger(radarr.id, tx);

        registry.remove(radarr.id);

        assert!(matches!(
            registry.trigger_sync(radarr.id),
            Err(SyncTriggerError::NotFound)
        ));
    }

    #[test]
    fn get_by_id_round_trips() {
        let registry = SourceInstanceRegistry::new();
        let instance = instance(SourceKind::Radarr);
        registry.upsert(instance.clone());
        assert_eq!(registry.get(instance.id).map(|i| i.id), Some(instance.id));
        assert_eq!(registry.get(Uuid::new_v4()), None);
    }

    #[test]
    fn source_instance_ids_for_group_libraries_matches_only_mapped_instances() {
        let registry = SourceInstanceRegistry::new();
        let group_a = Uuid::new_v4();
        let group_b = Uuid::new_v4();

        let mut in_group_a = instance(SourceKind::Radarr);
        in_group_a.group_library_id = Some(group_a);
        let mut in_group_b = instance(SourceKind::Sonarr);
        in_group_b.group_library_id = Some(group_b);
        let ungrouped = instance(SourceKind::Lidarr);

        registry.upsert(in_group_a.clone());
        registry.upsert(in_group_b.clone());
        registry.upsert(ungrouped.clone());

        let matched = registry.source_instance_ids_for_group_libraries(&[group_a]);
        assert_eq!(matched, vec![in_group_a.id]);
    }

    #[test]
    fn source_instance_ids_for_group_libraries_empty_input_returns_empty_without_scanning() {
        let registry = SourceInstanceRegistry::new();
        let mut mapped = instance(SourceKind::Radarr);
        mapped.group_library_id = Some(Uuid::new_v4());
        registry.upsert(mapped);

        assert!(registry
            .source_instance_ids_for_group_libraries(&[])
            .is_empty());
    }

    #[test]
    fn group_library_ids_for_source_instances_matches_only_selected_instances() {
        let registry = SourceInstanceRegistry::new();
        let group_a = Uuid::new_v4();
        let group_b = Uuid::new_v4();

        let mut in_group_a = instance(SourceKind::Radarr);
        in_group_a.group_library_id = Some(group_a);
        let mut in_group_b = instance(SourceKind::Sonarr);
        in_group_b.group_library_id = Some(group_b);
        let ungrouped = instance(SourceKind::Lidarr);

        registry.upsert(in_group_a.clone());
        registry.upsert(in_group_b.clone());
        registry.upsert(ungrouped.clone());

        // Only `in_group_a` is in the selection, and only its
        // `group_library_id` should come back -- `in_group_b`'s is a real
        // grant, but it wasn't among the admin-selected `library_allow`
        // ids, and `ungrouped` has no `group_library_id` to contribute
        // regardless.
        let matched =
            registry.group_library_ids_for_source_instances(&[in_group_a.id, ungrouped.id]);
        assert_eq!(matched, vec![group_a]);
    }

    #[test]
    fn group_library_ids_for_source_instances_dedupes_a_shared_group() {
        let registry = SourceInstanceRegistry::new();
        let shared_group = Uuid::new_v4();

        let mut first = instance(SourceKind::Radarr);
        first.group_library_id = Some(shared_group);
        let mut second = instance(SourceKind::Sonarr);
        second.group_library_id = Some(shared_group);

        registry.upsert(first.clone());
        registry.upsert(second.clone());

        let matched = registry.group_library_ids_for_source_instances(&[first.id, second.id]);
        assert_eq!(matched, vec![shared_group]);
    }

    #[test]
    fn group_library_ids_for_source_instances_empty_input_returns_empty_without_scanning() {
        let registry = SourceInstanceRegistry::new();
        let mut mapped = instance(SourceKind::Radarr);
        mapped.group_library_id = Some(Uuid::new_v4());
        registry.upsert(mapped);

        assert!(registry
            .group_library_ids_for_source_instances(&[])
            .is_empty());
    }
}
