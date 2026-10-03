//! ZIP reading and writing for the package, with the hardening an upload of
//! untrusted bytes needs.

use std::collections::HashSet;
use std::io::{Cursor, Read, Seek, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::csv_view;
use crate::format::{UserDataPackage, FORMAT_NAME, JSON_ENTRY, SCHEMA_VERSION};

pub const SCHEMA_ENTRY: &str = "schema/playarr-user-data-v1.schema.json";
const SCHEMA_JSON: &str = include_str!("../schema/playarr-user-data-v1.schema.json");

/// Bounds enforced when reading a package.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_archive_bytes: usize,
    pub max_expanded_bytes: u64,
    pub max_entries: usize,
    pub max_json_bytes: u64,
    pub max_records: usize,
    pub max_string_chars: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_archive_bytes: 50 * 1024 * 1024,
            max_expanded_bytes: 200 * 1024 * 1024,
            max_entries: 16,
            max_json_bytes: 64 * 1024 * 1024,
            max_records: 500_000,
            max_string_chars: 2_000,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PackageError {
    #[error("the file is not a valid ZIP archive")]
    NotZip,
    #[error("the archive is larger than the {0} byte limit")]
    ArchiveTooLarge(usize),
    #[error("the archive has more than {0} entries")]
    TooManyEntries(usize),
    #[error("the archive contains an unsafe entry name")]
    UnsafeEntryName,
    #[error("the archive contains a symbolic link")]
    SymlinkEntry,
    #[error("the archive contains an encrypted entry")]
    EncryptedEntry,
    #[error("the archive contains the same entry name twice")]
    DuplicateEntry,
    #[error("the archive expands beyond the permitted size")]
    TooLargeExpanded,
    #[error("the archive has no {JSON_ENTRY} entry")]
    MissingJson,
    #[error("{JSON_ENTRY} is not valid: {0}")]
    InvalidJson(String),
    #[error("the file is not a Playarr user-data package (format {0:?})")]
    WrongFormat(String),
    #[error(
        "schema version {found} is not supported (this server reads up to version {supported})"
    )]
    UnsupportedVersion { found: u64, supported: u32 },
    #[error("the package has more than {0} records")]
    TooManyRecords(usize),
    #[error("a text field is longer than {0} characters")]
    FieldTooLong(usize),
}

fn safe_entry_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && !name.contains(':')
        && !name
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
}

/// Reads and validates a package. `bytes` is the raw upload.
pub fn read_package(bytes: &[u8], limits: &Limits) -> Result<UserDataPackage, PackageError> {
    if bytes.len() > limits.max_archive_bytes {
        return Err(PackageError::ArchiveTooLarge(limits.max_archive_bytes));
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| PackageError::NotZip)?;
    if archive.len() > limits.max_entries {
        return Err(PackageError::TooManyEntries(limits.max_entries));
    }

    let mut seen = HashSet::new();
    let mut declared_total: u64 = 0;
    let mut json_index = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|_| PackageError::NotZip)?;
        let name = entry.name().to_owned();
        if !safe_entry_name(name.trim_end_matches('/')) {
            return Err(PackageError::UnsafeEntryName);
        }
        if entry.encrypted() {
            return Err(PackageError::EncryptedEntry);
        }
        if entry.is_symlink() {
            return Err(PackageError::SymlinkEntry);
        }
        if !seen.insert(name.clone()) {
            return Err(PackageError::DuplicateEntry);
        }
        declared_total = declared_total.saturating_add(entry.size());
        if declared_total > limits.max_expanded_bytes {
            return Err(PackageError::TooLargeExpanded);
        }
        if name == JSON_ENTRY {
            json_index = Some(index);
        }
    }

    let index = json_index.ok_or(PackageError::MissingJson)?;
    let entry = archive.by_index(index).map_err(|_| PackageError::NotZip)?;
    // Do not trust the declared size: stop after the cap whatever it says.
    let mut json = Vec::new();
    entry
        .take(limits.max_json_bytes + 1)
        .read_to_end(&mut json)
        .map_err(|_| PackageError::NotZip)?;
    if json.len() as u64 > limits.max_json_bytes {
        return Err(PackageError::TooLargeExpanded);
    }
    parse_json(&json, limits)
}

