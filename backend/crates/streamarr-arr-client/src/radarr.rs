use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use streamarr_model::Sensitive;

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// A movie as Radarr's `/api/v3/movie` endpoint returns it. Unlike Sonarr
/// (episode files are a separate `/api/v3/episodefile` resource joined by
/// `episodeFileId`), Radarr embeds the imported file directly on the movie
/// as `movieFile` when `hasFile` is true — Radarr only ever has at most one
/// file per movie, so there's no separate list-by-parent-id endpoint to
/// call. This previously deserialized into an implicit ignored field
/// (unmapped JSON keys are dropped silently by serde by default) rather
/// than a typed one; `movie_file` now captures it.
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
    /// Absent/null when `has_file` is false. `Option<T>` fields are
    /// missing-key-tolerant under serde's default derive, so this parses
    /// fine whether Radarr omits the key entirely or sends `null`.
    #[serde(rename = "movieFile")]
    pub movie_file: Option<RadarrMovieFile>,
}

/// The nested `quality.quality` object on Radarr's quality-bearing
/// resources.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrQualityInfo {
    pub id: i64,
    pub name: String,
    pub source: String,
    pub resolution: i64,
}

/// The nested `quality.revision` object — repack/proper tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrRevision {
    pub version: i64,
    pub real: i64,
    #[serde(rename = "isRepack")]
    pub is_repack: bool,
}

/// The `quality` object embedded in a movie file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrQuality {
    pub quality: RadarrQualityInfo,
    pub revision: RadarrRevision,
}

/// The `mediaInfo` object embedded in a movie file — ffprobe-derived
/// codec/bitrate detail. Radarr omits or nulls individual fields it
/// couldn't determine, so everything here is optional.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrMediaInfo {
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

/// The `movieFile` object Radarr embeds on a movie once a file is
/// imported — a hand-picked subset (identity, path, size, quality/media
/// detail) rather than Radarr's full resource (custom formats, edition,
/// original file path, indexer flags, etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrMovieFile {
    pub id: i64,
    #[serde(rename = "movieId")]
    pub movie_id: i64,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub path: String,
    pub size: i64,
    pub quality: RadarrQuality,
    /// Absent on files Radarr hasn't run media analysis on yet.
    #[serde(rename = "mediaInfo")]
    pub media_info: Option<RadarrMediaInfo>,
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
        assert!(
            movie.movie_file.is_none(),
            "a movie with hasFile: false and no movieFile key should parse to None, not error"
        );
    }

    #[tokio::test]
    async fn get_movie_parses_embedded_movie_file_with_quality_and_media_info() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 1,
                "title": "Orbit",
                "sortTitle": "heat",
                "tmdbId": 949,
                "monitored": true,
                "hasFile": true,
                "path": "/movies/Orbit (1995)",
                "movieFile": {
                    "id": 30,
                    "movieId": 1,
                    "relativePath": "Orbit (1995) Bluray-1080p.mkv",
                    "path": "/movies/Orbit (1995)/Orbit (1995) Bluray-1080p.mkv",
                    "size": 12_345_678_900i64,
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
                        "audioCodec": "DTS",
                        "audioBitrate": 1_509_000,
                        "audioChannels": 6.0,
                        "videoCodec": "x264",
                        "videoBitrate": 8_000_000,
                        "resolution": "1920x1080",
                        "runTime": "2:50:00"
                    }
                }
            })))
            .mount(&server)
            .await;

        let client = RadarrClient::new(server.uri(), "test-key");
        let movie = client
            .get_movie(1)
            .await
            .expect("get_movie should succeed against a healthy mock");

        let movie_file = movie
            .movie_file
            .as_ref()
            .expect("movieFile should be present when hasFile is true");
        assert_eq!(movie_file.id, 30);
        assert_eq!(movie_file.movie_id, 1);
        assert_eq!(
            movie_file.path,
            "/movies/Orbit (1995)/Orbit (1995) Bluray-1080p.mkv"
        );
        assert_eq!(movie_file.size, 12_345_678_900);
        assert_eq!(movie_file.quality.quality.name, "Bluray-1080p");
        let media_info = movie_file
            .media_info
            .as_ref()
            .expect("mediaInfo should be present");
        assert_eq!(media_info.audio_codec.as_deref(), Some("DTS"));
        assert_eq!(media_info.video_codec.as_deref(), Some("x264"));
        assert_eq!(media_info.video_bitrate, Some(8_000_000));
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
