use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use playarr_model::Sensitive;
use serde::{Deserialize, Serialize};

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// A series as Whisparr V3's `/api/v3/series` endpoint returns it. Whisparr
/// V3 is a direct Sonarr fork -- same route names, same resource shape --
/// with "series" repurposed to mean a studio/site rather than a TV show, so
/// this DTO deliberately mirrors [`crate::sonarr::SonarrSeries`] field-for-
/// field rather than inventing a differently-shaped struct for what is, on
/// the wire, the same JSON. As with `SonarrSeries`, this is a hand-picked
/// subset -- just enough for `playarr-arr-sync` to reconcile identity and
/// monitoring state, plus `overview`/`genres`/`images` for a downstream
/// metadata-display pipeline -- not Whisparr's full response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisparrSeries {
    pub id: i64,
    pub title: String,
    #[serde(rename = "sortTitle")]
    pub sort_title: String,
    /// ThePornDB id for this studio/site -- Whisparr's own metadata
    /// provider, distinct from Sonarr's TheTVDB. Maps onto
    /// `playarr_model::ExternalProvider::Tpdb` via
    /// `playarr_arr_sync::arr_client::map_whisparr`.
    ///
    /// On the wire this rides under the JSON key `tvdbId`, not `tpdbId` --
    /// confirmed against a real Whisparr V3 (nightly) instance: it's a
    /// vestigial field name inherited from the Sonarr fork, repurposed to
    /// carry the ThePornDB site id instead of an actual TheTVDB id. Do not
    /// "fix" this rename back to `tpdbId` without re-confirming against a
    /// live instance first.
    #[serde(rename = "tvdbId")]
    pub tpdb_id: i64,
    pub monitored: bool,
    pub status: String,
    pub path: String,
    /// Absent or null on some entries, so this stays optional rather than
    /// defaulting to an empty string.
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub images: Vec<WhisparrImage>,
    /// When the series (studio/site) first published. Absent/null for a
    /// series ThePornDB has no date for yet. Maps onto `Work::release_date`
    /// -- see `playarr_arr_sync::arr_client::map_whisparr`.
    #[serde(default, rename = "firstAired")]
    pub first_aired: Option<DateTime<Utc>>,
}

/// A single entry from a Whisparr resource's `images` array (poster,
/// fanart, scene screenshot, etc). Used to resolve artwork for the
/// metadata-display pipeline without leaking this Whisparr instance's own
/// API-key-gated local paths to Playarr Server clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisparrImage {
    #[serde(rename = "coverType")]
    pub cover_type: String,
    #[serde(default)]
    pub url: String,
    /// Absolute, externally-hosted image URL (ThePornDB's CDN) -- present
    /// for most images but not guaranteed. Absent from Whisparr's own `url`
    /// field's local path, which requires this instance's own API key to
    /// fetch and must never be forwarded to a Playarr Server client as-is.
    #[serde(rename = "remoteUrl")]
    pub remote_url: Option<String>,
}

