//! End-to-end proof that Phase 3 routing (`docs/architecture/
//! peer-groups.md` §5.2/§5.3) is actually wired into the *live* playback
//! request path, over the real wire protocol -- mirrors
//! `peer_group_e2e_test.rs`'s own "two real, independent `AppState`s, one
//! served over a real loopback TCP listener" pattern rather than a mock or
//! an in-process `oneshot` call, for the same reason that file's own doc
//! comment gives: a mock only proves this crate's own client code sends
//! what it itself expects, never that the two sides of a protocol actually
//! agree.
//!
//! Three scenarios, matching the ordering `playback::playback_info_handler`
//! itself evaluates in:
//!
//! 1. [`serve_locally_stays_unchanged_even_once_grouped`]: a grouped node
//!    with no matching `RoutingRule` still runs exactly today's existing
//!    negotiation locally -- the inertness guarantee §5.2 states, exercised
//!    with a *real* group present (not just the ungrouped default every
//!    other `playback::tests::*`/`media::tests::*` test already covers, and
//!    still passes verbatim after this phase's changes).
//! 2. [`delegate_forwards_the_entire_negotiation_and_rewrites_the_url_for_redirect`]:
//!    a matching rule preferring a real second node -- the *entire*
//!    negotiation runs on that peer (proven by asserting its own
//!    `PlaybackSession` landed in the peer's own registry, and nothing did
//!    in the entry node's), and the returned `url` is rewritten to an
//!    absolute address on that peer, per `Redirect` delivery.
//! 3. [`proxy_passthrough_preserves_a_range_request_and_its_206_response`]:
//!    `DeliveryMode::Proxy`'s `media.rs` passthrough -- a real `Range`
//!    request against the entry node's own proxy route returns exactly the
//!    owning peer's own partial-content bytes and `Content-Range`, §5.3's
//!    own "highest-risk new runtime behavior" callout.

use std::net::SocketAddr;

use playarr_model::media::LeafRef;
use playarr_model::{
    Availability, ClientPlatform, DeliveryMode, ExternalProvider, ExternalRef, LeafSelector,
    MediaFile, PeerLeafAvailability, PlayMethod, PlaybackSession, ProducedBy, Rendition,
    RenditionStatus, RoutingRule, SourceInstance, WorkKind,
};
use serde_json::json;
use uuid::Uuid;

use crate::test_support::{
    bearer_header, mint_access_token, seed_admin_user, seed_streaming_user_with_library_allow,
    test_state, TestState,
};

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

async fn body_json(response: reqwest::Response) -> serde_json::Value {
    let status = response.status();
    let text = response.text().await.unwrap();
    serde_json::from_str(&text).unwrap_or_else(|err| {
        panic!("response (status {status}) was not JSON: {err} -- body: {text}")
    })
}

