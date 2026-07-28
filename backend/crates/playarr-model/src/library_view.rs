//! [`LibraryView`] -- the "Views" feature: a named, saved filter+sort
//! preset over the catalog. Global/admin-managed (not per-user): there is
//! exactly one set of Views for the whole Playarr Server instance, editable by
//! any admin and readable by anything that can view the catalog (see
//! `playarr_api::auth_extractor::CatalogViewer`), the same shape as
//! [`crate::SourceInstance`]/[`crate::Policy`]. Mirrors
//! `playarr_catalog::BrowseQuery`'s filter vocabulary field-for-field
//! rather than inventing a parallel one --
//! `playarr_catalog::CatalogService::resolve_view` is the single place
//! that translates a `LibraryView` into a real `BrowseQuery`.
//!
//! Known, deliberate limitation: a global View can't statically encode a
//! per-caller "unwatched" predicate without becoming per-user (watch state
//! lives in `WatchProgressRepo`, keyed by `user_id`), and `BrowseQuery` has
//! no watch-state filter today either. A possible future direction is the
//! `resolve` endpoint gaining an optional caller-side `exclude_watched=true`
//! query param layered on top of a view's static criteria -- not built here.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::WorkKind;

/// A named, saved filter+sort preset over the catalog -- see the module doc
/// comment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LibraryView {
    pub id: Uuid,
    pub name: String,
    pub criteria: ViewCriteria,
    /// Ordered, most-significant first -- e.g. `[LastPlayedByUser,
    /// TitleAscending]` sorts by each caller's own last-played time first,
    /// falling back to title for anything tied (including "never played",
    /// which every `LastPlayedByUser` comparison treats as maximally old).
    /// Never empty in practice -- `playarr_api::views` defaults a
    /// caller-supplied empty list to `[TitleAscending]` before it ever
    /// reaches here, the same fallback `Default for LibraryView` below
    /// uses.
    pub sort: Vec<ViewSort>,
    /// Set only by the boot-time seed step (see
    /// `playarr_db::repo::library_view::seed_default_views`) -- never
    /// settable through the admin CRUD API. Seeded views are editable
    /// (name/criteria/sort) but not deletable; see `playarr_api::views`'s
    /// delete handler.
    pub is_default: bool,
    /// Fixed display order for seeded default views (0, 1, 2, ...).
    /// `None` for every admin-created custom view, which sorts after all
    /// defaults, alphabetically by name -- see `playarr_api::views`'s
    /// shared `sort_views_for_display` helper, used identically by the
    /// admin list and the public list so Playarr's shelf order always
    /// matches what the admin UI shows.
    pub default_order: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Every field is independently optional and AND-ed together, exactly like
/// `playarr_catalog::BrowseQuery`'s filter fields -- this struct is
/// deliberately a 1:1 mirror of that vocabulary (plus `release_window_days`,
/// a genuinely new filter primitive `BrowseQuery` gained for "Newly
/// Released" -- see the catalog crate's `BrowseQuery::release_window_days`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ViewCriteria {
    pub kind: Option<WorkKind>,
    pub source_instance_id: Option<Uuid>,
    pub genre: Option<String>,
    pub tag: Option<String>,
    #[serde(default)]
    pub available_only: bool,
    /// Only include works whose `release_date` falls within the last N
    /// days. `None` = no window restriction (e.g. the seeded "Newly
    /// Released" view sorts by release date but doesn't restrict a
    /// window, symmetric with "Newly Added" not restricting `added_at`).
    pub release_window_days: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ViewSort {
    TitleAscending,
    TitleDescending,
    RecentlyAdded,
    OldestAdded,
    RecentlyReleased,
    /// Orders by the *resolving caller's own* last-played time for each
    /// work, most-recent first -- a work that user has never played sorts
    /// as though it were infinitely old (last, in a `LastPlayedByUser`-only
    /// sort; deferred to the next sort key otherwise). Derived from
    /// `playarr_model::WatchProgress::updated_at` (the existing per-user
    /// resume-position record already updated on every real playback
    /// touch), not a separate "last played" field -- see
    /// `playarr_catalog::CatalogService::resolve_view`'s doc comment for
    /// exactly how. Meaningless without a resolving user in context: when
    /// nothing is authenticated as a specific viewer (there is no such
    /// caller today -- `resolve_view_handler` always has one), every work
    /// ties and later sort keys decide instead.
    LastPlayedByUser,
}
