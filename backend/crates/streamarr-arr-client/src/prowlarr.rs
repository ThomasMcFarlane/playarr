use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use streamarr_model::Sensitive;

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// An indexer as Prowlarr's `/api/v1/indexer` endpoint returns it. Prowlarr
/// is the odd one out among the six clients here: it doesn't track media
/// (series/movies/artists/authors) at all, it aggregates search indexers on
/// behalf of the other *arr apps — so its "representative listing method"
/// is indexers, not a media resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProwlarrIndexer {
    pub id: i64,
    pub name: String,
    pub enable: bool,
    /// `"torrent"` or `"usenet"`.
    pub protocol: String,
    pub priority: i64,
}

pub struct ProwlarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl ProwlarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `GET /api/v1/indexer` — every indexer Prowlarr currently manages.
    pub async fn list_indexers(&self) -> Result<Vec<ProwlarrIndexer>, ArrClientError> {
        get_json(
            &self.http,
            "prowlarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/indexer",
        )
        .await
    }

    /// `GET /api/v1/indexer/{id}` — a single indexer by Prowlarr's own id.
    pub async fn get_indexer(&self, id: i64) -> Result<ProwlarrIndexer, ArrClientError> {
        get_json(
            &self.http,
            "prowlarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/indexer/{id}"),
        )
        .await
    }
}

#[async_trait]
impl ArrConnector for ProwlarrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "prowlarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/system/status",
        )
        .await
    }
}
