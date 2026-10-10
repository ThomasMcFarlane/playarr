//! `playarr-catalog` — the read path over the catalog: browse/search/
//! get-by-id. Deliberately separate from `playarr-db`'s `WorkRepo` (the
//! write-shaped repository trait `playarr-arr-sync` upserts into) because
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
//! nothing in `playarr-db` exposes those yet (its `WorkRepo` doc comment
//! explicitly scopes them out until "the catalog write path is built"), so
//! this crate queries `DbPool` directly for just that slice — see
//! `CatalogService::pool` and `backend/migrations/sqlite/000{4,5}_catalog_children.sql`.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

mod codec;
mod language_cache;
mod snapshot;

pub use snapshot::{Snapshot, SnapshotCache};

/// A per-caller content restriction applied to every catalog read, on top
/// of library access (`docs/architecture/household-controls.md`). The
/// catalog stays policy-agnostic: the API layer supplies an implementation
/// (rating ceiling, tag lists, guardian grants) and its stable
/// [`WorkGate::cache_key`] so two callers with different restrictions never
/// share a cached page.
pub trait WorkGate: Send + Sync {
    /// Whether the caller may see `work`.
    fn permits(&self, work: &Work) -> bool;
    /// Uniquely identifies this gate's behaviour for cache keys.
    fn cache_key(&self) -> String;
}

/// Cheap-to-clone, `Debug`-able handle to a [`WorkGate`].
#[derive(Clone)]
pub struct SharedGate(pub Arc<dyn WorkGate>);

impl std::fmt::Debug for SharedGate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SharedGate({})", self.0.cache_key())
    }
}

/// Library access plus an optional [`WorkGate`]. `Access::from(None)` is an
/// unrestricted caller.
#[derive(Clone, Copy, Default)]
pub struct Access<'a> {
    pub allowed: Option<&'a [Uuid]>,
    pub gate: Option<&'a dyn WorkGate>,
}

impl<'a> From<Option<&'a [Uuid]>> for Access<'a> {
    fn from(allowed: Option<&'a [Uuid]>) -> Self {
        Self {
            allowed,
            gate: None,
        }
    }
}

impl<'a> Access<'a> {
    pub fn new(allowed: Option<&'a [Uuid]>, gate: Option<&'a dyn WorkGate>) -> Self {
        Self { allowed, gate }
    }

    fn permits(&self, work: &Work) -> bool {
        self.gate.is_none_or(|gate| gate.permits(work))
    }

    fn gate_key(&self) -> String {
        self.gate.map(|g| g.cache_key()).unwrap_or_default()
    }
}

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use playarr_cache::CacheAndPubSub;
use playarr_db::{
    DbError, DbPool, MediaFileRepo, PeerLeafAvailabilityRepo, PeerNodeRepo, WatchProgressRepo,
    WorkRepo,
};
use playarr_model::media::LeafRef;
use playarr_model::{
    Album, Availability, Book, Episode, ExternalProvider, ImageAsset, Season, Track, Work, WorkKind,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("work not found")]
    NotFound,
    #[error(transparent)]
    Db(#[from] playarr_db::DbError),
    #[error(transparent)]
    Cache(#[from] playarr_cache::CacheError),
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
    /// Descending by [`playarr_model::Work::release_date`] -- backs the
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
    /// `false` so Playarr Server Admin can inspect every catalog state.
    pub available_only: bool,
    /// Restricts results to works with at least one synced [`MediaFile`]
    /// whose `source_instance_id` matches -- the "library" filter for the
    /// admin Library page, letting two source instances of the same kind
    /// (e.g. two Radarr instances for a 4K library and a 1080p library)
    /// browse separately.
    ///
    /// Lives on `MediaFile`, not `Work`/`ExternalRef`: `playarr_model::
    /// Work` has no source-instance-provenance field of its own yet (see
    /// `playarr_arr_sync::poller::InstancePoller::reconcile_all`'s doc
    /// comment, which flags this as a known gap), so this filters through
    /// the leaf-level `MediaFile` table instead of an in-memory field on
    /// the already-loaded `Work` -- see [`CatalogService::browse`]'s doc
    /// comment for the cost that implies.
    ///
    /// [`MediaFile`]: playarr_model::MediaFile
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
    /// Per-user library access control (`playarr_model::Policy::
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
    /// [`MediaFile`]: playarr_model::MediaFile
    pub allowed_source_instance_ids: Option<Vec<Uuid>>,
    /// `GroupLibrary` ids (`docs/architecture/peer-groups.md` §2.3/§5.1)
    /// whose partial-cache-node [`RemoteOnlyWork`] entries (`peer_leaf_
    /// availability` rows with `local_work_id IS NULL`) this browse should
    /// union in -- resolved by the API layer from the caller's own
    /// `Policy::group_library_allow`, the same way [`Self::
    /// allowed_source_instance_ids`] is resolved from `library_allow`.
    /// Empty (the default) unions in nothing, so this is byte-for-byte
    /// inert for a caller/deployment with no group-library grants -- see
    /// [`CatalogService::browse`]'s doc comment.
    pub group_library_ids: Vec<Uuid>,
    /// Household/child content restriction (rating, tags, guardian grants).
    /// `None` = none. See [`WorkGate`].
    pub gate: Option<SharedGate>,
    /// Audio/subtitle language filter; empty by default (no restriction).
    pub language: LanguageFilter,
}

/// Audio/subtitle language filter (task 180). Codes are canonical (see
/// `playarr_model::language`). Semantics:
///
/// * Within one list, a work matches when it has **any** listed language
///   (`match_all == false`, the default) or **every** listed language
///   (`match_all == true`).
/// * The audio and subtitle lists combine with **AND**.
/// * A movie is judged on its file(s); a series on the union of all of its
///   episode files, unless `every_file` requires each wanted language to be
///   present on **every** file of the work (so "all episodes have English
///   subtitles").
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LanguageFilter {
    pub audio: Vec<String>,
    pub subtitle: Vec<String>,
    pub match_all: bool,
    pub every_file: bool,
}

impl LanguageFilter {
    pub fn is_empty(&self) -> bool {
        self.audio.is_empty() && self.subtitle.is_empty()
    }

    fn without_audio(&self) -> Self {
        Self {
            audio: Vec::new(),
            ..self.clone()
        }
    }

    fn without_subtitle(&self) -> Self {
        Self {
            subtitle: Vec::new(),
            ..self.clone()
        }
    }
}

/// One language with the number of works that carry it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LanguageFacet {
    pub code: String,
    pub count: i64,
}

/// Available audio and subtitle languages for a browse scope.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LanguageFacets {
    pub audio: Vec<LanguageFacet>,
    pub subtitle: Vec<LanguageFacet>,
}

/// Per-work language data for one kind (`audio` or `subtitle`).
#[derive(Default)]
struct WorkLanguageIndex {
    langs: HashMap<Uuid, HashSet<String>>,
    /// Only populated when `every_file` is needed.
    file_totals: HashMap<Uuid, i64>,
    with_lang: HashMap<(Uuid, String), i64>,
}

impl WorkLanguageIndex {
    fn matches(&self, work_id: Uuid, wanted: &[String], match_all: bool, every_file: bool) -> bool {
        if wanted.is_empty() {
            return true;
        }
        let has = |lang: &String| {
            if every_file {
                let total = self.file_totals.get(&work_id).copied().unwrap_or(0);
                total > 0
                    && self
                        .with_lang
                        .get(&(work_id, lang.clone()))
                        .copied()
                        .unwrap_or(0)
                        >= total
            } else {
                self.langs
                    .get(&work_id)
                    .is_some_and(|set| set.contains(lang))
            }
        };
        if match_all {
            wanted.iter().all(has)
        } else {
            wanted.iter().any(has)
        }
    }
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
            group_library_ids: Vec::new(),
            gate: None,
            language: LanguageFilter::default(),
        }
    }
}

/// One peer's reported availability for a `Work` -- resolved, display-ready
/// shape [`CatalogService::browse`]/[`CatalogService::get_by_id`]'s
/// hydration step produces via an index-backed join of `peer_leaf_
/// availability` against already-fetched work ids (never a live fan-out to
/// peers per request), with each row's `peer_node_id` resolved to a display
/// name through `PeerNodeRepo`. See `docs/architecture/peer-groups.md`
/// §4.3. `playarr-api::catalog::AvailabilityBadge` mirrors this shape
/// exactly for the HTTP response's OpenAPI schema -- it can't be the same
/// type, since `playarr-api` depends on this crate and not the other way
/// around, but the wire JSON is identical either way.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AvailabilityBadge {
    pub peer_node_id: Uuid,
    pub peer_name: String,
    pub availability: Availability,
    pub updated_at: DateTime<Utc>,
}

/// A title a full peer reports having but this node has zero local record
/// of at all -- the partial-cache-node case (§4.3). Deliberately not a
/// fabricated local `Work.id`: nothing here can key a normal `media_file_
/// id`-based playback request, so a client that wants to play one of these
/// has to go through a dedicated by-external-ref entry point instead
/// (Phase 3, §5.2) -- this type only carries what browse/search need to
/// *display* the title.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RemoteOnlyWork {
    pub provider: ExternalProvider,
    pub external_id: String,
    pub title: String,
    pub kind: WorkKind,
    /// RFC 3339 -- there is no local `Work` row to carry this as a real
    /// `DateTime` field on, so it's carried exactly as the reporting peer's
    /// own `PeerLeafAvailability::release_date` formats to.
    pub release_date: Option<String>,
    pub available_on: Vec<AvailabilityBadge>,
}

/// A page of [`BrowseQuery`]/[`CatalogService::search`] results, with
/// enough metadata for the API layer to build pagination without a second
/// count query most of the time (`total` is `None` when the caller asked
/// for a cheap page that skips the count).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogPage {
    pub items: Vec<Work>,
    pub total: Option<i64>,
    /// Cross-peer availability for each work in [`Self::items`], keyed by
    /// `Work::id` -- §4.3's hydration step, populated only for the works on
    /// this exact page (never the full pre-pagination candidate set). A
    /// work with no entry here simply has no peer availability data yet
    /// (including every entry when this deployment isn't part of a peer
    /// group at all, or hasn't wired `CatalogService::
    /// with_peer_leaf_availability`) -- not a signal that it's unavailable
    /// everywhere else.
    #[serde(default)]
    pub available_on: HashMap<Uuid, Vec<AvailabilityBadge>>,
    /// Titles a full peer reports but this node has zero local record of at
    /// all (§4.3's partial-cache-node case) -- populated only when
    /// [`BrowseQuery::group_library_ids`] is non-empty; `Vec::new()` for
    /// every other caller/deployment, including every existing caller from
    /// before this field existed.
    #[serde(default)]
    pub remote_only: Vec<RemoteOnlyWork>,
}

/// One user's watch state for one work, folded from per-file progress.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkWatch {
    /// Files (movie file / episodes) the user finished.
    pub watched_files: u32,
    /// Files the work has on disk (0 when unknown).
    pub total_files: u32,
    /// The user has watched or part-watched at least one file.
    pub started: bool,
    /// Most recent progress touch across the work's files.
    pub last_activity: Option<DateTime<Utc>>,
}

impl WorkWatch {
    /// Every file the work has is watched.
    pub fn is_complete(&self) -> bool {
        self.total_files > 0 && self.watched_files >= self.total_files
    }
}

/// An [`Episode`] plus the resolved id of the [`playarr_model::MediaFile`]
/// that plays it (via [`playarr_db::MediaFileRepo::find_by_leaf`],
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

/// The files of one library work, as much as the calendar and title
/// resolution need (never the full detail page).
#[derive(Debug, Clone, PartialEq)]
pub enum WorkFiles {
    /// A movie's own file, when one has synced.
    Movie(Option<Uuid>),
    /// A series' episode files, in season and episode order. Episodes
    /// without a file are absent.
    Series(Vec<EpisodeFile>),
    /// Artists, authors and anything else.
    Other,
}