/// Founds a group on `state_a` (served at `base_url_a`) and joins `state_b`
/// (served at `base_url_b`) into it, entirely over real HTTP -- identical
/// steps to `peer_group_e2e_test.rs`'s own founding/joining section, mostly
/// duplicated rather than shared (that module is private to this crate's
/// own `#[cfg(test)]` tree; a few lines of duplication here is cheaper than
/// widening its visibility just for this).
async fn found_and_join(
    state_a: &TestState,
    base_url_a: &str,
    state_b: &TestState,
    base_url_b: &str,
) -> (Uuid, Uuid, Uuid) {
    let admin_a = Uuid::new_v4();
    seed_admin_user(state_a, admin_a).await;
    let token_a = mint_access_token(state_a, admin_a);

    let http = reqwest::Client::new();

    let response = http
        .put(format!("{base_url_a}/api/v1/admin/peer-nodes/self"))
        .header("Authorization", bearer_header(&token_a))
        .json(&json!({
            "name": "home",
            "addresses": [{"url": base_url_a, "priority": 0, "label": "lan", "client_reachable": true}]
        }))
        .send()
        .await
        .expect("PUT self on node A");
    assert_eq!(response.status(), reqwest::StatusCode::OK);

    let response = http
        .post(format!("{base_url_a}/api/v1/admin/peer-groups"))
        .header("Authorization", bearer_header(&token_a))
        .json(&json!({"name": "Test Group"}))
        .send()
        .await
        .expect("found group on node A");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let founded = body_json(response).await;
    let group_id: Uuid = founded["group"]["id"].as_str().unwrap().parse().unwrap();
    let node_a_peer_id: Uuid = founded["self_node"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    let response = http
        .post(format!("{base_url_a}/api/v1/admin/peer-groups/join-tokens"))
        .header("Authorization", bearer_header(&token_a))
        .send()
        .await
        .expect("mint a join token on node A");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let join_token = body_json(response).await["join_token"]
        .as_str()
        .unwrap()
        .to_string();

    let admin_b = Uuid::new_v4();
    seed_admin_user(state_b, admin_b).await;
    let token_b = mint_access_token(state_b, admin_b);

    let response = http
        .put(format!("{base_url_b}/api/v1/admin/peer-nodes/self"))
        .header("Authorization", bearer_header(&token_b))
        .json(&json!({
            "name": "east",
            "addresses": [{"url": base_url_b, "priority": 0, "label": "lan", "client_reachable": true}]
        }))
        .send()
        .await
        .expect("PUT self on node B");
    assert_eq!(response.status(), reqwest::StatusCode::OK);

    let response = http
        .post(format!("{base_url_b}/api/v1/admin/peer-groups/join"))
        .header("Authorization", bearer_header(&token_b))
        .json(&json!({"seed_address": base_url_a, "join_token": join_token}))
        .send()
        .await
        .expect("join node B into node A's group over real HTTP");
    let status = response.status();
    let joined = body_json(response).await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "join must succeed: {joined:?}"
    );

    let identity_b = state_b
        .app
        .node_identity_repo
        .get()
        .await
        .unwrap()
        .expect("node B must have a persisted identity after joining");
    assert_eq!(identity_b.group_id, Some(group_id));
    let node_b_peer_id = identity_b.peer_id;

    (group_id, node_a_peer_id, node_b_peer_id)
}

fn sample_work(external_id: &str) -> playarr_model::Work {
    playarr_model::Work {
        id: Uuid::new_v4(),
        kind: WorkKind::Movie,
        external_refs: vec![ExternalRef {
            provider: ExternalProvider::Tmdb,
            external_id: external_id.to_string(),
        }],
        title: "The Sample Movie".to_string(),
        sort_title: "sample movie, the".to_string(),
        overview: None,
        images: vec![],
        genres: vec![],
        tags: vec![],
        added_at: chrono::Utc::now(),
        release_date: None,
        monitored: true,
        availability: Availability::Available,
    }
}

fn sample_source_instance(id: Uuid, group_library_id: Uuid) -> SourceInstance {
    SourceInstance {
        id,
        kind: playarr_model::SourceKind::Radarr,
        name: "Radarr".to_string(),
        base_url: "https://radarr.example.com".to_string(),
        api_key_encrypted: playarr_model::Sensitive::new("key".to_string()),
        priority: 0,
        default_root_folder_id: None,
        folder_mappings: Default::default(),
        default_quality_profile_id: None,
        best_effort: false,
        group_library_id: Some(group_library_id),
    }
}

