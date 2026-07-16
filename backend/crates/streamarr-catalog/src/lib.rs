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
use streamarr_db::{DbError, DbPool, MediaFileRepo, WatchProgressRepo, WorkRepo};
use streamarr_model::media::LeafRef;
use streamarr_model::{Album, Book, Episode, ImageAsset, Season, Track, Work, WorkKind};
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
    TitleDescending,
    RecentlyAdded,
    OldestAdded,
    /// Descending by [`streamarr_model::Work::release_date`] -- backs the
    /// "Newly Released" saved view (see [`CatalogService::resolve_view`]).
    ReleaseDateDescending,
}

/// Filter/sort/page parameters for [`CatalogService::browse`]. A struct
/// rather than positional arguments so the API layer can grow new filter
/// dimensions (e.g. availability, monitored-only) without breaking every
/// call site.
#[derive(Debug, Clone)]
pub struct BrowseQuery {
    pub kind: Option<WorkKind>,
    /// Restricts results to works that own at least one synced media file.
    /// This deliberately follows actual playable leaves rather than the
    /// aggregate availability field: Sonarr series can have available
    /// episodes while their top-level work is still `unknown`. Defaults to
    /// `false` so Streamarr Admin can inspect every catalog state.
    pub available_only: bool,
    /// Restricts results to works with at least one synced [`MediaFile`]
    /// whose `source_instance_id` matches -- the "library" filter for the
    /// admin Library page, letting two source instances of the same kind
    /// (e.g. two Radarr instances for a 4K library and a 1080p library)
    /// browse separately.
    ///
    /// Lives on `MediaFile`, not `Work`/`ExternalRef`: `streamarr_model::
    /// Work` has no source-instance-provenance field of its own yet (see
    /// `streamarr_arr_sync::poller::InstancePoller::reconcile_all`'s doc
    /// comment, which flags this as a known gap), so this filters through
    /// the leaf-level `MediaFile` table instead of an in-memory field on
    /// the already-loaded `Work` -- see [`CatalogService::browse`]'s doc
    /// comment for the cost that implies.
    ///
    /// [`MediaFile`]: streamarr_model::MediaFile
    pub source_instance_id: Option<Uuid>,
    pub genre: Option<String>,
    pub tag: Option<String>,
    /// Restricts results to works whose `release_date` falls within the
    /// last N days (`None` = no restriction). Backs the "Newly Released"
    /// saved view's window and the `ViewCriteria::release_window_days`
    /// field it mirrors -- see [`CatalogService::resolve_view`].
    pub release_window_days: Option<i64>,
    pub sort: BrowseSort,
    pub limit: i64,
    pub offset: i64,
    /// Per-user library access control (`streamarr_model::Policy::
    /// library_allow`), resolved by the API layer's `CatalogViewer`/
    /// `StreamingUser` extractors -- `None` means an unrestricted (admin or
    /// system) caller, `Some(ids)` (including an empty `Vec`) restricts
    /// results to works with at least one synced [`MediaFile`] whose
    /// `source_instance_id` is in that set. Distinct from
    /// [`Self::source_instance_id`] above: that field is a single caller-
    /// chosen browse filter (the admin Library page picking one library to
    /// view), this one is an *enforced ceiling* on every caller regardless
    /// of what they asked to browse -- both can be set at once, in which
    /// case a work must satisfy both. See [`CatalogService::browse`]'s doc
    /// comment for how the two combine in a single per-candidate pass.
    ///
    /// [`MediaFile`]: streamarr_model::MediaFile
    pub allowed_source_instance_ids: Option<Vec<Uuid>>,
}

impl Default for BrowseQuery {
    fn default() -> Self {
        Self {
            kind: None,
            available_only: false,
            source_instance_id: None,
            genre: None,
            tag: None,
            release_window_days: None,
            sort: BrowseSort::TitleAscending,
            limit: 50,
            offset: 0,
            // Unrestricted by default -- enforcement is opt-in per caller,
            // set explicitly by the API layer from a resolved `Policy`, not
            // implied by merely constructing a query.
            allowed_source_instance_ids: None,
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

/// An [`Episode`] plus the resolved id of the [`streamarr_model::MediaFile`]
/// that plays it (via [`streamarr_db::MediaFileRepo::find_by_leaf`],
/// `LeafRef::Episode(episode.id)`), or `None` when no file has synced for
/// this episode yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EpisodeDetail {
    pub episode: Episode,
    pub media_file_id: Option<Uuid>,
    /// Fixed source-container runtime for the playable episode file.
    pub runtime_ms: Option<u64>,
}

/// A season plus its episodes, as returned inside [`WorkDetail`] for a
/// `WorkKind::Series` or `WorkKind::Site` work.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeasonDetail {
    pub season: Season,
    pub episodes: Vec<EpisodeDetail>,
}

/// A [`Track`] plus its resolved `media_file_id` (`LeafRef::Track(track.id)`);
/// see [`EpisodeDetail`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrackDetail {
    pub track: Track,
    pub media_file_id: Option<Uuid>,
    /// Fixed source-container runtime for the playable track file.
    pub runtime_ms: Option<u64>,
}

/// An album plus its tracks, as returned inside [`WorkDetail`] for a
/// `WorkKind::Artist` work.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlbumDetail {
    pub album: Album,
    pub tracks: Vec<TrackDetail>,
}

/// A [`Book`] plus its resolved `media_file_id` (`LeafRef::Book(book.id)`);
/// see [`EpisodeDetail`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BookDetail {
    pub book: Book,
    pub media_file_id: Option<Uuid>,
}

/// The kind-specific "full tree" hanging off a [`Work`] in
/// [`CatalogService::get_by_id`]'s result. `Site` reuses the series-shaped
/// tree because Whisparr exposes sites and scenes through Sonarr-compatible
/// series and episode resources.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkChildren {
    Movie,
    Series(Vec<SeasonDetail>),
    Artist(Vec<AlbumDetail>),
    Author(Vec<BookDetail>),
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
    /// The resolved `MediaFile` id for this work's own leaf
    /// (`LeafRef::Work`) -- only ever populated for a `WorkKind::Movie`
    /// work, since that's the only kind whose file *is* the work itself
    /// rather than one of its children (see [`streamarr_model::media::LeafRef`]).
    /// `None` for every other kind, and for a movie with no file synced yet.
    pub media_file_id: Option<Uuid>,
    /// Fixed source-container runtime for a movie's own playable file.
    /// Series runtimes live on each [`EpisodeDetail`].
    pub runtime_ms: Option<u64>,
}

/// Upper bound on how many rows [`CatalogService::browse`]/`search` scan
/// (per `WorkKind`) before filtering/sorting/paginating in memory. See
/// those methods' doc comments for why this exists instead of pushing
/// genre/tag filtering and search into SQL.
const SCAN_LIMIT: i64 = 100_000;

const BROWSE_CACHE_TTL: Duration = Duration::from_secs(30);
const SEARCH_CACHE_TTL: Duration = Duration::from_secs(30);
const WORK_DETAIL_CACHE_TTL: Duration = Duration::from_secs(60);

const ALL_KINDS: [WorkKind; 5] = [
    WorkKind::Movie,
    WorkKind::Series,
    WorkKind::Site,
    WorkKind::Artist,
    WorkKind::Author,
];

/// Includes [`BrowseQuery::allowed_source_instance_ids`] -- this is
/// correctness-critical, not cosmetic: without it, a page cached for one
/// caller's allowed library set could be served straight back out to a
/// different caller with a different (or no) restriction, leaking content
/// the second caller has no `Policy::library_allow` grant to see. Formatted
/// via `{:?}` on the `Option<Vec<Uuid>>` directly, same as every other
/// field here -- two different allowed-sets (including `None` vs. `Some`)
/// always produce two different keys.
fn browse_cache_key(query: &BrowseQuery) -> String {
    format!(
        "catalog:browse:{:?}:{}:{:?}:{:?}:{:?}:{:?}:{:?}:{}:{}:{:?}",
        query.kind,
        query.available_only,
        query.source_instance_id,
        query.genre,
        query.tag,
        query.release_window_days,
        query.sort,
        query.limit,
        query.offset,
        query.allowed_source_instance_ids,
    )
}

/// Includes `allowed` -- same cross-caller cache-leak reasoning as
/// [`browse_cache_key`].
fn search_cache_key(needle: &str, limit: i64, allowed: Option<&[Uuid]>) -> String {
    format!("catalog:search:{needle}:{limit}:{allowed:?}")
}

/// Below this [`strsim::jaro_winkler`] score (`[0.0, 1.0]`, `1.0` =
/// identical), a fuzzy word-pair is treated as unrelated rather than a
/// near-miss -- calibrated so a couple of transposed/dropped letters
/// ("Bramblefrod" vs "Brambleford") still matches but genuinely different
/// short words don't collide.
const FUZZY_MATCH_THRESHOLD: f64 = 0.82;

