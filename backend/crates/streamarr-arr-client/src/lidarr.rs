use async_trait::async_trait;
use serde::{Deserialize, Deserializer, Serialize};
use streamarr_model::Sensitive;

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// An artist as Lidarr's `/api/v1/artist` endpoint returns it. Note Lidarr
/// is on API v1 (Sonarr/Radarr are on v3) — each *arr app version-bumps its
/// API independently, which is exactly why this crate has one client per
/// app rather than a shared "arr API v3 client" generalization. Also carries
/// overview/genres/images so a downstream metadata pipeline can use them
/// without a second round trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrArtist {
    pub id: i64,
    #[serde(rename = "artistName")]
    pub artist_name: String,
    #[serde(default, rename = "sortName")]
    pub sort_name: Option<String>,
    /// MusicBrainz artist id.
    #[serde(rename = "foreignArtistId")]
    pub foreign_artist_id: String,
    pub monitored: bool,
    pub path: String,
    /// May be null or absent on artists Lidarr hasn't fetched metadata for.
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub genres: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub images: Vec<LidarrImage>,
    #[serde(default)]
    pub statistics: Option<LidarrArtistStatistics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrArtistStatistics {
    #[serde(default, rename = "albumCount")]
    pub album_count: i64,
    #[serde(default, rename = "trackFileCount")]
    pub track_file_count: i64,
    #[serde(default, rename = "trackCount")]
    pub track_count: i64,
    #[serde(default, rename = "totalTrackCount")]
    pub total_track_count: i64,
}

/// One entry in an artist's `images` array. Used to surface artwork to a
/// downstream metadata pipeline -- see `LidarrImage::remote_url` for the
/// caveat that matters most when forwarding these onward.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrImage {
    #[serde(rename = "coverType")]
    pub cover_type: String,
    pub url: String,
    /// Absolute, externally-hosted image URL -- present for most images but
    /// not guaranteed. Absent from Lidarr's own `url` field's local path,
    /// which requires this instance's own API key to fetch and must never
    /// be forwarded to a Streamarr client as-is.
    #[serde(rename = "remoteUrl")]
    pub remote_url: Option<String>,
}

/// An album as Lidarr's `/api/v1/album` endpoint returns it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrAlbum {
    pub id: i64,
    pub title: Option<String>,
    /// MusicBrainz release-group id.
    #[serde(rename = "foreignAlbumId")]
    pub foreign_album_id: Option<String>,
    #[serde(rename = "artistId")]
    pub artist_id: i64,
    pub monitored: bool,
    #[serde(default, rename = "albumType")]
    pub album_type: Option<String>,
    #[serde(
        default,
        rename = "secondaryTypes",
        deserialize_with = "deserialize_null_default"
    )]
    pub secondary_types: Vec<String>,
    #[serde(default, rename = "releaseDate")]
    pub release_date: Option<String>,
    #[serde(default)]
    pub duration: Option<i64>,
}

/// A track as Lidarr's `/api/v1/track` endpoint returns it. This resource is
/// the authoritative join between an album, its real track ordering/metadata,
/// and the imported `trackFileId` that can actually be played.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrTrack {
    pub id: i64,
    #[serde(rename = "artistId")]
    pub artist_id: i64,
    #[serde(rename = "albumId")]
    pub album_id: i64,
    #[serde(default, rename = "trackFileId")]
    pub track_file_id: i64,
    #[serde(default, rename = "absoluteTrackNumber")]
    pub absolute_track_number: i64,
    #[serde(default, rename = "trackNumber")]
    pub track_number: Option<String>,
    pub title: Option<String>,
    #[serde(default)]
    pub duration: i64,
    #[serde(default, rename = "mediumNumber")]
    pub medium_number: i64,
    #[serde(default, rename = "hasFile")]
    pub has_file: bool,
}

/// The nested `quality.quality` object on Lidarr's quality-bearing
/// resources. Unlike Sonarr/Radarr's video quality (which carries a
/// `source`/`resolution`), Lidarr's music quality is just an id/name pair
/// (e.g. `"FLAC"`, `"MP3-320"`) — there's no video resolution concept for
/// an audio file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrQualityInfo {
    pub id: i64,
    pub name: String,
}

/// The nested `quality.revision` object — repack tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrRevision {
    pub version: i64,
    pub real: i64,
    #[serde(rename = "isRepack")]
    pub is_repack: bool,
}

/// The `quality` object embedded in a track file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrQuality {
    pub quality: LidarrQualityInfo,
    pub revision: LidarrRevision,
}

