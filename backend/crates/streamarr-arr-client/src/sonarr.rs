use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use streamarr_model::Sensitive;

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// A series as Sonarr's `/api/v3/series` endpoint returns it. Deliberately
/// a small, hand-picked subset of Sonarr's actual (much larger) response —
/// just enough for `streamarr-arr-sync` to reconcile identity and
/// monitoring state. Add fields as sync actually needs them rather than
/// mirroring Sonarr's full schema speculatively.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarrSeries {
    pub id: i64,
    pub title: String,
    #[serde(rename = "sortTitle")]
    pub sort_title: String,
    #[serde(rename = "tvdbId")]
    pub tvdb_id: i64,
    pub monitored: bool,
    pub status: String,
    pub path: String,
}

pub struct SonarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl SonarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `GET /api/v3/series` — every series Sonarr currently tracks.
    pub async fn list_series(&self) -> Result<Vec<SonarrSeries>, ArrClientError> {
        get_json(
            &self.http,
            "sonarr",
            &self.base_url,
            &self.api_key,
            "/api/v3/series",
        )
        .await
    }

    /// `GET /api/v3/series/{id}` — a single series by Sonarr's own id.
    /// Used by the reconciliation poller's targeted re-fetch after a
    /// webhook signals that one series changed, instead of re-listing all
    /// of them.
    pub async fn get_series(&self, id: i64) -> Result<SonarrSeries, ArrClientError> {
        get_json(
            &self.http,
            "sonarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v3/series/{id}"),
        )
        .await
    }
}

#[async_trait]
impl ArrConnector for SonarrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "sonarr",
            &self.base_url,
            &self.api_key,
            "/api/v3/system/status",
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
    async fn list_series_parses_response_and_sends_api_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/series"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "title": "Test Series Q",
                    "sortTitle": "test series q",
                    "tvdbId": 81189,
                    "monitored": true,
                    "status": "ended",
                    "path": "/tv/Test Series Q"
                }
            ])))
            .mount(&server)
            .await;

        let client = SonarrClient::new(server.uri(), "test-key");
        let series = client
            .list_series()
            .await
            .expect("list_series should succeed against a healthy mock");

        assert_eq!(series.len(), 1);
        assert_eq!(series[0].title, "Test Series Q");
        assert_eq!(series[0].tvdb_id, 81189);
        assert!(series[0].monitored);
    }

    #[tokio::test]
    async fn get_series_parses_single_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/series/42"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 42,
                "title": "Test Series U",
                "sortTitle": "wire",
                "tvdbId": 79126,
                "monitored": false,
                "status": "ended",
                "path": "/tv/Test Series U"
            })))
            .mount(&server)
            .await;

        let client = SonarrClient::new(server.uri(), "test-key");
        let series = client
            .get_series(42)
            .await
            .expect("get_series should succeed against a healthy mock");

        assert_eq!(series.id, 42);
        assert_eq!(series.title, "Test Series U");
        assert!(!series.monitored);
    }

    #[tokio::test]
    async fn health_check_succeeds_on_200() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/system/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "version": "4.0.0.0"
            })))
            .mount(&server)
            .await;

        let client = SonarrClient::new(server.uri(), "test-key");
        client
            .health_check()
            .await
            .expect("health_check should succeed on a 200 response");
    }

    #[tokio::test]
    async fn health_check_surfaces_401_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/system/status"))
            .respond_with(ResponseTemplate::new(401).set_body_string("Unauthorized"))
            .mount(&server)
            .await;

        let client = SonarrClient::new(server.uri(), "wrong-key");
        let err = client
            .health_check()
            .await
            .expect_err("a 401 status should surface as an error, not Ok");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "sonarr");
                assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_series_surfaces_500_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/series"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&server)
            .await;

        let client = SonarrClient::new(server.uri(), "test-key");
        let err = client
            .list_series()
            .await
            .expect_err("a 500 status should surface as an error, not panic");

        match err {
            ArrClientError::UnexpectedStatus { app, status, body } => {
                assert_eq!(app, "sonarr");
                assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
                assert_eq!(body, "Internal Server Error");
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }
}
