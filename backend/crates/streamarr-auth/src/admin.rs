//! Interim, pending-real-persistence admin resolution.
//!
//! There is no persisted `Policy`/`User` store anywhere in this workspace
//! yet (`streamarr_model::User::policy_id` anticipates one, but no
//! `PolicyRepo`/`UserRepo` exists -- see this crate's module doc comment
//! and `streamarr-requests`'s own persistence notes for the same situation
//! applied to `MediaRequest`). `crate::policy::PolicyEvaluator` judges a
//! real `Policy` once one exists; nothing yet loads one from anywhere, so
//! it has nothing to evaluate.
//!
//! [`InMemoryAdminRegistry`] is the deliberately small stand-in this pass
//! wires up instead: "is this user id an admin" is the one authorization
//! question `streamarr-api`'s request-approve/reject endpoints actually
//! need answered right now. It's a real, thread-safe, fully working
//! implementation -- not a mock -- mirroring `InMemoryRefreshTokenStore`/
//! `InMemoryDeviceAuthorizationStore`'s "in-memory is a legitimate choice
//! for a single-node deployment, pending real persistence" idiom elsewhere
//! in this crate (and `streamarr-requests::InMemoryRequestRepo`,
//! `streamarr-api::SourceInstanceRegistry`). It defaults every user id to
//! non-admin unless explicitly added, so a misconfiguration fails closed
//! (nobody can approve/reject anything) rather than open (everybody can).
//!
//! TODO(persistence): once a real `PolicyRepo`/`UserRepo` exists, replace
//! this with a real `Policy`-backed check (`Policy::is_admin`, evaluated
//! via `crate::policy::PolicyEvaluator` against the caller's actual
//! resolved policy) instead of a flat admin-id set. Nothing outside this
//! module (`streamarr-api`'s `AdminUser` extractor, and the composition
//! root that constructs one of these) should need to change shape when
//! that happens.

use dashmap::DashSet;
use uuid::Uuid;

/// A thread-safe, process-local set of admin user ids. Not a mock: every
/// method genuinely stores/checks membership, same as
/// `streamarr-api::SourceInstanceRegistry`'s "real in-memory store, not a
/// test double" idiom.
#[derive(Debug, Default)]
pub struct InMemoryAdminRegistry {
    admins: DashSet<Uuid>,
}

impl InMemoryAdminRegistry {
    /// Starts with no admins at all -- every `is_admin` check fails closed
    /// until [`Self::add`] is called.
    pub fn new() -> Self {
        Self::default()
    }

    /// Seeds the registry with `ids` up front -- the composition root's
    /// entry point for "this deployment's default admin user id(s)".
    pub fn from_ids(ids: impl IntoIterator<Item = Uuid>) -> Self {
        let registry = Self::default();
        for id in ids {
            registry.admins.insert(id);
        }
        registry
    }

    pub fn add(&self, user_id: Uuid) {
        self.admins.insert(user_id);
    }

    pub fn is_admin(&self, user_id: Uuid) -> bool {
        self.admins.contains(&user_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_user_is_not_admin_by_default() {
        let registry = InMemoryAdminRegistry::new();
        assert!(!registry.is_admin(Uuid::new_v4()));
    }

    #[test]
    fn explicitly_added_user_is_admin_and_others_are_not() {
        let registry = InMemoryAdminRegistry::new();
        let admin_id = Uuid::new_v4();
        registry.add(admin_id);

        assert!(registry.is_admin(admin_id));
        assert!(!registry.is_admin(Uuid::new_v4()));
    }

    #[test]
    fn from_ids_seeds_every_id_as_admin() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let registry = InMemoryAdminRegistry::from_ids([a, b]);

        assert!(registry.is_admin(a));
        assert!(registry.is_admin(b));
        assert!(!registry.is_admin(Uuid::new_v4()));
    }
}
