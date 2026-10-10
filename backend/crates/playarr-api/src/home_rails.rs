//! Home rails: server-computed, per-user shelves.
//!
//! * `GET /api/v1/home/rails` -- the caller's ordered, non-empty rails with
//!   localised titles (`lang=en|th|ja`, else `Accept-Language`, else en).
//! * `GET|PUT|DELETE /api/v1/home/rails/preferences` -- the caller's own
//!   hide/reorder overrides.
//! * `GET|POST /api/v1/admin/home-rails`, `PUT|DELETE
//!   /api/v1/admin/home-rails/{id}`, `PUT /api/v1/admin/home-rails/order` --
//!   admin management of the definitions (defaults are seeded per library;
//!   custom rails point at a saved view from `/api/v1/admin/views`).
//!
//! Everything is computed from the catalogue the caller may see (library
//! allow-list and household gate applied before any ranking), so a rail can
//! never leak a title the caller cannot browse. Results are cached per user
//! and language in the shared cache, invalidated when the user's watch
//! progress or rail preferences change and, for everyone, when an admin edits
//! rails or views (a generation counter in the key); a short TTL covers
//! catalogue syncs.

use std::borrow::Borrow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::{DateTime, NaiveDate, Utc};
use playarr_cache::CacheAndPubSub;
use playarr_catalog::{BrowseQuery, SharedGate, WorkWatch};
use playarr_db::{DbError, WatchProgressRepo};
use playarr_model::home_rail::{
    collection_from_tags, score_from_tags, DEFAULT_MIN_COLLECTION_SIZE, DEFAULT_RAIL_LIMIT,
    DEFAULT_STALE_DAYS, MAX_RAIL_LIMIT,
};
use playarr_model::seasonal::{self, Hemisphere, SeasonalRule};
use playarr_model::{
    HomeRail, HomeRailConfig, HomeRailKind, UserRailPref, WatchProgress, Work, WorkKind,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{AdminUser, CatalogViewer};
use crate::error::ApiError;
use crate::AppState;

/// Entries live this long without an explicit invalidation (catalogue
/// syncs do not notify).
const RAILS_CACHE_TTL: Duration = Duration::from_secs(300);
const GENERATION_KEY: &str = "home_rails:gen";

// ---------------------------------------------------------------------------
// Languages and titles
// ---------------------------------------------------------------------------

/// Languages the server can title rails in (the clients' own set).
pub const SUPPORTED_LANGS: [&str; 3] = ["en", "th", "ja"];

/// Resolves `?lang=` / `Accept-Language` to a supported code (default `en`).
pub fn resolve_lang(explicit: Option<&str>, headers: &HeaderMap) -> &'static str {
    let pick = |raw: &str| {
        let base = raw
            .trim()
            .split(['-', '_', ';'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        SUPPORTED_LANGS.iter().copied().find(|l| *l == base)
    };
    if let Some(lang) = explicit.and_then(pick) {
        return lang;
    }
    headers
        .get(axum::http::header::ACCEPT_LANGUAGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').find_map(pick))
        .unwrap_or("en")
}

fn library_noun(library: Option<WorkKind>, lang: &str) -> &'static str {
    match (library, lang) {
        (Some(WorkKind::Movie), "th") => "ภาพยนตร์",
        (Some(WorkKind::Movie), "ja") => "映画",
        (Some(WorkKind::Movie), _) => "Movies",
        (Some(WorkKind::Series), "th") => "ซีรีส์",
        (Some(WorkKind::Series), "ja") => "シリーズ",
        (Some(WorkKind::Series), _) => "Series",
        (Some(WorkKind::Artist), "th") => "เพลง",
        (Some(WorkKind::Artist), "ja") => "音楽",
        (Some(WorkKind::Artist), _) => "Music",
        (_, "th") => "ทั้งหมด",
        (_, "ja") => "すべて",
        _ => "Everything",
    }
}

fn season_name(key: &str, lang: &str) -> Option<&'static str> {
    Some(match (key, lang) {
        ("christmas", "th") => "คริสต์มาส",
        ("christmas", "ja") => "クリスマス",
        ("christmas", _) => "Christmas",
        ("halloween", "th") => "ฮัลโลวีน",
        ("halloween", "ja") => "ハロウィン",
        ("halloween", _) => "Halloween",
        ("new_year", "th") => "ปีใหม่",
        ("new_year", "ja") => "新年",
        ("new_year", _) => "New Year",
        ("valentines", "th") => "วาเลนไทน์",
        ("valentines", "ja") => "バレンタイン",
        ("valentines", _) => "Valentine's",
        ("easter", "th") => "อีสเตอร์",
        ("easter", "ja") => "イースター",
        ("easter", _) => "Easter",
        ("summer", "th") => "ฤดูร้อน",
        ("summer", "ja") => "夏",
        ("summer", _) => "Summer",
        _ => return None,
    })
}

/// Localised rail title. `season` is the active seasonal rule's display name.
pub fn rail_title(
    kind: HomeRailKind,
    library: Option<WorkKind>,
    season: Option<&str>,
    lang: &str,
) -> String {
    let lib = library_noun(library, lang);
    match (kind, lang) {
        (HomeRailKind::RecentlyAdded, "th") => format!("เพิ่มล่าสุดใน{lib}"),
        (HomeRailKind::RecentlyAdded, "ja") => format!("{lib}の新着"),
        (HomeRailKind::RecentlyAdded, _) => format!("Recently Added in {lib}"),
        (HomeRailKind::RecentlyReleased, "th") => format!("{lib}ที่เพิ่งออกฉาย"),
        (HomeRailKind::RecentlyReleased, "ja") => format!("最近公開の{lib}"),
        (HomeRailKind::RecentlyReleased, _) => format!("Recently Released {lib}"),
        (HomeRailKind::TopUnwatched, "th") => format!("{lib}ยอดนิยมที่ยังไม่ได้ดู"),
        (HomeRailKind::TopUnwatched, "ja") => format!("未視聴の人気{lib}"),
        (HomeRailKind::TopUnwatched, _) => format!("Top Unwatched {lib}"),
        (HomeRailKind::Rediscover, "th") => format!("ค้นพบ{lib}อีกครั้ง"),
        (HomeRailKind::Rediscover, "ja") => format!("もう一度見つける{lib}"),
        (HomeRailKind::Rediscover, _) => format!("Rediscover {lib}"),
        (HomeRailKind::Seasonal, "th") => format!("{lib}{}", season.unwrap_or("ตามฤดูกาล")),
        (HomeRailKind::Seasonal, "ja") => format!("{}の{lib}", season.unwrap_or("季節")),
        (HomeRailKind::Seasonal, _) => format!("{} {lib}", season.unwrap_or("Seasonal")),
        (HomeRailKind::Custom, _) => lib.to_string(),
    }
}

fn season_display(rule: &SeasonalRule, lang: &str) -> String {
    rule.name
        .clone()
        .filter(|n| !n.trim().is_empty())
        .or_else(|| season_name(&rule.key, lang).map(String::from))
        .unwrap_or_else(|| {
            let mut s = rule.key.replace(['_', '-'], " ");
            if let Some(first) = s.get(..1) {
                s = first.to_uppercase() + &s[1..];
            }
            s
        })
}

// ---------------------------------------------------------------------------
// Pure ranking
// ---------------------------------------------------------------------------

fn clamp_limit(config: &HomeRailConfig) -> usize {
    config
        .limit
        .unwrap_or(DEFAULT_RAIL_LIMIT)
        .clamp(1, MAX_RAIL_LIMIT) as usize
}

/// The work behind either an owned or a shared handle.
fn wk<W: Borrow<Work>>(w: &W) -> &Work {
    w.borrow()
}

pub(crate) fn recently_added<W: Borrow<Work> + Clone>(works: &[W], limit: usize) -> Vec<W> {
    let mut items: Vec<&W> = works.iter().collect();
    items.sort_by(|a, b| {
        let (a, b) = ((*a).borrow(), (*b).borrow());
        b.added_at
            .cmp(&a.added_at)
            .then(a.sort_title.cmp(&b.sort_title))
    });
    items.into_iter().take(limit).cloned().collect()
}

/// Available works already released, newest release first. Works with no
/// release date are left out (they cannot be ranked by it).
pub(crate) fn recently_released<W: Borrow<Work> + Clone>(
    works: &[W],
    now: DateTime<Utc>,
    limit: usize,
) -> Vec<W> {
    let mut items: Vec<&W> = works
        .iter()
        .filter(|w| (*w).borrow().release_date.is_some_and(|d| d <= now))
        .collect();
    items.sort_by(|a, b| {
        let (a, b) = ((*a).borrow(), (*b).borrow());
        b.release_date
            .cmp(&a.release_date)
            .then(a.sort_title.cmp(&b.sort_title))
    });
    items.into_iter().take(limit).cloned().collect()
}

/// Bayesian-weighted audience score, so a title with few votes cannot
/// outrank a well-established one.
fn weighted_score(score: f64, votes: u32) -> f64 {
    const PRIOR_VOTES: f64 = 500.0;
    const PRIOR_MEAN: f64 = 6.5;
    let v = f64::from(votes);
    (v / (v + PRIOR_VOTES)) * score + (PRIOR_VOTES / (v + PRIOR_VOTES)) * PRIOR_MEAN
}

/// Highest-rated titles the user has never started.
pub(crate) fn top_unwatched<W: Borrow<Work> + Clone>(
    works: &[W],
    watch: &HashMap<Uuid, WorkWatch>,
    limit: usize,
) -> Vec<W> {
    let mut ranked: Vec<(f64, &W)> = works
        .iter()
        .filter(|w| !watch.get(&(*w).borrow().id).is_some_and(|x| x.started))
        .filter_map(|w| {
            let (score, votes) = score_from_tags(&(*w).borrow().tags)?;
            Some((weighted_score(score, votes), w))
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.1.borrow().sort_title.cmp(&b.1.borrow().sort_title))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(_, w)| w.clone())
        .collect()
}

/// Series the user started, has not finished, and has not touched for
/// `stale_days`; the most recently dropped first.
pub(crate) fn rediscover_series<W: Borrow<Work> + Clone>(
    works: &[W],
    watch: &HashMap<Uuid, WorkWatch>,
    now: DateTime<Utc>,
    stale_days: u32,
    limit: usize,
) -> Vec<W> {
    let cutoff = now - chrono::Duration::days(i64::from(stale_days));
    let mut items: Vec<(DateTime<Utc>, &W)> = works
        .iter()
        .filter_map(|w| {
            let state = watch.get(&(*w).borrow().id)?;
            let last = state.last_activity?;
            (state.started && state.total_files > 0 && !state.is_complete() && last <= cutoff)
                .then_some((last, w))
        })
        .collect();
    items.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(a.1.borrow().sort_title.cmp(&b.1.borrow().sort_title))
    });
    items
        .into_iter()
        .take(limit)
        .map(|(_, w)| w.clone())
        .collect()
}

