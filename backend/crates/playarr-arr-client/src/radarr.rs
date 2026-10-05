use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::Sensitive;
use serde::{Deserialize, Serialize};

use crate::http::{build_http_client, get_json, get_status, post_json};
use crate::lookup::{add_body, lookup_path, LookupTitle};
use crate::{ArrClientError, ArrConnector};

/// A movie as Radarr's `/api/v3/movie` endpoint returns it. Unlike Sonarr
/// (episode files are a separate `/api/v3/episodefile` resource joined by
/// `episodeFileId`), Radarr embeds the imported file directly on the movie
/// as `movieFile` when `hasFile` is true — Radarr only ever has at most one
/// file per movie, so there's no separate list-by-parent-id endpoint to
/// call. This previously deserialized into an implicit ignored field
/// (unmapped JSON keys are dropped silently by serde by default) rather
/// than a typed one; `movie_file` now captures it. `overview`, `genres` and
/// `images` were added on top of that for a downstream metadata-display
/// pipeline, which needs synopsis/genre/artwork data Radarr already returns.
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
    /// Radarr's title runtime, in whole minutes.
    #[serde(default)]
    pub runtime: Option<u32>,
    /// Absent/null when `has_file` is false. `Option<T>` fields are
    /// missing-key-tolerant under serde's default derive, so this parses
    /// fine whether Radarr omits the key entirely or sends `null`.
    #[serde(rename = "movieFile")]
    pub movie_file: Option<RadarrMovieFile>,
    /// Plot synopsis. Absent or null on movies Radarr hasn't fetched
    /// metadata for yet.
    #[serde(default)]
    pub overview: Option<String>,
    /// Genre tags, e.g. `["Action", "Crime", "Drama"]`. Empty rather than
    /// missing when Radarr has no genre data.
    #[serde(default)]
    pub genres: Vec<String>,
    /// Poster/fanart/etc artwork. See `RadarrImage` for why `remote_url`
    /// must be checked before use.
    #[serde(default)]
    pub images: Vec<RadarrImage>,
    /// When this movie became available digitally. Absent/null until
    /// Radarr's metadata provider reports one -- see
    /// `playarr_arr_sync::arr_client::map_radarr`'s doc comment for how
    /// this and `physical_release` combine into `Work::release_date`.
    #[serde(default, rename = "digitalRelease")]
    pub digital_release: Option<DateTime<Utc>>,
    /// When this movie became available physically (Blu-ray/DVD). See
    /// `digital_release`.
    #[serde(default, rename = "physicalRelease")]
    pub physical_release: Option<DateTime<Utc>>,
    /// Original theatrical release date. Absent/null for straight-to-video
    /// titles and for many older films.
    #[serde(default, rename = "inCinemas")]
    pub in_cinemas: Option<DateTime<Utc>>,
    /// Release year of the film itself (0/absent when unknown). Unlike the
    /// digital/physical dates this is the original year, not a re-release.
    #[serde(default)]
    pub year: Option<i32>,
    /// Content rating (MPAA style, e.g. `PG-13`). Absent/null/blank for
    /// unrated titles. Mapped to a `rating:` tag for household controls.
    #[serde(default)]
    pub certification: Option<String>,
    /// The TMDb collection (franchise) the movie belongs to, when any.
    #[serde(default)]
    pub collection: Option<RadarrCollection>,
    /// Audience scores per source.
    #[serde(default)]
    pub ratings: Option<RadarrRatings>,
}

/// Radarr's `collection` object on a movie.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrCollection {
    #[serde(default)]
    pub title: String,
    #[serde(default, rename = "tmdbId")]
    pub tmdb_id: Option<i64>,
}

/// One source's score (`0-10`) and vote count.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrRatingSource {
    #[serde(default)]
    pub value: f64,
    #[serde(default)]
    pub votes: u32,
}

/// Radarr's per-source `ratings` object.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RadarrRatings {
    #[serde(default)]
    pub tmdb: Option<RadarrRatingSource>,
    #[serde(default)]
    pub imdb: Option<RadarrRatingSource>,
}

