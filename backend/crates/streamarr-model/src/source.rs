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
    /// Whisparr V3 -- a direct Sonarr fork (same `/api/v3/series`,
    /// `/api/v3/episode`, `/api/v3/episodefile` route shapes; a "series" is
    /// a studio/site and an "episode" is an individual scene). Kept as its
    /// own `SourceKind` rather than reusing `Sonarr` because it is a
    /// distinct application an operator points Streamarr at separately, with
    /// its own [`crate::ExternalProvider::Tpdb`] metadata identity.
    Whisparr,
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
    /// When true, a sync failure against this instance is logged and
    /// skipped rather than failing the overall reconciliation pass — for
    /// instances the operator has marked as non-critical/flaky.
    pub best_effort: bool,
    /// Maps this node's own instance onto a group-wide
    /// [`crate::GroupLibrary`] (`docs/architecture/peer-groups.md` §2.3/
    /// §5.1) -- `None` (the default) for an instance not part of any
    /// cross-node grouping, fully backward compatible. `SourceInstance::id`
    /// itself is minted independently per node and is never portable across
    /// peers; this field is the operator-asserted, stable, group-wide
    /// substitute a `RoutingRule`/`Policy::group_library_allow` can actually
    /// reference.
    pub group_library_id: Option<Uuid>,
}
