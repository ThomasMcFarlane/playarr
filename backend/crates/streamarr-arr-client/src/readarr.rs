use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use streamarr_model::Sensitive;

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// An author as Readarr's `/api/v1/author` endpoint returns it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadarrAuthor {
    pub id: i64,
    #[serde(rename = "authorName")]
    pub author_name: String,
    /// Goodreads author id.
    #[serde(rename = "foreignAuthorId")]
    pub foreign_author_id: String,
    pub monitored: bool,
    pub path: String,
}

pub struct ReadarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl ReadarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `GET /api/v1/author` — every author Readarr currently tracks.
    pub async fn list_authors(&self) -> Result<Vec<ReadarrAuthor>, ArrClientError> {
        get_json(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/author",
        )
        .await
    }

    /// `GET /api/v1/author/{id}` — a single author by Readarr's own id.
    pub async fn get_author(&self, id: i64) -> Result<ReadarrAuthor, ArrClientError> {
        get_json(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/author/{id}"),
        )
        .await
    }
}

#[async_trait]
impl ArrConnector for ReadarrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/system/status",
        )
        .await
    }
}
