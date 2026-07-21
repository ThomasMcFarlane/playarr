//! Client-side join flow -- `docs/architecture/peer-groups.md` §3.4 steps
//! 3-5 (steps 1-2 are the admin-driven `PUT .../peer-nodes/self` /
//! `POST .../peer-groups/join` calls that trigger this; step 6 onward is
//! [`crate::membership_sync`]).
//!
//! [`EnrollRequest`]/[`EnrollResponse`] mirror `streamarr-api::peer::
//! EnrollRequest`/`EnrollResponse` field-for-field (the same wire shape),
//! but are deliberately independent types rather than shared code: this
//! crate must not depend on `streamarr-api` (see `crate::lib`'s own module
//! doc comment on the dependency direction), and `streamarr-api`'s versions
//! carry a `utoipa::ToSchema` derive this crate has no reason to depend on
//! `utoipa` for. Both sides agree on the JSON shape, which is what actually
//! matters for interop.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use streamarr_db::{NodeIdentityRepo, PeerGroupRepo, PeerNodeRepo};
use streamarr_model::{NodeIdentity, PeerAddress, PeerGroup, PeerNode};
use uuid::Uuid;

use crate::peer_client::{PeerClient, PeerClientError};

/// Wire shape of `POST /api/v1/peer/enroll`'s request body -- exactly
/// `docs/architecture/peer-groups.md` §3.4 step 3's `{join_token, peer_id,
/// name, addresses, public_key}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollRequest {
    pub join_token: String,
    pub peer_id: Uuid,
    pub name: String,
    #[serde(default)]
    pub addresses: Vec<PeerAddress>,
    pub public_key: String,
}

/// Wire shape of `POST /api/v1/peer/enroll`'s response body -- exactly
/// §3.4 step 4's `{group, members}`, where `members` is the seed node's
/// **full** current membership.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollResponse {
    pub group: PeerGroup,
    pub members: Vec<PeerNode>,
}

#[derive(Debug, thiserror::Error)]
pub enum JoinGroupError {
    #[error("no bootstrap address was provided")]
    NoBootstrapAddresses,
    #[error("every bootstrap address rejected the join: {0}")]
    AllAddressesFailed(PeerClientError),
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
}