/// One episode's file inside [`WorkFiles::Series`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EpisodeFile {
    pub season_number: i32,
    pub episode_number: i32,
    pub media_file_id: Uuid,
}

/// A work visible to a caller plus its [`WorkFiles`].
#[derive(Debug, Clone, PartialEq)]
pub struct WorkFileView {
    pub work: Work,
    pub files: WorkFiles,
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
    /// rather than one of its children (see [`playarr_model::media::LeafRef`]).
    /// `None` for every other kind, and for a movie with no file synced yet.
    pub media_file_id: Option<Uuid>,
    /// Fixed source-container runtime for a movie's own playable file.
    /// Series runtimes live on each [`EpisodeDetail`].
    pub runtime_ms: Option<u64>,
    /// Cross-peer availability for [`Self::work`] -- §4.3's hydration step,
    /// same shape/source as [`CatalogPage::available_on`]'s per-work entry.
    /// Empty when this deployment isn't part of a peer group, hasn't wired
    /// `CatalogService::with_peer_leaf_availability`, or genuinely has no
    /// peer reporting this title.
    #[serde(default)]
    pub available_on: Vec<AvailabilityBadge>,
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
/// always produce two different keys. Also includes [`BrowseQuery::
/// group_library_ids`] for the identical reason applied to
/// [`CatalogPage::remote_only`]: two different group-library grants must
/// never share a cached page.
fn browse_cache_key(query: &BrowseQuery, catalog_version: u64) -> String {
    format!(
        "catalog:browse:v{catalog_version}:{:?}:{}:{:?}:{:?}:{:?}:{:?}:{:?}:{}:{}:{:?}:{:?}:{}:{:?}",
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
        query.group_library_ids,
        query
            .gate
            .as_ref()
            .map(|g| g.0.cache_key())
            .unwrap_or_default(),
        query.language,
    )
}

/// Includes `allowed` -- same cross-caller cache-leak reasoning as
/// [`browse_cache_key`].
fn search_cache_key(
    needle: &str,
    limit: i64,
    allowed: Option<&[Uuid]>,
    gate: &str,
    catalog_version: u64,
) -> String {
    format!("catalog:search:v{catalog_version}:{needle}:{limit}:{allowed:?}:{gate}")
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
/// invalidation on writes is `playarr-arr-sync`'s responsibility (it
/// publishes on the work's cache key/tag after every upsert), not this
/// service's, since only the writer knows what changed; the TTLs above are
/// this service's own safety net against that never happening (e.g. before
/// `playarr-arr-sync` exists) rather than the primary invalidation path.
pub struct CatalogService {
    work_repo: Arc<dyn WorkRepo>,
    /// Resolves each playable leaf's `media_file_id` in
    /// [`CatalogService::get_by_id`] (`MediaFileRepo::find_by_leaf`) — kept
    /// distinct from `work_repo` the same way `playarr-db` keeps
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
    /// `playarr-arr-sync::poller::ReconciliationPoller`'s optional
    /// steps use) — a deployment that hasn't wired embedding generation
    /// simply has `similar` report `CatalogError::NotFound` rather than
    /// every other constructor call site needing a repo it doesn't have.
    embedding_repo: Option<Arc<dyn playarr_db::EmbeddingRepo>>,
    /// Audio/subtitle language index behind [`BrowseQuery::language`] and
    /// [`Self::language_facets`]. `None` (the default) means no language
    /// data: a non-empty filter then matches nothing and facets are empty.
    language_repo: Option<Arc<dyn playarr_db::MediaLanguageRepo>>,
    /// In-memory `(work, language)` pairs read from `language_repo` (see
    /// [`language_cache`]), so the language filters and facets do not run the
    /// slow distinct read on every request.
    language_pairs: Arc<language_cache::WorkLanguageCache>,
    /// Backs [`Self::browse`]/[`Self::get_by_id`]'s [`AvailabilityBadge`]
    /// hydration and [`Self::browse`]/[`Self::search_remote_only`]'s
    /// [`RemoteOnlyWork`] union (§4.3). `None` by default (builder opt-in
    /// via [`Self::with_peer_leaf_availability`], same "a deployment that
    /// hasn't wired peer groups gets a no-op rather than every constructor
    /// call site needing repos it doesn't have" shape as `embedding_repo`
    /// above) -- every method that would use this instead returns empty
    /// availability/remote-only data, byte-for-byte inert for a single,
    /// ungrouped node.
    peer_availability: Option<PeerAvailabilitySources>,
    /// In-memory copy of the catalogue's browse inputs (see [`snapshot`]).
    snapshots: Arc<SnapshotCache>,
}

/// [`CatalogService::with_peer_leaf_availability`]'s two dependencies,
/// grouped so [`CatalogService::peer_availability`] is a single `Option`
/// rather than two independently-`None`-able fields that would need to
/// agree with each other.
struct PeerAvailabilitySources {
    availability_repo: Arc<dyn PeerLeafAvailabilityRepo>,
    /// Resolves each [`AvailabilityBadge::peer_node_id`] to a display
    /// [`AvailabilityBadge::peer_name`] -- `peer_leaf_availability` itself
    /// only ever stores the id (§2.3's schema), never a denormalized copy
    /// of the peer's name, which could drift the moment an admin renames a
    /// peer.
    peer_node_repo: Arc<dyn PeerNodeRepo>,
}

impl CatalogService {
    pub fn new(
        work_repo: Arc<dyn WorkRepo>,
        media_file_repo: Arc<dyn MediaFileRepo>,
        cache: Arc<dyn CacheAndPubSub>,
        pool: DbPool,
        watch_progress_repo: Arc<dyn WatchProgressRepo>,
    ) -> Self {
        let snapshots =
            SnapshotCache::new(work_repo.clone(), media_file_repo.clone(), pool.clone());
        Self {
            work_repo,
            media_file_repo,
            cache,
            pool,
            watch_progress_repo,
            embedding_repo: None,
            language_repo: None,
            language_pairs: language_cache::WorkLanguageCache::new(
                language_cache::FRESH_FOR,
                language_cache::MAX_AGE,
            ),
            peer_availability: None,
            snapshots,
        }
    }

    /// Reads the catalogue into memory ahead of the first request.
    pub async fn warm_snapshot(&self) {
        self.snapshots.warm().await;
    }

    /// Reads the language index into memory ahead of the first request, so the
    /// Filters panel's language lists do not wait for the distinct read.
    pub async fn warm_languages(&self) {
        for kind in [
            playarr_db::repo::KIND_AUDIO,
            playarr_db::repo::KIND_SUBTITLE,
        ] {
            if let Err(error) = self.work_language_pairs(kind).await {
                tracing::warn!(%error, kind, "could not warm the language index");
            }
        }
    }

    /// Drops the in-memory catalogue copy so the next read rebuilds it. Writers
    /// that publish a live library event need not call this.
    pub fn invalidate_snapshot(&self) {
        self.snapshots.invalidate();
        self.language_pairs.invalidate();
    }

    /// How often a read re-checks the database for writes this process did not
    /// publish an event for (default 5 s).
    pub fn set_snapshot_probe_every(&self, every: Duration) {
        self.snapshots.set_probe_every(every);
    }

    /// Identifies the in-memory catalogue copy; it changes whenever the copy is
    /// rebuilt, so a result derived from the catalogue can be keyed on it.
    pub async fn snapshot_version(&self) -> Result<u64, CatalogError> {
        Ok(self.snapshots.get().await?.version)
    }

    /// Opts this service into the audio/subtitle language index.
    pub fn with_media_language_repo(
        mut self,
        language_repo: Arc<dyn playarr_db::MediaLanguageRepo>,
    ) -> Self {
        self.language_repo = Some(language_repo);
        self
    }

    /// Opts this service's [`Self::similar`] into real results -- see
    /// that method's doc comment and the `embedding_repo` field's.
    pub fn with_embedding_repo(
        mut self,
        embedding_repo: Arc<dyn playarr_db::EmbeddingRepo>,
    ) -> Self {
        self.embedding_repo = Some(embedding_repo);
        self
    }

    /// Opts this service's [`Self::browse`]/[`Self::get_by_id`]/[`Self::
    /// search_remote_only`] into real cross-peer availability data -- see
    /// the `peer_availability` field's doc comment.
    pub fn with_peer_leaf_availability(
        mut self,
        availability_repo: Arc<dyn PeerLeafAvailabilityRepo>,
        peer_node_repo: Arc<dyn PeerNodeRepo>,
    ) -> Self {
        self.peer_availability = Some(PeerAvailabilitySources {
            availability_repo,
            peer_node_repo,
        });
        self
    }

    /// Resolves `peer_node_id` to a display name via `PeerNodeRepo`,
    /// memoized in `cache` for the lifetime of one hydration pass -- a
    /// single browse/search page can carry many rows from the same handful
    /// of peers, and a peer's own `PeerNode` row never changes mid-request,
    /// so re-fetching it per row would be pure waste. Falls back to the raw
    /// id formatted as a string on an unknown/removed peer (a row that
    /// hasn't been cleaned up yet after that peer left the group) rather
    /// than failing the whole hydration over one stale reference.
    async fn resolve_peer_name(
        sources: &PeerAvailabilitySources,
        peer_node_id: Uuid,
        cache: &mut HashMap<Uuid, String>,
    ) -> Result<String, CatalogError> {
        if let Some(name) = cache.get(&peer_node_id) {
            return Ok(name.clone());
        }
        let name = sources
            .peer_node_repo
            .get(peer_node_id)
            .await?
            .map(|node| node.name)
            .unwrap_or_else(|| peer_node_id.to_string());
        cache.insert(peer_node_id, name.clone());
        Ok(name)
    }

    /// [`AvailabilityBadge`] hydration (§4.3): an index-backed join of
    /// `peer_leaf_availability` against `work_ids` via `PeerLeafAvailabilityRepo::
    /// list_by_local_work_ids` -- deliberately never a live fan-out to peers
    /// per request, which would not survive a slow or partitioned peer
    /// gracefully. Returns `Ok(HashMap::new())` without querying anything
    /// when this service has no [`Self::with_peer_leaf_availability`]
    /// wiring or `work_ids` is empty.
    async fn hydrate_availability(
        &self,
        work_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<AvailabilityBadge>>, CatalogError> {
        let Some(sources) = &self.peer_availability else {
            return Ok(HashMap::new());
        };
        if work_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let rows = sources
            .availability_repo
            .list_by_local_work_ids(work_ids)
            .await?;

        let mut peer_names: HashMap<Uuid, String> = HashMap::new();
        let mut badges: HashMap<Uuid, Vec<AvailabilityBadge>> = HashMap::new();
        for row in rows {
            // `list_by_local_work_ids` only ever matches rows with a
            // non-`NULL` `local_work_id` (see that method's own doc
            // comment), but this guards the invariant explicitly rather
            // than indexing into an `Option` blindly.
            let Some(work_id) = row.local_work_id else {
                continue;
            };
            let peer_name =
                Self::resolve_peer_name(sources, row.peer_node_id, &mut peer_names).await?;
            let work_badges = badges.entry(work_id).or_default();
            if !work_badges
                .iter()
                .any(|badge| badge.peer_node_id == row.peer_node_id)
            {
                work_badges.push(AvailabilityBadge {
                    peer_node_id: row.peer_node_id,
                    peer_name,
                    availability: row.availability,
                    updated_at: row.updated_at,
                });
            }
        }
        Ok(badges)
    }

    /// The partial-cache-node [`RemoteOnlyWork`] union (§4.3): every
    /// `peer_leaf_availability` row with `local_work_id IS NULL` across
    /// `group_library_ids`, via `PeerLeafAvailabilityRepo::
    /// list_unmatched_for_group`, merged so the same `(provider,
    /// external_id)` reported by more than one peer becomes one
    /// `RemoteOnlyWork` with multiple `available_on` badges rather than one
    /// duplicate entry per peer. Returns `Ok(Vec::new())` without querying
    /// anything when this service has no [`Self::with_peer_leaf_availability`]
    /// wiring or `group_library_ids` is empty -- the common case for a
    /// caller with no group-library grants, or a single, ungrouped node.
    async fn remote_only_works(
        &self,
        group_library_ids: &[Uuid],
    ) -> Result<Vec<RemoteOnlyWork>, CatalogError> {
        let Some(sources) = &self.peer_availability else {
            return Ok(Vec::new());
        };
        if group_library_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut peer_names: HashMap<Uuid, String> = HashMap::new();
        let mut merged: HashMap<(ExternalProvider, String), RemoteOnlyWork> = HashMap::new();
        // De-duplicate the caller-supplied list so an overlapping set of
        // group libraries never double-fetches (or double-counts a badge
        // for) the same underlying rows.
        let mut seen_groups: HashSet<Uuid> = HashSet::new();
        for group_id in group_library_ids {
            if !seen_groups.insert(*group_id) {
                continue;
            }
            let rows = sources
                .availability_repo
                .list_unmatched_for_group(*group_id)
                .await?;
            for row in rows {
                let peer_name =
                    Self::resolve_peer_name(sources, row.peer_node_id, &mut peer_names).await?;
                let badge = AvailabilityBadge {
                    peer_node_id: row.peer_node_id,
                    peer_name,
                    availability: row.availability,
                    updated_at: row.updated_at,
                };
                let key = (row.provider.clone(), row.external_id.clone());
                let remote = merged.entry(key).or_insert_with(|| RemoteOnlyWork {
                    provider: row.provider.clone(),
                    external_id: row.external_id.clone(),
                    title: row.title.clone(),
                    kind: row.kind,
                    release_date: row.release_date.map(|date| date.to_rfc3339()),
                    available_on: Vec::new(),
                });
                if !remote
                    .available_on
                    .iter()
                    .any(|existing| existing.peer_node_id == badge.peer_node_id)
                {
                    remote.available_on.push(badge);
                }
            }
        }

        let mut works: Vec<RemoteOnlyWork> = merged.into_values().collect();
        works.sort_by(|a, b| a.title.cmp(&b.title));
        Ok(works)
    }

    /// Free-text search over [`Self::remote_only_works`]'s candidates --
    /// the `search_catalog_handler` counterpart to [`Self::search`] for the
    /// partial-cache-node case (§4.3): `search` itself only ever scans
    /// locally-known `Work`s, so a title this node has zero local record of
    /// needs its own matching pass over the (already peer-name-resolved)
    /// `RemoteOnlyWork` candidates instead. Reuses the exact same [`fold_locale`]/
    /// substring-then-fuzzy scheme [`Self::search`] uses, scored on `title`
    /// alone (there is no `overview` field to also check here).
    pub async fn search_remote_only(
        &self,
        query: &str,
        group_library_ids: &[Uuid],
    ) -> Result<Vec<RemoteOnlyWork>, CatalogError> {
        let raw_needle = query.trim();
        if raw_needle.is_empty() {
            return Ok(Vec::new());
        }
        let needle = fold_locale(raw_needle);

        let candidates = self.remote_only_works(group_library_ids).await?;
        let mut scored: Vec<(RemoteOnlyWork, MatchTier, f64)> = Vec::new();
        for work in candidates {
            let folded_title = fold_locale(&work.title);
            if folded_title.contains(&needle) {
                scored.push((work, MatchTier::Exact, 1.0));
                continue;
            }
            let query_words: Vec<&str> = needle.split_whitespace().collect();
            let title_words: Vec<&str> = folded_title.split_whitespace().collect();
            if query_words.is_empty() || title_words.is_empty() {
                continue;
            }
            let mean_score: f64 = query_words
                .iter()
                .map(|query_word| best_word_score(query_word, &title_words))
                .sum::<f64>()
                / query_words.len() as f64;
            if mean_score >= FUZZY_MATCH_THRESHOLD {
                scored.push((work, MatchTier::Fuzzy, mean_score));
            }
        }

        scored.sort_by(|(work_a, tier_a, score_a), (work_b, tier_b, score_b)| {
            tier_a
                .cmp(tier_b)
                .then_with(|| {
                    score_b
                        .partial_cmp(score_a)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| work_a.title.cmp(&work_b.title))
        });

        Ok(scored.into_iter().map(|(work, _, _)| work).collect())
    }

    /// Every [`BrowseQuery`] filter except the language filter, in `sort_title`
    /// order. Reads the in-memory snapshot, so it costs no query and clones
    /// no work.
    async fn filtered_candidates(
        &self,
        query: &BrowseQuery,
    ) -> Result<Vec<Arc<Work>>, CatalogError> {
        let snapshot = self.snapshots.get().await?;
        let kinds: &[WorkKind] = match &query.kind {
            Some(kind) => std::slice::from_ref(kind),
            None => &ALL_KINDS,
        };
        let cutoff = query
            .release_window_days
            .map(|days| chrono::Utc::now() - chrono::Duration::days(days));
        let needs_sources =
            query.source_instance_id.is_some() || query.allowed_source_instance_ids.is_some();

        let mut candidates: Vec<Arc<Work>> = Vec::new();
        for kind in kinds {
            candidates.extend(
                snapshot
                    .works(*kind)
                    .iter()
                    .filter(|work| {
                        if query.available_only && !snapshot.is_playable(&work.id) {
                            return false;
                        }
                        if let Some(genre) = query.genre.as_deref() {
                            if !work.genres.iter().any(|g| g.eq_ignore_ascii_case(genre)) {
                                return false;
                            }
                        }
                        if let Some(tag) = query.tag.as_deref() {
                            if !work.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
                                return false;
                            }
                        }
                        if let Some(gate) = query.gate.as_ref() {
                            if !gate.0.permits(work) {
                                return false;
                            }
                        }
                        if needs_sources {
                            let sources = snapshot.sources_of(&work.id);
                            let matches_explicit_filter = query
                                .source_instance_id
                                .is_none_or(|wanted| sources.contains(&wanted));
                            let matches_allow_list = query
                                .allowed_source_instance_ids
                                .as_ref()
                                .is_none_or(|allowed| sources.iter().any(|s| allowed.contains(s)));
                            if !(matches_explicit_filter && matches_allow_list) {
                                return false;
                            }
                        }
                        if let Some(cutoff) = cutoff {
                            if !work.release_date.is_some_and(|rd| rd >= cutoff) {
                                return false;
                            }
                        }
                        true
                    })
                    .cloned(),
            );
        }
        Ok(candidates)
    }

    /// Every work matching `query`'s filters (library ceiling, household
    /// gate, language, availability), in `sort_title` order for a single kind
    /// and unpaginated, without the per-page hydration [`Self::browse`] does --
    /// the cheap candidate set Home rails slice per user. The works are shared
    /// with the in-memory snapshot; nothing is copied.
    pub async fn visible_works(&self, query: &BrowseQuery) -> Result<Vec<Arc<Work>>, CatalogError> {
        let mut candidates = self.filtered_candidates(query).await?;
        self.apply_language_filter(&mut candidates, &query.language)
            .await?;
        Ok(candidates)
    }

    /// Distinct `(work, language)` pairs of `kind`, from memory when read
    /// recently (see [`language_cache`]); empty without a language repo.
    async fn work_language_pairs(&self, kind: &str) -> Result<language_cache::Pairs, CatalogError> {
        let Some(repo) = self.language_repo.clone() else {
            return Ok(Default::default());
        };
        let owned = kind.to_string();
        Ok(self
            .language_pairs
            .get(
                kind,
                playarr_db::repo::language_write_tick(),
                move || async move { repo.list_work_languages(&owned).await },
            )
            .await?)
    }

    /// Loads the per-work language index for `kind`; `every_file` also loads
    /// per-file counts.
    async fn work_language_index(
        &self,
        kind: &str,
        every_file: bool,
    ) -> Result<WorkLanguageIndex, CatalogError> {
        let mut index = WorkLanguageIndex::default();
        let Some(repo) = &self.language_repo else {
            return Ok(index);
        };
        for (work_id, lang) in self.work_language_pairs(kind).await?.iter() {
            index
                .langs
                .entry(*work_id)
                .or_default()
                .insert(lang.clone());
        }
        if every_file {
            let (totals, with_lang) = repo.list_work_language_file_counts(kind).await?;
            index.file_totals = totals;
            index.with_lang = with_lang;
        }
        Ok(index)
    }

    /// Retains only works matching `filter` (see [`LanguageFilter`]).
    async fn apply_language_filter(
        &self,
        candidates: &mut Vec<Arc<Work>>,
        filter: &LanguageFilter,
    ) -> Result<(), CatalogError> {
        if filter.is_empty() {
            return Ok(());
        }
        let audio = if filter.audio.is_empty() {
            WorkLanguageIndex::default()
        } else {
            self.work_language_index(playarr_db::repo::KIND_AUDIO, filter.every_file)
                .await?
        };
        let subtitle = if filter.subtitle.is_empty() {
            WorkLanguageIndex::default()
        } else {
            self.work_language_index(playarr_db::repo::KIND_SUBTITLE, filter.every_file)
                .await?
        };
        candidates.retain(|work| {
            audio.matches(work.id, &filter.audio, filter.match_all, filter.every_file)
                && subtitle.matches(
                    work.id,
                    &filter.subtitle,
                    filter.match_all,
                    filter.every_file,
                )
        });
        Ok(())
    }

    /// Available audio and subtitle languages (with work counts) within the
    /// scope of `query`. Each list honours every filter, including the
    /// *other* language list, but not its own, so selecting an audio
    /// language narrows the subtitle options and still lists every audio
    /// option.
    pub async fn language_facets(
        &self,
        query: BrowseQuery,
    ) -> Result<LanguageFacets, CatalogError> {
        let candidates = self.filtered_candidates(&query).await?;
        let mut facets = LanguageFacets::default();
        for (kind, own_filter) in [
            (playarr_db::repo::KIND_AUDIO, query.language.without_audio()),
            (
                playarr_db::repo::KIND_SUBTITLE,
                query.language.without_subtitle(),
            ),
        ] {
            let mut scoped = candidates.clone();
            self.apply_language_filter(&mut scoped, &own_filter).await?;
            let scoped_ids: HashSet<Uuid> = scoped.iter().map(|work| work.id).collect();
            let mut counts: HashMap<String, i64> = HashMap::new();
            for (work_id, lang) in self.work_language_pairs(kind).await?.iter() {
                if scoped_ids.contains(work_id) {
                    *counts.entry(lang.clone()).or_default() += 1;
                }
            }
            let mut list: Vec<LanguageFacet> = counts
                .into_iter()
                .map(|(code, count)| LanguageFacet { code, count })
                .collect();
            list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.code.cmp(&b.code)));
            if kind == playarr_db::repo::KIND_AUDIO {
                facets.audio = list;
            } else {
                facets.subtitle = list;
            }
        }
        Ok(facets)
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
        // Keyed on the snapshot version: a rebuilt snapshot never answers from a page built on the old one.
        let cache_key = browse_cache_key(&query, self.snapshots.get().await?.version);
        if let Some(cached) = self.cache.get(&cache_key).await? {
            if let Ok(page) = serde_json::from_slice::<CatalogPage>(&cached) {
                return Ok(page);
            }
            // Corrupt/incompatible cache entry (e.g. a stale format from a
            // prior version) — fall through to a fresh query rather than
            // failing the request over it.
        }

        let mut candidates = self.filtered_candidates(&query).await?;
        self.apply_language_filter(&mut candidates, &query.language)
            .await?;

        match query.sort {
            BrowseSort::TitleAscending => {
                candidates.sort_by(|a, b| a.sort_title.cmp(&b.sort_title));
            }
            BrowseSort::TitleDescending => {
                candidates.sort_by(|a, b| b.sort_title.cmp(&a.sort_title));
            }
            BrowseSort::RecentlyAdded => {
                candidates.sort_by_key(|a| std::cmp::Reverse(a.added_at));
            }
            BrowseSort::OldestAdded => {
                candidates.sort_by_key(|a| a.added_at);
            }
            BrowseSort::ReleaseDateDescending => {
                // `Option<DateTime<Utc>>`'s derived `Ord` treats `None` as
                // smaller than any `Some`, so this descending comparator
                // naturally pushes works with no release_date (Artist/
                // Author, or a Movie/Series arr-sync hasn't backfilled yet)
                // to the bottom rather than the top.
                candidates.sort_by_key(|a| std::cmp::Reverse(a.release_date));
            }
        }

        let total = candidates.len() as i64;
        let offset = query.offset.max(0) as usize;
        let limit = query.limit.max(0) as usize;
        let items: Vec<Work> = candidates
            .into_iter()
            .skip(offset)
            .take(limit)
            .map(|work| work.as_ref().clone())
            .collect();

        // Hydration (§4.3) is deliberately scoped to just this page's item
        // ids, not the full pre-pagination candidate set -- an
        // index-backed join against already-fetched work ids, same
        // "bounded by what's actually being returned" cost model
        // `source_instance_id`/`allowed_source_instance_ids` filtering
        // above already applies.
        let item_ids: Vec<Uuid> = items.iter().map(|work| work.id).collect();
        let available_on = self.hydrate_availability(&item_ids).await?;
        let remote_only = self.remote_only_works(&query.group_library_ids).await?;

        let page = CatalogPage {
            items,
            total: Some(total),
            available_on,
            remote_only,
        };

        if let Ok(bytes) = serde_json::to_vec(&page) {
            self.cache
                .set(&cache_key, bytes, Some(BROWSE_CACHE_TTL))
                .await?;
        }

        Ok(page)
    }

    /// The user's watch state per work, from one progress query plus one
    /// grouped file count. Works the user never touched are absent.
    pub async fn watch_summaries(
        &self,
        user_id: Uuid,
    ) -> Result<HashMap<Uuid, WorkWatch>, CatalogError> {
        let mut progress = self.watch_progress_repo.list_for_user(user_id).await?;
        if progress.is_empty() {
            return Ok(HashMap::new());
        }
        // Progress on a file the source dropped (hidden, not deleted) must not
        // count: `total_files` no longer includes it, so it would read as more
        // watched files than the work has.
        let works: Vec<Uuid> = progress
            .iter()
            .map(|p| p.work_id)
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        let visible: std::collections::HashSet<Uuid> = self
            .media_file_repo
            .list_by_work_ids(&works)
            .await?
            .into_iter()
            .map(|f| f.id)
            .collect();
        progress.retain(|p| visible.contains(&p.media_file_id));
        let snapshot = self.snapshots.get().await?;
        let mut out: HashMap<Uuid, WorkWatch> = HashMap::new();
        for row in progress {
            let entry = out.entry(row.work_id).or_default();
            match row.state {
                playarr_model::WatchState::Watched => {
                    entry.watched_files += 1;
                    entry.started = true;
                }
                playarr_model::WatchState::PartWatched => entry.started = true,
                playarr_model::WatchState::Unseen => continue,
            }
            if let Some(at) = row.updated_at {
                entry.last_activity = Some(entry.last_activity.map_or(at, |old| old.max(at)));
            }
        }
        out.retain(|_, w| w.started);
        for (work_id, watch) in out.iter_mut() {
            watch.total_files = snapshot.file_count(work_id);
        }
        Ok(out)
    }

    /// Runs a saved [`playarr_model::LibraryView`]'s criteria+sort through
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
        view: &playarr_model::LibraryView,
        user_id: Option<Uuid>,
        limit: i64,
        offset: i64,
        allowed_source_instance_ids: Option<Vec<Uuid>>,
    ) -> Result<CatalogPage, CatalogError> {
        self.resolve_view_with(
            view,
            user_id,
            limit,
            offset,
            allowed_source_instance_ids,
            None,
        )
        .await
    }

