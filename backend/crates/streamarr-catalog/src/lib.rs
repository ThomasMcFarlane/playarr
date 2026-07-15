//! `streamarr-catalog` — the read path over the catalog: browse/search/
//! get-by-id. Deliberately separate from `streamarr-db`'s `WorkRepo` (the
//! write-shaped repository trait `streamarr-arr-sync` upserts into) because
//! the read and write access patterns diverge quickly — browse/search want
//! pagination, faceting, and a cache in front; sync wants upsert-by-id and
//! external-ref lookups. Splitting them into a catalog *service* on top of
//! the repository, rather than growing `WorkRepo` to cover both, keeps
//! each shape driven by its own caller.
//!
//! Concretely, "on top of the repository" means: `CatalogService` fetches
//! candidate `Work`s exclusively through `WorkRepo` (never touches the
//! `works` table directly) and layers filtering/sorting/pagination/search on
//! top in Rust, since `WorkRepo::list_by_kind` only supports a kind filter
//! and a fixed `sort_title` order. See `browse`/`search`'s doc comments for
//! the cost model that trade-off implies. The one exception is
//! `get_by_id`'s "full tree" (seasons/episodes, albums/tracks, books):
//! nothing in `streamarr-db` exposes those yet (its `WorkRepo` doc comment
//! explicitly scopes them out until "the catalog write path is built"), so
//! this crate queries `DbPool` directly for just that slice — see
//! `CatalogService::pool` and `backend/migrations/{sqlite,postgres}/000{4,5}_catalog_children.sql`.

mod codec;

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::Row;
use streamarr_cache::CacheAndPubSub;
use streamarr_db::{DbError, DbPool, WorkRepo};
use streamarr_model::{Album, Book, Episode, Season, Track, Work, WorkKind};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("work not found")]
    NotFound,
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
    #[error(transparent)]
    Cache(#[from] streamarr_cache::CacheError),
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
    /// A row in the catalog's own child tables (seasons/episodes/albums/
    /// tracks/books) didn't decode into its domain type — corrupt data or
    /// schema drift, not a caller error.
    #[error("catalog data error: {0}")]
    Data(String),
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogPage {
    pub items: Vec<Work>,
    pub total: Option<i64>,
}

/// A season plus its episodes, as returned inside [`WorkDetail`] for a
/// `WorkKind::Series` work.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeasonDetail {
    pub season: Season,
    pub episodes: Vec<Episode>,
}

/// An album plus its tracks, as returned inside [`WorkDetail`] for a
/// `WorkKind::Artist` work.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlbumDetail {
    pub album: Album,
    pub tracks: Vec<Track>,
}

/// The kind-specific "full tree" hanging off a [`Work`] in
/// [`CatalogService::get_by_id`]'s result. Mirrors `WorkKind` (`Movie` has
/// no children; `Series`/`Artist`/`Author` each have their own).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkChildren {
    Movie,
    Series(Vec<SeasonDetail>),
    Artist(Vec<AlbumDetail>),
    Author(Vec<Book>),
}

/// [`CatalogService::get_by_id`]'s result: the `Work` aggregate root plus
/// its full kind-specific tree. A richer type than bare `Work` — returning
/// just `Work` (as an earlier scaffold of this method's signature did) can
/// never carry seasons/episodes/albums/tracks/books, which the "get a work's
/// detail page" use case this method exists for needs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkDetail {
    pub work: Work,
    pub children: WorkChildren,
}

/// Upper bound on how many rows [`CatalogService::browse`]/`search` scan
/// (per `WorkKind`) before filtering/sorting/paginating in memory. See
/// those methods' doc comments for why this exists instead of pushing
/// genre/tag filtering and search into SQL.
const SCAN_LIMIT: i64 = 100_000;

const BROWSE_CACHE_TTL: Duration = Duration::from_secs(30);
const SEARCH_CACHE_TTL: Duration = Duration::from_secs(30);
const WORK_DETAIL_CACHE_TTL: Duration = Duration::from_secs(60);

const ALL_KINDS: [WorkKind; 4] = [
    WorkKind::Movie,
    WorkKind::Series,
    WorkKind::Artist,
    WorkKind::Author,
];

fn browse_cache_key(query: &BrowseQuery) -> String {
    format!(
        "catalog:browse:{:?}:{:?}:{:?}:{:?}:{}:{}",
        query.kind, query.genre, query.tag, query.sort, query.limit, query.offset
    )
}

fn search_cache_key(needle: &str, limit: i64) -> String {
    format!("catalog:search:{needle}:{limit}")
}

fn work_detail_cache_key(id: Uuid) -> String {
    format!("catalog:work:{id}")
}

/// The catalog read API. Holds a [`WorkRepo`] for the underlying query and
/// a [`CacheAndPubSub`] to front hot browse/search results — cache
/// invalidation on writes is `streamarr-arr-sync`'s responsibility (it
/// publishes on the work's cache key/tag after every upsert), not this
/// service's, since only the writer knows what changed; the TTLs above are
/// this service's own safety net against that never happening (e.g. before
/// `streamarr-arr-sync` exists) rather than the primary invalidation path.
pub struct CatalogService {
    work_repo: Arc<dyn WorkRepo>,
    cache: Arc<dyn CacheAndPubSub>,
    /// Backs only the season/episode/album/track/book "full tree" lookups
    /// in [`CatalogService::get_by_id`] — every `Work` row itself is always
    /// read through `work_repo`, never through this pool. See the crate
    /// doc comment for why `get_by_id` needs a second data source at all.
    pool: DbPool,
}

