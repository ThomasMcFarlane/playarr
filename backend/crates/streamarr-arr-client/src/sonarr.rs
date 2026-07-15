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
