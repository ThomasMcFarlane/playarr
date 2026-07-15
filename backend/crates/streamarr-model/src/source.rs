//! [`SourceInstance`]: a configured connection to one of the *arr apps
//! Streamarr treats as a source of catalog/download truth.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::sensitive::Sensitive;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum SourceKind {
    Sonarr,
    Radarr,
    Lidarr,
    Bazarr,
    Prowlarr,
    Readarr,
}

/// A single configured *arr connection. Streamarr can be pointed at
/// multiple instances of the same kind (e.g. two Radarr instances for 4K
/// vs 1080p libraries); `priority` breaks ties when more than one instance
/// could plausibly service the same request.
// Not `ToSchema`-derived: carries `api_key_encrypted`. Expose a redacted
// admin-facing DTO from the API layer instead of this domain type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceInstance {
    pub id: Uuid,
    pub kind: SourceKind,
    pub name: String,
    pub base_url: String,
    /// Encrypted at rest; `Sensitive` only guarantees it never prints via
    /// `Debug`/`Display`, it does not itself perform the encryption — that
    /// happens before this struct is constructed from a DB row.
    pub api_key_encrypted: Sensitive<String>,
    /// Lower sorts first; used to pick a default instance when a request
    /// doesn't pin one explicitly.
    pub priority: i32,
    pub default_root_folder_id: Option<String>,
    pub default_quality_profile_id: Option<i64>,
    /// Reserved: originally gated whether a (since-removed) request-
    /// management feature could submit new adds/searches to this instance,
    /// as opposed to only reading its existing catalog. Streamarr no longer
    /// has a request-submission feature -- see `docs/architecture/
    /// overview.md`'s scope note -- so nothing currently reads this field.
    /// Kept on the wire (not removed) since it's cheap to keep and an
    /// operator-facing admin toggle for "this instance is read-only" is a
    /// plausible future use.
    pub enabled_for_requests: bool,
    /// When true, a sync failure against this instance is logged and
    /// skipped rather than failing the overall reconciliation pass — for
    /// instances the operator has marked as non-critical/flaky.
    pub best_effort: bool,
}
