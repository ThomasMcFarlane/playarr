//! The [`Work`] aggregate root: one row per movie, series, site, artist, or
//! author. Kind-specific detail (seasons/episodes, albums/tracks,
//! books) lives in [`crate::series`], [`crate::music`], and
//! [`crate::publishing`] and hangs off `Work::id`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The top-level taxonomy Playarr Server understands. Deliberately small and
/// closed: everything else (season, album, book...) is a child of a `Work`
/// rather than a `Work` in its own right, because those children don't have
/// independent lifecycle/monitoring semantics at the top level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum WorkKind {
    Movie,
    Series,
    Site,
    Artist,
    Author,
}

/// Where in the availability pipeline a `Work` (or a leaf under it) is
/// sitting. This intentionally mirrors the *arr apps' own state machine
/// (queued/downloading/imported) but is normalized into one shared enum so
/// catalog and playback code doesn't need to know which *arr produced it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum Availability {
    /// We have not yet reconciled this entity against any source instance.
    Unknown,
    /// Monitored and wanted, but not yet found/grabbed anywhere.
    Pending,
    /// Grabbed and importing (downloading, post-processing, being moved).
    Processing,
    /// Some but not all children are available (e.g. 8 of 10 episodes).
    PartiallyAvailable,
    /// Fully available and playable.
    Available,
    /// Previously available, removed from disk (by policy or manually).
    Deleted,
}

/// A cross-reference to the identifier this `Work` (or one of its source
/// records) is known by in an external catalog/metadata provider.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ExternalProvider {
    Tmdb,
    Tvdb,
    Imdb,
    MusicBrainzArtist,
    MusicBrainzReleaseGroup,
    Goodreads,
    Isbn,
    Asin,
    /// ThePornDB -- Whisparr's own metadata provider, structurally the same
    /// role for Whisparr's studio/scene catalog that `Tvdb` plays for
    /// Sonarr's. Given a first-class variant (rather than falling back to
    /// `Other`) for the same reason every other Work-owning source has one:
    /// `playarr-arr-sync::arr_client::work_kind_and_provider` needs a
    /// stable, matchable discriminant to key `Work::external_refs` lookups
    /// on, and every source kind that owns `Work` rows gets one.
    Tpdb,
    /// Escape hatch for providers we don't have a first-class variant for
    /// yet (e.g. AniDB, Discogs) without needing a migration to add one.
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ExternalRef {
    pub provider: ExternalProvider,
    pub external_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ImageKind {
    Poster,
    Backdrop,
    Banner,
    Logo,
    Thumb,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ImageAsset {
    pub kind: ImageKind,
    pub url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// The aggregate root for anything in the catalog. A movie is a `Work` of
/// kind `Movie` with no children; a series/artist/author is a `Work` whose
/// children (seasons, albums, books) live in their own tables keyed by
/// `Work::id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Work {
    pub id: Uuid,
    pub kind: WorkKind,
    pub external_refs: Vec<ExternalRef>,
    pub title: String,
    /// Normalized title used for alphabetical sort/browse ("Test Film,
    /// The" rather than "The Test Film").
    pub sort_title: String,
    pub overview: Option<String>,
    pub images: Vec<ImageAsset>,
    pub genres: Vec<String>,
    /// Free-form user/automation tags (distinct from `genres`, which come
    /// from metadata providers); used by [`crate::Policy`] tag filters.
    pub tags: Vec<String>,
    pub added_at: DateTime<Utc>,
    /// When this title was actually released, per its source *arr app
    /// (Radarr `digitalRelease`/`physicalRelease`, Sonarr `firstAired`) --
    /// distinct from `added_at` (when Playarr Server itself learned about the
    /// work). Populated by `playarr-arr-sync` for `Movie`/`Series`/`Site`
    /// kinds only; `Artist`/`Author` works have no single release date of
    /// their own (their children -- albums/books -- each carry one already),
    /// so this stays `None` for those kinds. See
    /// `backend/migrations/{sqlite,postgres}/00{11,14}_work_release_date.sql`.
    pub release_date: Option<DateTime<Utc>>,
    /// Whether Playarr Server should actively track/request missing children of
    /// this work (mirrors the *arr "monitored" concept).
    pub monitored: bool,
    pub availability: Availability,
}
