//! Generates and caches a semantic embedding for every `Work`'s
//! title+overview+genres right after its catalog identity is reconciled
//! -- what `playarr_catalog::CatalogService::similar` reads at request
//! time to answer "what else is like this". See `playarr_embeddings`'s
//! module doc comment for why this is a small local sentence-embedding
//! model, not an LLM.
//!
//! Unlike credit sync (Radarr-movies-only, see
//! `crate::media_sync::MediaSync::sync_radarr_credits`), this runs for
//! every `Work` kind -- title/overview/genres are present regardless of
//! source app, so "similar" makes sense across the whole catalog.

use std::sync::Arc;

use playarr_db::EmbeddingRepo;
use playarr_embeddings::Embedder;
use playarr_model::{Work, WorkEmbedding};

#[derive(Debug, thiserror::Error)]
pub enum EmbeddingSyncError {
    #[error(transparent)]
    Embedding(#[from] playarr_embeddings::EmbeddingError),
    #[error(transparent)]
    Db(#[from] playarr_db::DbError),
}

/// The exact text a `Work` is embedded from -- title, overview, and
/// genres joined into one short paragraph. Kept as its own function (not
/// inlined) because [`EmbeddingSync::sync_work`] also needs to reproduce
/// it identically to compare against a previously-cached
/// [`WorkEmbedding::source_text`] and skip recomputing when nothing
/// changed.
fn source_text(work: &Work) -> String {
    let mut text = work.title.clone();
    if let Some(overview) = &work.overview {
        text.push_str(". ");
        text.push_str(overview);
    }
    if !work.genres.is_empty() {
        text.push_str(". Genres: ");
        text.push_str(&work.genres.join(", "));
    }
    text
}

#[derive(Clone)]
pub struct EmbeddingSync {
    embedder: Arc<dyn Embedder>,
    embedding_repo: Arc<dyn EmbeddingRepo>,
}

impl EmbeddingSync {
    pub fn new(embedder: Arc<dyn Embedder>, embedding_repo: Arc<dyn EmbeddingRepo>) -> Self {
        Self {
            embedder,
            embedding_repo,
        }
    }

    /// Skips re-embedding (and therefore re-running CPU-bound model
    /// inference) when the source text and model id both match what's
    /// already cached -- every reconciliation pass calls this for every
    /// work regardless of whether anything actually changed, so this
    /// check is what keeps a steady-state catalog cheap.
    pub async fn sync_work(&self, work: &Work) -> Result<(), EmbeddingSyncError> {
        let text = source_text(work);
        if let Some(existing) = self.embedding_repo.get(work.id).await? {
            if existing.source_text == text && existing.model_id == self.embedder.model_id() {
                return Ok(());
            }
        }

        let vector = self.embedder.embed(&text).await?;
        self.embedding_repo
            .upsert(&WorkEmbedding {
                work_id: work.id,
                model_id: self.embedder.model_id().to_string(),
                source_text: text,
                vector,
                updated_at: chrono::Utc::now(),
            })
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use playarr_db::repo::SqlxEmbeddingRepo;
    use playarr_embeddings::NoopEmbedder;
    use playarr_model::{Availability, WorkKind};
    use uuid::Uuid;

    async fn test_pool_with_work(work_id: Uuid) -> playarr_db::DbPool {
        sqlx::any::install_default_drivers();
        let pool: playarr_db::DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite pool");
        playarr_db::run_migrations(&pool)
            .await
            .expect("run real embedded sqlite migrations");
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, availability) \
             VALUES (?, 'movie', 'Test', 'Test', '2024-01-01T00:00:00.000Z', 'available')",
        )
        .bind(work_id.to_string())
        .execute(&pool)
        .await
        .expect("insert parent work row");
        pool
    }

    fn sample_work(id: Uuid, title: &str, overview: &str) -> Work {
        Work {
            id,
            kind: WorkKind::Movie,
            external_refs: vec![],
            title: title.to_string(),
            sort_title: title.to_string(),
            overview: Some(overview.to_string()),
            images: vec![],
            genres: vec!["Drama".to_string()],
            tags: vec![],
            added_at: chrono::Utc::now(),
            release_date: None,
            end_date: None,
            monitored: true,
            availability: Availability::Available,
        }
    }

    #[tokio::test]
    async fn sync_work_embeds_and_caches() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id).await;
        let embedding_repo: Arc<dyn EmbeddingRepo> = Arc::new(SqlxEmbeddingRepo::new(pool));
        let sync = EmbeddingSync::new(Arc::new(NoopEmbedder), embedding_repo.clone());

        let work = sample_work(work_id, "A Movie", "About some things.");
        sync.sync_work(&work).await.unwrap();

        let cached = embedding_repo.get(work_id).await.unwrap().unwrap();
        assert_eq!(cached.model_id, "noop-test-embedder-v1");
        assert!(cached.source_text.contains("A Movie"));
        assert!(cached.source_text.contains("About some things."));
        assert!(cached.source_text.contains("Drama"));
    }

    #[tokio::test]
    async fn sync_work_skips_recompute_when_source_text_is_unchanged() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id).await;
        let embedding_repo: Arc<dyn EmbeddingRepo> = Arc::new(SqlxEmbeddingRepo::new(pool));
        let sync = EmbeddingSync::new(Arc::new(NoopEmbedder), embedding_repo.clone());

        let work = sample_work(work_id, "A Movie", "About some things.");
        sync.sync_work(&work).await.unwrap();
        let first = embedding_repo.get(work_id).await.unwrap().unwrap();

        // Re-sync the identical work -- `updated_at` must not advance,
        // proving the second pass took the "unchanged, skip" branch
        // rather than recomputing.
        sync.sync_work(&work).await.unwrap();
        let second = embedding_repo.get(work_id).await.unwrap().unwrap();
        assert_eq!(first.updated_at, second.updated_at);
    }

    #[tokio::test]
    async fn sync_work_recomputes_when_overview_changes() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id).await;
        let embedding_repo: Arc<dyn EmbeddingRepo> = Arc::new(SqlxEmbeddingRepo::new(pool));
        let sync = EmbeddingSync::new(Arc::new(NoopEmbedder), embedding_repo.clone());

        let mut work = sample_work(work_id, "A Movie", "Original overview.");
        sync.sync_work(&work).await.unwrap();

        work.overview = Some("A completely different overview.".to_string());
        sync.sync_work(&work).await.unwrap();

        let cached = embedding_repo.get(work_id).await.unwrap().unwrap();
        assert!(cached
            .source_text
            .contains("A completely different overview."));
    }
}
