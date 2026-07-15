use async_trait::async_trait;
use streamarr_model::{ExternalProvider, Work, WorkKind};
use uuid::Uuid;

use crate::error::DbError;
use crate::pool::DbPool;

/// CRUD + lookup surface over the `Work` aggregate root (movies, series,
/// artists, authors — see `streamarr_model::Work`). Season/episode/album/
/// track/book children are intentionally out of scope here; they get their
/// own repositories once the catalog write path is built, since their
/// query patterns (paginate-by-parent, bulk-upsert-on-sync) differ enough
/// from the root aggregate's to not share one trait cleanly.
#[async_trait]
pub trait WorkRepo: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<Work, DbError>;

    async fn list_by_kind(
        &self,
        kind: WorkKind,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Work>, DbError>;

    /// Insert-or-update by `Work::id`. Sync pollers call this after
    /// reconciling against a source instance; there is no separate
    /// `create`/`update` split because the caller (arr-sync) always has a
    /// full, authoritative `Work` value in hand rather than a partial
    /// patch.
    async fn upsert(&self, work: &Work) -> Result<(), DbError>;

    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    /// Used by the reconciliation poller to map an inbound webhook/poll
    /// result (which only carries the source app's own id) back to a
    /// `Work`, before falling back to creating a new one.
    async fn find_by_external_ref(
        &self,
        provider: &ExternalProvider,
        external_id: &str,
    ) -> Result<Option<Work>, DbError>;
}

pub struct SqlxWorkRepo {
    pool: DbPool,
}

impl SqlxWorkRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl WorkRepo for SqlxWorkRepo {
    async fn get(&self, _id: Uuid) -> Result<Work, DbError> {
        // SELECT * FROM works WHERE id = $1
        let _ = &self.pool;
        unimplemented!("SqlxWorkRepo::get")
    }

    async fn list_by_kind(
        &self,
        _kind: WorkKind,
        _limit: i64,
        _offset: i64,
    ) -> Result<Vec<Work>, DbError> {
        // SELECT * FROM works WHERE kind = $1 ORDER BY sort_title LIMIT $2 OFFSET $3
        unimplemented!("SqlxWorkRepo::list_by_kind")
    }

    async fn upsert(&self, _work: &Work) -> Result<(), DbError> {
        // INSERT INTO works (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET ...
        unimplemented!("SqlxWorkRepo::upsert")
    }

    async fn delete(&self, _id: Uuid) -> Result<(), DbError> {
        // DELETE FROM works WHERE id = $1
        unimplemented!("SqlxWorkRepo::delete")
    }

    async fn find_by_external_ref(
        &self,
        _provider: &ExternalProvider,
        _external_id: &str,
    ) -> Result<Option<Work>, DbError> {
        // SELECT w.* FROM works w
        // JOIN work_external_refs r ON r.work_id = w.id
        // WHERE r.provider = $1 AND r.external_id = $2
        unimplemented!("SqlxWorkRepo::find_by_external_ref")
    }
}
