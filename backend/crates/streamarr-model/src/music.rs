//! Music: [`Artist`] detail attached to a [`crate::Work`] of kind
//! [`crate::WorkKind::Artist`], with [`Album`] and [`Track`] children.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::work::Availability;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Artist {
    pub work_id: Uuid,
    pub disambiguation: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum AlbumType {
    Studio,
    Live,
    Compilation,
    Ep,
    Single,
    Soundtrack,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Album {
    pub id: Uuid,
    pub artist_work_id: Uuid,
    pub title: String,
    pub album_type: AlbumType,
    pub release_date: Option<NaiveDate>,
    pub monitored: bool,
    pub availability: Availability,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Track {
    pub id: Uuid,
    pub album_id: Uuid,
    pub disc_number: u32,
    pub track_number: u32,
    pub title: String,
    pub duration_seconds: Option<u32>,
    pub availability: Availability,
}