/// Drives §3.4 steps 3-5 end to end: calls `POST /api/v1/peer/enroll` on
/// each of `bootstrap_addresses` in order until one connects (today, that's
/// just the operator-supplied `seed_address`; trying more than one only
/// matters once this node already knows more than one way to reach the
/// seed -- see the design doc's own note on this being "the first
/// appearance of the multi-address-fallback pattern §7 later builds for
/// clients"), then persists the result into this node's own `node_identity`
/// (`group_id`) and `peer_nodes` (every member the seed node reported,
/// including itself, with `is_self` corrected to reflect *this* node's own
/// perspective rather than trusting the seed's claim).
///
/// `identity` must already carry this node's durable `peer_id` (i.e.
/// callers have already run the admin-driven "mint a keypair on first use"
/// step -- `streamarr-api::admin_peer::ensure_node_identity` today) and
/// must not yet have a `group_id`; this function does not itself guard
/// against calling it twice -- callers own that check (`admin_peer.rs`'s
/// `already_grouped` guard, checked before this is ever invoked).
#[allow(clippy::too_many_arguments)]
pub async fn join_group(
    peer_client: &PeerClient,
    node_identity_repo: &Arc<dyn NodeIdentityRepo>,
    peer_group_repo: &Arc<dyn PeerGroupRepo>,
    peer_node_repo: &Arc<dyn PeerNodeRepo>,
    bootstrap_addresses: &[String],
    join_token: String,
    name: String,
    addresses: Vec<PeerAddress>,
    mut identity: NodeIdentity,
) -> Result<EnrollResponse, JoinGroupError> {
    if bootstrap_addresses.is_empty() {
        return Err(JoinGroupError::NoBootstrapAddresses);
    }

    let request = EnrollRequest {
        join_token,
        peer_id: peer_client.identity().peer_id,
        name,
        addresses,
        public_key: peer_client.identity().public_key_b64(),
    };

    let mut last_err: Option<PeerClientError> = None;
    let mut enrolled: Option<EnrollResponse> = None;
    for bootstrap_address in bootstrap_addresses {
        match peer_client
            .enroll::<EnrollRequest, EnrollResponse>(bootstrap_address, &request)
            .await
        {
            Ok(response) => {
                enrolled = Some(response);
                break;
            }
            Err(err) => {
                tracing::warn!(
                    address = %bootstrap_address,
                    error = %err,
                    "join attempt against this bootstrap address failed; trying the next one"
                );
                last_err = Some(err);
            }
        }
    }
    let enrolled = match enrolled {
        Some(enrolled) => enrolled,
        None => {
            return Err(JoinGroupError::AllAddressesFailed(
                last_err.expect("the loop above ran at least once since bootstrap_addresses is non-empty"),
            ))
        }
    };

    // `peer_nodes.group_id` is a real `REFERENCES peer_groups (id)` foreign
    // key -- this node's own database needs its own copy of the `PeerGroup`
    // row before any `peer_node_repo.upsert` below can succeed. Re-running a
    // failed/retried join is safe: only create it if this node doesn't
    // already have a local copy (idempotent by group identity, same as
    // `admin_peer::join_peer_group_handler`'s original inline version of
    // this same logic).
    if peer_group_repo.get(enrolled.group.id).await?.is_none() {
        peer_group_repo.create(&enrolled.group).await?;
    }

    identity.group_id = Some(enrolled.group.id);
    node_identity_repo.put(&identity).await?;

    for mut member in enrolled.members.clone() {
        member.is_self = member.id == identity.peer_id;
        peer_node_repo.upsert(&member).await?;
    }

    tracing::info!(
        group_id = %enrolled.group.id,
        peer_id = %identity.peer_id,
        "joined peer group"
    );
    Ok(enrolled)
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use chrono::Utc;
    use streamarr_model::PeerNodeStatus;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::signing::PeerIdentity;

    fn identity_and_client() -> (Uuid, PeerClient) {
        let peer_id = Uuid::new_v4();
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode([11u8; 32]);
        let identity = PeerIdentity::from_seed_b64(peer_id, &seed_b64).unwrap();
        (peer_id, PeerClient::new(reqwest::Client::new(), identity))
    }

    fn node_identity(peer_id: Uuid) -> NodeIdentity {
        NodeIdentity {
            peer_id,
            private_key: streamarr_model::Sensitive::new("unused-in-this-test".to_string()),
            group_id: None,
            created_at: Utc::now(),
        }
    }

    fn peer_node(id: Uuid, group_id: Uuid, name: &str, is_self: bool) -> PeerNode {
        let now = Utc::now();
        PeerNode {
            id,
            group_id,
            name: name.to_string(),
            addresses: vec![],
            public_key: "pubkey".to_string(),
            is_self,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        }
    }

    async fn repos() -> (
        Arc<dyn NodeIdentityRepo>,
        Arc<dyn PeerGroupRepo>,
        Arc<dyn PeerNodeRepo>,
        streamarr_db::DbPool,
    ) {
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        streamarr_db::run_migrations(&pool, false).await.unwrap();
        (
            Arc::new(streamarr_db::repo::SqlxNodeIdentityRepo::new(pool.clone())),
            Arc::new(streamarr_db::repo::SqlxPeerGroupRepo::new(pool.clone())),
            Arc::new(streamarr_db::repo::SqlxPeerNodeRepo::new(pool.clone())),
            pool,
        )
    }

    #[tokio::test]
    async fn joining_persists_group_and_marks_only_this_node_as_self() {
        let mock = MockServer::start().await;
        let (peer_id, client) = identity_and_client();
        let (node_identity_repo, peer_group_repo, peer_node_repo, _pool) = repos().await;

        let group = PeerGroup {
            id: Uuid::new_v4(),
            name: "Home Group".to_string(),
            created_at: Utc::now(),
        };
        let seed_self = peer_node(Uuid::new_v4(), group.id, "home", true);
        let group_for_mock = group.clone();
        let seed_self_for_mock = seed_self.clone();
        Mock::given(method("POST"))
            .and(path("/api/v1/peer/enroll"))
            .respond_with(move |request: &wiremock::Request| {
                let received: EnrollRequest = request.body_json().unwrap();
                let member = peer_node(received.peer_id, group_for_mock.id, &received.name, false);
                ResponseTemplate::new(200).set_body_json(EnrollResponse {
                    group: group_for_mock.clone(),
                    members: vec![seed_self_for_mock.clone(), member],
                })
            })
            .mount(&mock)
            .await;

        let enrolled = join_group(
            &client,
            &node_identity_repo,
            &peer_group_repo,
            &peer_node_repo,
            &[mock.uri()],
            "join-token".to_string(),
            "east".to_string(),
            vec![],
            node_identity(peer_id),
        )
        .await
        .expect("join succeeds");

        assert_eq!(enrolled.group.id, group.id);

        let identity = node_identity_repo.get().await.unwrap().unwrap();
        assert_eq!(identity.group_id, Some(group.id));

        let members = peer_node_repo.list_all().await.unwrap();
        assert_eq!(members.len(), 2);
        let self_row = members.iter().find(|m| m.id == peer_id).unwrap();
        assert!(self_row.is_self, "this node's own row must be is_self=true locally");
        let seed_row = members.iter().find(|m| m.id != peer_id).unwrap();
        assert!(
            !seed_row.is_self,
            "the seed node's row must NOT be is_self locally, regardless of what it claimed"
        );
    }

    #[tokio::test]
    async fn falls_back_to_the_second_bootstrap_address_when_the_first_is_unreachable() {
        let mock = MockServer::start().await;
        let (peer_id, client) = identity_and_client();
        let (node_identity_repo, peer_group_repo, peer_node_repo, _pool) = repos().await;

        let group = PeerGroup {
            id: Uuid::new_v4(),
            name: "Home Group".to_string(),
            created_at: Utc::now(),
        };
        let self_node = peer_node(Uuid::new_v4(), group.id, "home", true);
        Mock::given(method("POST"))
            .and(path("/api/v1/peer/enroll"))
            .respond_with(ResponseTemplate::new(200).set_body_json(EnrollResponse {
                group: group.clone(),
                members: vec![self_node.clone()],
            }))
            .mount(&mock)
            .await;

        let enrolled = join_group(
            &client,
            &node_identity_repo,
            &peer_group_repo,
            &peer_node_repo,
            &["http://127.0.0.1:1".to_string(), mock.uri()],
            "join-token".to_string(),
            "east".to_string(),
            vec![],
            node_identity(peer_id),
        )
        .await
        .expect("join succeeds via the second address");
        assert_eq!(enrolled.group.id, group.id);
    }

    #[tokio::test]
    async fn every_address_failing_surfaces_the_last_error() {
        let (peer_id, client) = identity_and_client();
        let (node_identity_repo, peer_group_repo, peer_node_repo, _pool) = repos().await;

        let result = join_group(
            &client,
            &node_identity_repo,
            &peer_group_repo,
            &peer_node_repo,
            &["http://127.0.0.1:1".to_string()],
            "join-token".to_string(),
            "east".to_string(),
            vec![],
            node_identity(peer_id),
        )
        .await;
        assert!(matches!(result, Err(JoinGroupError::AllAddressesFailed(_))));
    }

    #[tokio::test]
    async fn no_bootstrap_addresses_is_a_dedicated_error() {
        let (peer_id, client) = identity_and_client();
        let (node_identity_repo, peer_group_repo, peer_node_repo, _pool) = repos().await;

        let result = join_group(
            &client,
            &node_identity_repo,
            &peer_group_repo,
            &peer_node_repo,
            &[],
            "join-token".to_string(),
            "east".to_string(),
            vec![],
            node_identity(peer_id),
        )
        .await;
        assert!(matches!(result, Err(JoinGroupError::NoBootstrapAddresses)));
    }
}
