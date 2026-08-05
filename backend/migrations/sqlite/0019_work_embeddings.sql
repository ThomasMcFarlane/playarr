-- `work_embeddings` backs `streamarr_model::WorkEmbedding` -- one cached
-- semantic-similarity vector per work, generated locally by
-- `streamarr_embeddings::Embedder` (see that crate's doc comment) and
-- consumed by `streamarr_catalog::CatalogService::similar` via a
-- brute-force cosine-similarity scan over every row (no ANN index --
-- the catalog is small enough that a full scan is already sub-10ms).
--
-- Portability note (same convention as 0017_credits.sql): work_id is
-- TEXT (stringified UUID), timestamps are TEXT ISO-8601.

CREATE TABLE IF NOT EXISTS work_embeddings (
    work_id TEXT PRIMARY KEY REFERENCES works (id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    source_text TEXT NOT NULL,
    -- JSON-encoded Vec<f32> -- opaque TEXT blob, same convention as
    -- works.images/genres/tags; read back in full for every similarity
    -- scan, never filtered/sorted at the SQL level.
    vector TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
