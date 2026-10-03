//! Extracts real grab and import events from *arr webhook bodies for the
//! availability-lag statistic (`docs/architecture/release-calendar.md`
//! section 5). Unlike [`crate::webhook`], which only treats a webhook as a
//! hint, this records what the event itself says happened and when it was
//! received, so it reads nothing beyond identity, episode coordinates, the
//! release date and the upgrade flag.

use chrono::{DateTime, NaiveDate, Utc};
use playarr_model::{AvailabilityEvent, AvailabilityEventType, ExternalProvider, SourceKind};
use serde_json::Value;
use uuid::Uuid;

pub fn provider_name(provider: &ExternalProvider) -> String {
    serde_json::to_value(provider)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn str_or_num(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) if n.as_i64().is_some_and(|v| v > 0) => Some(n.to_string()),
        _ => None,
    }
}

fn parse_time(value: Option<&Value>) -> Option<DateTime<Utc>> {
    let raw = value?.as_str()?;
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&Utc));
    }
    NaiveDate::parse_from_str(raw.get(..10)?, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|dt| dt.and_utc())
}

fn event_type(raw: &str) -> Option<AvailabilityEventType> {
    match raw {
        "Grab" => Some(AvailabilityEventType::Grab),
        "Download" | "AlbumDownload" | "BookDownload" => Some(AvailabilityEventType::Import),
        _ => None,
    }
}

