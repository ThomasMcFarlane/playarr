//! Background indexer for the audio/subtitle language index (task 180).
//!
//! Sonarr/Radarr `mediaInfo` fills the index at sync time (`playarr-arr-sync`).
//! This module covers what that cannot: files the *arr app could not describe
//! (ffprobe, cached in the index) and subtitle sidecar files next to the
//! video (rescanned periodically because Bazarr and manual drops change).

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use playarr_db::repo::{SOURCE_PROBE, SOURCE_SIDECAR};
use playarr_db::MediaLanguageRepo;
use playarr_model::language::{normalize_known_language, normalize_language};
use serde::Deserialize;
use tokio::process::Command;
use uuid::Uuid;

const PROBE_BATCH: i64 = 50;
const SIDECAR_BATCH: i64 = 500;
const CONCURRENCY: usize = 4;
const SIDECAR_RESCAN: Duration = Duration::from_secs(6 * 60 * 60);
const IDLE_SLEEP: Duration = Duration::from_secs(10 * 60);
const BUSY_SLEEP: Duration = Duration::from_secs(2);
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct ProbedLanguages {
    pub audio: Vec<String>,
    pub subtitles: Vec<String>,
}

#[derive(Deserialize)]
struct StreamList {
    #[serde(default)]
    streams: Vec<Stream>,
}

#[derive(Deserialize)]
struct Stream {
    #[serde(default)]
    codec_type: String,
    #[serde(default)]
    tags: StreamTags,
}

#[derive(Deserialize, Default)]
struct StreamTags {
    language: Option<String>,
}

fn sorted_unique(mut list: Vec<String>) -> Vec<String> {
    list.sort();
    list.dedup();
    list
}

/// Audio and embedded subtitle languages from `ffprobe -show_streams` JSON.
/// Every subtitle codec counts (bitmap tracks too): the index answers
/// "which languages does this file carry", independent of what a client can
/// render.
pub(crate) fn parse_probe_languages(stdout: &[u8]) -> Result<ProbedLanguages, String> {
    let parsed: StreamList = serde_json::from_slice(stdout)
        .map_err(|error| format!("invalid ffprobe output: {error}"))?;
    let mut out = ProbedLanguages::default();
    for stream in parsed.streams {
        let Some(code) = stream.tags.language.as_deref().and_then(normalize_language) else {
            continue;
        };
        match stream.codec_type.as_str() {
            "audio" => out.audio.push(code),
            "subtitle" => out.subtitles.push(code),
            _ => {}
        }
    }
    out.audio = sorted_unique(out.audio);
    out.subtitles = sorted_unique(out.subtitles);
    Ok(out)
}

