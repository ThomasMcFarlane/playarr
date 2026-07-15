use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use streamarr_model::Sensitive;

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// An artist as Lidarr's `/api/v1/artist` endpoint returns it. Note Lidarr
/// is on API v1 (Sonarr/Radarr are on v3) — each *arr app version-bumps its
/// API independently, which is exactly why this crate has one client per
/// app rather than a shared "arr API v3 client" generalization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrArtist {
    pub id: i64,
    #[serde(rename = "artistName")]
    pub artist_name: String,
    /// MusicBrainz artist id.
    #[serde(rename = "foreignArtistId")]
    pub foreign_artist_id: String,
    pub monitored: bool,
    pub path: String,
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
