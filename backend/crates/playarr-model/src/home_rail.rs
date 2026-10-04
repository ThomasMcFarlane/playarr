//! Home rails: the ordered, per-library shelves on Home. Definitions are
//! admin-managed and global ([`HomeRail`]); each user can additionally hide
//! or reorder rails for themselves ([`UserRailPref`]). The server computes
//! the actual items per user -- see `playarr_api::home_rails`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::seasonal::{Hemisphere, SeasonalRule};
use crate::WorkKind;

/// Arr-owned tag carrying the TMDB collection a Radarr movie belongs to:
/// `collection:<tmdbId>:<name>`. Written by arr sync, never by hand.
pub const COLLECTION_TAG_PREFIX: &str = "collection:";
/// Arr-owned tag carrying the source app's audience score and vote count:
/// `score:<0-10 value>:<votes>`.
pub const SCORE_TAG_PREFIX: &str = "score:";

/// `collection:<id>:<name>` for a Radarr collection.
pub fn collection_tag(tmdb_id: i64, name: &str) -> String {
    format!("{COLLECTION_TAG_PREFIX}{tmdb_id}:{}", name.trim())
}

/// `(collection id, collection name)` from a work's tags, if any.
pub fn collection_from_tags(tags: &[String]) -> Option<(String, String)> {
    tags.iter().find_map(|tag| {
        let rest = tag.strip_prefix(COLLECTION_TAG_PREFIX)?;
        let (id, name) = rest.split_once(':')?;
        (!id.is_empty()).then(|| (id.to_string(), name.to_string()))
    })
}

/// `score:<value>:<votes>`; `None` for a zero/invalid score.
pub fn score_tag(value: f64, votes: u32) -> Option<String> {
    (value.is_finite() && value > 0.0).then(|| format!("{SCORE_TAG_PREFIX}{value:.1}:{votes}"))
}

/// `(score, votes)` from a work's tags, if any.
pub fn score_from_tags(tags: &[String]) -> Option<(f64, u32)> {
    tags.iter().find_map(|tag| {
        let rest = tag.strip_prefix(SCORE_TAG_PREFIX)?;
        let (value, votes) = rest.split_once(':').unwrap_or((rest, "0"));
        Some((value.parse().ok()?, votes.parse().unwrap_or(0)))
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum HomeRailKind {
    RecentlyAdded,
    RecentlyReleased,
    TopUnwatched,
    Rediscover,
    Seasonal,
    /// Built from a saved [`crate::LibraryView`] (`HomeRail::view_id`).
    Custom,
}

impl HomeRailKind {
    pub const DEFAULTS: [HomeRailKind; 5] = [
        HomeRailKind::RecentlyAdded,
        HomeRailKind::RecentlyReleased,
        HomeRailKind::TopUnwatched,
        HomeRailKind::Rediscover,
        HomeRailKind::Seasonal,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            HomeRailKind::RecentlyAdded => "recently_added",
            HomeRailKind::RecentlyReleased => "recently_released",
            HomeRailKind::TopUnwatched => "top_unwatched",
            HomeRailKind::Rediscover => "rediscover",
            HomeRailKind::Seasonal => "seasonal",
            HomeRailKind::Custom => "custom",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Some(match raw {
            "recently_added" => HomeRailKind::RecentlyAdded,
            "recently_released" => HomeRailKind::RecentlyReleased,
            "top_unwatched" => HomeRailKind::TopUnwatched,
            "rediscover" => HomeRailKind::Rediscover,
            "seasonal" => HomeRailKind::Seasonal,
            "custom" => HomeRailKind::Custom,
            _ => return None,
        })
    }

    fn code(self) -> u128 {
        match self {
            HomeRailKind::RecentlyAdded => 1,
            HomeRailKind::RecentlyReleased => 2,
            HomeRailKind::TopUnwatched => 3,
            HomeRailKind::Rediscover => 4,
            HomeRailKind::Seasonal => 5,
            HomeRailKind::Custom => 9,
        }
    }
}

/// Libraries a default rail can be seeded for, with the kinds that make
/// sense there. Music has no per-user watch state or release dates on the
/// artist, so only "recently added" and "seasonal" apply.
pub fn default_rail_kinds(library: WorkKind) -> &'static [HomeRailKind] {
    match library {
        WorkKind::Movie | WorkKind::Series => &HomeRailKind::DEFAULTS,
        WorkKind::Artist => &[HomeRailKind::RecentlyAdded, HomeRailKind::Seasonal],
        _ => &[],
    }
}

pub const DEFAULT_RAIL_LIBRARIES: [WorkKind; 3] =
    [WorkKind::Movie, WorkKind::Series, WorkKind::Artist];

/// Stable id of the seeded default rail for `(kind, library)`.
pub fn default_rail_id(kind: HomeRailKind, library: WorkKind) -> Uuid {
    let lib = match library {
        WorkKind::Movie => 1u128,
        WorkKind::Series => 2,
        WorkKind::Artist => 3,
        _ => 0,
    };
    Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_b000 | (kind.code() << 8) | (lib << 4))
}

/// Per-rail tunables. Every field is optional; the server applies the
/// default for anything unset, so older rows keep working.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HomeRailConfig {
    /// Maximum items on the rail (default 24, capped at 100).
    #[serde(default)]
    pub limit: Option<u32>,
    /// Rediscover: a started-but-unfinished title counts once it has not
    /// been watched for this many days (default 60).
    #[serde(default)]
    pub stale_days: Option<u32>,
    /// Rediscover (movies): a collection needs at least this many titles
    /// in the library to count as a confirmed franchise (default 2).
    #[serde(default)]
    pub min_collection_size: Option<u32>,
    /// Seasonal: which hemisphere's seasons apply (default north).
    #[serde(default)]
    pub hemisphere: Option<Hemisphere>,
    /// Seasonal: replaces the built-in rules when present.
    #[serde(default)]
    pub seasonal_rules: Option<Vec<SeasonalRule>>,
}

