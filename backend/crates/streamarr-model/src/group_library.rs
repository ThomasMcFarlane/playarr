//! Group libraries & cross-node availability -- Phase 2 of
//! `docs/architecture/peer-groups.md` (see that document's §2.3/§2.4/§4 for
//! the full design and rationale).
//!
//! [`GroupLibrary`] is the group-wide answer to "the Movies library": a
//! stable id an operator maps each node's own local `SourceInstance` onto
//! (`SourceInstance::group_library_id`), because a `SourceInstance`'s own
//! id is minted independently per node and is not the same value across
//! peers (§5.1). [`LeafSelector`] is the portable substitute for a
//! peer-local `LeafRef`/`Uuid`, which is meaningless off the node that
//! minted it (§4.2). [`PeerLeafAvailability`] is a read-only, per-peer
//! annotation of what leaves (movie / episode / track / book) another peer
//! reports having -- never a second writer of this node's own `Work`/
//! `MediaFile` rows (§4.1). Every field here is additive; nothing in this
//! module is read or written for a single, ungrouped node.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::work::{Availability, ExternalProvider, WorkKind};

/// A stable, group-wide library identity. `SourceInstance` is the only
/// thing an operator can currently call a "library," and its id is minted
/// independently per node -- there is no value that means "the Movies
/// library" the same way on every peer until this one exists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct GroupLibrary {
    pub id: Uuid,
    pub group_id: Uuid,
    /// "Movies", "TV", "Music" -- operator-defined, syncs across the group.
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Portable leaf identity -- never a peer-local `LeafRef`/`Uuid`, which is
/// meaningless off the node that minted it. A receiving peer resolves
/// `(provider, external_id, LeafSelector)` against its own child rows to
/// get its own `LeafRef`/`media_file_id`; it never adopts a sender's id.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum LeafSelector {
    Movie,
    Episode { season: u32, episode: u32 },
    Track { disc: Option<u32>, track: u32 },
    Book { index: u32 },
}

/// Read-only annotation of what one OTHER peer reports having, at leaf
/// granularity -- not per-work, so a TV series with some episodes on node
/// A and others on node B is representable. Never constructed for this
/// node's own peer id: self's own availability is a live read of this
/// node's own `MediaFileRepo`, not cached here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PeerLeafAvailability {
    pub peer_node_id: Uuid,
    /// The reporting peer's own media-file id. It is opaque off that peer,
    /// but keeps multiple physical copies of the same portable leaf distinct.
    pub media_file_id: Uuid,
    /// Group-synchronised Source instance that reported this physical file.
    pub source_instance_id: Uuid,
    /// Physical path as reported by the peer. Consumers may translate its
    /// configured source root through that Source instance's folder mapping.
    pub path: String,
    pub provider: ExternalProvider,
    pub external_id: String,
    pub leaf_selector: LeafSelector,
    pub group_library_id: Option<Uuid>,
    pub availability: Availability,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub bitrate: Option<u64>,
    pub size_bytes: Option<u64>,
    pub duration_ms: Option<u64>,
    /// Cache of the local `Work` this row matches, recomputed at ingest by
    /// the external-ref-match algorithm described in §4.2. `None` means
    /// this peer has zero local record of the title at all (the
    /// partial-cache-node case, §4.3).
    pub local_work_id: Option<Uuid>,
    /// The reporting peer's own title/kind/release-year for this title --
    /// used as `resolve_local_work`'s (`streamarr-peer-sync::
    /// availability_sync`) normalized-title + release-year fallback
    /// matching input on every ingest, and, when [`Self::local_work_id`] is
    /// `None`, the only display data available for the partial-cache-node
    /// `RemoteOnlyWork` case (`streamarr-catalog`'s `browse`/`search`
    /// hydration, §4.3) -- there is no local `Work` row to read a title/
    /// kind from in that case. Persisted (unlike a purely transient
    /// matching input would be) precisely so that case has something to
    /// show a caller.
    pub title: String,
    pub kind: WorkKind,
    pub release_date: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}
