//! Local, CPU-only text embeddings for catalog "similar items" -- the
//! implementation of `Work::similar_to`-style matching that's genuinely
//! *contextual* (semantic meaning, not keyword/genre overlap) without
//! calling a cloud API or running a generative LLM. A small
//! sentence-embedding model does exactly this one job well and is far
//! lighter than even the smallest generative model: no sampling, no
//! autoregressive decode, a single forward pass per text, output is a
//! fixed-size vector meant to be compared by cosine similarity.
//!
//! [`Embedder`] is the trait boundary every caller (`playarr-arr-sync`,
//! `playarr-catalog`) depends on, `Arc<dyn Embedder>` the same way every
//! other cross-crate service in this workspace is threaded — so a test
//! never needs to load a real ONNX model (see [`NoopEmbedder`]).
//! [`FastEmbedEmbedder`] is the one real implementation, backed by
//! [`fastembed`] (ONNX Runtime under the hood): CPU-only by default,
//! synchronous (so calls are wrapped in `tokio::task::spawn_blocking`
//! here, never run directly on an async task), and downloads its model
//! weights once from Hugging Face on first use, caching them locally
//! (`fastembed`'s own `~/.fastembed_cache` by default) — offline after
//! that. This is a real, meaningful new dependency (an ONNX Runtime
//! native library, a downloaded model file) relative to the rest of this
//! workspace's dependency-light crates; every caller treats a failure
//! here as best-effort/non-fatal (see `playarr-arr-sync::embedding_sync`)
//! specifically because of that first-run network dependency.

use async_trait::async_trait;

pub const EMBEDDING_DIM: usize = 384;

#[derive(Debug, thiserror::Error)]
pub enum EmbeddingError {
    #[error("failed to initialize the local embedding model: {0}")]
    Init(String),
    #[error("failed to generate an embedding: {0}")]
    Inference(String),
}

/// Generates a fixed-size semantic embedding vector for a piece of text.
/// Implementations must be deterministic for the same input (so
/// `EmbeddingSync`'s "skip if source text unchanged" check stays valid)
/// and must return vectors of [`EMBEDDING_DIM`] length.
#[async_trait]
pub trait Embedder: Send + Sync {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbeddingError>;

    /// A stable identifier for the exact model/version producing these
    /// vectors -- stored alongside every cached embedding
    /// (`playarr_model::WorkEmbedding::model_id`) so a future model
    /// change can be detected and everything re-embedded, rather than
    /// silently comparing vectors from two different embedding spaces.
    fn model_id(&self) -> &str;
}

/// Cosine similarity between two vectors of equal length, in `[-1.0,
/// 1.0]` (in practice `[0.0, 1.0]` for this model family, whose vectors
/// are non-negative-ish in aggregate) -- `1.0` is identical direction
/// (most similar), `0.0` is unrelated. Returns `0.0` for mismatched
/// lengths or a zero vector rather than panicking or dividing by zero --
/// a defensive fallback, not an expected input (both inputs always come
/// from the same [`Embedder`] in practice).
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

/// Deterministic, model-free [`Embedder`] for tests -- never loads
/// `fastembed`/ONNX Runtime, never touches the network. Produces a
/// low-dimensional, term-frequency-ish vector (bag-of-words hashed into
/// [`EMBEDDING_DIM`] buckets) that's "similar enough" for tests to assert
/// real relative-ranking behavior (two texts sharing more words score
/// higher than two that share none) without depending on a real model's
/// actual semantics.
#[derive(Debug, Default)]
pub struct NoopEmbedder;

#[async_trait]
impl Embedder for NoopEmbedder {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbeddingError> {
        let mut vector = vec![0.0f32; EMBEDDING_DIM];
        for word in text.split_whitespace() {
            let bucket = simple_hash(word) as usize % EMBEDDING_DIM;
            vector[bucket] += 1.0;
        }
        Ok(vector)
    }

    fn model_id(&self) -> &str {
        "noop-test-embedder-v1"
    }
}

