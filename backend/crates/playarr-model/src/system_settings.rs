//! Persisted, administrator-editable settings that apply to the whole
//! Playarr Server instance.

use serde::{Deserialize, Serialize};

/// The name a new installation presents to Playarr until an administrator
/// changes it in Playarr Server Admin.
pub const DEFAULT_INSTANCE_NAME: &str = "Playarr Server";

/// Singleton system configuration stored in the database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SystemSettings {
    pub instance_name: String,
}
