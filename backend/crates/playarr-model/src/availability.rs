//! Availability lag: how long after an item aired or released it became
//! available in the library. See `docs/architecture/release-calendar.md`
//! section 5.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

/// Imports later than this after the release are classed as backfills.
pub const BACKFILL_THRESHOLD_DAYS: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AvailabilityEventType {
    Grab,
    Import,
}

/// A real grab or import reported by an *arr instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AvailabilityEvent {
    pub source_instance_id: uuid::Uuid,
    /// Metadata provider of the series, movie, artist or author
    /// (`ExternalProvider` snake_case name) and its id there.
    pub provider: String,
    pub external_id: String,
    /// Episode coordinates; `-1` when the item has none (movies, albums, books).
    pub season_number: i64,
    pub episode_number: i64,
    /// The *arr's own id for the item (episode, movie, album or book).
    pub item_id: i64,
    pub event_type: AvailabilityEventType,
    pub occurred_at: DateTime<Utc>,
    /// Release or air time known when the event happened.
    pub air_at: Option<DateTime<Utc>>,
    pub is_upgrade: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AvailabilityLagSample {
    pub season_number: Option<i64>,
    pub episode_number: Option<i64>,
    pub air_at: DateTime<Utc>,
    pub imported_at: DateTime<Utc>,
    pub lag_seconds: i64,
}

/// Average time until availability for one series, movie, artist or author.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AvailabilityLag {
    /// Mean seconds from air/release to first import; `null` with no samples.
    pub average_seconds: Option<i64>,
    /// Items that contributed to `average_seconds`.
    pub sample_count: u32,
    /// Items first imported more than `backfill_threshold_days` after release:
    /// counted here and excluded from the average.
    pub backfill_count: u32,
    /// Items with no release time, or imported before it aired: excluded.
    pub unknown_count: u32,
    pub backfill_threshold_days: u32,
    /// Mean seconds from release to first grab over the same samples.
    pub average_grab_seconds: Option<i64>,
    /// Most recent samples, newest first (at most 20).
    pub samples: Vec<AvailabilityLagSample>,
}