/// Movies to rediscover: the unwatched entries of franchises (TMDB
/// collections with at least `min_size` titles in the library) the user has
/// watched some but not all of, then movies left part-watched for
/// `stale_days`. Franchises the user touched most recently come first and
/// each franchise's entries run in release order.
pub(crate) fn rediscover_movies<W: Borrow<Work> + Clone>(
    works: &[W],
    watch: &HashMap<Uuid, WorkWatch>,
    now: DateTime<Utc>,
    stale_days: u32,
    min_size: u32,
    limit: usize,
) -> Vec<W> {
    let mut groups: HashMap<String, Vec<&W>> = HashMap::new();
    for work in works {
        if let Some((id, _)) = collection_from_tags(&wk(work).tags) {
            groups.entry(id).or_default().push(work);
        }
    }
    let mut franchises: Vec<(DateTime<Utc>, Vec<&W>)> = groups
        .into_values()
        .filter(|members| members.len() as u32 >= min_size.max(1))
        .filter_map(|members| {
            let watched: Vec<&&W> = members
                .iter()
                .filter(|w| watch.get(&wk(**w).id).is_some_and(|x| x.is_complete()))
                .collect();
            let last = members
                .iter()
                .filter_map(|w| watch.get(&wk(*w).id).and_then(|x| x.last_activity))
                .max()?;
            let mut unwatched: Vec<&W> = members
                .iter()
                .copied()
                .filter(|w| !watch.get(&wk(*w).id).is_some_and(|x| x.started))
                .collect();
            if watched.is_empty() || unwatched.is_empty() {
                return None;
            }
            unwatched.sort_by(|a, b| {
                let (a, b) = ((*a).borrow(), (*b).borrow());
                a.release_date
                    .cmp(&b.release_date)
                    .then(a.sort_title.cmp(&b.sort_title))
            });
            Some((last, unwatched))
        })
        .collect();
    franchises.sort_by_key(|f| std::cmp::Reverse(f.0));

    let mut out: Vec<W> = Vec::new();
    let mut seen: HashSet<Uuid> = HashSet::new();
    for (_, members) in franchises {
        for work in members {
            if seen.insert(wk(work).id) {
                out.push(work.clone());
            }
        }
    }

    let cutoff = now - chrono::Duration::days(i64::from(stale_days));
    let mut stale: Vec<(DateTime<Utc>, &W)> = works
        .iter()
        .filter_map(|w| {
            let state = watch.get(&wk(w).id)?;
            let last = state.last_activity?;
            (state.started && !state.is_complete() && last <= cutoff).then_some((last, w))
        })
        .collect();
    stale.sort_by_key(|s| std::cmp::Reverse(s.0));
    for (_, work) in stale {
        if seen.insert(wk(work).id) {
            out.push(work.clone());
        }
    }
    out.truncate(limit);
    out
}

/// Works belonging to the season, newest additions first.
pub(crate) fn seasonal_items<W: Borrow<Work> + Clone>(
    works: &[W],
    rule: &SeasonalRule,
    limit: usize,
) -> Vec<W> {
    let mut items: Vec<&W> = works
        .iter()
        .filter(|w| {
            let w = (*w).borrow();
            seasonal::rule_matches(rule, &w.title, w.overview.as_deref(), &w.genres, &w.tags)
        })
        .collect();
    items.sort_by(|a, b| {
        let (a, b) = ((*a).borrow(), (*b).borrow());
        b.added_at
            .cmp(&a.added_at)
            .then(a.sort_title.cmp(&b.sort_title))
    });
    items.into_iter().take(limit).cloned().collect()
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct StoredRails {
    catalog_version: u64,
    response: HomeRailsResponse,
}

#[derive(Serialize)]
struct StoredRailsRef<'a> {
    catalog_version: u64,
    response: &'a HomeRailsResponse,
}

/// Per-user rails cache over the shared [`CacheAndPubSub`].
pub struct HomeRailsCache {
    cache: Arc<dyn CacheAndPubSub>,
}

impl HomeRailsCache {
    pub fn new(cache: Arc<dyn CacheAndPubSub>) -> Self {
        Self { cache }
    }

    async fn generation(&self) -> String {
        match self.cache.get(GENERATION_KEY).await {
            Ok(Some(bytes)) => String::from_utf8_lossy(&bytes).into_owned(),
            _ => "0".to_string(),
        }
    }

    fn key(user: Uuid, lang: &str, generation: &str) -> String {
        format!("home_rails:{generation}:{user}:{lang}")
    }

