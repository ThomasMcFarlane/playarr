//! Storage boundary for [`WorkEmbedding`] -- see
//! `playarr_model::embedding`'s module doc comment for the full
//! rationale.

use async_trait::async_trait;
use playarr_model::WorkEmbedding;
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::parse_uuid;
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

#[async_trait]
pub trait EmbeddingRepo: Send + Sync {
    async fn get(&self, work_id: Uuid) -> Result<Option<WorkEmbedding>, DbError>;

    /// Insert-or-update by `WorkEmbedding::work_id`.
    async fn upsert(&self, embedding: &WorkEmbedding) -> Result<(), DbError>;

    /// Every cached embedding -- the full scan
    /// `CatalogService::similar` brute-force cosine-scores against. See
    /// `playarr_model::embedding`'s doc comment for why this is a full
    /// scan rather than an indexed nearest-neighbor query.
    async fn list_all(&self) -> Result<Vec<WorkEmbedding>, DbError>;

    async fn delete(&self, work_id: Uuid) -> Result<(), DbError>;
}

pub struct SqlxEmbeddingRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxEmbeddingRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<WorkEmbedding, DbError> {
        let work_id: String = row.try_get("work_id")?;
        let model_id: String = row.try_get("model_id")?;
        let source_text: String = row.try_get("source_text")?;
        let vector: String = row.try_get("vector")?;
        let updated_at: String = row.try_get("updated_at")?;

        Ok(WorkEmbedding {
            work_id: parse_uuid(&work_id)?,
            model_id,
            source_text,
            vector: serde_json::from_str(&vector)?,
            updated_at: crate::codec::parse_datetime(&updated_at)?,
        })
    }
}

#[async_trait]
impl EmbeddingRepo for SqlxEmbeddingRepo {
    async fn get(&self, work_id: Uuid) -> Result<Option<WorkEmbedding>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT work_id, model_id, source_text, vector, updated_at \
                 FROM work_embeddings WHERE work_id = ?"
            }
            Backend::Postgres => {
                "SELECT work_id, model_id, source_text, vector, updated_at \
                 FROM work_embeddings WHERE work_id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(work_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn upsert(&self, embedding: &WorkEmbedding) -> Result<(), DbError> {
        let vector = serde_json::to_string(&embedding.vector)?;
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO work_embeddings (work_id, model_id, source_text, vector, updated_at) \
                 VALUES (?, ?, ?, ?, ?) \
                 ON CONFLICT (work_id) DO UPDATE SET \
                 model_id = excluded.model_id, source_text = excluded.source_text, \
                 vector = excluded.vector, updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO work_embeddings (work_id, model_id, source_text, vector, updated_at) \
                 VALUES ($1, $2, $3, $4, $5) \
                 ON CONFLICT (work_id) DO UPDATE SET \
                 model_id = excluded.model_id, source_text = excluded.source_text, \
                 vector = excluded.vector, updated_at = excluded.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(embedding.work_id.to_string())
            .bind(embedding.model_id.as_str())
            .bind(embedding.source_text.as_str())
            .bind(vector)
            .bind(crate::codec::format_datetime(embedding.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_all(&self) -> Result<Vec<WorkEmbedding>, DbError> {
        let sql = "SELECT work_id, model_id, source_text, vector, updated_at FROM work_embeddings";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn delete(&self, work_id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM work_embeddings WHERE work_id = ?",
            Backend::Postgres => "DELETE FROM work_embeddings WHERE work_id = $1",
        };
        sqlx::query(sql)
            .bind(work_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::work::{SqlxWorkRepo, WorkRepo};
    use playarr_model::{Availability, Work, WorkKind};

    async fn seed_work(pool: &DbPool, id: Uuid) {
        let repo = SqlxWorkRepo::new(pool.clone());
        repo.upsert(&Work {
            id,
            kind: WorkKind::Movie,
            external_refs: Vec::new(),
            title: "Test Movie".to_string(),
            sort_title: "Test Movie".to_string(),
            overview: None,
            images: Vec::new(),
            genres: Vec::new(),
            tags: Vec::new(),
            added_at: chrono::Utc::now(),
            release_date: None,
            monitored: true,
            availability: Availability::Available,
        })
        .await
        .unwrap();
    }

    fn sample_embedding(work_id: Uuid) -> WorkEmbedding {
        WorkEmbedding {
            work_id,
            model_id: "test-model-v1".to_string(),
            source_text: "A test movie. About testing.".to_string(),
            vector: vec![0.1, 0.2, 0.3],
            updated_at: chrono::Utc::now().trunc_subsecs(3),
        }
    }

    use chrono::SubsecRound;

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        seed_work(&pool, work_id).await;
        let repo = SqlxEmbeddingRepo::new(pool);

        let embedding = sample_embedding(work_id);
        repo.upsert(&embedding).await.unwrap();
        let fetched = repo.get(work_id).await.unwrap().unwrap();
        assert_eq!(fetched, embedding);
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxEmbeddingRepo::new(pool);
        assert_eq!(repo.get(Uuid::new_v4()).await.unwrap(), None);
    }

    #[tokio::test]
    async fn upsert_replaces_existing() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        seed_work(&pool, work_id).await;
        let repo = SqlxEmbeddingRepo::new(pool);

        repo.upsert(&sample_embedding(work_id)).await.unwrap();
        let mut updated = sample_embedding(work_id);
        updated.vector = vec![0.9, 0.8, 0.7];
        updated.source_text = "A different overview now.".to_string();
        repo.upsert(&updated).await.unwrap();

        let fetched = repo.get(work_id).await.unwrap().unwrap();
        assert_eq!(fetched.vector, vec![0.9, 0.8, 0.7]);
        assert_eq!(fetched.source_text, "A different overview now.");
    }

    #[tokio::test]
    async fn list_all_returns_every_embedding() {
        let pool = test_sqlite_pool().await;
        let work_a = Uuid::new_v4();
        let work_b = Uuid::new_v4();
        seed_work(&pool, work_a).await;
        seed_work(&pool, work_b).await;
        let repo = SqlxEmbeddingRepo::new(pool);

        repo.upsert(&sample_embedding(work_a)).await.unwrap();
        repo.upsert(&sample_embedding(work_b)).await.unwrap();

        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn delete_removes_the_row() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        seed_work(&pool, work_id).await;
        let repo = SqlxEmbeddingRepo::new(pool);

        repo.upsert(&sample_embedding(work_id)).await.unwrap();
        repo.delete(work_id).await.unwrap();
        assert_eq!(repo.get(work_id).await.unwrap(), None);
    }
}
