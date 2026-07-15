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
use streamarr_arr_sync::work_kind_and_provider;
use streamarr_model::{SourceInstance, WorkKind};
use streamarr_requests::{RequestError, SourceInstanceLookup};
use uuid::Uuid;

#[derive(Default)]
pub struct SourceInstanceRegistry {
    by_id: DashMap<Uuid, SourceInstance>,
}

impl SourceInstanceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn upsert(&self, instance: SourceInstance) {
        self.by_id.insert(instance.id, instance);
    }

    pub fn get(&self, id: Uuid) -> Option<SourceInstance> {
        self.by_id.get(&id).map(|entry| entry.clone())
    }

    /// Every configured instance, in no particular order — the set
    /// `streamarr-bin`'s worker boot sequence iterates to spawn one
    /// `ReconciliationPoller` per instance.
    pub fn all(&self) -> Vec<SourceInstance> {
        self.by_id.iter().map(|entry| entry.value().clone()).collect()
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
