//! Version 1 of the portable user-data format. The normative description is
//! `docs/formats/user-data-export-v1.md`; keep the two in step.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The value of the `format` member of every package.
pub const FORMAT_NAME: &str = "playarr.user-data";
/// The newest `schema_version` this crate reads and the one it writes.
pub const SCHEMA_VERSION: u32 = 1;
/// Name of the canonical JSON entry inside the ZIP.
pub const JSON_ENTRY: &str = "playarr-user-data.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserDataPackage {
    pub format: String,
    pub schema_version: u32,
    pub generated_at: DateTime<Utc>,
    #[serde(default)]
    pub generator: Generator,
    #[serde(default)]
    pub source: Source,
    #[serde(default)]
    pub owner: Owner,
    #[serde(default)]
    pub preferences: Preferences,
    #[serde(default)]
    pub watch_progress: Vec<WatchRecord>,
    #[serde(default)]
    pub playback_preferences: Vec<PlaybackPreferenceRecord>,
    #[serde(default)]
    pub playlists: Vec<Playlist>,
    /// Reserved: Playarr stores no personal ratings yet.
    #[serde(default)]
    pub ratings: Vec<serde_json::Value>,
    /// Reserved: watch-later is a playlist; there is no separate watchlist.
    #[serde(default)]
    pub watchlist: Vec<serde_json::Value>,
    /// Present only in an "unmatched" package produced by an import.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unmatched: Vec<UnmatchedRecord>,
}

impl UserDataPackage {
    pub fn new(generated_at: DateTime<Utc>) -> Self {
        Self {
            format: FORMAT_NAME.to_owned(),
            schema_version: SCHEMA_VERSION,
            generated_at,
            generator: Generator::default(),
            source: Source::default(),
            owner: Owner::default(),
            preferences: Preferences::default(),
            watch_progress: Vec::new(),
            playback_preferences: Vec::new(),
            playlists: Vec::new(),
            ratings: Vec::new(),
            watchlist: Vec::new(),
            unmatched: Vec::new(),
        }
    }

    /// Total number of importable records, used for caps and progress.
    pub fn record_count(&self) -> usize {
        self.watch_progress.len()
            + self.playback_preferences.len()
            + self.playlists.len()
            + self
                .playlists
                .iter()
                .map(|playlist| playlist.items.len())
                .sum::<usize>()
            + self.unmatched.len()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Generator {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Source {
    #[serde(default)]
    pub instance_name: String,
}

/// Attribution only; never used to choose an import destination.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Owner {
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Preferences {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_audio_language: Option<String>,
}

/// Local ids on the source server, kept for cross-server diagnostics only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayarrRef {
    pub work_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leaf_id: Option<Uuid>,
}

/// One piece of content, identified portably.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ItemRef {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(default)]
    pub external_ids: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season_number: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_number: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disc_number: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_number: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playarr: Option<PlayarrRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WatchRecord {
    pub item: ItemRef,
    /// `part_watched` or `watched`.
    pub state: String,
    #[serde(default)]
    pub position_ms: u64,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackPreferenceRecord {
    pub item: ItemRef,
    #[serde(default)]
    pub quality_id: String,
    #[serde(default)]
    pub audio_track_id: Option<String>,
    #[serde(default)]
    pub subtitle_track_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Playlist {
    /// Local to the package; used only for `parent_id`.
    pub id: Uuid,
    pub name: String,
    /// `video` or `audio`.
    #[serde(default)]
    pub media_type: String,
    #[serde(default)]
    pub parent_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub items: Vec<PlaylistEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaylistEntry {
    #[serde(default)]
    pub position: i32,
    pub added_at: DateTime<Utc>,
    pub item: ItemRef,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnmatchedRecord {
    /// `watch_progress`, `playback_preferences` or `playlist_item`.
    pub section: String,
    /// `no_match`, `ambiguous`, `unsupported_kind` or `not_accessible`.
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playlist_name: Option<String>,
    pub record: serde_json::Value,
}