    /// The cached rails, if they were computed from catalogue snapshot
    /// `catalog_version` (a rebuilt snapshot means the catalogue changed).
    async fn get(&self, user: Uuid, lang: &str, catalog_version: u64) -> Option<HomeRailsResponse> {
        let key = Self::key(user, lang, &self.generation().await);
        let bytes = self.cache.get(&key).await.ok()??;
        let stored: StoredRails = serde_json::from_slice(&bytes).ok()?;
        (stored.catalog_version == catalog_version).then_some(stored.response)
    }

    async fn put(
        &self,
        user: Uuid,
        lang: &str,
        catalog_version: u64,
        response: &HomeRailsResponse,
    ) {
        let key = Self::key(user, lang, &self.generation().await);
        let stored = StoredRailsRef {
            catalog_version,
            response,
        };
        if let Ok(bytes) = serde_json::to_vec(&stored) {
            let _ = self.cache.set(&key, bytes, Some(RAILS_CACHE_TTL)).await;
        }
    }

    /// Drops one user's cached rails (every language).
    pub async fn invalidate_user(&self, user: Uuid) {
        let generation = self.generation().await;
        for lang in SUPPORTED_LANGS {
            let _ = self.cache.delete(&Self::key(user, lang, &generation)).await;
        }
    }

    /// Invalidates every user's rails (admin edited rails or views).
    pub async fn invalidate_all(&self) {
        let next = Utc::now().timestamp_millis().to_string();
        let _ = self
            .cache
            .set(GENERATION_KEY, next.into_bytes(), None)
            .await;
    }
}

/// Wraps the real [`WatchProgressRepo`] so every progress write drops the
/// user's cached rails (watching something changes "unwatched" and
/// "rediscover" immediately).
pub struct InvalidatingWatchProgressRepo {
    inner: Arc<dyn WatchProgressRepo>,
    rails: Arc<HomeRailsCache>,
}

impl InvalidatingWatchProgressRepo {
    pub fn new(inner: Arc<dyn WatchProgressRepo>, rails: Arc<HomeRailsCache>) -> Self {
        Self { inner, rails }
    }
}