/// Parses and validates the canonical JSON document.
pub fn parse_json(json: &[u8], limits: &Limits) -> Result<UserDataPackage, PackageError> {
    let json = json.strip_prefix(b"\xef\xbb\xbf").unwrap_or(json);
    let value: serde_json::Value =
        serde_json::from_slice(json).map_err(|e| PackageError::InvalidJson(e.to_string()))?;
    let format = value.get("format").and_then(|v| v.as_str()).unwrap_or("");
    if format != FORMAT_NAME {
        return Err(PackageError::WrongFormat(format.chars().take(64).collect()));
    }
    match value.get("schema_version").and_then(|v| v.as_u64()) {
        Some(version) if version == u64::from(SCHEMA_VERSION) => {}
        Some(found) => {
            return Err(PackageError::UnsupportedVersion {
                found,
                supported: SCHEMA_VERSION,
            })
        }
        None => {
            return Err(PackageError::InvalidJson(
                "schema_version is missing".into(),
            ))
        }
    }
    let mut package: UserDataPackage =
        serde_json::from_value(value).map_err(|e| PackageError::InvalidJson(e.to_string()))?;
    if package.record_count() > limits.max_records {
        return Err(PackageError::TooManyRecords(limits.max_records));
    }
    sanitise(&mut package, limits.max_string_chars)?;
    Ok(package)
}

/// Strips control and bidirectional-override characters and enforces length.
fn clean(text: &mut String, max: usize) -> Result<(), PackageError> {
    if text.chars().count() > max {
        return Err(PackageError::FieldTooLong(max));
    }
    if text.chars().any(is_unwanted) {
        *text = text
            .chars()
            .filter_map(|c| match c {
                '\t' | '\n' | '\r' => Some(' '),
                c if is_unwanted(c) => None,
                c => Some(c),
            })
            .collect();
    }
    Ok(())
}

fn is_unwanted(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{200b}'..='\u{200f}' | '\u{feff}')
}

fn clean_opt(text: &mut Option<String>, max: usize) -> Result<(), PackageError> {
    if let Some(text) = text {
        clean(text, max)?;
    }
    Ok(())
}

fn clean_item(item: &mut crate::format::ItemRef, max: usize) -> Result<(), PackageError> {
    clean(&mut item.kind, max)?;
    clean(&mut item.title, max)?;
    clean_opt(&mut item.episode_title, max)?;
    clean_opt(&mut item.album_title, max)?;
    clean_opt(&mut item.track_title, max)?;
    clean_opt(&mut item.book_title, max)?;
    let ids = std::mem::take(&mut item.external_ids);
    for (mut key, mut value) in ids {
        clean(&mut key, max)?;
        clean(&mut value, max)?;
        if !key.is_empty() && !value.is_empty() {
            item.external_ids.insert(key, value);
        }
    }
    Ok(())
}

fn sanitise(package: &mut UserDataPackage, max: usize) -> Result<(), PackageError> {
    clean(&mut package.generator.name, max)?;
    clean(&mut package.generator.version, max)?;
    clean(&mut package.source.instance_name, max)?;
    clean(&mut package.owner.display_name, max)?;
    clean_opt(&mut package.preferences.preferred_audio_language, max)?;
    for record in &mut package.watch_progress {
        clean(&mut record.state, max)?;
        clean_item(&mut record.item, max)?;
    }
    for record in &mut package.playback_preferences {
        clean(&mut record.quality_id, max)?;
        clean_opt(&mut record.audio_track_id, max)?;
        clean_opt(&mut record.subtitle_track_id, max)?;
        clean_item(&mut record.item, max)?;
    }
    for playlist in &mut package.playlists {
        clean(&mut playlist.name, max)?;
        clean(&mut playlist.media_type, max)?;
        for entry in &mut playlist.items {
            clean_item(&mut entry.item, max)?;
        }
    }
    for record in &mut package.unmatched {
        clean(&mut record.section, max)?;
        clean(&mut record.reason, max)?;
        clean_opt(&mut record.playlist_name, max)?;
    }
    Ok(())
}

fn readme(package: &UserDataPackage) -> String {
    format!(
        "Playarr personal data export\r\n\
=============================\r\n\
\r\n\
Created: {generated}\r\n\
From server: {server}\r\n\
Format: {FORMAT_NAME}, schema version {SCHEMA_VERSION}\r\n\
\r\n\
Contents\r\n\
--------\r\n\
playarr-user-data.json   The canonical data. This is the only file an import reads.\r\n\
watch-progress.csv       Spreadsheet view of your resume positions and watched state.\r\n\
playlists.csv            Spreadsheet view of your playlists.\r\n\
playlist-items.csv       Spreadsheet view of playlist entries, in order.\r\n\
schema/                  JSON Schema describing the JSON file.\r\n\
\r\n\
The CSV files are for reading and are ignored on import. Edit the JSON file if\r\n\
you need to correct something before importing.\r\n\
\r\n\
Units: times are UTC (RFC 3339, ending in Z); positions and durations are\r\n\
milliseconds. Playarr stores one resume state per title, so there are no\r\n\
per-viewing events or play counts, and it stores no ratings or separate\r\n\
watchlist. Nothing here contains passwords, tokens, file paths or other\r\n\
people's data. Full specification: docs/formats/user-data-export-v1.md in the\r\n\
Playarr repository.\r\n\
\r\n\
Counts: {watch} watch records, {prefs} playback preferences, {lists} playlists.\r\n",
        generated = package
            .generated_at
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        server = package.source.instance_name,
        watch = package.watch_progress.len(),
        prefs = package.playback_preferences.len(),
        lists = package.playlists.len(),
    )
}

