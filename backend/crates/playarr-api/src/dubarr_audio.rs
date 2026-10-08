//! Dubarr dub tracks as alternate audio.
//!
//! For a media file, every enabled [`SourceKind::Dubarr`] instance is asked
//! for the dub tracks that belong to it (matched by file path; Dubarr applies
//! its own path mappings). Each track is offered next to the source-container
//! audio streams with a synthetic `stream_index` derived from the track id, so
//! it is stable and never collides with a real container stream. Selecting a
//! dub forces an on-demand HLS transcode that maps the source video plus the
//! dub file as audio (see `playarr_transcode::ExternalAudio`); the dub is
//! aligned to the original timeline by Dubarr, so no offset is applied.
//!
//! Everything here is best-effort: a Dubarr outage or slow response is logged
//! and playback continues with the source audio only.

use std::collections::HashMap;
use std::time::Duration;

use playarr_arr_client::{DubarrClient, DubarrTrack};
use playarr_model::{SourceInstance, SourceKind};
use uuid::Uuid;

use crate::source_cache::{Fetched, SwrCache};
use crate::SourceInstanceRegistry;

const CACHE_TTL: Duration = Duration::from_secs(60);
const STALE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long playback waits for an uncached lookup.
const MISS_DEADLINE: Duration = Duration::from_millis(1500);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const POLL_INTERVAL: Duration = Duration::from_secs(30);
const DUB_STREAM_INDEX_BASE: u32 = 10_000;
const DUB_STREAM_INDEX_SPAN: u32 = 1_000_000;

#[derive(Debug, Clone)]
pub(crate) struct DubTrack {
    pub instance: SourceInstance,
    pub track: DubarrTrack,
    pub stream_index: u32,
}

impl DubTrack {
    pub(crate) fn option_id(&self) -> String {
        format!("dubarr-{}", self.track.id)
    }

    pub(crate) fn client(&self) -> DubarrClient {
        DubarrClient::new(
            self.instance.base_url.clone(),
            self.instance.api_key_encrypted.expose_secret().clone(),
        )
    }
}

/// Fresh for a minute, then served stale (and refreshed in the background) for a day.
static CACHE: SwrCache<String, Vec<DubTrack>> = SwrCache::new(CACHE_TTL, STALE_TTL, 4096);

/// Drops every cached lookup (called when a Dubarr instance reports changes).
pub fn invalidate_cache() {
    CACHE.clear();
}

pub(crate) fn stable_index(track_id: &str) -> u32 {
    // FNV-1a, deterministic across processes.
    let mut hash: u32 = 0x811c_9dc5;
    for byte in track_id.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    DUB_STREAM_INDEX_BASE + hash % DUB_STREAM_INDEX_SPAN
}

/// Dub tracks for a media file, from all configured Dubarr instances.
///
/// Never waits on Dubarr for long: a cached answer (even a stale one) is
/// returned at once and refreshed in the background; with nothing cached, the
/// live lookup gets [`MISS_DEADLINE`] and playback carries on with the source
/// audio if Dubarr is slower (the lookup finishes in the background, so the
/// next playback of the file has the dubs).
pub(crate) async fn lookup(
    instances: &SourceInstanceRegistry,
    media_path: &str,
    resolved_path: &str,
) -> Vec<DubTrack> {
    lookup_with_deadline(instances, media_path, resolved_path, MISS_DEADLINE).await
}

async fn lookup_with_deadline(
    instances: &SourceInstanceRegistry,
    media_path: &str,
    resolved_path: &str,
    deadline: Duration,
) -> Vec<DubTrack> {
    let dubarrs: Vec<SourceInstance> = instances
        .all()
        .into_iter()
        .filter(|i| i.kind == SourceKind::Dubarr)
        .collect();
    if dubarrs.is_empty() {
        return Vec::new();
    }
    let media = media_path.to_string();
    let resolved = resolved_path.to_string();
    CACHE
        .get(media.clone(), deadline, move || {
            fetch_tracks(dubarrs, media, resolved)
        })
        .await
        .unwrap_or_default()
}

async fn fetch_tracks(
    dubarrs: Vec<SourceInstance>,
    media_path: String,
    resolved_path: String,
) -> Fetched<Vec<DubTrack>> {
    let mut out: Vec<DubTrack> = Vec::new();
    let mut failures = 0usize;
    let mut requests = 0usize;
    for instance in dubarrs {
        let client = DubarrClient::new(
            instance.base_url.clone(),
            instance.api_key_encrypted.expose_secret().clone(),
        );
        let mut paths = vec![media_path.as_str()];
        if resolved_path != media_path {
            paths.push(resolved_path.as_str());
        }
        for path in paths {
            requests += 1;
            match tokio::time::timeout(REQUEST_TIMEOUT, client.tracks_for_path(path)).await {
                Ok(Ok(tracks)) => {
                    for track in tracks {
                        if out.iter().any(|d| d.track.id == track.id) {
                            continue;
                        }
                        let stream_index = stable_index(&track.id);
                        out.push(DubTrack {
                            instance: instance.clone(),
                            track,
                            stream_index,
                        });
                    }
                }
                Ok(Err(error)) => {
                    failures += 1;
                    tracing::warn!(instance = %instance.name, error = %error, "dubarr track lookup failed")
                }
                Err(_) => {
                    failures += 1;
                    tracing::warn!(instance = %instance.name, "dubarr track lookup timed out")
                }
            }
        }
    }
    if requests > 0 && failures == requests {
        // Every request failed: keep whatever was cached and back off.
        return Fetched::Failed;
    }
    out.sort_by(|a, b| {
        (&a.track.language, &a.track.vendor).cmp(&(&b.track.language, &b.track.vendor))
    });
    Fetched::Ok(out)
}