pub const DEFAULT_RAIL_LIMIT: u32 = 24;
pub const MAX_RAIL_LIMIT: u32 = 100;
pub const DEFAULT_STALE_DAYS: u32 = 60;
pub const DEFAULT_MIN_COLLECTION_SIZE: u32 = 2;

/// One admin-managed rail definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HomeRail {
    pub id: Uuid,
    pub kind: HomeRailKind,
    /// The library (media kind) this rail draws from; `None` only for a
    /// custom rail whose view spans libraries.
    pub library: Option<WorkKind>,
    /// Admin title override; `None` uses the localised built-in title.
    pub name: Option<String>,
    /// `Custom` rails: the saved view that supplies the filter.
    pub view_id: Option<Uuid>,
    pub enabled: bool,
    pub position: i32,
    pub config: HomeRailConfig,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A user's own override for one rail.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserRailPref {
    pub rail_id: Uuid,
    pub hidden: bool,
    pub position: Option<i32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collection_tag_round_trips_names_with_colons() {
        let tag = collection_tag(86311, "Sample: The Sample Team Collection");
        assert_eq!(
            collection_from_tags(&["rating:PG".into(), tag]),
            Some(("86311".into(), "Sample: The Sample Team Collection".into()))
        );
        assert_eq!(collection_from_tags(&["collection:".into()]), None);
    }

    #[test]
    fn score_tag_round_trips() {
        let tag = score_tag(7.84, 1200).unwrap();
        assert_eq!(tag, "score:7.8:1200");
        assert_eq!(score_from_tags(&[tag]), Some((7.8, 1200)));
        assert_eq!(score_tag(0.0, 5), None);
    }

    #[test]
    fn default_ids_are_unique_per_kind_and_library() {
        let mut seen = std::collections::HashSet::new();
        for lib in DEFAULT_RAIL_LIBRARIES {
            for kind in default_rail_kinds(lib) {
                assert!(seen.insert(default_rail_id(*kind, lib)));
            }
        }
        assert_eq!(seen.len(), 12);
    }
}
