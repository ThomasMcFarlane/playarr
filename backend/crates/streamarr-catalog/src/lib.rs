//! `streamarr-catalog` — the read path over the catalog: browse/search/
//! get-by-id. Deliberately separate from `streamarr-db`'s `WorkRepo` (the
//! write-shaped repository trait `streamarr-arr-sync` upserts into) because
//! the read and write access patterns diverge quickly — browse/search want
//! pagination, faceting, and a cache in front; sync wants upsert-by-id and
//! external-ref lookups. Splitting them into a catalog *service* on top of
//! the repository, rather than growing `WorkRepo` to cover both, keeps
//! each shape driven by its own caller.

use std::sync::Arc;

use streamarr_cache::CacheAndPubSub;
use streamarr_db::WorkRepo;
use streamarr_model::{Work, WorkKind};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("work not found")]
    NotFound,
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
    #[error(transparent)]
    Cache(#[from] streamarr_cache::CacheError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowseSort {
    TitleAscending,
    RecentlyAdded,
}

/// Filter/sort/page parameters for [`CatalogService::browse`]. A struct
/// rather than positional arguments so the API layer can grow new filter
/// dimensions (e.g. availability, monitored-only) without breaking every
/// call site.
#[derive(Debug, Clone)]
pub struct BrowseQuery {
    pub kind: Option<WorkKind>,
    pub genre: Option<String>,
    pub tag: Option<String>,
    pub sort: BrowseSort,
    pub limit: i64,
    pub offset: i64,
}

impl Default for BrowseQuery {
    fn default() -> Self {
        Self {
            kind: None,
            genre: None,
            tag: None,
            sort: BrowseSort::TitleAscending,
            limit: 50,
            offset: 0,
        }
    }
}

/// A page of [`BrowseQuery`]/[`CatalogService::search`] results, with
/// enough metadata for the API layer to build pagination without a second
/// count query most of the time (`total` is `None` when the caller asked
/// for a cheap page that skips the count).
#[derive(Debug, Clone)]
pub struct CatalogPage {
    pub items: Vec<Work>,
    pub total: Option<i64>,
}

/// The catalog read API. Holds a [`WorkRepo`] for the underlying query and
/// a [`CacheAndPubSub`] to front hot browse/search results — cache
/// invalidation on writes is `streamarr-arr-sync`'s responsibility (it
/// publishes on the work's cache key/tag after every upsert), not this
/// service's, since only the writer knows what changed.
pub struct CatalogService {
    work_repo: Arc<dyn WorkRepo>,
    cache: Arc<dyn CacheAndPubSub>,
}

impl CatalogService {
    pub fn new(work_repo: Arc<dyn WorkRepo>, cache: Arc<dyn CacheAndPubSub>) -> Self {
        Self { work_repo, cache }
    }

    /// Filtered, sorted, paginated listing — the query backing library
    /// browse/grid views.
    pub async fn browse(&self, query: BrowseQuery) -> Result<CatalogPage, CatalogError> {
        let _ = (&self.work_repo, &self.cache, &query);
        unimplemented!("CatalogService::browse")
    }

    /// Free-text search across title/sort_title (and, once the catalog
    /// grows a proper search index, overview/cast/etc). `limit` is a hard
    /// cap, not a page size — search results aren't expected to paginate
    /// past the first screen.
    pub async fn search(&self, query: &str, limit: i64) -> Result<Vec<Work>, CatalogError> {
        let _ = (&self.work_repo, &self.cache, query, limit);
        unimplemented!("CatalogService::search")
    }

    pub async fn get_by_id(&self, id: Uuid) -> Result<Work, CatalogError> {
        let _ = (&self.work_repo, &self.cache, id);
        unimplemented!("CatalogService::get_by_id")
    }
}