/// Locale/diacritic folding for [`CatalogService::search`]: Unicode NFKD
/// decomposition (splits a precomposed character like `é` into `e` +
/// a combining acute accent), then drops every combining-mark codepoint
/// (the `U+0300`-`U+036F` Combining Diacritical Marks block covers the
/// overwhelming majority of real-world cases -- accented Latin scripts),
/// then lowercases. `"Sémon"` and `"Semon"` fold to the same string;
/// so do `"café"`/`"cafe"`, `"Zürich"`/`"Zurich"`, `"naïve"`/`"naive"`.
fn fold_locale(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    s.nfkd()
        .filter(|c| !(0x0300..=0x036F).contains(&(*c as u32)))
        .collect::<String>()
        .to_lowercase()
}

/// Search-result ranking tier -- `Ord` so exact substring hits always
/// sort before fuzzy ones regardless of fuzzy score (see
/// [`CatalogService::search`]'s doc comment).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MatchTier {
    Exact,
    Fuzzy,
}

/// Best per-query-word fuzzy score against any word in `haystack_words`.
fn best_word_score(query_word: &str, haystack_words: &[&str]) -> f64 {
    haystack_words
        .iter()
        .map(|word| strsim::jaro_winkler(query_word, word))
        .fold(0.0_f64, f64::max)
}

/// Scores `work` against a already-[`fold_locale`]-folded `needle`.
/// Returns `None` when neither an exact substring nor a fuzzy match
/// clears [`FUZZY_MATCH_THRESHOLD`] -- i.e. this work isn't a result at
/// all. See [`CatalogService::search`]'s doc comment for the two-tier
/// scheme this backs.
fn score_search_match(work: &Work, needle: &str) -> Option<(MatchTier, f64)> {
    let folded_title = fold_locale(&work.title);
    let folded_overview = work.overview.as_deref().map(fold_locale);

    if folded_title.contains(needle)
        || folded_overview
            .as_deref()
            .is_some_and(|o| o.contains(needle))
    {
        return Some((MatchTier::Exact, 1.0));
    }

    let query_words: Vec<&str> = needle.split_whitespace().collect();
    if query_words.is_empty() {
        return None;
    }
    let title_words: Vec<&str> = folded_title.split_whitespace().collect();
    if title_words.is_empty() {
        return None;
    }

    let mean_score: f64 = query_words
        .iter()
        .map(|query_word| best_word_score(query_word, &title_words))
        .sum::<f64>()
        / query_words.len() as f64;

    (mean_score >= FUZZY_MATCH_THRESHOLD).then_some((MatchTier::Fuzzy, mean_score))
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
    /// Resolves each playable leaf's `media_file_id` in
    /// [`CatalogService::get_by_id`] (`MediaFileRepo::find_by_leaf`) — kept
    /// distinct from `work_repo` the same way `streamarr-db` keeps
    /// `MediaFileRepo` distinct from `WorkRepo` (see that trait's doc
    /// comment): a `MediaFile` is leaf-level, not part of the `Work`
    /// aggregate.
    media_file_repo: Arc<dyn MediaFileRepo>,
    cache: Arc<dyn CacheAndPubSub>,
    /// Backs only the season/episode/album/track/book "full tree" lookups
    /// in [`CatalogService::get_by_id`] — every `Work` row itself is always
    /// read through `work_repo`, never through this pool. See the crate
    /// doc comment for why `get_by_id` needs a second data source at all.
    pool: DbPool,
    /// Backs [`CatalogService::resolve_view`]'s `LastPlayedByUser` sort key
    /// only — every other method ignores this entirely. Kept as its own
    /// field (not looked up ad hoc) so tests can seed a fake without
    /// touching the real `pool`.
    watch_progress_repo: Arc<dyn WatchProgressRepo>,
    /// Backs [`CatalogService::similar`] only. `None` by default (builder
    /// opt-in via [`Self::with_embedding_repo`], same shape
    /// `streamarr-arr-sync::poller::ReconciliationPoller`'s optional
    /// steps use) — a deployment that hasn't wired embedding generation
    /// simply has `similar` report `CatalogError::NotFound` rather than
    /// every other constructor call site needing a repo it doesn't have.
    embedding_repo: Option<Arc<dyn streamarr_db::EmbeddingRepo>>,
}

impl CatalogService {
    pub fn new(
        work_repo: Arc<dyn WorkRepo>,
        media_file_repo: Arc<dyn MediaFileRepo>,
        cache: Arc<dyn CacheAndPubSub>,
        pool: DbPool,
        watch_progress_repo: Arc<dyn WatchProgressRepo>,
    ) -> Self {
        Self {
            work_repo,
            media_file_repo,
            cache,
            pool,
            watch_progress_repo,
            embedding_repo: None,
        }
    }

    /// Opts this service's [`Self::similar`] into real results -- see
    /// that method's doc comment and the `embedding_repo` field's.
    pub fn with_embedding_repo(
        mut self,
        embedding_repo: Arc<dyn streamarr_db::EmbeddingRepo>,
    ) -> Self {
        self.embedding_repo = Some(embedding_repo);
        self
    }

    /// Filtered, sorted, paginated listing — the query backing library
    /// browse/grid views.
    ///
    /// `WorkRepo::list_by_kind` only supports a kind filter and a fixed
    /// `sort_title` order, so availability/genre/tag filtering, the
    /// `RecentlyAdded` sort, and the total count are all done here in memory over up to
    /// [`SCAN_LIMIT`] rows per matching kind. That's the right trade-off for
    /// the catalog sizes this targets (a personal/family media server —
    /// thousands, not millions, of works); if `WorkRepo` grows a
    /// filter/sort-aware query (or this crate grows its own indexed read
    /// model) later, this is the method to swap over.
    ///
    /// `source_instance_id` filtering is a further step past that: since
    /// `Work` doesn't carry which source instance(s) contributed it (see
    /// [`BrowseQuery::source_instance_id`]'s doc comment), each remaining
    /// candidate (after the kind/genre/tag filters above have already
    /// shrunk the set) is checked with one `MediaFileRepo::list_by_work_id`
    /// call. That's an extra query per candidate rather than a single bulk
    /// one, but only paid when a caller actually asks for this filter, and
    /// the same "personal media server" scale trade-off as the rest of this
    /// method applies.
    ///
    /// [`BrowseQuery::allowed_source_instance_ids`] (the enforced per-user
    /// library access control ceiling, as opposed to `source_instance_id`'s
    /// single caller-chosen filter) is folded into that exact same per-
    /// candidate `list_by_work_id` pass rather than a second one -- a
    /// candidate survives only if it clears *both* checks, and each
    /// candidate's files are only ever fetched once regardless of how many
    /// of the two filters are actually active.
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

