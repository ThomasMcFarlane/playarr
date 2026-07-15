use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use streamarr_model::Sensitive;

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
