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

    /// Streams a track's audio file into `dest`, sending the API key from
    /// inside this process. Callers hand ffmpeg the local file, so the key
    /// is never part of a child process's arguments. Returns the bytes
    /// written; a non-2xx status or a short write is an error (the partial
    /// file is removed).
    pub async fn download_to_file(
        &self,
        track: &DubarrTrack,
        dest: &std::path::Path,
    ) -> Result<u64, ArrClientError> {
        let result = self.download_inner(track, dest).await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(dest).await;
        }
        result
    }

    async fn download_inner(
        &self,
        track: &DubarrTrack,
        dest: &std::path::Path,
    ) -> Result<u64, ArrClientError> {
        use tokio::io::AsyncWriteExt;

        let url = format!(
            "{}{}",
            self.base_url.trim_end_matches('/'),
            track.download_url
        );
        let mut response = self
            .http
            .get(&url)
            .header("X-Api-Key", self.api_key.expose_secret())
            .timeout(DOWNLOAD_TIMEOUT)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ArrClientError::UnexpectedStatus {
                app: "dubarr",
                status,
                body,
            });
        }
        let mut file = tokio::fs::File::create(dest).await?;
        let mut written: u64 = 0;
        while let Some(chunk) = response.chunk().await? {
            written += chunk.len() as u64;
            if written > MAX_DOWNLOAD_BYTES {
                return Err(ArrClientError::Io(std::io::Error::other(
                    "dub track exceeds the maximum download size",
                )));
            }
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        Ok(written)
    }
}

/// A dub is audio only (tens of MiB per hour); anything beyond this is not a
/// dub track.
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

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
    }

    #[tokio::test]
    async fn download_to_file_sends_key_streams_body_and_cleans_up_on_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/tracks/t1/download"))
            .and(header("X-Api-Key", "k"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![7u8; 4096]))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/tracks/gone/download"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let client = DubarrClient::new(server.uri(), "k");
        let dir = std::env::temp_dir().join(format!("dubarr-dl-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let ok: DubarrTrack = serde_json::from_value(track()).unwrap();
        let dest = dir.join("ok.audio");
        assert_eq!(client.download_to_file(&ok, &dest).await.unwrap(), 4096);
        assert_eq!(tokio::fs::read(&dest).await.unwrap().len(), 4096);

        let mut missing = ok.clone();
        missing.download_url = "/api/v1/tracks/gone/download".into();
        let bad = dir.join("bad.audio");
        let err = client.download_to_file(&missing, &bad).await.unwrap_err();
        assert!(matches!(err, ArrClientError::UnexpectedStatus { .. }));
        assert!(!bad.exists());
        let _ = tokio::fs::remove_dir_all(&dir).await;
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
