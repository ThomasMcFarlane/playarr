//! Proactively warms Playarr Server's local artwork cache
//! ([`playarr_artwork::ArtworkCache`]) for every image on a `Work` right
//! after its catalog identity is reconciled, so the *first* real Playarr
//! viewer to browse a title already gets a cache hit instead of triggering
//! the download themselves (the on-demand route,
//! `playarr-api::artwork::work_artwork_handler`, still exists as a
//! fallback/backstop for anything this pass doesn't reach yet -- e.g. a
//! title synced before this feature existed).
//!
//! Deliberately Work-level only (poster/backdrop/banner/logo), not
//! per-episode thumbnails -- that's what Playarr's browse/library grids
//! render first and is the overwhelming majority of "why is this slow"
//! for a freshly-synced library; per-episode thumbnail prewarming can
//! follow the same pattern later if it turns out to matter.

use std::sync::Arc;

use playarr_artwork::ArtworkCache;
use playarr_model::{SourceInstance, Work};

#[derive(Clone)]
pub struct ArtworkPrewarm {
    cache: Arc<ArtworkCache>,
    source_instance: Option<SourceInstance>,
}

impl ArtworkPrewarm {
    pub fn new(cache: Arc<ArtworkCache>) -> Self {
        Self {
            cache,
            source_instance: None,
        }
    }

    /// Binds the prewarmer to the poller's source so opaque local artwork
    /// locators can be resolved and fetched with that instance's API key.
    pub fn with_source_instance(mut self, source_instance: SourceInstance) -> Self {
        self.source_instance = Some(source_instance);
        self
    }

