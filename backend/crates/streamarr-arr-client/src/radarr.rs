use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use streamarr_model::Sensitive;

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// A movie as Radarr's `/api/v3/movie` endpoint returns it.
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
