//! [`Policy`] evaluation: turning a user's [`Policy`] plus the specifics of
//! what they're trying to do ([`AccessContext`]) into an allow/deny
//! decision. Pure, I/O-free logic — the caller (an API handler) is
//! responsible for gathering `AccessContext` from the `Work`/session/
//! request being checked; this module only judges it.

use chrono::{DateTime, Datelike, Timelike, Utc};
use streamarr_model::{ClientPlatform, Policy, Weekday};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    Deny(DenyReason),
}

impl PolicyDecision {
    pub fn is_allowed(self) -> bool {
        matches!(self, PolicyDecision::Allow)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DenyReason {
    LibraryNotAllowed,
    FolderBlocked,
    RatingExceedsMax,
    TagBlocked,
    TagNotAllowed,
    DeviceNotAllowed,
    ConcurrentSessionLimitReached,
    OutsideAccessSchedule,
}

/// Everything a policy check needs to know about the specific access
/// attempt, gathered by the caller rather than re-fetched here — keeps
/// this module free of any repository/DB dependency.
pub struct AccessContext<'a> {
    pub library_id: Uuid,
    pub folder_path: Option<&'a str>,
    /// Content rating of the thing being accessed (e.g. `"PG-13"`,
    /// `"TV-MA"`), if known.
    pub rating: Option<&'a str>,
    pub tags: &'a [String],
    pub device_platform: ClientPlatform,
    pub current_concurrent_sessions: u32,
    pub now: DateTime<Utc>,
}

pub trait PolicyEvaluator: Send + Sync {
    fn evaluate(&self, policy: &Policy, ctx: &AccessContext<'_>) -> PolicyDecision;
}

/// The evaluator every handler should use unless it has a specific reason
/// not to (e.g. a test double). Checks run cheapest/most-decisive first so
/// a denial short-circuits before evaluating the schedule, which is the
/// most expensive check (a linear scan of `access_schedule`).
pub struct DefaultPolicyEvaluator;

impl PolicyEvaluator for DefaultPolicyEvaluator {
    fn evaluate(&self, policy: &Policy, ctx: &AccessContext<'_>) -> PolicyDecision {
        if policy.is_admin {
            return PolicyDecision::Allow;
        }

        if !policy.library_allow.is_empty() && !policy.library_allow.contains(&ctx.library_id) {
            return PolicyDecision::Deny(DenyReason::LibraryNotAllowed);
        }

        if let Some(folder) = ctx.folder_path {
            if policy
                .blocked_folders
                .iter()
                .any(|blocked| folder.starts_with(blocked.as_str()))
            {
                return PolicyDecision::Deny(DenyReason::FolderBlocked);
            }
        }

        if let (Some(max_rating), Some(rating)) = (policy.max_rating.as_deref(), ctx.rating) {
            match (rating_rank(rating), rating_rank(max_rating)) {
                (Some(actual), Some(max)) if actual > max => {
                    return PolicyDecision::Deny(DenyReason::RatingExceedsMax)
                }
                // An unrecognized rating string (either side) can't be
                // ordered against the other, so we deliberately fail open
                // here rather than guess — an unmapped rating shouldn't
                // silently lock a library out.
                _ => {}
            }
        }

        if ctx.tags.iter().any(|tag| policy.blocked_tags.contains(tag)) {
            return PolicyDecision::Deny(DenyReason::TagBlocked);
        }

        if !policy.allowed_tags.is_empty()
            && !ctx.tags.iter().any(|tag| policy.allowed_tags.contains(tag))
        {
            return PolicyDecision::Deny(DenyReason::TagNotAllowed);
        }

        if !policy.device_allow.is_empty() && !policy.device_allow.contains(&ctx.device_platform) {
            return PolicyDecision::Deny(DenyReason::DeviceNotAllowed);
        }

        if let Some(max_sessions) = policy.max_concurrent_sessions {
            if ctx.current_concurrent_sessions >= max_sessions {
                return PolicyDecision::Deny(DenyReason::ConcurrentSessionLimitReached);
            }
        }

        if let Some(schedule) = &policy.access_schedule {
            let today = chrono_weekday_to_model(ctx.now.weekday());
            let minute_of_day = (ctx.now.hour() * 60 + ctx.now.minute()) as u16;
            let within_schedule = schedule.iter().any(|window| {
                window.weekday == today
                    && window.time_range.start_minute_of_day <= minute_of_day
                    && minute_of_day <= window.time_range.end_minute_of_day
            });
            if !within_schedule {
                return PolicyDecision::Deny(DenyReason::OutsideAccessSchedule);
            }
        }

        PolicyDecision::Allow
    }
}

fn chrono_weekday_to_model(day: chrono::Weekday) -> Weekday {
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

/// A small, deliberately incomplete ordinal ranking of common content
/// ratings, most permissive first. Mixes MPAA (film) and TV Parental
/// Guidelines scales on one axis because in practice a single
/// `Policy::max_rating` is meant to express "how mature", not which
/// specific rating body issued it — expand this table as real-world
/// libraries surface ratings it doesn't yet cover, rather than trying to
/// enumerate every regional/streaming rating scheme up front.
fn rating_rank(rating: &str) -> Option<u8> {
    let normalized = rating.trim().to_ascii_uppercase();
    let rank = match normalized.as_str() {
        "G" | "TV-Y" | "TV-G" => 0,
        "PG" | "TV-Y7" | "TV-PG" => 1,
        "PG-13" | "TV-14" => 2,
        "R" | "TV-MA" => 3,
        "NC-17" => 4,
        _ => return None,
    };
    Some(rank)
}

#[cfg(test)]
mod tests {
    use super::*;
    use streamarr_model::{AccessWindow, TimeRange};

    fn base_policy() -> Policy {
        Policy {
            id: Uuid::nil(),
            name: "test".to_string(),
            library_allow: vec![],
            blocked_folders: vec![],
            max_rating: None,
            blocked_tags: vec![],
            allowed_tags: vec![],
            can_transcode: true,
            can_download: false,
            can_delete: false,
            can_share_public: false,
            device_allow: vec![],
            max_concurrent_sessions: None,
            access_schedule: None,
            is_admin: false,
        }
    }

    fn base_ctx() -> AccessContext<'static> {
        AccessContext {
            library_id: Uuid::nil(),
            folder_path: None,
            rating: None,
            tags: &[],
            device_platform: ClientPlatform::Web,
            current_concurrent_sessions: 0,
            now: Utc::now(),
        }
    }

    #[test]
    fn admin_bypasses_every_check() {
        let mut policy = base_policy();
        policy.is_admin = true;
        policy.device_allow = vec![ClientPlatform::Ios];
        let ctx = base_ctx();
        assert_eq!(
            DefaultPolicyEvaluator.evaluate(&policy, &ctx),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn rating_over_max_is_denied() {
        let mut policy = base_policy();
        policy.max_rating = Some("PG-13".to_string());
        let mut ctx = base_ctx();
        ctx.rating = Some("R");
        assert_eq!(
            DefaultPolicyEvaluator.evaluate(&policy, &ctx),
            PolicyDecision::Deny(DenyReason::RatingExceedsMax)
        );
    }

    #[test]
    fn rating_at_or_under_max_is_allowed() {
        let mut policy = base_policy();
        policy.max_rating = Some("PG-13".to_string());
        let mut ctx = base_ctx();
        ctx.rating = Some("PG");
        assert_eq!(
            DefaultPolicyEvaluator.evaluate(&policy, &ctx),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn device_not_in_allow_list_is_denied() {
        let mut policy = base_policy();
        policy.device_allow = vec![ClientPlatform::Ios, ClientPlatform::AndroidMobile];
        let ctx = base_ctx(); // ClientPlatform::Web
        assert_eq!(
            DefaultPolicyEvaluator.evaluate(&policy, &ctx),
            PolicyDecision::Deny(DenyReason::DeviceNotAllowed)
        );
    }

    #[test]
    fn concurrent_session_limit_reached_is_denied() {
        let mut policy = base_policy();
        policy.max_concurrent_sessions = Some(2);
        let mut ctx = base_ctx();
        ctx.current_concurrent_sessions = 2;
        assert_eq!(
            DefaultPolicyEvaluator.evaluate(&policy, &ctx),
            PolicyDecision::Deny(DenyReason::ConcurrentSessionLimitReached)
        );
    }

    #[test]
    fn empty_schedule_vec_locks_out_always() {
        let mut policy = base_policy();
        policy.access_schedule = Some(vec![]);
        let ctx = base_ctx();
        assert_eq!(
            DefaultPolicyEvaluator.evaluate(&policy, &ctx),
            PolicyDecision::Deny(DenyReason::OutsideAccessSchedule)
        );
    }

    #[test]
    fn matching_schedule_window_is_allowed() {
        let mut policy = base_policy();
        let now = Utc::now();
        let minute_of_day = (now.hour() * 60 + now.minute()) as u16;
        policy.access_schedule = Some(vec![AccessWindow {
            weekday: chrono_weekday_to_model(now.weekday()),
            time_range: TimeRange {
                start_minute_of_day: minute_of_day.saturating_sub(5),
                end_minute_of_day: minute_of_day.saturating_add(5).min(1439),
            },
        }]);
        let mut ctx = base_ctx();
        ctx.now = now;
        assert_eq!(
            DefaultPolicyEvaluator.evaluate(&policy, &ctx),
            PolicyDecision::Allow
        );
    }
}
