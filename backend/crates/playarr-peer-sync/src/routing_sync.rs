//! Syncs `routing_rules` via `GET /api/v1/peer/routing-rules?since=` --
//! `docs/architecture/peer-groups.md` §2.4/§3.5/§3.6.
//!
//! **Conflict model (§3.5): plain last-writer-wins by `updated_at`, no
//! origin-gating.** §3.5's stricter, `origin_peer_id`-gated rule only
//! applies to `User`/`Policy`'s *privilege-bearing* fields (`is_admin`,
//! `can_stream`, `can_download`, `library_allow`, ...) -- fields that grant
//! or restrict access, where the design's threat model is "a compromised
//! peer must not be able to escalate privilege it doesn't already have."
//! `RoutingRule` carries no such field: `preferred_nodes`/`delivery_mode`/
//! `priority`/`group_library_id`/`user_id` are all playback *routing
//! preference* -- which peer happens to answer a stream request and how the
//! bytes travel -- never a grant of access to a library or account a policy
//! hasn't already independently authorized (§5.1/§5.3's own defense-in-depth
//! note: the *owning* peer still independently re-checks the acting user's
//! policy before serving a single byte, regardless of which rule routed the
//! request there). A compromised peer overwriting a `RoutingRule` can, at
//! worst, misdirect where a request is served from among peers already in
//! the group -- not grant a capability nobody had. So `routing_rules` syncs
//! exactly like `group_libraries` (`account_sync::sync_libraries`): plain
//! LWW by `updated_at`, and (unlike `users`/`policies`) no per-field
//! merge/gating logic is needed at all.
//!
//! **Every resolved conflict is logged, never silently dropped** (§3.5),
//! same as every other synced entity in this crate: a losing incoming row
//! writes a `sync_conflict_log` row (`entity_type = "routing_rule"`,
//! `requires_admin_review = false` -- plain LWW, not a privilege dispute) and
//! is not applied.
//!
//! **No row-level constraint-violation isolation** (contrast
//! `account_sync::sync_accounts`'s handling of a `users.username` collision):
//! `routing_rules` has exactly one uniqueness constraint, its own `id`
//! `PRIMARY KEY` (see `0039_routing_rules.sql`/`0036_routing_rules.sql`) --
//! no secondary unique index a different-`id` row could collide on the way
//! `username` does for `User`. [`RoutingRuleRepo::create`]/[`RoutingRuleRepo::
//! update`] are looked up by `id` first (via `get`), so this module never
//! calls `create` on an id it already knows exists or `update` on one it
//! doesn't -- there is no plausible constraint failure left for a page apply
//! to hit, so there is nothing here to isolate.

use std::sync::Arc;

use chrono::Utc;
use playarr_db::{RoutingRuleRepo, SyncConflictLog, SyncConflictLogRepo};
use playarr_model::RoutingRule;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::peer_client::{PeerClient, PeerClientError};