        if query.available_only {
            let playable_work_ids = self.media_file_repo.list_work_ids().await?;
            candidates.retain(|work| playable_work_ids.contains(&work.id));
        }
        if let Some(genre) = query.genre.as_deref() {
            candidates.retain(|w| w.genres.iter().any(|g| g.eq_ignore_ascii_case(genre)));
        }
        if let Some(tag) = query.tag.as_deref() {
            candidates.retain(|w| w.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)));
        }
        if query.source_instance_id.is_some() || query.allowed_source_instance_ids.is_some() {
            let mut matched = Vec::with_capacity(candidates.len());
            for work in candidates {
                let files = self.media_file_repo.list_by_work_id(work.id).await?;
                let matches_explicit_filter = query
                    .source_instance_id
                    .is_none_or(|wanted| files.iter().any(|f| f.source_instance_id == wanted));
                let matches_allow_list =
                    query
                        .allowed_source_instance_ids
                        .as_ref()
                        .is_none_or(|allowed| {
                            files
                                .iter()
                                .any(|f| allowed.contains(&f.source_instance_id))
                        });
                if matches_explicit_filter && matches_allow_list {
                    matched.push(work);
                }
            }
            candidates = matched;
        }
        if let Some(days) = query.release_window_days {
            let cutoff = chrono::Utc::now() - chrono::Duration::days(days);
            candidates.retain(|w| w.release_date.is_some_and(|rd| rd >= cutoff));
        }

        match query.sort {
            BrowseSort::TitleAscending => {
                candidates.sort_by(|a, b| a.sort_title.cmp(&b.sort_title));
            }
            BrowseSort::TitleDescending => {
                candidates.sort_by(|a, b| b.sort_title.cmp(&a.sort_title));
            }
            BrowseSort::RecentlyAdded => {
                candidates.sort_by(|a, b| b.added_at.cmp(&a.added_at));
            }
            BrowseSort::OldestAdded => {
                candidates.sort_by(|a, b| a.added_at.cmp(&b.added_at));
            }
            BrowseSort::ReleaseDateDescending => {
                // `Option<DateTime<Utc>>`'s derived `Ord` treats `None` as
                // smaller than any `Some`, so this descending comparator
                // naturally pushes works with no release_date (Artist/
                // Author, or a Movie/Series arr-sync hasn't backfilled yet)
                // to the bottom rather than the top.
                candidates.sort_by(|a, b| b.release_date.cmp(&a.release_date));
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

    /// Runs a saved [`streamarr_model::LibraryView`]'s criteria+sort through
    /// [`Self::browse`], with caller-supplied pagination layered on top the
    /// same way `BrowseQueryParams`/`browse_catalog_handler` already does.
    /// This is the one place a `LibraryView` ever becomes real `Work` rows --
    /// see that type's doc comment.
    ///
    /// `user_id` is the *resolving caller's own* id -- required for the
    /// `ViewSort::LastPlayedByUser` sort key to do anything (see that
    /// variant's own doc comment for why it's meaningless without one);
    /// every other sort key ignores it entirely. `None` collapses
    /// `LastPlayedByUser` back to a no-op tie (every work ties for that
    /// key), so an unauthenticated/system caller resolving a view that
    /// happens to use it still gets a deterministic result via whatever
    /// sort key comes next, rather than an error.
    ///
    /// `allowed_source_instance_ids` is the per-user library access control
    /// ceiling (see [`BrowseQuery::allowed_source_instance_ids`]), threaded
    /// straight onto the inner `BrowseQuery` this builds -- a saved view is
    /// just a stored `BrowseQuery` shape plus a sort, so it's gated by
    /// exactly the same enforcement `browse` itself applies, not a
    /// second/different check.
    pub async fn resolve_view(
        &self,
        view: &streamarr_model::LibraryView,
        user_id: Option<Uuid>,
        limit: i64,
        offset: i64,
        allowed_source_instance_ids: Option<Vec<Uuid>>,
    ) -> Result<CatalogPage, CatalogError> {
        let c = &view.criteria;
        let mut page = self
            .browse(BrowseQuery {
                kind: c.kind,
                available_only: c.available_only,
                source_instance_id: c.source_instance_id,
                genre: c.genre.clone(),
                tag: c.tag.clone(),
                release_window_days: c.release_window_days,
                // Fetch the complete filtered candidate set before applying
                // the view's ordered multi-sort and caller pagination below.
                sort: BrowseSort::TitleAscending,
                limit: SCAN_LIMIT,
                offset: 0,
                allowed_source_instance_ids,
            })
            .await?;

        let sort_keys = if view.sort.is_empty() {
            &[streamarr_model::ViewSort::TitleAscending][..]
        } else {
            view.sort.as_slice()
        };

        // Only fetched when actually needed: a `LastPlayedByUser` key is
        // present in this view AND we have a real caller to look it up
        // for. `WatchProgress::updated_at` (the existing per-user resume-
        // position timestamp, already touched on every real playback) is
        // the "last played" signal -- there is no separate dedicated field
        // for it, and building one would duplicate data this repo already
        // maintains for a different purpose. Keyed by `work_id`, not
        // `media_file_id`: a series has many media files (one per episode)
        // but the sort operates on whole `Work`s, so the *most recent*
        // touch across all of a work's files is what "last played" means
        // here -- `HashMap::entry` + `Ord::max` below folds duplicates
        // down to that single latest timestamp per work.
        let last_played: std::collections::HashMap<Uuid, chrono::DateTime<chrono::Utc>> = if user_id
            .is_some()
            && sort_keys.contains(&streamarr_model::ViewSort::LastPlayedByUser)
        {
            let uid = user_id.expect("checked Some above");
            let mut map = std::collections::HashMap::new();
            for progress in self.watch_progress_repo.list_for_user(uid).await? {
                if let Some(updated_at) = progress.updated_at {
                    map.entry(progress.work_id)
                        .and_modify(|existing: &mut chrono::DateTime<chrono::Utc>| {
                            if updated_at > *existing {
                                *existing = updated_at;
                            }
                        })
                        .or_insert(updated_at);
                }
            }
            map
        } else {
            std::collections::HashMap::new()
        };

        // `slice::sort_by` is stable. Applying the least-significant key
        // first therefore preserves it as the tie-breaker when each more
        // significant key is layered on afterwards.
        for sort in sort_keys.iter().rev() {
            match sort {
                streamarr_model::ViewSort::TitleAscending => {
                    page.items.sort_by(|a, b| a.sort_title.cmp(&b.sort_title));
                }
                streamarr_model::ViewSort::TitleDescending => {
                    page.items.sort_by(|a, b| b.sort_title.cmp(&a.sort_title));
                }
                streamarr_model::ViewSort::RecentlyAdded => {
                    page.items.sort_by(|a, b| b.added_at.cmp(&a.added_at));
                }
                streamarr_model::ViewSort::OldestAdded => {
                    page.items.sort_by(|a, b| a.added_at.cmp(&b.added_at));
                }
                streamarr_model::ViewSort::RecentlyReleased => {
                    page.items
                        .sort_by(|a, b| b.release_date.cmp(&a.release_date));
                }
                streamarr_model::ViewSort::LastPlayedByUser => {
                    // A work this user never played has no entry in
                    // `last_played` -- `Option<DateTime>`'s derived `Ord`
                    // treats `None` as smaller than any `Some`, so the same
                    // descending-comparator trick `ReleaseDateDescending`
                    // already relies on naturally pushes never-played works
                    // to the bottom here too.
                    page.items
                        .sort_by(|a, b| last_played.get(&b.id).cmp(&last_played.get(&a.id)));
                }
            }
        }

        let total = page.items.len() as i64;
        let offset = offset.max(0) as usize;
        let limit = limit.max(0) as usize;
        page.items = page.items.into_iter().skip(offset).take(limit).collect();
        page.total = Some(total);
        Ok(page)
    }

    /// Free-text search over `title`/`overview` across every `WorkKind`,
    /// tolerant of misspellings and locale/diacritic differences (e.g.
    /// "Semon" finding "Sémon", "cafe" finding "Café"). Three tiers,
    /// each strictly outranking the next, so an exact hit is never pushed
    /// down by a merely-close fuzzy one:
    ///
    /// 1. Exact substring match (after [`fold_locale`] normalization) on
    ///    title or overview — the same behavior the original plain
    ///    `.contains()` scan had, just diacritic-insensitive now.
    /// 2. Fuzzy title match: [`strsim::jaro_winkler`] scored per query
    ///    word against every title word, admitted only above
    ///    [`FUZZY_MATCH_THRESHOLD`] — this is what catches "Bramblefrod"
    ///    finding "Brambleford" without also matching everything vaguely
    ///    similar.
    ///
    /// Within each tier, results are ordered by score (ties broken
    /// alphabetically). A blank/whitespace-only query returns no results
    /// rather than the whole catalog. `limit` is a hard cap, not a page
    /// size — search results aren't expected to paginate past the first
    /// screen.
    ///
    /// `allowed_source_instance_ids` is the same per-user library access
    /// control ceiling [`BrowseQuery::allowed_source_instance_ids`] applies
    /// to `browse` -- `None` for an unrestricted caller, `Some(ids)`
    /// (including empty) to restrict matches to works with at least one
    /// synced file from one of those source instances. Applied via the same
    /// per-match `MediaFileRepo::list_by_work_id` check `browse` uses,
    /// after scoring/sorting but before truncating to `limit` -- filtering
    /// first would mean a restricted caller's search could return fewer
    /// than `limit` results even when enough matches exist server-wide,
    /// silently changing their experience versus an unrestricted caller's;
    /// filtering the already-ranked full match set instead means a
    /// restricted caller sees exactly the same ranking, just with
    /// disallowed entries removed.
    pub async fn search(
        &self,
        query: &str,
        limit: i64,
        allowed_source_instance_ids: Option<&[Uuid]>,
    ) -> Result<Vec<Work>, CatalogError> {
        let raw_needle = query.trim();
        let limit = limit.max(0) as usize;

        if raw_needle.is_empty() {
            return Ok(Vec::new());
        }
        let needle = fold_locale(raw_needle);

        let cache_key = search_cache_key(&needle, limit as i64, allowed_source_instance_ids);
        if let Some(cached) = self.cache.get(&cache_key).await? {
            if let Ok(items) = serde_json::from_slice::<Vec<Work>>(&cached) {
                return Ok(items);
            }
        }

        let mut scored: Vec<(Work, MatchTier, f64)> = Vec::new();
        for kind in ALL_KINDS {
            let candidates = self.work_repo.list_by_kind(kind, SCAN_LIMIT, 0).await?;
            for work in candidates {
                if let Some((tier, score)) = score_search_match(&work, &needle) {
                    scored.push((work, tier, score));
                }
            }
        }

        // Exact-substring tier always outranks fuzzy, then by score
        // descending, then alphabetical -- same "stable, good-enough
        // relevance ordering" spirit the original plain-substring search
        // already used, extended with a real score for the fuzzy tier.
        scored.sort_by(|(work_a, tier_a, score_a), (work_b, tier_b, score_b)| {
            tier_a
                .cmp(tier_b)
                .then_with(|| {
                    score_b
                        .partial_cmp(score_a)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| work_a.sort_title.cmp(&work_b.sort_title))
        });

        let mut matches: Vec<Work> = Vec::with_capacity(scored.len().min(limit.max(1)));
        for (work, _, _) in scored {
            if matches.len() >= limit {
                break;
            }
            if let Some(allowed) = allowed_source_instance_ids {
                let files = self.media_file_repo.list_by_work_id(work.id).await?;
                if !files
                    .iter()
                    .any(|f| allowed.contains(&f.source_instance_id))
                {
                    continue;
                }
            }
            matches.push(work);
        }

        if let Ok(bytes) = serde_json::to_vec(&matches) {
            self.cache
                .set(&cache_key, bytes, Some(SEARCH_CACHE_TTL))
                .await?;
        }

        Ok(matches)
    }

    /// Every other cached-embedding `Work`, ranked by semantic similarity
    /// to `work_id`'s own cached embedding (see
    /// `streamarr_model::embedding`'s module doc comment) — "what else is
    /// like this". Brute-force cosine-similarity scan over every cached
    /// vector; the catalog is small enough (low thousands of works) that
    /// this needs no ANN index, and stays a single, simple code path
    /// rather than a second search infrastructure.
    ///
    /// Returns [`CatalogError::NotFound`] if `work_id` itself has no
    /// cached embedding yet (not yet synced, or embedding generation
    /// hasn't been configured for this deployment via
    /// [`Self::with_embedding_repo`]) -- distinct from an empty result
    /// list, which means "embedded, but nothing else in the catalog is
    /// close."
    pub async fn similar(&self, work_id: Uuid, limit: i64) -> Result<Vec<Work>, CatalogError> {
        let embedding_repo = self.embedding_repo.as_ref().ok_or(CatalogError::NotFound)?;
        let limit = limit.max(0) as usize;

        let target = embedding_repo
            .get(work_id)
            .await?
            .ok_or(CatalogError::NotFound)?;
        let all = embedding_repo.list_all().await?;

        let mut scored: Vec<(Uuid, f32)> = all
            .iter()
            .filter(|e| e.work_id != work_id)
            .map(|e| {
                (
                    e.work_id,
                    streamarr_embeddings::cosine_similarity(&target.vector, &e.vector),
                )
            })
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);

        let mut works = Vec::with_capacity(scored.len());
        for (candidate_id, _score) in scored {
            match self.work_repo.get(candidate_id).await {
                Ok(work) => works.push(work),
                Err(DbError::NotFound) => continue,
                Err(err) => return Err(err.into()),
            }
        }
        Ok(works)
    }

    /// A `Work` plus its full kind-specific tree (seasons/episodes for a
    /// series, albums/tracks for an artist, books for an author; a movie
    /// has none). Returns [`CatalogError::NotFound`] — a 404-shaped error,
    /// not a bare `DbError` — when no work exists with `id`.
    ///
    /// `allowed_source_instance_ids` is the per-user library access control
    /// ceiling (see [`BrowseQuery::allowed_source_instance_ids`]); `None`
    /// for an unrestricted caller. Deliberately checked *after* the cache
    /// lookup above rather than folded into [`work_detail_cache_key`]: a
    /// `WorkDetail`'s content is identical for every caller allowed to see
    /// it at all (unlike a browse/search page, which differs in *which*
    /// works appear), so fragmenting that cache per allowed-set would only
    /// waste cache slots on identical copies without buying any additional
    /// safety -- the check re-runs on every call (cache hit or not), so it
    /// can never be bypassed by a warm cache.
    pub async fn get_by_id(
        &self,
        id: Uuid,
        allowed_source_instance_ids: Option<&[Uuid]>,
    ) -> Result<WorkDetail, CatalogError> {
        let cache_key = work_detail_cache_key(id);
        if let Some(cached) = self.cache.get(&cache_key).await? {
            if let Ok(detail) = serde_json::from_slice::<WorkDetail>(&cached) {
                if !self
                    .is_work_visible(detail.work.id, allowed_source_instance_ids)
                    .await?
                {
                    return Err(CatalogError::NotFound);
                }
                return Ok(detail);
            }
        }

        let work = match self.work_repo.get(id).await {
            Ok(work) => work,
            Err(DbError::NotFound) => return Err(CatalogError::NotFound),
            Err(other) => return Err(CatalogError::Db(other)),
        };

        if !self
            .is_work_visible(work.id, allowed_source_instance_ids)
            .await?
        {
            // A restricted work 404s indistinguishably from a genuinely
            // nonexistent one -- its existence is not something a caller
            // without a library grant for it should be able to infer.
            return Err(CatalogError::NotFound);
        }

        // Only a movie's file points straight at the `Work` itself
        // (`LeafRef::Work`) -- every other kind's playable leaves are its
        // children, resolved individually below.
        let movie_media_file = match work.kind {
            WorkKind::Movie => self.media_file_for_leaf(work.id, LeafRef::Work).await?,
            _ => None,
        };
        let media_file_id = movie_media_file.as_ref().map(|file| file.id);
        let runtime_ms = movie_media_file.and_then(|file| file.duration_ms);

        let children = match work.kind {
            WorkKind::Movie => WorkChildren::Movie,
            WorkKind::Series | WorkKind::Site => {
                WorkChildren::Series(self.seasons_for_series(work.id).await?)
            }
            WorkKind::Artist => WorkChildren::Artist(self.albums_for_artist(work.id).await?),
            WorkKind::Author => WorkChildren::Author(self.books_for_author(work.id).await?),
        };

        let detail = WorkDetail {
            work,
            children,
            media_file_id,
            runtime_ms,
        };

        if let Ok(bytes) = serde_json::to_vec(&detail) {
            self.cache
                .set(&cache_key, bytes, Some(WORK_DETAIL_CACHE_TTL))
                .await?;
        }

        Ok(detail)
    }

    /// `true` if `work_id` is visible under `allowed` -- the shared
    /// primitive behind [`Self::get_by_id`]'s access check and
    /// `streamarr-api`'s playlist-item visibility filter (a caller can list
    /// their own playlist's item ids without them ever having gone through
    /// `browse`/`search`/`get_by_id`, so it needs its own entry point
    /// rather than only being reachable via those methods). `Ok(true)`
    /// immediately, with no repository call at all, when `allowed` is
    /// `None` (an unrestricted caller) -- the common case, and cheap.
    /// Otherwise resolves every one of `work_id`'s synced media files via
    /// `MediaFileRepo::list_by_work_id` and checks whether any one's
    /// `source_instance_id` is in `allowed`; a work with no synced files at
    /// all is therefore invisible to any restricted caller (there is
    /// nothing for `allowed` to match against), same as a work with only
    /// non-matching files.
    pub async fn is_work_visible(
        &self,
        work_id: Uuid,
        allowed: Option<&[Uuid]>,
    ) -> Result<bool, CatalogError> {
        let Some(allowed) = allowed else {
            return Ok(true);
        };
        let files = self.media_file_repo.list_by_work_id(work_id).await?;
        Ok(files
            .iter()
            .any(|f| allowed.contains(&f.source_instance_id)))
    }

    /// Resolves the `MediaFile` id for one leaf via
    /// `MediaFileRepo::find_by_leaf`, `None` when no file has synced for it
    /// yet.
    async fn media_file_for_leaf(
        &self,
        work_id: Uuid,
        leaf_ref: LeafRef,
    ) -> Result<Option<streamarr_model::MediaFile>, CatalogError> {
        Ok(self.media_file_repo.find_by_leaf(work_id, leaf_ref).await?)
    }

    /// Stores a one-file lazy runtime probe and invalidates that work's
    /// detail cache so the next catalogue read includes it.
    pub async fn cache_media_file_duration(
        &self,
        media_file_id: Uuid,
        work_id: Uuid,
        duration_ms: u64,
    ) -> Result<(), CatalogError> {
        self.media_file_repo
            .set_duration_ms(media_file_id, duration_ms)
            .await?;
        self.cache.delete(&work_detail_cache_key(work_id)).await?;
        Ok(())
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
            let episodes = self.episodes_for_season(series_work_id, id).await?;
            seasons.push(SeasonDetail { season, episodes });
        }
        Ok(seasons)
    }

    async fn episodes_for_season(
        &self,
        series_work_id: Uuid,
        season_id: Uuid,
    ) -> Result<Vec<EpisodeDetail>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, episode_number, title, overview, images, air_date, runtime_minutes, monitored, availability \
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
            let id = codec::parse_uuid(&row.try_get::<String, _>("id")?)?;
            let images_json: String = row.try_get("images")?;
            let images: Vec<ImageAsset> = serde_json::from_str(&images_json).map_err(|error| {
                CatalogError::Data(format!("invalid episode images JSON for {id}: {error}"))
            })?;
            let episode = Episode {
                id,
                season_id,
                episode_number: row.try_get::<i64, _>("episode_number")? as i32,
                title: row.try_get("title")?,
                overview: row.try_get("overview")?,
                images,
                air_date,
                runtime_minutes: row
                    .try_get::<Option<i64>, _>("runtime_minutes")?
                    .map(|n| n as u32),
                monitored: row.try_get::<i64, _>("monitored")? != 0,
                availability: codec::availability_from_str(
                    &row.try_get::<String, _>("availability")?,
                )?,
            };
            let media_file = self
                .media_file_for_leaf(series_work_id, LeafRef::Episode(id))
                .await?;
            let media_file_id = media_file.as_ref().map(|file| file.id);
            let runtime_ms = media_file.and_then(|file| file.duration_ms);
            episodes.push(EpisodeDetail {
                episode,
                media_file_id,
                runtime_ms,
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
            let tracks = self.tracks_for_album(artist_work_id, id).await?;
            albums.push(AlbumDetail { album, tracks });
        }
        Ok(albums)
    }

    async fn tracks_for_album(
        &self,
        artist_work_id: Uuid,
        album_id: Uuid,
    ) -> Result<Vec<TrackDetail>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, disc_number, track_number, title, duration_seconds, availability \
             FROM tracks WHERE album_id = ? ORDER BY disc_number ASC, track_number ASC",
        )
        .bind(album_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut tracks = Vec::with_capacity(rows.len());
        for row in rows {
            let id = codec::parse_uuid(&row.try_get::<String, _>("id")?)?;
            let track = Track {
                id,
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
            };
            let media_file = self
                .media_file_for_leaf(artist_work_id, LeafRef::Track(id))
                .await?;
            let media_file_id = media_file.as_ref().map(|file| file.id);
            let runtime_ms = media_file.and_then(|file| file.duration_ms);
            tracks.push(TrackDetail {
                track,
                media_file_id,
                runtime_ms,
            });
        }
        Ok(tracks)
    }

    async fn books_for_author(
        &self,
        author_work_id: Uuid,
    ) -> Result<Vec<BookDetail>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, title, isbn, release_date, series_name, series_position, monitored, availability \
             FROM books WHERE author_work_id = ? ORDER BY release_date ASC",
        )
        .bind(author_work_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut books = Vec::with_capacity(rows.len());
        for row in rows {
            let id = codec::parse_uuid(&row.try_get::<String, _>("id")?)?;
            let release_date = match row.try_get::<Option<String>, _>("release_date")? {
                Some(raw) => Some(codec::parse_date(&raw)?),
                None => None,
            };
            let book = Book {
                id,
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
            };
            let media_file_id = self
                .media_file_for_leaf(author_work_id, LeafRef::Book(id))
                .await?
                .map(|file| file.id);
            books.push(BookDetail {
                book,
                media_file_id,
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
    use std::path::PathBuf;
    use streamarr_cache::InMemory;
    use streamarr_db::repo::{SqlxMediaFileRepo, SqlxWatchProgressRepo};
    use streamarr_model::{
        Availability, ExternalProvider, ExternalRef, ImageAsset, ImageKind, MediaFile, WorkKind,
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
            let release_date_raw: Option<String> =
                row.try_get("release_date").map_err(DbError::Backend)?;
            let release_date = release_date_raw
                .map(|raw| codec::parse_datetime(&raw))
                .transpose()
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
                release_date,
                monitored,
                availability,
            })
        }
    }

    #[async_trait]
    impl WorkRepo for TestWorkRepo {
        async fn get(&self, id: Uuid) -> Result<Work, DbError> {
            let row = sqlx::query(
                "SELECT id, kind, title, sort_title, overview, images, genres, tags, added_at, release_date, monitored, availability \
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
                "SELECT id, kind, title, sort_title, overview, images, genres, tags, added_at, release_date, monitored, availability \
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
                "INSERT INTO works (id, kind, title, sort_title, overview, images, genres, tags, added_at, release_date, monitored, availability) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                    kind = excluded.kind, title = excluded.title, sort_title = excluded.sort_title, \
                    overview = excluded.overview, images = excluded.images, genres = excluded.genres, \
                    tags = excluded.tags, added_at = excluded.added_at, release_date = excluded.release_date, \
                    monitored = excluded.monitored, availability = excluded.availability",
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
            .bind(work.release_date.map(codec::format_datetime))
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
                "SELECT w.id, w.kind, w.title, w.sort_title, w.overview, w.images, w.genres, w.tags, w.added_at, w.release_date, w.monitored, w.availability \
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

    fn media_file_repo(pool: DbPool) -> Arc<dyn MediaFileRepo> {
        Arc::new(SqlxMediaFileRepo::new(pool))
    }

    fn service(pool: DbPool, repo: Arc<dyn WorkRepo>) -> CatalogService {
        let watch_progress_repo = Arc::new(SqlxWatchProgressRepo::new(pool.clone()));
        CatalogService::new(
            repo,
            media_file_repo(pool.clone()),
            Arc::new(InMemory::new()),
            pool,
            watch_progress_repo,
        )
    }

    /// Inserts a real `media_files` row (via the real production
    /// `SqlxMediaFileRepo`, not a fake) so a `get_by_id` test can assert
    /// `media_file_id` actually resolves once a file has "synced".
    async fn seed_media_file(pool: &DbPool, work_id: Uuid, leaf_ref: LeafRef) -> Uuid {
        let repo = media_file_repo(pool.clone());
        let file = MediaFile {
            id: Uuid::new_v4(),
            work_id,
            leaf_ref,
            path: PathBuf::from("/media/file.mkv"),
            container: "mkv".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            duration_ms: Some(3_600_000),
            size_bytes: 123_456,
            source_instance_id: Uuid::new_v4(),
            source_file_id: Some("1".to_string()),
        };
        repo.create(&file).await.expect("seed media file");
        file.id
    }

    /// Like [`seed_media_file`] but with a caller-chosen `source_instance_id`
    /// -- exists for [`browse_filters_by_source_instance_id`], which needs
    /// to seed two works whose files come from two distinct source
    /// instances rather than [`seed_media_file`]'s random one.
    async fn seed_media_file_for_source(
        pool: &DbPool,
        work_id: Uuid,
        leaf_ref: LeafRef,
        source_instance_id: Uuid,
    ) -> Uuid {
        let repo = media_file_repo(pool.clone());
        let file = MediaFile {
            id: Uuid::new_v4(),
            work_id,
            leaf_ref,
            path: PathBuf::from("/media/file.mkv"),
            container: "mkv".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            duration_ms: Some(3_600_000),
            size_bytes: 123_456,
            source_instance_id,
            source_file_id: Some("1".to_string()),
        };
        repo.create(&file).await.expect("seed media file");
        file.id
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
            // No release_date by default -- tests that specifically exercise
            // `BrowseSort::ReleaseDateDescending`/`release_window_days` set
            // this explicitly via struct-update syntax over this fixture.
            release_date: None,
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

    async fn insert_episode(
        pool: &DbPool,
        season_id: Uuid,
        episode_number: i32,
        title: &str,
    ) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO episodes (id, season_id, episode_number, title, overview, images, air_date, runtime_minutes, monitored, availability) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(season_id.to_string())
        .bind(episode_number as i64)
        .bind(title)
        .bind(Option::<String>::None)
        .bind("[]")
        .bind(codec::format_date(
            chrono::NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        ))
        .bind(42i64)
        .bind(1i64)
        .bind(codec::availability_to_str(Availability::Available))
        .execute(pool)
        .await
        .expect("insert episode");
        id
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

    async fn insert_track(pool: &DbPool, album_id: Uuid, track_number: u32, title: &str) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO tracks (id, album_id, disc_number, track_number, title, duration_seconds, availability) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(album_id.to_string())
        .bind(1i64)
        .bind(track_number as i64)
        .bind(title)
        .bind(180i64)
        .bind(codec::availability_to_str(Availability::Available))
        .execute(pool)
        .await
        .expect("insert track");
        id
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
    async fn browse_available_only_uses_synced_media_files() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());

        let available_movie = movie("Available Movie", "Available Movie", &[], 0);
        let available_movie_id = available_movie.id;
        repo.upsert(&available_movie).await.unwrap();
        seed_media_file(&pool, available_movie_id, LeafRef::Work).await;

        let playable_series = Work {
            availability: Availability::Unknown,
            ..series("Playable Series", "Playable Series")
        };
        let playable_series_id = playable_series.id;
        repo.upsert(&playable_series).await.unwrap();
        seed_media_file(&pool, playable_series_id, LeafRef::Episode(Uuid::new_v4())).await;

        repo.upsert(&Work {
            availability: Availability::Pending,
            ..movie("Pending Movie", "Pending Movie", &[], 0)
        })
        .await
        .unwrap();
        repo.upsert(&Work {
            availability: Availability::Deleted,
            ..movie("Deleted Movie", "Deleted Movie", &[], 0)
        })
        .await
        .unwrap();

        let svc = service(pool, repo);
        let page = svc
            .browse(BrowseQuery {
                available_only: true,
                ..Default::default()
            })
            .await
            .unwrap();

        let titles: Vec<&str> = page.items.iter().map(|work| work.title.as_str()).collect();
        assert_eq!(page.total, Some(2));
        assert_eq!(titles, vec!["Available Movie", "Playable Series"]);
    }

    #[tokio::test]
    async fn browse_filters_by_source_instance_id() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());

        let from_a = movie("From Instance A", "From Instance A", &[], 0);
        let from_a_id = from_a.id;
        repo.upsert(&from_a).await.unwrap();

        let from_b = movie("From Instance B", "From Instance B", &[], 0);
        let from_b_id = from_b.id;
        repo.upsert(&from_b).await.unwrap();

        // Never synced by any source instance -- must never match either
        // filter below.
        repo.upsert(&movie("Not Yet Synced", "Not Yet Synced", &[], 0))
            .await
            .unwrap();

        let instance_a = Uuid::new_v4();
        let instance_b = Uuid::new_v4();
        seed_media_file_for_source(&pool, from_a_id, LeafRef::Work, instance_a).await;
        seed_media_file_for_source(&pool, from_b_id, LeafRef::Work, instance_b).await;

        let svc = service(pool, repo);

        let a_only = svc
            .browse(BrowseQuery {
                source_instance_id: Some(instance_a),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(a_only.items.len(), 1);
        assert_eq!(a_only.items[0].id, from_a_id);

        let b_only = svc
            .browse(BrowseQuery {
                source_instance_id: Some(instance_b),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(b_only.items.len(), 1);
        assert_eq!(b_only.items[0].id, from_b_id);

        let unmatched = svc
            .browse(BrowseQuery {
                source_instance_id: Some(Uuid::new_v4()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(unmatched.items.is_empty());

        let unfiltered = svc.browse(BrowseQuery::default()).await.unwrap();
        assert_eq!(unfiltered.items.len(), 3);
    }

    /// Covers the per-user library access control ceiling
    /// (`BrowseQuery::allowed_source_instance_ids`) -- distinct from
    /// `source_instance_id` above, which is a single caller-chosen browse
    /// filter rather than an enforced access boundary. An unrestricted
    /// (`None`) caller sees everything; an empty allow-list sees nothing
    /// (`library_allow`'s own empty-means-deny-all semantics); a matching
    /// source instance is visible; a non-matching one is hidden.
    #[tokio::test]
    async fn browse_enforces_allowed_source_instance_ids() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());

        let from_a = movie("Allowed Movie", "Allowed Movie", &[], 0);
        let from_a_id = from_a.id;
        repo.upsert(&from_a).await.unwrap();

        let from_b = movie("Disallowed Movie", "Disallowed Movie", &[], 0);
        let from_b_id = from_b.id;
        repo.upsert(&from_b).await.unwrap();

        let instance_a = Uuid::new_v4();
        let instance_b = Uuid::new_v4();
        seed_media_file_for_source(&pool, from_a_id, LeafRef::Work, instance_a).await;
        seed_media_file_for_source(&pool, from_b_id, LeafRef::Work, instance_b).await;

        let svc = service(pool, repo);

        // Unrestricted (`None`) -- an admin/system caller sees everything.
        let unrestricted = svc
            .browse(BrowseQuery {
                allowed_source_instance_ids: None,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(unrestricted.items.len(), 2);

        // Empty allow-list -- deny-all, not all-allow.
        let denied_all = svc
            .browse(BrowseQuery {
                allowed_source_instance_ids: Some(Vec::new()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(denied_all.items.is_empty());

        // Allowed for exactly one of the two source instances.
        let allowed_a = svc
            .browse(BrowseQuery {
                allowed_source_instance_ids: Some(vec![instance_a]),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(allowed_a.items.len(), 1);
        assert_eq!(allowed_a.items[0].id, from_a_id);
    }

    /// Proves the cache-key fix in `browse_cache_key` actually prevents
    /// cross-caller leakage: two callers with different allow-lists issuing
    /// the otherwise-identical query must never observe each other's cached
    /// page.
    #[tokio::test]
    async fn browse_cache_does_not_leak_across_different_allowed_sets() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());

        let from_a = movie("Cache Movie A", "Cache Movie A", &[], 0);
        let from_a_id = from_a.id;
        repo.upsert(&from_a).await.unwrap();

        let from_b = movie("Cache Movie B", "Cache Movie B", &[], 0);
        let from_b_id = from_b.id;
        repo.upsert(&from_b).await.unwrap();

        let instance_a = Uuid::new_v4();
        let instance_b = Uuid::new_v4();
        seed_media_file_for_source(&pool, from_a_id, LeafRef::Work, instance_a).await;
        seed_media_file_for_source(&pool, from_b_id, LeafRef::Work, instance_b).await;

        let svc = service(pool, repo);

        let caller_a = svc
            .browse(BrowseQuery {
                allowed_source_instance_ids: Some(vec![instance_a]),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(caller_a.items.len(), 1);
        assert_eq!(caller_a.items[0].id, from_a_id);

        // Same query shape, different allowed set -- must be a cache miss,
        // not caller_a's cached page served back to caller_b.
        let caller_b = svc
            .browse(BrowseQuery {
                allowed_source_instance_ids: Some(vec![instance_b]),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(caller_b.items.len(), 1);
        assert_eq!(caller_b.items[0].id, from_b_id);
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

    /// Proves `ReleaseDateDescending` genuinely sorts by `release_date`, not
    /// `added_at` -- the two fixtures below deliberately have *inverted*
    /// `added_at`/`release_date` ordering, so a sort that accidentally fell
    /// back to `added_at` (the bug this test exists to catch) would produce
    /// the wrong order here.
    #[tokio::test]
    async fn browse_release_date_descending_sorts_by_release_date_not_added_at() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let now = Utc::now();

        // Added recently, but released long ago.
        let old_release = Work {
            release_date: Some(now - ChronoDuration::days(400)),
            ..movie("Old Release", "Old Release", &[], 0)
        };
        // Added a while ago, but released very recently.
        let new_release = Work {
            release_date: Some(now - ChronoDuration::days(1)),
            ..movie("New Release", "New Release", &[], 10)
        };
        // No release_date at all -- must sort last, not first/crash.
        let no_release_date = movie("No Release Date", "No Release Date", &[], 5);

        repo.upsert(&old_release).await.unwrap();
        repo.upsert(&new_release).await.unwrap();
        repo.upsert(&no_release_date).await.unwrap();
        let svc = service(pool, repo);

        let page = svc
            .browse(BrowseQuery {
                sort: BrowseSort::ReleaseDateDescending,
                ..Default::default()
            })
            .await
            .unwrap();
        let titles: Vec<&str> = page.items.iter().map(|w| w.title.as_str()).collect();
        assert_eq!(
            titles,
            vec!["New Release", "Old Release", "No Release Date"]
        );
    }

    #[tokio::test]
    async fn browse_release_window_days_filters_to_recent_releases_only() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let now = Utc::now();

        let recent = Work {
            release_date: Some(now - ChronoDuration::days(3)),
            ..movie("Recent Release", "Recent Release", &[], 0)
        };
        let stale = Work {
            release_date: Some(now - ChronoDuration::days(90)),
            ..movie("Stale Release", "Stale Release", &[], 0)
        };
        let unknown = movie("Unknown Release Date", "Unknown Release Date", &[], 0);

        repo.upsert(&recent).await.unwrap();
        repo.upsert(&stale).await.unwrap();
        repo.upsert(&unknown).await.unwrap();
        let svc = service(pool, repo);

        let page = svc
            .browse(BrowseQuery {
                release_window_days: Some(7),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].title, "Recent Release");
    }

    #[tokio::test]
    async fn resolve_view_translates_criteria_and_sort_into_a_browse_query() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let now = Utc::now();

        let action_movie = Work {
            release_date: Some(now - ChronoDuration::days(2)),
            ..movie("Action Hit", "Action Hit", &["action"], 20)
        };
        let comedy_movie = Work {
            release_date: Some(now - ChronoDuration::days(1)),
            ..movie("Comedy Hit", "Comedy Hit", &["comedy"], 0)
        };
        repo.upsert(&action_movie).await.unwrap();
        repo.upsert(&comedy_movie).await.unwrap();
        let svc = service(pool, repo);

        let view = streamarr_model::LibraryView {
            id: Uuid::new_v4(),
            name: "Newly Released Action".to_string(),
            criteria: streamarr_model::ViewCriteria {
                kind: Some(WorkKind::Movie),
                genre: Some("action".to_string()),
                ..Default::default()
            },
            sort: vec![streamarr_model::ViewSort::RecentlyReleased],
            is_default: false,
            default_order: None,
            created_at: now,
            updated_at: now,
        };

        let page = svc.resolve_view(&view, None, 50, 0, None).await.unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].title, "Action Hit");
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

        let by_title = svc.search("great escape", 10, None).await.unwrap();
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].title, "Sample Movie India");

        let by_overview = svc.search("TESTING", 10, None).await.unwrap();
        assert_eq!(by_overview.len(), 2); // both fixtures' overview mentions "testing"

        let no_match = svc.search("nonexistent-needle", 10, None).await.unwrap();
        assert!(no_match.is_empty());

        let blank = svc.search("   ", 10, None).await.unwrap();
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

        let results = svc.search("findme", 3, None).await.unwrap();
        assert_eq!(results.len(), 3);
    }

    #[tokio::test]
    async fn search_tolerates_misspellings() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        repo.upsert(&movie("Brambleford", "Brambleford", &[], 0))
            .await
            .unwrap();
        let svc = service(pool, repo);

        // Not an exact substring of "Brambleford" -- must fall through to
        // the fuzzy tier to be found at all.
        let results = svc.search("Bramblefrod", 10, None).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Brambleford");
    }

    #[tokio::test]
    async fn search_folds_diacritics_both_directions() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        repo.upsert(&movie("Sémon", "Semon", &[], 0))
            .await
            .unwrap();
        let svc = service(pool, repo);

        let ascii_query = svc.search("Semon", 10, None).await.unwrap();
        assert_eq!(
            ascii_query.len(),
            1,
            "an ASCII query should find an accented title"
        );

        let accented_query = svc.search("Sémon", 10, None).await.unwrap();
        assert_eq!(
            accented_query.len(),
            1,
            "an accented query should still match too"
        );
    }

    #[tokio::test]
    async fn search_ranks_exact_hits_above_fuzzy_ones() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        repo.upsert(&movie("Brambleford", "Brambleford", &[], 0))
            .await
            .unwrap();
        // A title that's a fuzzy (not exact) match for "Brambleford" itself,
        // so both fixtures are candidates and ordering actually matters.
        repo.upsert(&movie("Bramblefrod Lane", "Bramblefrod Lane", &[], 0))
            .await
            .unwrap();
        let svc = service(pool, repo);

        let results = svc.search("Brambleford", 10, None).await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].title, "Brambleford",
            "the exact-substring hit must outrank the fuzzy one"
        );
    }

    #[tokio::test]
    async fn search_does_not_match_unrelated_words() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        repo.upsert(&movie("Orbit", "Orbit", &[], 0)).await.unwrap();
        let svc = service(pool, repo);

        // Genuinely unrelated to "Orbit" -- must not clear the fuzzy
        // threshold just because both are short common words.
        let results = svc.search("Xylophone", 10, None).await.unwrap();
        assert!(results.is_empty());
    }

    /// Same per-user library access control ceiling as
    /// `browse_enforces_allowed_source_instance_ids`, applied to `search`
    /// instead: an unrestricted (`None`) caller finds both matches; a
    /// caller allowed only one source instance finds only that one; an
    /// empty allow-list finds none.
    #[tokio::test]
    async fn search_enforces_allowed_source_instance_ids() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());

        let allowed_movie = movie("Findme Allowed", "Findme Allowed", &[], 0);
        let allowed_id = allowed_movie.id;
        repo.upsert(&allowed_movie).await.unwrap();

        let disallowed_movie = movie("Findme Disallowed", "Findme Disallowed", &[], 0);
        let disallowed_id = disallowed_movie.id;
        repo.upsert(&disallowed_movie).await.unwrap();

        let instance_a = Uuid::new_v4();
        let instance_b = Uuid::new_v4();
        seed_media_file_for_source(&pool, allowed_id, LeafRef::Work, instance_a).await;
        seed_media_file_for_source(&pool, disallowed_id, LeafRef::Work, instance_b).await;

        let svc = service(pool, repo);

        let unrestricted = svc.search("findme", 10, None).await.unwrap();
        assert_eq!(unrestricted.len(), 2);

        let restricted = svc.search("findme", 10, Some(&[instance_a])).await.unwrap();
        assert_eq!(restricted.len(), 1);
        assert_eq!(restricted[0].id, allowed_id);

        let denied_all = svc.search("findme", 10, Some(&[])).await.unwrap();
        assert!(denied_all.is_empty());
    }

    fn embedding_repo(pool: DbPool) -> Arc<dyn streamarr_db::EmbeddingRepo> {
        Arc::new(streamarr_db::repo::SqlxEmbeddingRepo::new(pool))
    }

    #[tokio::test]
    async fn similar_ranks_by_cosine_similarity_excluding_self() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let target = movie("Target Movie", "Target Movie", &[], 0);
        let close = movie("Close Movie", "Close Movie", &[], 0);
        let far = movie("Far Movie", "Far Movie", &[], 0);
        for w in [&target, &close, &far] {
            repo.upsert(w).await.unwrap();
        }

        let embeddings = embedding_repo(pool.clone());
        embeddings
            .upsert(&streamarr_model::WorkEmbedding {
                work_id: target.id,
                model_id: "test".to_string(),
                source_text: "x".to_string(),
                vector: vec![1.0, 0.0, 0.0],
                updated_at: Utc::now(),
            })
            .await
            .unwrap();
        embeddings
            .upsert(&streamarr_model::WorkEmbedding {
                work_id: close.id,
                model_id: "test".to_string(),
                source_text: "x".to_string(),
                vector: vec![0.9, 0.1, 0.0],
                updated_at: Utc::now(),
            })
            .await
            .unwrap();
        embeddings
            .upsert(&streamarr_model::WorkEmbedding {
                work_id: far.id,
                model_id: "test".to_string(),
                source_text: "x".to_string(),
                vector: vec![0.0, 0.0, 1.0],
                updated_at: Utc::now(),
            })
            .await
            .unwrap();

        let svc = service(pool, repo).with_embedding_repo(embeddings);
        let results = svc.similar(target.id, 10).await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].title, "Close Movie",
            "the closer vector must rank first"
        );
        assert_eq!(results[1].title, "Far Movie");
        assert!(
            results.iter().all(|w| w.id != target.id),
            "similar must never include the target work itself"
        );
    }

    #[tokio::test]
    async fn similar_without_a_cached_embedding_is_not_found() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let target = movie("No Embedding Yet", "No Embedding Yet", &[], 0);
        repo.upsert(&target).await.unwrap();
        let embeddings = embedding_repo(pool.clone());

        let svc = service(pool, repo).with_embedding_repo(embeddings);
        let err = svc.similar(target.id, 10).await.unwrap_err();
        assert!(matches!(err, CatalogError::NotFound));
    }

    #[tokio::test]
    async fn similar_without_embedding_repo_configured_is_not_found() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let target = movie("Unconfigured", "Unconfigured", &[], 0);
        repo.upsert(&target).await.unwrap();

        let svc = service(pool, repo); // no `.with_embedding_repo(...)`
        let err = svc.similar(target.id, 10).await.unwrap_err();
        assert!(matches!(err, CatalogError::NotFound));
    }

    #[tokio::test]
    async fn get_by_id_returns_full_tree_for_series() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let show = series("Test Show", "Test Show");
        let show_id = show.id;
        repo.upsert(&show).await.unwrap();

        let season_id = insert_season(&pool, show_id, 1, "Season One").await;
        let pilot_id = insert_episode(&pool, season_id, 1, "Pilot").await;
        insert_episode(&pool, season_id, 2, "Episode Two").await;
        let episode_images = serde_json::to_string(&vec![ImageAsset {
            kind: streamarr_model::ImageKind::Thumb,
            url: "https://artworks.thetvdb.com/episodes/pilot.jpg".to_string(),
            width: None,
            height: None,
        }])
        .unwrap();
        sqlx::query("UPDATE episodes SET images = ? WHERE id = ?")
            .bind(episode_images)
            .bind(pilot_id.to_string())
            .execute(&pool)
            .await
            .unwrap();

        let svc = service(pool, repo);
        let detail = svc.get_by_id(show_id, None).await.unwrap();

        assert_eq!(detail.work.id, show_id);
        // A series' own `media_file_id` is always `None` -- its playable
        // leaves are its episodes, not the `Work` itself.
        assert_eq!(detail.media_file_id, None);
        match detail.children {
            WorkChildren::Series(seasons) => {
                assert_eq!(seasons.len(), 1);
                assert_eq!(seasons[0].season.season_number, 1);
                assert_eq!(seasons[0].episodes.len(), 2);
                assert_eq!(
                    seasons[0].episodes[0].episode.title.as_deref(),
                    Some("Pilot")
                );
                assert_eq!(
                    seasons[0].episodes[0].episode.images[0].url,
                    "https://artworks.thetvdb.com/episodes/pilot.jpg"
                );
                assert_eq!(
                    seasons[0].episodes[1].episode.title.as_deref(),
                    Some("Episode Two")
                );
                // Neither episode has a synced `MediaFile` yet.
                assert_eq!(seasons[0].episodes[0].media_file_id, None);
                assert_eq!(seasons[0].episodes[1].media_file_id, None);
            }
            other => panic!("expected WorkChildren::Series, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn get_by_id_resolves_episode_media_file_id_once_synced() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let show = series("Synced Show", "Synced Show");
        let show_id = show.id;
        repo.upsert(&show).await.unwrap();

        let season_id = insert_season(&pool, show_id, 1, "Season One").await;
        insert_episode(&pool, season_id, 1, "Pilot").await;
        insert_episode(&pool, season_id, 2, "Episode Two").await;

        let episode_row =
            sqlx::query("SELECT id FROM episodes WHERE season_id = ? AND episode_number = 1")
                .bind(season_id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        let episode_id =
            codec::parse_uuid(&episode_row.try_get::<String, _>("id").unwrap()).unwrap();
        let media_file_id = seed_media_file(&pool, show_id, LeafRef::Episode(episode_id)).await;

        let svc = service(pool, repo);
        let detail = svc.get_by_id(show_id, None).await.unwrap();

        match detail.children {
            WorkChildren::Series(seasons) => {
                let pilot = seasons[0]
                    .episodes
                    .iter()
                    .find(|e| e.episode.id == episode_id)
                    .expect("pilot episode present");
                assert_eq!(pilot.media_file_id, Some(media_file_id));
                assert_eq!(pilot.runtime_ms, Some(3_600_000));
                let episode_two = seasons[0]
                    .episodes
                    .iter()
                    .find(|e| e.episode.id != episode_id)
                    .expect("second episode present");
                assert_eq!(episode_two.media_file_id, None);
                assert_eq!(episode_two.runtime_ms, None);
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
        let track_id = insert_track(&pool, album_id, 1, "Track One").await;
        insert_track(&pool, album_id, 2, "Track Two").await;
        let media_file_id = seed_media_file(&pool, artist_id, LeafRef::Track(track_id)).await;

        let svc = service(pool, repo);
        let detail = svc.get_by_id(artist_id, None).await.unwrap();

        assert_eq!(detail.media_file_id, None);
        match detail.children {
            WorkChildren::Artist(albums) => {
                assert_eq!(albums.len(), 1);
                assert_eq!(albums[0].tracks.len(), 2);
                assert_eq!(albums[0].tracks[0].track.track_number, 1);
                assert_eq!(albums[0].tracks[0].media_file_id, Some(media_file_id));
                assert_eq!(albums[0].tracks[0].runtime_ms, Some(3_600_000));
                assert_eq!(albums[0].tracks[1].media_file_id, None);
                assert_eq!(albums[0].tracks[1].runtime_ms, None);
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
        let detail = svc.get_by_id(author_id, None).await.unwrap();

        match detail.children {
            WorkChildren::Author(books) => {
                assert_eq!(books.len(), 2);
                assert!(books.iter().all(|b| b.media_file_id.is_none()));
            }
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
        let detail = svc.get_by_id(film_id, None).await.unwrap();
        assert!(matches!(detail.children, WorkChildren::Movie));
        assert_eq!(detail.media_file_id, None);
    }

    #[tokio::test]
    async fn get_by_id_resolves_movie_media_file_id_once_synced() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let film = movie("Synced Movie", "Synced Movie", &[], 0);
        let film_id = film.id;
        repo.upsert(&film).await.unwrap();

        let media_file_id = seed_media_file(&pool, film_id, LeafRef::Work).await;

        let svc = service(pool, repo);
        let detail = svc.get_by_id(film_id, None).await.unwrap();
        assert!(matches!(detail.children, WorkChildren::Movie));
        assert_eq!(detail.media_file_id, Some(media_file_id));
        assert_eq!(detail.runtime_ms, Some(3_600_000));
    }

    #[tokio::test]
    async fn get_by_id_missing_work_is_not_found() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let svc = service(pool, repo);

        let err = svc.get_by_id(Uuid::new_v4(), None).await.unwrap_err();
        assert!(matches!(err, CatalogError::NotFound));
    }

    /// A restricted caller (`allowed_source_instance_ids: Some(...)`) 404s
    /// on a work outside their allow-list -- indistinguishable from a
    /// genuinely nonexistent work, so its existence isn't leaked. An
    /// unrestricted (`None`) caller and a caller whose allow-list actually
    /// matches both still succeed. Runs the same lookup twice for the
    /// allowed case to prove the check re-applies on a cache hit, not only
    /// on the first, cache-populating call.
    #[tokio::test]
    async fn get_by_id_enforces_allowed_source_instance_ids() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let film = movie("Restricted Movie", "Restricted Movie", &[], 0);
        let film_id = film.id;
        repo.upsert(&film).await.unwrap();

        let owning_instance = Uuid::new_v4();
        seed_media_file_for_source(&pool, film_id, LeafRef::Work, owning_instance).await;

        let svc = service(pool, repo);

        // Unrestricted.
        assert!(svc.get_by_id(film_id, None).await.is_ok());

        // Allowed -- first call populates the cache, second call re-checks
        // against it.
        assert!(svc
            .get_by_id(film_id, Some(&[owning_instance]))
            .await
            .is_ok());
        assert!(svc
            .get_by_id(film_id, Some(&[owning_instance]))
            .await
            .is_ok());

        // Not allowed -- 404s, both on a fresh lookup and once the work is
        // already cached from the calls above.
        let other_instance = Uuid::new_v4();
        let err = svc
            .get_by_id(film_id, Some(&[other_instance]))
            .await
            .unwrap_err();
        assert!(matches!(err, CatalogError::NotFound));

        // Empty allow-list is deny-all, not all-allow.
        let err = svc.get_by_id(film_id, Some(&[])).await.unwrap_err();
        assert!(matches!(err, CatalogError::NotFound));
    }

    #[tokio::test]
    async fn is_work_visible_matches_get_by_ids_own_enforcement() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let film = movie("Visibility Movie", "Visibility Movie", &[], 0);
        let film_id = film.id;
        repo.upsert(&film).await.unwrap();

        // A second, never-synced work -- kept around as its own fixture
        // (not upserted through `svc` later) since `service` takes
        // ownership of `repo`.
        let unsynced = movie("Unsynced Movie", "Unsynced Movie", &[], 0);
        let unsynced_id = unsynced.id;
        repo.upsert(&unsynced).await.unwrap();

        let owning_instance = Uuid::new_v4();
        seed_media_file_for_source(&pool, film_id, LeafRef::Work, owning_instance).await;

        let svc = service(pool, repo);

        assert!(svc.is_work_visible(film_id, None).await.unwrap());
        assert!(svc
            .is_work_visible(film_id, Some(&[owning_instance]))
            .await
            .unwrap());
        assert!(!svc
            .is_work_visible(film_id, Some(&[Uuid::new_v4()]))
            .await
            .unwrap());
        assert!(!svc.is_work_visible(film_id, Some(&[])).await.unwrap());

        // A work with no synced files at all is invisible to any
        // restricted caller -- there's nothing for the allow-list to match.
        assert!(!svc
            .is_work_visible(unsynced_id, Some(&[owning_instance]))
            .await
            .unwrap());
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
    use streamarr_db::repo::{SqlxMediaFileRepo, SqlxWatchProgressRepo, SqlxWorkRepo};
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
            release_date: Some(Utc::now() - chrono::Duration::days(30)),
            monitored: true,
            availability: Availability::Available,
        };
        repo.upsert(&work)
            .await
            .expect("upsert via real SqlxWorkRepo");

        let media_file_repo: Arc<dyn MediaFileRepo> =
            Arc::new(SqlxMediaFileRepo::new(pool.clone()));
        let watch_progress_repo = Arc::new(SqlxWatchProgressRepo::new(pool.clone()));
        let svc = CatalogService::new(
            repo,
            media_file_repo,
            Arc::new(InMemory::new()),
            pool,
            watch_progress_repo,
        );

        let page = svc.browse(BrowseQuery::default()).await.expect("browse");
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].title, "Real Repo Movie");

        let found = svc.search("real repo", 10, None).await.expect("search");
        assert_eq!(found.len(), 1);

        let detail = svc.get_by_id(work.id, None).await.expect("get_by_id");
        assert_eq!(detail.work.title, "Real Repo Movie");
        assert!(matches!(detail.children, WorkChildren::Movie));
    }
}