/// §5.2: a grouped node with no matching `RoutingRule` at all must still
/// resolve `RoutingDecision::ServeLocally` and run today's existing
/// negotiation logic byte-for-byte -- the inertness guarantee, now proven
/// with a *real* founded group present (every other direct-play test in
/// `playback::tests` only ever covers the simpler, fully ungrouped default).
#[tokio::test]
async fn serve_locally_stays_unchanged_even_once_grouped() {
    let (router_a, state_a) = test_state().await;
    let base_url_a = serve_on_real_tcp(router_a).await;
    let (router_b, state_b) = test_state().await;
    let base_url_b = serve_on_real_tcp(router_b).await;

    found_and_join(&state_a, &base_url_a, &state_b, &base_url_b).await;

    let source_instance_id = Uuid::new_v4();
    // Deliberately no `group_library_id` at all -- this leaf is not even
    // eligible for any `RoutingRule` to match on.
    state_a.source_instances.upsert(SourceInstance {
        group_library_id: None,
        ..sample_source_instance(source_instance_id, Uuid::new_v4())
    });

    let work = sample_work("603");
    state_a.work_repo.upsert(&work).await.unwrap();
    let media_file = MediaFile {
        id: Uuid::new_v4(),
        work_id: work.id,
        leaf_ref: LeafRef::Work,
        path: std::path::PathBuf::from("/media/movies/Sample.mkv"),
        container: "mp4".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(8_000_000),
        duration_ms: Some(3_600_000),
        size_bytes: 4_000_000_000,
        source_instance_id,
        source_file_id: Some("1".to_string()),
    };
    state_a.media_file_repo.create(&media_file).await.unwrap();
    state_a.media_files.insert(media_file.clone());

    let user_id = Uuid::new_v4();
    seed_streaming_user_with_library_allow(&state_a, user_id, vec![source_instance_id]).await;
    let token = mint_access_token(&state_a, user_id);

    let http = reqwest::Client::new();
    let response = http
        .get(format!(
            "{base_url_a}/api/v1/playback/{}?containers=mp4&video_codecs=h264",
            media_file.id
        ))
        .header("Authorization", bearer_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["mode"], "direct");
    assert_eq!(
        body["url"],
        format!(
            "/api/v1/media/{}/stream?playback_session_id={}",
            media_file.id,
            body["session_id"].as_str().unwrap()
        )
    );

    // Negotiation ran locally, on node A's own registry -- not forwarded
    // anywhere (node B never saw this request at all).
    let session_id: Uuid = body["session_id"].as_str().unwrap().parse().unwrap();
    assert!(state_a.app.session_registry.get(session_id).is_some());
    assert!(state_b.app.session_registry.list_all().is_empty());
}