/// An episode (individual scene) as Whisparr V3's `/api/v3/episode`
/// endpoint returns it. Carries `episode_file_id` (0 when no file is
/// imported yet) so callers can join against
/// [`WhisparrEpisodeFile::id`] without a second round trip per scene, same
/// as [`crate::sonarr::SonarrEpisode`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisparrEpisode {
    pub id: i64,
    #[serde(rename = "seriesId")]
    pub series_id: i64,
    #[serde(rename = "seasonNumber")]
    pub season_number: i64,
    /// Confirmed absent entirely (not null -- the JSON key doesn't exist)
    /// on a real Whisparr V3 (nightly) instance's `/api/v3/episode`
    /// response: scenes are organized by release year (`season_number`)
    /// rather than a sequential in-season ordinal the way Sonarr episodes
    /// are, so this stays optional rather than required. See
    /// `playarr_arr_sync::media_sync::MediaSync::sync_whisparr` for the
    /// stable fallback (`WhisparrEpisode::id`) used when this is `None`.
    #[serde(default, rename = "episodeNumber")]
    pub episode_number: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub overview: Option<String>,
    /// Scene release date. Rides under the JSON key `releaseDate`, not
    /// `airDate` -- confirmed against a real Whisparr V3 (nightly) instance
    /// (`airDate` is Sonarr's own field name; Whisparr renamed it rather
    /// than keeping the Sonarr-fork name the way `tvdbId`/`WhisparrSeries::
    /// tpdb_id` did). Do not "fix" this back to `airDate` without
    /// re-confirming against a live instance first.
    #[serde(default, rename = "releaseDate")]
    pub air_date: Option<NaiveDate>,
    /// Scene runtime in whole minutes.
    #[serde(default)]
    pub runtime: Option<u32>,
    /// Scene stills supplied by Whisparr's metadata provider. As with
    /// series artwork, downstream clients must only expose `remote_url`;
    /// `url` is Whisparr's local API-key-gated path.
    #[serde(default)]
    pub images: Vec<WhisparrImage>,
    #[serde(rename = "hasFile")]
    pub has_file: bool,
    pub monitored: bool,
    /// Whisparr uses `0` (not `null`) as the "no file imported" sentinel,
    /// same as Sonarr -- this deliberately stays a plain `i64` rather than
    /// `Option<i64>` to mirror the wire format exactly.
    #[serde(rename = "episodeFileId")]
    pub episode_file_id: i64,
}

/// The nested `quality.quality` object on Whisparr's quality-bearing
/// resources (episode files, etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisparrQualityInfo {
    pub id: i64,
    pub name: String,
    pub source: String,
    pub resolution: i64,
}

/// The nested `quality.revision` object — repack/proper tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisparrRevision {
    pub version: i64,
    pub real: i64,
    #[serde(rename = "isRepack")]
    pub is_repack: bool,
}

/// The `quality` object embedded in an episode file: which quality profile
/// tier matched, plus repack/proper revision info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisparrQuality {
    pub quality: WhisparrQualityInfo,
    pub revision: WhisparrRevision,
}

/// The `mediaInfo` object embedded in an episode file — ffprobe-derived
/// codec/bitrate detail. Whisparr omits or nulls individual fields it
/// couldn't determine, so everything here is optional.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisparrMediaInfo {
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
    /// Slash-separated audio languages, e.g. `"English/Japanese"`. Older
    /// releases and unanalysed files omit it.
    #[serde(rename = "audioLanguages")]
    pub audio_languages: Option<String>,
    /// Slash-separated embedded subtitle languages, e.g. `"English/French"`.
    pub subtitles: Option<String>,
}

/// An episode (scene) file as Whisparr V3's `/api/v3/episodefile` endpoint
/// returns it — deliberately a hand-picked subset (see [`WhisparrSeries`]'s
/// doc comment for why): the fields `playarr-arr-sync` needs to record a
/// `MediaFile` row (identity, path, size, codec/bitrate) rather than
/// Whisparr's full resource (custom formats, indexer flags, scene naming,
/// etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisparrEpisodeFile {
    pub id: i64,
    #[serde(rename = "seriesId")]
    pub series_id: i64,
    #[serde(rename = "seasonNumber")]
    pub season_number: i64,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub path: String,
    pub size: i64,
    pub quality: WhisparrQuality,
    /// Absent on files Whisparr hasn't run media analysis on yet.
    #[serde(rename = "mediaInfo")]
    pub media_info: Option<WhisparrMediaInfo>,
}