/// Writes the complete package to `out`.
pub fn write_package<W: Write + Seek>(
    package: &UserDataPackage,
    out: W,
) -> Result<(), zip::result::ZipError> {
    let mut zip = ZipWriter::new(out);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let json = serde_json::to_vec_pretty(package).map_err(std::io::Error::other)?;
    let files: [(&str, Vec<u8>); 6] = [
        ("README.txt", readme(package).into_bytes()),
        (JSON_ENTRY, json),
        (SCHEMA_ENTRY, SCHEMA_JSON.as_bytes().to_vec()),
        (
            "watch-progress.csv",
            csv_view::watch_progress_csv(package).into_bytes(),
        ),
        (
            "playlists.csv",
            csv_view::playlists_csv(package).into_bytes(),
        ),
        (
            "playlist-items.csv",
            csv_view::playlist_items_csv(package).into_bytes(),
        ),
    ];
    for (name, bytes) in files {
        zip.start_file(name, options)?;
        zip.write_all(&bytes)?;
    }
    zip.finish()?;
    Ok(())
}

/// Convenience for tests and small packages.
pub fn package_to_bytes(package: &UserDataPackage) -> Result<Vec<u8>, zip::result::ZipError> {
    let mut cursor = Cursor::new(Vec::new());
    write_package(package, &mut cursor)?;
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::*;
    use chrono::{TimeZone, Utc};
    use uuid::Uuid;

    fn sample() -> UserDataPackage {
        let at = Utc.with_ymd_and_hms(2026, 10, 3, 12, 0, 0).unwrap();
        let mut p = UserDataPackage::new(at);
        p.source.instance_name = "Home".into();
        p.owner.display_name = "alex".into();
        p.preferences.preferred_audio_language = Some("ja".into());
        let item = ItemRef {
            kind: "movie".into(),
            title: "日本語タイトル".into(),
            year: Some(2001),
            external_ids: [("tmdb".to_owned(), "129".to_owned())].into(),
            ..ItemRef::default()
        };
        p.watch_progress.push(WatchRecord {
            item: item.clone(),
            state: "part_watched".into(),
            position_ms: 61_000,
            duration_ms: 7_500_000,
            updated_at: Some(at),
        });
        p.playlists.push(Playlist {
            id: Uuid::new_v4(),
            name: "=Evil, \"list\"".into(),
            media_type: "video".into(),
            parent_id: None,
            created_at: at,
            updated_at: at,
            items: vec![PlaylistEntry {
                position: 0,
                added_at: at,
                item,
            }],
        });
        p
    }

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(&mut cursor);
        for (name, data) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
        cursor.into_inner()
    }

    #[test]
    fn round_trips_exactly_including_unicode() {
        let package = sample();
        let bytes = package_to_bytes(&package).unwrap();
        assert_eq!(read_package(&bytes, &Limits::default()).unwrap(), package);
    }

    #[test]
    fn package_contains_readable_entries() {
        let bytes = package_to_bytes(&sample()).unwrap();
        let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let names: Vec<String> = (0..zip.len())
            .map(|i| zip.by_index(i).unwrap().name().to_owned())
            .collect();
        for expected in [
            "README.txt",
            JSON_ENTRY,
            SCHEMA_ENTRY,
            "watch-progress.csv",
            "playlists.csv",
            "playlist-items.csv",
        ] {
            assert!(names.iter().any(|n| n == expected), "{expected}");
        }
        let mut csv = String::new();
        zip.by_name("playlist-items.csv")
            .unwrap()
            .read_to_string(&mut csv)
            .unwrap();
        assert!(csv.starts_with('\u{feff}'));
        assert!(csv.contains("'=Evil"), "formula neutralised: {csv}");
        assert!(csv.contains("日本語タイトル"));
    }

    #[test]
    fn rejects_non_zip_and_wrong_format() {
        assert_eq!(
            read_package(b"not a zip", &Limits::default()),
            Err(PackageError::NotZip)
        );
        let bytes = zip_with(&[(JSON_ENTRY, br#"{"format":"other","schema_version":1}"#)]);
        assert!(matches!(
            read_package(&bytes, &Limits::default()),
            Err(PackageError::WrongFormat(_))
        ));
        let bytes = zip_with(&[("x.txt", b"hi")]);
        assert_eq!(
            read_package(&bytes, &Limits::default()),
            Err(PackageError::MissingJson)
        );
    }

    #[test]
    fn newer_and_zero_schema_versions_are_refused_with_the_version() {
        let doc = |v: u32| {
            format!(
                r#"{{"format":"playarr.user-data","schema_version":{v},"generated_at":"2026-10-03T12:00:00Z"}}"#
            )
        };
        let bytes = zip_with(&[(JSON_ENTRY, doc(2).as_bytes())]);
        assert_eq!(
            read_package(&bytes, &Limits::default()),
            Err(PackageError::UnsupportedVersion {
                found: 2,
                supported: 1
            })
        );
        let bytes = zip_with(&[(JSON_ENTRY, doc(0).as_bytes())]);
        assert!(matches!(
            read_package(&bytes, &Limits::default()),
            Err(PackageError::UnsupportedVersion { found: 0, .. })
        ));
    }

    #[test]
    fn unsafe_entry_names_are_rejected() {
        for name in ["../evil", "/abs", "a/../b", "c:evil", "a\\b"] {
            let bytes = zip_with(&[(name, b"x"), (JSON_ENTRY, b"{}")]);
            assert_eq!(
                read_package(&bytes, &Limits::default()),
                Err(PackageError::UnsafeEntryName),
                "{name}"
            );
        }
    }

    #[test]
    fn symbolic_links_are_rejected() {
        let mut cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(&mut cursor);
        zip.add_symlink("link", "/etc/passwd", SimpleFileOptions::default())
            .unwrap();
        zip.start_file(JSON_ENTRY, SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"{}").unwrap();
        zip.finish().unwrap();
        assert_eq!(
            read_package(&cursor.into_inner(), &Limits::default()),
            Err(PackageError::SymlinkEntry)
        );
    }

    #[test]
    fn too_many_entries_and_oversize_are_rejected() {
        let entries: Vec<(String, Vec<u8>)> = (0..20).map(|i| (format!("f{i}"), vec![0])).collect();
        let refs: Vec<(&str, &[u8])> = entries
            .iter()
            .map(|(n, d)| (n.as_str(), d.as_slice()))
            .collect();
        assert_eq!(
            read_package(&zip_with(&refs), &Limits::default()),
            Err(PackageError::TooManyEntries(16))
        );
        let small = Limits {
            max_archive_bytes: 10,
            ..Limits::default()
        };
        assert_eq!(
            read_package(&package_to_bytes(&sample()).unwrap(), &small),
            Err(PackageError::ArchiveTooLarge(10))
        );
    }

    #[test]
    fn zip_bomb_is_stopped_by_expanded_limits() {
        let big = vec![b' '; 5 * 1024 * 1024];
        let bytes = zip_with(&[(JSON_ENTRY, &big)]);
        let limits = Limits {
            max_expanded_bytes: 1024,
            ..Limits::default()
        };
        assert_eq!(
            read_package(&bytes, &limits),
            Err(PackageError::TooLargeExpanded)
        );
        let limits = Limits {
            max_json_bytes: 1024,
            ..Limits::default()
        };
        assert_eq!(
            read_package(&bytes, &limits),
            Err(PackageError::TooLargeExpanded)
        );
    }

    #[test]
    fn record_and_string_limits() {
        let mut p = sample();
        p.watch_progress.push(p.watch_progress[0].clone());
        let limits = Limits {
            max_records: 2,
            ..Limits::default()
        };
        let bytes = package_to_bytes(&p).unwrap();
        assert_eq!(
            read_package(&bytes, &limits),
            Err(PackageError::TooManyRecords(2))
        );
        let limits = Limits {
            max_string_chars: 3,
            ..Limits::default()
        };
        assert_eq!(
            read_package(&bytes, &limits),
            Err(PackageError::FieldTooLong(3))
        );
    }

    #[test]
    fn hostile_text_is_cleaned_not_interpreted() {
        let mut p = sample();
        p.watch_progress[0].item.title = "Evil\u{202e}gnp.exe\u{0}\nline".into();
        let bytes = package_to_bytes(&p).unwrap();
        let read = read_package(&bytes, &Limits::default()).unwrap();
        assert_eq!(read.watch_progress[0].item.title, "Evilgnp.exe line");
    }

    #[test]
    fn unknown_fields_and_kinds_are_tolerated() {
        let doc = r#"{"format":"playarr.user-data","schema_version":1,"generated_at":"2026-10-03T12:00:00Z","future":{"x":1},
          "watch_progress":[{"item":{"kind":"game","title":"X","future":1},"state":"watched","new_field":true}]}"#;
        let bytes = zip_with(&[(JSON_ENTRY, doc.as_bytes())]);
        let p = read_package(&bytes, &Limits::default()).unwrap();
        assert_eq!(p.watch_progress[0].item.kind, "game");
    }

    #[test]
    fn embedded_schema_is_valid_json_and_names_required_members() {
        let schema: serde_json::Value = serde_json::from_str(SCHEMA_JSON).unwrap();
        let required: Vec<&str> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(required, ["format", "schema_version", "generated_at"]);
    }
}
