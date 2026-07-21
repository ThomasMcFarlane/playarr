//! Syncs `peer_nodes` via `GET /api/v1/peer/nodes` -- `docs/architecture/
//! peer-groups.md` §3.6. Full-refresh gossip: the membership list is a
//! small dataset (one row per peer in the group, realistically single
//! digits to low hundreds), so every pass re-fetches and re-applies the
//! whole thing rather than tracking an incremental `since=` cursor the way
//! `account_sync`/`availability_sync` do. This is how a third node's
//! membership (joined via a *different* peer's `enroll` call) eventually
//! converges everywhere without a fresh `enroll` round trip -- see the
//! design doc's §3.4 step 6.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use streamarr_db::PeerNodeRepo;
use streamarr_model::PeerNode;
use uuid::Uuid;

use crate::peer_client::{PeerClient, PeerClientError};

/// Wire shape of `GET /api/v1/peer/nodes`'s response body. No `since`/
/// cursor field on the request or `server_time` on the response -- unlike
/// every other sync endpoint (§3.6's table), membership has no
/// corresponding `peer_sync_state.entity` value (that table's own column
/// comment enumerates `'accounts' | 'invites' | 'libraries' |
/// 'availability' | 'routing_rules'`, deliberately not `'nodes'`/
/// `'membership'`): there is nothing to persist a cursor for when every
/// pass is already a full refresh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodesResponse {
    pub rows: Vec<PeerNode>,
}

/// Fetches `base_url`'s full `peer_nodes` view and upserts every row into
/// this node's own [`PeerNodeRepo`], correcting `is_self` to reflect *this*
/// node's own perspective (`member.id == self_peer_id`) rather than
/// trusting the reporting peer's claim -- the same rule `crate::enroll`
/// applies to the initial join response. Returns the number of rows
/// applied.
pub async fn sync_membership(
    peer_client: &PeerClient,
    peer_node_repo: &Arc<dyn PeerNodeRepo>,
    self_peer_id: Uuid,
    base_url: &str,
) -> Result<usize, PeerClientError> {
    let response: NodesResponse = peer_client.signed_get(base_url, "/api/v1/peer/nodes").await?;
    let count = response.rows.len();
    for mut member in response.rows {
        member.is_self = member.id == self_peer_id;
        peer_node_repo
            .upsert(&member)
            .await
            .map_err(|err| PeerClientError::Status {
                url: format!("{base_url}/api/v1/peer/nodes"),
                status: reqwest::StatusCode::INTERNAL_SERVER_ERROR,
                body: format!("failed to persist gossiped peer node: {err}"),
            })?;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use chrono::Utc;
    use serde_json::json;
    use streamarr_model::PeerNodeStatus;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::signing::PeerIdentity;

    fn client() -> PeerClient {
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode([5u8; 32]);
        let identity = PeerIdentity::from_seed_b64(Uuid::new_v4(), &seed_b64).unwrap();
        PeerClient::new(reqwest::Client::new(), identity)
    }

    fn node(id: Uuid, group_id: Uuid, name: &str, is_self: bool) -> PeerNode {
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

    async fn node_repo() -> (Arc<dyn PeerNodeRepo>, streamarr_db::DbPool) {
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        streamarr_db::run_migrations(&pool, false).await.unwrap();
        (
            Arc::new(streamarr_db::repo::SqlxPeerNodeRepo::new(pool.clone())),
            pool,
        )
    }

    /// `peer_nodes.group_id` is a real `REFERENCES peer_groups (id)`
    /// foreign key -- every test needs a real parent row first, same as
    /// `streamarr-db::repo::peer_node`'s own tests.
    async fn seed_group(pool: &streamarr_db::DbPool) -> Uuid {
        let group_id = Uuid::new_v4();
        sqlx::query("INSERT INTO peer_groups (id, name, created_at) VALUES (?, ?, ?)")
            .bind(group_id.to_string())
            .bind("test group")
            .bind(Utc::now().to_rfc3339())
            .execute(pool)
            .await
            .unwrap();
        group_id
    }

    #[tokio::test]
    async fn sync_membership_upserts_every_row_and_corrects_is_self() {
        let mock = MockServer::start().await;
        let self_peer_id = Uuid::new_v4();
        let (repo, pool) = node_repo().await;
        let group_id = seed_group(&pool).await;
        let third_peer_id = Uuid::new_v4();
        // The remote peer's own view: it thinks *it* is self, and knows
        // about a third peer this node has never talked to directly.
        let remote_self = node(Uuid::new_v4(), group_id, "remote", true);
        let this_node_as_seen_remotely = node(self_peer_id, group_id, "this-node", false);
        let third_peer = node(third_peer_id, group_id, "third", false);

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/nodes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [remote_self, this_node_as_seen_remotely, third_peer],
            })))
            .mount(&mock)
            .await;

        let count = sync_membership(&client(), &repo, self_peer_id, &mock.uri())
            .await
            .expect("sync succeeds");
        assert_eq!(count, 3);

        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 3);
        let this = all.iter().find(|n| n.id == self_peer_id).unwrap();
        assert!(this.is_self, "this node's own row must be corrected to is_self=true");
        let remote = all.iter().find(|n| n.name == "remote").unwrap();
        assert!(!remote.is_self, "the reporting peer's own row must not be is_self locally");
        assert!(all.iter().any(|n| n.id == third_peer_id));
    }

    #[tokio::test]
    async fn sync_membership_is_a_no_op_for_an_empty_group() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/nodes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"rows": []})))
            .mount(&mock)
            .await;

        let (repo, _pool) = node_repo().await;
        let count = sync_membership(&client(), &repo, Uuid::new_v4(), &mock.uri())
            .await
            .unwrap();
        assert_eq!(count, 0);
        assert!(repo.list_all().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn sync_membership_re_upserting_the_same_rows_is_idempotent() {
        let mock = MockServer::start().await;
        let self_peer_id = Uuid::new_v4();
        let (repo, pool) = node_repo().await;
        let group_id = seed_group(&pool).await;
        let row = node(Uuid::new_v4(), group_id, "peer-b", false);
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/nodes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"rows": [row]})))
            .mount(&mock)
            .await;

        sync_membership(&client(), &repo, self_peer_id, &mock.uri())
            .await
            .unwrap();
        sync_membership(&client(), &repo, self_peer_id, &mock.uri())
            .await
            .unwrap();

        assert_eq!(repo.list_all().await.unwrap().len(), 1);
    }
}