pub struct WhisparrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl WhisparrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `GET /api/v3/series` — every series (studio/site) Whisparr currently
    /// tracks.
    pub async fn list_series(&self) -> Result<Vec<WhisparrSeries>, ArrClientError> {
        get_json(
            &self.http,
            "whisparr",
            &self.base_url,
            &self.api_key,
            "/api/v3/series",
        )
        .await
    }

    /// `GET /api/v3/series/{id}` — a single series by Whisparr's own id.
    /// Used by the reconciliation poller's targeted re-fetch after a
    /// webhook signals that one series changed, instead of re-listing all
    /// of them.
    pub async fn get_series(&self, id: i64) -> Result<WhisparrSeries, ArrClientError> {
        get_json(
            &self.http,
            "whisparr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v3/series/{id}"),
        )
        .await
    }

    /// `GET /api/v3/episode?seriesId={id}` — every episode (scene) Whisparr
    /// tracks for one series, including scenes with no file imported yet.
    pub async fn list_episodes(
        &self,
        series_id: i64,
    ) -> Result<Vec<WhisparrEpisode>, ArrClientError> {
        get_json(
            &self.http,
            "whisparr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v3/episode?seriesId={series_id}"),
        )
        .await
    }

    /// `GET /api/v3/episodefile?seriesId={id}` — every episode (scene) file
    /// Whisparr has imported for one series. Join against
    /// [`list_episodes`]'s `episode_file_id` to attach a scene's
    /// title/season/episode number to its file.
    ///
    /// [`list_episodes`]: WhisparrClient::list_episodes
    pub async fn list_episode_files(
        &self,
        series_id: i64,
    ) -> Result<Vec<WhisparrEpisodeFile>, ArrClientError> {
        get_json(
            &self.http,
            "whisparr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v3/episodefile?seriesId={series_id}"),
        )
        .await
    }
}

