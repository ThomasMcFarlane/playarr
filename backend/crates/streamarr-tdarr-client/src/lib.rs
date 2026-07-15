//! `streamarr-tdarr-client` — a typed client for [Tdarr](https://docs.tdarr.io/)'s
//! REST v2 API, authenticated via the `x-api-key` header Tdarr expects on
//! every request. This is the transport `streamarr-transcode`'s
//! `TdarrDispatcher` uses to hand off background transcode work and query
//! node/worker capacity.
//!
//! DTO field names follow Tdarr's own (somewhat inconsistent — it mixes
//! `camelCase` and `PascalCase` across endpoints) JSON conventions via
//! `#[serde(rename = ...)]`, kept deliberately minimal: only the fields
//! `streamarr-transcode` actually needs, not an exhaustive mirror of
//! Tdarr's response shape.

use serde::{Deserialize, Serialize};
use streamarr_model::Sensitive;

#[derive(Debug, thiserror::Error)]
pub enum TdarrClientError {
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("tdarr returned HTTP {status}: {body}")]
    UnexpectedStatus {
        status: reqwest::StatusCode,
        body: String,
    },
    #[error("failed to decode tdarr response: {0}")]
    Decode(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanIndividualFileRequest {
    /// The Tdarr library database id this file belongs to.
    pub db_id: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScanIndividualFileResponse {
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanFilesRequest {
    pub db_id: String,
    /// `true` triggers a full library rescan; `false` an incremental one
    /// (new/changed files only).
    pub full_scan: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchDbQuery {
    pub db_id: String,
    pub search_text: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TdarrFileRecord {
    #[serde(rename = "_id")]
    pub id: String,
    pub file: String,
    pub container: String,
    #[serde(rename = "TranscodeDecisionMaker", default)]
    pub transcode_decision: Option<String>,
}

/// A Tdarr worker node's health-check summary. `workers` is left as raw
/// JSON rather than modeled field-by-field — Tdarr's node payload nests a
/// dynamically-keyed worker map (one entry per active worker id) whose
/// shape isn't stable enough to warrant a typed struct here; callers that
/// need worker-level detail parse `workers` themselves.
#[derive(Debug, Clone, Deserialize)]
pub struct TdarrNode {
    #[serde(rename = "nodeID")]
    pub node_id: String,
    #[serde(rename = "nodeName")]
    pub node_name: String,
    pub workers: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlterWorkerLimitRequest {
    #[serde(rename = "nodeID")]
    pub node_id: String,
    /// One of Tdarr's worker pool identifiers, e.g. `"transcodecpu"`,
    /// `"transcodegpu"`, `"healthcheckcpu"`, `"healthcheckgpu"`.
    pub process: String,
    pub worker_limit: i32,
}

// TODO: no retry/backoff policy yet. Every method here makes exactly one
// HTTP attempt and surfaces a transient network blip (or a Tdarr node that
// is momentarily overloaded, which is common right after `alter-worker-limit`
// throttles it) as an immediate `TdarrClientError::Request`. Callers that
// need resilience (e.g. `streamarr-transcode`'s completion-polling loop)
// currently have to implement their own retry wrapper around this client.
// Deferred because the right policy (bounded retries with jitter on
// idempotent GETs, no blind retries on POSTs that trigger a scan) depends on
// call-site semantics this crate shouldn't assume.
pub struct TdarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl TdarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `POST /api/v2/scan-individual-file` — queues one specific file for
    /// Tdarr to evaluate/process, used by the on-demand path when
    /// `streamarr-transcode` wants Tdarr to pick up a file the background
    /// scan hasn't reached yet.
    pub async fn scan_individual_file(
        &self,
        request: &ScanIndividualFileRequest,
    ) -> Result<ScanIndividualFileResponse, TdarrClientError> {
        self.post_json("/api/v2/scan-individual-file", request)
            .await
    }

    /// `POST /api/v2/scan-files` — triggers a library-wide (or
    /// incremental) scan pass on a given Tdarr library.
    pub async fn scan_files(&self, request: &ScanFilesRequest) -> Result<(), TdarrClientError> {
        self.post_no_content("/api/v2/scan-files", request).await
    }

    /// `POST /api/v2/search-db` — queries Tdarr's internal file database,
    /// used to check whether Tdarr already has a transcode decision/status
    /// for a given file before deciding whether to dispatch on-demand
    /// work.
    pub async fn search_db(
        &self,
        query: &SearchDbQuery,
    ) -> Result<Vec<TdarrFileRecord>, TdarrClientError> {
        self.post_json("/api/v2/search-db", query).await
    }

    /// `GET /api/v2/get-nodes` — currently connected Tdarr nodes and their
    /// worker pools; `streamarr-transcode`'s dispatcher uses this to pick
    /// a node with spare capacity.
    pub async fn get_nodes(&self) -> Result<Vec<TdarrNode>, TdarrClientError> {
        let url = format!("{}/api/v2/get-nodes", self.base_url.trim_end_matches('/'));
        let response = self
            .http
            .get(&url)
            .header("x-api-key", self.api_key.expose_secret())
            .send()
            .await?;
        Self::decode(response).await
    }

    /// `POST /api/v2/alter-worker-limit` — raises/lowers how many
    /// concurrent workers of a given type a node runs; used to throttle
    /// background transcoding when on-demand playback needs headroom.
    pub async fn alter_worker_limit(
        &self,
        request: &AlterWorkerLimitRequest,
    ) -> Result<(), TdarrClientError> {
        self.post_no_content("/api/v2/alter-worker-limit", request)
            .await
    }

    async fn post_json<Req: Serialize, Res: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &Req,
    ) -> Result<Res, TdarrClientError> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let response = self
            .http
            .post(&url)
            .header("x-api-key", self.api_key.expose_secret())
            .json(body)
            .send()
            .await?;
        Self::decode(response).await
    }

    async fn post_no_content<Req: Serialize>(
        &self,
        path: &str,
        body: &Req,
    ) -> Result<(), TdarrClientError> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let response = self
            .http
            .post(&url)
            .header("x-api-key", self.api_key.expose_secret())
            .json(body)
            .send()
            .await?;

        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(TdarrClientError::UnexpectedStatus { status, body })
        }
    }

    async fn decode<Res: for<'de> Deserialize<'de>>(
        response: reqwest::Response,
    ) -> Result<Res, TdarrClientError> {
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(TdarrClientError::UnexpectedStatus { status, body });
        }
        let bytes = response.bytes().await?;
        Ok(serde_json::from_slice(&bytes)?)
    }
}
