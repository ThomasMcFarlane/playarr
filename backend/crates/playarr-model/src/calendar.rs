//! Aggregated release calendar types. See `docs/architecture/release-calendar.md`.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::SourceKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum CalendarMediaKind {
    Episode,
    Movie,
    Album,
    Book,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum CalendarReleaseType {
    /// An episode airing.
    Air,
    Cinema,
    Digital,
    Physical,
    /// An album or book release.
    Release,
}

/// One instance that reported a calendar entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CalendarEntrySource {
    pub source_instance_id: Uuid,
    pub source_name: String,
    pub source_kind: SourceKind,
    /// The source app's own id for the episode, movie, album or book.
    pub arr_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CalendarEntry {
    /// Stable across refreshes; derived from the deduplication key.
    pub id: String,
    pub media_kind: CalendarMediaKind,
    pub release_type: CalendarReleaseType,
    /// Series, movie, artist or author title.
    pub title: String,
    /// Episode, album or book title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season_number: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_number: Option<i64>,
    /// UTC calendar day of the release.
    pub date: NaiveDate,
    /// Exact instant when the source provides one; absent for all-day entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_at: Option<DateTime<Utc>>,
    pub monitored: bool,
    pub has_file: bool,
    /// Absolute external artwork URL only, never an instance-local path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster_url: Option<String>,
    /// The catalog `Work` this entry belongs to, when it is in the catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_id: Option<Uuid>,
    /// Average seconds from air to library availability for the series.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub average_lag_seconds: Option<i64>,
    pub sources: Vec<CalendarEntrySource>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum CalendarSourceState {
    Ok,
    /// Connection failed or timed out.
    Unreachable,
    /// The instance answered but refused the stored credentials.
    Rejected,
    /// Any other failure (unexpected status, undecodable body).
    Error,
}

/// Per-instance outcome of one calendar query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CalendarSourceStatus {
    pub source_instance_id: Uuid,
    pub name: String,
    pub kind: SourceKind,
    pub status: CalendarSourceState,
    /// Short reason; never contains URLs or credentials.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub entry_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CalendarResponse {
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub entries: Vec<CalendarEntry>,
    pub sources: Vec<CalendarSourceStatus>,
}
