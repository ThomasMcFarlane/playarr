//! Household and child controls carried on a [`crate::Policy`]
//! (`docs/architecture/household-controls.md`). Pure data; evaluation lives in
//! `playarr_auth::household`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// What to do with content that has no usable rating when the profile has a
/// `max_rating` ceiling. Defaults to blocking: an unknown rating must not be
/// treated as "safe" for a child profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum UnratedContent {
    #[default]
    Block,
    Allow,
}

/// Things a guardian can be asked to approve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ApprovalKind {
    /// One work that would otherwise be blocked by the rating gate.
    Content,
    /// Extra watch time or a schedule override for today.
    Time,
}

/// Arr-owned rating tag prefix (`rating:PG-13`), written by arr sync from the
/// source app's certification.
pub const RATING_TAG_PREFIX: &str = "rating:";
/// Admin override tag prefix (`rating-override:G`); wins over
/// [`RATING_TAG_PREFIX`] and is never touched by sync.
pub const RATING_OVERRIDE_TAG_PREFIX: &str = "rating-override:";

/// Default and maximum age of a client's cached authorisation, in hours.
pub const DEFAULT_OFFLINE_TTL_HOURS: u32 = 24;
pub const MAX_OFFLINE_TTL_HOURS: u32 = 72;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HouseholdControls {
    /// Applies only when the policy has a `max_rating`.
    #[serde(default)]
    pub unrated: UnratedContent,
    /// IANA zone name used for `access_schedule` and the budget day. `None`
    /// means UTC.
    #[serde(default)]
    pub timezone: Option<String>,
    /// Maximum watch time per local day, in minutes.
    #[serde(default)]
    pub daily_budget_minutes: Option<u32>,
    /// `None` = unrestricted; `Some(ids)` = allowlist (empty denies all).
    /// Contract only until games/live TV/external apps have routes
    /// (TASKS 22, 28, 36).
    #[serde(default)]
    pub channel_allow: Option<Vec<String>>,
    #[serde(default)]
    pub game_allow: Option<Vec<String>>,
    #[serde(default)]
    pub app_allow: Option<Vec<String>>,
    /// Users who may approve requests for, and unlock, this profile.
    #[serde(default)]
    pub guardian_user_ids: Vec<Uuid>,
    /// Approval kinds that must be granted by a guardian.
    #[serde(default, deserialize_with = "deserialize_known_approval_kinds")]
    pub approval_required: Vec<ApprovalKind>,
    /// Maximum age of a client's cached authorisation. `None` = default.
    #[serde(default)]
    pub offline_ttl_hours: Option<u32>,
}

/// Reads `approval_required`, skipping kinds this build does not know (the
/// retired `purchase`/`install`, or kinds from a newer peer) instead of
/// failing the whole policy.
fn deserialize_known_approval_kinds<'de, D>(deserializer: D) -> Result<Vec<ApprovalKind>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Vec::<String>::deserialize(deserializer)?;
    Ok(raw.iter().filter_map(|k| ApprovalKind::parse(k)).collect())
}

impl HouseholdControls {
    pub fn offline_ttl_hours(&self) -> u32 {
        self.offline_ttl_hours
            .unwrap_or(DEFAULT_OFFLINE_TTL_HOURS)
            .clamp(1, MAX_OFFLINE_TTL_HOURS)
    }

    pub fn requires_approval(&self, kind: ApprovalKind) -> bool {
        self.approval_required.contains(&kind)
    }

    /// Whether any household restriction beyond the base policy is set.
    pub fn has_time_limits(&self) -> bool {
        self.daily_budget_minutes.is_some()
    }
}

impl ApprovalKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Content => "content",
            Self::Time => "time",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Some(match raw {
            "content" => Self::Content,
            "time" => Self::Time,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied,
}

impl ApprovalStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Denied => "denied",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Some(match raw {
            "pending" => Self::Pending,
            "approved" => Self::Approved,
            "denied" => Self::Denied,
            _ => return None,
        })
    }
}

/// A guardian approval request and, once decided, its bounded grant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Approval {
    pub id: Uuid,
    pub profile_user_id: Uuid,
    pub kind: ApprovalKind,
    /// `Content`: the work id. `Time`: `"schedule"` or `"budget"`.
    pub subject: String,
    pub note: Option<String>,
    pub status: ApprovalStatus,
    pub requested_at: chrono::DateTime<chrono::Utc>,
    /// A pending request that is not decided by this time can no longer be
    /// approved.
    pub request_expires_at: chrono::DateTime<chrono::Utc>,
    pub decided_by: Option<Uuid>,
    pub decided_at: Option<chrono::DateTime<chrono::Utc>>,
    /// An approved grant is unusable at or after this time.
    pub grant_expires_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Extra watch seconds for a `Time`/`budget` grant.
    pub bonus_seconds: i64,
}

#[cfg(test)]
mod retired_kind_tests {
    use super::*;

    #[test]
    fn retired_approval_kinds_are_skipped_when_reading_stored_policy() {
        let controls: HouseholdControls = serde_json::from_str(
            r#"{"approval_required":["purchase","content","install","time"]}"#,
        )
        .unwrap();
        assert_eq!(
            controls.approval_required,
            vec![ApprovalKind::Content, ApprovalKind::Time]
        );
    }

    #[test]
    fn approval_ignores_retired_single_use_fields_from_older_peers() {
        let approval: Approval = serde_json::from_str(
            r#"{"id":"00000000-0000-0000-0000-000000000001",
                "profile_user_id":"00000000-0000-0000-0000-000000000002",
                "kind":"content","subject":"w","note":null,"status":"pending",
                "requested_at":"2026-10-09T10:00:00Z","request_expires_at":"2026-10-09T10:15:00Z",
                "decided_by":null,"decided_at":null,"grant_expires_at":null,
                "max_uses":1,"uses":0,"bonus_seconds":0}"#,
        )
        .unwrap();
        assert_eq!(approval.kind, ApprovalKind::Content);
    }
}
