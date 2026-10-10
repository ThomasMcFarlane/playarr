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
use playarr_db::repo::{LanguageUpdate, SOURCE_PROBE, SOURCE_SIDECAR};
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

/// What probing one file found, ready to store (see [`probe_one`]).
async fn probe_one(id: Uuid, stored_path: &Path) -> LanguageUpdate {
    let path = playarr_model::resolve_media_path(stored_path);
    match probe_languages(&path).await {
        Ok(found) => LanguageUpdate {
            media_file_id: id,
            source: SOURCE_PROBE.to_string(),
            audio: Some(found.audio),
            subtitles: Some(found.subtitles),
            scanned_ms: now_ms(),
        },
        Err(error) => {
            // Recorded as scanned so one unreadable file is not retried on
            // every pass; a later `arr` sync or a state reset retries it.
            tracing::warn!(media_file_id = %id, %error, "language probe failed");
            LanguageUpdate {
                media_file_id: id,
                source: SOURCE_PROBE.to_string(),
                audio: Some(Vec::new()),
                subtitles: Some(Vec::new()),
                scanned_ms: now_ms(),
            }
        }
    }
}

async fn sidecar_one(id: Uuid, stored_path: &Path) -> LanguageUpdate {
    let path = playarr_model::resolve_media_path(stored_path);
    LanguageUpdate {
        media_file_id: id,
        source: SOURCE_SIDECAR.to_string(),
        audio: None,
        subtitles: Some(sidecar_languages(&path).await),
        scanned_ms: now_ms(),
    }
}

/// Stores a pass's results in one batch rather than a transaction per file.
async fn store(repo: &Arc<dyn MediaLanguageRepo>, updates: Vec<LanguageUpdate>, what: &str) {
    if updates.is_empty() {
        return;
    }
    if let Err(error) = repo.replace_many(&updates).await {
        tracing::warn!(%error, files = updates.len(), "could not store {what} languages");
    }
}

/// One indexing pass; returns how many files were processed.
pub async fn run_pass(repo: &Arc<dyn MediaLanguageRepo>) -> usize {
    let mut processed = 0;
    match repo.files_needing_probe(PROBE_BATCH).await {
        Ok(files) => {
            processed += files.len();
            let updates: Vec<LanguageUpdate> = futures::stream::iter(files)
                .map(|(id, path)| async move { probe_one(id, &path).await })
                .buffer_unordered(CONCURRENCY)
                .collect()
                .await;
            store(repo, updates, "probed").await;
        }
        Err(error) => tracing::warn!(%error, "language probe queue query failed"),
    }
    let before = now_ms() - SIDECAR_RESCAN.as_millis() as i64;
    match repo.files_needing_sidecar_scan(before, SIDECAR_BATCH).await {
        Ok(files) => {
            processed += files.len();
            let updates: Vec<LanguageUpdate> = futures::stream::iter(files)
                .map(|(id, path)| async move { sidecar_one(id, &path).await })
                .buffer_unordered(CONCURRENCY)
                .collect()
                .await;
            store(repo, updates, "sidecar").await;
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

    /// Row 9952: a pass stores everything it found with one batched call (and
    /// so one write) instead of one transaction per file.
    #[tokio::test]
    async fn a_pass_stores_its_results_in_one_batch() {
        use std::collections::HashMap;
        use std::path::PathBuf;
        use std::sync::Mutex;

        use async_trait::async_trait;
        use playarr_db::repo::FileLanguages;

        #[derive(Default)]
        struct Fake {
            probe: Vec<(Uuid, PathBuf)>,
            sidecar: Vec<(Uuid, PathBuf)>,
            batches: Mutex<Vec<Vec<LanguageUpdate>>>,
            singles: Mutex<usize>,
        }
        #[async_trait]
        impl MediaLanguageRepo for Fake {
            async fn replace(
                &self,
                _: Uuid,
                _: &str,
                _: Option<&[String]>,
                _: Option<&[String]>,
                _: i64,
            ) -> Result<(), playarr_db::DbError> {
                *self.singles.lock().unwrap() += 1;
                Ok(())
            }
            async fn replace_many(
                &self,
                updates: &[LanguageUpdate],
            ) -> Result<(), playarr_db::DbError> {
                self.batches.lock().unwrap().push(updates.to_vec());
                Ok(())
            }
            async fn languages_for_file(
                &self,
                _: Uuid,
            ) -> Result<FileLanguages, playarr_db::DbError> {
                Ok(FileLanguages::default())
            }
            async fn has_state(&self, _: Uuid, _: &str) -> Result<bool, playarr_db::DbError> {
                Ok(false)
            }
            async fn list_work_languages(
                &self,
                _: &str,
            ) -> Result<Vec<(Uuid, String)>, playarr_db::DbError> {
                Ok(vec![])
            }
            async fn list_work_language_file_counts(
                &self,
                _: &str,
            ) -> Result<(HashMap<Uuid, i64>, HashMap<(Uuid, String), i64>), playarr_db::DbError>
            {
                Ok(Default::default())
            }
            async fn files_needing_probe(
                &self,
                _: i64,
            ) -> Result<Vec<(Uuid, PathBuf)>, playarr_db::DbError> {
                Ok(self.probe.clone())
            }
            async fn files_needing_sidecar_scan(
                &self,
                _: i64,
                _: i64,
            ) -> Result<Vec<(Uuid, PathBuf)>, playarr_db::DbError> {
                Ok(self.sidecar.clone())
            }
        }

        let dir = tempfile::tempdir().unwrap();
        let files = |n: usize| -> Vec<(Uuid, PathBuf)> {
            (0..n)
                .map(|i| (Uuid::new_v4(), dir.path().join(format!("File {i}.mkv"))))
                .collect()
        };
        let fake = Arc::new(Fake {
            sidecar: files(37),
            ..Default::default()
        });
        let repo: Arc<dyn MediaLanguageRepo> = fake.clone();
        assert_eq!(run_pass(&repo).await, 37);
        let batches = fake.batches.lock().unwrap();
        assert_eq!(
            batches.len(),
            1,
            "one call for the whole sidecar queue, none for the empty probe queue"
        );
        assert_eq!(batches[0].len(), 37);
        assert!(batches[0].iter().all(|u| u.source == SOURCE_SIDECAR
            && u.audio.is_none()
            && u.subtitles == Some(vec![])));
        assert_eq!(*fake.singles.lock().unwrap(), 0);
    }
}