#[async_trait]
impl ArrConnector for WhisparrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "whisparr",
            &self.base_url,
            &self.api_key,
            "/api/v3/system/status",
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    /// Newer *arr releases omit the instance-local `url` on some images
    /// (only `remoteUrl` is present); that must not fail the whole decode
    /// with "missing field `url`" (TASKS 258).
    #[test]
    fn image_without_local_url_decodes() {
        let image: WhisparrImage = serde_json::from_value(serde_json::json!({
            "coverType": "poster",
            "remoteUrl": "https://img.example.com/p.jpg"
        }))
        .expect("decode succeeds");
        assert_eq!(image.url, "");
        assert_eq!(
            image.remote_url.as_deref(),
            Some("https://img.example.com/p.jpg")
        );
        let bare: WhisparrImage =
            serde_json::from_value(serde_json::json!({ "coverType": "fanart" }))
                .expect("bare image");
        assert_eq!(bare.url, "");
        assert_eq!(bare.remote_url, None);
    }

    use serde_json::json;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    #[test]
    fn episode_payload_parses_remote_screenshot_and_defaults_missing_images() {
        let with_image: WhisparrEpisode = serde_json::from_value(json!({
            "id": 10,
            "seriesId": 1,
            "seasonNumber": 1,
            "episodeNumber": 1,
            "title": "Scene One",
            "overview": "The scene begins.",
            "releaseDate": "2022-01-20",
            "runtime": 32,
            "images": [{
                "coverType": "screenshot",
                "url": "/MediaCover/episodes/10/screenshot.jpg",
                "remoteUrl": "https://cdn.theporndb.net/episodes/10.jpg"
            }],
            "hasFile": true,
            "monitored": true,
            "episodeFileId": 55
        }))
        .unwrap();
        assert_eq!(with_image.images[0].cover_type, "screenshot");
        assert_eq!(with_image.overview.as_deref(), Some("The scene begins."));
        assert_eq!(
            with_image.air_date,
            chrono::NaiveDate::from_ymd_opt(2022, 1, 20)
        );
        assert_eq!(with_image.runtime, Some(32));
        assert_eq!(
            with_image.images[0].remote_url.as_deref(),
            Some("https://cdn.theporndb.net/episodes/10.jpg")
        );

        let without_images: WhisparrEpisode = serde_json::from_value(json!({
            "id": 11,
            "seriesId": 1,
            "seasonNumber": 1,
            "episodeNumber": 2,
            "title": "Scene Two",
            "hasFile": false,
            "monitored": true,
            "episodeFileId": 0
        }))
        .unwrap();
        assert!(without_images.images.is_empty());
    }

    /// Real Whisparr V3 (nightly) `/api/v3/episode` responses omit
    /// `episodeNumber` entirely -- scenes are grouped by release year, not
    /// numbered sequentially in-season the way Sonarr episodes are. This
    /// locks in that the DTO tolerates its absence (rather than the hard
    /// decode failure a required field would produce) and still parses
    /// `releaseDate` correctly alongside it.
    #[test]
    fn episode_payload_tolerates_missing_episode_number() {
        let episode: WhisparrEpisode = serde_json::from_value(json!({
            "id": 8117,
            "seriesId": 8,
            "seasonNumber": 2006,
            "title": "Test Episode Adult",
            "releaseDate": "2006-06-08",
            "runtime": 41,
            "hasFile": false,
            "monitored": false,
            "episodeFileId": 0
        }))
        .unwrap();
        assert_eq!(episode.episode_number, None);
        assert_eq!(
            episode.air_date,
            chrono::NaiveDate::from_ymd_opt(2006, 6, 8)
        );
    }

    #[tokio::test]
    async fn list_series_parses_response_and_sends_api_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/series"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "title": "Example Studio",
                    "sortTitle": "example studio",
                    "tvdbId": 81189,
                    "monitored": true,
                    "status": "continuing",
                    "path": "/scenes/Example Studio"
                }
            ])))
            .mount(&server)
            .await;

        let client = WhisparrClient::new(server.uri(), "test-key");
        let series = client
            .list_series()
            .await
            .expect("list_series should succeed against a healthy mock");

        assert_eq!(series.len(), 1);
        assert_eq!(series[0].title, "Example Studio");
        assert_eq!(series[0].tpdb_id, 81189);
        assert!(series[0].monitored);
    }

    #[tokio::test]
    async fn get_series_parses_single_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/series/42"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 42,
                "title": "Another Studio",
                "sortTitle": "another studio",
                "tvdbId": 79126,
                "monitored": false,
                "status": "ended",
                "path": "/scenes/Another Studio"
            })))
            .mount(&server)
            .await;

        let client = WhisparrClient::new(server.uri(), "test-key");
        let series = client
            .get_series(42)
            .await
            .expect("get_series should succeed against a healthy mock");

        assert_eq!(series.id, 42);
        assert_eq!(series.title, "Another Studio");
        assert!(!series.monitored);
    }

    #[tokio::test]
    async fn get_series_parses_overview_genres_and_images() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/series/1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 1,
                "title": "Example Studio",
                "sortTitle": "example studio",
                "tvdbId": 81189,
                "monitored": true,
                "status": "continuing",
                "path": "/scenes/Example Studio",
                "overview": "A studio producing example content.",
                "genres": ["Genre A", "Genre B"],
                "images": [
                    {
                        "coverType": "poster",
                        "url": "/MediaCover/1/poster.jpg",
                        "remoteUrl": "https://cdn.theporndb.net/posters/81189-1.jpg"
                    },
                    {
                        "coverType": "fanart",
                        "url": "/MediaCover/1/fanart.jpg"
                    }
                ]
            })))
            .mount(&server)
            .await;

        let client = WhisparrClient::new(server.uri(), "test-key");
        let series = client
            .get_series(1)
            .await
            .expect("get_series should succeed against a healthy mock");

        assert_eq!(
            series.overview.as_deref(),
            Some("A studio producing example content.")
        );
        assert_eq!(series.genres, vec!["Genre A", "Genre B"]);
        assert_eq!(series.images.len(), 2);
        assert_eq!(series.images[0].cover_type, "poster");
        assert_eq!(
            series.images[0].remote_url.as_deref(),
            Some("https://cdn.theporndb.net/posters/81189-1.jpg")
        );
        assert_eq!(series.images[1].cover_type, "fanart");
        assert_eq!(series.images[1].remote_url, None);
    }

    #[tokio::test]
    async fn list_series_defaults_overview_genres_and_images_when_absent() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/series"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 2,
                    "title": "Older Studio",
                    "sortTitle": "older studio",
                    "tvdbId": 12345,
                    "monitored": true,
                    "status": "continuing",
                    "path": "/scenes/Older Studio"
                }
            ])))
            .mount(&server)
            .await;

        let client = WhisparrClient::new(server.uri(), "test-key");
        let series = client
            .list_series()
            .await
            .expect("list_series should succeed even when new fields are absent");

        assert_eq!(series.len(), 1);
        assert_eq!(series[0].overview, None);
        assert!(series[0].genres.is_empty());
        assert!(series[0].images.is_empty());
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
                    "title": "Scene One",
                    "images": [
                        {
                            "coverType": "screenshot",
                            "url": "/MediaCover/episodes/10/screenshot.jpg",
                            "remoteUrl": "https://cdn.theporndb.net/episodes/10.jpg"
                        }
                    ],
                    "hasFile": true,
                    "monitored": true,
                    "episodeFileId": 55
                },
                {
                    "id": 11,
                    "seriesId": 1,
                    "seasonNumber": 1,
                    "episodeNumber": 2,
                    "title": "Scene Two",
                    "hasFile": false,
                    "monitored": true,
                    "episodeFileId": 0
                }
            ])))
            .mount(&server)
            .await;

        let client = WhisparrClient::new(server.uri(), "test-key");
        let episodes = client
            .list_episodes(1)
            .await
            .expect("list_episodes should succeed against a healthy mock");

        assert_eq!(episodes.len(), 2);
        assert_eq!(episodes[0].title, "Scene One");
        assert_eq!(episodes[0].images[0].cover_type, "screenshot");
        assert_eq!(
            episodes[0].images[0].remote_url.as_deref(),
            Some("https://cdn.theporndb.net/episodes/10.jpg")
        );
        assert_eq!(episodes[0].episode_file_id, 55);
        assert!(episodes[1].images.is_empty());
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

        let client = WhisparrClient::new(server.uri(), "test-key");
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
                    "path": "/scenes/Example Studio/Season 01/S01E01.mkv",
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
                        "runTime": "32:00"
                    }
                }
            ])))
            .mount(&server)
            .await;

        let client = WhisparrClient::new(server.uri(), "test-key");
        let files = client
            .list_episode_files(1)
            .await
            .expect("list_episode_files should succeed against a healthy mock");

        assert_eq!(files.len(), 1);
        let file = &files[0];
        assert_eq!(file.id, 55);
        assert_eq!(file.series_id, 1);
        assert_eq!(file.path, "/scenes/Example Studio/Season 01/S01E01.mkv");
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

        let client = WhisparrClient::new(server.uri(), "test-key");
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
                "version": "3.0.0.0"
            })))
            .mount(&server)
            .await;

        let client = WhisparrClient::new(server.uri(), "test-key");
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

        let client = WhisparrClient::new(server.uri(), "wrong-key");
        let err = client
            .health_check()
            .await
            .expect_err("a 401 status should surface as an error, not Ok");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "whisparr");
                assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn health_check_surfaces_500_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/system/status"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&server)
            .await;

        let client = WhisparrClient::new(server.uri(), "test-key");
        let err = client
            .health_check()
            .await
            .expect_err("a 500 status should surface as an error, not panic");

        match err {
            ArrClientError::UnexpectedStatus { app, status, body } => {
                assert_eq!(app, "whisparr");
                assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
                assert_eq!(body, "Internal Server Error");
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }
}
