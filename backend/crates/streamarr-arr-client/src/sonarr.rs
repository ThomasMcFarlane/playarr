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

/// An episode as Sonarr's `/api/v3/episode` endpoint returns it. Carries
/// `episode_file_id` (0 when no file is imported yet) so callers can join
/// against [`SonarrEpisodeFile::id`] without a second round trip per
/// episode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarrEpisode {
    pub id: i64,
    #[serde(rename = "seriesId")]
    pub series_id: i64,
    #[serde(rename = "seasonNumber")]
    pub season_number: i64,
    #[serde(rename = "episodeNumber")]
    pub episode_number: i64,
    pub title: String,
    #[serde(rename = "hasFile")]
    pub has_file: bool,
    pub monitored: bool,
    /// Sonarr uses `0` (not `null`) as the "no file imported" sentinel, so
    /// this deliberately stays a plain `i64` rather than `Option<i64>` to
    /// mirror the wire format exactly.
    #[serde(rename = "episodeFileId")]
    pub episode_file_id: i64,
}

/// The nested `quality.quality` object on Sonarr's quality-bearing
/// resources (episode files, movie files, etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarrQualityInfo {
    pub id: i64,
    pub name: String,
    pub source: String,
    pub resolution: i64,
}

/// The nested `quality.revision` object — repack/proper tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarrRevision {
    pub version: i64,
    pub real: i64,
    #[serde(rename = "isRepack")]
    pub is_repack: bool,
}

/// The `quality` object embedded in an episode file: which quality profile
/// tier matched, plus repack/proper revision info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarrQuality {
    pub quality: SonarrQualityInfo,
    pub revision: SonarrRevision,
}

/// The `mediaInfo` object embedded in an episode file — ffprobe-derived
/// codec/bitrate detail. Sonarr omits or nulls individual fields it
/// couldn't determine, so everything here is optional.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarrMediaInfo {
    #[serde(rename = "audioCodec")]
    pub audio_codec: Option<String>,
    #[serde(rename = "audioBitrate")]
    pub audio_bitrate: Option<i64>,
    #[serde(rename = "audioChannels")]
    pub audio_channels: Option<f64>,
    #[serde(rename = "videoCodec")]
    pub video_codec: Option<String>,
    #[serde(rename = "videoBitrate")]
    pub video_bitrate: Option<i64>,
    pub resolution: Option<String>,
    #[serde(rename = "runTime")]
    pub run_time: Option<String>,
}

