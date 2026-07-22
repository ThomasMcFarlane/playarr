//! End-to-end proof that two independent peer nodes actually interoperate
//! over the real wire protocol Phase 2 shipped -- `docs/architecture/
//! peer-groups.md` §3.4/§3.6.
//!
//! Every other join/sync test in this crate either drives one node's own
//! router in isolation (`peer.rs`'s handler tests) or stands in for "the
//! other peer" with a `wiremock::MockServer` (`admin_peer.rs`'s
//! `joining_a_group_calls_the_seed_node_and_persists_membership`,
//! `streamarr-peer-sync`'s own `enroll`/`account_sync`/`availability_sync`/
//! `membership_sync`/`poller` tests). None of them prove the two sides of
//! the protocol actually agree with each other -- a mock only proves this
//! crate's client code sends a request shaped the way *this crate*
//! expects a response to be shaped, not that `streamarr-api::peer`'s real
//! handlers actually produce that shape.
//!
//! This test builds two full, independent [`AppState`]s (`node A`/`node
//! B`, each its own in-memory SQLite [`streamarr_db::DbPool`]), serves node
//! A's real [`axum::Router`] on a real loopback [`tokio::net::TcpListener`]
//! (not `oneshot`, not a mock), and drives:
//!
//! 1. Founding a group on A and joining it from B via the real, admin-
//!    driven HTTP flow (`PUT .../peer-nodes/self`, `POST .../peer-groups`,
//!    `POST .../peer-groups/join-tokens`, `POST .../peer-groups/join`) --
//!    B's join call makes a genuine `reqwest` request to A's real
//!    `POST /api/v1/peer/enroll` handler over the socket, exactly the way
//!    two real installations would.
//! 2. A real [`streamarr_peer_sync::PeerSyncPoller`] cycle, run from B
//!    against A's same live listener, pulling a `Policy` + `User` created
//!    on A after founding into B's own database via A's real
//!    `GET /api/v1/peer/accounts` handler (`PeerSignedRequest`-verified,
//!    not bypassed).
//!
//! Assertions are made against *both* nodes' own repos independently, so a
//! canned/short-circuited response on either side would show up as a
//! mismatch rather than passing by construction.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration as StdDuration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use streamarr_coordination::{ClusterCoordinator, SingleNodeCoordinator};
use streamarr_db::repo::{
    SqlxPeerLeafAvailabilityRepo, SqlxPeerSyncStateRepo, SqlxSyncConflictLogRepo,
};
use streamarr_model::{Policy, Sensitive, SourceInstance, SourceKind, User};
use streamarr_peer_sync::{PeerClient, PeerIdentity, PeerSyncPoller};
use tower::ServiceExt;
use uuid::Uuid;

use crate::test_support::{bearer_header, mint_access_token, seed_admin_user, test_state};

/// Binds `router` to a real loopback TCP listener and serves it in a
/// detached background task, matching production's own
/// `into_make_service_with_connect_info` wiring (`backend/src/main.rs`'s
/// `serve_application_router`) so nothing in the router that extracts
/// `ConnectInfo<SocketAddr>` panics. Returns the base `http://` URL callers
/// should point `reqwest`/`PeerClient` at.
async fn serve_on_real_tcp(router: axum::Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind an ephemeral loopback port");
    let addr = listener.local_addr().expect("resolve bound local addr");
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .expect("test http server exited unexpectedly");
    });
    format!("http://{addr}")
}

fn put_self_request(token: &str, name: &str, url: &str) -> Request<Body> {
    let body = json!({
        "name": name,
        "addresses": [
            {"url": url, "priority": 0, "label": "lan", "client_reachable": true}
        ]
    });
    Request::builder()
        .method("PUT")
        .uri("/api/v1/admin/peer-nodes/self")
        .header("content-type", "application/json")
        .header("Authorization", bearer_header(token))
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes)
        .unwrap_or_else(|err| panic!("response (status {status}) was not JSON: {err}"))
}