#[async_trait]
impl WatchProgressRepo for InvalidatingWatchProgressRepo {
    async fn get(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
    ) -> Result<Option<WatchProgress>, DbError> {
        self.inner.get(user_id, media_file_id).await
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<WatchProgress>, DbError> {
        self.inner.list_for_user(user_id).await
    }

    async fn upsert(&self, user_id: Uuid, progress: &WatchProgress) -> Result<(), DbError> {
        self.inner.upsert(user_id, progress).await?;
        self.rails.invalidate_user(user_id).await;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct HomeRailResponse {
    /// Rail definition id (seasonal rails keep their definition id).
    pub id: Uuid,
    pub kind: HomeRailKind,
    /// Library the rail draws from (`movie` | `series` | `artist`).
    pub library: Option<WorkKind>,
    /// Localised, display-ready title.
    pub title: String,
    /// Stable key for clients that localise themselves: the kind, or
    /// `seasonal.<rule key>` / `custom`.
    pub title_key: String,
    /// Saved view behind a custom rail.
    pub view_id: Option<Uuid>,
    /// Items on the rail (never empty -- empty rails are omitted).
    pub items: Vec<Work>,
    /// Matching titles before the rail's item limit.
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct HomeRailsResponse {
    pub rails: Vec<HomeRailResponse>,
    pub lang: String,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct HomeRailsQuery {
    /// `en` | `th` | `ja`; falls back to `Accept-Language`, then `en`.
    pub lang: Option<String>,
    /// Only rails of this library (`movie` | `series` | `artist`).
    pub library: Option<WorkKind>,
    /// Evaluate seasonal windows on this date (`YYYY-MM-DD`) instead of
    /// today. Bypasses the cache.
    pub on: Option<NaiveDate>,
}

/// Admin order, then the user's overrides applied: hidden rails dropped,
/// rails with a saved position first (by it), the rest after in admin order.
pub(crate) fn effective_order(rails: Vec<HomeRail>, prefs: &[UserRailPref]) -> Vec<HomeRail> {
    let by_id: HashMap<Uuid, &UserRailPref> = prefs.iter().map(|p| (p.rail_id, p)).collect();
    let (mut placed, rest): (Vec<_>, Vec<_>) = rails
        .into_iter()
        .filter(|r| r.enabled)
        .filter(|r| !by_id.get(&r.id).is_some_and(|p| p.hidden))
        .partition(|r| by_id.get(&r.id).and_then(|p| p.position).is_some());
    placed.sort_by_key(|r| {
        by_id
            .get(&r.id)
            .and_then(|p| p.position)
            .unwrap_or(i32::MAX)
    });
    placed.extend(rest);
    placed
}

fn hemisphere_of(config: &HomeRailConfig) -> Hemisphere {
    config.hemisphere.unwrap_or_default()
}

fn rules_of(config: &HomeRailConfig) -> Vec<SeasonalRule> {
    config
        .seasonal_rules
        .clone()
        .unwrap_or_else(seasonal::default_rules)
}

async fn compute_rails(
    state: &AppState,
    viewer: &CatalogViewer,
    lang: &'static str,
    today: NaiveDate,
    library: Option<WorkKind>,
) -> Result<Vec<HomeRailResponse>, ApiError> {
    let definitions = state.home_rail_repo.list().await?;
    let prefs = state.home_rail_repo.user_prefs(viewer.user_id).await?;
    let ordered = effective_order(definitions, &prefs);
    let ordered: Vec<HomeRail> = ordered
        .into_iter()
        .filter(|r| library.is_none() || r.library == library || r.library.is_none())
        .collect();
    if ordered.is_empty() {
        return Ok(Vec::new());
    }

    let gate = state
        .household
        .gate_for(&viewer.policy, viewer.user_id)
        .await
        .map(|g| SharedGate(g));
    let allowed = viewer.allowed_libraries();
    let now = Utc::now();

    // One visible-works scan per library any enabled rail needs.
    let mut works: HashMap<WorkKind, Vec<Arc<Work>>> = HashMap::new();
    for kind in ordered.iter().filter_map(|r| r.library) {
        if works.contains_key(&kind) {
            continue;
        }
        let list = state
            .catalog
            .visible_works(&BrowseQuery {
                kind: Some(kind),
                available_only: true,
                allowed_source_instance_ids: allowed.clone(),
                gate: gate.clone(),
                ..BrowseQuery::default()
            })
            .await?;
        works.insert(kind, list);
    }

    let needs_watch = ordered.iter().any(|r| {
        matches!(
            r.kind,
            HomeRailKind::TopUnwatched | HomeRailKind::Rediscover
        )
    });
    let watch = if needs_watch {
        state.catalog.watch_summaries(viewer.user_id).await?
    } else {
        HashMap::new()
    };

    let mut out = Vec::new();
    for rail in ordered {
        let limit = clamp_limit(&rail.config);
        let empty: Vec<Arc<Work>> = Vec::new();
        let pool = rail.library.and_then(|k| works.get(&k)).unwrap_or(&empty);
        let stale_days = rail.config.stale_days.unwrap_or(DEFAULT_STALE_DAYS);
        let mut season: Option<String> = None;
        let mut season_key: Option<String> = None;

        let items: Vec<Arc<Work>> = match rail.kind {
            HomeRailKind::RecentlyAdded => recently_added(pool, usize::MAX),
            HomeRailKind::RecentlyReleased => recently_released(pool, now, usize::MAX),
            HomeRailKind::TopUnwatched => top_unwatched(pool, &watch, usize::MAX),
            HomeRailKind::Rediscover => match rail.library {
                Some(WorkKind::Movie) => rediscover_movies(
                    pool,
                    &watch,
                    now,
                    stale_days,
                    rail.config
                        .min_collection_size
                        .unwrap_or(DEFAULT_MIN_COLLECTION_SIZE),
                    usize::MAX,
                ),
                _ => rediscover_series(pool, &watch, now, stale_days, usize::MAX),
            },
            HomeRailKind::Seasonal => {
                let rules = rules_of(&rail.config);
                match seasonal::active_rule(&rules, hemisphere_of(&rail.config), today) {
                    Some(rule) => {
                        season = Some(season_display(rule, lang));
                        season_key = Some(rule.key.clone());
                        seasonal_items(pool, rule, usize::MAX)
                    }
                    None => Vec::new(),
                }
            }
            HomeRailKind::Custom => {
                let Some(view_id) = rail.view_id else {
                    continue;
                };
                let Ok(view) = state.library_view_repo.get(view_id).await else {
                    continue;
                };
                let page = state
                    .catalog
                    .resolve_view_with(
                        &view,
                        Some(viewer.user_id),
                        i64::from(MAX_RAIL_LIMIT),
                        0,
                        allowed.clone(),
                        gate.clone(),
                    )
                    .await?;
                page.items
                    .into_iter()
                    .filter(|w| {
                        view.criteria.kind.is_some() || rail.library.is_none_or(|lib| w.kind == lib)
                    })
                    .map(Arc::new)
                    .collect()
            }
        };
        if items.is_empty() {
            continue;
        }
        let total = items.len() as i64;
        let mut items = items;
        items.truncate(limit);

        let title = match (&rail.name, rail.kind) {
            (Some(name), _) if !name.trim().is_empty() => name.clone(),
            (None, HomeRailKind::Custom) => match rail.view_id {
                Some(id) => state
                    .library_view_repo
                    .get(id)
                    .await
                    .map(|v| v.name)
                    .unwrap_or_default(),
                None => String::new(),
            },
            _ => rail_title(rail.kind, rail.library, season.as_deref(), lang),
        };
        let title_key = match (&season_key, rail.kind) {
            (Some(key), _) => format!("seasonal.{key}"),
            (None, kind) => kind.as_str().to_string(),
        };
        out.push(HomeRailResponse {
            id: rail.id,
            kind: rail.kind,
            library: rail.library,
            title,
            title_key,
            view_id: rail.view_id,
            items: items.into_iter().map(|work| (*work).clone()).collect(),
            total,
        });
    }
    Ok(out)
}

#[utoipa::path(
    get,
    path = "/api/v1/home/rails",
    tag = "home",
    params(HomeRailsQuery),
    responses(
        (status = 200, description = "The caller's ordered, non-empty Home rails with localised titles; household and library restrictions are applied before ranking.", body = HomeRailsResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn home_rails_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    headers: HeaderMap,
    Query(params): Query<HomeRailsQuery>,
) -> Result<Json<HomeRailsResponse>, ApiError> {
    let lang = resolve_lang(params.lang.as_deref(), &headers);
    let cacheable = params.on.is_none();
    // The rails are derived from the in-memory catalogue snapshot; a rebuilt
    // snapshot (an import, a metadata change) makes any cached copy stale.
    let catalog_version = state.catalog.snapshot_version().await?;
    let cached = if cacheable {
        state
            .home_rails_cache
            .get(viewer.user_id, lang, catalog_version)
            .await
    } else {
        None
    };
    let mut response = match cached {
        Some(hit) => hit,
        None => {
            let today = params.on.unwrap_or_else(|| Utc::now().date_naive());
            let rails = compute_rails(&state, &viewer, lang, today, None).await?;
            let response = HomeRailsResponse {
                rails,
                lang: lang.to_string(),
                generated_at: Utc::now(),
            };
            if cacheable {
                state
                    .home_rails_cache
                    .put(viewer.user_id, lang, catalog_version, &response)
                    .await;
            }
            response
        }
    };
    if let Some(library) = params.library {
        response
            .rails
            .retain(|r| r.library == Some(library) || r.library.is_none());
    }
    Ok(Json(response))
}

// ---------------------------------------------------------------------------
// Per-user preferences
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RailPreferenceEntry {
    pub id: Uuid,
    pub kind: HomeRailKind,
    pub library: Option<WorkKind>,
    /// Localised default or admin title (seasonal rails read "Seasonal …").
    pub title: String,
    pub hidden: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RailPreferencesResponse {
    /// Every rail the admin has enabled, in this user's effective order.
    pub rails: Vec<RailPreferenceEntry>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RailPreferencesRequest {
    /// Desired order of rails (ids); rails not listed follow in admin order.
    #[serde(default)]
    pub order: Vec<Uuid>,
    /// Rails to hide for this user.
    #[serde(default)]
    pub hidden: Vec<Uuid>,
}

async fn preferences_view(
    state: &AppState,
    user_id: Uuid,
    lang: &str,
) -> Result<RailPreferencesResponse, ApiError> {
    let definitions = state.home_rail_repo.list().await?;
    let prefs = state.home_rail_repo.user_prefs(user_id).await?;
    let hidden: HashSet<Uuid> = prefs
        .iter()
        .filter(|p| p.hidden)
        .map(|p| p.rail_id)
        .collect();
    // Keep hidden rails in the list (so the user can unhide them), ordered
    // by the same rule as the live rails.
    let enabled: Vec<HomeRail> = definitions.into_iter().filter(|r| r.enabled).collect();
    let shown_prefs: Vec<UserRailPref> = prefs
        .iter()
        .map(|p| UserRailPref {
            hidden: false,
            ..p.clone()
        })
        .collect();
    let rails = effective_order(enabled, &shown_prefs)
        .into_iter()
        .map(|r| RailPreferenceEntry {
            hidden: hidden.contains(&r.id),
            title: r
                .name
                .clone()
                .unwrap_or_else(|| rail_title(r.kind, r.library, None, lang)),
            id: r.id,
            kind: r.kind,
            library: r.library,
        })
        .collect();
    Ok(RailPreferencesResponse { rails })
}

#[utoipa::path(
    get,
    path = "/api/v1/home/rails/preferences",
    tag = "home",
    params(HomeRailsQuery),
    responses(
        (status = 200, description = "Rails the admin enabled, in the caller's order, with the caller's hidden flags", body = RailPreferencesResponse),
        (status = 401, description = "Missing or invalid access token")
    )
)]
pub async fn get_rail_preferences_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    headers: HeaderMap,
    Query(params): Query<HomeRailsQuery>,
) -> Result<Json<RailPreferencesResponse>, ApiError> {
    let lang = resolve_lang(params.lang.as_deref(), &headers);
    Ok(Json(preferences_view(&state, viewer.user_id, lang).await?))
}

#[utoipa::path(
    put,
    path = "/api/v1/home/rails/preferences",
    tag = "home",
    request_body = RailPreferencesRequest,
    responses(
        (status = 200, description = "Saved; the resulting preferences", body = RailPreferencesResponse),
        (status = 401, description = "Missing or invalid access token")
    )
)]
pub async fn put_rail_preferences_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    headers: HeaderMap,
    Json(body): Json<RailPreferencesRequest>,
) -> Result<Json<RailPreferencesResponse>, ApiError> {
    let known: HashSet<Uuid> = state
        .home_rail_repo
        .list()
        .await?
        .into_iter()
        .map(|r| r.id)
        .collect();
    let hidden: HashSet<Uuid> = body
        .hidden
        .iter()
        .copied()
        .filter(|id| known.contains(id))
        .collect();
    let mut prefs: Vec<UserRailPref> = Vec::new();
    let mut placed: HashSet<Uuid> = HashSet::new();
    for id in body.order.iter().copied().filter(|id| known.contains(id)) {
        if placed.insert(id) {
            prefs.push(UserRailPref {
                rail_id: id,
                hidden: hidden.contains(&id),
                position: Some(prefs.len() as i32),
            });
        }
    }
    for id in hidden.iter().filter(|id| !placed.contains(id)) {
        prefs.push(UserRailPref {
            rail_id: *id,
            hidden: true,
            position: None,
        });
    }
    state
        .home_rail_repo
        .set_user_prefs(viewer.user_id, &prefs)
        .await?;
    state.home_rails_cache.invalidate_user(viewer.user_id).await;
    let lang = resolve_lang(None, &headers);
    Ok(Json(preferences_view(&state, viewer.user_id, lang).await?))
}

#[utoipa::path(
    delete,
    path = "/api/v1/home/rails/preferences",
    tag = "home",
    responses(
        (status = 204, description = "The caller's overrides were cleared"),
        (status = 401, description = "Missing or invalid access token")
    )
)]
pub async fn reset_rail_preferences_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<StatusCode, ApiError> {
    state
        .home_rail_repo
        .set_user_prefs(viewer.user_id, &[])
        .await?;
    state.home_rails_cache.invalidate_user(viewer.user_id).await;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Admin management
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HomeRailDefinitionResponse {
    pub id: Uuid,
    pub kind: HomeRailKind,
    pub library: Option<WorkKind>,
    /// Admin title override (custom rails default to the view's name).
    pub name: Option<String>,
    /// English default title.
    pub default_title: String,
    pub view_id: Option<Uuid>,
    pub enabled: bool,
    pub position: i32,
    pub is_default: bool,
    pub config: HomeRailConfig,
    /// Seasonal rails: the rules in force (the built-ins unless the admin
    /// replaced them in `config.seasonal_rules`).
    pub effective_seasonal_rules: Option<Vec<SeasonalRule>>,
}

impl From<HomeRail> for HomeRailDefinitionResponse {
    fn from(rail: HomeRail) -> Self {
        HomeRailDefinitionResponse {
            effective_seasonal_rules: (rail.kind == HomeRailKind::Seasonal)
                .then(|| rules_of(&rail.config)),
            default_title: rail_title(rail.kind, rail.library, None, "en"),
            id: rail.id,
            kind: rail.kind,
            library: rail.library,
            name: rail.name,
            view_id: rail.view_id,
            enabled: rail.enabled,
            position: rail.position,
            is_default: rail.is_default,
            config: rail.config,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateHomeRailRequest {
    /// Title shown on Home.
    pub name: String,
    /// Saved view (from `/api/v1/admin/views`) supplying the filter.
    pub view_id: Uuid,
    /// Library the rail belongs to; omit for a cross-library view.
    pub library: Option<WorkKind>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub config: HomeRailConfig,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateHomeRailRequest {
    /// `null`/absent keeps the current title; an empty string clears the
    /// override.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    /// Custom rails only.
    #[serde(default)]
    pub view_id: Option<Uuid>,
    #[serde(default)]
    pub config: Option<HomeRailConfig>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReorderHomeRailsRequest {
    /// Every rail id in the desired display order.
    pub ids: Vec<Uuid>,
}

fn validate_config(config: &HomeRailConfig) -> Result<(), ApiError> {
    if config.limit.is_some_and(|l| l == 0 || l > MAX_RAIL_LIMIT) {
        return Err(ApiError::bad_request(format!(
            "limit must be between 1 and {MAX_RAIL_LIMIT}"
        )));
    }
    if config.stale_days.is_some_and(|d| d == 0 || d > 3650) {
        return Err(ApiError::bad_request(
            "stale_days must be between 1 and 3650",
        ));
    }
    if config
        .min_collection_size
        .is_some_and(|n| n == 0 || n > 100)
    {
        return Err(ApiError::bad_request(
            "min_collection_size must be between 1 and 100",
        ));
    }
    if let Some(rules) = &config.seasonal_rules {
        let mut keys = HashSet::new();
        for rule in rules {
            seasonal::validate_rule(rule).map_err(ApiError::bad_request)?;
            if !keys.insert(rule.key.clone()) {
                return Err(ApiError::bad_request(format!(
                    "duplicate seasonal rule key '{}'",
                    rule.key
                )));
            }
        }
    }
    Ok(())
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/home-rails",
    tag = "home",
    responses(
        (status = 200, description = "Every rail definition in display order", body = Vec<HomeRailDefinitionResponse>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_admin_rails_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<HomeRailDefinitionResponse>>, ApiError> {
    Ok(Json(
        state
            .home_rail_repo
            .list()
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/home-rails",
    tag = "home",
    request_body = CreateHomeRailRequest,
    responses(
        (status = 200, description = "The created custom rail", body = HomeRailDefinitionResponse),
        (status = 400, description = "Invalid name or config"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No view with this id")
    )
)]
pub async fn create_admin_rail_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<CreateHomeRailRequest>,
) -> Result<Json<HomeRailDefinitionResponse>, ApiError> {
    if body.name.trim().is_empty() {
        return Err(ApiError::bad_request("name must not be empty"));
    }
    validate_config(&body.config)?;
    state.library_view_repo.get(body.view_id).await?;
    let position = state
        .home_rail_repo
        .list()
        .await?
        .iter()
        .map(|r| r.position + 1)
        .max()
        .unwrap_or(0);
    let now = Utc::now();
    let rail = HomeRail {
        id: Uuid::new_v4(),
        kind: HomeRailKind::Custom,
        library: body.library,
        name: Some(body.name.trim().to_string()),
        view_id: Some(body.view_id),
        enabled: body.enabled,
        position,
        config: body.config,
        is_default: false,
        created_at: now,
        updated_at: now,
    };
    state.home_rail_repo.upsert(&rail).await?;
    state.home_rails_cache.invalidate_all().await;
    Ok(Json(rail.into()))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/home-rails/{id}",
    tag = "home",
    params(("id" = Uuid, Path, description = "Rail id")),
    request_body = UpdateHomeRailRequest,
    responses(
        (status = 200, description = "The updated rail", body = HomeRailDefinitionResponse),
        (status = 400, description = "Invalid config"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No rail or view with this id")
    )
)]
pub async fn update_admin_rail_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateHomeRailRequest>,
) -> Result<Json<HomeRailDefinitionResponse>, ApiError> {
    let mut rail = state.home_rail_repo.get(id).await?;
    if let Some(name) = body.name {
        rail.name = Some(name.trim().to_string()).filter(|n| !n.is_empty());
        if rail.kind == HomeRailKind::Custom && rail.name.is_none() {
            return Err(ApiError::bad_request("a custom rail needs a name"));
        }
    }
    if let Some(enabled) = body.enabled {
        rail.enabled = enabled;
    }
    if let Some(view_id) = body.view_id {
        if rail.kind != HomeRailKind::Custom {
            return Err(ApiError::bad_request("only custom rails have a view"));
        }
        state.library_view_repo.get(view_id).await?;
        rail.view_id = Some(view_id);
    }
    if let Some(config) = body.config {
        validate_config(&config)?;
        rail.config = config;
    }
    rail.updated_at = Utc::now();
    state.home_rail_repo.upsert(&rail).await?;
    state.home_rails_cache.invalidate_all().await;
    Ok(Json(rail.into()))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/home-rails/{id}",
    tag = "home",
    params(("id" = Uuid, Path, description = "Rail id")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No rail with this id"),
        (status = 409, description = "This is a default rail; disable it instead")
    )
)]
pub async fn delete_admin_rail_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rail = state.home_rail_repo.get(id).await?;
    if rail.is_default {
        return Err(ApiError::conflict(
            "default rails cannot be deleted; disable them instead",
        ));
    }
    state.home_rail_repo.delete(id).await?;
    state.home_rails_cache.invalidate_all().await;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/home-rails/order",
    tag = "home",
    request_body = ReorderHomeRailsRequest,
    responses(
        (status = 200, description = "Every rail definition in the new order", body = Vec<HomeRailDefinitionResponse>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn reorder_admin_rails_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<ReorderHomeRailsRequest>,
) -> Result<Json<Vec<HomeRailDefinitionResponse>>, ApiError> {
    state.home_rail_repo.reorder(&body.ids).await?;
    state.home_rails_cache.invalidate_all().await;
    list_admin_rails_handler(State(state), _admin).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use playarr_model::home_rail::{collection_tag, score_tag};
    use playarr_model::Availability;

    fn work(title: &str, kind: WorkKind) -> Work {
        Work {
            id: Uuid::new_v4(),
            kind,
            external_refs: vec![],
            title: title.into(),
            sort_title: title.to_lowercase(),
            overview: None,
            images: vec![],
            genres: vec![],
            tags: vec![],
            added_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            release_date: None,
            end_date: None,
            monitored: true,
            availability: Availability::Available,
        }
    }

    fn at(y: i32, m: u32, d: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, 0, 0, 0).unwrap()
    }

    fn w(started: bool, watched: u32, total: u32, last: Option<DateTime<Utc>>) -> WorkWatch {
        WorkWatch {
            watched_files: watched,
            total_files: total,
            started,
            last_activity: last,
        }
    }

    #[test]
    fn titles_localise_and_fall_back_to_english() {
        use HomeRailKind::*;
        let m = Some(WorkKind::Movie);
        assert_eq!(
            rail_title(RecentlyAdded, m, None, "en"),
            "Recently Added in Movies"
        );
        assert_eq!(
            rail_title(RecentlyReleased, Some(WorkKind::Series), None, "en"),
            "Recently Released Series"
        );
        assert_eq!(
            rail_title(TopUnwatched, m, None, "en"),
            "Top Unwatched Movies"
        );
        assert_eq!(
            rail_title(Rediscover, Some(WorkKind::Artist), None, "en"),
            "Rediscover Music"
        );
        assert_eq!(
            rail_title(Seasonal, m, Some("Halloween"), "en"),
            "Halloween Movies"
        );
        assert_eq!(
            rail_title(Seasonal, m, Some("ハロウィン"), "ja"),
            "ハロウィンの映画"
        );
        assert_eq!(rail_title(RecentlyAdded, m, None, "ja"), "映画の新着");
        let mut headers = HeaderMap::new();
        headers.insert("accept-language", "ja-JP,en;q=0.8".parse().unwrap());
        assert_eq!(resolve_lang(None, &headers), "ja");
        assert_eq!(resolve_lang(Some("th"), &headers), "th");
        assert_eq!(resolve_lang(Some("fr"), &HeaderMap::new()), "en");
    }

    #[test]
    fn recently_released_skips_future_and_undated() {
        let now = at(2026, 10, 4);
        let mut old = work("Old", WorkKind::Movie);
        old.release_date = Some(at(2020, 1, 1));
        let mut new = work("New", WorkKind::Movie);
        new.release_date = Some(at(2026, 9, 1));
        let mut future = work("Future", WorkKind::Movie);
        future.release_date = Some(at(2027, 1, 1));
        let undated = work("Undated", WorkKind::Movie);
        let items = recently_released(&[old, future, undated, new], now, 10);
        assert_eq!(
            items.iter().map(|w| w.title.as_str()).collect::<Vec<_>>(),
            ["New", "Old"]
        );
    }

    #[test]
    fn top_unwatched_ranks_by_weighted_score_and_hides_started() {
        let mut classic = work("Classic", WorkKind::Movie);
        classic.tags = vec![score_tag(8.0, 20000).unwrap()];
        let mut obscure = work("Obscure", WorkKind::Movie);
        obscure.tags = vec![score_tag(9.5, 3).unwrap()];
        let mut seen = work("Seen", WorkKind::Movie);
        seen.tags = vec![score_tag(9.0, 50000).unwrap()];
        let unscored = work("Unscored", WorkKind::Movie);
        let watch = HashMap::from([(seen.id, w(true, 1, 1, Some(at(2026, 1, 1))))]);
        let items = top_unwatched(&[obscure, classic, seen, unscored], &watch, 10);
        assert_eq!(
            items.iter().map(|w| w.title.as_str()).collect::<Vec<_>>(),
            ["Classic", "Obscure"]
        );
    }

    #[test]
    fn rediscover_series_needs_started_unfinished_and_stale() {
        let now = at(2026, 10, 4);
        let stale = work("Stale", WorkKind::Series);
        let fresh = work("Fresh", WorkKind::Series);
        let done = work("Done", WorkKind::Series);
        let never = work("Never", WorkKind::Series);
        let older = work("Older", WorkKind::Series);
        let watch = HashMap::from([
            (stale.id, w(true, 3, 10, Some(at(2026, 6, 1)))),
            (older.id, w(true, 1, 10, Some(at(2025, 6, 1)))),
            (fresh.id, w(true, 3, 10, Some(at(2026, 9, 20)))),
            (done.id, w(true, 10, 10, Some(at(2025, 1, 1)))),
        ]);
        let items = rediscover_series(&[stale, fresh, done, never, older], &watch, now, 60, 10);
        assert_eq!(
            items.iter().map(|w| w.title.as_str()).collect::<Vec<_>>(),
            ["Stale", "Older"]
        );
        // A looser threshold admits the recently watched one too.
        let loose = rediscover_series(
            &items
                .iter()
                .cloned()
                .chain([work("X", WorkKind::Series)])
                .collect::<Vec<_>>(),
            &watch,
            now,
            1,
            10,
        );
        assert_eq!(loose.len(), 2);
    }

    #[test]
    fn rediscover_movies_surfaces_unwatched_franchise_entries_in_release_order() {
        let now = at(2026, 10, 4);
        let tag = collection_tag(86311, "Sample Team Collection");
        let mut a1 = work("Sample Team", WorkKind::Movie);
        a1.tags = vec![tag.clone()];
        a1.release_date = Some(at(2012, 5, 1));
        let mut a3 = work("Infinity War", WorkKind::Movie);
        a3.tags = vec![tag.clone()];
        a3.release_date = Some(at(2018, 4, 1));
        let mut a2 = work("Age of Ultron", WorkKind::Movie);
        a2.tags = vec![tag.clone()];
        a2.release_date = Some(at(2015, 5, 1));
        // A franchise nothing was watched in, and a single-entry "collection".
        let other_tag = collection_tag(1, "Untouched");
        let mut u1 = work("U1", WorkKind::Movie);
        u1.tags = vec![other_tag.clone()];
        let mut u2 = work("U2", WorkKind::Movie);
        u2.tags = vec![other_tag];
        let mut lone = work("Lone", WorkKind::Movie);
        lone.tags = vec![collection_tag(2, "Lonely")];
        let watch = HashMap::from([(a1.id, w(true, 1, 1, Some(at(2026, 9, 30))))]);
        let items = rediscover_movies(&[a3, u1, a1, a2, u2, lone], &watch, now, 60, 2, 10);
        assert_eq!(
            items.iter().map(|w| w.title.as_str()).collect::<Vec<_>>(),
            ["Age of Ultron", "Infinity War"]
        );
        // Fully watched franchise yields nothing.
        let mut b1 = work("B1", WorkKind::Movie);
        b1.tags = vec![collection_tag(3, "B")];
        let mut b2 = work("B2", WorkKind::Movie);
        b2.tags = vec![collection_tag(3, "B")];
        let all = HashMap::from([
            (b1.id, w(true, 1, 1, Some(at(2026, 1, 1)))),
            (b2.id, w(true, 1, 1, Some(at(2026, 1, 2)))),
        ]);
        assert!(rediscover_movies(&[b1, b2], &all, now, 60, 2, 10).is_empty());
    }

    #[test]
    fn rediscover_movies_includes_stale_part_watched_after_franchises() {
        let now = at(2026, 10, 4);
        let half = work("Half", WorkKind::Movie);
        let watch = HashMap::from([(half.id, w(true, 0, 1, Some(at(2026, 1, 1))))]);
        let items = rediscover_movies(&[half], &watch, now, 60, 2, 10);
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn seasonal_items_match_rule_keywords_and_genres() {
        let rules = seasonal::default_rules();
        let halloween = rules.iter().find(|r| r.key == "halloween").unwrap();
        let mut horror = work("Quiet", WorkKind::Movie);
        horror.genres = vec!["Horror".into()];
        let ghost = work("The Ghost Ship", WorkKind::Movie);
        let plain = work("Sunshine Days", WorkKind::Movie);
        let items = seasonal_items(&[horror, ghost, plain], halloween, 10);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn effective_order_applies_hidden_and_user_positions() {
        let now = Utc::now();
        let mk = |pos: i32, enabled: bool| HomeRail {
            id: Uuid::new_v4(),
            kind: HomeRailKind::RecentlyAdded,
            library: Some(WorkKind::Movie),
            name: None,
            view_id: None,
            enabled,
            position: pos,
            config: HomeRailConfig::default(),
            is_default: true,
            created_at: now,
            updated_at: now,
        };
        let (a, b, c, d, off) = (
            mk(0, true),
            mk(1, true),
            mk(2, true),
            mk(3, true),
            mk(4, false),
        );
        let prefs = [
            UserRailPref {
                rail_id: c.id,
                hidden: false,
                position: Some(0),
            },
            UserRailPref {
                rail_id: a.id,
                hidden: true,
                position: None,
            },
        ];
        let order = effective_order(
            vec![a.clone(), b.clone(), c.clone(), d.clone(), off],
            &prefs,
        );
        assert_eq!(
            order.iter().map(|r| r.id).collect::<Vec<_>>(),
            [c.id, b.id, d.id]
        );
    }

    // ---- HTTP-level tests -------------------------------------------------

    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_movie_with_tags, seed_policy_user,
        seed_streaming_user_with_library_allow, test_state, TestState,
    };
    use axum::body::Body;
    use axum::http::Request;
    use axum::Router;
    use playarr_model::media::LeafRef;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    async fn call(
        router: &Router,
        token: &str,
        method: &str,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder()
            .method(method)
            .uri(uri)
            .header("Authorization", bearer_header(token));
        let body = match body {
            Some(b) => {
                req = req.header("content-type", "application/json");
                Body::from(b.to_string())
            }
            None => Body::empty(),
        };
        let response = router
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    fn rail<'a>(rails: &'a Value, title: &str) -> Option<&'a Value> {
        rails["rails"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["title"] == title)
    }

    fn titles(rail: &Value) -> Vec<String> {
        rail["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["title"].as_str().unwrap().to_string())
            .collect()
    }

    async fn playable(state: &TestState, title: &str, tags: &[&str], instance: Uuid) -> Uuid {
        let id = seed_movie_with_tags(state, title, tags).await;
        let file = playarr_model::MediaFile {
            id: Uuid::new_v4(),
            work_id: id,
            leaf_ref: LeafRef::Work,
            path: std::path::PathBuf::from(format!("/media/{title}.mkv")),
            container: "mkv".into(),
            codec: "h264".into(),
            bitrate: None,
            duration_ms: Some(3_600_000),
            size_bytes: 1,
            source_instance_id: instance,
            source_file_id: Some(id.to_string()),
        };
        state.media_file_repo.create(&file).await.unwrap();
        id
    }

    async fn viewer_of(state: &TestState, libraries: Vec<Uuid>) -> String {
        let user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(state, user, libraries).await;
        mint_access_token(state, user)
    }

    #[tokio::test]
    async fn rails_require_auth_and_hide_when_empty() {
        let (router, state) = test_state().await;
        let anon = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/home/rails")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(anon.status(), StatusCode::UNAUTHORIZED);

        let token = viewer_of(&state, vec![Uuid::new_v4()]).await;
        let (status, rails) = call(&router, &token, "GET", "/api/v1/home/rails", None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(rails["rails"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn recently_added_released_and_top_unwatched_per_library() {
        let (router, state) = test_state().await;
        let instance = Uuid::new_v4();
        let loved = playable(&state, "Loved", &["score:8.5:30000"], instance).await;
        let _meh = playable(&state, "Meh", &["score:5.0:30000"], instance).await;
        let seen = playable(&state, "Seen", &["score:9.5:90000"], instance).await;
        // Not playable: must never appear.
        seed_movie_with_tags(&state, "NoFile", &["score:9.9:99999"]).await;
        let token = viewer_of(&state, vec![instance]).await;

        let (_, rails) = call(&router, &token, "GET", "/api/v1/home/rails", None).await;
        let added = rail(&rails, "Recently Added in Movies").expect("recently added");
        assert_eq!(titles(added).len(), 3);
        assert!(
            rail(&rails, "Recently Added in Series").is_none(),
            "empty rails hide"
        );
        assert!(
            rail(&rails, "Recently Released Movies").is_none(),
            "no release dates"
        );
        let top = rail(&rails, "Top Unwatched Movies").expect("top unwatched");
        assert_eq!(titles(top), ["Seen", "Loved", "Meh"]);
        assert_eq!(added["title_key"], "recently_added");
        assert_eq!(added["library"], "movie");

        // Watching a title drops it from Top Unwatched straight away (the
        // per-user cache is invalidated by the progress write).
        let user = state.app.jwt.verify_access_token(&token).await.unwrap().sub;
        let file = state
            .media_file_repo
            .list_by_work_id(seen)
            .await
            .unwrap()
            .remove(0);
        state
            .app
            .watch_progress
            .upsert(
                user,
                &WatchProgress {
                    media_file_id: file.id,
                    work_id: seen,
                    position_ms: 3_500_000,
                    duration_ms: 3_600_000,
                    state: playarr_model::WatchState::Watched,
                    updated_at: Some(Utc::now()),
                },
            )
            .await
            .unwrap();
        let (_, rails) = call(&router, &token, "GET", "/api/v1/home/rails", None).await;
        assert_eq!(
            titles(rail(&rails, "Top Unwatched Movies").unwrap()),
            ["Loved", "Meh"]
        );
        let _ = loved;

        // Titles come back localised on request.
        let (_, ja) = call(&router, &token, "GET", "/api/v1/home/rails?lang=ja", None).await;
        assert!(rail(&ja, "映画の新着").is_some());
        let (_, only_series) = call(
            &router,
            &token,
            "GET",
            "/api/v1/home/rails?library=series",
            None,
        )
        .await;
        assert!(only_series["rails"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn seasonal_rail_follows_the_date_and_matches_keywords() {
        let (router, state) = test_state().await;
        let instance = Uuid::new_v4();
        playable(&state, "The Haunted Manor", &[], instance).await;
        playable(&state, "Sunny Side", &[], instance).await;
        let token = viewer_of(&state, vec![instance]).await;

        let (_, oct) = call(
            &router,
            &token,
            "GET",
            "/api/v1/home/rails?on=2026-10-15",
            None,
        )
        .await;
        let halloween = rail(&oct, "Halloween Movies").expect("halloween rail");
        assert_eq!(halloween["title_key"], "seasonal.halloween");
        assert_eq!(titles(halloween), ["The Haunted Manor"]);

        let (_, mar) = call(
            &router,
            &token,
            "GET",
            "/api/v1/home/rails?on=2026-03-10",
            None,
        )
        .await;
        assert!(mar["rails"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["kind"] != "seasonal"));
    }

    #[tokio::test]
    async fn household_gate_and_library_allow_list_apply_to_every_rail() {
        let (router, state) = test_state().await;
        let allowed = Uuid::new_v4();
        let other = Uuid::new_v4();
        playable(&state, "Family", &["rating:PG", "score:8.0:9000"], allowed).await;
        playable(&state, "Adult", &["rating:R", "score:9.0:9000"], allowed).await;
        playable(
            &state,
            "OtherLibrary",
            &["rating:PG", "score:9.0:9000"],
            other,
        )
        .await;
        let child = Uuid::new_v4();
        seed_policy_user(&state, child, |p| {
            p.library_allow = vec![allowed];
            p.max_rating = Some("PG".into());
        })
        .await;
        let token = mint_access_token(&state, child);
        let (_, rails) = call(&router, &token, "GET", "/api/v1/home/rails", None).await;
        for r in rails["rails"].as_array().unwrap() {
            assert_eq!(titles(r), ["Family"], "rail {} leaked", r["title"]);
        }
        assert!(!rails["rails"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn admin_manages_defaults_and_custom_rails_with_language_filters() {
        let (router, state) = test_state().await;
        let instance = Uuid::new_v4();
        let dubbed = playable(&state, "Dubbed", &[], instance).await;
        playable(&state, "Plain", &[], instance).await;
        let file = state
            .media_file_repo
            .list_by_work_id(dubbed)
            .await
            .unwrap()
            .remove(0);
        let langs = playarr_db::repo::SqlxMediaLanguageRepo::new(state.pool.clone());
        use playarr_db::MediaLanguageRepo;
        langs
            .replace(file.id, "arr", Some(&["ja".to_string()]), None, 0)
            .await
            .unwrap();

        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let admin_token = mint_access_token(&state, admin);
        let user_token = viewer_of(&state, vec![instance]).await;

        // Non-admins cannot manage rails.
        let (status, _) = call(
            &router,
            &user_token,
            "GET",
            "/api/v1/admin/home-rails",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        let (_, defs) = call(
            &router,
            &admin_token,
            "GET",
            "/api/v1/admin/home-rails",
            None,
        )
        .await;
        assert_eq!(defs.as_array().unwrap().len(), 12);
        let seasonal = defs
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["kind"] == "seasonal" && d["library"] == "movie")
            .unwrap();
        assert!(
            seasonal["effective_seasonal_rules"]
                .as_array()
                .unwrap()
                .len()
                >= 6
        );

        // A view over Japanese audio becomes a custom rail.
        let (status, view) = call(
            &router,
            &admin_token,
            "POST",
            "/api/v1/admin/views",
            Some(json!({"name": "Japanese audio", "criteria": {"kind": "movie", "audio_languages": ["ja"], "available_only": true}, "sort": ["title"]})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{view}");
        assert_eq!(view["criteria"]["audio_languages"], json!(["ja"]));
        let (status, created) = call(
            &router,
            &admin_token,
            "POST",
            "/api/v1/admin/home-rails",
            Some(json!({"name": "In Japanese", "view_id": view["id"], "library": "movie"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{created}");
        let custom_id = created["id"].as_str().unwrap().to_string();

        let (_, rails) = call(&router, &user_token, "GET", "/api/v1/home/rails", None).await;
        assert_eq!(titles(rail(&rails, "In Japanese").unwrap()), ["Dubbed"]);

        // Disabling a default hides it; the custom rail can move to the top.
        let added = seasonal_or(&defs, "recently_added", "movie");
        let (status, _) = call(
            &router,
            &admin_token,
            "PUT",
            &format!("/api/v1/admin/home-rails/{added}"),
            Some(json!({"enabled": false})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, _) = call(
            &router,
            &admin_token,
            "PUT",
            "/api/v1/admin/home-rails/order",
            Some(json!({"ids": [custom_id]})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (_, rails) = call(&router, &user_token, "GET", "/api/v1/home/rails", None).await;
        assert!(rail(&rails, "Recently Added in Movies").is_none());
        assert_eq!(rails["rails"][0]["title"], "In Japanese");

        // Defaults cannot be deleted; customs can; deleting the view too.
        let (status, _) = call(
            &router,
            &admin_token,
            "DELETE",
            &format!("/api/v1/admin/home-rails/{added}"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        let (status, _) = call(
            &router,
            &admin_token,
            "DELETE",
            &format!("/api/v1/admin/views/{}", view["id"].as_str().unwrap()),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (_, defs) = call(
            &router,
            &admin_token,
            "GET",
            "/api/v1/admin/home-rails",
            None,
        )
        .await;
        assert!(defs
            .as_array()
            .unwrap()
            .iter()
            .all(|d| d["kind"] != "custom"));

        // Invalid config is rejected.
        let (status, _) = call(
            &router,
            &admin_token,
            "PUT",
            &format!("/api/v1/admin/home-rails/{added}"),
            Some(json!({"config": {"limit": 0}})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let (status, _) = call(
            &router,
            &admin_token,
            "PUT",
            &format!("/api/v1/admin/home-rails/{added}"),
            Some(json!({"config": {"seasonal_rules": [{"key": "x", "start": "13-01", "end": "01-02", "keywords": ["a"]}]}})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    fn seasonal_or(defs: &Value, kind: &str, library: &str) -> String {
        defs.as_array()
            .unwrap()
            .iter()
            .find(|d| d["kind"] == kind && d["library"] == library)
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn users_hide_and_reorder_their_own_rails() {
        let (router, state) = test_state().await;
        let instance = Uuid::new_v4();
        playable(&state, "One", &["score:8.0:9000"], instance).await;
        let mine = viewer_of(&state, vec![instance]).await;
        let theirs = viewer_of(&state, vec![instance]).await;

        let (_, prefs) = call(
            &router,
            &mine,
            "GET",
            "/api/v1/home/rails/preferences",
            None,
        )
        .await;
        let ids: Vec<String> = prefs["rails"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids.len(), 12);
        let top = seasonal_or(
            &call(
                &router,
                &state_admin(&state).await,
                "GET",
                "/api/v1/admin/home-rails",
                None,
            )
            .await
            .1,
            "top_unwatched",
            "movie",
        );
        let added = seasonal_or(
            &call(
                &router,
                &state_admin(&state).await,
                "GET",
                "/api/v1/admin/home-rails",
                None,
            )
            .await
            .1,
            "recently_added",
            "movie",
        );

        // Warm both caches, then change only my preferences.
        call(&router, &theirs, "GET", "/api/v1/home/rails", None).await;
        let (status, _) = call(
            &router,
            &mine,
            "PUT",
            "/api/v1/home/rails/preferences",
            Some(json!({"order": [top], "hidden": [added]})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (_, rails) = call(&router, &mine, "GET", "/api/v1/home/rails", None).await;
        assert_eq!(rails["rails"][0]["title"], "Top Unwatched Movies");
        assert!(rail(&rails, "Recently Added in Movies").is_none());
        let (_, rails) = call(&router, &theirs, "GET", "/api/v1/home/rails", None).await;
        assert!(
            rail(&rails, "Recently Added in Movies").is_some(),
            "others unaffected"
        );

        let (status, _) = call(
            &router,
            &mine,
            "DELETE",
            "/api/v1/home/rails/preferences",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (_, rails) = call(&router, &mine, "GET", "/api/v1/home/rails", None).await;
        assert!(rail(&rails, "Recently Added in Movies").is_some());
    }

    async fn state_admin(state: &TestState) -> String {
        let admin = Uuid::new_v4();
        seed_admin_user(state, admin).await;
        mint_access_token(state, admin)
    }
}