    /// Best-effort: an image that fails to download (source unreachable,
    /// bad content type, etc) is logged and skipped, never propagated --
    /// the on-demand route gets another chance at it later, and one
    /// broken image must never block the rest of this work's images or
    /// this pass's other works. See [`crate::poller::ReconciliationPoller::
    /// prewarm_artwork`] for the per-work call site.
    pub async fn prewarm_work(&self, work: &Work) {
        if work.images.is_empty() {
            return;
        }
        if self.cache.all_cached(work.id, &work.images).await {
            return;
        }
        for image in &work.images {
            if let Some(locator) = playarr_artwork::parse_arr_artwork_locator(&image.url) {
                let Some(instance) = self
                    .source_instance
                    .as_ref()
                    .filter(|instance| instance.id == locator.source_instance_id)
                else {
                    tracing::warn!(
                        work_id = %work.id,
                        kind = ?image.kind,
                        source_instance_id = %locator.source_instance_id,
                        "artwork prewarm: local artwork belongs to a different source instance; skipping"
                    );
                    continue;
                };
                let Some(url) = playarr_artwork::resolve_arr_artwork_url(
                    &instance.base_url,
                    instance.kind,
                    &locator,
                ) else {
                    tracing::warn!(
                        work_id = %work.id,
                        kind = ?image.kind,
                        "artwork prewarm: configured source URL is invalid; skipping"
                    );
                    continue;
                };
                if let Err(err) = self
                    .cache
                    .ensure_cached_with_api_key(
                        work.id,
                        image.kind,
                        &image.url,
                        &url,
                        &instance.api_key_encrypted,
                    )
                    .await
                {
                    tracing::warn!(
                        work_id = %work.id,
                        kind = ?image.kind,
                        error = %err,
                        "authenticated artwork prewarm failed for this image"
                    );
                }
                continue;
            }
            let url = match reqwest::Url::parse(&image.url) {
                Ok(url) => url,
                Err(err) => {
                    tracing::warn!(
                        work_id = %work.id,
                        kind = ?image.kind,
                        error = %err,
                        "artwork prewarm: stored image URL is invalid; skipping"
                    );
                    continue;
                }
            };
            if let Err(err) = self.cache.ensure_cached(work.id, image.kind, &url).await {
                tracing::warn!(
                    work_id = %work.id,
                    kind = ?image.kind,
                    error = %err,
                    "artwork prewarm failed for this image; the on-demand route will retry \
                     when Playarr first requests it"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use playarr_model::{
        Availability, ImageAsset, ImageKind, Sensitive, SourceInstance, SourceKind, WorkKind,
    };
    use uuid::Uuid;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn sample_work(images: Vec<ImageAsset>) -> Work {
        Work {
            id: Uuid::new_v4(),
            kind: WorkKind::Movie,
            external_refs: vec![],
            title: "Test".to_string(),
            sort_title: "Test".to_string(),
            overview: None,
            images,
            genres: vec![],
            tags: vec![],
            added_at: chrono::Utc::now(),
            release_date: None,
            monitored: true,
            availability: Availability::Available,
        }
    }

    /// Serialises the tests that point `PLAYARR_ARTWORK_CACHE_DIR` at a
    /// private directory: the variable is process-global.
    static CACHE_DIR_ENV: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[tokio::test]
    async fn prewarm_work_caches_every_image() {
        let _env = CACHE_DIR_ENV.lock().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/poster.jpg"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "image/jpeg")
                    .set_body_bytes([0xff, 0xd8, 0xff, 0xd9]),
            )
            .mount(&server)
            .await;

        let temp_dir =
            std::env::temp_dir().join(format!("playarr-arr-sync-prewarm-test-{}", Uuid::new_v4()));
        // SAFETY (test-only): no other thread in this test process reads
        // this env var concurrently.
        unsafe {
            std::env::set_var("PLAYARR_ARTWORK_CACHE_DIR", &temp_dir);
        }

        let cache = Arc::new(ArtworkCache::new());
        let prewarm = ArtworkPrewarm::new(cache.clone());
        let work = sample_work(vec![ImageAsset {
            kind: ImageKind::Poster,
            url: format!("{}/poster.jpg", server.uri()),
            width: None,
            height: None,
        }]);

        prewarm.prewarm_work(&work).await;
        assert!(cache.all_cached(work.id, &work.images).await);

        // SAFETY (test-only): see above.
        unsafe {
            std::env::remove_var("PLAYARR_ARTWORK_CACHE_DIR");
        }
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn prewarm_work_is_a_noop_for_a_work_with_no_images() {
        let cache = Arc::new(ArtworkCache::new());
        let prewarm = ArtworkPrewarm::new(cache.clone());
        let work = sample_work(vec![]);
        // Would panic on any unmocked HTTP call if this weren't a no-op.
        prewarm.prewarm_work(&work).await;
    }

    #[tokio::test]
    async fn prewarm_work_fetches_arr_local_artwork_with_the_source_api_key() {
        let _env = CACHE_DIR_ENV.lock().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/mediacover/artist/7/fanart.jpg"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("location", "/MediaCover/7/fanart-final.jpg"),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/MediaCover/7/fanart-final.jpg"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "image/jpeg")
                    .set_body_bytes([0xff, 0xd8, 0xff, 0xd9]),
            )
            .expect(1)
            .mount(&server)
            .await;

        let temp_dir = std::env::temp_dir().join(format!(
            "playarr-arr-sync-authenticated-prewarm-test-{}",
            Uuid::new_v4()
        ));
        // SAFETY (test-only): matches the existing isolated cache tests in
        // this module; the value is removed before the test returns.
        unsafe {
            std::env::set_var("PLAYARR_ARTWORK_CACHE_DIR", &temp_dir);
        }

        let source_instance_id = Uuid::new_v4();
        let source_instance = SourceInstance {
            id: source_instance_id,
            kind: SourceKind::Lidarr,
            name: "Test Lidarr".to_string(),
            base_url: server.uri(),
            api_key_encrypted: Sensitive::new("test-key".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        };
        let work = sample_work(vec![ImageAsset {
            kind: ImageKind::Backdrop,
            url: playarr_artwork::arr_artwork_locator(
                source_instance_id,
                "/MediaCover/7/fanart.jpg",
            )
            .unwrap(),
            width: None,
            height: None,
        }]);
        let cache = Arc::new(ArtworkCache::new());
        let prewarm = ArtworkPrewarm::new(cache.clone()).with_source_instance(source_instance);

        prewarm.prewarm_work(&work).await;

        assert!(cache.all_cached(work.id, &work.images).await);
        unsafe {
            std::env::remove_var("PLAYARR_ARTWORK_CACHE_DIR");
        }
        let _ = tokio::fs::remove_dir_all(temp_dir).await;
    }
}
