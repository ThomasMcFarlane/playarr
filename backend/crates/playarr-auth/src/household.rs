//! Pure household/child-control evaluation (`docs/architecture/
//! household-controls.md`): content gate and time gate. No I/O; the API layer
//! gathers the inputs (policy, work tags, usage, approvals, clock).

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use playarr_model::{HouseholdControls, Policy, UnratedContent, Weekday};

use crate::policy::rating_rank;

pub use playarr_model::household::{RATING_OVERRIDE_TAG_PREFIX, RATING_TAG_PREFIX};

/// The effective rating string of a work, from its tags.
pub fn effective_rating(tags: &[String]) -> Option<&str> {
    let find = |prefix: &str| {
        tags.iter().find_map(|tag| {
            let tag = tag.trim();
            let head = tag.get(..prefix.len())?;
            (head.eq_ignore_ascii_case(prefix) && tag.len() > prefix.len())
                .then(|| tag[prefix.len()..].trim())
        })
    };
    find(RATING_OVERRIDE_TAG_PREFIX).or_else(|| find(RATING_TAG_PREFIX))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentDecision {
    Allow,
    RatingTooHigh,
    Unrated,
    TagBlocked,
}

impl ContentDecision {
    pub fn is_allowed(self) -> bool {
        self == ContentDecision::Allow
    }
}

/// Whether `policy` permits a work with these `tags`. Admins are
/// unrestricted. A policy with a `max_rating` fails closed: an unrecognised
/// ceiling denies everything rated or unrated, and unrated content follows
/// `household.unrated` (default block).
pub fn content_decision(policy: &Policy, tags: &[String]) -> ContentDecision {
    if policy.is_admin {
        return ContentDecision::Allow;
    }
    let has = |list: &[String], tag: &String| list.iter().any(|t| t.eq_ignore_ascii_case(tag));
    if tags.iter().any(|tag| has(&policy.blocked_tags, tag)) {
        return ContentDecision::TagBlocked;
    }
    if !policy.allowed_tags.is_empty() && !tags.iter().any(|tag| has(&policy.allowed_tags, tag)) {
        return ContentDecision::TagBlocked;
    }
    let Some(max) = policy.max_rating.as_deref() else {
        return ContentDecision::Allow;
    };
    let Some(max_rank) = rating_rank(max) else {
        return ContentDecision::RatingTooHigh;
    };
    match effective_rating(tags).map(rating_rank) {
        Some(Some(rank)) if rank <= max_rank => ContentDecision::Allow,
        Some(Some(_)) => ContentDecision::RatingTooHigh,
        _ => match policy.household.unrated {
            UnratedContent::Allow => ContentDecision::Allow,
            UnratedContent::Block => ContentDecision::Unrated,
        },
    }
}

/// Grants from approved guardian approvals that apply right now.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TimeOverrides {
    /// Extra watch seconds for today's budget.
    pub bonus_seconds: i64,
    /// Schedule is waived until this instant.
    pub schedule_waived_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeDecision {
    /// No schedule or budget applies.
    Unrestricted,
    Allowed {
        /// `None` when there is no budget.
        remaining_seconds: Option<i64>,
        /// End of the current window, if a schedule applies.
        window_ends_at: Option<DateTime<Utc>>,
    },
    OutsideSchedule {
        next_start_at: Option<DateTime<Utc>>,
    },
    BudgetExhausted {
        resets_at: DateTime<Utc>,
    },
}

impl TimeDecision {
    pub fn is_allowed(&self) -> bool {
        matches!(self, Self::Unrestricted | Self::Allowed { .. })
    }
}

/// The profile's zone; an unset or unparseable name is UTC for schedule
/// compatibility, but the caller should validate on write ([`parse_timezone`]).
fn zone(controls: &HouseholdControls) -> Tz {
    controls
        .timezone
        .as_deref()
        .and_then(|name| name.parse().ok())
        .unwrap_or(Tz::UTC)
}

pub fn parse_timezone(name: &str) -> Option<Tz> {
    name.parse().ok()
}

fn weekday(day: chrono::Weekday) -> Weekday {
    match day {
        chrono::Weekday::Mon => Weekday::Monday,
        chrono::Weekday::Tue => Weekday::Tuesday,
        chrono::Weekday::Wed => Weekday::Wednesday,
        chrono::Weekday::Thu => Weekday::Thursday,
        chrono::Weekday::Fri => Weekday::Friday,
        chrono::Weekday::Sat => Weekday::Saturday,
        chrono::Weekday::Sun => Weekday::Sunday,
    }
}

/// Local calendar day used as the budget key, e.g. `2026-10-03`.
pub fn local_day(controls: &HouseholdControls, now: DateTime<Utc>) -> NaiveDate {
    now.with_timezone(&zone(controls)).date_naive()
}

fn local_to_utc(tz: Tz, date: NaiveDate, minute: u32) -> DateTime<Utc> {
    let (h, m) = (minute / 60, minute % 60);
    let naive = if h >= 24 {
        (date + Duration::days(1)).and_time(NaiveTime::MIN)
    } else {
        date.and_time(NaiveTime::from_hms_opt(h, m, 0).unwrap_or(NaiveTime::MIN))
    };
    // A DST gap has no local time: step forward to the first valid instant.
    let mut candidate = naive;
    for _ in 0..4 {
        if let Some(t) = tz.from_local_datetime(&candidate).earliest() {
            return t.with_timezone(&Utc);
        }
        candidate += Duration::minutes(30);
    }
    Utc.from_utc_datetime(&naive)
}

/// Start of the next local day after `now`.
fn next_midnight(tz: Tz, now: DateTime<Utc>) -> DateTime<Utc> {
    local_to_utc(tz, now.with_timezone(&tz).date_naive(), 24 * 60)
}

/// Evaluate the schedule and daily budget at `now`.
///
/// Windows are half-open `[start, end)` in the profile's zone. The budget day
/// is the local calendar day; `used_seconds_today` must be the usage already
/// recorded for [`local_day`].
pub fn time_decision(
    policy: &Policy,
    now: DateTime<Utc>,
    used_seconds_today: i64,
    overrides: TimeOverrides,
) -> TimeDecision {
    if policy.is_admin {
        return TimeDecision::Unrestricted;
    }
    let controls = &policy.household;
    let schedule = policy.access_schedule.as_ref();
    let budget = controls.daily_budget_minutes;
    if schedule.is_none() && budget.is_none() {
        return TimeDecision::Unrestricted;
    }
    let tz = zone(controls);
    let local = now.with_timezone(&tz);

    let mut window_ends_at = None;
    let waived = overrides
        .schedule_waived_until
        .is_some_and(|until| now < until);
    if let (Some(windows), false) = (schedule, waived) {
        let today = weekday(local.weekday());
        let minute = local.hour() * 60 + local.minute();
        let active = windows.iter().find(|w| {
            w.weekday == today
                && (w.time_range.start_minute_of_day as u32) <= minute
                && minute < w.time_range.end_minute_of_day as u32
        });
        match active {
            Some(window) => {
                window_ends_at = Some(local_to_utc(
                    tz,
                    local.date_naive(),
                    window.time_range.end_minute_of_day as u32,
                ));
            }
            None => {
                let mut next: Option<DateTime<Utc>> = None;
                for offset in 0..8i64 {
                    let date = local.date_naive() + Duration::days(offset);
                    let day = weekday(date.weekday());
                    for w in windows.iter().filter(|w| w.weekday == day) {
                        if w.time_range.start_minute_of_day >= w.time_range.end_minute_of_day {
                            continue;
                        }
                        let start = local_to_utc(tz, date, w.time_range.start_minute_of_day as u32);
                        if start > now && next.is_none_or(|n| start < n) {
                            next = Some(start);
                        }
                    }
                    if next.is_some() {
                        break;
                    }
                }
                return TimeDecision::OutsideSchedule {
                    next_start_at: next,
                };
            }
        }
    }

    let remaining_seconds = budget.map(|minutes| {
        i64::from(minutes) * 60 + overrides.bonus_seconds.max(0) - used_seconds_today.max(0)
    });
    if let Some(remaining) = remaining_seconds {
        if remaining <= 0 {
            return TimeDecision::BudgetExhausted {
                resets_at: next_midnight(tz, now),
            };
        }
    }
    TimeDecision::Allowed {
        remaining_seconds,
        window_ends_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use playarr_model::{AccessWindow, TimeRange};
    use uuid::Uuid;

    fn policy() -> Policy {
        Policy {
            id: Uuid::nil(),
            name: "kid".into(),
            library_allow: vec![],
            group_library_allow: vec![],
            blocked_folders: vec![],
            max_rating: Some("PG".into()),
            blocked_tags: vec![],
            allowed_tags: vec![],
            can_transcode: true,
            can_download: false,
            can_delete: false,
            can_share_public: false,
            device_allow: vec![],
            max_concurrent_sessions: None,
            access_schedule: None,
            can_stream: true,
            is_admin: false,
            household: HouseholdControls::default(),
        }
    }

    fn tags(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn window(day: Weekday, start: u16, end: u16) -> AccessWindow {
        AccessWindow {
            weekday: day,
            time_range: TimeRange {
                start_minute_of_day: start,
                end_minute_of_day: end,
            },
        }
    }

    #[test]
    fn rating_ceiling_blocks_higher_and_unrated_by_default() {
        let p = policy();
        assert!(content_decision(&p, &tags(&["rating:G"])).is_allowed());
        assert!(content_decision(&p, &tags(&["rating:PG"])).is_allowed());
        assert_eq!(
            content_decision(&p, &tags(&["rating:R"])),
            ContentDecision::RatingTooHigh
        );
        assert_eq!(content_decision(&p, &[]), ContentDecision::Unrated);
        assert_eq!(
            content_decision(&p, &tags(&["rating:made-up"])),
            ContentDecision::Unrated
        );
    }

    #[test]
    fn unrated_can_be_allowed_and_override_wins() {
        let mut p = policy();
        p.household.unrated = UnratedContent::Allow;
        assert!(content_decision(&p, &[]).is_allowed());
        // Override lowers a high arr rating; and raises a low one.
        assert!(content_decision(&p, &tags(&["rating:R", "rating-override:G"])).is_allowed());
        assert_eq!(
            content_decision(&p, &tags(&["rating:G", "rating-override:R"])),
            ContentDecision::RatingTooHigh
        );
    }

    #[test]
    fn no_ceiling_means_no_rating_gate_and_admin_is_exempt() {
        let mut p = policy();
        p.max_rating = None;
        assert!(content_decision(&p, &tags(&["rating:NC-17"])).is_allowed());
        let mut kid = policy();
        kid.is_admin = true;
        assert!(content_decision(&kid, &tags(&["rating:NC-17"])).is_allowed());
    }

    #[test]
    fn unknown_ceiling_fails_closed() {
        let mut p = policy();
        p.max_rating = Some("???".into());
        assert!(!content_decision(&p, &tags(&["rating:G"])).is_allowed());
    }

    #[test]
    fn tag_lists_apply_case_insensitively() {
        let mut p = policy();
        p.max_rating = None;
        p.blocked_tags = tags(&["Horror"]);
        assert_eq!(
            content_decision(&p, &tags(&["horror"])),
            ContentDecision::TagBlocked
        );
        p.blocked_tags.clear();
        p.allowed_tags = tags(&["kids"]);
        assert!(content_decision(&p, &tags(&["KIDS"])).is_allowed());
        assert!(!content_decision(&p, &tags(&["other"])).is_allowed());
    }

    #[test]
    fn schedule_is_half_open_and_evaluated_in_the_profile_zone() {
        let mut p = policy();
        p.household.timezone = Some("Europe/London".into());
        // Saturday 2026-10-03, 08:00-20:00 local (BST, UTC+1).
        p.access_schedule = Some(vec![window(Weekday::Saturday, 8 * 60, 20 * 60)]);
        let o = TimeOverrides::default();
        // 07:30 UTC = 08:30 BST: inside.
        assert!(time_decision(&p, at("2026-10-03T07:30:00Z"), 0, o).is_allowed());
        // 06:59 UTC = 07:59 BST: outside, next start 07:00 UTC.
        assert_eq!(
            time_decision(&p, at("2026-10-03T06:59:00Z"), 0, o),
            TimeDecision::OutsideSchedule {
                next_start_at: Some(at("2026-10-03T07:00:00Z"))
            }
        );
        // 19:00 UTC = 20:00 BST: end is exclusive.
        assert!(!time_decision(&p, at("2026-10-03T19:00:00Z"), 0, o).is_allowed());
        assert!(time_decision(&p, at("2026-10-03T18:59:00Z"), 0, o).is_allowed());
    }

    #[test]
    fn next_start_finds_following_week_and_empty_schedule_is_lockout() {
        let mut p = policy();
        p.access_schedule = Some(vec![window(Weekday::Monday, 600, 700)]);
        // Saturday: next start is Monday 10:00 UTC.
        assert_eq!(
            time_decision(&p, at("2026-10-03T12:00:00Z"), 0, TimeOverrides::default()),
            TimeDecision::OutsideSchedule {
                next_start_at: Some(at("2026-10-05T10:00:00Z"))
            }
        );
        p.access_schedule = Some(vec![]);
        assert_eq!(
            time_decision(&p, at("2026-10-03T12:00:00Z"), 0, TimeOverrides::default()),
            TimeDecision::OutsideSchedule {
                next_start_at: None
            }
        );
    }

    #[test]
    fn budget_counts_per_local_day_with_bonus() {
        let mut p = policy();
        p.household.daily_budget_minutes = Some(60);
        p.household.timezone = Some("America/New_York".into());
        let now = at("2026-10-03T03:30:00Z"); // 23:30 on 2 Oct in New York (EDT)
        assert_eq!(
            local_day(&p.household, now),
            NaiveDate::from_ymd_opt(2026, 10, 2).unwrap()
        );
        match time_decision(&p, now, 1800, TimeOverrides::default()) {
            TimeDecision::Allowed {
                remaining_seconds, ..
            } => assert_eq!(remaining_seconds, Some(1800)),
            other => panic!("{other:?}"),
        }
        assert_eq!(
            time_decision(&p, now, 3600, TimeOverrides::default()),
            TimeDecision::BudgetExhausted {
                resets_at: at("2026-10-03T04:00:00Z")
            }
        );
        let bonus = TimeOverrides {
            bonus_seconds: 600,
            schedule_waived_until: None,
        };
        assert!(time_decision(&p, now, 3600, bonus).is_allowed());
        assert!(!time_decision(&p, now, 4200, bonus).is_allowed());
    }

    #[test]
    fn schedule_waiver_expires() {
        let mut p = policy();
        p.access_schedule = Some(vec![]);
        let waiver = TimeOverrides {
            bonus_seconds: 0,
            schedule_waived_until: Some(at("2026-10-03T13:00:00Z")),
        };
        assert!(time_decision(&p, at("2026-10-03T12:59:59Z"), 0, waiver).is_allowed());
        assert!(!time_decision(&p, at("2026-10-03T13:00:00Z"), 0, waiver).is_allowed());
    }

    #[test]
    fn dst_transition_day_still_resolves_boundaries() {
        let mut p = policy();
        p.household.timezone = Some("Europe/London".into());
        // 2026-10-25 clocks go back at 02:00 BST -> 01:00 GMT. Window 00:30-03:00.
        p.access_schedule = Some(vec![window(Weekday::Sunday, 30, 180)]);
        let d = time_decision(&p, at("2026-10-25T01:45:00Z"), 0, TimeOverrides::default());
        match d {
            TimeDecision::Allowed { window_ends_at, .. } => {
                assert_eq!(window_ends_at, Some(at("2026-10-25T03:00:00Z")))
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn admin_and_unconfigured_are_unrestricted() {
        let mut p = policy();
        assert_eq!(
            time_decision(&p, Utc::now(), 0, TimeOverrides::default()),
            TimeDecision::Unrestricted
        );
        p.access_schedule = Some(vec![]);
        p.is_admin = true;
        assert_eq!(
            time_decision(&p, Utc::now(), 0, TimeOverrides::default()),
            TimeDecision::Unrestricted
        );
    }
}