    /// [`Self::resolve_view`] with a household [`WorkGate`].
    pub async fn resolve_view_with(
        &self,
        view: &playarr_model::LibraryView,
        user_id: Option<Uuid>,
        limit: i64,
        offset: i64,
        allowed_source_instance_ids: Option<Vec<Uuid>>,
        gate: Option<SharedGate>,
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
                // The `RemoteOnlyWork` union is `browse_catalog_handler`/
                // `search_catalog_handler`'s concern (§4.3), not a saved
                // view's -- a `LibraryView` resolves to real local `Work`
                // rows by definition (see this method's own doc comment),
                // so there is nothing here for a group-library grant to
                // union in.
                group_library_ids: Vec::new(),
                gate,
                language: LanguageFilter {
                    audio: c.audio_languages.clone(),
                    subtitle: c.subtitle_languages.clone(),
                    match_all: c.language_match_all,
                    every_file: c.language_every_file,
                },
            })
            .await?;

        // `unwatched_only` is per viewer, so it can't be part of the shared
        // browse query (and its cache key); it filters this caller's copy.
        if c.unwatched_only {
            if let Some(uid) = user_id {
                let watch = self.watch_summaries(uid).await?;
                page.items
                    .retain(|work| !watch.get(&work.id).is_some_and(|w| w.started));
            }
        }

        let sort_keys = if view.sort.is_empty() {
            &[playarr_model::ViewSort::TitleAscending][..]
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
        let last_played: std::collections::HashMap<Uuid, chrono::DateTime<chrono::Utc>> =
            match user_id {
                Some(uid) if sort_keys.contains(&playarr_model::ViewSort::LastPlayedByUser) => {
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
                }
                _ => std::collections::HashMap::new(),
            };

        // `slice::sort_by` is stable. Applying the least-significant key
        // first therefore preserves it as the tie-breaker when each more
        // significant key is layered on afterwards.
        for sort in sort_keys.iter().rev() {
            match sort {
                playarr_model::ViewSort::TitleAscending => {
                    page.items.sort_by(|a, b| a.sort_title.cmp(&b.sort_title));
                }
                playarr_model::ViewSort::TitleDescending => {
                    page.items.sort_by(|a, b| b.sort_title.cmp(&a.sort_title));
                }
                playarr_model::ViewSort::RecentlyAdded => {
                    page.items.sort_by_key(|a| std::cmp::Reverse(a.added_at));
                }
                playarr_model::ViewSort::OldestAdded => {
                    page.items.sort_by_key(|a| a.added_at);
                }
                playarr_model::ViewSort::RecentlyReleased => {
                    page.items
                        .sort_by_key(|a| std::cmp::Reverse(a.release_date));
                }
                playarr_model::ViewSort::LastPlayedByUser => {
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

        // The inner `browse` call above hydrated `available_on` for its
        // entire (up to `SCAN_LIMIT`) pre-sort/pre-paginate candidate set,
        // most of which this method's own re-sort + re-pagination above
        // just sliced away -- re-hydrate for exactly the final, trimmed
        // `page.items` instead of shipping availability data for works that
        // are no longer even in the response.
        let final_ids: Vec<Uuid> = page.items.iter().map(|work| work.id).collect();
        page.available_on = self.hydrate_availability(&final_ids).await?;

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
        self.search_with(query, limit, allowed_source_instance_ids.into())
            .await
    }

    /// [`Self::search`] with a household [`WorkGate`] as well as library
    /// access.
    pub async fn search_with(
        &self,
        query: &str,
        limit: i64,
        access: Access<'_>,
    ) -> Result<Vec<Work>, CatalogError> {
        self.search_with_languages(query, limit, access, &LanguageFilter::default())
            .await
    }

    /// [`Self::search_with`] restricted to works matching `languages` (see
    /// [`LanguageFilter`]); applied after ranking, before truncating.
    pub async fn search_with_languages(
        &self,
        query: &str,
        limit: i64,
        access: Access<'_>,
        languages: &LanguageFilter,
    ) -> Result<Vec<Work>, CatalogError> {
        self.search_ranked(query, limit, access, languages, false)
            .await
    }

    /// [`Self::search_with_languages`] that can also keep only works with at least one playable
    /// media file (the same meaning as `BrowseQuery::available_only`), applied after ranking and
    /// before truncating, so a client never has to walk the whole catalogue to filter results.
    pub async fn search_ranked(
        &self,
        query: &str,
        limit: i64,
        access: Access<'_>,
        languages: &LanguageFilter,
        available_only: bool,
    ) -> Result<Vec<Work>, CatalogError> {
        let allowed_source_instance_ids = access.allowed;

        let raw_needle = query.trim();
        let limit = limit.max(0) as usize;

        if raw_needle.is_empty() {
            return Ok(Vec::new());
        }
        let needle = fold_locale(raw_needle);

        let snapshot = self.snapshots.get().await?;
        let mut cache_key = search_cache_key(
            &needle,
            limit as i64,
            allowed_source_instance_ids,
            &access.gate_key(),
            snapshot.version,
        );
        if !languages.is_empty() {
            cache_key.push_str(&format!(":lang={languages:?}"));
        }
        if available_only {
            cache_key.push_str(":available");
        }
        if let Some(cached) = self.cache.get(&cache_key).await? {
            if let Ok(items) = serde_json::from_slice::<Vec<Work>>(&cached) {
                return Ok(items);
            }
        }

        let mut scored: Vec<(Arc<Work>, MatchTier, f64)> = Vec::new();
        for kind in ALL_KINDS {
            for work in snapshot.works(kind) {
                if let Some((tier, score)) = score_search_match(work, &needle) {
                    scored.push((work.clone(), tier, score));
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

        let mut ranked: Vec<Arc<Work>> = scored.into_iter().map(|(work, _, _)| work).collect();
        self.apply_language_filter(&mut ranked, languages).await?;

        let mut matches: Vec<Work> = Vec::with_capacity(ranked.len().min(limit.max(1)));
        for work in ranked {
            if matches.len() >= limit {
                break;
            }
            if !access.permits(&work) {
                continue;
            }
            if available_only && !snapshot.is_playable(&work.id) {
                continue;
            }
            if let Some(allowed) = allowed_source_instance_ids {
                if !snapshot
                    .sources_of(&work.id)
                    .iter()
                    .any(|source| allowed.contains(source))
                {
                    continue;
                }
            }
            matches.push(work.as_ref().clone());
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
    /// `playarr_model::embedding`'s module doc comment) — "what else is
    /// like this". Brute-force cosine-similarity scan over every cached
    /// vector; the catalog is small enough (low thousands of works) that
    /// this needs no ANN index, and stays a single, simple code path
    /// rather than a second search infrastructure.
    ///
    /// Returns an empty list when `work_id` exists and is visible to the
    /// caller but has no cached embedding yet (not yet synced, or embedding
    /// generation hasn't been configured for this deployment via
    /// [`Self::with_embedding_repo`]), and [`CatalogError::NotFound`] only
    /// for an unknown or hidden work.
    ///
    /// `allowed_source_instance_ids` is the same per-user library access
    /// control ceiling [`Self::search`] and [`Self::get_by_id`] apply --
    /// `None` for an unrestricted caller, `Some(ids)` (including empty) to
    /// restrict results to works with at least one synced file from one of
    /// those source instances. Applied via [`Self::is_work_visible`] (the
    /// same underlying `MediaFileRepo::list_by_work_id` check [`Self::
    /// search`]/[`Self::get_by_id`] use) after ranking but before
    /// truncating to `limit`, for the same reason `search` filters after
    /// ranking rather than before: a restricted caller still sees the same
    /// similarity ordering as an unrestricted one, just with disallowed
    /// entries removed, rather than silently getting fewer than `limit`
    /// results when enough close matches exist catalog-wide.
    pub async fn similar(
        &self,
        work_id: Uuid,
        limit: i64,
        allowed_source_instance_ids: Option<&[Uuid]>,
    ) -> Result<Vec<Work>, CatalogError> {
        self.similar_with(work_id, limit, allowed_source_instance_ids.into())
            .await
    }

    /// [`Self::similar`] with a household [`WorkGate`] as well as library
    /// access.
    pub async fn similar_with(
        &self,
        work_id: Uuid,
        limit: i64,
        access: Access<'_>,
    ) -> Result<Vec<Work>, CatalogError> {
        let allowed_source_instance_ids = access.allowed;
        let limit = limit.max(0) as usize;

        let target = match &self.embedding_repo {
            Some(repo) => repo.get(work_id).await?,
            None => None,
        };
        let Some(target) = target else {
            // No embedding yet (or none configured): an existing, visible
            // work simply has nothing similar to list. Only an unknown or
            // hidden work is a 404, so detail pages do not log an error.
            return match self.work_repo.get(work_id).await {
                Ok(work)
                    if access.permits(&work)
                        && self
                            .is_work_visible(work_id, allowed_source_instance_ids)
                            .await? =>
                {
                    Ok(Vec::new())
                }
                Ok(_) | Err(DbError::NotFound) => Err(CatalogError::NotFound),
                Err(err) => Err(err.into()),
            };
        };
        let embedding_repo = self.embedding_repo.as_ref().ok_or(CatalogError::NotFound)?;
        let all = embedding_repo.list_all().await?;

        let mut scored: Vec<(Uuid, f32)> = all
            .iter()
            .filter(|e| e.work_id != work_id)
            .map(|e| {
                (
                    e.work_id,
                    playarr_embeddings::cosine_similarity(&target.vector, &e.vector),
                )
            })
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut works: Vec<Work> = Vec::with_capacity(scored.len().min(limit.max(1)));
        for (candidate_id, _score) in scored {
            if works.len() >= limit {
                break;
            }
            if !self
                .is_work_visible(candidate_id, allowed_source_instance_ids)
                .await?
            {
                continue;
            }
            match self.work_repo.get(candidate_id).await {
                Ok(work) if !access.permits(&work) => continue,
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
        self.get_by_id_with(id, allowed_source_instance_ids.into())
            .await
    }

    /// [`Self::get_by_id`] with a household [`WorkGate`] as well as library
    /// access. A gated work is `NotFound`, like a library-restricted one.
    pub async fn get_by_id_with(
        &self,
        id: Uuid,
        access: Access<'_>,
    ) -> Result<WorkDetail, CatalogError> {
        let allowed_source_instance_ids = access.allowed;
        let cache_key = work_detail_cache_key(id);
        if let Some(cached) = self.cache.get(&cache_key).await? {
            if let Ok(detail) = serde_json::from_slice::<WorkDetail>(&cached) {
                if !access.permits(&detail.work) {
                    return Err(CatalogError::NotFound);
                }
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

        if !access.permits(&work) {
            return Err(CatalogError::NotFound);
        }
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

        let available_on = self
            .hydrate_availability(std::slice::from_ref(&work.id))
            .await?
            .remove(&work.id)
            .unwrap_or_default();

        let detail = WorkDetail {
            work,
            children,
            media_file_id,
            runtime_ms,
            available_on,
        };

        if let Ok(bytes) = serde_json::to_vec(&detail) {
            self.cache
                .set(&cache_key, bytes, Some(WORK_DETAIL_CACHE_TTL))
                .await?;
        }

        Ok(detail)
    }

    /// The [`WorkFileView`] of each of `ids` the caller may see, in a few
    /// queries however many ids there are (the full [`Self::get_by_id`]
    /// costs several per work, and one per episode). `known` holds works the
    /// caller already loaded, so they are not read again. Ids that do not
    /// exist, that the household gate refuses, or that have no file in an
    /// allowed library are absent, exactly as `get_by_id` answers `NotFound`.
    pub async fn file_views(
        &self,
        ids: &[Uuid],
        known: &HashMap<Uuid, Work>,
        access: Access<'_>,
    ) -> Result<HashMap<Uuid, WorkFileView>, CatalogError> {
        let missing: Vec<Uuid> = ids
            .iter()
            .copied()
            .filter(|id| !known.contains_key(id))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let mut loaded = if missing.is_empty() {
            HashMap::new()
        } else {
            self.work_repo.get_many(&missing).await?
        };
        let mut works: HashMap<Uuid, Work> = HashMap::new();
        for id in ids {
            let work = known.get(id).cloned().or_else(|| loaded.remove(id));
            if let Some(work) = work.filter(|w| access.permits(w)) {
                works.insert(*id, work);
            }
        }
        if works.is_empty() {
            return Ok(HashMap::new());
        }
        let wanted: Vec<Uuid> = works.keys().copied().collect();
        let mut by_work: HashMap<Uuid, Vec<playarr_model::MediaFile>> = HashMap::new();
        for file in self.media_file_repo.list_by_work_ids(&wanted).await? {
            by_work.entry(file.work_id).or_default().push(file);
        }
        // Episode numbers of every series that has an episode file.
        let series: Vec<String> = works
            .values()
            .filter(|w| matches!(w.kind, WorkKind::Series | WorkKind::Site))
            .filter(|w| by_work.get(&w.id).is_some_and(|f| !f.is_empty()))
            .map(|w| w.id.to_string())
            .collect();
        let mut numbers: HashMap<Uuid, (i32, i32)> = HashMap::new();
        for chunk in series.chunks(400) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "SELECT e.id AS id, s.season_number AS season_number, e.episode_number AS episode_number \
                 FROM episodes e JOIN seasons s ON s.id = e.season_id \
                 WHERE s.series_work_id IN ({placeholders})"
            );
            let mut query = sqlx::query(&sql);
            for id in chunk {
                query = query.bind(id.clone());
            }
            for row in query.fetch_all(&self.pool).await? {
                numbers.insert(
                    codec::parse_uuid(&row.try_get::<String, _>("id")?)?,
                    (
                        row.try_get::<i64, _>("season_number")? as i32,
                        row.try_get::<i64, _>("episode_number")? as i32,
                    ),
                );
            }
        }
        let mut out = HashMap::new();
        for (id, work) in works {
            let files = by_work.remove(&id).unwrap_or_default();
            if let Some(allowed) = access.allowed {
                if !files
                    .iter()
                    .any(|f| allowed.contains(&f.source_instance_id))
                {
                    continue;
                }
            }
            // `files` is ordered by id, so the first file of a leaf is the
            // one `find_by_leaf` returns.
            let summary = match work.kind {
                WorkKind::Movie => WorkFiles::Movie(
                    files
                        .iter()
                        .find(|f| f.leaf_ref == LeafRef::Work)
                        .map(|f| f.id),
                ),
                WorkKind::Series | WorkKind::Site => {
                    let mut seen = HashSet::new();
                    let mut episodes: Vec<EpisodeFile> = files
                        .iter()
                        .filter_map(|f| match f.leaf_ref {
                            LeafRef::Episode(episode) if seen.insert(episode) => {
                                let (season_number, episode_number) = *numbers.get(&episode)?;
                                Some(EpisodeFile {
                                    season_number,
                                    episode_number,
                                    media_file_id: f.id,
                                })
                            }
                            _ => None,
                        })
                        .collect();
                    episodes.sort_by_key(|e| (e.season_number, e.episode_number));
                    WorkFiles::Series(episodes)
                }
                _ => WorkFiles::Other,
            };
            out.insert(
                id,
                WorkFileView {
                    work,
                    files: summary,
                },
            );
        }
        Ok(out)
    }

    /// The bare `Work` for `id`, `None` if it does not exist. For callers
    /// that must evaluate a per-work restriction (rating/tags) outside a
    /// catalog read.
    pub async fn work(&self, id: Uuid) -> Result<Option<Work>, CatalogError> {
        match self.work_repo.get(id).await {
            Ok(work) => Ok(Some(work)),
            Err(DbError::NotFound) => Ok(None),
            Err(other) => Err(CatalogError::Db(other)),
        }
    }

    /// `true` if `work_id` is visible under `allowed` -- the shared
    /// primitive behind [`Self::get_by_id`]'s access check and
    /// `playarr-api`'s playlist-item visibility filter (a caller can list
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
        self.is_work_visible_with(work_id, allowed.into()).await
    }

    /// [`Self::is_work_visible`] with a household [`WorkGate`] as well as
    /// library access.
    pub async fn is_work_visible_with(
        &self,
        work_id: Uuid,
        access: Access<'_>,
    ) -> Result<bool, CatalogError> {
        if let Some(gate) = access.gate {
            match self.work_repo.get(work_id).await {
                Ok(work) if !gate.permits(&work) => return Ok(false),
                Ok(_) => {}
                Err(DbError::NotFound) => return Ok(false),
                Err(other) => return Err(CatalogError::Db(other)),
            }
        }
        let Some(allowed) = access.allowed else {
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
    ) -> Result<Option<playarr_model::MediaFile>, CatalogError> {
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

        // Every episode and every file of the series in two queries, not two per
        // episode (a series with 300 episodes cost 600 statements).
        let mut episodes_by_season = self.episodes_for_series(series_work_id).await?;
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
            let episodes = episodes_by_season.remove(&id).unwrap_or_default();
            seasons.push(SeasonDetail { season, episodes });
        }
        Ok(seasons)
    }

    /// Episodes of every season of a series, by season id, each with its
    /// playable file (the lowest file id for the episode, as `find_by_leaf`).
    async fn episodes_for_series(
        &self,
        series_work_id: Uuid,
    ) -> Result<HashMap<Uuid, Vec<EpisodeDetail>>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, season_id, episode_number, title, overview, images, air_date, runtime_minutes, monitored, availability \
             FROM episodes WHERE season_id IN (SELECT id FROM seasons WHERE series_work_id = ?) \
             ORDER BY season_id, episode_number ASC",
        )
        .bind(series_work_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut files: HashMap<Uuid, playarr_model::MediaFile> = HashMap::new();
        for file in self.media_file_repo.list_by_work_id(series_work_id).await? {
            if let LeafRef::Episode(episode_id) = file.leaf_ref {
                match files.get(&episode_id) {
                    Some(kept) if kept.id <= file.id => {}
                    _ => {
                        files.insert(episode_id, file);
                    }
                }
            }
        }

        let mut by_season: HashMap<Uuid, Vec<EpisodeDetail>> = HashMap::new();
        for row in rows {
            let season_id = codec::parse_uuid(&row.try_get::<String, _>("season_id")?)?;
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
            let media_file = files.get(&id);
            let media_file_id = media_file.map(|file| file.id);
            let runtime_ms = media_file.and_then(|file| file.duration_ms);
            by_season.entry(season_id).or_default().push(EpisodeDetail {
                episode,
                media_file_id,
                runtime_ms,
            });
        }
        Ok(by_season)
    }

    async fn albums_for_artist(
        &self,
        artist_work_id: Uuid,
    ) -> Result<Vec<AlbumDetail>, CatalogError> {
        let rows = sqlx::query(
            "SELECT id, title, images, album_type, release_date, monitored, availability \
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
            let images_json: String = row.try_get("images")?;
            let images: Vec<ImageAsset> = serde_json::from_str(&images_json).map_err(|error| {
                CatalogError::Data(format!("invalid album images JSON for {id}: {error}"))
            })?;
            let album = Album {
                id,
                artist_work_id,
                title: row.try_get("title")?,
                images,
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

fn album_type_from_str(raw: &str) -> Result<playarr_model::AlbumType, CatalogError> {
    use playarr_model::AlbumType;
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
fn album_type_to_str(album_type: playarr_model::AlbumType) -> &'static str {
    use playarr_model::AlbumType;
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
    use playarr_cache::InMemory;
    use playarr_db::repo::{
        SqlxMediaFileRepo, SqlxPeerLeafAvailabilityRepo, SqlxPeerNodeRepo, SqlxWatchProgressRepo,
    };
    use playarr_model::{
        Availability, ExternalProvider, ExternalRef, ImageAsset, ImageKind, LeafSelector,
        MediaFile, PeerAddress, PeerNode, PeerNodeStatus, WorkKind,
    };
    use std::path::PathBuf;

    use super::*;

    /// An in-process, real-SQL `WorkRepo` double backed by the same
    /// `works`/`work_external_refs` tables `playarr-db`'s (still
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
                end_date: None,
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
    /// `playarr_db::connect` (which hardcodes `max_connections(10)`):
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
        let url = format!("sqlite://playarr_catalog_test_{n}?mode=memory&cache=shared");

        sqlx::any::install_default_drivers();
        let pool: DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("open in-memory sqlite pool");
        playarr_db::run_migrations(&pool)
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

    /// [`seed_media_file_for_source`] with its own `source_file_id`, for tests
    /// that seed several files into one source instance.
    async fn seed_numbered_media_file(
        pool: &DbPool,
        work_id: Uuid,
        leaf_ref: LeafRef,
        source_instance_id: Uuid,
        number: u32,
    ) -> Uuid {
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
            source_file_id: Some(number.to_string()),
        };
        media_file_repo(pool.clone())
            .create(&file)
            .await
            .expect("seed media file");
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
            end_date: None,
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
        .bind(album_type_to_str(playarr_model::AlbumType::Studio))
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

    /// Progress on a file that was hidden (marked missing) must not count as
    /// a watched file: the work's file total excludes the hidden row, so the
    /// work would otherwise read as fully watched.
    #[tokio::test]
    async fn watch_summaries_ignore_progress_on_hidden_files() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let work = movie("Hidden Rows", "Hidden Rows", &["drama"], 1);
        repo.upsert(&work).await.unwrap();
        let visible = seed_media_file(&pool, work.id, LeafRef::Work).await;
        let hidden = seed_media_file(&pool, work.id, LeafRef::Work).await;
        sqlx::query("UPDATE media_files SET missing_since = '2024-01-01T00:00:00Z' WHERE id = ?")
            .bind(hidden.to_string())
            .execute(&pool)
            .await
            .unwrap();
        let user = Uuid::new_v4();
        let policy = Uuid::new_v4();
        sqlx::query("INSERT INTO policies (id, name) VALUES (?, 'p')")
            .bind(policy.to_string())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO users (id, username, display_name, password_hash, policy_id, created_at, disabled) \
             VALUES (?, 'u', 'U', 'x', ?, '2024-01-01T00:00:00.000Z', 0)",
        )
        .bind(user.to_string())
        .bind(policy.to_string())
        .execute(&pool)
        .await
        .unwrap();
        for (file, state) in [(hidden, "watched"), (visible, "part_watched")] {
            sqlx::query(
                "INSERT INTO watch_progress (user_id, media_file_id, position_ms, duration_ms, state, updated_at) \
                 VALUES (?, ?, 5, 10, ?, '2024-01-01T00:00:00.000Z')",
            )
            .bind(user.to_string())
            .bind(file.to_string())
            .bind(state)
            .execute(&pool)
            .await
            .unwrap();
        }
        let svc = service(pool, repo);
        let summaries = svc.watch_summaries(user).await.unwrap();
        let watch = &summaries[&work.id];
        assert_eq!((watch.total_files, watch.watched_files), (1, 0));
        assert!(!watch.is_complete());
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

        let view = playarr_model::LibraryView {
            id: Uuid::new_v4(),
            name: "Newly Released Action".to_string(),
            criteria: playarr_model::ViewCriteria {
                kind: Some(WorkKind::Movie),
                genre: Some("action".to_string()),
                ..Default::default()
            },
            sort: vec![playarr_model::ViewSort::RecentlyReleased],
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
        repo.upsert(&movie("The Sample Escape", "Sample Escape, The", &[], 0))
            .await
            .unwrap();
        repo.upsert(&movie("Unrelated", "Unrelated", &[], 0))
            .await
            .unwrap();
        let svc = service(pool, repo);

        let by_title = svc.search("sample escape", 10, None).await.unwrap();
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].title, "The Sample Escape");

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
        repo.upsert(&movie("Sémon", "Semon", &[], 0)).await.unwrap();
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

    #[tokio::test]
    async fn search_available_only_drops_works_without_a_media_file_before_the_limit() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let playable = movie("Findme Playable", "Findme Playable", &[], 0);
        let playable_id = playable.id;
        repo.upsert(&playable).await.unwrap();
        // Sorts first (an exact tier tie broken alphabetically) but has no media file.
        let unplayable = movie("Findme Absent", "Findme Absent", &[], 0);
        repo.upsert(&unplayable).await.unwrap();
        seed_media_file_for_source(&pool, playable_id, LeafRef::Work, Uuid::new_v4()).await;
        let svc = service(pool, repo);
        let access = || Access::from(None::<&[Uuid]>);

        let all = svc
            .search_ranked("findme", 10, access(), &LanguageFilter::default(), false)
            .await
            .unwrap();
        assert_eq!(all.len(), 2);
        let only = svc
            .search_ranked("findme", 1, access(), &LanguageFilter::default(), true)
            .await
            .unwrap();
        assert_eq!(only.len(), 1);
        assert_eq!(only[0].id, playable_id);
    }

    fn embedding_repo(pool: DbPool) -> Arc<dyn playarr_db::EmbeddingRepo> {
        Arc::new(playarr_db::repo::SqlxEmbeddingRepo::new(pool))
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
            .upsert(&playarr_model::WorkEmbedding {
                work_id: target.id,
                model_id: "test".to_string(),
                source_text: "x".to_string(),
                vector: vec![1.0, 0.0, 0.0],
                updated_at: Utc::now(),
            })
            .await
            .unwrap();
        embeddings
            .upsert(&playarr_model::WorkEmbedding {
                work_id: close.id,
                model_id: "test".to_string(),
                source_text: "x".to_string(),
                vector: vec![0.9, 0.1, 0.0],
                updated_at: Utc::now(),
            })
            .await
            .unwrap();
        embeddings
            .upsert(&playarr_model::WorkEmbedding {
                work_id: far.id,
                model_id: "test".to_string(),
                source_text: "x".to_string(),
                vector: vec![0.0, 0.0, 1.0],
                updated_at: Utc::now(),
            })
            .await
            .unwrap();

        let svc = service(pool, repo).with_embedding_repo(embeddings);
        let results = svc.similar(target.id, 10, None).await.unwrap();
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
    async fn similar_without_a_cached_embedding_is_empty() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let target = movie("No Embedding Yet", "No Embedding Yet", &[], 0);
        repo.upsert(&target).await.unwrap();
        let embeddings = embedding_repo(pool.clone());

        let svc = service(pool, repo).with_embedding_repo(embeddings);
        assert!(svc.similar(target.id, 10, None).await.unwrap().is_empty());
        let err = svc.similar(Uuid::new_v4(), 10, None).await.unwrap_err();
        assert!(matches!(err, CatalogError::NotFound));
    }

    #[tokio::test]
    async fn similar_without_embedding_repo_configured_is_empty() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let target = movie("Unconfigured", "Unconfigured", &[], 0);
        repo.upsert(&target).await.unwrap();

        let svc = service(pool, repo); // no `.with_embedding_repo(...)`
        assert!(svc.similar(target.id, 10, None).await.unwrap().is_empty());
    }

    /// Mirrors `search_enforces_allowed_source_instance_ids` -- `similar`
    /// must apply the exact same per-user library access control ceiling to
    /// its ranked candidates, not just to `search`/`browse`/`get_by_id`.
    #[tokio::test]
    async fn similar_enforces_allowed_source_instance_ids() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let target = movie("Similar Target", "Similar Target", &[], 0);
        let allowed_match = movie("Similar Allowed", "Similar Allowed", &[], 0);
        let disallowed_match = movie("Similar Disallowed", "Similar Disallowed", &[], 0);
        for w in [&target, &allowed_match, &disallowed_match] {
            repo.upsert(w).await.unwrap();
        }

        let instance_a = Uuid::new_v4();
        let instance_b = Uuid::new_v4();
        seed_media_file_for_source(&pool, allowed_match.id, LeafRef::Work, instance_a).await;
        seed_media_file_for_source(&pool, disallowed_match.id, LeafRef::Work, instance_b).await;

        let embeddings = embedding_repo(pool.clone());
        for (work_id, vector) in [
            (target.id, vec![1.0, 0.0, 0.0]),
            (allowed_match.id, vec![0.9, 0.1, 0.0]),
            (disallowed_match.id, vec![0.8, 0.2, 0.0]),
        ] {
            embeddings
                .upsert(&playarr_model::WorkEmbedding {
                    work_id,
                    model_id: "test".to_string(),
                    source_text: "x".to_string(),
                    vector,
                    updated_at: Utc::now(),
                })
                .await
                .unwrap();
        }

        let svc = service(pool, repo).with_embedding_repo(embeddings);

        let unrestricted = svc.similar(target.id, 10, None).await.unwrap();
        assert_eq!(unrestricted.len(), 2);

        let restricted = svc
            .similar(target.id, 10, Some(&[instance_a]))
            .await
            .unwrap();
        assert_eq!(restricted.len(), 1);
        assert_eq!(restricted[0].id, allowed_match.id);

        let denied_all = svc.similar(target.id, 10, Some(&[])).await.unwrap();
        assert!(denied_all.is_empty());
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
            kind: playarr_model::ImageKind::Thumb,
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

    /// `file_views` must answer what `get_by_id` answers, for the facts the
    /// calendar uses: visibility, a movie's file, a series' episode files in
    /// order, and no file for an episode that has none.
    #[tokio::test]
    async fn file_views_match_get_by_id_for_movies_series_and_access() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let library = Uuid::new_v4();
        let other_library = Uuid::new_v4();

        let film = movie("Film", "Film", &[], 0);
        let film_id = film.id;
        repo.upsert(&film).await.unwrap();
        let film_file = seed_numbered_media_file(&pool, film_id, LeafRef::Work, library, 1).await;

        let show = series("Show", "Show");
        let show_id = show.id;
        repo.upsert(&show).await.unwrap();
        let s1 = insert_season(&pool, show_id, 1, "S1").await;
        let s2 = insert_season(&pool, show_id, 2, "S2").await;
        let e11 = insert_episode(&pool, s1, 1, "One").await;
        insert_episode(&pool, s1, 2, "Two (no file)").await;
        let e21 = insert_episode(&pool, s2, 1, "Three").await;
        // Seeded out of order on purpose.
        let f21 = seed_numbered_media_file(&pool, show_id, LeafRef::Episode(e21), library, 2).await;
        let f11 = seed_numbered_media_file(&pool, show_id, LeafRef::Episode(e11), library, 3).await;

        let unsynced = movie("Unsynced", "Unsynced", &[], 0);
        let unsynced_id = unsynced.id;
        repo.upsert(&unsynced).await.unwrap();

        let svc = service(pool, repo);
        let ids = [film_id, show_id, unsynced_id, Uuid::new_v4()];

        let views = svc
            .file_views(&ids, &HashMap::new(), Access::default())
            .await
            .unwrap();
        assert_eq!(views.len(), 3, "an unknown id is absent");
        assert_eq!(views[&film_id].files, WorkFiles::Movie(Some(film_file)));
        assert_eq!(views[&unsynced_id].files, WorkFiles::Movie(None));
        assert_eq!(
            views[&show_id].files,
            WorkFiles::Series(vec![
                EpisodeFile {
                    season_number: 1,
                    episode_number: 1,
                    media_file_id: f11
                },
                EpisodeFile {
                    season_number: 2,
                    episode_number: 1,
                    media_file_id: f21
                },
            ])
        );
        // Same facts as the full detail.
        let detail = svc.get_by_id(show_id, None).await.unwrap();
        let WorkChildren::Series(seasons) = detail.children else {
            panic!("series")
        };
        let from_detail: Vec<(i32, i32, Uuid)> = seasons
            .iter()
            .flat_map(|s| {
                s.episodes.iter().filter_map(|e| {
                    Some((
                        s.season.season_number,
                        e.episode.episode_number,
                        e.media_file_id?,
                    ))
                })
            })
            .collect();
        let WorkFiles::Series(episodes) = &views[&show_id].files else {
            panic!("series")
        };
        let from_view: Vec<(i32, i32, Uuid)> = episodes
            .iter()
            .map(|e| (e.season_number, e.episode_number, e.media_file_id))
            .collect();
        assert_eq!(from_detail, from_view);

        // A restricted caller sees only works with a file in an allowed library.
        let allowed = [library];
        let views = svc
            .file_views(&ids, &HashMap::new(), Access::from(Some(&allowed[..])))
            .await
            .unwrap();
        assert_eq!(views.len(), 2);
        assert!(!views.contains_key(&unsynced_id));
        let elsewhere = [other_library];
        assert!(svc
            .file_views(&ids, &HashMap::new(), Access::from(Some(&elsewhere[..])))
            .await
            .unwrap()
            .is_empty());

        // A work the caller already loaded is not read again.
        let known: HashMap<Uuid, Work> = HashMap::from([(film_id, views[&film_id].work.clone())]);
        let again = svc
            .file_views(&[film_id], &known, Access::default())
            .await
            .unwrap();
        assert_eq!(again[&film_id].files, WorkFiles::Movie(Some(film_file)));
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

    /// Gate that hides any work carrying a `blocked` tag.
    struct HideBlocked(&'static str);

    impl WorkGate for HideBlocked {
        fn permits(&self, work: &Work) -> bool {
            !work.tags.iter().any(|t| t == "blocked")
        }

        fn cache_key(&self) -> String {
            self.0.to_string()
        }
    }

    #[tokio::test]
    async fn work_gate_applies_to_browse_search_detail_and_never_shares_cache() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let ok = movie("Gate Fine", "Gate Fine", &[], 0);
        let mut bad = movie("Gate Hidden", "Gate Hidden", &[], 0);
        bad.tags.push("blocked".to_string());
        repo.upsert(&ok).await.unwrap();
        repo.upsert(&bad).await.unwrap();
        let svc = service(pool, repo);

        // An ungated caller warms the browse and search caches first.
        let all = svc.browse(BrowseQuery::default()).await.unwrap();
        assert_eq!(all.items.len(), 2);
        assert_eq!(svc.search("gate", 10, None).await.unwrap().len(), 2);
        svc.get_by_id(bad.id, None).await.unwrap();

        let gate = SharedGate(Arc::new(HideBlocked("hide-blocked")));
        let gated = svc
            .browse(BrowseQuery {
                gate: Some(gate.clone()),
                ..BrowseQuery::default()
            })
            .await
            .unwrap();
        assert_eq!(gated.items.len(), 1);
        assert_eq!(gated.items[0].id, ok.id);

        let access = Access::new(None, Some(gate.0.as_ref()));
        let found = svc.search_with("gate", 10, access).await.unwrap();
        assert_eq!(found.len(), 1);
        assert!(matches!(
            svc.get_by_id_with(bad.id, access).await,
            Err(CatalogError::NotFound)
        ));
        svc.get_by_id_with(ok.id, access).await.unwrap();
        assert!(!svc.is_work_visible_with(bad.id, access).await.unwrap());
        assert!(svc.is_work_visible_with(ok.id, access).await.unwrap());
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
        let version = svc.snapshot_version().await.unwrap();

        // Delete straight through the repo (bypassing the service/cache) —
        // a cached `browse` should still see the now-stale result, proving
        // the cache path was actually exercised rather than re-querying.
        repo.delete(first.items[0].id).await.unwrap();

        let second = svc.browse(BrowseQuery::default()).await.unwrap();
        // Live events published by tests running in parallel in this process
        // can rebuild the snapshot, which rightly drops the cached page; the
        // cache is only observable while the snapshot is the same.
        if svc.snapshot_version().await.unwrap() == version {
            assert_eq!(
                second.items.len(),
                1,
                "expected the cached page, not a fresh (now-empty) query"
            );
        }
    }

    // ---- §4.3 peer availability hydration / RemoteOnlyWork union ----

    /// Like [`service`] but also wired with real, SQL-backed
    /// `PeerLeafAvailabilityRepo`/`PeerNodeRepo`s (`with_peer_leaf_availability`)
    /// against the same pool -- the tables both repos need
    /// (`peer_leaf_availability`, `peer_nodes`, `peer_groups`) are part of
    /// this crate's own embedded migration set (see `test_pool`'s doc
    /// comment), same as every other table these tests already exercise.
    fn service_with_peer_availability(pool: DbPool, repo: Arc<dyn WorkRepo>) -> CatalogService {
        let watch_progress_repo = Arc::new(SqlxWatchProgressRepo::new(pool.clone()));
        let availability_repo = Arc::new(SqlxPeerLeafAvailabilityRepo::new(pool.clone()));
        let peer_node_repo = Arc::new(SqlxPeerNodeRepo::new(pool.clone()));
        CatalogService::new(
            repo,
            media_file_repo(pool.clone()),
            Arc::new(InMemory::new()),
            pool,
            watch_progress_repo,
        )
        .with_peer_leaf_availability(availability_repo, peer_node_repo)
    }

    /// `peer_nodes.group_id` is a real `REFERENCES peer_groups (id)` foreign
    /// key -- same bypass-the-sibling-repo direct-insert pattern
    /// `playarr-db::repo::peer_node`'s own tests use for the identical
    /// constraint.
    async fn seed_peer_group(pool: &DbPool) -> Uuid {
        let group_id = Uuid::new_v4();
        sqlx::query("INSERT INTO peer_groups (id, name, created_at) VALUES (?, ?, ?)")
            .bind(group_id.to_string())
            .bind("test group")
            .bind(codec::format_datetime(Utc::now()))
            .execute(pool)
            .await
            .expect("seed peer_groups row");
        group_id
    }

    async fn seed_peer_node(pool: &DbPool, group_id: Uuid, name: &str) -> Uuid {
        let repo = SqlxPeerNodeRepo::new(pool.clone());
        let now = Utc::now();
        let node = PeerNode {
            id: Uuid::new_v4(),
            group_id,
            name: name.to_string(),
            addresses: vec![PeerAddress {
                url: format!("https://{name}.example.com"),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            }],
            public_key: "base64-ed25519-public-key".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        };
        repo.upsert(&node).await.expect("seed peer node");
        node.id
    }

    fn sample_availability(
        peer_node_id: Uuid,
        provider: ExternalProvider,
        external_id: &str,
        local_work_id: Option<Uuid>,
        group_library_id: Option<Uuid>,
    ) -> playarr_model::PeerLeafAvailability {
        playarr_model::PeerLeafAvailability {
            peer_node_id,
            media_file_id: Uuid::new_v4(),
            source_instance_id: Uuid::new_v4(),
            path: "/media/remote.mkv".to_string(),
            provider,
            external_id: external_id.to_string(),
            leaf_selector: LeafSelector::Movie,
            group_library_id,
            availability: Availability::Available,
            container: Some("mkv".to_string()),
            codec: Some("h264".to_string()),
            bitrate: Some(8_000_000),
            size_bytes: Some(4_000_000_000),
            duration_ms: Some(7_200_000),
            local_work_id,
            title: "Remote Title".to_string(),
            kind: WorkKind::Movie,
            release_date: Some(Utc::now() - ChronoDuration::days(400)),
            updated_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn browse_hydrates_available_on_badges_for_matched_works() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let svc = service_with_peer_availability(pool.clone(), repo.clone());

        let work = movie("Hydration Movie", "Hydration Movie", &["drama"], 0);
        repo.upsert(&work).await.unwrap();

        let group_id = seed_peer_group(&pool).await;
        let peer_id = seed_peer_node(&pool, group_id, "east").await;
        let availability_repo = SqlxPeerLeafAvailabilityRepo::new(pool.clone());
        availability_repo
            .upsert(&sample_availability(
                peer_id,
                work.external_refs[0].provider.clone(),
                &work.external_refs[0].external_id,
                Some(work.id),
                None,
            ))
            .await
            .unwrap();
        // A second physical Source copy on the same peer must not duplicate
        // that peer's work-level availability badge.
        availability_repo
            .upsert(&sample_availability(
                peer_id,
                work.external_refs[0].provider.clone(),
                &work.external_refs[0].external_id,
                Some(work.id),
                None,
            ))
            .await
            .unwrap();

        let page = svc.browse(BrowseQuery::default()).await.unwrap();
        let badges = page.available_on.get(&work.id).expect("badges for work");
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].peer_node_id, peer_id);
        assert_eq!(badges[0].peer_name, "east");
        assert_eq!(badges[0].availability, Availability::Available);
    }

    #[tokio::test]
    async fn get_by_id_hydrates_available_on_badges() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let svc = service_with_peer_availability(pool.clone(), repo.clone());

        let work = movie("Hydration Movie", "Hydration Movie", &["drama"], 0);
        repo.upsert(&work).await.unwrap();

        let group_id = seed_peer_group(&pool).await;
        let peer_id = seed_peer_node(&pool, group_id, "west").await;
        let availability_repo = SqlxPeerLeafAvailabilityRepo::new(pool.clone());
        availability_repo
            .upsert(&sample_availability(
                peer_id,
                work.external_refs[0].provider.clone(),
                &work.external_refs[0].external_id,
                Some(work.id),
                None,
            ))
            .await
            .unwrap();

        let detail = svc.get_by_id(work.id, None).await.unwrap();
        assert_eq!(detail.available_on.len(), 1);
        assert_eq!(detail.available_on[0].peer_node_id, peer_id);
        assert_eq!(detail.available_on[0].peer_name, "west");
    }

    /// A deployment with no `with_peer_leaf_availability` wiring at all
    /// (the default, byte-for-byte-inert-for-a-single-node case) gets empty
    /// availability data rather than an error -- confirms [`service`] (no
    /// peer wiring) still browses/get_by_ids successfully.
    #[tokio::test]
    async fn browse_and_get_by_id_are_inert_without_peer_leaf_availability_wiring() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let svc = service(pool.clone(), repo.clone());

        let work = movie("Hydration Movie", "Hydration Movie", &["drama"], 0);
        repo.upsert(&work).await.unwrap();

        let page = svc.browse(BrowseQuery::default()).await.unwrap();
        assert!(page.available_on.is_empty());
        assert!(page.remote_only.is_empty());

        let detail = svc.get_by_id(work.id, None).await.unwrap();
        assert!(detail.available_on.is_empty());
    }

    #[tokio::test]
    async fn browse_unions_remote_only_works_for_requested_group_libraries() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let svc = service_with_peer_availability(pool.clone(), repo.clone());

        let group_id = seed_peer_group(&pool).await;
        let peer_id = seed_peer_node(&pool, group_id, "north").await;
        let target_group_library = Uuid::new_v4();
        let other_group_library = Uuid::new_v4();
        let availability_repo = SqlxPeerLeafAvailabilityRepo::new(pool.clone());

        let mut unmatched = sample_availability(
            peer_id,
            ExternalProvider::Tmdb,
            "603",
            None,
            Some(target_group_library),
        );
        unmatched.title = "The Sample Movie".to_string();
        availability_repo.upsert(&unmatched).await.unwrap();

        // A row scoped to a DIFFERENT group library must not leak in.
        let mut other = sample_availability(
            peer_id,
            ExternalProvider::Tmdb,
            "999",
            None,
            Some(other_group_library),
        );
        other.title = "Not This Library".to_string();
        availability_repo.upsert(&other).await.unwrap();

        let page = svc
            .browse(BrowseQuery {
                group_library_ids: vec![target_group_library],
                ..BrowseQuery::default()
            })
            .await
            .unwrap();

        assert_eq!(page.remote_only.len(), 1);
        assert_eq!(page.remote_only[0].title, "The Sample Movie");
        assert_eq!(page.remote_only[0].external_id, "603");
        assert_eq!(page.remote_only[0].available_on.len(), 1);
        assert_eq!(page.remote_only[0].available_on[0].peer_node_id, peer_id);
    }

    /// Two peers reporting the same unmatched `(provider, external_id)`
    /// merge into one `RemoteOnlyWork` with two `available_on` badges,
    /// rather than two duplicate entries.
    #[tokio::test]
    async fn remote_only_works_merge_multiple_peers_reporting_the_same_title() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let svc = service_with_peer_availability(pool.clone(), repo.clone());

        let group_id = seed_peer_group(&pool).await;
        let peer_a = seed_peer_node(&pool, group_id, "peer-a").await;
        let peer_b = seed_peer_node(&pool, group_id, "peer-b").await;
        let group_library_id = Uuid::new_v4();
        let availability_repo = SqlxPeerLeafAvailabilityRepo::new(pool.clone());

        for peer_id in [peer_a, peer_b] {
            availability_repo
                .upsert(&sample_availability(
                    peer_id,
                    ExternalProvider::Tmdb,
                    "603",
                    None,
                    Some(group_library_id),
                ))
                .await
                .unwrap();
        }

        let page = svc
            .browse(BrowseQuery {
                group_library_ids: vec![group_library_id],
                ..BrowseQuery::default()
            })
            .await
            .unwrap();

        assert_eq!(page.remote_only.len(), 1);
        assert_eq!(page.remote_only[0].available_on.len(), 2);
    }

    #[tokio::test]
    async fn search_remote_only_matches_unmatched_titles_by_fuzzy_title() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let svc = service_with_peer_availability(pool.clone(), repo.clone());

        let group_id = seed_peer_group(&pool).await;
        let peer_id = seed_peer_node(&pool, group_id, "east").await;
        let group_library_id = Uuid::new_v4();
        let availability_repo = SqlxPeerLeafAvailabilityRepo::new(pool.clone());
        let mut unmatched = sample_availability(
            peer_id,
            ExternalProvider::Tmdb,
            "603",
            None,
            Some(group_library_id),
        );
        unmatched.title = "Brambleford".to_string();
        availability_repo.upsert(&unmatched).await.unwrap();

        let exact = svc
            .search_remote_only("brambleford", &[group_library_id])
            .await
            .unwrap();
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].title, "Brambleford");

        // Fuzzy match, same tolerance `search`'s own title matching uses.
        let fuzzy = svc
            .search_remote_only("Bramblefrod", &[group_library_id])
            .await
            .unwrap();
        assert_eq!(fuzzy.len(), 1);

        let no_match = svc
            .search_remote_only("completely unrelated", &[group_library_id])
            .await
            .unwrap();
        assert!(no_match.is_empty());
    }

    #[tokio::test]
    async fn search_remote_only_empty_group_library_ids_returns_nothing() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let svc = service_with_peer_availability(pool.clone(), repo.clone());

        let results = svc.search_remote_only("anything", &[]).await.unwrap();
        assert!(results.is_empty());
    }
    // ---- snapshot freshness ----

    /// With nothing written, repeated reads keep the snapshot version (so caches
    /// keyed on it keep hitting) however often the database probe runs.
    #[tokio::test]
    async fn snapshot_version_is_kept_while_nothing_changes() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        repo.upsert(&movie("Steady Movie", "Steady Movie", &[], 0))
            .await
            .unwrap();
        let svc = service(pool.clone(), repo);
        svc.set_snapshot_probe_every(Duration::ZERO);
        let first = svc.snapshot_version().await.unwrap();
        for _ in 0..5 {
            assert_eq!(svc.snapshot_version().await.unwrap(), first);
        }
    }

    /// A write that publishes no event here (another process, or a repo used
    /// without the eventing wrapper) is seen once the probe interval passes.
    #[tokio::test]
    async fn write_without_an_event_is_seen_after_the_probe_interval() {
        let pool = test_pool().await;
        let repo = work_repo(pool.clone());
        let a = movie("Probe A", "Probe A", &[], 0);
        repo.upsert(&a).await.unwrap();
        seed_media_file(&pool, a.id, LeafRef::Work).await;
        let svc = service(pool.clone(), repo.clone());
        svc.set_snapshot_probe_every(Duration::from_millis(200));
        let query = |offset| BrowseQuery {
            available_only: true,
            offset,
            ..BrowseQuery::default()
        };
        assert_eq!(svc.browse(query(0)).await.unwrap().items.len(), 1);

        // Straight through the raw repos: no live event in this process.
        let b = movie("Probe B", "Probe B", &[], 0);
        repo.upsert(&b).await.unwrap();
        let file = MediaFile {
            id: Uuid::new_v4(),
            work_id: b.id,
            leaf_ref: LeafRef::Work,
            path: PathBuf::from("/media/b.mkv"),
            container: "mkv".to_string(),
            codec: "h264".to_string(),
            bitrate: None,
            duration_ms: None,
            size_bytes: 1,
            source_instance_id: Uuid::new_v4(),
            source_file_id: Some("probe-b".to_string()),
        };
        SqlxMediaFileRepo::new(pool.clone())
            .create(&file)
            .await
            .unwrap();

        tokio::time::sleep(Duration::from_millis(300)).await;
        let page = svc.browse(query(0)).await.unwrap();
        assert_eq!(
            page.items.len(),
            2,
            "the probe should have seen the new work and file"
        );
    }

    /// A work upserted through the eventing repo shows in the very next read,
    /// including one served from the page cache before the change.
    #[tokio::test]
    async fn browse_sees_an_event_published_upsert_at_once() {
        let pool = test_pool().await;
        let raw = work_repo(pool.clone());
        let repo: Arc<dyn WorkRepo> = Arc::new(playarr_db::EventingWorkRepo::new(
            raw,
            playarr_db::LiveEventPublisher::from_pool(pool.clone()),
        ));
        repo.upsert(&movie("Before", "Before", &[], 0))
            .await
            .unwrap();
        let svc = service(pool.clone(), repo.clone());
        assert_eq!(
            svc.browse(BrowseQuery::default())
                .await
                .unwrap()
                .items
                .len(),
            1
        );
        repo.upsert(&movie("After", "After", &[], 0)).await.unwrap();
        let page = svc.browse(BrowseQuery::default()).await.unwrap();
        assert!(
            page.items.iter().any(|w| w.title == "After"),
            "{:?}",
            page.items.len()
        );
    }

    struct FlakyRepo {
        inner: Arc<dyn WorkRepo>,
        fail: std::sync::atomic::AtomicBool,
        lists: std::sync::atomic::AtomicUsize,
    }

    #[async_trait]
    impl WorkRepo for FlakyRepo {
        async fn get(&self, id: Uuid) -> Result<Work, DbError> {
            self.inner.get(id).await
        }
        async fn list_by_kind(
            &self,
            kind: WorkKind,
            limit: i64,
            offset: i64,
        ) -> Result<Vec<Work>, DbError> {
            self.lists.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
                return Err(DbError::NotFound);
            }
            self.inner.list_by_kind(kind, limit, offset).await
        }
        async fn upsert(&self, work: &Work) -> Result<(), DbError> {
            self.inner.upsert(work).await
        }
        async fn delete(&self, id: Uuid) -> Result<(), DbError> {
            self.inner.delete(id).await
        }
        async fn find_by_external_ref(
            &self,
            provider: &ExternalProvider,
            external_id: &str,
        ) -> Result<Option<Work>, DbError> {
            self.inner.find_by_external_ref(provider, external_id).await
        }
    }

    /// A failed rebuild keeps the previous snapshot in service and is not
    /// retried on every read; a rebuild whose first waiter went away still
    /// completes.
    #[tokio::test]
    async fn failed_rebuild_serves_the_previous_snapshot_and_backs_off() {
        let pool = test_pool().await;
        let flaky = Arc::new(FlakyRepo {
            inner: work_repo(pool.clone()),
            fail: std::sync::atomic::AtomicBool::new(false),
            lists: std::sync::atomic::AtomicUsize::new(0),
        });
        flaky.upsert(&movie("Kept", "Kept", &[], 0)).await.unwrap();
        let svc = service(pool.clone(), flaky.clone());

        // A caller that gives up straight away does not stop the build.
        let _ = tokio::time::timeout(Duration::ZERO, svc.snapshot_version()).await;
        let version = svc.snapshot_version().await.unwrap();

        flaky.fail.store(true, std::sync::atomic::Ordering::SeqCst);
        svc.invalidate_snapshot();
        let calls = flaky.lists.load(std::sync::atomic::Ordering::SeqCst);
        assert_eq!(svc.snapshot_version().await.unwrap(), version);
        let after_first = flaky.lists.load(std::sync::atomic::Ordering::SeqCst);
        assert!(after_first > calls, "the rebuild should have been tried");
        // Still dirty, but inside the backoff: no second attempt.
        assert_eq!(svc.snapshot_version().await.unwrap(), version);
        assert_eq!(
            flaky.lists.load(std::sync::atomic::Ordering::SeqCst),
            after_first
        );
        let page = svc.browse(BrowseQuery::default()).await.unwrap();
        assert_eq!(page.items.len(), 1);
    }
}

