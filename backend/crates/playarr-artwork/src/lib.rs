//! Shared "download one piece of source artwork and atomically commit it
//! to Playarr Server's own local disk cache" logic -- the one implementation
//! both `playarr-api::artwork`'s on-demand route (`GET /api/v1/artwork/
//! work/{id}/{kind}`, cache-fill-on-miss) and `playarr-arr-sync`'s
//! proactive post-sync prewarm job (see that crate's `artwork_prewarm`
//! module) call into, so cache layout/hashing/content-type handling can
//! never drift between the two call sites.
//!
//! Named client-facing looks (TV stage greyscale key-art, etc.) live in
//! [`style`] and are materialised as derivatives next to the raw cache
//! entry so every platform reuses one bake rather than re-filtering.
//!
//! Deliberately crate-local and framework-free: no `axum`/`ApiError`
//! dependency here (that would make `playarr-arr-sync` -- which must
//! never depend on `playarr-api`, the reverse of this workspace's real
//! dependency direction -- unable to use it). Callers map
//! [`ArtworkCacheError`] into their own error type.

mod style;

pub use style::{apply_artwork_style, ArtworkStyle, ArtworkStyleError};

use std::path::{Path as FsPath, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use dashmap::DashMap;
use playarr_model::{ImageKind, Sensitive, SourceKind};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use uuid::Uuid;

const MAX_ARTWORK_BYTES: u64 = 12 * 1024 * 1024;
const ARR_ARTWORK_SCHEME: &str = "playarr-arr";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArrArtworkLocator {
    pub source_instance_id: Uuid,
    pub path_and_query: String,
}

/// Encodes an *arr-local `/MediaCover/...` path without exposing that
/// instance's host or API key to catalogue clients. The API resolves this
/// opaque locator against the registered source instance before fetching it.
pub fn arr_artwork_locator(source_instance_id: Uuid, local_path: &str) -> Option<String> {
    if !local_path.starts_with("/MediaCover/") {
        return None;
    }
    let base =
        reqwest::Url::parse(&format!("{ARR_ARTWORK_SCHEME}://{source_instance_id}/")).ok()?;
    let locator = base.join(local_path).ok()?;
    parse_arr_artwork_locator(locator.as_str())?;
    Some(locator.to_string())
}

/// Parses the safe internal form produced by [`arr_artwork_locator`].
/// Arbitrary *arr API paths are rejected: only media-cover reads qualify.
pub fn parse_arr_artwork_locator(raw: &str) -> Option<ArrArtworkLocator> {
    let locator = reqwest::Url::parse(raw).ok()?;
    if locator.scheme() != ARR_ARTWORK_SCHEME
        || !locator.path().starts_with("/MediaCover/")
        || !locator.username().is_empty()
        || locator.password().is_some()
        || locator.port().is_some()
    {
        return None;
    }
    let source_instance_id = locator.host_str()?.parse().ok()?;
    let mut path_and_query = locator.path().to_string();
    if let Some(query) = locator.query() {
        path_and_query.push('?');
        path_and_query.push_str(query);
    }
    Some(ArrArtworkLocator {
        source_instance_id,
        path_and_query,
    })
}

/// Resolves a validated opaque locator against its configured *arr base URL.
pub fn resolve_arr_artwork_url(
    base_url: &str,
    source_kind: SourceKind,
    locator: &ArrArtworkLocator,
) -> Option<reqwest::Url> {
    let base = reqwest::Url::parse(base_url).ok()?;
    if !matches!(base.scheme(), "http" | "https") || base.host_str().is_none() {
        return None;
    }
    let resolved = match source_kind {
        SourceKind::Lidarr => {
            let path = locator.path_and_query.split('?').next()?;
            let segments = path
                .strip_prefix("/MediaCover/")?
                .split('/')
                .collect::<Vec<_>>();
            let endpoint = match segments.as_slice() {
                [artist_id, filename] if artist_id.parse::<u64>().is_ok() => {
                    format!("api/v1/mediacover/artist/{artist_id}/{filename}")
                }
                ["Albums", album_id, filename] if album_id.parse::<u64>().is_ok() => {
                    format!("api/v1/mediacover/album/{album_id}/{filename}")
                }
                _ => return None,
            };
            let base_with_slash = format!("{}/", base_url.trim_end_matches('/'));
            reqwest::Url::parse(&base_with_slash)
                .ok()?
                .join(&endpoint)
                .ok()?
        }
        _ => base.join(&locator.path_and_query).ok()?,
    };
    if !matches!(resolved.scheme(), "http" | "https") || resolved.host_str().is_none() {
        return None;
    }
    Some(resolved)
}

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
    #[error("could not apply artwork style: {0}")]
    Style(#[from] ArtworkStyleError),
}

pub struct CachedArtwork {
    pub path: PathBuf,
    pub content_type: &'static str,
    /// A stable-per-URL hash of the *source* URL, folded into the cache
    /// filename -- callers that build an HTTP `ETag` (see
    /// `playarr-api::artwork::artwork_response`) use this plus the file
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

fn same_origin(left: &reqwest::Url, right: &reqwest::Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

/// Resolves and (on first use) creates the local artwork cache root --
/// `PLAYARR_ARTWORK_CACHE_DIR` if set, else co-located with the SQLite
/// database file (`.../cache/artwork`), else a `/tmp` fallback for
/// Postgres/multi-node deployments that haven't set the env var.
pub fn artwork_cache_root() -> PathBuf {
    if let Some(root) = std::env::var_os("PLAYARR_ARTWORK_CACHE_DIR") {
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
    std::env::temp_dir().join("playarr-artwork")
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
    // Keep the raw file and any style derivatives that share its hash stem
    // (e.g. `backdrop-abc.stage.png` next to `backdrop-abc.jpg`).
    let keep_stem = keep
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        // `backdrop-HASH.stage` → `backdrop-HASH` when extension-style naming
        // uses `.stage.png` via with_extension("stage.png") on some platforms.
        .trim_end_matches(".stage")
        .to_string();
    let mut entries = tokio::fs::read_dir(directory)
        .await
        .map_err(|error| ArtworkCacheError::Io(format!("could not scan artwork cache: {error}")))?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| ArtworkCacheError::Io(format!("could not scan artwork cache: {error}")))?
    {
        let path = entry.path();
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.starts_with(&prefix) || path == keep {
            continue;
        }
        if !keep_stem.is_empty() && name.starts_with(&keep_stem) {
            continue;
        }
        let _ = tokio::fs::remove_file(path).await;
    }
    Ok(())
}

fn styled_cache_path(raw: &FsPath, style: ArtworkStyle) -> Option<PathBuf> {
    let segment = style.cache_segment()?;
    let stem = raw.file_stem()?.to_str()?;
    let parent = raw.parent()?;
    Some(parent.join(format!("{stem}.{segment}.png")))
}

/// A trivial per-process `ArtworkCache::new()`-shareable HTTP client +
/// in-flight-download dedup map. Kept as an instance (not free functions
/// over process-global statics like the pre-extraction code used) so
/// `playarr-arr-sync` and `playarr-api` can each hold their own `Arc`
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
                .user_agent("Playarr Server/0.1 artwork-cache")
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
        api_key: Option<&Sensitive<String>>,
    ) -> Result<(PathBuf, &'static str), ArtworkCacheError> {
        let mut request_url = url.clone();
        let mut redirects = 0_u8;
        let response = loop {
            let mut request = self.http.get(request_url.clone());
            if let Some(api_key) = api_key {
                request = request.header("X-Api-Key", api_key.expose_secret());
            }
            let response = request
                .send()
                .await
                .map_err(|error| ArtworkCacheError::Unreachable(error.to_string()))?;
            if !response.status().is_redirection() {
                break response;
            }
            // Public metadata URLs retain the strict no-redirect policy.
            // A configured *arr instance may redirect its own MediaCover
            // endpoint, but the API key must never cross an origin boundary.
            if api_key.is_none() {
                return Err(ArtworkCacheError::SourceError(response.status()));
            }
            if redirects >= 3 {
                return Err(ArtworkCacheError::Unreachable(
                    "source artwork exceeded the redirect limit".to_string(),
                ));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    ArtworkCacheError::InvalidUrl(
                        "source artwork redirect omitted its destination".to_string(),
                    )
                })?;
            let next = request_url.join(location).map_err(|_| {
                ArtworkCacheError::InvalidUrl(
                    "source artwork redirect destination is invalid".to_string(),
                )
            })?;
            if !same_origin(url, &next) {
                return Err(ArtworkCacheError::InvalidUrl(
                    "source artwork redirect crossed the configured source origin".to_string(),
                ));
            }
            request_url = next;
            redirects += 1;
        };
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
        self.ensure_cached_inner(work_id, kind, url.as_str(), url, None)
            .await
    }

    /// Authenticated counterpart to [`Self::ensure_cached`] for an artwork
    /// path owned by a configured *arr instance. `source_key` is the opaque
    /// locator stored in catalogue metadata, so credentials never influence
    /// cache names or leave the backend.
    pub async fn ensure_cached_with_api_key(
        &self,
        work_id: Uuid,
        kind: ImageKind,
        source_key: &str,
        url: &reqwest::Url,
        api_key: &Sensitive<String>,
    ) -> Result<CachedArtwork, ArtworkCacheError> {
        self.ensure_cached_inner(work_id, kind, source_key, url, Some(api_key))
            .await
    }

    async fn ensure_cached_inner(
        &self,
        work_id: Uuid,
        kind: ImageKind,
        source_key: &str,
        url: &reqwest::Url,
        api_key: Option<&Sensitive<String>>,
    ) -> Result<CachedArtwork, ArtworkCacheError> {
        let url_hash = stable_url_hash(source_key);
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

        let result = self
            .download_and_cache(work_id, kind, url, &prefix, api_key)
            .await;
        self.fill_locks.remove(&lock_key);
        let (path, content_type) = result?;
        Ok(CachedArtwork {
            path,
            content_type,
            url_hash,
        })
    }

    /// Ensure the raw cache entry exists, then return a named style
    /// derivative (materialised next to the raw file and reused on later
    /// hits). `ArtworkStyle::Original` returns the raw entry unchanged.
    pub async fn ensure_styled(
        &self,
        work_id: Uuid,
        kind: ImageKind,
        url: &reqwest::Url,
        style: ArtworkStyle,
    ) -> Result<CachedArtwork, ArtworkCacheError> {
        let raw = self.ensure_cached(work_id, kind, url).await?;
        self.materialise_style(raw, style).await
    }

    /// Authenticated counterpart to [`Self::ensure_styled`].
    pub async fn ensure_styled_with_api_key(
        &self,
        work_id: Uuid,
        kind: ImageKind,
        source_key: &str,
        url: &reqwest::Url,
        api_key: &Sensitive<String>,
        style: ArtworkStyle,
    ) -> Result<CachedArtwork, ArtworkCacheError> {
        let raw = self
            .ensure_cached_with_api_key(work_id, kind, source_key, url, api_key)
            .await?;
        self.materialise_style(raw, style).await
    }

    async fn materialise_style(
        &self,
        raw: CachedArtwork,
        style: ArtworkStyle,
    ) -> Result<CachedArtwork, ArtworkCacheError> {
        if style == ArtworkStyle::Original {
            return Ok(raw);
        }
        let Some(styled_path) = styled_cache_path(&raw.path, style) else {
            return Ok(raw);
        };
        if tokio::fs::try_exists(&styled_path).await.unwrap_or(false) {
            return Ok(CachedArtwork {
                path: styled_path,
                content_type: style.output_content_type().unwrap_or(raw.content_type),
                url_hash: raw.url_hash,
            });
        }

        let lock_key = styled_path.to_string_lossy().into_owned();
        let lock = {
            let entry = self
                .fill_locks
                .entry(lock_key.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())));
            entry.value().clone()
        };
        let _guard = lock.lock().await;
        if tokio::fs::try_exists(&styled_path).await.unwrap_or(false) {
            self.fill_locks.remove(&lock_key);
            return Ok(CachedArtwork {
                path: styled_path,
                content_type: style.output_content_type().unwrap_or(raw.content_type),
                url_hash: raw.url_hash,
            });
        }

        let source = tokio::fs::read(&raw.path).await.map_err(|error| {
            ArtworkCacheError::Io(format!("could not read cached artwork: {error}"))
        })?;
        let style_for_task = style;
        let (bytes, content_type) =
            tokio::task::spawn_blocking(move || apply_artwork_style(&source, style_for_task))
                .await
                .map_err(|error| {
                    ArtworkCacheError::Io(format!("style worker join failed: {error}"))
                })??;

        let directory = styled_path.parent().ok_or_else(|| {
            ArtworkCacheError::Io("styled artwork path has no parent directory".into())
        })?;
        let temp_path = directory.join(format!("style-{}-{}.tmp", style.as_str(), Uuid::new_v4()));
        {
            let mut file = tokio::fs::File::create(&temp_path).await.map_err(|error| {
                ArtworkCacheError::Io(format!("could not create styled artwork file: {error}"))
            })?;
            file.write_all(&bytes).await.map_err(|error| {
                ArtworkCacheError::Io(format!("could not write styled artwork: {error}"))
            })?;
            file.flush().await.map_err(|error| {
                ArtworkCacheError::Io(format!("could not flush styled artwork: {error}"))
            })?;
        }
        match tokio::fs::rename(&temp_path, &styled_path).await {
            Ok(()) => {}
            Err(_error) if tokio::fs::try_exists(&styled_path).await.unwrap_or(false) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
            }
            Err(error) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(ArtworkCacheError::Io(format!(
                    "could not commit styled artwork: {error}"
                )));
            }
        }
        self.fill_locks.remove(&lock_key);
        Ok(CachedArtwork {
            path: styled_path,
            content_type,
            url_hash: raw.url_hash,
        })
    }

    /// `true` if every image kind attached to `images` is already cached
    /// locally -- lets `playarr-arr-sync`'s prewarm job skip a work
    /// entirely (no HTTP calls at all) when a previous pass already
    /// warmed it and none of its image URLs changed since. Not used by
    /// the on-demand route, which always wants the freshest single kind.
    pub async fn all_cached(&self, work_id: Uuid, images: &[playarr_model::ImageAsset]) -> bool {
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

/// Process-wide singleton -- both `playarr-api::artwork` and
/// `playarr-arr-sync`'s prewarm job share one instance (one HTTP
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

    #[test]
    fn arr_artwork_locators_accept_only_media_cover_paths() {
        let source_instance_id = Uuid::new_v4();
        let raw = arr_artwork_locator(source_instance_id, "/MediaCover/7/fanart.jpg?lastWrite=123")
            .unwrap();
        let parsed = parse_arr_artwork_locator(&raw).unwrap();
        assert_eq!(parsed.source_instance_id, source_instance_id);
        assert_eq!(
            parsed.path_and_query,
            "/MediaCover/7/fanart.jpg?lastWrite=123"
        );
        assert!(arr_artwork_locator(source_instance_id, "/api/v1/system/status").is_none());
        assert!(parse_arr_artwork_locator("file:///etc/passwd").is_none());
        assert_eq!(
            resolve_arr_artwork_url("https://lidarr.example", SourceKind::Lidarr, &parsed)
                .unwrap()
                .as_str(),
            "https://lidarr.example/api/v1/mediacover/artist/7/fanart.jpg"
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
            std::env::temp_dir().join(format!("playarr-artwork-test-{}", Uuid::new_v4()));
        // SAFETY (test-only): no other thread in this test process reads
        // this env var concurrently.
        unsafe {
            std::env::set_var("PLAYARR_ARTWORK_CACHE_DIR", &temp_dir);
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
            std::env::remove_var("PLAYARR_ARTWORK_CACHE_DIR");
        }
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn authenticated_artwork_rejects_cross_origin_redirects() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/banner.jpg"))
            .respond_with(
                wiremock::ResponseTemplate::new(302)
                    .insert_header("location", "https://untrusted.example/banner.jpg"),
            )
            .mount(&server)
            .await;

        let cache = ArtworkCache::new();
        let url = reqwest::Url::parse(&format!("{}/banner.jpg", server.uri())).unwrap();
        let result = cache
            .ensure_cached_with_api_key(
                Uuid::new_v4(),
                ImageKind::Banner,
                "playarr-arr://source/banner.jpg",
                &url,
                &Sensitive::new("test-key".to_string()),
            )
            .await;

        assert!(matches!(result, Err(ArtworkCacheError::InvalidUrl(_))));
    }
}