async fn probe_languages(path: &Path) -> Result<ProbedLanguages, String> {
    let binary = std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let output = tokio::time::timeout(
        PROBE_TIMEOUT,
        Command::new(&binary)
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=index,codec_type:stream_tags=language",
                "-of",
                "json",
                "-i",
            ])
            .arg(path)
            .output(),
    )
    .await
    .map_err(|_| "ffprobe language scan timed out".to_string())?
    .map_err(|error| format!("could not start {binary}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffprobe language scan failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    parse_probe_languages(&output.stdout)
}

/// Canonical languages of the sidecar subtitle files next to `media_path`.
pub(crate) async fn sidecar_languages(media_path: &Path) -> Vec<String> {
    let tracks = crate::sidecar_subtitles::discover_sidecar_subtitles(media_path).await;
    sorted_unique(
        tracks
            .iter()
            .filter_map(|track| track.language.as_deref().and_then(normalize_known_language))
            .collect(),
    )
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn probe_one(repo: &dyn MediaLanguageRepo, id: Uuid, stored_path: &Path) {
    let path = playarr_model::resolve_media_path(stored_path);
    match probe_languages(&path).await {
        Ok(found) => {
            if let Err(error) = repo
                .replace(
                    id,
                    SOURCE_PROBE,
                    Some(&found.audio),
                    Some(&found.subtitles),
                    now_ms(),
                )
                .await
            {
                tracing::warn!(media_file_id = %id, %error, "could not store probed languages");
            }
        }
        Err(error) => {
            // Recorded as scanned so one unreadable file is not retried on
            // every pass; a later `arr` sync or a state reset retries it.
            tracing::warn!(media_file_id = %id, %error, "language probe failed");
            let _ = repo
                .replace(id, SOURCE_PROBE, Some(&[]), Some(&[]), now_ms())
                .await;
        }
    }
}

async fn sidecar_one(repo: &dyn MediaLanguageRepo, id: Uuid, stored_path: &Path) {
    let path = playarr_model::resolve_media_path(stored_path);
    let langs = sidecar_languages(&path).await;
    if let Err(error) = repo
        .replace(id, SOURCE_SIDECAR, None, Some(&langs), now_ms())
        .await
    {
        tracing::warn!(media_file_id = %id, %error, "could not store sidecar languages");
    }
}

/// One indexing pass; returns how many files were processed.
pub async fn run_pass(repo: &Arc<dyn MediaLanguageRepo>) -> usize {
    let mut processed = 0;
    match repo.files_needing_probe(PROBE_BATCH).await {
        Ok(files) => {
            processed += files.len();
            futures::stream::iter(files)
                .for_each_concurrent(CONCURRENCY, |(id, path)| {
                    let repo = repo.clone();
                    async move { probe_one(repo.as_ref(), id, &path).await }
                })
                .await;
        }
        Err(error) => tracing::warn!(%error, "language probe queue query failed"),
    }
    let before = now_ms() - SIDECAR_RESCAN.as_millis() as i64;
    match repo.files_needing_sidecar_scan(before, SIDECAR_BATCH).await {
        Ok(files) => {
            processed += files.len();
            futures::stream::iter(files)
                .for_each_concurrent(CONCURRENCY, |(id, path)| {
                    let repo = repo.clone();
                    async move { sidecar_one(repo.as_ref(), id, &path).await }
                })
                .await;
        }
        Err(error) => tracing::warn!(%error, "sidecar scan queue query failed"),
    }
    processed
}

/// Runs passes forever: quickly while there is backlog, every ten minutes
/// when idle (new imports and changed sidecars are picked up then).
pub async fn run_language_indexer(repo: Arc<dyn MediaLanguageRepo>) {
    loop {
        let processed = run_pass(&repo).await;
        tokio::time::sleep(if processed == 0 {
            IDLE_SLEEP
        } else {
            BUSY_SLEEP
        })
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_audio_and_subtitle_languages_from_ffprobe_json() {
        let json = br#"{"streams":[
            {"index":0,"codec_type":"video"},
            {"index":1,"codec_type":"audio","tags":{"language":"jpn"}},
            {"index":2,"codec_type":"audio","tags":{"language":"eng"}},
            {"index":3,"codec_type":"audio","tags":{"language":"und"}},
            {"index":4,"codec_type":"audio"},
            {"index":5,"codec_type":"subtitle","tags":{"language":"eng"}},
            {"index":6,"codec_type":"subtitle","tags":{"language":"fre"}},
            {"index":7,"codec_type":"subtitle","tags":{"language":"eng"}}
        ]}"#;
        let found = parse_probe_languages(json).unwrap();
        assert_eq!(found.audio, vec!["en", "ja"]);
        assert_eq!(found.subtitles, vec!["en", "fr"]);
    }

    #[test]
    fn empty_or_untagged_streams_yield_nothing() {
        assert_eq!(
            parse_probe_languages(br#"{"streams":[]}"#).unwrap(),
            ProbedLanguages::default()
        );
        assert!(parse_probe_languages(b"nope").is_err());
    }

    #[tokio::test]
    async fn sidecar_languages_are_normalised_and_deduplicated() {
        let dir = tempfile::tempdir().unwrap();
        let video = dir.path().join("Movie.mkv");
        for name in [
            "Movie.mkv",
            "Movie.en.srt",
            "Movie.eng.forced.srt",
            "Movie.fr.srt",
            "Movie.srt",
            "Other.de.srt",
        ] {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        assert_eq!(sidecar_languages(&video).await, vec!["en", "fr"]);
    }
}