fn simple_hash(s: &str) -> u64 {
    // FNV-1a -- tiny, dependency-free, stable across runs (unlike
    // `DefaultHasher`, which is randomly seeded per-process and would make
    // `NoopEmbedder`'s output non-deterministic across test runs).
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in s.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// The real [`Embedder`], backed by a local ONNX sentence-embedding model
/// via [`fastembed`]. See this module's doc comment for the operational
/// tradeoffs (native ONNX Runtime dependency, first-run model download).
pub struct FastEmbedEmbedder {
    // `Arc` (not a bare field) so a clone can move into each
    // `spawn_blocking` closure below -- `fastembed::TextEmbedding::embed`
    // takes `&mut self`, and `spawn_blocking`'s closure must be `'static`,
    // so borrowing `&self` across the call isn't an option.
    model: std::sync::Arc<std::sync::Mutex<fastembed::TextEmbedding>>,
}

impl FastEmbedEmbedder {
    /// Downloads (on first call; cached locally after) and loads
    /// `AllMiniLML6V2` -- a 384-dimension, ~90MB sentence-embedding model,
    /// the standard lightweight default for this exact task (general
    /// English semantic similarity) and CPU-fast enough to embed a
    /// title+overview+genres string in low single-digit milliseconds.
    pub fn new() -> Result<Self, EmbeddingError> {
        let options = fastembed::TextInitOptions::new(fastembed::EmbeddingModel::AllMiniLML6V2);
        let model = fastembed::TextEmbedding::try_new(options)
            .map_err(|err| EmbeddingError::Init(err.to_string()))?;
        Ok(Self {
            model: std::sync::Arc::new(std::sync::Mutex::new(model)),
        })
    }
}

#[async_trait]
impl Embedder for FastEmbedEmbedder {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbeddingError> {
        // `fastembed::TextEmbedding::embed` is synchronous, CPU-bound
        // (ONNX Runtime inference) -- never call it directly on an async
        // task, always through `spawn_blocking`, same rule this workspace
        // applies to every other blocking call.
        let text = text.to_string();
        let model = self.model.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<Vec<f32>, EmbeddingError> {
            let mut guard = model
                .lock()
                .map_err(|_| EmbeddingError::Inference("model mutex poisoned".to_string()))?;
            let embeddings = guard
                .embed(vec![text], None)
                .map_err(|err| EmbeddingError::Inference(err.to_string()))?;
            embeddings
                .into_iter()
                .next()
                .ok_or_else(|| EmbeddingError::Inference("no embedding returned".to_string()))
        })
        .await
        .map_err(|err| EmbeddingError::Inference(err.to_string()))??;
        Ok(result)
    }

    fn model_id(&self) -> &str {
        "fastembed-all-minilm-l6-v2"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_similarity_of_identical_vectors_is_one() {
        let v = vec![1.0, 2.0, 3.0];
        assert!((cosine_similarity(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_similarity_of_orthogonal_vectors_is_zero() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert!((cosine_similarity(&a, &b)).abs() < 1e-6);
    }

    #[test]
    fn cosine_similarity_handles_mismatched_lengths() {
        assert_eq!(cosine_similarity(&[1.0, 2.0], &[1.0]), 0.0);
    }

    #[tokio::test]
    async fn noop_embedder_ranks_shared_vocabulary_higher() {
        let embedder = NoopEmbedder;
        let a = embedder
            .embed("a wrongly convicted man endures prison")
            .await
            .unwrap();
        let b = embedder
            .embed("a man wrongly convicted endures years in prison")
            .await
            .unwrap();
        let c = embedder
            .embed("a chef opens a restaurant in paris")
            .await
            .unwrap();

        let sim_ab = cosine_similarity(&a, &b);
        let sim_ac = cosine_similarity(&a, &c);
        assert!(
            sim_ab > sim_ac,
            "texts sharing more vocabulary should score more similar: {sim_ab} vs {sim_ac}"
        );
    }

    #[tokio::test]
    async fn noop_embedder_is_deterministic() {
        let embedder = NoopEmbedder;
        let a = embedder.embed("same text every time").await.unwrap();
        let b = embedder.embed("same text every time").await.unwrap();
        assert_eq!(a, b);
    }
}