/// §5.2/§5.3: a matching `RoutingRule` preferring a real second node
/// forwards the *entire* negotiation there (not just a URL swap), and its
/// response is rewritten into an absolute URL at that peer's own
/// `client_reachable` address for `Redirect` delivery.
#[tokio::test]
async fn delegate_forwards_the_entire_negotiation_and_rewrites_the_url_for_redirect() {
    let (router_a, state_a) = test_state().await;
    let base_url_a = serve_on_real_tcp(router_a).await;
    let (router_b, state_b) = test_state().await;
    let base_url_b = serve_on_real_tcp(router_b).await;

    let (group_id, _node_a_peer_id, node_b_peer_id) =
        found_and_join(&state_a, &base_url_a, &state_b, &base_url_b).await;

    let group_library_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    // ---- Node A: has its own local copy of the same title, but the
    // routing rule below prefers node B regardless. ----
    let source_instance_a = Uuid::new_v4();
    state_a
        .source_instances
        .upsert(sample_source_instance(source_instance_a, group_library_id));
    let work_a = sample_work("603");
    state_a.work_repo.upsert(&work_a).await.unwrap();
    let media_file_a = MediaFile {
        id: Uuid::new_v4(),
        work_id: work_a.id,
        leaf_ref: LeafRef::Work,
        path: std::path::PathBuf::from("/media/movies/SampleA.mkv"),
        container: "mp4".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(8_000_000),
        duration_ms: Some(3_600_000),
        size_bytes: 4_000_000_000,
        source_instance_id: source_instance_a,
        source_file_id: Some("1".to_string()),
    };
    state_a.media_file_repo.create(&media_file_a).await.unwrap();
    state_a.media_files.insert(media_file_a.clone());
    seed_streaming_user_with_library_allow(&state_a, user_id, vec![source_instance_a]).await;
    let token = mint_access_token(&state_a, user_id);

    // ---- Node B: the peer the routing rule prefers -- its own, distinct
    // local copy of the same title (same external ref, different local
    // ids throughout -- exactly what makes the local `media_file_id`
    // non-portable, and why `forward_negotiation_to_peer` sends the
    // external ref instead). ----
    let source_instance_b = Uuid::new_v4();
    state_b
        .source_instances
        .upsert(sample_source_instance(source_instance_b, group_library_id));
    let work_b = sample_work("603");
    state_b.work_repo.upsert(&work_b).await.unwrap();
    let media_file_b = MediaFile {
        id: Uuid::new_v4(),
        work_id: work_b.id,
        leaf_ref: LeafRef::Work,
        path: std::path::PathBuf::from("/media/movies/SampleB.mkv"),
        container: "mp4".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(6_000_000),
        duration_ms: Some(3_600_000),
        size_bytes: 3_000_000_000,
        source_instance_id: source_instance_b,
        source_file_id: Some("1".to_string()),
    };
    state_b.media_file_repo.create(&media_file_b).await.unwrap();
    state_b.media_files.insert(media_file_b.clone());
    // The forwarding peer's own assertion of who's asking is independently
    // re-checked here, against node B's *own* synced Policy/User -- so it
    // must exist here too, granting node B's own local source instance
    // (deliberately a different id than node A's grant above).
    seed_streaming_user_with_library_allow(&state_b, user_id, vec![source_instance_b]).await;

    // ---- The routing rule + cross-node availability node A's own routing
    // step reads. ----
    let rule = RoutingRule {
        id: Uuid::new_v4(),
        group_id,
        group_library_id: Some(group_library_id),
        user_id: None,
        priority: 0,
        preferred_nodes: vec![node_b_peer_id],
        delivery_mode: DeliveryMode::Redirect,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    state_a.app.routing_rule_repo.create(&rule).await.unwrap();

    let now = chrono::Utc::now();
    state_a
        .app
        .peer_leaf_availability_repo
        .upsert(&PeerLeafAvailability {
            peer_node_id: node_b_peer_id,
            media_file_id: media_file_b.id,
            source_instance_id: source_instance_b,
            path: media_file_b.path.to_string_lossy().into_owned(),
            provider: ExternalProvider::Tmdb,
            external_id: "603".to_string(),
            leaf_selector: LeafSelector::Movie,
            group_library_id: Some(group_library_id),
            availability: Availability::Available,
            container: Some("mp4".to_string()),
            codec: Some("h264".to_string()),
            bitrate: Some(6_000_000),
            size_bytes: Some(3_000_000_000),
            duration_ms: Some(3_600_000),
            local_work_id: Some(work_a.id),
            title: "The Sample Movie".to_string(),
            kind: WorkKind::Movie,
            release_date: None,
            updated_at: now,
        })
        .await
        .unwrap();

    // ---- The actual request: node A's own client, hitting node A's own
    // ordinary playback negotiation endpoint. ----
    let http = reqwest::Client::new();
    let response = http
        .get(format!(
            "{base_url_a}/api/v1/playback/{}?containers=mp4&video_codecs=h264",
            media_file_a.id
        ))
        .header("Authorization", bearer_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["mode"], "direct");

    let session_id = body["session_id"].as_str().unwrap().to_string();
    assert_eq!(
        body["url"],
        format!(
            "{base_url_b}/api/v1/media/{}/stream?playback_session_id={session_id}",
            media_file_b.id
        ),
        "Redirect delivery must rewrite the owning peer's own relative url into an absolute \
         address at that peer -- not node A's own media_file_a id at all",
    );

    // The negotiation genuinely ran on node B, against node B's own
    // MediaFile (proven by its own session registry, not node A's
    // forwarded say-so) -- and node A never ran its own negotiation logic
    // for this request at all.
    let session_id: Uuid = session_id.parse().unwrap();
    let tracked_on_b = state_b
        .app
        .session_registry
        .get(session_id)
        .expect("the owning peer must have recorded this negotiation itself");
    assert_eq!(tracked_on_b.user_id, user_id);
    assert_eq!(tracked_on_b.media_file_id, media_file_b.id);
    assert_eq!(
        tracked_on_b.play_method,
        playarr_model::PlayMethod::DirectPlay
    );
    assert!(
        state_a.app.session_registry.get(session_id).is_none(),
        "node A must never record its own session for a fully-delegated negotiation"
    );
}

/// §5.3's own "highest-risk new runtime behavior" callout: the `Proxy`
/// passthrough must preserve a `Range` request end-to-end, byte-for-byte,
/// through the entry node, to the owning peer's own real file -- exercised
/// against a real file on disk (not a probed/fabricated path, unlike the
/// two tests above) so the actual bytes returned can be asserted on.
#[tokio::test]
async fn proxy_passthrough_preserves_a_range_request_and_its_206_response() {
    let (router_a, state_a) = test_state().await;
    let base_url_a = serve_on_real_tcp(router_a).await;
    let (router_b, state_b) = test_state().await;
    let base_url_b = serve_on_real_tcp(router_b).await;

    let (_group_id, _node_a_peer_id, node_b_peer_id) =
        found_and_join(&state_a, &base_url_a, &state_b, &base_url_b).await;

    // A real file on disk, on node B -- this is what the entry node's
    // proxy route has to actually stream through, `Range` header and all.
    let content = b"0123456789ABCDEFGHIJ".to_vec();
    let file_path = std::env::temp_dir().join(format!("playarr-proxy-test-{}.bin", Uuid::new_v4()));
    std::fs::write(&file_path, &content).unwrap();

    let source_instance_b = Uuid::new_v4();
    state_b
        .source_instances
        .upsert(sample_source_instance(source_instance_b, Uuid::new_v4()));
    let work_b = sample_work("603");
    state_b.work_repo.upsert(&work_b).await.unwrap();
    let media_file_b = MediaFile {
        id: Uuid::new_v4(),
        work_id: work_b.id,
        leaf_ref: LeafRef::Work,
        path: file_path.clone(),
        container: "mp4".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(1_000_000),
        duration_ms: Some(1_000),
        size_bytes: content.len() as u64,
        source_instance_id: source_instance_b,
        source_file_id: Some("1".to_string()),
    };
    state_b.media_file_repo.create(&media_file_b).await.unwrap();
    state_b.media_files.insert(media_file_b.clone());

    let user_id = Uuid::new_v4();
    seed_streaming_user_with_library_allow(&state_b, user_id, vec![source_instance_b]).await;

    // A live `PlaybackSession` on node B's own registry -- exactly what a
    // real negotiation forward (test 2 above) would have minted; inserted
    // directly here so this test's own focus stays on the proxy byte path
    // rather than re-driving negotiation end-to-end a second time.
    let session_id = Uuid::new_v4();
    state_b
        .app
        .session_registry
        .insert(playarr_model::PlaybackSession {
            id: session_id,
            user_id,
            device_id: Uuid::new_v4(),
            media_file_id: media_file_b.id,
            rendition_id: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
            play_method: playarr_model::PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(1_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(1_000_000),
            client_platform: playarr_model::ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        });

    // ---- The actual request: a real, ranged GET against node A's own
    // proxy route -- node A has never heard of `media_file_b.id` at all. ----
    let http = reqwest::Client::new();
    let response = http
        .get(format!(
            "{base_url_a}/api/v1/media/proxy/{node_b_peer_id}/{}/stream?playback_session_id={session_id}",
            media_file_b.id
        ))
        .header("Range", "bytes=2-5")
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
    let content_range = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .expect("a 206 response must carry Content-Range")
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(content_range, format!("bytes 2-5/{}", content.len()));
    let bytes = response.bytes().await.unwrap();
    assert_eq!(bytes.as_ref(), &content[2..=5]);

    // node B's own registry saw the proxied bytes too -- `peer_stream_media_handler`
    // wraps the response in the same `track_streamed_bytes` a local caller's
    // own `stream_media_handler` request would.
    let tracked = state_b.app.session_registry.get(session_id).unwrap();
    assert_eq!(tracked.bytes_streamed, 4);

    let _ = std::fs::remove_file(&file_path);
}

/// A full (non-`Range`) proxied request returns the whole file with a plain
/// `200`, not a `206` -- the passthrough must not force partial content
/// unconditionally.
#[tokio::test]
async fn proxy_passthrough_returns_full_content_without_a_range_header() {
    let (router_a, state_a) = test_state().await;
    let base_url_a = serve_on_real_tcp(router_a).await;
    let (router_b, state_b) = test_state().await;
    let base_url_b = serve_on_real_tcp(router_b).await;

    let (_group_id, _node_a_peer_id, node_b_peer_id) =
        found_and_join(&state_a, &base_url_a, &state_b, &base_url_b).await;

    let content = b"full content, no range".to_vec();
    let file_path = std::env::temp_dir().join(format!("playarr-proxy-test-{}.bin", Uuid::new_v4()));
    std::fs::write(&file_path, &content).unwrap();

    let source_instance_b = Uuid::new_v4();
    state_b
        .source_instances
        .upsert(sample_source_instance(source_instance_b, Uuid::new_v4()));
    let work_b = sample_work("603");
    state_b.work_repo.upsert(&work_b).await.unwrap();
    let media_file_b = MediaFile {
        id: Uuid::new_v4(),
        work_id: work_b.id,
        leaf_ref: LeafRef::Work,
        path: file_path.clone(),
        container: "mp4".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(1_000_000),
        duration_ms: Some(1_000),
        size_bytes: content.len() as u64,
        source_instance_id: source_instance_b,
        source_file_id: Some("1".to_string()),
    };
    state_b.media_file_repo.create(&media_file_b).await.unwrap();
    state_b.media_files.insert(media_file_b.clone());

    let user_id = Uuid::new_v4();
    seed_streaming_user_with_library_allow(&state_b, user_id, vec![source_instance_b]).await;
    let session_id = Uuid::new_v4();
    state_b
        .app
        .session_registry
        .insert(playarr_model::PlaybackSession {
            id: session_id,
            user_id,
            device_id: Uuid::new_v4(),
            media_file_id: media_file_b.id,
            rendition_id: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
            play_method: playarr_model::PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(1_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(1_000_000),
            client_platform: playarr_model::ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        });

    let http = reqwest::Client::new();
    let response = http
        .get(format!(
            "{base_url_a}/api/v1/media/proxy/{node_b_peer_id}/{}/stream?playback_session_id={session_id}",
            media_file_b.id
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let bytes = response.bytes().await.unwrap();
    assert_eq!(bytes.as_ref(), content.as_slice());

    let _ = std::fs::remove_file(&file_path);
}

/// HLS delegated delivery uses the entry node for every child request while
/// the owner independently validates the signed peer and its own playback
/// capability on each manifest and segment request.
#[tokio::test]
async fn proxy_hls_rewrites_children_and_preserves_owner_authorization_and_file_semantics() {
    let (router_a, state_a) = test_state().await;
    let base_url_a = serve_on_real_tcp(router_a).await;
    let (router_b, state_b) = test_state().await;
    let base_url_b = serve_on_real_tcp(router_b).await;
    let (_group_id, _node_a_peer_id, node_b_peer_id) =
        found_and_join(&state_a, &base_url_a, &state_b, &base_url_b).await;

    let source_instance_b = Uuid::new_v4();
    state_b
        .source_instances
        .upsert(sample_source_instance(source_instance_b, Uuid::new_v4()));
    let work_b = sample_work("604");
    state_b.work_repo.upsert(&work_b).await.unwrap();
    let media_file_b = MediaFile {
        id: Uuid::new_v4(),
        work_id: work_b.id,
        leaf_ref: LeafRef::Work,
        path: std::env::temp_dir().join(format!("playarr-hls-source-{}.mp4", Uuid::new_v4())),
        container: "mp4".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(1_000_000),
        duration_ms: Some(1_000),
        size_bytes: 1_000,
        source_instance_id: source_instance_b,
        source_file_id: Some("1".to_string()),
    };
    state_b.media_file_repo.create(&media_file_b).await.unwrap();
    state_b.media_files.insert(media_file_b.clone());

    let user_id = Uuid::new_v4();
    seed_streaming_user_with_library_allow(&state_b, user_id, vec![source_instance_b]).await;
    let session_id = Uuid::new_v4();
    state_b.app.session_registry.insert(PlaybackSession {
        id: session_id,
        user_id,
        device_id: Uuid::new_v4(),
        media_file_id: media_file_b.id,
        rendition_id: None,
        started_at: chrono::Utc::now(),
        ended_at: None,
        play_method: PlayMethod::Transcode,
        transcode_reason: None,
        source_codec: "h264".to_string(),
        source_container: "mp4".to_string(),
        source_bitrate: Some(1_000_000),
        target_codec: "h264".to_string(),
        target_container: "hls".to_string(),
        target_bitrate: Some(1_000_000),
        client_platform: ClientPlatform::Web,
        client_version: "test".to_string(),
        ip_address: None,
        bytes_streamed: 0,
        buffering_events: 0,
        buffering_ms_total: 0,
        stop_reason: None,
    });

    let output_dir = std::env::temp_dir().join(format!("playarr-hls-rendition-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&output_dir).unwrap();
    std::fs::write(
        output_dir.join("master-index.m3u8"),
        "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://cdn.invalid/keys/key.bin?key=1\"\n#EXTINF:4,\n/root/segment.ts?part=1\n#EXTINF:4,\nvariant.m3u8\n",
    )
    .unwrap();
    std::fs::write(output_dir.join("key.bin"), b"key-data").unwrap();
    std::fs::write(output_dir.join("segment.ts"), b"0123456789").unwrap();
    std::fs::write(
        output_dir.join("variant.m3u8"),
        "#EXTM3U\n#EXTINF:4,\nsegment.ts\n",
    )
    .unwrap();
    let rendition = Rendition {
        id: Uuid::new_v4(),
        media_file_id: media_file_b.id,
        profile: "h264-720p".to_string(),
        container: "hls".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(1_000_000),
        output_path: output_dir.clone(),
        produced_by: ProducedBy::Tdarr,
        produced_at: chrono::Utc::now(),
        status: RenditionStatus::Ready,
    };
    state_b.rendition_repo.upsert(&rendition).await.unwrap();

    let http = reqwest::Client::new();
    let playlist_url = format!(
        "{base_url_a}/api/v1/media/proxy/{node_b_peer_id}/renditions/{}/master-index.m3u8?playback_session_id={session_id}",
        rendition.id
    );
    let playlist = http.get(&playlist_url).send().await.unwrap();
    assert_eq!(playlist.status(), reqwest::StatusCode::OK);
    assert_eq!(
        playlist.headers()[reqwest::header::CONTENT_TYPE],
        "audio/x-mpegurl"
    );
    let playlist = playlist.text().await.unwrap();
    for child in ["key.bin", "segment.ts", "variant.m3u8"] {
        assert!(
            playlist.contains(&format!(
                "/api/v1/media/proxy/{node_b_peer_id}/renditions/{}/{child}",
                rendition.id
            )),
            "playlist did not rewrite {child}: {playlist}"
        );
        assert!(playlist.contains(&format!("playback_session_id={session_id}")));
    }
    assert!(playlist.contains("key=1&playback_session_id="));
    assert!(playlist.contains("segment.ts?part=1&playback_session_id="));

    let segment_url = format!(
        "{base_url_a}/api/v1/media/proxy/{node_b_peer_id}/renditions/{}/segment.ts?playback_session_id={session_id}",
        rendition.id
    );
    let segment = http
        .get(&segment_url)
        .header(reqwest::header::RANGE, "bytes=2-5")
        .send()
        .await
        .unwrap();
    assert_eq!(segment.status(), reqwest::StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        segment.headers()[reqwest::header::CONTENT_RANGE],
        "bytes 2-5/10"
    );
    assert_eq!(segment.bytes().await.unwrap().as_ref(), b"2345");

    let head = http.head(&segment_url).send().await.unwrap();
    assert_eq!(head.status(), reqwest::StatusCode::OK);
    assert_eq!(head.headers()[reqwest::header::CONTENT_LENGTH], "10");
    assert!(head.bytes().await.unwrap().is_empty());

    // The owner endpoint rejects an unsigned caller even with a guessed
    // playback-session capability, and the proxy rejects an unknown owner
    // capability after it signs its delegated request.
    let owner_url = format!(
        "{base_url_b}/api/v1/peer/hls/renditions/{}/master-index.m3u8?playback_session_id={session_id}",
        rendition.id
    );
    assert_eq!(
        http.get(owner_url).send().await.unwrap().status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    let missing_capability_url = format!(
        "{base_url_a}/api/v1/media/proxy/{node_b_peer_id}/renditions/{}/segment.ts",
        rendition.id
    );
    assert!(!http
        .get(missing_capability_url)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    let invalid_capability_url = format!(
        "{base_url_a}/api/v1/media/proxy/{node_b_peer_id}/renditions/{}/segment.ts?playback_session_id={}",
        rendition.id,
        Uuid::new_v4()
    );
    assert_ne!(
        http.get(invalid_capability_url)
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::OK
    );

    let user = state_b
        .user_repo
        .find_by_id(user_id)
        .await
        .unwrap()
        .unwrap();
    let mut policy = state_b
        .policy_repo
        .find_by_id(user.policy_id)
        .await
        .unwrap()
        .unwrap();
    policy.library_allow.clear();
    state_b.policy_repo.upsert(&policy).await.unwrap();
    assert_ne!(
        http.get(segment_url).send().await.unwrap().status(),
        reqwest::StatusCode::OK
    );

    let _ = std::fs::remove_dir_all(&output_dir);
}

/// §5.3's defense in depth: the owning peer independently checks the
/// session's user against *its own* current policy -- a `playback_session_id`
/// that exists but whose owner's policy no longer grants the file's library
/// must still be refused, even though the entry node forwarded the request
/// without objection (the entry node has no way to know either way; it
/// never even resolved a local `MediaFile` for this id at all).
#[tokio::test]
async fn proxy_owning_peer_independently_refuses_a_session_whose_policy_no_longer_grants_access() {
    let (router_a, state_a) = test_state().await;
    let base_url_a = serve_on_real_tcp(router_a).await;
    let (router_b, state_b) = test_state().await;
    let base_url_b = serve_on_real_tcp(router_b).await;

    let (_group_id, _node_a_peer_id, node_b_peer_id) =
        found_and_join(&state_a, &base_url_a, &state_b, &base_url_b).await;

    let file_path = std::env::temp_dir().join(format!("playarr-proxy-test-{}.bin", Uuid::new_v4()));
    std::fs::write(&file_path, b"secret bytes").unwrap();

    let source_instance_b = Uuid::new_v4();
    state_b
        .source_instances
        .upsert(sample_source_instance(source_instance_b, Uuid::new_v4()));
    let work_b = sample_work("603");
    state_b.work_repo.upsert(&work_b).await.unwrap();
    let media_file_b = MediaFile {
        id: Uuid::new_v4(),
        work_id: work_b.id,
        leaf_ref: LeafRef::Work,
        path: file_path.clone(),
        container: "mp4".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(1_000_000),
        duration_ms: Some(1_000),
        size_bytes: 12,
        source_instance_id: source_instance_b,
        source_file_id: Some("1".to_string()),
    };
    state_b.media_file_repo.create(&media_file_b).await.unwrap();
    state_b.media_files.insert(media_file_b.clone());

    // The session's owner is granted access to a *different* library --
    // node B's own state, independently, does not allow this one.
    let user_id = Uuid::new_v4();
    seed_streaming_user_with_library_allow(&state_b, user_id, vec![Uuid::new_v4()]).await;

    let session_id = Uuid::new_v4();
    state_b
        .app
        .session_registry
        .insert(playarr_model::PlaybackSession {
            id: session_id,
            user_id,
            device_id: Uuid::new_v4(),
            media_file_id: media_file_b.id,
            rendition_id: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
            play_method: playarr_model::PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(1_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(1_000_000),
            client_platform: playarr_model::ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        });

    let http = reqwest::Client::new();
    let response = http
        .get(format!(
            "{base_url_a}/api/v1/media/proxy/{node_b_peer_id}/{}/stream?playback_session_id={session_id}",
            media_file_b.id
        ))
        .send()
        .await
        .unwrap();

    // The entry node relays whatever the owning peer decided -- here, a
    // refusal (`ensure_library_allowed`'s 403, surfaced through this node's
    // own `bad_gateway` wrapping since it's reading a non-success upstream
    // response rather than a successful byte stream).
    assert_ne!(response.status(), reqwest::StatusCode::OK);
    assert_ne!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);

    let _ = std::fs::remove_file(&file_path);
}
