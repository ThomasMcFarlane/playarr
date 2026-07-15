use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use streamarr_model::Sensitive;

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// A movie as Radarr's `/api/v3/movie` endpoint returns it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrMovie {
    pub id: i64,
    pub title: String,
    #[serde(rename = "sortTitle")]
    pub sort_title: String,
    #[serde(rename = "tmdbId")]
    pub tmdb_id: i64,
    pub monitored: bool,
    #[serde(rename = "hasFile")]
    pub has_file: bool,
    pub path: String,
}

pub struct RadarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl RadarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `GET /api/v3/movie` — every movie Radarr currently tracks.
    pub async fn list_movies(&self) -> Result<Vec<RadarrMovie>, ArrClientError> {
        get_json(
            &self.http,
            "radarr",
            &self.base_url,
            &self.api_key,
            "/api/v3/movie",
        )
        .await
    }

    /// `GET /api/v3/movie/{id}` — a single movie by Radarr's own id.
    pub async fn get_movie(&self, id: i64) -> Result<RadarrMovie, ArrClientError> {
        get_json(
            &self.http,
            "radarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v3/movie/{id}"),
        )
        .await
    }
}

#[async_trait]
impl ArrConnector for RadarrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "radarr",
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
    async fn list_movies_parses_response_and_sends_api_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "title": "Orbit",
                    "sortTitle": "heat",
                    "tmdbId": 949,
                    "monitored": true,
                    "hasFile": true,
                    "path": "/movies/Orbit (1995)"
                }
            ])))
            .mount(&server)
            .await;

        let client = RadarrClient::new(server.uri(), "test-key");
        let movies = client
            .list_movies()
            .await
            .expect("list_movies should succeed against a healthy mock");

        assert_eq!(movies.len(), 1);
        assert_eq!(movies[0].title, "Orbit");
        assert_eq!(movies[0].tmdb_id, 949);
        assert!(movies[0].has_file);
    }

    #[tokio::test]
    async fn get_movie_parses_single_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/7"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 7,
                "title": "Sample Seven",
                "sortTitle": "sampleseven",
                "tmdbId": 807,
                "monitored": true,
                "hasFile": false,
                "path": "/movies/Sample Seven (1995)"
            })))
            .mount(&server)
            .await;

        let client = RadarrClient::new(server.uri(), "test-key");
        let movie = client
            .get_movie(7)
            .await
            .expect("get_movie should succeed against a healthy mock");

        assert_eq!(movie.id, 7);
        assert_eq!(movie.title, "Sample Seven");
        assert!(!movie.has_file);
    }

    #[tokio::test]
    async fn health_check_succeeds_on_200() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/system/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "version": "5.0.0.0"
            })))
            .mount(&server)
            .await;

        let client = RadarrClient::new(server.uri(), "test-key");
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

        let client = RadarrClient::new(server.uri(), "wrong-key");
        let err = client
            .health_check()
            .await
            .expect_err("a 401 status should surface as an error, not Ok");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "radarr");
                assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_movies_surfaces_500_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&server)
            .await;

        let client = RadarrClient::new(server.uri(), "test-key");
        let err = client
            .list_movies()
            .await
            .expect_err("a 500 status should surface as an error, not panic");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "radarr");
                assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }
}
