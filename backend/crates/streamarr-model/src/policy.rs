//! [`Policy`]: the permission/entitlement bundle attached to a [`crate::User`]
//! (directly, or via a role — the exact assignment mechanism lives in
//! `streamarr-auth`). This is the single source of truth an authorization
//! check consults; keep every gate the API needs to enforce representable
//! here rather than scattering ad hoc booleans across other types.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::platform::ClientPlatform;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum Weekday {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

/// A minute-of-day range, e.g. 06:00-22:00. Stored as minutes-since-midnight
/// rather than `chrono::NaiveTime` so it serializes trivially and compares
/// without timezone concerns; the caller supplies the user's local minute
/// of day when evaluating.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TimeRange {
    pub start_minute_of_day: u16,
    pub end_minute_of_day: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AccessWindow {
    pub weekday: Weekday,
    pub time_range: TimeRange,
}

/// The full set of gates an authorization check can consult for a user.
/// Deliberately flat (no nested "permissions" sub-struct) so a policy
/// evaluation function can be a straightforward series of field reads —
/// see `streamarr_auth::policy` for the evaluator.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Policy {
    pub id: Uuid,
    pub name: String,

    /// Work/library root ids this policy grants browse/playback access to.
    /// An empty list means "no explicit library grants" (all-deny by
    /// default, not all-allow) — pair with `is_admin` for the superuser
    /// bypass.
    pub library_allow: Vec<Uuid>,
    /// Additive, portable sibling to [`Self::library_allow`] (which stays
    /// exactly as-is: still "this specific local `SourceInstance` id, on
    /// whichever node evaluates this policy") -- `crate::GroupLibrary` ids
    /// (`docs/architecture/peer-groups.md` §2.3/§5.1), meaningful regardless
    /// of which group node evaluates the policy. Resolved to local
    /// `SourceInstance` ids at the API layer (`streamarr-api::
    /// auth_extractor`'s `StreamingUser`/`CatalogViewer::allowed_libraries`)
    /// and unioned with `library_allow` there -- an empty list here grants
    /// nothing extra, it does not widen access, matching `library_allow`'s
    /// own deny-by-default semantics.
    pub group_library_allow: Vec<Uuid>,
    /// Absolute or root-relative folder paths that are hidden regardless of
    /// `library_allow` (e.g. a folder with pre-release content).
    pub blocked_folders: Vec<String>,
    /// Content-rating ceiling, e.g. `"PG-13"`; rating comparison logic
    /// lives in `streamarr-auth`, not here.
    pub max_rating: Option<String>,
    pub blocked_tags: Vec<String>,
    pub allowed_tags: Vec<String>,

    pub can_transcode: bool,
    /// Grants permission to create and fetch downloads (original or a
    /// transcoded quality) of media this account can already stream --
    /// enforced per-item in addition to, not instead of, `library_allow`.
    /// A separate, deliberate grant from `can_stream`/`library_allow`
    /// (same reasoning as `can_stream` on this struct): being able to
    /// browse and play a library does not imply being allowed to copy it
    /// off the server. Defaults to `false` (least privilege) for every
    /// newly created account -- an admin has to explicitly turn it on.
    pub can_download: bool,
    pub can_delete: bool,
    pub can_share_public: bool,

    pub device_allow: Vec<ClientPlatform>,
    pub max_concurrent_sessions: Option<u32>,
    /// `None` means "no schedule restriction" (always allowed). `Some(vec)`
    /// with an empty vec means "never allowed" — an explicit lockout.
    pub access_schedule: Option<Vec<AccessWindow>>,

    /// Whether this account may sign in to Playarr (the consumer streaming
    /// client family) at all. Deliberately **not** bypassed by `is_admin`
    /// below — an operator/admin account exists to run Streamarr's own
    /// admin surface, not to imply a household viewer account, so the two
    /// are independent grants. Defaults to `false` (least privilege): an
    /// admin has to explicitly opt an account into Playarr access, same
    /// philosophy as `library_allow` defaulting to no grants.
    pub can_stream: bool,

    /// Bypasses every other field on this struct *except* `can_stream`
    /// above. Kept as the last field so review diffs always show it as an
    /// explicit, deliberate grant.
    pub is_admin: bool,
}
