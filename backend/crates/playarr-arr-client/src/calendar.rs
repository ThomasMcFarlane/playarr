//! Calendar resources returned by the *arr `/calendar` endpoints.
//!
//! Every date is kept as the raw string the app sent (RFC 3339 instant or
//! `YYYY-MM-DD`): the apps disagree on which, and a single unparsable date
//! must not fail the whole calendar response. Normalisation lives in
//! `playarr-arr-sync::calendar`.

use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

/// An artwork entry on a calendar resource. Only `remote_url` is ever safe to
/// forward to a client; `url` is an instance-local, API-key-gated path.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArrCalendarImage {
    #[serde(rename = "coverType")]
    pub cover_type: String,
    #[serde(default, rename = "remoteUrl")]
    pub remote_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarrCalendarSeries {
    pub id: i64,
    pub title: String,
    #[serde(default, rename = "tvdbId")]
    pub tvdb_id: Option<i64>,
    #[serde(default)]
    pub images: Vec<ArrCalendarImage>,
}

/// An episode from Sonarr's `/api/v3/calendar?includeSeries=true`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarrCalendarEpisode {
    pub id: i64,
    #[serde(default, rename = "seriesId")]
    pub series_id: i64,
    #[serde(default, rename = "seasonNumber")]
    pub season_number: i64,
    #[serde(default, rename = "episodeNumber")]
    pub episode_number: i64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, rename = "airDate")]
    pub air_date: Option<String>,
    #[serde(default, rename = "airDateUtc")]
    pub air_date_utc: Option<String>,
    #[serde(default, rename = "hasFile")]
    pub has_file: bool,
    #[serde(default)]
    pub monitored: bool,
    #[serde(default)]
    pub series: Option<SonarrCalendarSeries>,
}

/// A movie from Radarr's `/api/v3/calendar`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarrCalendarMovie {
    pub id: i64,
    pub title: String,
    #[serde(default, rename = "tmdbId")]
    pub tmdb_id: Option<i64>,
    #[serde(default, rename = "inCinemas")]
    pub in_cinemas: Option<String>,
    #[serde(default, rename = "digitalRelease")]
    pub digital_release: Option<String>,
    #[serde(default, rename = "physicalRelease")]
    pub physical_release: Option<String>,
    #[serde(default, rename = "hasFile")]
    pub has_file: bool,
    #[serde(default)]
    pub monitored: bool,
    #[serde(default)]
    pub images: Vec<ArrCalendarImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrCalendarArtist {
    #[serde(default, rename = "artistName")]
    pub artist_name: Option<String>,
    #[serde(default, rename = "foreignArtistId")]
    pub foreign_artist_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CalendarStatistics {
    #[serde(default, rename = "trackFileCount")]
    pub track_file_count: i64,
    #[serde(default, rename = "bookFileCount")]
    pub book_file_count: i64,
}

/// An album from Lidarr's `/api/v1/calendar?includeArtist=true`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LidarrCalendarAlbum {
    pub id: i64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, rename = "foreignAlbumId")]
    pub foreign_album_id: Option<String>,
    #[serde(default, rename = "releaseDate")]
    pub release_date: Option<String>,
    #[serde(default)]
    pub monitored: bool,
    #[serde(default)]
    pub images: Vec<ArrCalendarImage>,
    #[serde(default)]
    pub artist: Option<LidarrCalendarArtist>,
    #[serde(default)]
    pub statistics: Option<CalendarStatistics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadarrCalendarAuthor {
    #[serde(default, rename = "authorName")]
    pub author_name: Option<String>,
    #[serde(default, rename = "foreignAuthorId")]
    pub foreign_author_id: Option<String>,
}

/// A book from Readarr's `/api/v1/calendar?includeAuthor=true`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadarrCalendarBook {
    pub id: i64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, rename = "foreignBookId")]
    pub foreign_book_id: Option<String>,
    #[serde(default, rename = "releaseDate")]
    pub release_date: Option<String>,
    #[serde(default)]
    pub monitored: bool,
    #[serde(default)]
    pub images: Vec<ArrCalendarImage>,
    #[serde(default)]
    pub author: Option<ReadarrCalendarAuthor>,
    #[serde(default)]
    pub statistics: Option<CalendarStatistics>,
}

/// Query string for an inclusive `[start, end]` day window. The apps treat
/// `end` as an instant, so the day after `end` is sent to include all of it.
pub(crate) fn window_query(start: NaiveDate, end: NaiveDate, include: &str) -> String {
    let end_exclusive = end + Duration::days(1);
    let base = format!("start={start}&end={end_exclusive}&unmonitored=true");
    if include.is_empty() {
        base
    } else {
        format!("{base}&{include}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_query_includes_the_whole_end_day() {
        let start = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2026, 10, 31).unwrap();
        assert_eq!(
            window_query(start, end, "includeSeries=true"),
            "start=2026-10-01&end=2026-11-01&unmonitored=true&includeSeries=true"
        );
    }
}
