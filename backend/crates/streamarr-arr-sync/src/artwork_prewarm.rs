//! Proactively warms Streamarr's local artwork cache
//! ([`streamarr_artwork::ArtworkCache`]) for every image on a `Work` right
//! after its catalog identity is reconciled, so the *first* real Playarr
//! viewer to browse a title already gets a cache hit instead of triggering
//! the download themselves (the on-demand route,
//! `streamarr-api::artwork::work_artwork_handler`, still exists as a
//! fallback/backstop for anything this pass doesn't reach yet -- e.g. a
//! title synced before this feature existed).
//!
//! Deliberately Work-level only (poster/backdrop/banner/logo), not
//! per-episode thumbnails -- that's what Playarr's browse/library grids
//! render first and is the overwhelming majority of "why is this slow"
//! for a freshly-synced library; per-episode thumbnail prewarming can
//! follow the same pattern later if it turns out to matter.

use std::sync::Arc;

use streamarr_artwork::ArtworkCache;
use streamarr_model::Work;

#[derive(Clone)]
pub struct ArtworkPrewarm {
    cache: Arc<ArtworkCache>,
}

impl ArtworkPrewarm {
    pub fn new(cache: Arc<ArtworkCache>) -> Self {
        Self { cache }
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
    use streamarr_model::{Availability, ImageAsset, ImageKind, WorkKind};
    use uuid::Uuid;
    use wiremock::matchers::{method, path};
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

    #[tokio::test]
    async fn prewarm_work_caches_every_image() {
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

        let temp_dir = std::env::temp_dir().join(format!(
            "streamarr-arr-sync-prewarm-test-{}",
            Uuid::new_v4()
        ));
        // SAFETY (test-only): no other thread in this test process reads
        // this env var concurrently.
        unsafe {
            std::env::set_var("STREAMARR_ARTWORK_CACHE_DIR", &temp_dir);
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
            std::env::remove_var("STREAMARR_ARTWORK_CACHE_DIR");
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
}
