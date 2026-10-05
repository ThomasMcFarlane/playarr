use chrono::Utc;
use playarr_model::{
    DeliveryMode, GroupLibrary, NodeIdentity, PeerGroup, PeerNode, PeerNodeStatus, Sensitive,
    SourceInstance, SourceKind,
};
use serde_json::json;
use uuid::Uuid;

use crate::test_support::{
    bearer_header, mint_access_token, seed_admin_user, seed_streaming_user, test_state,
};

#[tokio::test]
async fn admin_streaming_configuration_is_authenticated_group_scoped_and_redacted() {
    let (router, state) = test_state().await;
    let admin_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_admin_user(&state, admin_id).await;
    seed_streaming_user(&state, member_id).await;
    let admin_token = mint_access_token(&state, admin_id);
    let member_token = mint_access_token(&state, member_id);

    let group_id = Uuid::new_v4();
    let peer_id = Uuid::new_v4();
    state
        .app
        .peer_group_repo
        .create(&PeerGroup {
            id: group_id,
            name: "Home".into(),
            created_at: Utc::now(),
        })
        .await
        .unwrap();
    state
        .app
        .node_identity_repo
        .put(&NodeIdentity {
            peer_id,
            private_key: Sensitive::new("test-key".to_owned()),
            group_id: Some(group_id),
            created_at: Utc::now(),
        })
        .await
        .unwrap();
    state
        .app
        .peer_node_repo
        .upsert(&PeerNode {
            id: peer_id,
            group_id,
            name: "Home".into(),
            addresses: vec![],
            public_key: "test-public-key".into(),
            is_self: true,
            status: PeerNodeStatus::Active,
            last_seen_at: None,
            last_sync_error: None,
            joined_at: Utc::now(),
            updated_at: Utc::now(),
        })
        .await
        .unwrap();

    use tower::ServiceExt;
    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/v1/admin/group-libraries")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);

    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/v1/admin/group-libraries")
                .header("authorization", bearer_header(&member_token))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(r#"{"name":"Movies"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);

    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/v1/admin/group-libraries")
                .header("authorization", bearer_header(&admin_token))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(r#"{"name":"Movies"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::CREATED);
    let library: GroupLibrary = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(library.group_id, group_id);

    let foreign_group_id = Uuid::new_v4();
    state
        .app
        .peer_group_repo
        .create(&PeerGroup {
            id: foreign_group_id,
            name: "Other home".into(),
            created_at: Utc::now(),
        })
        .await
        .unwrap();
    let foreign_library_id = Uuid::new_v4();
    state
        .app
        .group_library_repo
        .upsert(&GroupLibrary {
            id: foreign_library_id,
            group_id: foreign_group_id,
            name: "Private".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
        .await
        .unwrap();
    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("PUT")
                .uri(format!(
                    "/api/v1/admin/group-libraries/{foreign_library_id}"
                ))
                .header("authorization", bearer_header(&admin_token))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(r#"{"name":"Renamed"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);

    let source_id = Uuid::new_v4();
    let source = SourceInstance {
        id: source_id,
        kind: SourceKind::Radarr,
        name: "Local Radarr".into(),
        base_url: "https://radarr.local".into(),
        api_key_encrypted: Sensitive::new("never-return-this-secret".into()),
        priority: 3,
        default_root_folder_id: Some("root-1".into()),
        folder_mappings: Default::default(),
        default_quality_profile_id: Some(7),
        best_effort: true,
        group_library_id: None,
    };
    state.source_instances.upsert(source.clone());
    state
        .app
        .source_instance_repo
        .upsert(&source)
        .await
        .unwrap();
    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("PUT")
                .uri(format!(
                    "/api/v1/admin/source-instances/{source_id}/group-library"
                ))
                .header("authorization", bearer_header(&admin_token))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    json!({"group_library_id": foreign_library_id}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);

    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("PUT")
                .uri(format!(
                    "/api/v1/admin/source-instances/{source_id}/group-library"
                ))
                .header("authorization", bearer_header(&admin_token))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    json!({"group_library_id": library.id}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let mapping: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(mapping["source_instance_id"], source_id.to_string());
    assert_eq!(mapping["group_library_id"], library.id.to_string());
    assert!(!String::from_utf8_lossy(&body).contains("never-return-this-secret"));
    let stored_source = state
        .app
        .source_instance_repo
        .get(source_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored_source.name, source.name);
    assert_eq!(stored_source.base_url, source.base_url);
    assert_eq!(stored_source.api_key_encrypted, source.api_key_encrypted);
    assert_eq!(stored_source.group_library_id, Some(library.id));
    assert_eq!(
        state
            .source_instances
            .get(source_id)
            .unwrap()
            .group_library_id,
        Some(library.id)
    );

    let create_rule = json!({
        "group_library_id": library.id,
        "user_id": state.default_user_id,
        "priority": 8,
        "preferred_nodes": [peer_id],
        "delivery_mode": "proxy"
    });
    let mut foreign_rule = create_rule.clone();
    foreign_rule["group_library_id"] = json!(foreign_library_id);
    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/v1/admin/routing-rules")
                .header("authorization", bearer_header(&admin_token))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(foreign_rule.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);

    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/v1/admin/routing-rules")
                .header("authorization", bearer_header(&admin_token))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(create_rule.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::CREATED);
    let mut rule: playarr_model::RoutingRule = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(rule.group_id, group_id);
    assert_eq!(rule.delivery_mode, DeliveryMode::Proxy);

    rule.priority = 10;
    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/admin/routing-rules/{}", rule.id))
                .header("authorization", bearer_header(&admin_token))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    json!({
                        "group_library_id": library.id,
                        "user_id": state.default_user_id,
                        "priority": rule.priority,
                        "preferred_nodes": [peer_id],
                        "delivery_mode": "redirect"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let updated: playarr_model::RoutingRule = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(updated.priority, 10);
    assert_eq!(updated.delivery_mode, DeliveryMode::Redirect);

    let response = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/admin/routing-rules/{}", rule.id))
                .header("authorization", bearer_header(&admin_token))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    json!({
                        "group_library_id": library.id,
                        "user_id": state.default_user_id,
                        "priority": rule.priority,
                        "preferred_nodes": [],
                        "delivery_mode": "redirect"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let disabled: playarr_model::RoutingRule = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(disabled.preferred_nodes.is_empty());
    let delta = state
        .app
        .routing_rule_repo
        .list_updated_since(group_id, Some(rule.created_at))
        .await
        .unwrap();
    assert_eq!(delta.len(), 1);
    assert!(delta[0].preferred_nodes.is_empty());

    let response = router
        .oneshot(
            axum::http::Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/admin/routing-rules/{}", rule.id))
                .header("authorization", bearer_header(&admin_token))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        axum::http::StatusCode::METHOD_NOT_ALLOWED
    );
    assert!(state
        .app
        .routing_rule_repo
        .get(rule.id)
        .await
        .unwrap()
        .unwrap()
        .preferred_nodes
        .is_empty());
}
