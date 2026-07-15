//! Books: [`Author`] detail attached to a [`crate::Work`] of kind
//! [`crate::WorkKind::Author`], with [`Book`] children.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::work::Availability;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Author {
    pub work_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Book {
    pub id: Uuid,
    pub author_work_id: Uuid,
    pub title: String,
    pub isbn: Option<String>,
    pub release_date: Option<NaiveDate>,
    pub series_name: Option<String>,
    pub series_position: Option<f32>,
    pub monitored: bool,
    pub availability: Availability,
}
