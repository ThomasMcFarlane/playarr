//! [`Person`] -- a real individual (actor, director, writer, producer...)
//! who worked on one or more catalog [`crate::Work`]s, and [`Credit`], the
//! join between the two. Sourced today only from Radarr's
//! `/api/v3/credit?movieId={id}` endpoint (verified live: Sonarr exposes
//! no cast/crew data at all, no `/api/v3/series/{id}` field and no
//! `/api/v3/credit` endpoint -- its own web UI has no Cast/Crew section
//! either, unlike Radarr's; Lidarr/Readarr have no equivalent concept), so
//! in practice a `Person`/`Credit` only ever exists for a movie `Work`
//! today -- not a structural restriction, just what the current data
//! sources provide. Series cast (no crew) is the exception: Sonarr exposes
//! none, so it comes from the public series metadata service Sonarr itself
//! uses (see `playarr_arr_client::SeriesCastClient`); those people have no
//! `tmdb_id` and dedupe by name plus headshot.
//!
//! `Person` is deduped across every movie it appears in by
//! [`Person::tmdb_id`] (TMDb's own person id, the one stable
//! cross-movie identity key Radarr's credit payload carries) -- one
//! `Person` row backs every `Credit` for that same real individual,
//! rather than a fresh row per movie appearance.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A real individual credited on one or more works.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Person {
    pub id: Uuid,
    pub name: String,
    /// TMDb's own person id -- the dedup key across every movie/credit
    /// this person appears in. `None` is not expected from the current
    /// (Radarr-only) source, which always provides one, but stays
    /// optional rather than required in case a future, non-TMDb-backed
    /// source (e.g. a direct TVDB-based Sonarr credit feed, should Sonarr
    /// ever add one) needs to create a `Person` without it.
    pub tmdb_id: Option<i64>,
    /// Headshot artwork URL, if the source provided one.
    pub headshot_url: Option<String>,
}

/// What a [`Person`] did on a [`crate::Work`] -- an actor's character, or
/// a crew member's department/job (e.g. `department: "Directing"`,
/// `job: "Director"`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum CreditRole {
    Cast { character: String },
    Crew { department: String, job: String },
}

/// One [`Person`]'s credited role on one [`crate::Work`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Credit {
    pub id: Uuid,
    pub work_id: Uuid,
    pub person_id: Uuid,
    pub role: CreditRole,
    /// Source-provided display order (billing order for cast, roughly
    /// department-grouped for crew) -- the sort key
    /// `CreditRepo::list_for_work` orders by.
    pub order: i32,
}