/// An episode file as Sonarr's `/api/v3/episodefile` endpoint returns it —
/// deliberately a hand-picked subset (see [`SonarrSeries`]'s doc comment
/// for why): the fields `streamarr-arr-sync` needs to record a
/// `MediaFile` row (identity, path, size, codec/bitrate) rather than
/// Sonarr's full resource (custom formats, indexer flags, scene naming,
/// etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarrEpisodeFile {
    pub id: i64,
    #[serde(rename = "seriesId")]
    pub series_id: i64,
    #[serde(rename = "seasonNumber")]
    pub season_number: i64,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub path: String,
    pub size: i64,
    pub quality: SonarrQuality,
    /// Absent on files Sonarr hasn't run media analysis on yet.
    #[serde(rename = "mediaInfo")]
    pub media_info: Option<SonarrMediaInfo>,
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

    /// `GET /api/v3/episode?seriesId={id}` — every episode Sonarr tracks
    /// for one series, including episodes with no file imported yet.
    pub async fn list_episodes(
        &self,
        series_id: i64,
    ) -> Result<Vec<SonarrEpisode>, ArrClientError> {
        get_json(
            &self.http,
            "sonarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v3/episode?seriesId={series_id}"),
        )
        .await
    }

    /// `GET /api/v3/episodefile?seriesId={id}` — every episode file Sonarr
    /// has imported for one series. Join against [`list_episodes`]'s
    /// `episode_file_id` to attach an episode's title/season/episode number
    /// to its file.
    ///
    /// [`list_episodes`]: SonarrClient::list_episodes
    pub async fn list_episode_files(
        &self,
        series_id: i64,
    ) -> Result<Vec<SonarrEpisodeFile>, ArrClientError> {
        get_json(
            &self.http,
            "sonarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v3/episodefile?seriesId={series_id}"),
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
    use wiremock::matchers::{header, method, path, query_param};
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
    async fn list_episodes_filters_by_series_id_and_sends_api_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episode"))
            .and(query_param("seriesId", "1"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 10,
                    "seriesId": 1,
                    "seasonNumber": 1,
                    "episodeNumber": 1,
                    "title": "Pilot",
                    "hasFile": true,
                    "monitored": true,
                    "episodeFileId": 55
                },
                {
                    "id": 11,
                    "seriesId": 1,
                    "seasonNumber": 1,
                    "episodeNumber": 2,
                    "title": "Test Episode Three...",
                    "hasFile": false,
                    "monitored": true,
                    "episodeFileId": 0
                }
            ])))
            .mount(&server)
            .await;

        let client = SonarrClient::new(server.uri(), "test-key");
        let episodes = client
            .list_episodes(1)
            .await
            .expect("list_episodes should succeed against a healthy mock");

        assert_eq!(episodes.len(), 2);
        assert_eq!(episodes[0].title, "Pilot");
        assert_eq!(episodes[0].episode_file_id, 55);
        assert_eq!(episodes[1].episode_file_id, 0);
        assert!(!episodes[1].has_file);
    }

    #[tokio::test]
    async fn list_episodes_returns_empty_vec_for_series_with_no_episodes() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episode"))
            .and(query_param("seriesId", "999"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let client = SonarrClient::new(server.uri(), "test-key");
        let episodes = client
            .list_episodes(999)
            .await
            .expect("list_episodes should succeed even with an empty result");

        assert!(episodes.is_empty());
    }

    #[tokio::test]
    async fn list_episode_files_parses_quality_and_media_info() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episodefile"))
            .and(query_param("seriesId", "1"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 55,
                    "seriesId": 1,
                    "seasonNumber": 1,
                    "relativePath": "Season 01/S01E01.mkv",
                    "path": "/tv/Test Series Q/Season 01/S01E01.mkv",
                    "size": 1_234_567_890i64,
                    "quality": {
                        "quality": {
                            "id": 7,
                            "name": "Bluray-1080p",
                            "source": "bluray",
                            "resolution": 1080
                        },
                        "revision": {
                            "version": 1,
                            "real": 0,
                            "isRepack": false
                        }
                    },
                    "mediaInfo": {
                        "audioCodec": "AC3",
                        "audioBitrate": 384000,
                        "audioChannels": 6.0,
                        "videoCodec": "x264",
                        "videoBitrate": 4_000_000,
                        "resolution": "1920x1080",
                        "runTime": "42:00"
                    }
                }
            ])))
            .mount(&server)
            .await;

        let client = SonarrClient::new(server.uri(), "test-key");
        let files = client
            .list_episode_files(1)
            .await
            .expect("list_episode_files should succeed against a healthy mock");

        assert_eq!(files.len(), 1);
        let file = &files[0];
        assert_eq!(file.id, 55);
        assert_eq!(file.series_id, 1);
        assert_eq!(file.path, "/tv/Test Series Q/Season 01/S01E01.mkv");
        assert_eq!(file.size, 1_234_567_890);
        assert_eq!(file.quality.quality.name, "Bluray-1080p");
        assert_eq!(file.quality.revision.version, 1);
        let media_info = file
            .media_info
            .as_ref()
            .expect("mediaInfo should be present");
        assert_eq!(media_info.audio_codec.as_deref(), Some("AC3"));
        assert_eq!(media_info.video_codec.as_deref(), Some("x264"));
        assert_eq!(media_info.video_bitrate, Some(4_000_000));
    }

    #[tokio::test]
    async fn list_episode_files_returns_empty_vec_when_series_has_no_files() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episodefile"))
            .and(query_param("seriesId", "42"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let client = SonarrClient::new(server.uri(), "test-key");
        let files = client
            .list_episode_files(42)
            .await
            .expect("list_episode_files should succeed even with an empty result");

        assert!(files.is_empty());
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
