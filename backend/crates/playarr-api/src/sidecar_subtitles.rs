//! Sidecar subtitle discovery: `<video>.<lang>[.forced|.sdh|.hi|.cc].<ext>`
//! files that sit next to a media file (Bazarr, manual drops, ripping tools).
//!
//! Sidecars are exposed as ordinary subtitle tracks. They get a synthetic
//! `stream_index` at or above [`SIDECAR_STREAM_INDEX_BASE`] derived from the
//! file name, so it is stable when other sidecars appear or disappear and can
//! never collide with a real container stream index.

use std::path::{Path, PathBuf};

use crate::media::SourceSubtitleTrack;

/// Real container streams never reach this index.
pub(crate) const SIDECAR_STREAM_INDEX_BASE: u32 = 10_000;
const SIDECAR_STREAM_INDEX_SPAN: u32 = 1_000_000;

const SIDECAR_EXTENSIONS: [&str; 4] = ["srt", "ass", "ssa", "vtt"];

/// True for the text subtitle files ffmpeg can convert straight to WebVTT.
pub(crate) fn is_sidecar_subtitle_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| SIDECAR_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn codec_for_extension(ext: &str) -> &'static str {
    match ext {
        "ass" => "ass",
        "ssa" => "ssa",
        "vtt" => "webvtt",
        _ => "subrip",
    }
}

fn stable_index(file_name: &str) -> u32 {
    // FNV-1a: deterministic across processes (unlike `DefaultHasher` seeds).
    let mut hash: u32 = 0x811c_9dc5;
    for byte in file_name.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    SIDECAR_STREAM_INDEX_BASE + hash % SIDECAR_STREAM_INDEX_SPAN
}

fn looks_like_language(part: &str) -> bool {
    let base = part.split(['-', '_']).next().unwrap_or("");
    (2..=3).contains(&base.len()) && base.chars().all(|c| c.is_ascii_alphabetic())
}

fn language_name(code: &str) -> Option<&'static str> {
    Some(match code.to_ascii_lowercase().as_str() {
        "en" | "eng" => "English",
        "fr" | "fra" | "fre" => "French",
        "de" | "deu" | "ger" => "German",
        "es" | "spa" => "Spanish",
        "it" | "ita" => "Italian",
        "pt" | "por" => "Portuguese",
        "nl" | "nld" | "dut" => "Dutch",
        "sv" | "swe" => "Swedish",
        "da" | "dan" => "Danish",
        "no" | "nor" => "Norwegian",
        "fi" | "fin" => "Finnish",
        "pl" | "pol" => "Polish",
        "ru" | "rus" => "Russian",
        "ja" | "jpn" => "Japanese",
        "ko" | "kor" => "Korean",
        "zh" | "zho" | "chi" => "Chinese",
        "th" | "tha" => "Thai",
        "ar" | "ara" => "Arabic",
        "tr" | "tur" => "Turkish",
        "hi" | "hin" => "Hindi",
        "el" | "ell" | "gre" => "Greek",
        "he" | "heb" => "Hebrew",
        "cs" | "ces" | "cze" => "Czech",
        "hu" | "hun" => "Hungarian",
        "id" | "ind" => "Indonesian",
        "vi" | "vie" => "Vietnamese",
        _ => return None,
    })
}