/// A second, independent confirmation on top of the `tests` module above:
/// the primary suite deliberately uses its own SQL-backed `WorkRepo` double
/// (see that module's doc comment for why — `SqlxWorkRepo` was still
/// `unimplemented!()` when this crate's tests were first written), so it
/// can't by itself prove `CatalogService` works against the *real*
/// production `playarr_db::repo::SqlxWorkRepo`. Now that that landed for
/// real (concurrently, in the sibling task this crate was built against),
/// this module exercises `CatalogService` against it directly — same
/// migrations, same schema, real repository — as a final end-to-end check
/// that the two crates actually interoperate rather than merely each
/// satisfying the `WorkRepo` trait in isolation.
#[cfg(test)]
mod real_work_repo_integration {
    use std::sync::Arc;

    use chrono::Utc;
    use playarr_cache::InMemory;
    use playarr_db::repo::{SqlxMediaFileRepo, SqlxWatchProgressRepo, SqlxWorkRepo};
    use playarr_model::{Availability, ExternalProvider, ExternalRef, WorkKind};
    use uuid::Uuid;

    use super::*;

    async fn ad_hoc_pool() -> DbPool {
        sqlx::any::install_default_drivers();
        let pool: DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite://playarr_catalog_real_repo_test?mode=memory&cache=shared")
            .await
            .unwrap();
        playarr_db::run_migrations(&pool).await.unwrap();
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
            end_date: None,
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
