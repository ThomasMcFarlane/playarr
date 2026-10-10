//! Client for the public series metadata service Sonarr itself uses
//! (`/v1/tvdb/shows/{language}/{tvdbId}`, keyless). Sonarr's own API does
//! not expose a series' cast, so this is the series cast source: the same
//! upstream data Sonarr shows in its own metadata exports. A failure here
//! only means "no cast yet", never a failed library sync.

use serde::Deserialize;

use crate::http::build_http_client;
use crate::ArrClientError;

/// Default service base URL; overridable so tests and deployments behind a
/// mirror can point elsewhere.
pub const DEFAULT_SKYHOOK_URL: &str = "https://skyhook.sonarr.tv";

const APP: &str = "series-metadata";

/// The service answers 400 "invalid request" to a request with no
/// `User-Agent` header (reqwest sends none by default), so always send one.
const USER_AGENT: &str = concat!("Playarr/", env!("CARGO_PKG_VERSION"));

/// One cast entry of a series.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SeriesActor {
    pub name: String,
    #[serde(default)]
    pub character: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ShowResponse {
    #[serde(default)]
    actors: Vec<SeriesActor>,
}

#[derive(Clone)]
pub struct SeriesCastClient {
    base_url: String,
    http: reqwest::Client,
}

impl SeriesCastClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .build()
                .unwrap_or_else(|_| build_http_client()),
        }
    }

    fn show_url(&self, tvdb_id: i64) -> String {
        format!("{}/v1/tvdb/shows/en/{tvdb_id}", self.base_url)
    }

    /// The series' cast in billing order. Entries without a name are dropped.
    pub async fn list_cast(&self, tvdb_id: i64) -> Result<Vec<SeriesActor>, ArrClientError> {
        let url = self.show_url(tvdb_id);
        let response = self
            .http
            .get(&url)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ArrClientError::UnexpectedStatus {
                app: APP,
                status,
                body,
            });
        }
        let bytes = response.bytes().await?;
        let show: ShowResponse = serde_json::from_slice(&bytes)
            .map_err(|source| ArrClientError::Decode { app: APP, source })?;
        Ok(show
            .actors
            .into_iter()
            .filter(|a| !a.name.trim().is_empty())
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn list_cast_parses_actors_and_drops_unnamed() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/tvdb/shows/en/77"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "title": "Sample Series 1",
                "actors": [
                    {"name": "Sample Actor A", "character": "Role A", "image": "https://example.com/a.jpg"},
                    {"name": " ", "character": "Nobody"},
                    {"name": "Sample Actor B"}
                ]
            })))
            .mount(&server)
            .await;
        let cast = SeriesCastClient::new(&server.uri())
            .list_cast(77)
            .await
            .unwrap();
        assert_eq!(cast.len(), 2);
        assert_eq!(cast[0].character.as_deref(), Some("Role A"));
        assert_eq!(cast[1].image, None);
    }

    #[tokio::test]
    async fn list_cast_reports_a_missing_series() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let err = SeriesCastClient::new(&server.uri())
            .list_cast(1)
            .await
            .unwrap_err();
        assert!(matches!(err, ArrClientError::UnexpectedStatus { .. }));
    }

    #[tokio::test]
    async fn list_cast_sends_the_exact_url_and_a_user_agent() {
        let server = MockServer::start().await;
        // Only a request with this path, no query and a Playarr user agent
        // matches; anything else gets wiremock's 404 and fails the test.
        Mock::given(method("GET"))
            .and(path("/v1/tvdb/shows/en/268592"))
            .and(header("user-agent", USER_AGENT))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"actors": []})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let client = SeriesCastClient::new(&format!("{}/", server.uri()));
        assert_eq!(
            client.show_url(268592),
            format!("{}/v1/tvdb/shows/en/268592", server.uri())
        );
        assert!(USER_AGENT.starts_with("Playarr/"));
        client.list_cast(268592).await.unwrap();
        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].url.query(), None);
    }

    /// Opt-in: hits the real service. Run with
    /// `cargo test -p playarr-arr-client -- --ignored live_smoke`.
    #[tokio::test]
    #[ignore = "contacts the real series metadata service"]
    async fn live_smoke_returns_cast_for_known_series() {
        let client = SeriesCastClient::new(DEFAULT_SKYHOOK_URL);
        for tvdb_id in [268592_i64, 121361, 81189] {
            let cast = client
                .list_cast(tvdb_id)
                .await
                .unwrap_or_else(|e| panic!("tvdb {tvdb_id}: {e}"));
            assert!(!cast.is_empty(), "tvdb {tvdb_id} returned no cast");
        }
    }
}
