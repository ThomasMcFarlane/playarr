//! Shared "download one piece of source artwork and atomically commit it
//! to Streamarr's own local disk cache" logic -- the one implementation
//! both `streamarr-api::artwork`'s on-demand route (`GET /api/v1/artwork/
//! work/{id}/{kind}`, cache-fill-on-miss) and `streamarr-arr-sync`'s
//! proactive post-sync prewarm job (see that crate's `artwork_prewarm`
//! module) call into, so cache layout/hashing/content-type handling can
//! never drift between the two call sites.
//!
//! Deliberately crate-local and framework-free: no `axum`/`ApiError`
//! dependency here (that would make `streamarr-arr-sync` -- which must
//! never depend on `streamarr-api`, the reverse of this workspace's real
//! dependency direction -- unable to use it). Callers map
//! [`ArtworkCacheError`] into their own error type.

use std::path::{Path as FsPath, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use dashmap::DashMap;
use streamarr_model::ImageKind;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use uuid::Uuid;

const MAX_ARTWORK_BYTES: u64 = 12 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ArtworkCacheError {
    #[error("stored artwork URL is invalid: {0}")]
    InvalidUrl(String),
    #[error("could not download source artwork: {0}")]
    Unreachable(String),
    #[error("source artwork returned HTTP {0}")]
    SourceError(reqwest::StatusCode),
    #[error("source artwork exceeds the 12 MiB cache limit")]
    TooLarge,
    #[error("source artwork returned unsupported content type {0:?}")]
    InvalidContentType(String),
    #[error("source artwork returned an empty body")]
    Empty,
    #[error("artwork cache I/O error: {0}")]
    Io(String),
}

pub struct CachedArtwork {
    pub path: PathBuf,
    pub content_type: &'static str,
    /// A stable-per-URL hash of the *source* URL, folded into the cache
    /// filename -- callers that build an HTTP `ETag` (see
    /// `streamarr-api::artwork::artwork_response`) use this plus the file
    /// size as that value.
    pub url_hash: u64,
}

pub fn image_kind_segment(kind: ImageKind) -> &'static str {
    match kind {
        ImageKind::Poster => "poster",
        ImageKind::Backdrop => "backdrop",
        ImageKind::Banner => "banner",
        ImageKind::Logo => "logo",
        ImageKind::Thumb => "thumb",
    }
}

pub fn stable_url_hash(url: &str) -> u64 {
    // A stable FNV-1a key makes a changed upstream URL select a fresh
    // cache file without pulling a cryptographic dependency in here.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in url.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn content_type_extension(content_type: &str) -> Option<&'static str> {
    match content_type
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/avif" => Some("avif"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn extension_content_type(extension: &str) -> Option<&'static str> {
    match extension {
        "jpg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

/// Resolves and (on first use) creates the local artwork cache root --
/// `STREAMARR_ARTWORK_CACHE_DIR` if set, else co-located with the SQLite
/// database file (`.../cache/artwork`), else a `/tmp` fallback for
/// Postgres/multi-node deployments that haven't set the env var.
pub fn artwork_cache_root() -> PathBuf {
    if let Some(root) = std::env::var_os("STREAMARR_ARTWORK_CACHE_DIR") {
        return PathBuf::from(root);
    }
    if let Ok(database_url) = std::env::var("DATABASE_URL") {
        if let Some(path) = database_url.strip_prefix("sqlite://") {
            let path = path.split('?').next().unwrap_or(path);
            if let Some(parent) = FsPath::new(path).parent() {
                return parent.join("cache").join("artwork");
            }
        }
    }
    std::env::temp_dir().join("streamarr-artwork")
}

fn cache_prefix(work_id: Uuid, kind: ImageKind, url_hash: u64) -> PathBuf {
    artwork_cache_root()
        .join(work_id.to_string())
        .join(format!("{}-{url_hash:016x}", image_kind_segment(kind)))
}

async fn cached_file(prefix: &FsPath) -> Option<(PathBuf, &'static str)> {
    for extension in ["jpg", "png", "webp", "avif", "gif"] {
        let path = prefix.with_extension(extension);
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            return Some((path, extension_content_type(extension)?));
        }
    }
    None
}

async fn remove_stale_kind_files(
    directory: &FsPath,
    kind: ImageKind,
    keep: &FsPath,
) -> Result<(), ArtworkCacheError> {
    let prefix = format!("{}-", image_kind_segment(kind));
    let mut entries = tokio::fs::read_dir(directory)
        .await
        .map_err(|error| ArtworkCacheError::Io(format!("could not scan artwork cache: {error}")))?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| ArtworkCacheError::Io(format!("could not scan artwork cache: {error}")))?
    {
        let path = entry.path();
        let matches_kind = entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(&prefix));
        if matches_kind && path != keep {
            let _ = tokio::fs::remove_file(path).await;
        }
    }
    Ok(())
}

