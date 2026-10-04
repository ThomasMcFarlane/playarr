//! `playarr-arr-client` — typed HTTP clients for the *arr apps Playarr Server
//! reads catalog/download state from. One struct per app
//! ([`SonarrClient`], [`RadarrClient`], [`LidarrClient`], [`ProwlarrClient`],
//! [`BazarrClient`], [`ReadarrClient`], [`WhisparrClient`]), each implementing
//! the shared [`ArrConnector`] trait for the handful of operations (base URL,
//! health check) that are genuinely uniform across all of them — everything
//! else is app-specific because the *arr apps' REST APIs, while similar in
//! spirit, disagree on API version prefix, resource shape, and terminology
//! (Sonarr's "series" vs Radarr's "movie" vs Lidarr's "artist"/"album").
//!
//! Methods here return the *arr app's own DTO shape (e.g. [`sonarr::SonarrSeries`]),
//! not `playarr_model::Work` — mapping an app-specific DTO onto the
//! normalized domain model is a judgment call (which fields become tags,
//! how availability is derived) that belongs in `playarr-arr-sync`, not
//! baked into the transport client.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

mod bazarr;
mod calendar;
mod dubarr;
mod http;
mod lidarr;
mod lookup;
mod prowlarr;
mod radarr;
mod readarr;
mod sonarr;
mod whisparr;

pub use bazarr::{BazarrClient, BazarrSeries, BazarrSubtitleLanguage, BazarrWantedEpisode};
pub use calendar::{
    ArrCalendarImage, CalendarStatistics, LidarrCalendarAlbum, LidarrCalendarArtist,
    RadarrCalendarMovie, ReadarrCalendarAuthor, ReadarrCalendarBook, SonarrCalendarEpisode,
    SonarrCalendarSeries,
};
pub use dubarr::{DubarrChange, DubarrChanges, DubarrClient, DubarrTrack};
pub use lidarr::{
    LidarrAlbum, LidarrArtist, LidarrArtistStatistics, LidarrClient, LidarrImage, LidarrMediaInfo,
    LidarrQuality, LidarrQualityInfo, LidarrRevision, LidarrTrack, LidarrTrackFile,
};
pub use lookup::LookupTitle;
pub use prowlarr::{ProwlarrClient, ProwlarrIndexer};
pub use radarr::{
    RadarrClient, RadarrCredit, RadarrImage, RadarrMediaInfo, RadarrMovie, RadarrMovieFile,
    RadarrQuality, RadarrQualityInfo, RadarrRevision,
};
pub use readarr::{
    ReadarrAuthor, ReadarrBook, ReadarrBookFile, ReadarrClient, ReadarrQuality, ReadarrQualityInfo,
    ReadarrRevision,
};
pub use sonarr::{
    SonarrClient, SonarrEpisode, SonarrEpisodeFile, SonarrImage, SonarrMediaInfo, SonarrQuality,
    SonarrQualityInfo, SonarrRevision, SonarrSeries,
};
pub use whisparr::{
    WhisparrClient, WhisparrEpisode, WhisparrEpisodeFile, WhisparrImage, WhisparrMediaInfo,
    WhisparrQuality, WhisparrQualityInfo, WhisparrRevision, WhisparrSeries,
};

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
    #[error("local file error: {0}")]
    Io(#[from] std::io::Error),
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
/// model. `playarr-arr-sync`'s reconciliation poller depends on this
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