/// The `mediaInfo` object embedded in a track file — ffprobe-derived
/// audio detail. Lidarr omits or nulls individual fields it couldn't
/// determine, so everything here is optional.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrMediaInfo {
    #[serde(rename = "audioCodec")]
    pub audio_codec: Option<String>,
    #[serde(
        default,
        rename = "audioBitRate",
        alias = "audioBitrate",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub audio_bitrate: Option<i64>,
    #[serde(
        default,
        rename = "audioChannels",
        deserialize_with = "deserialize_optional_f64"
    )]
    pub audio_channels: Option<f64>,
    #[serde(
        default,
        rename = "audioBits",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub audio_bits: Option<i64>,
    #[serde(rename = "audioSampleRate")]
    pub audio_sample_rate: Option<String>,
}

fn numeric_prefix(raw: &str) -> Option<&str> {
    let raw = raw.trim();
    let start = raw.find(|character: char| character.is_ascii_digit() || character == '-')?;
    let numeric = &raw[start..];
    let end = numeric
        .find(|character: char| {
            !(character.is_ascii_digit() || character == '.' || character == '-')
        })
        .unwrap_or(numeric.len());
    let numeric = &numeric[..end];
    (!numeric.is_empty() && numeric != "-").then_some(numeric)
}

fn deserialize_null_default<'de, T, D>(deserializer: D) -> Result<T, D::Error>
where
    T: Deserialize<'de> + Default,
    D: Deserializer<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

fn deserialize_optional_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(match value {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|value| value.round() as i64)),
        Some(serde_json::Value::String(raw)) => numeric_prefix(&raw)
            .and_then(|numeric| numeric.parse::<f64>().ok())
            .map(|value| value.round() as i64),
        _ => None,
    })
}

fn deserialize_optional_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(match value {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Number(number)) => number.as_f64(),
        Some(serde_json::Value::String(raw)) => {
            numeric_prefix(&raw).and_then(|numeric| numeric.parse::<f64>().ok())
        }
        _ => None,
    })
}

/// A track file as Lidarr's `/api/v1/trackfile` endpoint returns it — a
/// hand-picked subset (identity, path, size, quality/media detail) rather
/// than Lidarr's full resource (scene name, release group, custom
/// formats, etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrTrackFile {
    pub id: i64,
    #[serde(rename = "artistId")]
    pub artist_id: i64,
    #[serde(rename = "albumId")]
    pub album_id: i64,
    pub path: Option<String>,
    pub size: i64,
    pub quality: LidarrQuality,
    /// Absent on files Lidarr hasn't run media analysis on yet.
    #[serde(rename = "mediaInfo")]
    pub media_info: Option<LidarrMediaInfo>,
}

pub struct LidarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl LidarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `GET /api/v1/artist` — every artist Lidarr currently tracks.
    pub async fn list_artists(&self) -> Result<Vec<LidarrArtist>, ArrClientError> {
        get_json(
            &self.http,
            "lidarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/artist",
        )
        .await
    }

    /// `GET /api/v1/artist/{id}` — a single artist by Lidarr's own id.
    pub async fn get_artist(&self, id: i64) -> Result<LidarrArtist, ArrClientError> {
        get_json(
            &self.http,
            "lidarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/artist/{id}"),
        )
        .await
    }

    /// `GET /api/v1/album` — every album Lidarr currently tracks, across all
    /// artists.
    pub async fn list_albums(&self) -> Result<Vec<LidarrAlbum>, ArrClientError> {
        get_json(
            &self.http,
            "lidarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/album",
        )
        .await
    }

    /// `GET /api/v1/album?artistId={id}` — the albums belonging to one
    /// artist, e.g. to populate an artist detail view without pulling
    /// Lidarr's entire catalog.
    pub async fn list_albums_for_artist(
        &self,
        artist_id: i64,
    ) -> Result<Vec<LidarrAlbum>, ArrClientError> {
        get_json(
            &self.http,
            "lidarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/album?artistId={artist_id}"),
        )
        .await
    }

    /// `GET /api/v1/track?artistId={id}` — the authoritative tracks and
    /// their imported `trackFileId` values for one artist.
    pub async fn list_tracks_for_artist(
        &self,
        artist_id: i64,
    ) -> Result<Vec<LidarrTrack>, ArrClientError> {
        get_json(
            &self.http,
            "lidarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/track?artistId={artist_id}"),
        )
        .await
    }

    /// `GET /api/v1/trackfile?artistId={id}` — every track file Lidarr has
    /// imported for one artist, across all their albums.
    pub async fn list_track_files(
        &self,
        artist_id: i64,
    ) -> Result<Vec<LidarrTrackFile>, ArrClientError> {
        get_json(
            &self.http,
            "lidarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/trackfile?artistId={artist_id}"),
        )
        .await
    }
}