/// A trivial per-process `ArtworkCache::new()`-shareable HTTP client +
/// in-flight-download dedup map. Kept as an instance (not free functions
/// over process-global statics like the pre-extraction code used) so
/// `streamarr-arr-sync` and `streamarr-api` can each hold their own `Arc`
/// without one importing the other's statics.
pub struct ArtworkCache {
    http: reqwest::Client,
    fill_locks: DashMap<String, Arc<Mutex<()>>>,
}

impl Default for ArtworkCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ArtworkCache {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(15))
                // Source artwork is already a final metadata-provider URL.
                // Refusing redirects prevents a trusted public URL from
                // redirecting this server into a private-network request.
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("Streamarr/0.1 artwork-cache")
                .build()
                .expect("static artwork HTTP client configuration is valid"),
            fill_locks: DashMap::new(),
        }
    }

    async fn download_and_cache(
        &self,
        work_id: Uuid,
        kind: ImageKind,
        url: &reqwest::Url,
        prefix: &FsPath,
    ) -> Result<(PathBuf, &'static str), ArtworkCacheError> {
        let response = self
            .http
            .get(url.clone())
            .send()
            .await
            .map_err(|error| ArtworkCacheError::Unreachable(error.to_string()))?;
        if !response.status().is_success() {
            return Err(ArtworkCacheError::SourceError(response.status()));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_ARTWORK_BYTES)
        {
            return Err(ArtworkCacheError::TooLarge);
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let extension = content_type_extension(&content_type)
            .ok_or_else(|| ArtworkCacheError::InvalidContentType(content_type.clone()))?;
        let output_path = prefix.with_extension(extension);
        let directory = output_path.parent().ok_or_else(|| {
            ArtworkCacheError::Io("artwork cache path has no parent directory".to_string())
        })?;
        tokio::fs::create_dir_all(directory)
            .await
            .map_err(|error| {
                ArtworkCacheError::Io(format!("could not create artwork cache: {error}"))
            })?;

        let temp_path = directory.join(format!(
            "{}-{}-{}.tmp",
            image_kind_segment(kind),
            work_id,
            Uuid::new_v4()
        ));
        let mut file = tokio::fs::File::create(&temp_path).await.map_err(|error| {
            ArtworkCacheError::Io(format!("could not create artwork cache file: {error}"))
        })?;
        let mut response = response;
        let mut written = 0_u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| ArtworkCacheError::Unreachable(error.to_string()))?
        {
            written = written.saturating_add(chunk.len() as u64);
            if written > MAX_ARTWORK_BYTES {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(ArtworkCacheError::TooLarge);
            }
            file.write_all(&chunk).await.map_err(|error| {
                ArtworkCacheError::Io(format!("could not write artwork cache: {error}"))
            })?;
        }
        file.flush().await.map_err(|error| {
            ArtworkCacheError::Io(format!("could not flush artwork cache: {error}"))
        })?;
        drop(file);

        if written == 0 {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(ArtworkCacheError::Empty);
        }

        match tokio::fs::rename(&temp_path, &output_path).await {
            Ok(()) => {}
            Err(_error) if tokio::fs::try_exists(&output_path).await.unwrap_or(false) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
            }
            Err(error) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(ArtworkCacheError::Io(format!(
                    "could not commit cached artwork: {error}"
                )));
            }
        }
        remove_stale_kind_files(directory, kind, &output_path).await?;
        Ok((output_path, extension_content_type(extension).unwrap()))
    }

    /// Returns the already-cached file for `(work_id, kind, url)` if one
    /// exists, else downloads and atomically commits it first. Concurrent
    /// callers for the exact same `(work_id, kind, url)` are deduped via
    /// an in-process per-key lock (a request-triggered fill racing this
    /// same key from a proactive prewarm pass, or two prewarm passes
    /// overlapping, do one download, not two).
    pub async fn ensure_cached(
        &self,
        work_id: Uuid,
        kind: ImageKind,
        url: &reqwest::Url,
    ) -> Result<CachedArtwork, ArtworkCacheError> {
        let url_hash = stable_url_hash(url.as_str());
        let prefix = cache_prefix(work_id, kind, url_hash);
        if let Some((path, content_type)) = cached_file(&prefix).await {
            return Ok(CachedArtwork {
                path,
                content_type,
                url_hash,
            });
        }

        let lock_key = prefix.to_string_lossy().into_owned();
        let lock = {
            let entry = self
                .fill_locks
                .entry(lock_key.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())));
            entry.value().clone()
        };
        let _guard = lock.lock().await;
        if let Some((path, content_type)) = cached_file(&prefix).await {
            self.fill_locks.remove(&lock_key);
            return Ok(CachedArtwork {
                path,
                content_type,
                url_hash,
            });
        }

        let result = self.download_and_cache(work_id, kind, url, &prefix).await;
        self.fill_locks.remove(&lock_key);
        let (path, content_type) = result?;
        Ok(CachedArtwork {
            path,
            content_type,
            url_hash,
        })
    }

    /// `true` if every image kind attached to `images` is already cached
    /// locally -- lets `streamarr-arr-sync`'s prewarm job skip a work
    /// entirely (no HTTP calls at all) when a previous pass already
    /// warmed it and none of its image URLs changed since. Not used by
    /// the on-demand route, which always wants the freshest single kind.
    pub async fn all_cached(&self, work_id: Uuid, images: &[streamarr_model::ImageAsset]) -> bool {
        for image in images {
            let Ok(url) = reqwest::Url::parse(&image.url) else {
                continue;
            };
            let url_hash = stable_url_hash(url.as_str());
            let prefix = cache_prefix(work_id, image.kind, url_hash);
            if cached_file(&prefix).await.is_none() {
                return false;
            }
        }
        true
    }
}

