//! TV: [`Series`] detail attached to a [`crate::Work`] of kind
//! [`crate::WorkKind::Series`], with [`Season`] and [`Episode`] children.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::work::Availability;

/// Series-specific detail. One row per `Work` of kind `Series`; `work_id`
/// is both the foreign key and the primary key (a strict 1:1 extension of
/// `Work`, not a separately-identified entity).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Series {
    pub work_id: Uuid,
    pub network: Option<String>,
    pub status: SeriesStatus,
    pub next_airing: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum SeriesStatus {
    Upcoming,
    Continuing,
    Ended,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Season {
    pub id: Uuid,
    pub series_work_id: Uuid,
    pub season_number: i32,
    pub title: Option<String>,
    pub overview: Option<String>,
    pub monitored: bool,
    pub availability: Availability,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Episode {
    pub id: Uuid,
    pub season_id: Uuid,
    pub episode_number: i32,
    pub title: Option<String>,
    pub overview: Option<String>,
    pub air_date: Option<NaiveDate>,
    pub runtime_minutes: Option<u32>,
    pub monitored: bool,
    pub availability: Availability,
}