/// Parses one candidate file name against the video's file stem. Returns
/// `None` when it is not a sidecar of that video.
fn parse_sidecar(video_stem: &str, file_name: &str) -> Option<SourceSubtitleTrack> {
    let rest = file_name.strip_prefix(video_stem)?.strip_prefix('.')?;
    let (middle, ext) = rest.rsplit_once('.').map_or(("", rest), |(m, e)| (m, e));
    let ext = ext.to_ascii_lowercase();
    if !SIDECAR_EXTENSIONS.contains(&ext.as_str()) {
        return None;
    }

    let mut language: Option<String> = None;
    let mut forced = false;
    let mut sdh = false;
    let mut default = false;
    for part in middle.split('.').filter(|part| !part.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "forced" => forced = true,
            "sdh" | "hi" | "cc" => sdh = true,
            "default" => default = true,
            _ if language.is_none() && looks_like_language(part) => {
                language = Some(part.to_string());
            }
            _ => {}
        }
    }

    let mut label = match language.as_deref() {
        Some(code) => language_name(code.split(['-', '_']).next().unwrap_or(code))
            .map_or_else(|| code.to_ascii_uppercase(), str::to_string),
        None => "Subtitles".to_string(),
    };
    if forced {
        label.push_str(" (Forced)");
    }
    if sdh {
        label.push_str(" (SDH)");
    }

    Some(SourceSubtitleTrack {
        stream_index: stable_index(file_name),
        label,
        language,
        codec: codec_for_extension(&ext).to_string(),
        is_default: default,
        forced,
        sidecar_path: None,
    })
}

/// Sidecar subtitle tracks next to `media_path`, sorted by file name. A
/// missing or unreadable directory yields no tracks rather than an error.
pub(crate) async fn discover_sidecar_subtitles(media_path: &Path) -> Vec<SourceSubtitleTrack> {
    let (Some(dir), Some(stem)) = (
        media_path.parent(),
        media_path.file_stem().and_then(|s| s.to_str()),
    ) else {
        return Vec::new();
    };
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return Vec::new();
    };
    let mut found: Vec<(String, PathBuf)> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if parse_sidecar(stem, &name).is_some() {
            found.push((name, entry.path()));
        }
    }
    found.sort();

    let mut used = std::collections::HashSet::new();
    found
        .into_iter()
        .filter_map(|(name, path)| {
            let mut track = parse_sidecar(stem, &name)?;
            while !used.insert(track.stream_index) {
                track.stream_index += 1;
            }
            track.sidecar_path = Some(path);
            Some(track)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_language_flags_and_codec() {
        let t = parse_sidecar("Show.S01E01", "Show.S01E01.th.hi.srt").unwrap();
        assert_eq!(t.language.as_deref(), Some("th"));
        assert_eq!(t.label, "Thai (SDH)");
        assert_eq!(t.codec, "subrip");
        assert!(!t.forced);

        let t = parse_sidecar("Movie (1994)", "Movie (1994).en.forced.ass").unwrap();
        assert_eq!(t.label, "English (Forced)");
        assert!(t.forced);
        assert_eq!(t.codec, "ass");

        let t = parse_sidecar("Movie", "Movie.vtt").unwrap();
        assert_eq!(t.label, "Subtitles");
        assert_eq!(t.language, None);
        assert_eq!(t.codec, "webvtt");
    }

    #[test]
    fn rejects_other_files() {
        assert!(parse_sidecar("Movie", "Movie.mkv").is_none());
        assert!(parse_sidecar("Movie", "Movie.en.nfo").is_none());
        assert!(parse_sidecar("Movie", "Movie 2.en.srt").is_none());
        assert!(parse_sidecar("Movie", "Other.en.srt").is_none());
    }

    #[test]
    fn index_is_stable_and_above_container_range() {
        let a = parse_sidecar("M", "M.en.srt").unwrap().stream_index;
        assert_eq!(a, parse_sidecar("M", "M.en.srt").unwrap().stream_index);
        assert!(a >= SIDECAR_STREAM_INDEX_BASE);
    }

    #[tokio::test]
    async fn discovers_sorted_sidecars_next_to_the_video() {
        let dir = std::env::temp_dir().join(format!("playarr-sidecar-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            "ep.mkv",
            "ep.th.hi.srt",
            "ep.en.srt",
            "ep.nfo",
            "other.en.srt",
        ] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        let tracks = discover_sidecar_subtitles(&dir.join("ep.mkv")).await;
        let labels: Vec<_> = tracks.iter().map(|t| t.label.as_str()).collect();
        assert_eq!(labels, ["English", "Thai (SDH)"]);
        assert!(tracks.iter().all(|t| t.sidecar_path.is_some()));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
