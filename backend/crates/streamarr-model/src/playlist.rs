//! [`Playlist`] -- a named, ordered list of video works or audio tracks, owned either by
//! one user (a personal playlist) or by nobody (a "System" playlist,
//! admin-managed and visible to every user, the same ownership shape
//! `crate::LibraryView` uses for its own global/admin-managed scope).
//! Playlists nest via [`Playlist::parent_playlist_id`] -- a self-reference,
//! not a separate "folder" concept -- so a top-level playlist like "MCU"
//! can have its own items *and* child playlists like "Sample Movie Golf"
//! nested under it, matching how the feature was actually asked for:
//! "create something like 'MCU' and then a sub playlist for 'Captain
//! America'".
//!
//! Items live in a separate ordered collection
//! ([`streamarr_db::repo::playlist::PlaylistRepo::list_items`]/
//! [`PlaylistItem`]) rather than embedded on this struct -- a playlist can
//! grow to hundreds of items and gains/loses/reorders them one at a time
//! (add one title, remove one title, drag-reorder), which a separate
//! position-ordered table serves far better than rewriting a JSON blob on
//! every single-item mutation (the same reasoning `streamarr_model::
//! MediaFile`/`Work` already split apart, not a new pattern for this
//! crate).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The single class of media a playlist accepts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum PlaylistMediaType {
    #[default]
    Video,
    Audio,
}

/// A named, ordered collection of one media type -- see the module doc comment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Playlist {
    pub id: Uuid,
    pub name: String,
    /// `None` = a "System" playlist: admin-managed, visible to every user
    /// with catalog access, the same ownership shape `LibraryView` already
    /// uses. `Some(user_id)` = a personal playlist, visible only to that
    /// user (and admins, for support/moderation) -- see
    /// `streamarr_api::playlists`' access-control doc comments for exactly
    /// who can read/write which.
    pub owner_user_id: Option<Uuid>,
    /// `None` = top-level. `Some(id)` = nested under another playlist --
    /// self-referential, arbitrarily deep (though in practice expected to
    /// stay shallow, e.g. "MCU" -> "Sample Movie Golf"). A parent and its
    /// children share the same `owner_user_id` -- `streamarr_api::playlists`
    /// enforces this at write time rather than this type asserting it
    /// structurally, matching how `ViewCriteria`'s own invariants are
    /// caller-enforced rather than type-enforced.
    pub parent_playlist_id: Option<Uuid>,
    /// Playlists never mix video works and individual audio tracks.
    pub media_type: PlaylistMediaType,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// One work's membership in a [`Playlist`], at a given [`PlaylistItem::position`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PlaylistItem {
    pub id: Uuid,
    pub playlist_id: Uuid,
    pub work_id: Uuid,
    /// Present only for an audio playlist item. `work_id` remains the owning
    /// artist work so access control and detail resolution use the existing
    /// aggregate boundary.
    pub track_id: Option<Uuid>,
    /// Zero-based, dense, unique within a playlist -- the sole ordering
    /// signal; `streamarr_db::repo::playlist::PlaylistRepo::reorder_items`
    /// is the only place these values change after an item's first insert.
    pub position: i32,
    pub added_at: DateTime<Utc>,
}
