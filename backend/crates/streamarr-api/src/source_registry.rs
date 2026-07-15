//! `SourceInstanceRegistry` — the composition root's implementation of the
//! [`streamarr_requests::SourceInstanceLookup`] seam that crate's own docs
//! call out as intentionally not owned by any crate yet ("the API/worker
//! composition root injects a real implementation once instance
//! configuration has a home"). It also backs the webhook receiver's
//! `instance_id -> SourceKind` lookup (`GET`ting a [`SourceInstance`] by id
//! rather than by kind).
//!
//! There is genuinely no persistence for [`SourceInstance`] configuration
//! anywhere in the workspace yet -- it isn't one of `streamarr-db`'s repo
//! traits, and no admin-config crate owns it either (same gap
//! `streamarr-requests`'s own doc comment describes). This registry is a
//! real, thread-safe, in-process store -- not a mock -- that starts empty
//! and is populated via [`SourceInstanceRegistry::upsert`]; a follow-up pass
//! that adds a `SourceInstanceRepo`/admin API can populate this from
//! storage at startup (or replace it outright) without changing anything
//! that depends on the [`streamarr_requests::SourceInstanceLookup`] trait.
//! TODO(persistence): see above -- wiring `streamarr-bin` to hydrate this
//! from configuration/an admin API is deferred, not the lookup contract
//! itself.

use std::sync::Arc;

use async_trait::async_trait;
use dashmap::DashMap;
use streamarr_arr_sync::{work_kind_and_provider, RefetchRequest};
use streamarr_model::{SourceInstance, WorkKind};
use streamarr_requests::{RequestError, SourceInstanceLookup};
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
}

#[async_trait]
impl SourceInstanceLookup for SourceInstanceRegistry {
    async fn instances_for(&self, kind: WorkKind) -> Result<Vec<SourceInstance>, RequestError> {
        Ok(self
            .by_id
            .iter()
            .filter(|entry| {
                work_kind_and_provider(entry.kind)
                    .map(|(work_kind, _)| work_kind == kind)
                    .unwrap_or(false)
            })
            .map(|entry| entry.value().clone())
            .collect())
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
            enabled_for_requests: true,
            best_effort: false,
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

    #[tokio::test]
    async fn instances_for_filters_by_work_kind() {
        let registry = SourceInstanceRegistry::new();
        let radarr = instance(SourceKind::Radarr);
        let sonarr = instance(SourceKind::Sonarr);
        let prowlarr = instance(SourceKind::Prowlarr);
        registry.upsert(radarr.clone());
        registry.upsert(sonarr);
        registry.upsert(prowlarr);

        let movies = registry.instances_for(WorkKind::Movie).await.unwrap();
        assert_eq!(movies.len(), 1);
        assert_eq!(movies[0].id, radarr.id);
    }

    #[test]
    fn get_by_id_round_trips() {
        let registry = SourceInstanceRegistry::new();
        let instance = instance(SourceKind::Radarr);
        registry.upsert(instance.clone());
        assert_eq!(registry.get(instance.id).map(|i| i.id), Some(instance.id));
        assert_eq!(registry.get(Uuid::new_v4()), None);
    }
}
