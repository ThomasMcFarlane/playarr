//! [`SourceInstance`]: a configured connection to one of the *arr apps
//! Playarr Server treats as a source of catalog/download truth.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
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
    /// distinct application an operator points Playarr Server at separately, with
    /// its own [`crate::ExternalProvider::Tpdb`] metadata identity.
    Whisparr,
    /// Dubarr -- the AI dubbing companion. It owns no catalogue of works; it
    /// exposes finished dub tracks (sidecar audio) that Playarr offers as
    /// alternate audio for the media files they belong to.
    Dubarr,
}

impl SourceKind {
    /// Neutral, provider-free label for what this kind of source supplies. Shown to
    /// users instead of the admin-chosen instance name, which may be (or contain)
    /// a provider's name.
    pub fn neutral_label(self) -> &'static str {
        match self {
            SourceKind::Radarr => "Movies",
            SourceKind::Sonarr => "Series",
            SourceKind::Lidarr => "Music",
            SourceKind::Readarr => "Books",
            SourceKind::Whisparr => "Videos",
            SourceKind::Bazarr => "Subtitles",
            SourceKind::Prowlarr => "Search",
            SourceKind::Dubarr => "Dubs",
        }
    }
}

/// Neutral user-facing labels for every instance, keyed by instance id. The first
/// instance of a kind (by priority, then name, then id) gets the plain label; the
/// others are numbered ("Movies 2") so they stay distinguishable. Computed over all
/// instances, not just the ones in a response, so a label never shifts with a filter.
pub fn neutral_source_labels(
    instances: &[SourceInstance],
) -> std::collections::HashMap<Uuid, String> {
    let mut sorted: Vec<&SourceInstance> = instances.iter().collect();
    sorted.sort_by(|a, b| (a.priority, &a.name, a.id).cmp(&(b.priority, &b.name, b.id)));
    let mut seen: std::collections::HashMap<&'static str, usize> = std::collections::HashMap::new();
    let mut out = std::collections::HashMap::new();
    for instance in sorted {
        let base = instance.kind.neutral_label();
        let n = seen.entry(base).or_insert(0);
        *n += 1;
        let label = if *n == 1 {
            base.to_string()
        } else {
            format!("{base} {n}")
        };
        out.insert(instance.id, label);
    }
    out
}

/// A single configured *arr connection. Playarr Server can be pointed at
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
    /// Per-peer equivalent of `default_root_folder_id`. A source still
    /// reports its native path; each peer can map that root to the physical
    /// location visible from that node without creating a shadow source.
    #[serde(default)]
    pub folder_mappings: BTreeMap<Uuid, String>,
    pub default_quality_profile_id: Option<i64>,
    /// When true, a sync failure against this instance is logged and
    /// skipped rather than failing the overall reconciliation pass — for
    /// instances the operator has marked as non-critical/flaky.
    pub best_effort: bool,
    /// Maps this instance onto a group-wide
    /// [`crate::GroupLibrary`] (`docs/architecture/peer-groups.md` §2.3/
    /// §5.1) -- `None` (the default) for an instance not part of any
    /// cross-node grouping, fully backward compatible.
    pub group_library_id: Option<Uuid>,
}

/// Credential-free identity of one source instance as shared with peer
/// nodes. Connection details stay local; timestamps carry updates and
/// tombstones safely through cursor-based peer synchronisation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SourceInstanceIdentity {
    pub id: Uuid,
    pub kind: SourceKind,
    pub name: String,
    pub priority: i32,
    pub group_library_id: Option<Uuid>,
    #[serde(default)]
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Complete source-instance configuration exchanged only over authenticated,
/// signed peer endpoints. The two connection fields are optional solely for
/// rolling compatibility with older nodes that sent identity-only rows; such
/// rows are ignored by newer receivers until a complete row arrives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SourceInstanceSyncRow {
    pub id: Uuid,
    pub kind: SourceKind,
    pub name: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key_encrypted: Option<String>,
    pub priority: i32,
    #[serde(default)]
    pub default_root_folder_id: Option<String>,
    #[serde(default)]
    pub folder_mappings: BTreeMap<Uuid, String>,
    #[serde(default)]
    pub default_quality_profile_id: Option<i64>,
    #[serde(default)]
    pub best_effort: bool,
    pub group_library_id: Option<Uuid>,
    #[serde(default)]
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub origin_peer_id: Option<Uuid>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}

impl SourceInstanceSyncRow {
    pub fn from_instance(
        instance: SourceInstance,
        updated_at: DateTime<Utc>,
        origin_peer_id: Option<Uuid>,
        deleted_at: Option<DateTime<Utc>>,
    ) -> Self {
        Self {
            id: instance.id,
            kind: instance.kind,
            name: instance.name,
            base_url: Some(instance.base_url),
            api_key_encrypted: Some(instance.api_key_encrypted.into_inner()),
            priority: instance.priority,
            default_root_folder_id: instance.default_root_folder_id,
            folder_mappings: instance.folder_mappings,
            default_quality_profile_id: instance.default_quality_profile_id,
            best_effort: instance.best_effort,
            group_library_id: instance.group_library_id,
            updated_at,
            origin_peer_id,
            deleted_at,
        }
    }

    pub fn into_instance(self) -> Option<SourceInstance> {
        Some(SourceInstance {
            id: self.id,
            kind: self.kind,
            name: self.name,
            base_url: self.base_url?,
            api_key_encrypted: Sensitive::new(self.api_key_encrypted?),
            priority: self.priority,
            default_root_folder_id: self.default_root_folder_id,
            folder_mappings: self.folder_mappings,
            default_quality_profile_id: self.default_quality_profile_id,
            best_effort: self.best_effort,
            group_library_id: self.group_library_id,
        })
    }
}

#[cfg(test)]
mod neutral_label_tests {
    use super::*;

    fn inst(kind: SourceKind, name: &str, priority: i32) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind,
            name: name.into(),
            base_url: String::new(),
            api_key_encrypted: Sensitive::new(String::new()),
            priority,
            default_root_folder_id: None,
            folder_mappings: BTreeMap::new(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        }
    }

    #[test]
    fn labels_are_neutral_and_numbered_per_kind() {
        let a = inst(SourceKind::Radarr, "Radarr", 0);
        let b = inst(SourceKind::Radarr, "Radarr 4K", 1);
        let c = inst(SourceKind::Sonarr, "Sonarr", 0);
        let labels = neutral_source_labels(&[b.clone(), c.clone(), a.clone()]);
        assert_eq!(labels[&a.id], "Movies");
        assert_eq!(labels[&b.id], "Movies 2");
        assert_eq!(labels[&c.id], "Series");
    }
}