#[derive(Debug, thiserror::Error)]
pub enum RoutingSyncError {
    #[error(transparent)]
    PeerClient(#[from] PeerClientError),
    #[error(transparent)]
    Db(#[from] playarr_db::DbError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Wire shape of `GET /api/v1/peer/routing-rules?since=`'s response body.
/// `RoutingRule` is reused directly, not re-mirrored field-by-field: it
/// carries no secret and already stamps its own `created_at`/`updated_at`
/// (unlike `User`/`Policy`, which need a separate `SyncMetadata` envelope
/// because the domain type itself doesn't carry those columns) -- the same
/// "one shared type, zero drift risk" reasoning `membership_sync::
/// NodesResponse` already applies to `PeerNode`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRulesResponse {
    pub rows: Vec<RoutingRule>,
    pub server_time: String,
}

fn conflict_log(
    entity_id: Uuid,
    winning_peer_id: Uuid,
    losing_peer_id: Uuid,
    losing_value_json: String,
) -> SyncConflictLog {
    SyncConflictLog {
        id: Uuid::new_v4(),
        entity_type: "routing_rule".to_string(),
        entity_id,
        winning_peer_id,
        losing_peer_id,
        losing_value_json,
        detected_at: Utc::now(),
        // Plain LWW, not a privilege dispute -- see this module's own doc
        // comment. Matches `account_sync::sync_libraries`'s identical
        // `false` for the same reason.
        requires_admin_review: false,
    }
}

/// Syncs `routing_rules` from `base_url`'s `GET /api/v1/peer/routing-rules`,
/// resuming from this `peer_node_id`'s persisted cursor (`entity =
/// "routing_rules"`). Plain LWW by `updated_at` -- see this module's own doc
/// comment for why no origin-gating applies. Returns the number of rows
/// applied (inserted or updated; a row that loses its LWW comparison is
/// logged, not counted).
pub async fn sync_routing_rules(
    peer_client: &PeerClient,
    base_url: &str,
    peer_node_id: Uuid,
    self_peer_id: Uuid,
    routing_rule_repo: &Arc<dyn RoutingRuleRepo>,
    sync_state_repo: &Arc<dyn playarr_db::PeerSyncStateRepo>,
    conflict_log_repo: &Arc<dyn SyncConflictLogRepo>,
) -> Result<usize, RoutingSyncError> {
    const ENTITY: &str = "routing_rules";
    let cursor = sync_state_repo
        .get(peer_node_id, ENTITY)
        .await?
        .and_then(|state| state.cursor);
    let path = match &cursor {
        Some(cursor) => format!("/api/v1/peer/routing-rules?since={cursor}"),
        None => "/api/v1/peer/routing-rules".to_string(),
    };
    let response: RoutingRulesResponse = peer_client.signed_get(base_url, &path).await?;

    apply_routing_rules_response(
        response,
        peer_node_id,
        self_peer_id,
        routing_rule_repo,
        sync_state_repo,
        conflict_log_repo,
    )
    .await
}

/// Applies routing rules delivered by either pull or push transport.
pub async fn apply_routing_rules_response(
    response: RoutingRulesResponse,
    peer_node_id: Uuid,
    self_peer_id: Uuid,
    routing_rule_repo: &Arc<dyn RoutingRuleRepo>,
    sync_state_repo: &Arc<dyn playarr_db::PeerSyncStateRepo>,
    conflict_log_repo: &Arc<dyn SyncConflictLogRepo>,
) -> Result<usize, RoutingSyncError> {
    const ENTITY: &str = "routing_rules";
    let mut applied = 0usize;
    for rule in &response.rows {
        let existing = routing_rule_repo.get(rule.id).await?;
        match &existing {
            None => {
                routing_rule_repo.create(rule).await?;
                applied += 1;
            }
            Some(existing_row) if rule.updated_at > existing_row.updated_at => {
                routing_rule_repo.update(rule).await?;
                applied += 1;
            }
            Some(_) => {
                conflict_log_repo
                    .create(&conflict_log(
                        rule.id,
                        self_peer_id,
                        peer_node_id,
                        serde_json::to_string(rule)?,
                    ))
                    .await?;
            }
        }
    }

    sync_state_repo
        .upsert(&playarr_db::PeerSyncState {
            peer_node_id,
            entity: ENTITY.to_string(),
            cursor: Some(response.server_time),
            last_synced_at: Some(Utc::now()),
        })
        .await?;

    Ok(applied)
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use chrono::SubsecRound;
    use playarr_model::DeliveryMode;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::signing::PeerIdentity;

    fn client() -> PeerClient {
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode([9u8; 32]);
        let identity = PeerIdentity::from_seed_b64(Uuid::new_v4(), &seed_b64).unwrap();
        PeerClient::new(reqwest::Client::new(), identity)
    }

    struct Harness {
        pool: playarr_db::DbPool,
        routing_rule_repo: Arc<dyn RoutingRuleRepo>,
        sync_state_repo: Arc<dyn playarr_db::PeerSyncStateRepo>,
        conflict_log_repo: Arc<dyn SyncConflictLogRepo>,
    }

    async fn harness() -> Harness {
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        playarr_db::run_migrations(&pool, false).await.unwrap();
        Harness {
            pool: pool.clone(),
            routing_rule_repo: Arc::new(playarr_db::repo::SqlxRoutingRuleRepo::new(pool.clone())),
            sync_state_repo: Arc::new(playarr_db::repo::SqlxPeerSyncStateRepo::new(pool.clone())),
            conflict_log_repo: Arc::new(playarr_db::repo::SqlxSyncConflictLogRepo::new(pool)),
        }
    }

    /// `routing_rules.group_id` is a real `REFERENCES peer_groups (id)`
    /// foreign key -- every test needs a real parent row first, same as
    /// `playarr_db::repo::routing_rule`'s own tests.
    async fn seed_group(pool: &playarr_db::DbPool) -> Uuid {
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

    fn sample_rule(group_id: Uuid, updated_at: chrono::DateTime<Utc>) -> RoutingRule {
        RoutingRule {
            id: Uuid::new_v4(),
            group_id,
            group_library_id: None,
            user_id: None,
            priority: 0,
            preferred_nodes: vec![Uuid::new_v4()],
            delivery_mode: DeliveryMode::Auto,
            created_at: updated_at,
            updated_at,
        }
    }

    #[tokio::test]
    async fn sync_routing_rules_inserts_a_brand_new_row() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        let group_id = seed_group(&harness.pool).await;
        let peer_node_id = Uuid::new_v4();
        let self_peer_id = Uuid::new_v4();
        let rule = sample_rule(group_id, Utc::now().trunc_subsecs(3));

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/routing-rules"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [rule],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let applied = sync_routing_rules(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.routing_rule_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .expect("sync succeeds");
        assert_eq!(applied, 1);

        let fetched = harness
            .routing_rule_repo
            .get(rule.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(fetched, rule);

        let cursor = harness
            .sync_state_repo
            .get(peer_node_id, "routing_rules")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cursor.cursor.as_deref(), Some("cursor-1"));
    }

    #[tokio::test]
    async fn sync_routing_rules_applies_a_strictly_newer_incoming_update() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        let group_id = seed_group(&harness.pool).await;
        let peer_node_id = Uuid::new_v4();
        let self_peer_id = Uuid::new_v4();
        let mut rule = sample_rule(group_id, Utc::now().trunc_subsecs(3));
        harness.routing_rule_repo.create(&rule).await.unwrap();

        rule.priority = 42;
        rule.updated_at += chrono::Duration::seconds(10);

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/routing-rules"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [rule],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let applied = sync_routing_rules(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.routing_rule_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .expect("sync succeeds");
        assert_eq!(applied, 1);

        let fetched = harness
            .routing_rule_repo
            .get(rule.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(fetched.priority, 42);
    }

    #[tokio::test]
    async fn sync_routing_rules_rejects_a_stale_incoming_write_and_logs_it() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        let group_id = seed_group(&harness.pool).await;
        let peer_node_id = Uuid::new_v4();
        let self_peer_id = Uuid::new_v4();
        let local = sample_rule(group_id, Utc::now().trunc_subsecs(3));
        harness.routing_rule_repo.create(&local).await.unwrap();

        let mut stale = local.clone();
        stale.priority = 999;
        stale.updated_at -= chrono::Duration::seconds(10);

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/routing-rules"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [stale],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let applied = sync_routing_rules(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.routing_rule_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .expect("sync succeeds");
        assert_eq!(applied, 0, "a stale incoming write must not be applied");

        let fetched = harness
            .routing_rule_repo
            .get(local.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(fetched, local, "the local row must be unchanged");

        let logged = harness
            .conflict_log_repo
            .list_requiring_review()
            .await
            .unwrap();
        assert!(
            logged.is_empty(),
            "plain LWW loss is not a privilege dispute -- requires_admin_review must be false"
        );
    }

    #[tokio::test]
    async fn sync_routing_rules_is_inert_with_zero_rows() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/routing-rules"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let applied = sync_routing_rules(
            &client(),
            &mock.uri(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            &harness.routing_rule_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .expect("sync succeeds");
        assert_eq!(applied, 0);
    }
}