impl CatalogService {
    pub fn new(work_repo: Arc<dyn WorkRepo>, cache: Arc<dyn CacheAndPubSub>, pool: DbPool) -> Self {
        Self {
            work_repo,
            cache,
            pool,
        }
    }

    /// Filtered, sorted, paginated listing — the query backing library
    /// browse/grid views.
    ///
    /// `WorkRepo::list_by_kind` only supports a kind filter and a fixed
    /// `sort_title` order, so genre/tag filtering, the `RecentlyAdded` sort,
    /// and the total count are all done here in memory over up to
    /// [`SCAN_LIMIT`] rows per matching kind. That's the right trade-off for
    /// the catalog sizes this targets (a personal/family media server —
    /// thousands, not millions, of works); if `WorkRepo` grows a
    /// filter/sort-aware query (or this crate grows its own indexed read
    /// model) later, this is the method to swap over.
    pub async fn browse(&self, query: BrowseQuery) -> Result<CatalogPage, CatalogError> {
        let cache_key = browse_cache_key(&query);
        if let Some(cached) = self.cache.get(&cache_key).await? {
            if let Ok(page) = serde_json::from_slice::<CatalogPage>(&cached) {
                return Ok(page);
            }
            // Corrupt/incompatible cache entry (e.g. a stale format from a
            // prior version) — fall through to a fresh query rather than
            // failing the request over it.
        }

        let kinds: &[WorkKind] = match &query.kind {
            Some(kind) => std::slice::from_ref(kind),
            None => &ALL_KINDS,
        };

        let mut candidates = Vec::new();
        for kind in kinds {
            candidates.extend(self.work_repo.list_by_kind(*kind, SCAN_LIMIT, 0).await?);
        }

        if let Some(genre) = query.genre.as_deref() {
            candidates.retain(|w| w.genres.iter().any(|g| g.eq_ignore_ascii_case(genre)));
        }
        if let Some(tag) = query.tag.as_deref() {
            candidates.retain(|w| w.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)));
        }

        match query.sort {
            BrowseSort::TitleAscending => {
                candidates.sort_by(|a, b| a.sort_title.cmp(&b.sort_title));
            }
            BrowseSort::RecentlyAdded => {
                candidates.sort_by(|a, b| b.added_at.cmp(&a.added_at));
            }
        }

        let total = candidates.len() as i64;
        let offset = query.offset.max(0) as usize;
        let limit = query.limit.max(0) as usize;
        let items: Vec<Work> = candidates.into_iter().skip(offset).take(limit).collect();

        let page = CatalogPage {
            items,
            total: Some(total),
        };

        if let Ok(bytes) = serde_json::to_vec(&page) {
            self.cache
                .set(&cache_key, bytes, Some(BROWSE_CACHE_TTL))
                .await?;
        }

        Ok(page)
    }

    /// Free-text, case-insensitive substring search over `title`/`overview`
    /// across every `WorkKind` — a plain `.contains()` scan (the in-memory
    /// equivalent of a `LIKE '%needle%'`/`ILIKE` query), which is exactly
    /// what the task calls for at v1 ("no need for full-text search
    /// infrastructure"). A blank/whitespace-only query returns no results
    /// rather than the whole catalog, since callers almost never want that
    /// and it keeps `limit` meaningful. `limit` is a hard cap, not a page
    /// size — search results aren't expected to paginate past the first
    /// screen.
    pub async fn search(&self, query: &str, limit: i64) -> Result<Vec<Work>, CatalogError> {
        let needle = query.trim().to_lowercase();
        let limit = limit.max(0) as usize;

        if needle.is_empty() {
            return Ok(Vec::new());
        }

        let cache_key = search_cache_key(&needle, limit as i64);
        if let Some(cached) = self.cache.get(&cache_key).await? {
            if let Ok(items) = serde_json::from_slice::<Vec<Work>>(&cached) {
                return Ok(items);
            }
        }

        let mut matches = Vec::new();
        for kind in ALL_KINDS {
            let candidates = self.work_repo.list_by_kind(kind, SCAN_LIMIT, 0).await?;
            matches.extend(candidates.into_iter().filter(|w| {
                w.title.to_lowercase().contains(&needle)
                    || w.overview
                        .as_deref()
                        .is_some_and(|o| o.to_lowercase().contains(&needle))
            }));
        }

        // Title hits first (a title match is a stronger signal than an
        // overview match), then alphabetical — good enough relevance
        // ordering for a v1 substring search without real ranking.
        matches.sort_by(|a, b| {
            let a_title_hit = a.title.to_lowercase().contains(&needle);
            let b_title_hit = b.title.to_lowercase().contains(&needle);
            b_title_hit
                .cmp(&a_title_hit)
                .then_with(|| a.sort_title.cmp(&b.sort_title))
        });
        matches.truncate(limit);

        if let Ok(bytes) = serde_json::to_vec(&matches) {
            self.cache
                .set(&cache_key, bytes, Some(SEARCH_CACHE_TTL))
                .await?;
        }

        Ok(matches)
    }

    /// A `Work` plus its full kind-specific tree (seasons/episodes for a
    /// series, albums/tracks for an artist, books for an author; a movie
    /// has none). Returns [`CatalogError::NotFound`] — a 404-shaped error,
    /// not a bare `DbError` — when no work exists with `id`.
    pub async fn get_by_id(&self, id: Uuid) -> Result<WorkDetail, CatalogError> {
        let cache_key = work_detail_cache_key(id);
        if let Some(cached) = self.cache.get(&cache_key).await? {
            if let Ok(detail) = serde_json::from_slice::<WorkDetail>(&cached) {
                return Ok(detail);
            }
        }

        let work = match self.work_repo.get(id).await {
            Ok(work) => work,
            Err(DbError::NotFound) => return Err(CatalogError::NotFound),
            Err(other) => return Err(CatalogError::Db(other)),
        };

        let children = match work.kind {
            WorkKind::Movie => WorkChildren::Movie,
            WorkKind::Series => WorkChildren::Series(self.seasons_for_series(work.id).await?),
            WorkKind::Artist => WorkChildren::Artist(self.albums_for_artist(work.id).await?),
            WorkKind::Author => WorkChildren::Author(self.books_for_author(work.id).await?),
        };

        let detail = WorkDetail { work, children };

        if let Ok(bytes) = serde_json::to_vec(&detail) {
            self.cache
                .set(&cache_key, bytes, Some(WORK_DETAIL_CACHE_TTL))
                .await?;
        }

        Ok(detail)
    }

    async fn seasons_for_series(
        &self,
        series_work_id: Uuid,
    ) -> Result<Vec<SeasonDetail>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, season_number, title, overview, monitored, availability \
             FROM seasons WHERE series_work_id = ? ORDER BY season_number ASC",
        )
        .bind(series_work_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut seasons = Vec::with_capacity(rows.len());
        for row in rows {
            let id = codec::parse_uuid(&row.try_get::<String, _>("id")?)?;
            let season = Season {
                id,
                series_work_id,
                season_number: row.try_get::<i64, _>("season_number")? as i32,
                title: row.try_get("title")?,
                overview: row.try_get("overview")?,
                monitored: row.try_get::<i64, _>("monitored")? != 0,
                availability: codec::availability_from_str(
                    &row.try_get::<String, _>("availability")?,
                )?,
            };
            let episodes = self.episodes_for_season(id).await?;
            seasons.push(SeasonDetail { season, episodes });
        }
        Ok(seasons)
    }

    async fn episodes_for_season(&self, season_id: Uuid) -> Result<Vec<Episode>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, episode_number, title, overview, air_date, runtime_minutes, monitored, availability \
             FROM episodes WHERE season_id = ? ORDER BY episode_number ASC",
        )
        .bind(season_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut episodes = Vec::with_capacity(rows.len());
        for row in rows {
            let air_date = match row.try_get::<Option<String>, _>("air_date")? {
                Some(raw) => Some(codec::parse_date(&raw)?),
                None => None,
            };
            episodes.push(Episode {
                id: codec::parse_uuid(&row.try_get::<String, _>("id")?)?,
                season_id,
                episode_number: row.try_get::<i64, _>("episode_number")? as i32,
                title: row.try_get("title")?,
                overview: row.try_get("overview")?,
                air_date,
                runtime_minutes: row
                    .try_get::<Option<i64>, _>("runtime_minutes")?
                    .map(|n| n as u32),
                monitored: row.try_get::<i64, _>("monitored")? != 0,
                availability: codec::availability_from_str(
                    &row.try_get::<String, _>("availability")?,
                )?,
            });
        }
        Ok(episodes)
    }

    async fn albums_for_artist(
        &self,
        artist_work_id: Uuid,
    ) -> Result<Vec<AlbumDetail>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, title, album_type, release_date, monitored, availability \
             FROM albums WHERE artist_work_id = ? ORDER BY release_date ASC",
        )
        .bind(artist_work_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut albums = Vec::with_capacity(rows.len());
        for row in rows {
            let id = codec::parse_uuid(&row.try_get::<String, _>("id")?)?;
            let release_date = match row.try_get::<Option<String>, _>("release_date")? {
                Some(raw) => Some(codec::parse_date(&raw)?),
                None => None,
            };
            let album = Album {
                id,
                artist_work_id,
                title: row.try_get("title")?,
                album_type: album_type_from_str(&row.try_get::<String, _>("album_type")?)?,
                release_date,
                monitored: row.try_get::<i64, _>("monitored")? != 0,
                availability: codec::availability_from_str(
                    &row.try_get::<String, _>("availability")?,
                )?,
            };
            let tracks = self.tracks_for_album(id).await?;
            albums.push(AlbumDetail { album, tracks });
        }
        Ok(albums)
    }

    async fn tracks_for_album(&self, album_id: Uuid) -> Result<Vec<Track>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, disc_number, track_number, title, duration_seconds, availability \
             FROM tracks WHERE album_id = ? ORDER BY disc_number ASC, track_number ASC",
        )
        .bind(album_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut tracks = Vec::with_capacity(rows.len());
        for row in rows {
            tracks.push(Track {
                id: codec::parse_uuid(&row.try_get::<String, _>("id")?)?,
                album_id,
                disc_number: row.try_get::<i64, _>("disc_number")? as u32,
                track_number: row.try_get::<i64, _>("track_number")? as u32,
                title: row.try_get("title")?,
                duration_seconds: row
                    .try_get::<Option<i64>, _>("duration_seconds")?
                    .map(|n| n as u32),
                availability: codec::availability_from_str(
                    &row.try_get::<String, _>("availability")?,
                )?,
            });
        }
        Ok(tracks)
    }

    async fn books_for_author(&self, author_work_id: Uuid) -> Result<Vec<Book>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, title, isbn, release_date, series_name, series_position, monitored, availability \
             FROM books WHERE author_work_id = ? ORDER BY release_date ASC",
        )
        .bind(author_work_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut books = Vec::with_capacity(rows.len());
        for row in rows {
            let release_date = match row.try_get::<Option<String>, _>("release_date")? {
                Some(raw) => Some(codec::parse_date(&raw)?),
                None => None,
            };
            books.push(Book {
                id: codec::parse_uuid(&row.try_get::<String, _>("id")?)?,
                author_work_id,
                title: row.try_get("title")?,
                isbn: row.try_get("isbn")?,
                release_date,
                series_name: row.try_get("series_name")?,
                series_position: row
                    .try_get::<Option<f64>, _>("series_position")?
                    .map(|n| n as f32),
                monitored: row.try_get::<i64, _>("monitored")? != 0,
                availability: codec::availability_from_str(
                    &row.try_get::<String, _>("availability")?,
                )?,
            });
        }
        Ok(books)
    }
}

