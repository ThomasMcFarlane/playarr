//! Dubarr client. Dubarr manages AI dubbing and exposes the finished dub
//! tracks (sidecar audio files) over a small REST contract:
//!
//! * `GET /api/v1/tracks?path=<media path>` or `?source=<kind>&id=<n>`
//! * `GET /api/v1/tracks/changes?since=<cursor>`
//! * `GET /api/v1/tracks/{id}/download` (HTTP `Range` supported)
//!
//! Authentication is the same `X-Api-Key` header the *arr apps use.

use async_trait::async_trait;
use playarr_model::Sensitive;
use serde::{Deserialize, Serialize};

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// One finished dub track as Dubarr's catalogue returns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DubarrTrack {
    pub id: String,
    pub language: String,
    pub vendor: String,
    pub codec: String,
    pub channels: u32,
    #[serde(default)]
    pub bitrate_kbps: Option<u32>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub size_bytes: u64,
    pub title: String,
    #[serde(default)]
    pub media_path: String,
    #[serde(default)]
    pub checksum: String,
    /// Path (relative to the Dubarr base URL) of the audio file.
    pub download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DubarrChange {
    pub seq: i64,
    pub track_id: String,
    /// `created`, `updated` or `deleted`.
    pub op: String,
    #[serde(default)]
    pub track: Option<DubarrTrack>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DubarrChanges {
    pub cursor: i64,
    pub changes: Vec<DubarrChange>,
}

pub struct DubarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl DubarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// Dub tracks for a media file, by the file's path.
    pub async fn tracks_for_path(
        &self,
        media_path: &str,
    ) -> Result<Vec<DubarrTrack>, ArrClientError> {
        let encoded: String = url_encode(media_path);
        get_json(
            &self.http,
            "dubarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/tracks?path={encoded}"),
        )
        .await
    }

    /// Dub tracks for an *arr item (`source` is `radarr`, `sonarr` or `whisparr`).
    pub async fn tracks_for_item(
        &self,
        source: &str,
        id: i64,
    ) -> Result<Vec<DubarrTrack>, ArrClientError> {
        get_json(
            &self.http,
            "dubarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/tracks?source={}&id={id}", url_encode(source)),
        )
        .await
    }

    /// Created, updated and deleted tracks after `since`.
    pub async fn changes(&self, since: i64) -> Result<DubarrChanges, ArrClientError> {
        get_json(
            &self.http,
            "dubarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/tracks/changes?since={since}"),
        )
        .await
    }

    /// Absolute URL of a track's audio file and the header an HTTP client
    /// (for example ffmpeg) must send to fetch it.
    pub fn download_target(&self, track: &DubarrTrack) -> (String, (&'static str, String)) {
        (
            format!(
                "{}{}",
                self.base_url.trim_end_matches('/'),
                track.download_url
            ),
            ("X-Api-Key", self.api_key.expose_secret().clone()),
        )
    }
}

fn url_encode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[async_trait]
impl ArrConnector for DubarrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "dubarr",
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

    fn track() -> serde_json::Value {
        json!({"id":"t1","source":"radarr","language":"th","vendor":"elevenlabs","codec":"aac","channels":2,
               "durationMs":6000000,"sizeBytes":10,"title":"TH dub","mediaPath":"/movies/A/A.mkv","checksum":"x",
               "downloadUrl":"/api/v1/tracks/t1/download"})
    }

    #[tokio::test]
    async fn tracks_for_path_sends_key_and_decodes() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/tracks"))
            .and(query_param("path", "/movies/A (2000)/A.mkv"))
            .and(header("X-Api-Key", "k"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([track()])))
            .mount(&server)
            .await;
        let client = DubarrClient::new(server.uri(), "k");
        let tracks = client
            .tracks_for_path("/movies/A (2000)/A.mkv")
            .await
            .unwrap();
        assert_eq!(tracks[0].language, "th");
        let (url, (name, value)) = client.download_target(&tracks[0]);
        assert!(url.ends_with("/api/v1/tracks/t1/download"));
        assert_eq!((name, value.as_str()), ("X-Api-Key", "k"));
    }

    #[tokio::test]
    async fn changes_feed_decodes_cursor_and_deletes() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/tracks/changes"))
            .and(query_param("since", "4"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "cursor": 6,
            "changes": [
                {"seq": 5, "trackId": "t1", "op": "created", "track": track()},
                {"seq": 6, "trackId": "t2", "op": "deleted", "track": null}
            ]})))
            .mount(&server)
            .await;
        let c = DubarrClient::new(server.uri(), "k")
            .changes(4)
            .await
            .unwrap();
        assert_eq!(c.cursor, 6);
        assert!(c.changes[0].track.is_some() && c.changes[1].track.is_none());
    }

    #[tokio::test]
    async fn health_check_rejects_bad_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/system/status"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        assert!(DubarrClient::new(server.uri(), "bad")
            .health_check()
            .await
            .is_err());
    }
}
