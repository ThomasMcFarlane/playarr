//! Common surface of the external request managers Playarr syncs with
//! (Ombi and Seerr, TASKS 280-287). Each implements [`RequestManagerClient`];
//! `playarr-api`'s request sync engine only sees this trait, so conflict and
//! dedupe handling is written (and tested) once.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::discovery::DiscoveryKind;
use playarr_model::requests::{ExternalUser, RequestStatus};

use crate::ArrClientError;

/// A request as the external system holds it.
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteRequest {
    pub id: String,
    pub kind: DiscoveryKind,
    /// Empty when the system does not return titles in its list (Seerr);
    /// see [`RequestManagerClient::title_info`].
    pub title: String,
    pub year: Option<i32>,
    pub tmdb_id: Option<i64>,
    pub tvdb_id: Option<i64>,
    pub imdb_id: Option<String>,
    pub poster_url: Option<String>,
    pub seasons: Vec<i32>,
    pub requester: Option<ExternalUser>,
    pub status: RequestStatus,
    pub created_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}

/// A request Playarr wants to create in the external system.
#[derive(Debug, Clone, PartialEq)]
pub struct NewRemoteRequest {
    pub kind: DiscoveryKind,
    pub title: String,
    pub tmdb_id: Option<i64>,
    pub tvdb_id: Option<i64>,
    /// Empty means every season.
    pub seasons: Vec<i32>,
    /// External user id to request as; `None` requests as the API key owner.
    pub on_behalf_of: Option<String>,
}

/// Title metadata for a request whose list entry carries none.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TitleInfo {
    pub title: String,
    pub year: Option<i32>,
    pub poster_url: Option<String>,
}

#[async_trait]
pub trait RequestManagerClient: Send + Sync {
    /// Confirms the URL and key; returns a human version string when known.
    async fn test(&self) -> Result<String, ArrClientError>;
    async fn users(&self) -> Result<Vec<ExternalUser>, ArrClientError>;
    async fn list_requests(&self) -> Result<Vec<RemoteRequest>, ArrClientError>;
    async fn title_info(
        &self,
        kind: DiscoveryKind,
        tmdb_id: i64,
    ) -> Result<TitleInfo, ArrClientError>;
    /// Creates the request and returns it as stored (with its new id).
    async fn create_request(&self, new: &NewRemoteRequest)
        -> Result<RemoteRequest, ArrClientError>;
    async fn approve(&self, kind: DiscoveryKind, id: &str) -> Result<(), ArrClientError>;
    async fn decline(
        &self,
        kind: DiscoveryKind,
        id: &str,
        reason: Option<&str>,
    ) -> Result<(), ArrClientError>;
    async fn remove(&self, kind: DiscoveryKind, id: &str) -> Result<(), ArrClientError>;
    /// Marks a request available where the system supports it (no-op else).
    async fn mark_available(&self, kind: DiscoveryKind, id: &str) -> Result<(), ArrClientError>;
}

pub(crate) fn tmdb_poster(path: &str) -> Option<String> {
    let p = path.trim();
    if p.is_empty() {
        None
    } else if p.starts_with("http") {
        Some(p.to_string())
    } else {
        Some(format!(
            "https://image.tmdb.org/t/p/w342{}",
            if p.starts_with('/') {
                p.to_string()
            } else {
                format!("/{p}")
            }
        ))
    }
}

pub(crate) fn year_of(date: &str) -> Option<i32> {
    date.get(..4)
        .and_then(|y| y.parse::<i32>().ok())
        .filter(|y| *y > 1800)
}