#[async_trait]
impl ArrConnector for LidarrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "lidarr",
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
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    #[tokio::test]
    async fn list_artists_parses_response_and_sends_api_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/artist"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "artistName": "Sample Band",
                    "foreignArtistId": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
                    "monitored": true,
                    "path": "/music/Sample Band"
                }
            ])))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let artists = client
            .list_artists()
            .await
            .expect("list_artists should succeed against a healthy mock");

        assert_eq!(artists.len(), 1);
        assert_eq!(artists[0].artist_name, "Sample Band");
        assert!(artists[0].monitored);
    }

    #[tokio::test]
    async fn list_artists_parses_overview_genres_and_images() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/artist"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "artistName": "Sample Band",
                    "foreignArtistId": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
                    "monitored": true,
                    "path": "/music/Sample Band",
                    "overview": "English rock band formed in Abingdon, Oxfordshire.",
                    "sortName": "Sample Band",
                    "genres": ["Alternative Rock", "Art Rock"],
                    "images": [
                        {
                            "coverType": "poster",
                            "url": "/MediaCover/Artist/1/poster.jpg",
                            "remoteUrl": "https://fanart.tv/poster.jpg"
                        },
                        {
                            "coverType": "fanart",
                            "url": "/MediaCover/Artist/1/fanart.jpg"
                        }
                    ],
                    "statistics": {
                        "albumCount": 9,
                        "trackFileCount": 112,
                        "trackCount": 112,
                        "totalTrackCount": 112
                    }
                }
            ])))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let artists = client
            .list_artists()
            .await
            .expect("list_artists should succeed against a healthy mock");

        assert_eq!(artists.len(), 1);
        let artist = &artists[0];
        assert_eq!(
            artist.overview.as_deref(),
            Some("English rock band formed in Abingdon, Oxfordshire.")
        );
        assert_eq!(artist.genres, vec!["Alternative Rock", "Art Rock"]);
        assert_eq!(artist.sort_name.as_deref(), Some("Sample Band"));
        assert_eq!(
            artist
                .statistics
                .as_ref()
                .map(|stats| stats.track_file_count),
            Some(112)
        );
        assert_eq!(artist.images.len(), 2);
        assert_eq!(
            artist.images[0].remote_url.as_deref(),
            Some("https://fanart.tv/poster.jpg")
        );
        assert_eq!(artist.images[1].remote_url, None);
    }

    #[tokio::test]
    async fn list_artists_defaults_overview_genres_and_images_when_absent() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/artist"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "artistName": "Sample Band",
                    "foreignArtistId": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
                    "monitored": true,
                    "path": "/music/Sample Band",
                    "genres": null,
                    "images": null
                }
            ])))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let artists = client
            .list_artists()
            .await
            .expect("list_artists should succeed against a healthy mock");

        assert_eq!(artists.len(), 1);
        let artist = &artists[0];
        assert_eq!(artist.overview, None);
        assert!(artist.genres.is_empty());
        assert!(artist.images.is_empty());
    }

    #[tokio::test]
    async fn get_artist_parses_single_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/artist/9"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 9,
                "artistName": "Boards of Canada",
                "foreignArtistId": "df7d1c7f-a5f5-405b-8d25-9265b0e880d1",
                "monitored": false,
                "path": "/music/Boards of Canada"
            })))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let artist = client
            .get_artist(9)
            .await
            .expect("get_artist should succeed against a healthy mock");

        assert_eq!(artist.id, 9);
        assert_eq!(artist.artist_name, "Boards of Canada");
    }

    #[tokio::test]
    async fn list_albums_parses_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/album"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 100,
                    "title": "Sample Album",
                    "foreignAlbumId": "d6591261-daa1-32e1-8d0e-a60e6f97a698",
                    "artistId": 1,
                    "monitored": true
                }
            ])))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let albums = client
            .list_albums()
            .await
            .expect("list_albums should succeed against a healthy mock");

        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].title.as_deref(), Some("Sample Album"));
        assert_eq!(albums[0].artist_id, 1);
    }

    #[tokio::test]
    async fn list_albums_for_artist_filters_by_query_param() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/album"))
            .and(query_param("artistId", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 100,
                    "title": "Sample Album",
                    "foreignAlbumId": "d6591261-daa1-32e1-8d0e-a60e6f97a698",
                    "artistId": 1,
                    "monitored": true
                }
            ])))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let albums = client
            .list_albums_for_artist(1)
            .await
            .expect("list_albums_for_artist should succeed against a healthy mock");

        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].artist_id, 1);
    }

    #[tokio::test]
    async fn list_tracks_for_artist_parses_playable_track_metadata() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/track"))
            .and(query_param("artistId", "1"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 300,
                    "artistId": 1,
                    "albumId": 100,
                    "trackFileId": 500,
                    "absoluteTrackNumber": 1,
                    "trackNumber": "1",
                    "title": "Sample Track One",
                    "duration": 284_000,
                    "mediumNumber": 1,
                    "hasFile": true
                }
            ])))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let tracks = client
            .list_tracks_for_artist(1)
            .await
            .expect("list_tracks_for_artist should parse Lidarr's track resource");

        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].id, 300);
        assert_eq!(tracks[0].track_file_id, 500);
        assert_eq!(tracks[0].track_number.as_deref(), Some("1"));
        assert_eq!(tracks[0].duration, 284_000);
        assert!(tracks[0].has_file);
    }

    #[tokio::test]
    async fn list_track_files_filters_by_artist_id_and_parses_media_info() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/trackfile"))
            .and(query_param("artistId", "1"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 500,
                    "artistId": 1,
                    "albumId": 100,
                    "path": "/music/Sample Band/Sample Album/01 - Sample Track One.flac",
                    "size": 34_567_890,
                    "quality": {
                        "quality": {
                            "id": 6,
                            "name": "FLAC"
                        },
                        "revision": {
                            "version": 1,
                            "real": 0,
                            "isRepack": false
                        }
                    },
                    "mediaInfo": {
                        "audioCodec": "FLAC",
                        "audioBitRate": "1000 kbps",
                        "audioChannels": "2.0",
                        "audioBits": "16bit",
                        "audioSampleRate": ""
                    }
                }
            ])))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let files = client
            .list_track_files(1)
            .await
            .expect("list_track_files should succeed against a healthy mock");

        assert_eq!(files.len(), 1);
        let file = &files[0];
        assert_eq!(file.id, 500);
        assert_eq!(file.artist_id, 1);
        assert_eq!(file.album_id, 100);
        assert_eq!(file.quality.quality.name, "FLAC");
        let media_info = file
            .media_info
            .as_ref()
            .expect("mediaInfo should be present");
        assert_eq!(media_info.audio_codec.as_deref(), Some("FLAC"));
        assert_eq!(media_info.audio_bitrate, Some(1000));
        assert_eq!(media_info.audio_channels, Some(2.0));
        assert_eq!(media_info.audio_bits, Some(16));
    }

    #[tokio::test]
    async fn list_track_files_tolerates_empty_media_info_values() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/trackfile"))
            .and(query_param("artistId", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 501,
                    "artistId": 1,
                    "albumId": 100,
                    "path": "/music/Sample Band/Sample Album/02 - Sample Track Two.flac",
                    "size": 45_678_901,
                    "quality": {
                        "quality": { "id": 6, "name": "FLAC" },
                        "revision": { "version": 1, "real": 0, "isRepack": false }
                    },
                    "mediaInfo": {
                        "audioCodec": "",
                        "audioBitRate": "",
                        "audioChannels": "",
                        "audioBits": "",
                        "audioSampleRate": ""
                    }
                }
            ])))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let files = client
            .list_track_files(1)
            .await
            .expect("empty optional media-info strings must not reject the entire response");

        let media_info = files[0].media_info.as_ref().expect("mediaInfo");
        assert_eq!(media_info.audio_bitrate, None);
        assert_eq!(media_info.audio_channels, None);
        assert_eq!(media_info.audio_bits, None);
    }

    #[tokio::test]
    async fn list_track_files_returns_empty_vec_when_artist_has_no_files() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/trackfile"))
            .and(query_param("artistId", "9"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let files = client
            .list_track_files(9)
            .await
            .expect("list_track_files should succeed even with an empty result");

        assert!(files.is_empty());
    }

    #[tokio::test]
    async fn health_check_surfaces_401_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/system/status"))
            .respond_with(ResponseTemplate::new(401).set_body_string("Unauthorized"))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "wrong-key");
        let err = client
            .health_check()
            .await
            .expect_err("a 401 status should surface as an error, not Ok");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "lidarr");
                assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_artists_surfaces_500_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/artist"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&server)
            .await;

        let client = LidarrClient::new(server.uri(), "test-key");
        let err = client
            .list_artists()
            .await
            .expect_err("a 500 status should surface as an error, not panic");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "lidarr");
                assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }
}