fn album_type_from_str(raw: &str) -> Result<streamarr_model::AlbumType, CatalogError> {
    use streamarr_model::AlbumType;
    match raw {
        "studio" => Ok(AlbumType::Studio),
        "live" => Ok(AlbumType::Live),
        "compilation" => Ok(AlbumType::Compilation),
        "ep" => Ok(AlbumType::Ep),
        "single" => Ok(AlbumType::Single),
        "soundtrack" => Ok(AlbumType::Soundtrack),
        other => Err(CatalogError::Data(format!("unknown album type {other:?}"))),
    }
}

#[allow(dead_code)] // encode direction: only used by the `#[cfg(test)]` seed helpers
fn album_type_to_str(album_type: streamarr_model::AlbumType) -> &'static str {
    use streamarr_model::AlbumType;
    match album_type {
        AlbumType::Studio => "studio",
        AlbumType::Live => "live",
        AlbumType::Compilation => "compilation",
        AlbumType::Ep => "ep",
        AlbumType::Single => "single",
        AlbumType::Soundtrack => "soundtrack",
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use async_trait::async_trait;
    use chrono::{Duration as ChronoDuration, Utc};
    use streamarr_cache::InMemory;
    use streamarr_model::{
        Availability, ExternalProvider, ExternalRef, ImageAsset, ImageKind, WorkKind,
    };

    use super::*;

    /// An in-process, real-SQL `WorkRepo` double backed by the same
    /// `works`/`work_external_refs` tables `streamarr-db`'s (still
    /// `unimplemented!()`) `SqlxWorkRepo` will eventually own, applied
    /// through the crate's real embedded migrations. Exists so this crate's
    /// tests exercise real SQL/real migrations end-to-end without depending
    /// on that sibling implementation landing first — see the crate-level
    /// doc comment.
    struct TestWorkRepo {
        pool: DbPool,
    }

    impl TestWorkRepo {
        fn new(pool: DbPool) -> Self {
            Self { pool }
        }

        async fn hydrate(&self, row: sqlx::any::AnyRow) -> Result<Work, DbError> {
            let id_str: String = row.try_get("id").map_err(DbError::Backend)?;
            let id = codec::parse_uuid(&id_str)
                .map_err(|e| DbError::Backend(sqlx::Error::Decode(e.to_string().into())))?;
            let kind_str: String = row.try_get("kind").map_err(DbError::Backend)?;
            let kind = codec::work_kind_from_str(&kind_str)
                .map_err(|e| DbError::Backend(sqlx::Error::Decode(e.to_string().into())))?;
            let images_json: String = row.try_get("images").map_err(DbError::Backend)?;
            let genres_json: String = row.try_get("genres").map_err(DbError::Backend)?;
            let tags_json: String = row.try_get("tags").map_err(DbError::Backend)?;
            let images: Vec<ImageAsset> = serde_json::from_str(&images_json)
                .map_err(|e| DbError::Backend(sqlx::Error::Decode(e.to_string().into())))?;
            let genres: Vec<String> = serde_json::from_str(&genres_json)
                .map_err(|e| DbError::Backend(sqlx::Error::Decode(e.to_string().into())))?;
            let tags: Vec<String> = serde_json::from_str(&tags_json)
                .map_err(|e| DbError::Backend(sqlx::Error::Decode(e.to_string().into())))?;
            let added_at_raw: String = row.try_get("added_at").map_err(DbError::Backend)?;
            let added_at = codec::parse_datetime(&added_at_raw)
                .map_err(|e| DbError::Backend(sqlx::Error::Decode(e.to_string().into())))?;
            let monitored = row
                .try_get::<i64, _>("monitored")
                .map_err(DbError::Backend)?
                != 0;
            let availability_raw: String = row.try_get("availability").map_err(DbError::Backend)?;
            let availability = codec::availability_from_str(&availability_raw)
                .map_err(|e| DbError::Backend(sqlx::Error::Decode(e.to_string().into())))?;

            let ref_rows = sqlx::query(
                "SELECT provider, external_id FROM work_external_refs WHERE work_id = ?",
            )
            .bind(&id_str)
            .fetch_all(&self.pool)
            .await
            .map_err(DbError::Backend)?;
            let mut external_refs = Vec::with_capacity(ref_rows.len());
            for r in ref_rows {
                let provider: String = r.try_get("provider").map_err(DbError::Backend)?;
                let external_id: String = r.try_get("external_id").map_err(DbError::Backend)?;
                external_refs.push(ExternalRef {
                    provider: codec::provider_from_str(&provider),
                    external_id,
                });
            }

            Ok(Work {
                id,
                kind,
                external_refs,
                title: row.try_get("title").map_err(DbError::Backend)?,
                sort_title: row.try_get("sort_title").map_err(DbError::Backend)?,
                overview: row.try_get("overview").map_err(DbError::Backend)?,
                images,
                genres,
                tags,
                added_at,
                monitored,
                availability,
            })
        }
    }

    #[async_trait]
    impl WorkRepo for TestWorkRepo {
        async fn get(&self, id: Uuid) -> Result<Work, DbError> {
            let row = sqlx::query(
                "SELECT id, kind, title, sort_title, overview, images, genres, tags, added_at, monitored, availability \
                 FROM works WHERE id = ?",
            )
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(DbError::Backend)?
            .ok_or(DbError::NotFound)?;
            self.hydrate(row).await
        }

        async fn list_by_kind(
            &self,
            kind: WorkKind,
            limit: i64,
            offset: i64,
        ) -> Result<Vec<Work>, DbError> {
            let rows = sqlx::query(
                "SELECT id, kind, title, sort_title, overview, images, genres, tags, added_at, monitored, availability \
                 FROM works WHERE kind = ? ORDER BY sort_title ASC LIMIT ? OFFSET ?",
            )
            .bind(codec::work_kind_to_str(kind))
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(DbError::Backend)?;

            let mut works = Vec::with_capacity(rows.len());
            for row in rows {
                works.push(self.hydrate(row).await?);
            }
            Ok(works)
        }

        async fn upsert(&self, work: &Work) -> Result<(), DbError> {
            let images = serde_json::to_string(&work.images)
                .map_err(|e| DbError::Backend(sqlx::Error::Encode(e.to_string().into())))?;
            let genres = serde_json::to_string(&work.genres)
                .map_err(|e| DbError::Backend(sqlx::Error::Encode(e.to_string().into())))?;
            let tags = serde_json::to_string(&work.tags)
                .map_err(|e| DbError::Backend(sqlx::Error::Encode(e.to_string().into())))?;

            sqlx::query(
                "INSERT INTO works (id, kind, title, sort_title, overview, images, genres, tags, added_at, monitored, availability) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                    kind = excluded.kind, title = excluded.title, sort_title = excluded.sort_title, \
                    overview = excluded.overview, images = excluded.images, genres = excluded.genres, \
                    tags = excluded.tags, added_at = excluded.added_at, monitored = excluded.monitored, \
                    availability = excluded.availability",
            )
            .bind(work.id.to_string())
            .bind(codec::work_kind_to_str(work.kind))
            .bind(&work.title)
            .bind(&work.sort_title)
            .bind(&work.overview)
            .bind(images)
            .bind(genres)
            .bind(tags)
            .bind(codec::format_datetime(work.added_at))
            .bind(work.monitored as i64)
            .bind(codec::availability_to_str(work.availability))
            .execute(&self.pool)
            .await
            .map_err(DbError::Backend)?;

            sqlx::query("DELETE FROM work_external_refs WHERE work_id = ?")
                .bind(work.id.to_string())
                .execute(&self.pool)
                .await
                .map_err(DbError::Backend)?;

            for r in &work.external_refs {
                sqlx::query(
                    "INSERT INTO work_external_refs (work_id, provider, external_id) VALUES (?, ?, ?)",
                )
                .bind(work.id.to_string())
                .bind(codec::provider_to_str(&r.provider))
                .bind(&r.external_id)
                .execute(&self.pool)
                .await
                .map_err(DbError::Backend)?;
            }

            Ok(())
        }

        async fn delete(&self, id: Uuid) -> Result<(), DbError> {
            sqlx::query("DELETE FROM work_external_refs WHERE work_id = ?")
                .bind(id.to_string())
                .execute(&self.pool)
                .await
                .map_err(DbError::Backend)?;
            sqlx::query("DELETE FROM works WHERE id = ?")
                .bind(id.to_string())
                .execute(&self.pool)
                .await
                .map_err(DbError::Backend)?;
            Ok(())
        }

        async fn find_by_external_ref(
            &self,
            provider: &ExternalProvider,
            external_id: &str,
        ) -> Result<Option<Work>, DbError> {
            let row = sqlx::query(
                "SELECT w.id, w.kind, w.title, w.sort_title, w.overview, w.images, w.genres, w.tags, w.added_at, w.monitored, w.availability \
                 FROM works w \
                 JOIN work_external_refs r ON r.work_id = w.id \
                 WHERE r.provider = ? AND r.external_id = ?",
            )
            .bind(codec::provider_to_str(provider))
            .bind(external_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(DbError::Backend)?;

            match row {
                Some(row) => Ok(Some(self.hydrate(row).await?)),
                None => Ok(None),
            }
        }
    }

    /// Opens a fresh in-memory SQLite `DbPool` and applies the real
    /// embedded migrations. Deliberately doesn't go through
    /// `streamarr_db::connect` (which hardcodes `max_connections(10)`):
    /// SQLite's `:memory:`/`mode=memory` databases are private to the
    /// connection that created them, and even `cache=shared` (which lets
    /// *other* connections attach to an already-open named in-memory
    /// database) empirically only reconnects such other connections
    /// reliably while at least one connection to that name is continuously
    /// open — with a multi-connection pool, the moment the pool's
    /// connection count transiently drops to zero (e.g. between the
    /// migration connection being released and the next query acquiring
    /// one), SQLite tears the shared in-memory database down, and the next
    /// connection silently opens a brand-new, unmigrated one (observed
    /// directly: a `SELECT` immediately after `run_migrations` sometimes
    /// saw the just-created tables, sometimes didn't, depending on
    /// scheduling). Pinning `max_connections(1)` makes the pool reuse
    /// exactly one physical connection for the whole test, which sidesteps
    /// the teardown race entirely.
    async fn test_pool() -> DbPool {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let url = format!("sqlite://streamarr_catalog_test_{n}?mode=memory&cache=shared");

        sqlx::any::install_default_drivers();
        let pool: DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("open in-memory sqlite pool");
        streamarr_db::run_migrations(&pool, false)
            .await
            .expect("run real embedded sqlite migrations");
        pool
    }

    fn work_repo(pool: DbPool) -> Arc<dyn WorkRepo> {
        Arc::new(TestWorkRepo::new(pool))
    }

    fn service(pool: DbPool, repo: Arc<dyn WorkRepo>) -> CatalogService {
        CatalogService::new(repo, Arc::new(InMemory::new()), pool)
    }

    fn movie(title: &str, sort_title: &str, genres: &[&str], added_days_ago: i64) -> Work {
        Work {
            id: Uuid::new_v4(),
            kind: WorkKind::Movie,
            external_refs: vec![ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: format!("tmdb-{title}"),
            }],
            title: title.to_string(),
            sort_title: sort_title.to_string(),
            overview: Some(format!("{title} is a great movie about testing.")),
            images: vec![ImageAsset {
                kind: ImageKind::Poster,
                url: format!("https://example.test/{title}.jpg"),
                width: Some(500),
                height: Some(750),
            }],
            genres: genres.iter().map(|g| g.to_string()).collect(),
            tags: vec!["4k".to_string()],
            added_at: Utc::now() - ChronoDuration::days(added_days_ago),
            monitored: true,
            availability: Availability::Available,
        }
    }

    fn series(title: &str, sort_title: &str) -> Work {
        Work {
            kind: WorkKind::Series,
            ..movie(title, sort_title, &["drama"], 0)
        }
    }

    async fn insert_season(
        pool: &DbPool,
        series_work_id: Uuid,
        season_number: i32,
        title: &str,
    ) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO seasons (id, series_work_id, season_number, title, overview, monitored, availability) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(series_work_id.to_string())
        .bind(season_number as i64)
        .bind(title)
        .bind(Option::<String>::None)
        .bind(1i64)
        .bind(codec::availability_to_str(Availability::Available))
        .execute(pool)
        .await
        .expect("insert season");
        id
    }

    async fn insert_episode(pool: &DbPool, season_id: Uuid, episode_number: i32, title: &str) {
        sqlx::query(
            "INSERT INTO episodes (id, season_id, episode_number, title, overview, air_date, runtime_minutes, monitored, availability) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(season_id.to_string())
        .bind(episode_number as i64)
        .bind(title)
        .bind(Option::<String>::None)
        .bind(codec::format_date(
            chrono::NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        ))
        .bind(42i64)
        .bind(1i64)
        .bind(codec::availability_to_str(Availability::Available))
        .execute(pool)
        .await
        .expect("insert episode");
    }

    async fn insert_album(pool: &DbPool, artist_work_id: Uuid, title: &str) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO albums (id, artist_work_id, title, album_type, release_date, monitored, availability) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(artist_work_id.to_string())
        .bind(title)
        .bind(album_type_to_str(streamarr_model::AlbumType::Studio))
        .bind(Option::<String>::None)
        .bind(1i64)
        .bind(codec::availability_to_str(Availability::Available))
        .execute(pool)
        .await
        .expect("insert album");
        id
    }

    async fn insert_track(pool: &DbPool, album_id: Uuid, track_number: u32, title: &str) {
        sqlx::query(
            "INSERT INTO tracks (id, album_id, disc_number, track_number, title, duration_seconds, availability) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(album_id.to_string())
        .bind(1i64)
        .bind(track_number as i64)
        .bind(title)
        .bind(180i64)
        .bind(codec::availability_to_str(Availability::Available))
        .execute(pool)
        .await
        .expect("insert track");
    }

    async fn insert_book(pool: &DbPool, author_work_id: Uuid, title: &str) {
        sqlx::query(
            "INSERT INTO books (id, author_work_id, title, isbn, release_date, series_name, series_position, monitored, availability) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(author_work_id.to_string())
        .bind(title)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<f64>::None)
        .bind(1i64)
        .bind(codec::availability_to_str(Availability::Available))
        .execute(pool)
        .await
        .expect("insert book");
    }

    #[tokio::test]
    async fn browse_paginates_and_reports_total() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        for i in 0..5 {
            repo.upsert(&movie(
                &format!("Movie {i}"),
                &format!("Movie {i}"),
                &["action"],
                i,
            ))
            .await
            .unwrap();
        }
        let svc = service(pool, repo);

        let page = svc
            .browse(BrowseQuery {
                limit: 2,
                offset: 0,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(page.total, Some(5));
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[0].title, "Movie 0");
        assert_eq!(page.items[1].title, "Movie 1");

        let last_page = svc
            .browse(BrowseQuery {
                limit: 2,
                offset: 4,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(last_page.total, Some(5));
        assert_eq!(last_page.items.len(), 1);
        assert_eq!(last_page.items[0].title, "Movie 4");

        let past_end = svc
            .browse(BrowseQuery {
                limit: 2,
                offset: 10,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(past_end.total, Some(5));
        assert!(past_end.items.is_empty());
    }

    #[tokio::test]
    async fn browse_filters_by_kind_and_genre() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        repo.upsert(&movie("Action Movie", "Action Movie", &["action"], 0))
            .await
            .unwrap();
        repo.upsert(&movie("Comedy Movie", "Comedy Movie", &["comedy"], 0))
            .await
            .unwrap();
        repo.upsert(&Work {
            kind: WorkKind::Series,
            ..movie("Action Series", "Action Series", &["action"], 0)
        })
        .await
        .unwrap();
        let svc = service(pool, repo);

        let movies_only = svc
            .browse(BrowseQuery {
                kind: Some(WorkKind::Movie),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(movies_only.items.len(), 2);
        assert!(movies_only.items.iter().all(|w| w.kind == WorkKind::Movie));

        let action_only = svc
            .browse(BrowseQuery {
                genre: Some("Action".to_string()), // case-insensitive
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(action_only.items.len(), 2);
        assert!(action_only
            .items
            .iter()
            .all(|w| w.genres.iter().any(|g| g.eq_ignore_ascii_case("action"))));
    }

    #[tokio::test]
    async fn browse_recently_added_sorts_newest_first() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        repo.upsert(&movie("Old", "Old", &[], 10)).await.unwrap();
        repo.upsert(&movie("New", "New", &[], 0)).await.unwrap();
        repo.upsert(&movie("Mid", "Mid", &[], 5)).await.unwrap();
        let svc = service(pool, repo);

        let page = svc
            .browse(BrowseQuery {
                sort: BrowseSort::RecentlyAdded,
                ..Default::default()
            })
            .await
            .unwrap();
        let titles: Vec<&str> = page.items.iter().map(|w| w.title.as_str()).collect();
        assert_eq!(titles, vec!["New", "Mid", "Old"]);
    }

    #[tokio::test]
    async fn search_matches_title_and_overview_case_insensitively() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        repo.upsert(&movie("Sample Movie India", "Great Escape, The", &[], 0))
            .await
            .unwrap();
        repo.upsert(&movie("Unrelated", "Unrelated", &[], 0))
            .await
            .unwrap();
        let svc = service(pool, repo);

        let by_title = svc.search("great escape", 10).await.unwrap();
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].title, "Sample Movie India");

        let by_overview = svc.search("TESTING", 10).await.unwrap();
        assert_eq!(by_overview.len(), 2); // both fixtures' overview mentions "testing"

        let no_match = svc.search("nonexistent-needle", 10).await.unwrap();
        assert!(no_match.is_empty());

        let blank = svc.search("   ", 10).await.unwrap();
        assert!(blank.is_empty());
    }

    #[tokio::test]
    async fn search_respects_limit() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        for i in 0..5 {
            repo.upsert(&movie(
                &format!("Findme {i}"),
                &format!("Findme {i}"),
                &[],
                i,
            ))
            .await
            .unwrap();
        }
        let svc = service(pool, repo);

        let results = svc.search("findme", 3).await.unwrap();
        assert_eq!(results.len(), 3);
    }

    #[tokio::test]
    async fn get_by_id_returns_full_tree_for_series() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let show = series("Test Show", "Test Show");
        let show_id = show.id;
        repo.upsert(&show).await.unwrap();

        let season_id = insert_season(&pool, show_id, 1, "Season One").await;
        insert_episode(&pool, season_id, 1, "Pilot").await;
        insert_episode(&pool, season_id, 2, "Episode Two").await;

        let svc = service(pool, repo);
        let detail = svc.get_by_id(show_id).await.unwrap();

        assert_eq!(detail.work.id, show_id);
        match detail.children {
            WorkChildren::Series(seasons) => {
                assert_eq!(seasons.len(), 1);
                assert_eq!(seasons[0].season.season_number, 1);
                assert_eq!(seasons[0].episodes.len(), 2);
                assert_eq!(seasons[0].episodes[0].title.as_deref(), Some("Pilot"));
                assert_eq!(seasons[0].episodes[1].title.as_deref(), Some("Episode Two"));
            }
            other => panic!("expected WorkChildren::Series, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn get_by_id_returns_full_tree_for_artist() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let artist = Work {
            kind: WorkKind::Artist,
            ..movie("Test Artist", "Test Artist", &[], 0)
        };
        let artist_id = artist.id;
        repo.upsert(&artist).await.unwrap();

        let album_id = insert_album(&pool, artist_id, "Test Album").await;
        insert_track(&pool, album_id, 1, "Track One").await;
        insert_track(&pool, album_id, 2, "Track Two").await;

        let svc = service(pool, repo);
        let detail = svc.get_by_id(artist_id).await.unwrap();

        match detail.children {
            WorkChildren::Artist(albums) => {
                assert_eq!(albums.len(), 1);
                assert_eq!(albums[0].tracks.len(), 2);
                assert_eq!(albums[0].tracks[0].track_number, 1);
            }
            other => panic!("expected WorkChildren::Artist, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn get_by_id_returns_full_tree_for_author() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let author = Work {
            kind: WorkKind::Author,
            ..movie("Test Author", "Test Author", &[], 0)
        };
        let author_id = author.id;
        repo.upsert(&author).await.unwrap();
        insert_book(&pool, author_id, "First Book").await;
        insert_book(&pool, author_id, "Second Book").await;

        let svc = service(pool, repo);
        let detail = svc.get_by_id(author_id).await.unwrap();

        match detail.children {
            WorkChildren::Author(books) => assert_eq!(books.len(), 2),
            other => panic!("expected WorkChildren::Author, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn get_by_id_movie_has_no_children() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let film = movie("Solo Movie", "Solo Movie", &[], 0);
        let film_id = film.id;
        repo.upsert(&film).await.unwrap();

        let svc = service(pool, repo);
        let detail = svc.get_by_id(film_id).await.unwrap();
        assert!(matches!(detail.children, WorkChildren::Movie));
    }

    #[tokio::test]
    async fn get_by_id_missing_work_is_not_found() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let svc = service(pool, repo);

        let err = svc.get_by_id(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, CatalogError::NotFound));
    }

    #[tokio::test]
    async fn browse_result_is_cached_across_calls() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        repo.upsert(&movie("Cached Movie", "Cached Movie", &[], 0))
            .await
            .unwrap();
        let svc = service(pool.clone(), repo.clone());

        let first = svc.browse(BrowseQuery::default()).await.unwrap();
        assert_eq!(first.items.len(), 1);

        // Delete straight through the repo (bypassing the service/cache) —
        // a cached `browse` should still see the now-stale result, proving
        // the cache path was actually exercised rather than re-querying.
        repo.delete(first.items[0].id).await.unwrap();

        let second = svc.browse(BrowseQuery::default()).await.unwrap();
        assert_eq!(
            second.items.len(),
            1,
            "expected the cached page, not a fresh (now-empty) query"
        );
    }
}

/// A second, independent confirmation on top of the `tests` module above:
/// the primary suite deliberately uses its own SQL-backed `WorkRepo` double
/// (see that module's doc comment for why — `SqlxWorkRepo` was still
/// `unimplemented!()` when this crate's tests were first written), so it
/// can't by itself prove `CatalogService` works against the *real*
/// production `streamarr_db::repo::SqlxWorkRepo`. Now that that landed for
/// real (concurrently, in the sibling task this crate was built against),
/// this module exercises `CatalogService` against it directly — same
/// migrations, same schema, real repository — as a final end-to-end check
/// that the two crates actually interoperate rather than merely each
/// satisfying the `WorkRepo` trait in isolation.
#[cfg(test)]
mod real_work_repo_integration {
    use std::sync::Arc;

    use chrono::Utc;
    use streamarr_cache::InMemory;
    use streamarr_db::repo::SqlxWorkRepo;
    use streamarr_model::{Availability, ExternalProvider, ExternalRef, WorkKind};
    use uuid::Uuid;

    use super::*;

    async fn ad_hoc_pool() -> DbPool {
        sqlx::any::install_default_drivers();
        let pool: DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite://streamarr_catalog_real_repo_test?mode=memory&cache=shared")
            .await
            .unwrap();
        streamarr_db::run_migrations(&pool, false).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn works_against_the_real_production_work_repo() {
        let pool = ad_hoc_pool().await;
        let repo: Arc<dyn WorkRepo> = Arc::new(SqlxWorkRepo::new(pool.clone()));

        let work = Work {
            id: Uuid::new_v4(),
            kind: WorkKind::Movie,
            external_refs: vec![ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: "42".to_string(),
            }],
            title: "Real Repo Movie".to_string(),
            sort_title: "Real Repo Movie".to_string(),
            overview: Some("Exercises the real SqlxWorkRepo, not the test double.".to_string()),
            images: vec![],
            genres: vec!["sci-fi".to_string()],
            tags: vec![],
            added_at: Utc::now(),
            monitored: true,
            availability: Availability::Available,
        };
        repo.upsert(&work)
            .await
            .expect("upsert via real SqlxWorkRepo");

        let svc = CatalogService::new(repo, Arc::new(InMemory::new()), pool);

        let page = svc.browse(BrowseQuery::default()).await.expect("browse");
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].title, "Real Repo Movie");

        let found = svc.search("real repo", 10).await.expect("search");
        assert_eq!(found.len(), 1);

        let detail = svc.get_by_id(work.id).await.expect("get_by_id");
        assert_eq!(detail.work.title, "Real Repo Movie");
        assert!(matches!(detail.children, WorkChildren::Movie));
    }
}
