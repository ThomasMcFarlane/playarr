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
            http: build_http_client(),
        }
    }

    /// The series' cast in billing order. Entries without a name are dropped.
    pub async fn list_cast(&self, tvdb_id: i64) -> Result<Vec<SeriesActor>, ArrClientError> {
        let url = format!("{}/v1/tvdb/shows/en/{tvdb_id}", self.base_url);
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
    use wiremock::matchers::{method, path};
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
}