/// Computes the statistic from every recorded event of one work.
///
/// Only the first non-upgrade import of an item counts. Items with
/// no air time, or imported before airing, are `unknown`; items first
/// imported more than [`BACKFILL_THRESHOLD_DAYS`] after airing are `backfill`.
pub fn compute_lag(events: &[AvailabilityEvent]) -> AvailabilityLag {
    use std::collections::BTreeMap;
    type Key = (i64, i64, i64);
    let key = |e: &AvailabilityEvent| -> Key { (e.season_number, e.episode_number, e.item_id) };

    let mut first_import: BTreeMap<Key, &AvailabilityEvent> = BTreeMap::new();
    let mut first_grab: BTreeMap<Key, DateTime<Utc>> = BTreeMap::new();
    for event in events {
        match event.event_type {
            AvailabilityEventType::Import if !event.is_upgrade => {
                let slot = first_import.entry(key(event)).or_insert(event);
                if event.occurred_at < slot.occurred_at {
                    *slot = event;
                }
            }
            AvailabilityEventType::Grab if !event.is_upgrade => {
                let slot = first_grab.entry(key(event)).or_insert(event.occurred_at);
                if event.occurred_at < *slot {
                    *slot = event.occurred_at;
                }
            }
            _ => {}
        }
    }

    let threshold = Duration::days(BACKFILL_THRESHOLD_DAYS);
    let (mut backfill, mut unknown) = (0u32, 0u32);
    let mut samples = Vec::new();
    let mut grab_total = 0i64;
    let mut grab_count = 0i64;
    for (k, import) in &first_import {
        let air_at = import.air_at.or_else(|| {
            events
                .iter()
                .filter(|e| key(e) == *k)
                .find_map(|e| e.air_at)
        });
        let Some(air_at) = air_at else {
            unknown += 1;
            continue;
        };
        let lag = import.occurred_at - air_at;
        if lag < Duration::zero() {
            unknown += 1;
        } else if lag > threshold {
            backfill += 1;
        } else {
            if let Some(grabbed) = first_grab.get(k) {
                let grab_lag = (*grabbed - air_at).num_seconds();
                if grab_lag >= 0 {
                    grab_total += grab_lag;
                    grab_count += 1;
                }
            }
            samples.push(AvailabilityLagSample {
                season_number: (k.0 >= 0).then_some(k.0),
                episode_number: (k.1 >= 0).then_some(k.1),
                air_at,
                imported_at: import.occurred_at,
                lag_seconds: lag.num_seconds(),
            });
        }
    }

    let sample_count = samples.len() as u32;
    let average_seconds = (sample_count > 0)
        .then(|| samples.iter().map(|s| s.lag_seconds).sum::<i64>() / i64::from(sample_count));
    samples.sort_by_key(|a| std::cmp::Reverse(a.imported_at));
    samples.truncate(20);
    AvailabilityLag {
        average_seconds,
        sample_count,
        backfill_count: backfill,
        unknown_count: unknown,
        backfill_threshold_days: BACKFILL_THRESHOLD_DAYS as u32,
        average_grab_seconds: (grab_count > 0).then(|| grab_total / grab_count),
        samples,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use uuid::Uuid;

    fn at(day: u32, hour: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, day, hour, 0, 0).unwrap()
    }

    fn event(
        episode: i64,
        kind: AvailabilityEventType,
        occurred_at: DateTime<Utc>,
        air_at: Option<DateTime<Utc>>,
        is_upgrade: bool,
    ) -> AvailabilityEvent {
        AvailabilityEvent {
            source_instance_id: Uuid::nil(),
            provider: "tvdb".into(),
            external_id: "1".into(),
            season_number: 1,
            episode_number: episode,
            item_id: episode,
            event_type: kind,
            occurred_at,
            air_at,
            is_upgrade,
        }
    }

    use AvailabilityEventType::{Grab, Import};

    #[test]
    fn averages_first_imports_and_ignores_upgrades_and_repeats() {
        let events = vec![
            event(1, Grab, at(2, 1), Some(at(1, 20)), false),
            event(1, Import, at(2, 2), Some(at(1, 20)), false),
            // upgrade and re-import of the same item never move the average
            event(1, Import, at(9, 2), Some(at(1, 20)), true),
            event(1, Import, at(10, 2), Some(at(1, 20)), false),
            event(2, Import, at(4, 20), Some(at(1, 20)), false),
        ];
        let lag = compute_lag(&events);
        assert_eq!(lag.sample_count, 2);
        assert_eq!(lag.average_seconds, Some((6 * 3600 + 3 * 24 * 3600) / 2));
        assert_eq!(lag.average_grab_seconds, Some(5 * 3600));
        assert_eq!(lag.backfill_count, 0);
        assert_eq!(lag.samples[0].episode_number, Some(2));
    }

    #[test]
    fn backfills_and_missing_data_are_counted_but_excluded() {
        let events = vec![
            event(1, Import, at(2, 2), Some(at(1, 20)), false),
            // imported 40 days after airing
            event(
                2,
                Import,
                Utc.with_ymd_and_hms(2026, 10, 12, 0, 0, 0).unwrap(),
                Some(at(1, 20)),
                false,
            ),
            // no air time at all
            event(3, Import, at(3, 0), None, false),
            // imported before it aired
            event(4, Import, at(1, 0), Some(at(1, 20)), false),
        ];
        let lag = compute_lag(&events);
        assert_eq!(lag.sample_count, 1);
        assert_eq!(lag.average_seconds, Some(6 * 3600));
        assert_eq!(lag.backfill_count, 1);
        assert_eq!(lag.unknown_count, 2);
    }

    #[test]
    fn no_samples_means_no_average_not_zero() {
        let lag = compute_lag(&[]);
        assert_eq!(lag.average_seconds, None);
        assert_eq!(lag.sample_count, 0);
        let only_grab = compute_lag(&[event(1, Grab, at(2, 0), Some(at(1, 0)), false)]);
        assert_eq!(only_grab.average_seconds, None);
    }
}
