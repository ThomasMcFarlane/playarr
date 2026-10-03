//! Convenience CSV views. They are regenerated from the package, never
//! imported, and every cell is neutralised against spreadsheet formulas.

use std::collections::HashMap;

use crate::format::{ItemRef, UserDataPackage};

/// UTF-8 byte-order mark so spreadsheets detect the encoding.
const BOM: &str = "\u{feff}";

/// Quotes one cell for RFC 4180 and prefixes a single quote when the first
/// character could start a spreadsheet formula.
pub fn cell(value: &str) -> String {
    let mut text = value.to_owned();
    if matches!(
        text.chars().next(),
        Some('=') | Some('+') | Some('-') | Some('@') | Some('\t') | Some('\r')
    ) {
        text.insert(0, '\'');
    }
    if text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text
    }
}

fn row(cells: &[String]) -> String {
    let mut line = cells.iter().map(|c| cell(c)).collect::<Vec<_>>().join(",");
    line.push_str("\r\n");
    line
}

fn opt<T: ToString>(value: &Option<T>) -> String {
    value.as_ref().map(ToString::to_string).unwrap_or_default()
}

const ITEM_HEADER: [&str; 16] = [
    "kind",
    "title",
    "year",
    "season",
    "episode",
    "episode_title",
    "album",
    "disc",
    "track",
    "track_title",
    "book_title",
    "tmdb",
    "tvdb",
    "imdb",
    "other_ids",
    "playarr_work_id",
];

fn item_cells(item: &ItemRef) -> Vec<String> {
    let other: Vec<String> = item
        .external_ids
        .iter()
        .filter(|(key, _)| !matches!(key.as_str(), "tmdb" | "tvdb" | "imdb"))
        .map(|(key, value)| format!("{key}={value}"))
        .collect();
    vec![
        item.kind.clone(),
        item.title.clone(),
        opt(&item.year),
        opt(&item.season_number),
        opt(&item.episode_number),
        opt(&item.episode_title),
        opt(&item.album_title),
        opt(&item.disc_number),
        opt(&item.track_number),
        opt(&item.track_title),
        opt(&item.book_title),
        item.external_ids.get("tmdb").cloned().unwrap_or_default(),
        item.external_ids.get("tvdb").cloned().unwrap_or_default(),
        item.external_ids.get("imdb").cloned().unwrap_or_default(),
        other.join(";"),
        item.playarr
            .as_ref()
            .map(|p| p.work_id.to_string())
            .unwrap_or_default(),
    ]
}

fn header(prefix: &[&str], suffix: &[&str]) -> String {
    let cells: Vec<String> = prefix
        .iter()
        .chain(ITEM_HEADER.iter())
        .chain(suffix.iter())
        .map(|s| (*s).to_owned())
        .collect();
    format!("{BOM}{}", row(&cells))
}

fn hms(ms: u64) -> String {
    let total = ms / 1000;
    format!(
        "{}:{:02}:{:02}",
        total / 3600,
        (total / 60) % 60,
        total % 60
    )
}

pub fn watch_progress_csv(package: &UserDataPackage) -> String {
    let mut out = header(
        &["state"],
        &["position_ms", "duration_ms", "position", "updated_at"],
    );
    for record in &package.watch_progress {
        let mut cells = vec![record.state.clone()];
        cells.extend(item_cells(&record.item));
        cells.push(record.position_ms.to_string());
        cells.push(record.duration_ms.to_string());
        cells.push(hms(record.position_ms));
        cells.push(
            record
                .updated_at
                .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                .unwrap_or_default(),
        );
        out.push_str(&row(&cells));
    }
    out
}

pub fn playlists_csv(package: &UserDataPackage) -> String {
    let names: HashMap<_, _> = package
        .playlists
        .iter()
        .map(|p| (p.id, p.name.clone()))
        .collect();
    let mut out = format!(
        "{BOM}{}",
        row(&[
            "playlist_id".into(),
            "name".into(),
            "media_type".into(),
            "parent_name".into(),
            "item_count".into(),
            "created_at".into(),
            "updated_at".into(),
        ])
    );
    for playlist in &package.playlists {
        out.push_str(&row(&[
            playlist.id.to_string(),
            playlist.name.clone(),
            playlist.media_type.clone(),
            playlist
                .parent_id
                .and_then(|id| names.get(&id).cloned())
                .unwrap_or_default(),
            playlist.items.len().to_string(),
            playlist
                .created_at
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            playlist
                .updated_at
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        ]));
    }
    out
}

pub fn playlist_items_csv(package: &UserDataPackage) -> String {
    let mut out = header(&["playlist", "position"], &["added_at"]);
    for playlist in &package.playlists {
        for (index, entry) in playlist.items.iter().enumerate() {
            let mut cells = vec![playlist.name.clone(), (index + 1).to_string()];
            cells.extend(item_cells(&entry.item));
            cells.push(
                entry
                    .added_at
                    .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            );
            out.push_str(&row(&cells));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formula_prefixes_are_neutralised() {
        for hostile in ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tx", "\rx"] {
            assert!(
                cell(hostile).trim_matches('"').starts_with('\''),
                "{hostile:?}"
            );
        }
        assert_eq!(cell("Plain"), "Plain");
    }

    #[test]
    fn commas_quotes_and_newlines_are_quoted() {
        assert_eq!(cell("a,b"), "\"a,b\"");
        assert_eq!(cell("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(cell("a\nb"), "\"a\nb\"");
    }

    #[test]
    fn unicode_is_preserved() {
        assert_eq!(cell("日本語タイトル"), "日本語タイトル");
    }
}
