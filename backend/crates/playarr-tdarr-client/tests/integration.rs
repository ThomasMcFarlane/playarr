//! Integration-style tests for [`TdarrClient`] against an in-process
//! [`wiremock`] server, asserting real request shapes (method, path,
//! `x-api-key` header, JSON body) and response decoding — including the
//! error path for a non-2xx status.

use serde_json::json;
use playarr_tdarr_client::{
    AlterWorkerLimitRequest, ScanFilesRequest, ScanIndividualFileRequest, SearchDbQuery,
    TdarrClient, TdarrClientError,
};
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const API_KEY: &str = "test-api-key";

async fn client_against(server: &MockServer) -> TdarrClient {
    TdarrClient::new(server.uri(), API_KEY)
}

#[tokio::test]
async fn scan_individual_file_sends_expected_request_and_parses_response() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/v2/scan-individual-file"))
        .and(header("x-api-key", API_KEY))
        .and(body_json(json!({
            "db_id": "lib-1",
            "file_path": "/media/movies/Example.mkv",
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "status": "success",
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_against(&server).await;
    let response = client
        .scan_individual_file(&ScanIndividualFileRequest {
            db_id: "lib-1".to_string(),
            file_path: "/media/movies/Example.mkv".to_string(),
        })
        .await
        .expect("mock server returned 200 with a well-formed body");

    assert_eq!(response.status, "success");
}

#[tokio::test]
async fn scan_files_posts_full_scan_flag_and_treats_2xx_as_success() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/v2/scan-files"))
        .and(header("x-api-key", API_KEY))
        .and(body_json(json!({
            "db_id": "lib-1",
            "full_scan": true,
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"status": "ok"})))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_against(&server).await;
    client
        .scan_files(&ScanFilesRequest {
            db_id: "lib-1".to_string(),
            full_scan: true,
        })
        .await
        .expect("2xx response should decode as success");
}

#[tokio::test]
async fn search_db_parses_file_records_including_optional_transcode_decision() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/v2/search-db"))
        .and(header("x-api-key", API_KEY))
        .and(body_json(json!({
            "db_id": "lib-1",
            "search_text": "Example.mkv",
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {
                "_id": "abc123",
                "file": "/media/movies/Example.mkv",
                "container": "mkv",
                "TranscodeDecisionMaker": "transcode",
            },
            {
                "_id": "def456",
                "file": "/media/movies/Other.mp4",
                "container": "mp4",
            },
        ])))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_against(&server).await;
    let records = client
        .search_db(&SearchDbQuery {
            db_id: "lib-1".to_string(),
            search_text: "Example.mkv".to_string(),
        })
        .await
        .expect("mock server returned a well-formed array");

    assert_eq!(records.len(), 2);
    assert_eq!(records[0].id, "abc123");
    assert_eq!(records[0].file, "/media/movies/Example.mkv");
    assert_eq!(records[0].container, "mkv");
    assert_eq!(records[0].transcode_decision.as_deref(), Some("transcode"));
    // `TranscodeDecisionMaker` is absent on the second record — `#[serde(default)]`
    // must decode that as `None` rather than failing.
    assert_eq!(records[1].transcode_decision, None);
}

#[tokio::test]
async fn get_nodes_issues_a_get_request_and_parses_node_list() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/v2/get-nodes"))
        .and(header("x-api-key", API_KEY))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {
                "nodeID": "node-1",
                "nodeName": "worker-a",
                "workers": {
                    "worker-abc": { "file": "/media/x.mkv", "percentage": 42 },
                },
            },
        ])))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_against(&server).await;
    let nodes = client
        .get_nodes()
        .await
        .expect("mock server returned a well-formed node list");

    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].node_id, "node-1");
    assert_eq!(nodes[0].node_name, "worker-a");
    assert!(nodes[0].workers.get("worker-abc").is_some());
}

#[tokio::test]
async fn alter_worker_limit_posts_expected_body_and_ignores_response_body() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/v2/alter-worker-limit"))
        .and(header("x-api-key", API_KEY))
        .and(body_json(json!({
            "nodeID": "node-1",
            "process": "transcodecpu",
            "worker_limit": 1,
        })))
        .respond_with(ResponseTemplate::new(200).set_body_string("OK"))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_against(&server).await;
    client
        .alter_worker_limit(&AlterWorkerLimitRequest {
            node_id: "node-1".to_string(),
            process: "transcodecpu".to_string(),
            worker_limit: 1,
        })
        .await
        .expect("2xx response should be treated as success even with a non-JSON body");
}

#[tokio::test]
async fn search_db_surfaces_non_2xx_status_and_body_as_an_error() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/v2/search-db"))
        .respond_with(ResponseTemplate::new(404).set_body_string("db not found"))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_against(&server).await;
    let error = client
        .search_db(&SearchDbQuery {
            db_id: "missing-lib".to_string(),
            search_text: "anything".to_string(),
        })
        .await
        .expect_err("a 404 response must not be decoded as a successful result");

    match error {
        TdarrClientError::UnexpectedStatus { status, body } => {
            assert_eq!(status, 404);
            assert_eq!(body, "db not found");
        }
        other => panic!("expected UnexpectedStatus, got {other:?}"),
    }
}

#[tokio::test]
async fn alter_worker_limit_surfaces_non_2xx_status_as_an_error() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/v2/alter-worker-limit"))
        .respond_with(ResponseTemplate::new(500).set_body_string("internal error"))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_against(&server).await;
    let error = client
        .alter_worker_limit(&AlterWorkerLimitRequest {
            node_id: "node-1".to_string(),
            process: "transcodecpu".to_string(),
            worker_limit: 2,
        })
        .await
        .expect_err("a 500 response must surface as an error, not Ok(())");

    match error {
        TdarrClientError::UnexpectedStatus { status, body } => {
            assert_eq!(status, 500);
            assert_eq!(body, "internal error");
        }
        other => panic!("expected UnexpectedStatus, got {other:?}"),
    }
}

#[tokio::test]
async fn get_nodes_surfaces_malformed_json_as_a_decode_error() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/v2/get-nodes"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .expect(1)
        .mount(&server)
        .await;

    let client = client_against(&server).await;
    let error = client
        .get_nodes()
        .await
        .expect_err("a 200 with a non-JSON body must not be treated as a valid node list");

    assert!(matches!(error, TdarrClientError::Decode(_)));
}

#[tokio::test]
async fn base_url_with_trailing_slash_does_not_produce_a_double_slash_path() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/v2/get-nodes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(1)
        .mount(&server)
        .await;

    let base_url_with_slash = format!("{}/", server.uri());
    let client = TdarrClient::new(base_url_with_slash, API_KEY);

    let nodes = client
        .get_nodes()
        .await
        .expect("trailing slash on base_url must be normalized before joining the path");
    assert!(nodes.is_empty());
}