/// Polls every Dubarr instance's change feed and clears the lookup cache when
/// anything was created, updated or deleted. Cursors live in memory, so the
/// first poll after a restart replays the feed once (a harmless invalidation).
pub async fn run_change_poller(instances: std::sync::Arc<SourceInstanceRegistry>) {
    let mut cursors: HashMap<Uuid, i64> = HashMap::new();
    loop {
        for instance in instances
            .all()
            .into_iter()
            .filter(|i| i.kind == SourceKind::Dubarr)
        {
            let client = DubarrClient::new(
                instance.base_url.clone(),
                instance.api_key_encrypted.expose_secret().clone(),
            );
            let since = cursors.get(&instance.id).copied().unwrap_or(0);
            match tokio::time::timeout(REQUEST_TIMEOUT, client.changes(since)).await {
                Ok(Ok(feed)) => {
                    if !feed.changes.is_empty() {
                        invalidate_cache();
                    }
                    cursors.insert(instance.id, feed.cursor);
                }
                Ok(Err(error)) => {
                    tracing::debug!(instance = %instance.name, error = %error, "dubarr change poll failed")
                }
                Err(_) => {
                    tracing::debug!(instance = %instance.name, "dubarr change poll timed out")
                }
            }
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use playarr_model::Sensitive;
    use serde_json::json;
    use std::collections::BTreeMap;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn instance(url: String) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind: SourceKind::Dubarr,
            name: "Dubarr".into(),
            base_url: url,
            api_key_encrypted: Sensitive::new("k".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: BTreeMap::new(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        }
    }

    #[test]
    fn stream_index_is_stable_and_above_container_range() {
        assert_eq!(stable_index("abc"), stable_index("abc"));
        assert!(stable_index("abc") >= DUB_STREAM_INDEX_BASE);
    }

    #[tokio::test]
    async fn lookup_finds_tracks_caches_and_survives_outage() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/tracks"))
            .and(query_param("path", "/movies/Cached/C.mkv"))
            .and(header("X-Api-Key", "k"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": "t-cache", "language": "th", "vendor": "elevenlabs", "codec": "aac", "channels": 2,
                "title": "TH dub (elevenlabs)", "downloadUrl": "/api/v1/tracks/t-cache/download"}])))
            .expect(1)
            .mount(&server)
            .await;
        let registry = SourceInstanceRegistry::new();
        registry.upsert(instance(server.uri()));
        let first = lookup(&registry, "/movies/Cached/C.mkv", "/movies/Cached/C.mkv").await;
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].option_id(), "dubarr-t-cache");
        // second call is served from the cache (mock expects exactly one request)
        let second = lookup(&registry, "/movies/Cached/C.mkv", "/movies/Cached/C.mkv").await;
        assert_eq!(second.len(), 1);

        // unreachable Dubarr: empty result, no panic
        let down = SourceInstanceRegistry::new();
        down.upsert(instance("http://127.0.0.1:1".into()));
        assert!(lookup(&down, "/movies/Other/O.mkv", "/movies/Other/O.mkv")
            .await
            .is_empty());
    }

    #[tokio::test]
    async fn slow_dubarr_never_holds_playback_and_fills_the_cache_afterwards() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/tracks"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_millis(700))
                    .set_body_json(json!([{
                    "id": "t-slow", "language": "en", "vendor": "v", "codec": "aac", "channels": 2,
                    "title": "EN dub", "downloadUrl": "/api/v1/tracks/t-slow/download"}])),
            )
            .mount(&server)
            .await;
        let registry = SourceInstanceRegistry::new();
        registry.upsert(instance(server.uri()));
        let started = std::time::Instant::now();
        let first = lookup_with_deadline(
            &registry,
            "/movies/Slow/S.mkv",
            "/movies/Slow/S.mkv",
            Duration::from_millis(100),
        )
        .await;
        assert!(first.is_empty());
        assert!(started.elapsed() < Duration::from_millis(500));
        tokio::time::sleep(Duration::from_millis(900)).await;
        let second = lookup_with_deadline(
            &registry,
            "/movies/Slow/S.mkv",
            "/movies/Slow/S.mkv",
            Duration::from_millis(100),
        )
        .await;
        assert_eq!(second.len(), 1);
    }
}
