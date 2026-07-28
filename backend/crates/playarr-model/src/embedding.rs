//! [`WorkEmbedding`] -- a cached semantic-similarity vector for a
//! [`crate::Work`], generated locally by `playarr_embeddings::Embedder`
//! (never a cloud API) from the work's title+overview+genres. Backs
//! `playarr_catalog::CatalogService::similar` ("what else is like
//! this"): computed once per work by `playarr-arr-sync`'s
//! `embedding_sync` module during reconciliation, read many times at
//! request time via a brute-force cosine-similarity scan over every
//! cached vector (the catalog is small enough -- low thousands of works
//! -- that this needs no ANN index).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkEmbedding {
    pub work_id: Uuid,
    /// Which `Embedder` implementation/model produced `vector` -- see
    /// `playarr_embeddings::Embedder::model_id`'s doc comment. Compared
    /// against the current embedder's own id before trusting a cached
    /// vector is still in the same embedding space.
    pub model_id: String,
    /// The exact text `vector` was generated from -- compared against a
    /// freshly-built source string on every sync pass so an unchanged
    /// work skips expensive re-embedding (see `EmbeddingSync::sync_work`).
    pub source_text: String,
    pub vector: Vec<f32>,
    pub updated_at: DateTime<Utc>,
}