/// Zero or more events (one per episode, album or book in the payload).
pub fn extract_availability_events(
    source_instance_id: Uuid,
    kind: SourceKind,
    body: &Value,
    now: DateTime<Utc>,
) -> Vec<AvailabilityEvent> {
    let Some(event_type) = body
        .get("eventType")
        .and_then(Value::as_str)
        .and_then(event_type)
    else {
        return Vec::new();
    };
    let is_upgrade = body
        .get("isUpgrade")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let make = |provider: ExternalProvider,
                external_id: String,
                season: i64,
                episode: i64,
                item_id: i64,
                air_at: Option<DateTime<Utc>>| AvailabilityEvent {
        source_instance_id,
        provider: provider_name(&provider),
        external_id,
        season_number: season,
        episode_number: episode,
        item_id,
        event_type,
        occurred_at: now,
        air_at,
        is_upgrade,
    };

    let mut out = Vec::new();
    match kind {
        SourceKind::Sonarr => {
            let Some(tvdb) = str_or_num(body.pointer("/series/tvdbId")) else {
                return out;
            };
            for episode in body
                .get("episodes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(id) = episode.get("id").and_then(Value::as_i64) else {
                    continue;
                };
                let air_at = parse_time(episode.get("airDateUtc"))
                    .or_else(|| parse_time(episode.get("airDate")));
                out.push(make(
                    ExternalProvider::Tvdb,
                    tvdb.clone(),
                    episode
                        .get("seasonNumber")
                        .and_then(Value::as_i64)
                        .unwrap_or(-1),
                    episode
                        .get("episodeNumber")
                        .and_then(Value::as_i64)
                        .unwrap_or(-1),
                    id,
                    air_at,
                ));
            }
        }
        SourceKind::Radarr => {
            let (Some(tmdb), Some(id)) = (
                str_or_num(body.pointer("/movie/tmdbId")),
                body.pointer("/movie/id").and_then(Value::as_i64),
            ) else {
                return out;
            };
            // The earliest consumer release is what "available" is measured from.
            let air_at = [
                body.pointer("/movie/digitalRelease"),
                body.pointer("/movie/physicalRelease"),
            ]
            .into_iter()
            .filter_map(parse_time)
            .min()
            .or_else(|| parse_time(body.pointer("/movie/releaseDate")));
            out.push(make(ExternalProvider::Tmdb, tmdb, -1, -1, id, air_at));
        }
        SourceKind::Lidarr => {
            let Some(artist) = str_or_num(body.pointer("/artist/mbId"))
                .or_else(|| str_or_num(body.pointer("/artist/foreignArtistId")))
            else {
                return out;
            };
            for album in body
                .get("albums")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(id) = album.get("id").and_then(Value::as_i64) else {
                    continue;
                };
                out.push(make(
                    ExternalProvider::MusicBrainzArtist,
                    artist.clone(),
                    -1,
                    -1,
                    id,
                    parse_time(album.get("releaseDate")),
                ));
            }
        }
        SourceKind::Readarr => {
            let Some(author) = str_or_num(body.pointer("/author/foreignAuthorId"))
                .or_else(|| str_or_num(body.pointer("/author/goodreadsId")))
            else {
                return out;
            };
            for book in body
                .get("books")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(id) = book.get("id").and_then(Value::as_i64) else {
                    continue;
                };
                out.push(make(
                    ExternalProvider::Goodreads,
                    author.clone(),
                    -1,
                    -1,
                    id,
                    parse_time(book.get("releaseDate")),
                ));
            }
        }
        SourceKind::Bazarr | SourceKind::Prowlarr | SourceKind::Whisparr => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 4, 12, 0, 0).unwrap()
    }

    #[test]
    fn sonarr_import_yields_one_event_per_episode_with_air_time() {
        let body = json!({
            "eventType": "Download", "isUpgrade": false,
            "series": {"id": 3, "tvdbId": 42},
            "episodes": [
                {"id": 10, "seasonNumber": 1, "episodeNumber": 1, "airDateUtc": "2026-10-04T01:00:00Z"},
                {"id": 11, "seasonNumber": 1, "episodeNumber": 2, "airDate": "2026-10-05"}
            ]
        });
        let events = extract_availability_events(Uuid::nil(), SourceKind::Sonarr, &body, now());
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].provider, "tvdb");
        assert_eq!(events[0].external_id, "42");
        assert_eq!(events[0].event_type, AvailabilityEventType::Import);
        assert_eq!(
            events[1].air_at,
            Some(Utc.with_ymd_and_hms(2026, 10, 5, 0, 0, 0).unwrap())
        );
    }

    #[test]
    fn grab_and_upgrade_flags_and_unrelated_events() {
        let body = json!({
            "eventType": "Grab", "series": {"tvdbId": 42},
            "episodes": [{"id": 1, "seasonNumber": 2, "episodeNumber": 3}]
        });
        let e = extract_availability_events(Uuid::nil(), SourceKind::Sonarr, &body, now());
        assert_eq!(e[0].event_type, AvailabilityEventType::Grab);
        assert_eq!(e[0].air_at, None, "missing air time stays explicit");
        let upgrade = json!({"eventType": "Download", "isUpgrade": true, "series": {"tvdbId": 42}, "episodes": [{"id": 1}]});
        assert!(
            extract_availability_events(Uuid::nil(), SourceKind::Sonarr, &upgrade, now())[0]
                .is_upgrade
        );
        let health = json!({"eventType": "Health"});
        assert!(
            extract_availability_events(Uuid::nil(), SourceKind::Sonarr, &health, now()).is_empty()
        );
        let no_identity = json!({"eventType": "Download", "series": {}, "episodes": [{"id": 1}]});
        assert!(
            extract_availability_events(Uuid::nil(), SourceKind::Sonarr, &no_identity, now())
                .is_empty()
        );
    }

    #[test]
    fn radarr_uses_the_earliest_consumer_release() {
        let body = json!({
            "eventType": "Download",
            "movie": {"id": 5, "tmdbId": 9, "releaseDate": "2026-01-01",
                      "digitalRelease": "2026-10-10T00:00:00Z", "physicalRelease": "2026-10-02T00:00:00Z"}
        });
        let e = extract_availability_events(Uuid::nil(), SourceKind::Radarr, &body, now());
        assert_eq!(e[0].provider, "tmdb");
        assert_eq!(
            e[0].air_at,
            Some(Utc.with_ymd_and_hms(2026, 10, 2, 0, 0, 0).unwrap())
        );
    }

    #[test]
    fn lidarr_and_readarr_map_albums_and_books() {
        let lid = json!({"eventType": "Download", "artist": {"mbId": "mb-1"},
            "albums": [{"id": 1, "releaseDate": "2026-10-01T00:00:00Z"}]});
        let e = extract_availability_events(Uuid::nil(), SourceKind::Lidarr, &lid, now());
        assert_eq!(e[0].external_id, "mb-1");
        let rd = json!({"eventType": "Download", "author": {"goodreadsId": "77"},
            "books": [{"id": 2, "releaseDate": "2026-10-01"}]});
        let e = extract_availability_events(Uuid::nil(), SourceKind::Readarr, &rd, now());
        assert_eq!(e[0].external_id, "77");
    }
}
