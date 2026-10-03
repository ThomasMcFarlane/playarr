//! The versioned backup manifest and the plaintext sidecar that commits it.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Bumped on any incompatible change to the archive layout or manifest.
pub const FORMAT_VERSION: u32 = 1;
pub const MANIFEST_NAME: &str = "manifest.json";
pub const ARCHIVE_PREFIX: &str = "playarr-backup-";
pub const ARCHIVE_EXTENSION: &str = "parbak";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Engine {
    Sqlite,
    Postgres,
}

impl Engine {
    pub fn as_str(self) -> &'static str {
        match self {
            Engine::Sqlite => "sqlite",
            Engine::Postgres => "postgres",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupMode {
    /// Database plus server-managed assets.
    Full,
    /// Database only. Always labelled partial.
    Database,
}

impl BackupMode {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "full" => Some(Self::Full),
            "database" => Some(Self::Database),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileEntry {
    /// Path inside the archive, `/`-separated, never absolute or containing `..`.
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableEntry {
    pub name: String,
    pub rows: u64,
}

/// One line of the explicit inventory: what a data class is and why it is in
/// the included, excluded or unavailable list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InventoryItem {
    pub class: String,
    pub detail: String,
}

impl InventoryItem {
    pub fn new(class: &str, detail: impl Into<String>) -> Self {
        Self {
            class: class.to_string(),
            detail: detail.into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalDependencies {
    /// Library root paths the catalogue refers to. They are not copied; the
    /// replacement server must provide them.
    pub library_roots: Vec<String>,
    /// Names (never values) of runtime secrets the replacement must supply.
    pub required_secrets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeInfo {
    pub peer_id: Option<String>,
    pub instance_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    pub format_version: u32,
    pub backup_id: String,
    pub created_at: DateTime<Utc>,
    pub server_version: String,
    pub engine: Engine,
    /// Highest applied migration version in the snapshot.
    pub schema_version: i64,
    pub mode: BackupMode,
    /// True when the backup does not contain everything it could (database
    /// mode, or an asset class skipped because of its size cap).
    pub partial: bool,
    pub files: Vec<FileEntry>,
    pub tables: Vec<TableEntry>,
    pub included: Vec<InventoryItem>,
    pub excluded: Vec<InventoryItem>,
    pub unavailable: Vec<InventoryItem>,
    pub external_dependencies: ExternalDependencies,
    pub node: NodeInfo,
}

/// Plaintext record written next to the archive after the archive is durable.
/// It carries no secrets: the manifest holds names and counts only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Sidecar {
    pub manifest: Manifest,
    pub archive_name: String,
    pub archive_sha256: String,
    pub archive_size: u64,
}

pub fn archive_file_name(created_at: DateTime<Utc>, backup_id: &str) -> String {
    format!(
        "{ARCHIVE_PREFIX}{}-{backup_id}.{ARCHIVE_EXTENSION}",
        created_at.format("%Y%m%dT%H%M%SZ")
    )
}

pub fn sidecar_file_name(archive_name: &str) -> String {
    format!("{archive_name}.json")
}

/// Rejects names that could escape the extraction directory.
pub fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains('\0')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsafe_paths_are_rejected() {
        for bad in ["", "/etc/passwd", "../x", "a/../b", "a//b", "a\\b", "./a"] {
            assert!(!is_safe_relative_path(bad), "{bad}");
        }
        for good in ["db/playarr.sqlite", "assets/artwork/ab/cd.jpg"] {
            assert!(is_safe_relative_path(good), "{good}");
        }
    }
}