/// Process-wide singleton -- both `streamarr-api::artwork` and
/// `streamarr-arr-sync`'s prewarm job share one instance (one HTTP
/// client, one in-flight-download dedup map) via this, rather than each
/// constructing their own and losing the dedup guarantee across them.
static SHARED: OnceLock<Arc<ArtworkCache>> = OnceLock::new();

pub fn shared() -> Arc<ArtworkCache> {
    SHARED.get_or_init(|| Arc::new(ArtworkCache::new())).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_types_are_strictly_image_only() {
        assert_eq!(content_type_extension("image/jpeg"), Some("jpg"));
        assert_eq!(
            content_type_extension("image/webp; charset=binary"),
            Some("webp")
        );
        assert_eq!(content_type_extension("text/html"), None);
    }

    #[test]
    fn source_url_hash_is_stable_and_sensitive_to_changes() {
        assert_eq!(
            stable_url_hash("https://example.test/a.jpg"),
            stable_url_hash("https://example.test/a.jpg")
        );
        assert_ne!(
            stable_url_hash("https://example.test/a.jpg"),
            stable_url_hash("https://example.test/b.jpg")
        );
    }

    #[tokio::test]
    async fn ensure_cached_downloads_and_atomically_commits() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/poster.jpg"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_bytes(vec![0xFF, 0xD8, 0xFF, 0xD9])
                    .insert_header("content-type", "image/jpeg"),
            )
            .mount(&server)
            .await;

        let temp_dir =
            std::env::temp_dir().join(format!("streamarr-artwork-test-{}", Uuid::new_v4()));
        // SAFETY (test-only): no other thread in this test process reads
        // this env var concurrently.
        unsafe {
            std::env::set_var("STREAMARR_ARTWORK_CACHE_DIR", &temp_dir);
        }

        let cache = ArtworkCache::new();
        let work_id = Uuid::new_v4();
        let url = reqwest::Url::parse(&format!("{}/poster.jpg", server.uri())).unwrap();
        let cached = cache
            .ensure_cached(work_id, ImageKind::Poster, &url)
            .await
            .expect("ensure_cached should succeed");
        assert!(tokio::fs::try_exists(&cached.path).await.unwrap());
        assert_eq!(cached.content_type, "image/jpeg");

        // SAFETY (test-only): see above.
        unsafe {
            std::env::remove_var("STREAMARR_ARTWORK_CACHE_DIR");
        }
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }
}
