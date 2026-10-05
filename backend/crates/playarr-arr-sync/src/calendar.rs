//! Fetches each *arr instance's calendar and normalises it into
//! [`CalendarEntry`] values. See `docs/architecture/release-calendar.md`.
//!
//! Nothing here touches the database: the calendar is always answered live
//! from the sources, so `playarr-api` owns caching, permissions and the
//! catalog `work_id` join.

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, Timelike, Utc};
use playarr_arr_client::{
    ArrCalendarImage, ArrClientError, LidarrClient, RadarrClient, ReadarrClient, SonarrClient,
};
use playarr_model::{
    CalendarEntry, CalendarEntrySource, CalendarMediaKind, CalendarReleaseType,
    CalendarSourceState, ExternalProvider, SourceInstance, SourceKind,
};

/// A normalised entry plus what the API layer needs to finish it.
#[derive(Debug, Clone)]
pub struct CalendarCandidate {
    pub entry: CalendarEntry,
    /// Entries from different instances with the same key are one entry.
    /// `None` when the source gave no provider id, so it is never merged.
    pub dedup_key: Option<String>,
    /// Catalog lookup for `work_id`.
    pub work_ref: Option<(ExternalProvider, String)>,
}

/// Fetches and normalises one instance's calendar for the inclusive window.
/// Kinds without a calendar (Bazarr, Prowlarr, Whisparr) yield no entries.
pub async fn fetch_calendar(
    instance: &SourceInstance,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<Vec<CalendarCandidate>, ArrClientError> {
    let base_url = instance.base_url.clone();
    let api_key = instance.api_key_encrypted.expose_secret().clone();
    let source = |arr_id: i64| CalendarEntrySource {
        source_instance_id: instance.id,
        source_name: instance.name.clone(),
        source_kind: instance.kind,
        arr_id,
    };
    let mut out = Vec::new();
    match instance.kind {
        SourceKind::Sonarr => {
            for ep in SonarrClient::new(base_url, api_key)
                .calendar(start, end)
                .await?
            {
                let Some((date, release_at)) = ep
                    .air_date_utc
                    .as_deref()
                    .and_then(parse_instant)
                    .map(|dt| (dt.date_naive(), Some(dt)))
                    .or_else(|| {
                        ep.air_date
                            .as_deref()
                            .and_then(parse_day)
                            .map(|d| (d, None))
                    })
                else {
                    continue;
                };
                if !in_window(date, start, end) {
                    continue;
                }
                let series_title = ep
                    .series
                    .as_ref()
                    .map(|s| s.title.clone())
                    .unwrap_or_else(|| format!("Series {}", ep.series_id));
                let tvdb = ep
                    .series
                    .as_ref()
                    .and_then(|s| s.tvdb_id)
                    .filter(|v| *v > 0);
                let key_base = match tvdb {
                    Some(id) => format!(
                        "episode:tvdb{id}:s{}e{}",
                        ep.season_number, ep.episode_number
                    ),
                    None => format!("episode:src{}:{}", instance.id, ep.id),
                };
                let dedup = tvdb.map(|_| format!("{key_base}:air:{date}"));
                out.push(CalendarCandidate {
                    entry: CalendarEntry {
                        id: format!("{key_base}:air:{date}"),
                        media_kind: CalendarMediaKind::Episode,
                        release_type: CalendarReleaseType::Air,
                        title: series_title,
                        subtitle: ep.title.clone().filter(|t| !t.is_empty()),
                        season_number: Some(ep.season_number),
                        episode_number: Some(ep.episode_number),
                        date,
                        release_at,
                        monitored: ep.monitored,
                        has_file: ep.has_file,
                        poster_url: ep.series.as_ref().and_then(|s| poster(&s.images)),
                        work_id: None,
                        average_lag_seconds: None,
                        sources: vec![source(ep.id)],
                        snapshot: None,
                        actions: vec![],
                        members: vec![],
                    },
                    dedup_key: dedup,
                    work_ref: tvdb.map(|id| (ExternalProvider::Tvdb, id.to_string())),
                });
            }
        }
        SourceKind::Radarr => {
            for movie in RadarrClient::new(base_url, api_key)
                .calendar(start, end)
                .await?
            {
                let tmdb = movie.tmdb_id.filter(|v| *v > 0);
                let dates = [
                    (CalendarReleaseType::Cinema, "cinema", &movie.in_cinemas),
                    (
                        CalendarReleaseType::Digital,
                        "digital",
                        &movie.digital_release,
                    ),
                    (
                        CalendarReleaseType::Physical,
                        "physical",
                        &movie.physical_release,
                    ),
                ];
                for (release_type, label, raw) in dates {
                    let Some(date) = raw.as_deref().and_then(parse_date_only) else {
                        continue;
                    };
                    if !in_window(date, start, end) {
                        continue;
                    }
                    let key_base = match tmdb {
                        Some(id) => format!("movie:tmdb{id}:{label}"),
                        None => format!("movie:src{}:{}:{label}", instance.id, movie.id),
                    };
                    out.push(CalendarCandidate {
                        entry: CalendarEntry {
                            id: format!("{key_base}:{date}"),
                            media_kind: CalendarMediaKind::Movie,
                            release_type,
                            title: movie.title.clone(),
                            subtitle: None,
                            season_number: None,
                            episode_number: None,
                            date,
                            release_at: None,
                            monitored: movie.monitored,
                            has_file: movie.has_file,
                            poster_url: poster(&movie.images),
                            work_id: None,
                            average_lag_seconds: None,
                            sources: vec![source(movie.id)],
                            snapshot: None,
                            actions: vec![],
                            members: vec![],
                        },
                        dedup_key: tmdb.map(|_| format!("{key_base}:{date}")),
                        work_ref: tmdb.map(|id| (ExternalProvider::Tmdb, id.to_string())),
                    });
                }
            }
        }
        SourceKind::Lidarr => {
            for album in LidarrClient::new(base_url, api_key)
                .calendar(start, end)
                .await?
            {
                let Some(date) = album.release_date.as_deref().and_then(parse_date_only) else {
                    continue;
                };
                if !in_window(date, start, end) {
                    continue;
                }
                let foreign = album.foreign_album_id.clone().filter(|v| !v.is_empty());
                let key_base = match &foreign {
                    Some(id) => format!("album:mb{id}"),
                    None => format!("album:src{}:{}", instance.id, album.id),
                };
                let artist = album.artist.as_ref();
                out.push(CalendarCandidate {
                    entry: CalendarEntry {
                        id: format!("{key_base}:release:{date}"),
                        media_kind: CalendarMediaKind::Album,
                        release_type: CalendarReleaseType::Release,
                        title: artist
                            .and_then(|a| a.artist_name.clone())
                            .unwrap_or_else(|| "Unknown artist".to_string()),
                        subtitle: album.title.clone().filter(|t| !t.is_empty()),
                        season_number: None,
                        episode_number: None,
                        date,
                        release_at: None,
                        monitored: album.monitored,
                        has_file: album
                            .statistics
                            .as_ref()
                            .is_some_and(|s| s.track_file_count > 0),
                        poster_url: poster(&album.images),
                        work_id: None,
                        average_lag_seconds: None,
                        sources: vec![source(album.id)],
                        snapshot: None,
                        actions: vec![],
                        members: vec![],
                    },
                    dedup_key: foreign.map(|_| format!("{key_base}:release:{date}")),
                    work_ref: artist
                        .and_then(|a| a.foreign_artist_id.clone())
                        .filter(|v| !v.is_empty())
                        .map(|id| (ExternalProvider::MusicBrainzArtist, id)),
                });
            }
        }
        SourceKind::Readarr => {
            for book in ReadarrClient::new(base_url, api_key)
                .calendar(start, end)
                .await?
            {
                let Some(date) = book.release_date.as_deref().and_then(parse_date_only) else {
                    continue;
                };
                if !in_window(date, start, end) {
                    continue;
                }
                let foreign = book.foreign_book_id.clone().filter(|v| !v.is_empty());
                let key_base = match &foreign {
                    Some(id) => format!("book:gr{id}"),
                    None => format!("book:src{}:{}", instance.id, book.id),
                };
                let author = book.author.as_ref();
                out.push(CalendarCandidate {
                    entry: CalendarEntry {
                        id: format!("{key_base}:release:{date}"),
                        media_kind: CalendarMediaKind::Book,
                        release_type: CalendarReleaseType::Release,
                        title: author
                            .and_then(|a| a.author_name.clone())
                            .unwrap_or_else(|| "Unknown author".to_string()),
                        subtitle: book.title.clone().filter(|t| !t.is_empty()),
                        season_number: None,
                        episode_number: None,
                        date,
                        release_at: None,
                        monitored: book.monitored,
                        has_file: book
                            .statistics
                            .as_ref()
                            .is_some_and(|s| s.book_file_count > 0),
                        poster_url: poster(&book.images),
                        work_id: None,
                        average_lag_seconds: None,
                        sources: vec![source(book.id)],
                        snapshot: None,
                        actions: vec![],
                        members: vec![],
                    },
                    dedup_key: foreign.map(|_| format!("{key_base}:release:{date}")),
                    work_ref: author
                        .and_then(|a| a.foreign_author_id.clone())
                        .filter(|v| !v.is_empty())
                        .map(|id| (ExternalProvider::Goodreads, id)),
                });
            }
        }
        SourceKind::Bazarr | SourceKind::Prowlarr | SourceKind::Whisparr | SourceKind::Dubarr => {}
    }
    Ok(out)
}

/// Merges entries that describe the same release across instances, then
/// sorts by `(date, title, season, episode, id)`.
pub fn merge_candidates(candidates: Vec<CalendarCandidate>) -> Vec<CalendarCandidate> {
    let mut merged: BTreeMap<String, CalendarCandidate> = BTreeMap::new();
    let mut unkeyed = Vec::new();
    for candidate in candidates {
        let Some(key) = candidate.dedup_key.clone() else {
            unkeyed.push(candidate);
            continue;
        };
        match merged.get_mut(&key) {
            None => {
                merged.insert(key, candidate);
            }
            Some(existing) => {
                let e = &mut existing.entry;
                let c = candidate.entry;
                e.monitored |= c.monitored;
                e.has_file |= c.has_file;
                if e.poster_url.is_none() {
                    e.poster_url = c.poster_url;
                }
                if e.release_at.is_none() {
                    e.release_at = c.release_at;
                }
                if e.subtitle.is_none() {
                    e.subtitle = c.subtitle;
                }
                for src in c.sources {
                    if !e.sources.contains(&src) {
                        e.sources.push(src);
                    }
                }
            }
        }
    }
    let mut out: Vec<CalendarCandidate> = merged.into_values().chain(unkeyed).collect();
    for c in &mut out {
        c.entry.sources.sort_by(|a, b| {
            (a.source_name.as_str(), a.source_instance_id)
                .cmp(&(b.source_name.as_str(), b.source_instance_id))
        });
    }
    out.sort_by(|a, b| {
        let (a, b) = (&a.entry, &b.entry);
        (
            a.date,
            a.title.to_lowercase(),
            a.season_number,
            a.episode_number,
            &a.id,
        )
            .cmp(&(
                b.date,
                b.title.to_lowercase(),
                b.season_number,
                b.episode_number,
                &b.id,
            ))
    });
    out
}

/// Maps a client error to a status plus a message safe to show end users
/// (no URL, host or credential material).
pub fn classify_error(error: &ArrClientError) -> (CalendarSourceState, String) {
    match error {
        ArrClientError::Request(_) => (
            CalendarSourceState::Unreachable,
            "could not connect or timed out".to_string(),
        ),
        ArrClientError::UnexpectedStatus { status, .. }
            if status.as_u16() == 401 || status.as_u16() == 403 =>
        {
            (
                CalendarSourceState::Rejected,
                format!("credentials rejected (HTTP {})", status.as_u16()),
            )
        }
        ArrClientError::UnexpectedStatus { status, .. } => (
            CalendarSourceState::Error,
            format!("unexpected response (HTTP {})", status.as_u16()),
        ),
        ArrClientError::Io(_) => (CalendarSourceState::Error, "local file error".to_string()),
        ArrClientError::Decode { .. } => (
            CalendarSourceState::Error,
            "response could not be read".to_string(),
        ),
    }
}

fn in_window(date: NaiveDate, start: NaiveDate, end: NaiveDate) -> bool {
    date >= start && date <= end
}

fn parse_instant(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn parse_day(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw.get(..10)?, "%Y-%m-%d").ok()
}

/// Date of a source value that is a release *day* (movies, albums, books),
/// whether the app sent `2026-10-20` or `2026-10-20T00:00:00Z`.
fn parse_date_only(raw: &str) -> Option<NaiveDate> {
    match parse_instant(raw) {
        Some(dt) if dt.hour() == 0 && dt.minute() == 0 => Some(dt.date_naive()),
        Some(dt) => Some(dt.date_naive()),
        None => parse_day(raw),
    }
}

fn poster(images: &[ArrCalendarImage]) -> Option<String> {
    images
        .iter()
        .filter(|img| matches!(img.cover_type.as_str(), "poster" | "cover"))
        .filter_map(|img| img.remote_url.as_deref())
        .find(|url| {
            reqwest::Url::parse(url)
                .map(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some())
                .unwrap_or(false)
        })
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use playarr_model::Sensitive;
    use serde_json::json;
    use uuid::Uuid;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    fn instance(kind: SourceKind, name: &str, url: String) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind,
            name: name.to_string(),
            base_url: url,
            api_key_encrypted: Sensitive::new("k".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        }
    }

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    async fn mount(server: &MockServer, p: &str, body: serde_json::Value) {
        Mock::given(method("GET"))
            .and(path(p))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn sonarr_episode_is_normalised_with_exact_air_time() {
        let server = MockServer::start().await;
        mount(
            &server,
            "/api/v3/calendar",
            json!([{
                "id": 7, "seriesId": 3, "seasonNumber": 2, "episodeNumber": 5, "title": "Pilot",
                "airDate": "2026-10-04", "airDateUtc": "2026-10-04T01:00:00Z",
                "hasFile": false, "monitored": true,
                "series": {"id": 3, "title": "Show", "tvdbId": 42, "images": [
                    {"coverType": "banner", "remoteUrl": "https://img.example/b.jpg"},
                    {"coverType": "poster", "url": "/local/p.jpg", "remoteUrl": "https://img.example/p.jpg"}]}
            }]),
        )
        .await;
        let inst = instance(SourceKind::Sonarr, "TV", server.uri());
        let got = fetch_calendar(&inst, day("2026-10-01"), day("2026-10-31"))
            .await
            .unwrap();
        assert_eq!(got.len(), 1);
        let e = &got[0].entry;
        assert_eq!(e.id, "episode:tvdb42:s2e5:air:2026-10-04");
        assert_eq!(e.title, "Show");
        assert_eq!(e.subtitle.as_deref(), Some("Pilot"));
        assert_eq!(e.date, day("2026-10-04"));
        assert!(e.release_at.is_some());
        assert_eq!(e.poster_url.as_deref(), Some("https://img.example/p.jpg"));
        assert_eq!(got[0].work_ref, Some((ExternalProvider::Tvdb, "42".into())));
    }

    #[tokio::test]
    async fn radarr_movie_yields_one_entry_per_date_inside_the_window() {
        let server = MockServer::start().await;
        mount(
            &server,
            "/api/v3/calendar",
            json!([{
                "id": 1, "title": "Film", "tmdbId": 9, "monitored": true, "hasFile": false,
                "inCinemas": "2026-09-01T00:00:00Z",
                "digitalRelease": "2026-10-20T00:00:00Z",
                "physicalRelease": "2026-10-28"
            }]),
        )
        .await;
        let inst = instance(SourceKind::Radarr, "Movies", server.uri());
        let got = fetch_calendar(&inst, day("2026-10-01"), day("2026-10-31"))
            .await
            .unwrap();
        let kinds: Vec<_> = got.iter().map(|c| c.entry.release_type).collect();
        assert_eq!(
            kinds,
            vec![CalendarReleaseType::Digital, CalendarReleaseType::Physical]
        );
        assert!(got.iter().all(|c| c.entry.release_at.is_none()));
    }

    #[tokio::test]
    async fn lidarr_and_readarr_map_artist_and_author_refs() {
        let server = MockServer::start().await;
        mount(
            &server,
            "/api/v1/calendar",
            json!([{
                "id": 5, "title": "Record", "foreignAlbumId": "rg-1", "releaseDate": "2026-10-10T00:00:00Z",
                "monitored": true, "artist": {"artistName": "Band", "foreignArtistId": "mb-9"},
                "statistics": {"trackFileCount": 3}
            }]),
        )
        .await;
        let lid = instance(SourceKind::Lidarr, "Music", server.uri());
        let got = fetch_calendar(&lid, day("2026-10-01"), day("2026-10-31"))
            .await
            .unwrap();
        assert_eq!(got[0].entry.title, "Band");
        assert_eq!(got[0].entry.subtitle.as_deref(), Some("Record"));
        assert!(got[0].entry.has_file);
        assert_eq!(
            got[0].work_ref,
            Some((ExternalProvider::MusicBrainzArtist, "mb-9".into()))
        );

        let server = MockServer::start().await;
        mount(
            &server,
            "/api/v1/calendar",
            json!([{
                "id": 8, "title": "Novel", "foreignBookId": "b-1", "releaseDate": "2026-10-12T00:00:00Z",
                "author": {"authorName": "Writer", "foreignAuthorId": "a-1"}
            }]),
        )
        .await;
        let rd = instance(SourceKind::Readarr, "Books", server.uri());
        let got = fetch_calendar(&rd, day("2026-10-01"), day("2026-10-31"))
            .await
            .unwrap();
        assert_eq!(got[0].entry.media_kind, CalendarMediaKind::Book);
        assert_eq!(
            got[0].work_ref,
            Some((ExternalProvider::Goodreads, "a-1".into()))
        );
    }

    #[test]
    fn merge_combines_instances_and_keeps_unkeyed_entries_apart() {
        let mk =
            |inst: &str, key: Option<&str>, monitored: bool, has_file: bool| CalendarCandidate {
                entry: CalendarEntry {
                    id: key.unwrap_or(inst).to_string(),
                    media_kind: CalendarMediaKind::Movie,
                    release_type: CalendarReleaseType::Digital,
                    title: "Film".into(),
                    subtitle: None,
                    season_number: None,
                    episode_number: None,
                    date: day("2026-10-20"),
                    release_at: None,
                    monitored,
                    has_file,
                    poster_url: None,
                    work_id: None,
                    average_lag_seconds: None,
                    snapshot: None,
                    actions: vec![],
                    members: vec![],
                    sources: vec![CalendarEntrySource {
                        source_instance_id: Uuid::new_v4(),
                        source_name: inst.into(),
                        source_kind: SourceKind::Radarr,
                        arr_id: 1,
                    }],
                },
                dedup_key: key.map(str::to_string),
                work_ref: None,
            };
        let merged = merge_candidates(vec![
            mk("HD", Some("movie:tmdb9:digital:2026-10-20"), false, false),
            mk("4K", Some("movie:tmdb9:digital:2026-10-20"), true, true),
            mk("odd-1", None, true, false),
            mk("odd-2", None, true, false),
        ]);
        assert_eq!(merged.len(), 3);
        let shared = merged.iter().find(|c| c.dedup_key.is_some()).unwrap();
        assert_eq!(shared.entry.sources.len(), 2);
        assert!(shared.entry.monitored && shared.entry.has_file);
    }

    #[test]
    fn classify_error_hides_urls_and_distinguishes_rejection() {
        let rejected = ArrClientError::UnexpectedStatus {
            app: "sonarr",
            status: reqwest::StatusCode::UNAUTHORIZED,
            body: "http://secret.internal key".into(),
        };
        let (state, msg) = classify_error(&rejected);
        assert_eq!(state, CalendarSourceState::Rejected);
        assert!(!msg.contains("secret"));
        let server_error = ArrClientError::UnexpectedStatus {
            app: "sonarr",
            status: reqwest::StatusCode::BAD_GATEWAY,
            body: String::new(),
        };
        assert_eq!(classify_error(&server_error).0, CalendarSourceState::Error);
    }

    #[tokio::test]
    async fn unreachable_instance_surfaces_as_error() {
        let inst = instance(SourceKind::Sonarr, "Down", "http://127.0.0.1:1".into());
        let err = fetch_calendar(&inst, day("2026-10-01"), day("2026-10-31"))
            .await
            .unwrap_err();
        assert_eq!(classify_error(&err).0, CalendarSourceState::Unreachable);
    }
}