#[tokio::test]
async fn two_peer_nodes_join_and_sync_over_the_real_wire_protocol() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_test_writer()
        .try_init();
    // ---- Node A: served over a real TCP socket for the rest of this test ----
    let (router_a, state_a) = test_state().await;
    let admin_a = Uuid::new_v4();
    seed_admin_user(&state_a, admin_a).await;
    let token_a = mint_access_token(&state_a, admin_a);
    let base_url_a = serve_on_real_tcp(router_a).await;

    let http = reqwest::Client::new();

    // §3.4 founding step 1-2, driven over real HTTP against A's real listener.
    let response = http
        .put(format!("{base_url_a}/api/v1/admin/peer-nodes/self"))
        .header("Authorization", bearer_header(&token_a))
        .json(&json!({
            "name": "home",
            "addresses": [{"url": base_url_a, "priority": 0, "label": "lan", "client_reachable": true}]
        }))
        .send()
        .await
        .expect("PUT self on node A over real HTTP");
    assert_eq!(response.status(), reqwest::StatusCode::OK);

    let response = http
        .post(format!("{base_url_a}/api/v1/admin/peer-groups"))
        .header("Authorization", bearer_header(&token_a))
        .json(&json!({"name": "Test Group"}))
        .send()
        .await
        .expect("found group on node A over real HTTP");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let founded: serde_json::Value = response.json().await.unwrap();
    let group_id = founded["group"]["id"].as_str().unwrap().to_string();
    let node_a_peer_id = founded["self_node"]["id"].as_str().unwrap().to_string();

    let response = http
        .post(format!("{base_url_a}/api/v1/admin/peer-groups/join-tokens"))
        .header("Authorization", bearer_header(&token_a))
        .send()
        .await
        .expect("mint a join token on node A over real HTTP");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let token_body: serde_json::Value = response.json().await.unwrap();
    let join_token = token_body["join_token"].as_str().unwrap().to_string();

    // ---- Node B: driven in-process (its own router, not yet served over
    // TCP -- it's B that makes the outbound call in this step, so only A
    // needs to be a real listener for the join handshake itself). ----
    let (router_b, state_b) = test_state().await;
    let admin_b = Uuid::new_v4();
    seed_admin_user(&state_b, admin_b).await;
    let token_b = mint_access_token(&state_b, admin_b);

    let response = router_b
        .clone()
        .oneshot(put_self_request(&token_b, "east", "http://east.invalid"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // §3.4 joining step 2: B's real `join_peer_group_handler` makes a
    // genuine `reqwest` call to A's real, TCP-served `POST
    // /api/v1/peer/enroll` handler -- no mock anywhere in this path.
    let response = router_b
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/admin/peer-groups/join")
                .header("content-type", "application/json")
                .header("Authorization", bearer_header(&token_b))
                .body(Body::from(
                    json!({"seed_address": base_url_a, "join_token": join_token}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let joined = body_json(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "join must succeed against a real running peer: {joined:?}"
    );
    assert_eq!(joined["group"]["id"].as_str().unwrap(), group_id);

    // ---- Both sides' own durable state must independently agree that the
    // join actually happened -- not just that node B's handler *returned*
    // 200, but that node A's real `enroll_handler` genuinely persisted B
    // into its own `peer_nodes` table. ----
    let identity_b = state_b.app.node_identity_repo.get().await.unwrap().unwrap();
    assert_eq!(
        identity_b.group_id.map(|id| id.to_string()),
        Some(group_id.clone())
    );

    let members_b = state_b.app.peer_node_repo.list_all().await.unwrap();
    assert_eq!(
        members_b.len(),
        2,
        "node B must know about itself and node A"
    );
    assert!(members_b
        .iter()
        .any(|m| m.id.to_string() == node_a_peer_id && !m.is_self));
    assert!(members_b.iter().any(|m| m.is_self));

    let members_a = state_a.app.peer_node_repo.list_all().await.unwrap();
    assert_eq!(
        members_a.len(),
        2,
        "node A's own database (not just its HTTP response) must show node B joined"
    );
    assert!(
        members_a
            .iter()
            .any(|m| m.id.to_string() == identity_b.peer_id.to_string() && !m.is_self),
        "node A must have durably persisted node B's row via the real enroll handler"
    );

    // ---- Seed a brand-new Policy + User on node A *after* founding --
    // exactly the "an admin does real work on one node" scenario a sync
    // pass exists to propagate. ----
    let new_policy = Policy {
        id: Uuid::new_v4(),
        name: "synced-from-a".to_string(),
        library_allow: Vec::new(),
        group_library_allow: Vec::new(),
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: true,
        can_delete: false,
        can_share_public: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        access_schedule: None,
        can_stream: true,
        is_admin: false,
    };
    // `test_state()` seeds an identical literal `"test-default"` username
    // on *every* call (it's shared test fixture, not anything either node
    // did) -- rename node A's copy first so the real sync pass below
    // exercises the genuine cross-node scenario this test is about
    // (`new_user`/`new_policy`) without tripping over `users.username`'s
    // real, global `UNIQUE` constraint on an artifact of two independent
    // `test_state()` calls happening to pick the same fixture string.
    //
    // This collision is *not* just a test-fixture nuisance: it's exactly
    // the shape of a real product gap this test found by accident --
    // `account_sync::sync_accounts` applies synced `users` rows via `ON
    // CONFLICT (id)` upserts, which does nothing for two peers' genuinely
    // different users (different `id`s) independently colliding on
    // `username` (a different column entirely). That gap is now closed:
    // `DbError::is_constraint_violation` + `sync_accounts`'s per-row catch
    // (`streamarr-peer-sync/src/account_sync.rs`) isolate a row that fails
    // to apply with a real constraint violation -- it's logged to
    // `sync_conflict_log` (`requires_admin_review = true`, incoming row's
    // JSON plus the error attached) for a human to resolve, skipped, and
    // the rest of the page (and every later sync phase) still applies; the
    // cursor still advances so the same row is never retried forever. See
    // `account_sync::tests::sync_accounts_isolates_a_username_collision_
    // and_still_applies_the_rest_of_the_page` (`streamarr-peer-sync/src/
    // account_sync.rs`) for the exact two-peer scenario. This test still
    // renames node A's fixture user below, though, to keep this test about
    // the FK-ordering fix it actually asserts on, rather than re-exercising
    // the now-separately-covered collision path.
    sqlx::query("UPDATE users SET username = 'node-a-ambient-default' WHERE id = ?")
        .bind(state_a.default_user_id.to_string())
        .execute(&state_a.pool)
        .await
        .unwrap();

    state_a.policy_repo.upsert(&new_policy).await.unwrap();
    let new_user = User {
        id: Uuid::new_v4(),
        username: "synced-user".to_string(),
        display_name: "Synced From A".to_string(),
        email: None,
        password_hash: Sensitive::new(streamarr_auth::login::hash_password("test-only-password")),
        policy_id: new_policy.id,
        created_at: chrono::Utc::now(),
        disabled: false,
        preferred_audio_language: streamarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    state_a.user_repo.upsert(&new_user).await.unwrap();
    let source_instance = SourceInstance {
        id: Uuid::new_v4(),
        kind: SourceKind::Radarr,
        name: "Synced Radarr".to_string(),
        base_url: "https://radarr.internal.example".to_string(),
        api_key_encrypted: Sensitive::new("not-a-real-api-key".to_string()),
        priority: 4,
        default_root_folder_id: None,
        folder_mappings: Default::default(),
        default_quality_profile_id: None,
        best_effort: false,
        group_library_id: None,
    };
    state_a
        .app
        .source_instance_repo
        .upsert(&source_instance)
        .await
        .unwrap();

    // Node B must not see either row yet -- the poller hasn't run.
    assert!(state_b
        .app
        .user_repo
        .find_by_id(new_user.id)
        .await
        .unwrap()
        .is_none());

    // ---- A real `PeerSyncPoller` cycle, run from B against A's real,
    // TCP-served endpoints (`/api/v1/peer/{nodes,accounts,invites,
    // libraries,availability,routing-rules}`) -- the exact type/wiring
    // `backend/src/main.rs`'s `boot_worker` spawns in production,
    // constructed here the same way that function does (repos straight off
    // the pool for the two not exposed on `AppState`, see that function's
    // own comment on why they live outside it). ----
    let peer_identity_b =
        PeerIdentity::from_seed_b64(identity_b.peer_id, identity_b.private_key.expose_secret())
            .unwrap();
    let peer_client = PeerClient::new(reqwest::Client::new(), peer_identity_b);
    let coordinator: Arc<dyn ClusterCoordinator> = Arc::new(SingleNodeCoordinator::new());
    let availability_repo = Arc::new(SqlxPeerLeafAvailabilityRepo::new(state_b.pool.clone()));
    let sync_state_repo = Arc::new(SqlxPeerSyncStateRepo::new(state_b.pool.clone()));
    let conflict_log_repo = Arc::new(SqlxSyncConflictLogRepo::new(state_b.pool.clone()));

    let poller = PeerSyncPoller::new(
        identity_b.peer_id,
        node_a_peer_id.parse().unwrap(),
        peer_client,
        // Long interval: `PeerSyncPoller::run`'s first tick fires
        // immediately (matching `ReconciliationPoller::run`), so one real
        // cycle happens as soon as the task is spawned; nothing in this
        // test waits for a second tick.
        StdDuration::from_secs(3600),
        3,
        coordinator,
        state_b.app.peer_node_repo.clone(),
        state_b.app.user_repo.clone(),
        state_b.app.policy_repo.clone(),
        state_b.app.group_library_repo.clone(),
        state_b.app.source_instance_repo.clone(),
        state_b.app.user_invite_repo.clone(),
        state_b.app.user_invite_request_repo.clone(),
        state_b.app.work_repo.clone(),
        availability_repo,
        state_b.app.routing_rule_repo.clone(),
        sync_state_repo,
        conflict_log_repo,
    );
    let poller_handle = tokio::spawn(poller.run());

    // The poller's first cycle runs several real, signed HTTP round trips
    // against node A (membership -> accounts -> invites -> libraries ->
    // availability -> routing_rules); poll node B's own database until the
    // synced rows land, rather than assuming a fixed sleep is long enough.
    let synced_user = tokio::time::timeout(StdDuration::from_secs(10), async {
        loop {
            let user = state_b.app.user_repo.find_by_id(new_user.id).await.unwrap();
            let sources = state_b.app.source_instance_repo.list_all().await.unwrap();
            if let Some(user) = user {
                if sources.iter().any(|source| source.id == source_instance.id) {
                    return user;
                }
            }
            tokio::time::sleep(StdDuration::from_millis(20)).await;
        }
    })
    .await
    .expect("node A's new user and complete source must reach node B in one real sync cycle");
    poller_handle.abort();

    assert_eq!(synced_user.username, "synced-user");
    let synced_policy = state_b
        .app
        .policy_repo
        .find_by_id(new_policy.id)
        .await
        .unwrap()
        .expect(
            "the user's policy must have synced too (and, per the fix this test also \
                 guards, been applied *before* the user so the FK never trips)",
        );
    assert_eq!(synced_policy.name, "synced-from-a");

    // The peer-sync cursor must have actually advanced on node B -- proof
    // this was a real, successful cycle rather than a partial/failed one
    // that happened to still write some rows before erroring.
    let cursor = state_b
        .app
        .peer_node_repo
        .list_all()
        .await
        .unwrap()
        .into_iter()
        .find(|p| !p.is_self)
        .expect("node A's row must exist on node B");
    assert_eq!(
        cursor.status,
        streamarr_model::PeerNodeStatus::Active,
        "a genuinely successful cycle must leave the peer marked Active, not Unreachable"
    );
    assert!(cursor.last_seen_at.is_some());
}