/// An entry in a movie's `images` array (poster, fanart, banner, ...).
/// `remote_url` -- when present -- points at TMDb's own CDN and is safe to
/// hand to a Playarr Server client directly; `url` is a path local to this
/// Radarr instance that requires its API key to fetch and must not be
/// forwarded as-is.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrImage {
    #[serde(rename = "coverType")]
    pub cover_type: String,
    #[serde(default)]
    pub url: String,
    /// Absolute, externally-hosted image URL (TMDb's CDN) -- present for
    /// most images but not guaranteed. Absent from Radarr's own `url`
    /// field's local path, which requires this instance's own API key to
    /// fetch and must never be forwarded to a Playarr Server client as-is.
    #[serde(rename = "remoteUrl")]
    pub remote_url: Option<String>,
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
    /// Slash-separated audio languages, e.g. `"English/Japanese"`. Older
    /// releases and unanalysed files omit it.
    #[serde(rename = "audioLanguages")]
    pub audio_languages: Option<String>,
    /// Slash-separated embedded subtitle languages, e.g. `"English/French"`.
    pub subtitles: Option<String>,
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

/// One entry in a movie's `/api/v3/credit?movieId={id}` response --
/// either a cast member (`type: "cast"`, `character` set, `department`/
/// `job` absent) or a crew member (`type: "crew"`, `department`/`job`
/// set, `character` absent). Radarr is the only *arr app in this stack
/// that exposes this: verified live that Sonarr's `/api/v3/series/{id}`
/// has no cast/crew field and no `/api/v3/credit` endpoint exists on it
/// (404) -- Sonarr's own web UI shows no Cast/Crew section either, unlike
/// Radarr's. Lidarr/Readarr have no equivalent concept at all. So
/// `playarr-arr-sync` only ever calls this for Radarr-sourced movies;
/// series/artist/author works simply have no credits, not "not synced
/// yet".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrCredit {
    #[serde(rename = "personName")]
    pub person_name: String,
    /// TMDb's own person id -- the stable cross-movie identity key (the
    /// same actor gets the same `person_tmdb_id` on every movie they
    /// appear in), used to dedupe into one `playarr_model::Person` row
    /// rather than one per credit.
    #[serde(rename = "personTmdbId")]
    pub person_tmdb_id: i64,
    #[serde(default)]
    pub images: Vec<RadarrImage>,
    /// `"cast"` or `"crew"`.
    #[serde(rename = "type")]
    pub credit_type: String,
    /// Cast-only: the character played. Absent on a crew credit.
    #[serde(default)]
    pub character: Option<String>,
    /// Crew-only: e.g. `"Directing"`. Absent on a cast credit.
    #[serde(default)]
    pub department: Option<String>,
    /// Crew-only: e.g. `"Director"`. Absent on a cast credit.
    #[serde(default)]
    pub job: Option<String>,
    /// Display order Radarr/TMDb assigns -- billing order for cast,
    /// roughly department-grouped for crew.
    pub order: i64,
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

    /// `GET /api/v3/movie/lookup?term=` -- catalogue search, including titles
    /// this instance does not track yet.
    pub async fn lookup_movie(&self, term: &str) -> Result<Vec<LookupTitle>, ArrClientError> {
        let raw: Vec<serde_json::Value> = get_json(
            &self.http,
            "radarr",
            &self.base_url,
            &self.api_key,
            &lookup_path("/api/v3/movie/lookup", term),
        )
        .await?;
        Ok(raw
            .into_iter()
            .filter_map(LookupTitle::from_value)
            .collect())
    }

    /// `POST /api/v3/movie` -- start tracking a looked-up title in the given
    /// root folder and quality profile and search for it immediately.
    pub async fn add_movie(
        &self,
        lookup: &LookupTitle,
        root_folder_path: &str,
        quality_profile_id: i64,
    ) -> Result<serde_json::Value, ArrClientError> {
        let body = add_body(
            lookup.raw.clone(),
            root_folder_path,
            quality_profile_id,
            "searchForMovie",
        );
        post_json(
            &self.http,
            "radarr",
            &self.base_url,
            &self.api_key,
            "/api/v3/movie",
            &body,
        )
        .await
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

    /// `GET /api/v3/credit?movieId={id}` — every cast/crew credit for one
    /// movie, by Radarr's own internal movie id (not `tmdb_id`).
    pub async fn list_credits(&self, movie_id: i64) -> Result<Vec<RadarrCredit>, ArrClientError> {
        get_json(
            &self.http,
            "radarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v3/credit?movieId={movie_id}"),
        )
        .await
    }
}

