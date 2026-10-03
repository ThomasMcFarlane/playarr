use async_trait::async_trait;
use playarr_model::Sensitive;
use serde::{Deserialize, Serialize};

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// An indexer as Prowlarr's `/api/v1/indexer` endpoint returns it. Prowlarr
/// is the odd one out among the six clients here: it doesn't track media
/// (series/movies/artists/authors) at all, it aggregates search indexers on
/// behalf of the other *arr apps — so its "representative listing method"
/// is indexers, not a media resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProwlarrIndexer {
    pub id: i64,
    pub name: String,
    pub enable: bool,
    /// `"torrent"` or `"usenet"`.
    pub protocol: String,
    pub priority: i64,
}

pub struct ProwlarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl ProwlarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `GET /api/v1/indexer` — every indexer Prowlarr currently manages.
    pub async fn list_indexers(&self) -> Result<Vec<ProwlarrIndexer>, ArrClientError> {
        get_json(
            &self.http,
            "prowlarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/indexer",
        )
        .await
    }

    /// `GET /api/v1/indexer/{id}` — a single indexer by Prowlarr's own id.
    pub async fn get_indexer(&self, id: i64) -> Result<ProwlarrIndexer, ArrClientError> {
        get_json(
            &self.http,
            "prowlarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/indexer/{id}"),
        )
        .await
    }
}

#[async_trait]
impl ArrConnector for ProwlarrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "prowlarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/system/status",
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    #[tokio::test]
    async fn list_indexers_parses_response_and_sends_api_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/indexer"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "name": "1337x",
                    "enable": true,
                    "protocol": "torrent",
                    "priority": 25
                }
            ])))
            .mount(&server)
            .await;

        let client = ProwlarrClient::new(server.uri(), "test-key");
        let indexers = client
            .list_indexers()
            .await
            .expect("list_indexers should succeed against a healthy mock");

        assert_eq!(indexers.len(), 1);
        assert_eq!(indexers[0].name, "1337x");
        assert_eq!(indexers[0].protocol, "torrent");
    }

    #[tokio::test]
    async fn get_indexer_parses_single_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/indexer/3"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 3,
                "name": "NZBgeek",
                "enable": true,
                "protocol": "usenet",
                "priority": 10
            })))
            .mount(&server)
            .await;

        let client = ProwlarrClient::new(server.uri(), "test-key");
        let indexer = client
            .get_indexer(3)
            .await
            .expect("get_indexer should succeed against a healthy mock");

        assert_eq!(indexer.id, 3);
        assert_eq!(indexer.protocol, "usenet");
    }

    #[tokio::test]
    async fn health_check_succeeds_on_200() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/system/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "version": "1.0.0.0"
            })))
            .mount(&server)
            .await;

        let client = ProwlarrClient::new(server.uri(), "test-key");
        client
            .health_check()
            .await
            .expect("health_check should succeed on a 200 response");
    }

    #[tokio::test]
    async fn health_check_surfaces_401_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/system/status"))
            .respond_with(ResponseTemplate::new(401).set_body_string("Unauthorized"))
            .mount(&server)
            .await;

        let client = ProwlarrClient::new(server.uri(), "wrong-key");
        let err = client
            .health_check()
            .await
            .expect_err("a 401 status should surface as an error, not Ok");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "prowlarr");
                assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_indexers_surfaces_500_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/indexer"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&server)
            .await;

        let client = ProwlarrClient::new(server.uri(), "test-key");
        let err = client
            .list_indexers()
            .await
            .expect_err("a 500 status should surface as an error, not panic");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "prowlarr");
                assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }
}
