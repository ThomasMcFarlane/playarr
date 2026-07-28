use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use playarr_model::Sensitive;

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// A series as Bazarr's `/api/series` endpoint returns it. Bazarr manages
/// subtitles for series Sonarr already tracks (and movies Radarr already
/// tracks) rather than owning a media library of its own, so its DTOs
/// carry subtitle-completeness fields Sonarr's don't.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BazarrSeries {
    pub id: i64,
    pub title: String,
    pub path: String,
    pub monitored: bool,
    pub episode_file_count: i64,
    pub episode_missing_subtitles_count: i64,
}

/// One subtitle language Bazarr is missing for an episode, as embedded in
/// `/api/episodes/wanted`'s `missing_subtitles` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BazarrSubtitleLanguage {
    /// ISO 639-1 two-letter language code, e.g. `"en"`.
    pub code2: String,
    pub name: String,
}

/// One entry in Bazarr's own `missing subtitles` worklist. This is Bazarr's
/// actual reason for existing (unlike Sonarr/Radarr/Lidarr/Readarr, it
/// doesn't own a media library — it tracks subtitle completeness for the
/// episodes/movies those apps already track), so this is the "representative
/// listing method" for this client rather than a plain series/movie list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BazarrWantedEpisode {
    #[serde(rename = "sonarrSeriesId")]
    pub sonarr_series_id: i64,
    #[serde(rename = "sonarrEpisodeId")]
    pub sonarr_episode_id: i64,
    #[serde(rename = "seriesTitle")]
    pub series_title: String,
    #[serde(rename = "episodeTitle")]
    pub episode_title: String,
    pub missing_subtitles: Vec<BazarrSubtitleLanguage>,
}

/// Bazarr's wanted-subtitle endpoints wrap their array in a `data`/`total`
/// envelope (for pagination) rather than returning a bare JSON array like
/// Sonarr/Radarr/Lidarr/Readarr do.
#[derive(Debug, Clone, Deserialize)]
struct BazarrPaged<T> {
    data: Vec<T>,
}

pub struct BazarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl BazarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `GET /api/series` — every series Bazarr is tracking subtitles for.
    pub async fn list_series(&self) -> Result<Vec<BazarrSeries>, ArrClientError> {
        get_json(
            &self.http,
            "bazarr",
            &self.base_url,
            &self.api_key,
            "/api/series",
        )
        .await
    }

    /// `GET /api/series?seriesid[]={id}` — Bazarr's series endpoint takes
    /// the filter as a query parameter rather than a path segment, unlike
    /// Sonarr/Radarr/Lidarr/Readarr's `/{id}` REST convention.
    pub async fn get_series(&self, id: i64) -> Result<BazarrSeries, ArrClientError> {
        let mut series: Vec<BazarrSeries> = get_json(
            &self.http,
            "bazarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/series?seriesid[]={id}"),
        )
        .await?;
        series
            .pop()
            .ok_or_else(|| ArrClientError::UnexpectedStatus {
                app: "bazarr",
                status: reqwest::StatusCode::NOT_FOUND,
                body: format!("no series with id {id}"),
            })
    }

    /// `GET /api/episodes/wanted` — episodes with at least one missing
    /// subtitle language, Bazarr's own equivalent of a "catalog listing"
    /// endpoint. `start=0&length=-1` asks Bazarr for the unpaginated full
    /// list rather than its UI-oriented default page size.
    pub async fn list_wanted_subtitles(&self) -> Result<Vec<BazarrWantedEpisode>, ArrClientError> {
        let page: BazarrPaged<BazarrWantedEpisode> = get_json(
            &self.http,
            "bazarr",
            &self.base_url,
            &self.api_key,
            "/api/episodes/wanted?start=0&length=-1",
        )
        .await?;
        Ok(page.data)
    }
}

#[async_trait]
impl ArrConnector for BazarrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "bazarr",
            &self.base_url,
            &self.api_key,
            "/api/system/status",
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    #[tokio::test]
    async fn list_series_parses_response_and_sends_api_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/series"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "title": "Test Series C",
                    "path": "/tv/Test Series C",
                    "monitored": true,
                    "episode_file_count": 5,
                    "episode_missing_subtitles_count": 2
                }
            ])))
            .mount(&server)
            .await;

        let client = BazarrClient::new(server.uri(), "test-key");
        let series = client
            .list_series()
            .await
            .expect("list_series should succeed against a healthy mock");

        assert_eq!(series.len(), 1);
        assert_eq!(series[0].title, "Test Series C");
        assert_eq!(series[0].episode_missing_subtitles_count, 2);
    }

    #[tokio::test]
    async fn get_series_filters_by_query_param_and_returns_single_item() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/series"))
            .and(query_param("seriesid[]", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "title": "Test Series C",
                    "path": "/tv/Test Series C",
                    "monitored": true,
                    "episode_file_count": 5,
                    "episode_missing_subtitles_count": 2
                }
            ])))
            .mount(&server)
            .await;

        let client = BazarrClient::new(server.uri(), "test-key");
        let series = client
            .get_series(1)
            .await
            .expect("get_series should succeed against a healthy mock");

        assert_eq!(series.id, 1);
        assert_eq!(series.title, "Test Series C");
    }

    #[tokio::test]
    async fn get_series_returns_not_found_when_bazarr_returns_empty_array() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/series"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let client = BazarrClient::new(server.uri(), "test-key");
        let err = client
            .get_series(999)
            .await
            .expect_err("an empty array from Bazarr should surface as an error, not panic");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "bazarr");
                assert_eq!(status, reqwest::StatusCode::NOT_FOUND);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_wanted_subtitles_parses_paginated_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/episodes/wanted"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [
                    {
                        "sonarrSeriesId": 1,
                        "sonarrEpisodeId": 10,
                        "seriesTitle": "Test Series C",
                        "episodeTitle": "1:23:45",
                        "missing_subtitles": [
                            { "code2": "en", "name": "English" },
                            { "code2": "fr", "name": "French" }
                        ]
                    }
                ],
                "total": 1
            })))
            .mount(&server)
            .await;

        let client = BazarrClient::new(server.uri(), "test-key");
        let wanted = client
            .list_wanted_subtitles()
            .await
            .expect("list_wanted_subtitles should succeed against a healthy mock");

        assert_eq!(wanted.len(), 1);
        assert_eq!(wanted[0].series_title, "Test Series C");
        assert_eq!(wanted[0].missing_subtitles.len(), 2);
        assert_eq!(wanted[0].missing_subtitles[0].code2, "en");
    }

    #[tokio::test]
    async fn health_check_surfaces_401_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/system/status"))
            .respond_with(ResponseTemplate::new(401).set_body_string("Unauthorized"))
            .mount(&server)
            .await;

        let client = BazarrClient::new(server.uri(), "wrong-key");
        let err = client
            .health_check()
            .await
            .expect_err("a 401 status should surface as an error, not Ok");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "bazarr");
                assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_wanted_subtitles_surfaces_500_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/episodes/wanted"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&server)
            .await;

        let client = BazarrClient::new(server.uri(), "test-key");
        let err = client
            .list_wanted_subtitles()
            .await
            .expect_err("a 500 status should surface as an error, not panic");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "bazarr");
                assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }
}
