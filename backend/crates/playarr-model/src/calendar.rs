//! Aggregated release calendar types. See `docs/architecture/release-calendar.md`.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::discovery::TitleSnapshot;
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
    /// The instance name as the admin set it. User-facing responses replace it with
    /// `display_label`, so only admins ever see the real name.
    pub source_name: String,
    /// Neutral label (for example "Movies"); safe to show to any user.
    #[serde(default)]
    pub display_label: String,
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
    /// Synopsis of the episode (the series' when the episode has none) or movie, as the source
    /// reported it. Absent when the source gave none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overview: Option<String>,
    pub sources: Vec<CalendarEntrySource>,
    /// Identity of the title for the request and watchlist endpoints
    /// (`POST /api/v1/discover/request`, `POST /api/v1/watchlist`); clients send
    /// it back verbatim instead of building their own. Absent when the entry
    /// has no external id to identify it by.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<TitleSnapshot>,
    /// What the caller can do with this entry, computed by the server for that
    /// caller (library access, household limits, `can_request`, request
    /// provider, existing requests, watchlist). Clients show these as given.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<CalendarAction>,
    /// Present on a grouped entry (`group=series_day`): every episode folded
    /// into this entry, in season and episode order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<CalendarGroupMember>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum CalendarActionKind {
    /// Open the title's detail page.
    Open,
    /// Play exactly this entry: offered only when the library holds its own
    /// file (never an unaired or file-less episode, never another episode).
    Play,
    /// Continue a part-watched title.
    Resume,
    /// Ask the request provider to add the title.
    Request,
    /// Add to (or, when `active`, remove from) the caller's watchlist.
    Watchlist,
}

/// One server-computed action. A disabled action carries a `reason` so a
/// client can explain it rather than hide it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CalendarAction {
    pub action: CalendarActionKind,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Library work to open or play.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_file_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<u64>,
    /// `watchlist`: the title is already on the caller's watchlist.
    /// `request`: the title is already requested (so the action is disabled).
    #[serde(default)]
    pub active: bool,
}

/// An episode folded into a grouped calendar entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CalendarGroupMember {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season_number: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_number: Option<i64>,
    pub monitored: bool,
    pub has_file: bool,
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
    /// Equals `display_label` in user-facing responses.
    pub name: String,
    /// Neutral label (for example "Movies"); safe to show to any user.
    #[serde(default)]
    pub display_label: String,
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
