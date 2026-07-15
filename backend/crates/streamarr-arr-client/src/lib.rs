//! `streamarr-arr-client` — typed HTTP clients for the *arr apps Streamarr
//! reads catalog/download state from. One struct per app
//! ([`SonarrClient`], [`RadarrClient`], [`LidarrClient`], [`ProwlarrClient`],
//! [`BazarrClient`], [`ReadarrClient`]), each implementing the shared
//! [`ArrConnector`] trait for the handful of operations (base URL, health
//! check) that are genuinely uniform across all of them — everything else
//! is app-specific because the *arr apps' REST APIs, while similar in
//! spirit, disagree on API version prefix, resource shape, and terminology
//! (Sonarr's "series" vs Radarr's "movie" vs Lidarr's "artist"/"album").
//!
//! Methods here return the *arr app's own DTO shape (e.g. [`sonarr::SonarrSeries`]),
//! not `streamarr_model::Work` — mapping an app-specific DTO onto the
//! normalized domain model is a judgment call (which fields become tags,
//! how availability is derived) that belongs in `streamarr-arr-sync`, not
//! baked into the transport client.

mod bazarr;
mod http;
mod lidarr;
mod prowlarr;
mod radarr;
mod readarr;
mod sonarr;

pub use bazarr::{BazarrClient, BazarrSeries, BazarrSubtitleLanguage, BazarrWantedEpisode};
pub use lidarr::{LidarrAlbum, LidarrArtist, LidarrClient};
pub use prowlarr::{ProwlarrClient, ProwlarrIndexer};
pub use radarr::{RadarrClient, RadarrMovie};
pub use readarr::{ReadarrAuthor, ReadarrBook, ReadarrClient};
pub use sonarr::{SonarrClient, SonarrSeries};

use async_trait::async_trait;

#[derive(Debug, thiserror::Error)]
pub enum ArrClientError {
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("{app} returned HTTP {status}: {body}")]
    UnexpectedStatus {
        app: &'static str,
        status: reqwest::StatusCode,
        body: String,
    },
    #[error("failed to decode {app} response: {source}")]
    Decode {
        app: &'static str,
        #[source]
        source: serde_json::Error,
    },
}

/// The subset of behavior every *arr client shares: knowing where it's
/// pointed, and being able to answer "is this instance reachable and is
/// our API key accepted" without needing to know that app's resource
/// model. `streamarr-arr-sync`'s reconciliation poller depends on this
/// trait (as `Vec<Box<dyn ArrConnector>>` or similar) so it can health-check
/// every configured `SourceInstance` uniformly, then downcast/match on the
/// concrete type to call the app-specific listing methods.
#[async_trait]
pub trait ArrConnector: Send + Sync {
    fn base_url(&self) -> &str;

    /// Hits the app's own lightweight status/system endpoint (not a full
    /// resource listing) to confirm the base URL and API key are both
    /// valid. Returns `Ok(())` on any 2xx; a non-2xx or transport failure
    /// is surfaced as `Err`, distinguishing "instance is down" (transport
    /// error) from "instance is up but rejected our key" (401/403 status).
    async fn health_check(&self) -> Result<(), ArrClientError>;
}