impl RadarrClient {
    /// `GET /api/v3/calendar` -- movies releasing in the inclusive
    /// `[start, end]` day window, including unmonitored items.
    pub async fn calendar(
        &self,
        start: chrono::NaiveDate,
        end: chrono::NaiveDate,
    ) -> Result<Vec<crate::calendar::RadarrCalendarMovie>, ArrClientError> {
        let query = crate::calendar::window_query(start, end, "");
        get_json(
            &self.http,
            "radarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v3/calendar?{query}"),
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
    /// Newer *arr releases omit the instance-local `url` on some images
    /// (only `remoteUrl` is present); that must not fail the whole decode
    /// with "missing field `url`" (TASKS 258).
    #[test]
    fn image_without_local_url_decodes() {
        let image: RadarrImage = serde_json::from_value(serde_json::json!({
            "coverType": "poster",
            "remoteUrl": "https://img.example.com/p.jpg"
        }))
        .expect("decode succeeds");
        assert_eq!(image.url, "");
        assert_eq!(
            image.remote_url.as_deref(),
            Some("https://img.example.com/p.jpg")
        );
        let bare: RadarrImage =
            serde_json::from_value(serde_json::json!({ "coverType": "fanart" }))
                .expect("bare image");
        assert_eq!(bare.url, "");
        assert_eq!(bare.remote_url, None);
    }

    use serde_json::json;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    #[tokio::test]
    async fn lookup_and_add_round_trip_sends_api_key_and_destination() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/lookup"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"title": "Orbit", "year": 1995, "tmdbId": 949, "tvdbId": 77, "id": 0}
            ])))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/v3/movie"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(
                ResponseTemplate::new(201).set_body_json(json!({"id": 5, "title": "Orbit"})),
            )
            .expect(1)
            .mount(&server)
            .await;

        let client = RadarrClient::new(server.uri(), "test-key");
        let hits = client.lookup_movie("heat").await.unwrap();
        assert_eq!(hits.len(), 1);
        let added = client.add_movie(&hits[0], "/media", 4).await.unwrap();
        assert_eq!(added["id"], 5);
        let requests = server.received_requests().await.unwrap();
        let post = requests
            .iter()
            .find(|r| r.method.as_str() == "POST")
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&post.body).unwrap();
        assert_eq!(body["rootFolderPath"], "/media");
        assert_eq!(body["qualityProfileId"], 4);
        assert_eq!(body["monitored"], true);
    }

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
                    "path": "/movies/Orbit (1995)",
                    "runtime": 170
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
        assert_eq!(movies[0].runtime, Some(170));
    }

    #[tokio::test]
    async fn get_movie_parses_single_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/7"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 7,
                "title": "Sample Seven",
                "sortTitle": "sample seven",
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
    async fn get_movie_parses_overview_genres_and_images() {
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
                "overview": "Obsessive master thief Neil McCauley leads a top-notch crew.",
                "genres": ["Action", "Crime", "Drama"],
                "images": [
                    {
                        "coverType": "poster",
                        "url": "/MediaCover/1/poster.jpg",
                        "remoteUrl": "https://image.tmdb.org/t/p/original/poster.jpg"
                    },
                    {
                        "coverType": "fanart",
                        "url": "/MediaCover/1/fanart.jpg"
                    }
                ]
            })))
            .mount(&server)
            .await;

        let client = RadarrClient::new(server.uri(), "test-key");
        let movie = client
            .get_movie(1)
            .await
            .expect("get_movie should succeed against a healthy mock");

        assert_eq!(
            movie.overview.as_deref(),
            Some("Obsessive master thief Neil McCauley leads a top-notch crew.")
        );
        assert_eq!(movie.genres, vec!["Action", "Crime", "Drama"]);
        assert_eq!(movie.images.len(), 2);
        assert_eq!(movie.images[0].cover_type, "poster");
        assert_eq!(
            movie.images[0].remote_url.as_deref(),
            Some("https://image.tmdb.org/t/p/original/poster.jpg")
        );
        assert_eq!(movie.images[1].cover_type, "fanart");
        assert!(
            movie.images[1].remote_url.is_none(),
            "an image with no remoteUrl key should parse to None, not error"
        );
    }

    #[tokio::test]
    async fn get_movie_defaults_overview_genres_and_images_when_absent() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/7"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 7,
                "title": "Sample Seven",
                "sortTitle": "sample seven",
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

        assert_eq!(movie.overview, None);
        assert_eq!(movie.genres, Vec::<String>::new());
        assert!(movie.images.is_empty());
    }

    #[tokio::test]
    async fn list_credits_parses_cast_and_crew() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/credit"))
            .and(wiremock::matchers::query_param("movieId", "4"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "personName": "Mary Elizabeth Winstead",
                    "personTmdbId": 17628,
                    "images": [
                        {
                            "coverType": "headshot",
                            "url": "/MediaCoverProxy/abc/headshot.jpg",
                            "remoteUrl": "https://image.tmdb.org/t/p/original/headshot.jpg"
                        }
                    ],
                    "character": "Michelle",
                    "order": 1,
                    "type": "cast"
                },
                {
                    "personName": "J.J. Abrams",
                    "personTmdbId": 15344,
                    "images": [],
                    "department": "Production",
                    "job": "Producer",
                    "order": 4,
                    "type": "crew"
                }
            ])))
            .mount(&server)
            .await;

        let client = RadarrClient::new(server.uri(), "test-key");
        let credits = client
            .list_credits(4)
            .await
            .expect("list_credits should succeed against a healthy mock");

        assert_eq!(credits.len(), 2);
        assert_eq!(credits[0].person_name, "Mary Elizabeth Winstead");
        assert_eq!(credits[0].credit_type, "cast");
        assert_eq!(credits[0].character.as_deref(), Some("Michelle"));
        assert_eq!(credits[0].department, None);
        assert_eq!(
            credits[0].images[0].remote_url.as_deref(),
            Some("https://image.tmdb.org/t/p/original/headshot.jpg")
        );

        assert_eq!(credits[1].person_name, "J.J. Abrams");
        assert_eq!(credits[1].credit_type, "crew");
        assert_eq!(credits[1].department.as_deref(), Some("Production"));
        assert_eq!(credits[1].job.as_deref(), Some("Producer"));
        assert_eq!(credits[1].character, None);
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

    #[tokio::test]
    async fn calendar_parses_movies_with_three_release_dates() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .and(query_param("start", "2026-10-01"))
            .and(query_param("end", "2026-11-01"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": 1, "title": "Film", "tmdbId": 9, "monitored": true, "hasFile": false,
                "inCinemas": "2026-10-02T00:00:00Z", "digitalRelease": "2026-10-20T00:00:00Z"
            }])))
            .mount(&server)
            .await;

        let client = RadarrClient::new(server.uri(), "test-key");
        let start = chrono::NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let end = chrono::NaiveDate::from_ymd_opt(2026, 10, 31).unwrap();
        let movies = client.calendar(start, end).await.expect("calendar");
        assert_eq!(
            movies[0].digital_release.as_deref(),
            Some("2026-10-20T00:00:00Z")
        );
        assert!(movies[0].physical_release.is_none());
    }
}
