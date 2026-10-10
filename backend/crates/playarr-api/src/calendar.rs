//! Aggregated release calendar -- `docs/architecture/release-calendar.md`.
//!
//! `GET /api/v1/calendar` queries every permitted Sonarr, Radarr, Lidarr and
//! Readarr instance concurrently, merges duplicate releases, reports
//! unreachable instances instead of dropping them, and joins each entry to
//! its catalog `Work` when one exists.

use std::collections::{HashMap, HashSet};

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use chrono::{DateTime, Datelike, Duration as ChronoDuration, NaiveDate, Utc};
use futures::StreamExt;
use playarr_arr_sync::calendar::{merge_candidates, CalendarCandidate};
use playarr_model::discovery::{ActionKind, DiscoveryKind, TitleSnapshot};
use playarr_model::{
    CalendarAction, CalendarActionKind, CalendarGroupMember, CalendarMediaKind, CalendarResponse,
    CalendarSourceState, CalendarSourceStatus, ExternalRef, SourceInstance, SourceKind,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth_extractor::CatalogViewer;
use crate::discovery::ResolvedTitle;
use crate::error::ApiError;
use crate::AppState;

/// Longest window one request may cover.
pub const MAX_WINDOW_DAYS: i64 = 92;
const DEFAULT_WINDOW_DAYS: i64 = 30;
pub use crate::calendar_cache::CalendarCache;
use crate::calendar_cache::Lookup;

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct CalendarQuery {
    /// First day, inclusive (`YYYY-MM-DD`). Defaults to today (UTC).
    pub start: Option<NaiveDate>,
    /// Last day, inclusive. Defaults to `start` plus 30 days; at most 92 days
    /// after `start`.
    pub end: Option<NaiveDate>,
    /// Comma-separated `episode,movie,album,book`. All when omitted.
    pub kind: Option<String>,
    /// Restrict to one source instance.
    pub source_instance_id: Option<Uuid>,
    /// `series_day` folds episodes of the same series released on the same
    /// (UTC) day and at the same time into one entry whose `members` lists
    /// them. Omit for one entry per episode.
    pub group: Option<String>,
}

/// Which instances a caller may query: `None` allows every instance.
fn is_calendar_source(kind: SourceKind) -> bool {
    matches!(
        kind,
        SourceKind::Sonarr | SourceKind::Radarr | SourceKind::Lidarr | SourceKind::Readarr
    )
}

fn parse_kinds(raw: Option<&str>) -> Result<Option<HashSet<CalendarMediaKind>>, ApiError> {
    let Some(raw) = raw.filter(|r| !r.trim().is_empty()) else {
        return Ok(None);
    };
    let mut kinds = HashSet::new();
    for part in raw.split(',') {
        kinds.insert(match part.trim() {
            "episode" => CalendarMediaKind::Episode,
            "movie" => CalendarMediaKind::Movie,
            "album" => CalendarMediaKind::Album,
            "book" => CalendarMediaKind::Book,
            other => {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "invalid_kind",
                    format!("unknown calendar kind `{other}`"),
                ))
            }
        });
    }
    Ok(Some(kinds))
}

fn parse_group(raw: Option<&str>) -> Result<bool, ApiError> {
    match raw.map(str::trim).filter(|r| !r.is_empty()) {
        None => Ok(false),
        Some("series_day") => Ok(true),
        Some(other) => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_group",
            format!("unknown calendar grouping `{other}`; use `series_day`"),
        )),
    }
}

/// Folds episodes of one series released on the same day at the same time
/// into a single entry (the first episode), listing every episode in
/// `members`. Movies, albums, books and lone episodes are left alone.
fn group_series_day(candidates: Vec<CalendarCandidate>) -> Vec<CalendarCandidate> {
    type Key = (String, NaiveDate, Option<DateTime<Utc>>);
    let key_of = |c: &CalendarCandidate| -> Option<Key> {
        let e = &c.entry;
        if e.media_kind != CalendarMediaKind::Episode
            || e.season_number.is_none()
            || e.episode_number.is_none()
        {
            return None;
        }
        let series = match &c.work_ref {
            Some((provider, id)) => format!("{provider:?}:{id}"),
            None => format!("title:{}", e.title.to_lowercase()),
        };
        Some((series, e.date, e.release_at))
    };
    let mut order: Vec<Result<Key, usize>> = Vec::new();
    let mut groups: HashMap<Key, Vec<CalendarCandidate>> = HashMap::new();
    let mut singles: Vec<Option<CalendarCandidate>> = Vec::new();
    for candidate in candidates {
        match key_of(&candidate) {
            Some(key) => {
                if !groups.contains_key(&key) {
                    order.push(Ok(key.clone()));
                }
                groups.entry(key).or_default().push(candidate);
            }
            None => {
                order.push(Err(singles.len()));
                singles.push(Some(candidate));
            }
        }
    }
    let mut out = Vec::new();
    for item in order {
        match item {
            Err(index) => out.extend(singles[index].take()),
            Ok(key) => {
                let mut members = groups.remove(&key).unwrap_or_default();
                members.sort_by_key(|c| (c.entry.season_number, c.entry.episode_number));
                if members.len() == 1 {
                    out.extend(members);
                    continue;
                }
                let list: Vec<CalendarGroupMember> = members
                    .iter()
                    .map(|c| CalendarGroupMember {
                        id: c.entry.id.clone(),
                        subtitle: c.entry.subtitle.clone(),
                        season_number: c.entry.season_number,
                        episode_number: c.entry.episode_number,
                        monitored: c.entry.monitored,
                        has_file: c.entry.has_file,
                    })
                    .collect();
                let mut iter = members.into_iter();
                let mut head = iter.next().expect("a group has members");
                head.entry.subtitle = None;
                // The head's synopsis is one episode's; a group is several, so it carries none.
                head.entry.overview = None;
                head.entry.has_file = list.iter().all(|m| m.has_file);
                head.entry.monitored = list.iter().any(|m| m.monitored);
                for other in iter {
                    for source in other.entry.sources {
                        if !head.entry.sources.contains(&source) {
                            head.entry.sources.push(source);
                        }
                    }
                    if head.entry.poster_url.is_none() {
                        head.entry.poster_url = other.entry.poster_url;
                    }
                }
                head.entry.members = list;
                out.push(head);
            }
        }
    }
    out
}

/// The identity a client sends back to the request and watchlist endpoints.
fn entry_snapshot(c: &CalendarCandidate) -> Option<TitleSnapshot> {
    let (provider, external_id) = c.work_ref.clone()?;
    let e = &c.entry;
    let kind = match e.media_kind {
        CalendarMediaKind::Episode => DiscoveryKind::Series,
        CalendarMediaKind::Movie => DiscoveryKind::Movie,
        CalendarMediaKind::Album => DiscoveryKind::Artist,
        CalendarMediaKind::Book => DiscoveryKind::Author,
    };
    Some(TitleSnapshot {
        kind,
        title: e.title.clone(),
        year: Some(e.date.year()),
        work_id: e.work_id,
        external_refs: vec![ExternalRef {
            provider,
            external_id,
        }],
        poster_url: e.poster_url.clone(),
    })
}

/// The library files a calendar entry can play, per work.
enum WorkFiles {
    /// A movie's own file, when one has synced.
    Movie(Option<Uuid>),
    /// A series' episode files by `(season, episode)`.
    Series(HashMap<(i64, i64), Uuid>),
    /// Albums, books and anything else: the calendar never offers Play.
    Other,
}

impl WorkFiles {
    /// The file belonging to exactly this entry, if the library has one.
    fn file_for(&self, entry: &playarr_model::CalendarEntry) -> Option<Uuid> {
        match (self, entry.media_kind) {
            (WorkFiles::Movie(file), CalendarMediaKind::Movie) => *file,
            (WorkFiles::Series(files), CalendarMediaKind::Episode) => files
                .get(&(entry.season_number?, entry.episode_number?))
                .copied(),
            _ => None,
        }
    }
}

async fn work_files(
    state: &AppState,
    viewer: &CatalogViewer,
    memo: &crate::discovery::ResolveMemo,
    work_id: Uuid,
) -> WorkFiles {
    match memo.view(state, viewer, work_id).await.as_deref() {
        Some(view) => match &view.files {
            playarr_catalog::WorkFiles::Movie(file) => WorkFiles::Movie(*file),
            playarr_catalog::WorkFiles::Series(episodes) => WorkFiles::Series(
                episodes
                    .iter()
                    .map(|e| {
                        (
                            (i64::from(e.season_number), i64::from(e.episode_number)),
                            e.media_file_id,
                        )
                    })
                    .collect(),
            ),
            playarr_catalog::WorkFiles::Other => WorkFiles::Other,
        },
        None => WorkFiles::Other,
    }
}

/// Turns a resolved title into the calendar's action list for one entry.
/// The resolved actions describe the whole title (a series' "next episode");
/// `own_file` is the file of exactly this entry's episode or film. Play and
/// Resume are offered only when that file exists, and always point at it.
fn calendar_actions(resolved: &ResolvedTitle, own_file: Option<Uuid>) -> Vec<CalendarAction> {
    let mut out = Vec::new();
    let in_library = resolved
        .actions
        .iter()
        .find(|a| a.action == ActionKind::Play)
        .and_then(|a| a.work_id);
    if let Some(work_id) = in_library {
        out.push(CalendarAction {
            action: CalendarActionKind::Open,
            enabled: true,
            reason: None,
            work_id: Some(work_id),
            media_file_id: None,
            position_ms: None,
            active: false,
        });
    }
    for a in &resolved.actions {
        let kind = match a.action {
            ActionKind::Play if in_library.is_some() => CalendarActionKind::Play,
            ActionKind::Resume => CalendarActionKind::Resume,
            ActionKind::Request => CalendarActionKind::Request,
            _ => continue,
        };
        let media_file_id = match kind {
            CalendarActionKind::Play => match own_file {
                Some(file) if a.enabled => Some(file),
                _ => continue,
            },
            // Resume only where the part-watched file is this entry's own.
            CalendarActionKind::Resume if own_file.is_none() || a.media_file_id != own_file => {
                continue
            }
            _ => a.media_file_id,
        };
        out.push(CalendarAction {
            action: kind,
            enabled: a.enabled,
            reason: a.reason.clone(),
            work_id: a.work_id,
            media_file_id,
            position_ms: a.position_ms,
            active: kind == CalendarActionKind::Request && resolved.request.is_some(),
        });
    }
    out.push(CalendarAction {
        action: CalendarActionKind::Watchlist,
        enabled: true,
        reason: None,
        work_id: None,
        media_file_id: None,
        position_ms: None,
        active: resolved.in_watchlist,
    });
    out
}

/// Attaches snapshots and per-caller actions. Each distinct title is resolved
/// once, a few at a time, with the same logic as `POST /api/v1/discover/resolve`.
async fn attach_actions(
    state: &AppState,
    viewer: &CatalogViewer,
    candidates: &mut [CalendarCandidate],
    known_works: Option<&HashMap<ExternalRef, playarr_model::Work>>,
) -> bool {
    let mut distinct: HashMap<String, TitleSnapshot> = HashMap::new();
    let mut keys: Vec<Option<String>> = Vec::with_capacity(candidates.len());
    for candidate in candidates.iter() {
        let snapshot = entry_snapshot(candidate);
        let key = snapshot.as_ref().map(|s| {
            playarr_model::discovery::identity_key(s.kind, &s.title, s.year, &s.external_refs)
        });
        if let (Some(key), Some(snapshot)) = (&key, snapshot) {
            distinct.entry(key.clone()).or_insert(snapshot);
        }
        keys.push(key);
    }
    let phase = std::time::Instant::now();
    let memo = crate::discovery::ResolveMemo::default();
    let memo = &memo;
    if let Some(works) = known_works {
        // The caller already looked these refs up (a ref it did not find has no work).
        memo.seed_works(
            distinct
                .values()
                .flat_map(|s| s.external_refs.iter())
                .map(|r| (r.clone(), works.get(r).cloned())),
        )
        .await;
    }
    memo.prime(state, viewer, distinct.values()).await;
    let resolved: HashMap<String, ResolvedTitle> = futures::stream::iter(distinct)
        .map(|(key, snapshot)| async move {
            match crate::discovery::resolve_snapshot_with(state, viewer, &snapshot, memo).await {
                Ok(resolved) => Some((key, resolved)),
                Err(error) => {
                    tracing::warn!(?error, "calendar action resolution failed");
                    memo.mark_failed();
                    None
                }
            }
        })
        .buffer_unordered(8)
        .filter_map(|r| async move { r })
        .collect()
        .await;
    let resolve_ms = phase.elapsed().as_millis();
    // Each distinct work's files are read once, concurrently.
    let work_ids: HashSet<Uuid> = candidates.iter().filter_map(|c| c.entry.work_id).collect();
    let files: HashMap<Uuid, WorkFiles> = futures::stream::iter(work_ids)
        .map(|work_id| async move { (work_id, work_files(state, viewer, memo, work_id).await) })
        .buffer_unordered(8)
        .collect()
        .await;
    for (candidate, key) in candidates.iter_mut().zip(keys) {
        let Some(key) = key else { continue };
        candidate.entry.snapshot = entry_snapshot(candidate);
        let Some(title) = resolved.get(&key) else {
            continue;
        };
        let own_file = match candidate.entry.work_id {
            Some(work_id) => files
                .get(&work_id)
                .and_then(|f| f.file_for(&candidate.entry)),
            None => None,
        };
        candidate.entry.actions = calendar_actions(title, own_file);
    }
    tracing::info!(
        distinct_titles = resolved.len(),
        works = files.len(),
        resolve_ms,
        total_ms = phase.elapsed().as_millis(),
        "calendar actions built"
    );
    memo.complete()
}

/// Resolves the requested window, applying defaults and the span cap.
pub(crate) fn resolve_window(
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
) -> Result<(NaiveDate, NaiveDate), ApiError> {
    let start = start.unwrap_or_else(|| Utc::now().date_naive());
    let end = end.unwrap_or(start + ChronoDuration::days(DEFAULT_WINDOW_DAYS));
    if end < start || (end - start).num_days() > MAX_WINDOW_DAYS {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_range",
            format!("end must not precede start and the range is at most {MAX_WINDOW_DAYS} days"),
        ));
    }
    Ok((start, end))
}

/// What the caller asked for beyond the window: grouping, and the viewer whose
/// actions to compute (`None` for the subscription feed, which has no actions).
#[derive(Clone, Copy, Default)]
pub(crate) struct CalendarOptions<'a> {
    pub group_series_day: bool,
    pub viewer: Option<&'a CatalogViewer>,
}

/// Builds the calendar for `allowed` libraries (`None` = unrestricted).
pub(crate) async fn build_calendar(
    state: &AppState,
    allowed: Option<&[Uuid]>,
    start: NaiveDate,
    end: NaiveDate,
    kinds: Option<&HashSet<CalendarMediaKind>>,
    only_instance: Option<Uuid>,
    options: CalendarOptions<'_>,
) -> CalendarResponse {
    build_calendar_checked(state, allowed, start, end, kinds, only_instance, options)
        .await
        .0
}

/// [`build_calendar`], also saying whether every read succeeded. A response
/// built after a failed read is served but must not be cached.
pub(crate) async fn build_calendar_checked(
    state: &AppState,
    allowed: Option<&[Uuid]>,
    start: NaiveDate,
    end: NaiveDate,
    kinds: Option<&HashSet<CalendarMediaKind>>,
    only_instance: Option<Uuid>,
    options: CalendarOptions<'_>,
) -> (CalendarResponse, bool) {
    let mut complete = true;
    let mut instances: Vec<SourceInstance> = state
        .source_instances
        .all()
        .into_iter()
        .filter(|i| is_calendar_source(i.kind))
        .filter(|i| allowed.is_none_or(|ids| ids.contains(&i.id)))
        .filter(|i| only_instance.is_none_or(|id| id == i.id))
        .collect();
    instances.sort_by(|a, b| (a.priority, &a.name, a.id).cmp(&(b.priority, &b.name, b.id)));

    // Answered from the background-refreshed cache: a request never waits on
    // (or reports the health of) a source. Admins see source health in Settings.
    // Users only ever see neutral labels; the admin-chosen instance name is data that
    // may be a provider's name. Numbered among the instances the viewer may see, so a
    // label never depends on a filter and never hints at hidden sources.
    let visible: Vec<SourceInstance> = state
        .source_instances
        .all()
        .into_iter()
        .filter(|i| allowed.is_none_or(|ids| ids.contains(&i.id)))
        .collect();
    let labels = playarr_model::neutral_source_labels(&visible);
    let cache = &state.calendar_cache;
    let mut statuses = Vec::new();
    let mut candidates = Vec::new();
    for instance in &instances {
        let kept: Vec<_> = cache
            .snapshot(instance.id, start, end)
            .into_iter()
            .filter(|c| kinds.is_none_or(|k| k.contains(&c.entry.media_kind)))
            .collect();
        statuses.push(CalendarSourceStatus {
            source_instance_id: instance.id,
            name: labels[&instance.id].clone(),
            display_label: labels[&instance.id].clone(),
            kind: instance.kind,
            status: CalendarSourceState::Ok,
            error: None,
            entry_count: kept.len() as u32,
        });
        candidates.extend(kept);
    }

    let timer = std::time::Instant::now();
    let mut merged = merge_candidates(candidates);
    // Works and availability lag for every distinct title, in a few queries
    // however many titles the window holds.
    let phase = std::time::Instant::now();
    let refs: Vec<ExternalRef> = {
        let mut seen = HashSet::new();
        merged
            .iter()
            .filter_map(|c| c.work_ref.clone())
            .map(|(provider, external_id)| ExternalRef {
                provider,
                external_id,
            })
            .filter(|r| seen.insert(r.clone()))
            .collect()
    };
    // `None` when the lookup failed: title resolution then looks refs up itself.
    let works = match state.work_repo.find_by_external_refs(&refs).await {
        Ok(found) => Some(found),
        Err(error) => {
            tracing::warn!(?error, "calendar: work lookup failed");
            complete = false;
            None
        }
    };
    let lookup_us = phase.elapsed().as_micros();
    let phase = std::time::Instant::now();
    let lag_keys: Vec<(String, String)> = {
        let mut seen = HashSet::new();
        merged
            .iter()
            .filter(|c| c.entry.media_kind == CalendarMediaKind::Episode)
            .filter_map(|c| c.work_ref.as_ref())
            .map(|(provider, external_id)| {
                (
                    playarr_arr_sync::availability::provider_name(provider),
                    external_id.clone(),
                )
            })
            .filter(|k| seen.insert(k.clone()))
            .collect()
    };
    let event_generation = playarr_db::availability_event_generation();
    let (mut lags, missing) = cache.cached_lags(&lag_keys, event_generation);
    if !missing.is_empty() {
        match state.availability_event_repo.list_for_many(&missing).await {
            Ok(mut events) => {
                let computed: Vec<_> = missing
                    .into_iter()
                    .map(|key| {
                        let lag = events
                            .remove(&key)
                            .and_then(|e| playarr_model::compute_lag(&e).average_seconds);
                        (key, lag)
                    })
                    .collect();
                cache.store_lags(event_generation, computed.iter().cloned());
                lags.extend(computed);
            }
            Err(error) => {
                tracing::warn!(?error, "calendar: availability lag lookup failed");
                complete = false;
            }
        }
    }
    let lag_us = phase.elapsed().as_micros();
    for candidate in &mut merged {
        let Some((provider, external_id)) = candidate.work_ref.clone() else {
            continue;
        };
        let work_ref = ExternalRef {
            provider,
            external_id,
        };
        candidate.entry.work_id = works.as_ref().and_then(|w| w.get(&work_ref)).map(|w| w.id);
        if candidate.entry.media_kind == CalendarMediaKind::Episode {
            let lag_key = (
                playarr_arr_sync::availability::provider_name(&work_ref.provider),
                work_ref.external_id,
            );
            candidate.entry.average_lag_seconds = lags.get(&lag_key).copied().flatten();
        }
    }

    let enrich_ms = timer.elapsed().as_millis();
    if options.group_series_day {
        merged = group_series_day(merged);
    }
    for candidate in &mut merged {
        for source in &mut candidate.entry.sources {
            if let Some(label) = labels.get(&source.source_instance_id) {
                source.source_name.clone_from(label);
                source.display_label.clone_from(label);
            } else {
                source.source_name = source.source_kind.neutral_label().to_string();
                source.display_label.clone_from(&source.source_name);
            }
        }
    }
    if let Some(viewer) = options.viewer {
        complete &= attach_actions(state, viewer, &mut merged, works.as_ref()).await;
    }
    tracing::info!(
        entries = merged.len(),
        enrich_ms,
        lookup_ms = lookup_us / 1000,
        lag_ms = lag_us / 1000,
        total_ms = timer.elapsed().as_millis(),
        "calendar built"
    );

    (
        CalendarResponse {
            start,
            end,
            entries: merged.into_iter().map(|c| c.entry).collect(),
            sources: statuses,
        },
        complete,
    )
}

#[utoipa::path(
    get,
    path = "/api/v1/calendar",
    tag = "calendar",
    params(CalendarQuery),
    responses(
        (status = 200, description = "Upcoming releases from every permitted instance, with per-instance status", body = CalendarResponse),
        (status = 400, description = "Invalid range or kind"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog")
    )
)]
pub async fn calendar_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(params): Query<CalendarQuery>,
) -> Result<
    (
        [(header::HeaderName, &'static str); 1],
        Json<CalendarResponse>,
    ),
    ApiError,
> {
    let (start, end) = resolve_window(params.start, params.end)?;
    let kinds = parse_kinds(params.kind.as_deref())?;
    let group_series_day = parse_group(params.group.as_deref())?;
    let allowed = viewer.allowed_libraries();
    // Per-viewer: the key carries the user and the libraries they may see. A
    // hit is served without touching the database; live events for this user
    // or the library, and any source refresh, make it stale.
    let mut kind_names: Vec<String> = kinds.iter().flatten().map(|k| format!("{k:?}")).collect();
    kind_names.sort();
    let key = format!(
        "{}|{:?}|{start}|{end}|{kind_names:?}|{group_series_day}|{:?}|{:x}",
        viewer.user_id,
        allowed,
        params.source_instance_id,
        instances_fingerprint(&state)
    );
    let cache = &state.calendar_cache;
    let cached = match cache.lookup(&key, viewer.user_id) {
        Lookup::Hit(hit) => Some(hit),
        Lookup::Check {
            response,
            candidates,
            deps,
            tick,
        } => {
            let fresh = unaffected_by_new_works(&state, &candidates, &deps).await;
            cache
                .confirm(&key, &response, tick, fresh)
                .then_some(response)
        }
        Lookup::Miss(_) => None,
    };
    if let Some(hit) = cached {
        return Ok(([(CACHE_HEADER, "hit")], Json((*hit).clone())));
    }
    let (response, shared) = cache
        .build_once(&key, |source_generation, tick| {
            let (state, viewer, key) = (&state, &viewer, key.clone());
            async move {
                let (response, complete) = build_calendar_checked(
                    state,
                    allowed.as_deref(),
                    start,
                    end,
                    kinds.as_ref(),
                    params.source_instance_id,
                    CalendarOptions {
                        group_series_day,
                        viewer: Some(viewer),
                    },
                )
                .await;
                let response = std::sync::Arc::new(response);
                // A response built after a failed read is served, never kept.
                if complete {
                    state.calendar_cache.store_response(
                        key,
                        source_generation,
                        tick,
                        response.clone(),
                    );
                }
                response
            }
        })
        .await;
    let outcome = if shared { "shared" } else { "miss" };
    Ok(([(CACHE_HEADER, outcome)], Json((*response).clone())))
}

/// Changes whenever an instance is added, removed or edited in a way the
/// calendar shows: names and priority (labels), kind, and the defaults that
/// decide whether a title can be requested.
fn instances_fingerprint(state: &AppState) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut instances = state.source_instances.all();
    instances.sort_by_key(|i| i.id);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for i in &instances {
        (
            i.id,
            i.kind,
            &i.name,
            i.priority,
            &i.default_root_folder_id,
            i.default_quality_profile_id,
        )
            .hash(&mut hasher);
    }
    hasher.finish()
}

/// Header telling a client (and a measurement) how the calendar was answered.
const CACHE_HEADER: header::HeaderName = header::HeaderName::from_static("x-calendar-cache");

/// `true` when none of `candidates` (works that changed since a cached
/// calendar was built) now carries an external id the calendar had no work
/// for. Anything unreadable or large counts as affected.
async fn unaffected_by_new_works(
    state: &AppState,
    candidates: &[Uuid],
    deps: &crate::calendar_cache::ResponseDeps,
) -> bool {
    if candidates.len() > 64 {
        return false;
    }
    match state.work_repo.get_many(candidates).await {
        Ok(works) => !works
            .values()
            .flat_map(|w| w.external_refs.iter())
            .any(|r| deps.unmatched().contains(r)),
        Err(_) => false,
    }
}

/// Lag statistic for one work, merged across every external id it carries.
async fn lag_for_refs(
    state: &AppState,
    refs: &[(String, String)],
) -> Result<playarr_model::AvailabilityLag, ApiError> {
    let mut events = Vec::new();
    for (provider, external_id) in refs {
        events.extend(
            state
                .availability_event_repo
                .list_for(provider, external_id)
                .await
                .map_err(|e| ApiError::internal(e.to_string()))?,
        );
    }
    Ok(playarr_model::compute_lag(&events))
}

#[utoipa::path(
    get,
    path = "/api/v1/catalog/{id}/availability-lag",
    tag = "calendar",
    params(("id" = Uuid, Path, description = "Catalog work id")),
    responses(
        (status = 200, description = "Average time from release to availability, from real grab/import events. Backfills and items without release data are counted but excluded.", body = playarr_model::AvailabilityLag),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog"),
        (status = 404, description = "No work with this id")
    )
)]
pub async fn availability_lag_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<playarr_model::AvailabilityLag>, ApiError> {
    let allowed = viewer.allowed_libraries();
    let detail = state.catalog.get_by_id(id, allowed.as_deref()).await?;
    let refs: Vec<(String, String)> = detail
        .work
        .external_refs
        .iter()
        .map(|r| {
            (
                playarr_arr_sync::availability::provider_name(&r.provider),
                r.external_id.clone(),
            )
        })
        .collect();
    Ok(Json(lag_for_refs(&state, &refs).await?))
}

/// How far back and forward the subscription feed reaches.
const FEED_DAYS_BACK: i64 = 14;
const FEED_DAYS_FORWARD: i64 = 180;
const FEED_TOKEN_LEN: usize = 43;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CalendarFeedStatus {
    pub active: bool,
    pub created_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    /// `POST /api/v1/calendar/feed` would return the existing link unchanged.
    /// False for a link created before links could be shown again: asking for
    /// it then replaces it. Servers without this field always replace.
    #[serde(default)]
    pub link_available: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CalendarFeedCreated {
    /// Full subscription URL.
    pub url: String,
    /// The secret path component.
    pub token: String,
    pub created_at: DateTime<Utc>,
}

/// Public origin the caller used. HTTP/2 carries the host in the URI
/// authority rather than a `Host` header, so both are consulted; a reverse
/// proxy's `X-Forwarded-*` headers win.
fn request_base(headers: &HeaderMap, uri: &Uri) -> String {
    let forwarded = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .map(str::trim)
            .filter(|v| !v.is_empty())
    };
    let scheme = forwarded("x-forwarded-proto")
        .filter(|v| matches!(*v, "http" | "https"))
        .or_else(|| uri.scheme_str())
        .unwrap_or("http");
    let host = forwarded("x-forwarded-host")
        .or_else(|| forwarded("host"))
        .or_else(|| uri.authority().map(|a| a.as_str()))
        .unwrap_or("localhost");
    format!("{scheme}://{host}")
}

fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// 256 bits of OS randomness, URL-safe, 43 characters.
fn new_token() -> String {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[utoipa::path(
    get,
    path = "/api/v1/calendar/feed",
    tag = "calendar",
    responses(
        (status = 200, description = "Whether the caller has an active subscription token", body = CalendarFeedStatus),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog")
    )
)]
pub async fn get_calendar_feed_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<Json<CalendarFeedStatus>, ApiError> {
    let info = state
        .calendar_feed_token_repo
        .active_for_user(viewer.user_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let link_available = match info.as_ref().and_then(|i| i.token_encrypted.as_deref()) {
        Some(sealed) => open_token(&feed_cipher(&state).await?, sealed).is_some(),
        None => false,
    };
    Ok(Json(CalendarFeedStatus {
        active: info.is_some(),
        created_at: info.as_ref().map(|i| i.created_at),
        last_used_at: info.and_then(|i| i.last_used_at),
        link_available,
    }))
}

#[derive(Debug, Default, Deserialize, IntoParams, ToSchema)]
pub struct CalendarFeedCreateQuery {
    /// Replace the existing link with a new one (the old URL stops working).
    #[serde(default)]
    pub rotate: bool,
}

/// Seals a feed token for storage so the link can be shown again. The key is
/// derived from this node's persistent identity, so a database copy alone
/// cannot reveal the token.
async fn feed_cipher(state: &AppState) -> Result<ChaCha20Poly1305, ApiError> {
    let identity = crate::admin_peer::ensure_node_identity(&state.node_identity_repo).await?;
    let mut hasher = Sha256::new();
    hasher.update(b"playarr:calendar-feed-token:v1:");
    hasher.update(identity.private_key.expose_secret().as_bytes());
    Ok(ChaCha20Poly1305::new(&hasher.finalize()))
}

fn seal_token(cipher: &ChaCha20Poly1305, token: &str) -> Result<String, ApiError> {
    let random = Uuid::new_v4();
    let nonce_bytes = &random.as_bytes()[..12];
    let sealed = cipher
        .encrypt(Nonce::from_slice(nonce_bytes), token.as_bytes())
        .map_err(|_| ApiError::internal("could not seal the calendar token"))?;
    let mut blob = nonce_bytes.to_vec();
    blob.extend(sealed);
    Ok(format!(
        "v1:{}",
        base64::engine::general_purpose::STANDARD.encode(blob)
    ))
}

/// `None` for a malformed blob or one sealed under another key.
fn open_token(cipher: &ChaCha20Poly1305, sealed: &str) -> Option<String> {
    let blob = base64::engine::general_purpose::STANDARD
        .decode(sealed.strip_prefix("v1:")?)
        .ok()?;
    if blob.len() <= 12 {
        return None;
    }
    let (nonce, body) = blob.split_at(12);
    let plain = cipher.decrypt(Nonce::from_slice(nonce), body).ok()?;
    let token = String::from_utf8(plain).ok()?;
    (token.len() == FEED_TOKEN_LEN).then_some(token)
}

#[utoipa::path(
    post,
    path = "/api/v1/calendar/feed",
    tag = "calendar",
    params(CalendarFeedCreateQuery),
    responses(
        (status = 200, description = "The caller's existing subscription URL, unchanged", body = CalendarFeedCreated),
        (status = 201, description = "A new subscription URL (none existed, the stored one could not be shown, or `rotate=true`); any previous token stops working", body = CalendarFeedCreated),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog")
    )
)]
pub async fn create_calendar_feed_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    uri: Uri,
    headers: HeaderMap,
    Query(params): Query<CalendarFeedCreateQuery>,
) -> Result<(StatusCode, Json<CalendarFeedCreated>), ApiError> {
    let cipher = feed_cipher(&state).await?;
    let base = request_base(&headers, &uri);
    if !params.rotate {
        let existing = state
            .calendar_feed_token_repo
            .active_for_user(viewer.user_id)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
        if let Some((info, token)) = existing.and_then(|info| {
            let token = open_token(&cipher, info.token_encrypted.as_deref()?)?;
            Some((info, token))
        }) {
            return Ok((
                StatusCode::OK,
                Json(CalendarFeedCreated {
                    url: format!("{base}/api/v1/calendar/feed/{token}.ics"),
                    token,
                    created_at: info.created_at,
                }),
            ));
        }
    }
    let token = new_token();
    let now = Utc::now();
    state
        .calendar_feed_token_repo
        .rotate(
            viewer.user_id,
            &hash_token(&token),
            Some(&seal_token(&cipher, &token)?),
            now,
        )
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok((
        StatusCode::CREATED,
        Json(CalendarFeedCreated {
            url: format!("{base}/api/v1/calendar/feed/{token}.ics"),
            token,
            created_at: now,
        }),
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v1/calendar/feed",
    tag = "calendar",
    responses(
        (status = 204, description = "The subscription token is revoked (idempotent)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog")
    )
)]
pub async fn revoke_calendar_feed_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<StatusCode, ApiError> {
    state
        .calendar_feed_token_repo
        .revoke(viewer.user_id, Utc::now())
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/calendar/feed/{file}",
    tag = "calendar",
    params(("file" = String, Path, description = "The subscription token followed by `.ics`")),
    responses(
        (status = 200, description = "iCalendar (RFC 5545) feed of the owner's releases", content_type = "text/calendar", body = String),
        (status = 404, description = "Unknown or revoked token")
    )
)]
pub async fn calendar_feed_ics_handler(
    State(state): State<AppState>,
    Path(file): Path<String>,
) -> Result<Response, ApiError> {
    let not_found = || ApiError::not_found("calendar feed not found");
    let token = file.strip_suffix(".ics").ok_or_else(not_found)?;
    if token.len() != FEED_TOKEN_LEN {
        return Err(not_found());
    }
    let now = Utc::now();
    let user_id = state
        .calendar_feed_token_repo
        .resolve(&hash_token(token), now)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(not_found)?;
    // The owner's *current* grants apply, so access changes take effect at once.
    let (_policy, allowed) = crate::auth_extractor::resolve_catalog_access(&state, user_id)
        .await
        .map_err(|_| not_found())?;
    let today = now.date_naive();
    let response = build_calendar(
        &state,
        allowed.as_deref(),
        today - ChronoDuration::days(FEED_DAYS_BACK),
        today + ChronoDuration::days(FEED_DAYS_FORWARD),
        None,
        None,
        CalendarOptions::default(),
    )
    .await;
    let body =
        crate::ics::render_calendar(&response.entries, &state.node_id, "Playarr releases", now);
    let mut res = body.into_response();
    let headers = res.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/calendar; charset=utf-8"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=900"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline; filename=\"playarr-releases.ics\""),
    );
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_streaming_user_with_library_allow,
        test_state,
    };
    use axum::body::Body;
    use axum::http::Request;
    use playarr_model::Sensitive;
    use serde_json::json;
    use std::time::Duration;
    use tower::ServiceExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// Fills the calendar cache from the registered (mock) sources, as the
    /// background refresher does in production.
    async fn prime(state: &crate::test_support::TestState) {
        let today = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        for instance in state.source_instances.all() {
            state
                .app
                .calendar_cache
                .refresh_instance(&instance, today)
                .await;
        }
    }

    fn instance(kind: SourceKind, name: &str, url: String) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind,
            name: name.to_string(),
            base_url: url,
            api_key_encrypted: Sensitive::new("k".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        }
    }

    async fn fake_sonarr(series_title: &str) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": 1, "seriesId": 1, "seasonNumber": 1, "episodeNumber": 1, "title": "Pilot",
                "airDate": "2026-10-10", "airDateUtc": "2026-10-10T20:00:00Z",
                "hasFile": false, "monitored": true,
                "series": {"id": 1, "title": series_title, "tvdbId": 77, "images": []}
            }])))
            .mount(&server)
            .await;
        server
    }

    async fn get(router: axum::Router, token: &str, uri: &str) -> (StatusCode, serde_json::Value) {
        let response = router
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header("Authorization", bearer_header(token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(json!(null)),
        )
    }

    #[tokio::test]
    async fn merges_instances_hides_source_health_and_respects_permissions() {
        let (router, state) = test_state().await;
        let a = fake_sonarr("Show").await;
        let b = fake_sonarr("Show").await;
        let sonarr_a = instance(SourceKind::Sonarr, "TV HD", a.uri());
        let sonarr_b = instance(SourceKind::Sonarr, "TV 4K", b.uri());
        let down = instance(SourceKind::Radarr, "Movies", "http://127.0.0.1:1".into());
        for i in [&sonarr_a, &sonarr_b, &down] {
            state.source_instances.upsert(i.clone());
        }
        prime(&state).await;

        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let uri = "/api/v1/calendar?start=2026-10-01&end=2026-10-31";
        let (status, body) = get(router.clone(), &token, uri).await;
        assert_eq!(status, StatusCode::OK);
        let entries = body["entries"].as_array().unwrap();
        assert_eq!(
            entries.len(),
            1,
            "same tvdb episode on two instances merges"
        );
        assert_eq!(entries[0]["sources"].as_array().unwrap().len(), 2);
        assert_eq!(entries[0]["title"], "Show");
        let sources = body["sources"].as_array().unwrap();
        assert_eq!(sources.len(), 3);
        // A dead source is never reported to users: no status, no error.
        let radarr = sources.iter().find(|s| s["name"] == "Movies").unwrap();
        assert_eq!(radarr["status"], "ok");
        assert!(radarr.get("error").is_none());

        // A restricted user sees only the library they were granted.
        let user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user, vec![sonarr_a.id]).await;
        let token = mint_access_token(&state, user);
        let (status, body) = get(router.clone(), &token, uri).await;
        assert_eq!(status, StatusCode::OK);
        let entries = body["entries"].as_array().unwrap();
        assert_eq!(entries[0]["sources"].as_array().unwrap().len(), 1);
        assert_eq!(body["sources"].as_array().unwrap().len(), 1);
        assert_eq!(body["sources"][0]["name"], "Series");
        assert_eq!(body["sources"][0]["display_label"], "Series");
    }

    #[tokio::test]
    async fn user_calendar_never_shows_provider_named_instances() {
        let (router, state) = test_state().await;
        let a = fake_sonarr("Show").await;
        let b = fake_sonarr("Show").await;
        let mut first = instance(SourceKind::Sonarr, "Sonarr", a.uri());
        first.priority = 0;
        let mut second = instance(SourceKind::Sonarr, "Sonarr 4K", b.uri());
        second.priority = 1;
        let movies = instance(SourceKind::Radarr, "Radarr 4K", "http://127.0.0.1:1".into());
        for i in [&first, &second, &movies] {
            state.source_instances.upsert(i.clone());
        }
        prime(&state).await;
        let user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user, vec![first.id, second.id, movies.id])
            .await;
        let token = mint_access_token(&state, user);
        let (status, body) = get(
            router,
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        // `kind` / `source_kind` are machine values for clients; every displayable
        // string must be free of provider names.
        let mut shown = Vec::new();
        for s in body["sources"].as_array().unwrap() {
            shown.push(s["name"].clone());
            shown.push(s["display_label"].clone());
        }
        for e in body["entries"].as_array().unwrap() {
            for s in e["sources"].as_array().unwrap() {
                shown.push(s["source_name"].clone());
                shown.push(s["display_label"].clone());
            }
        }
        let text = serde_json::Value::Array(shown).to_string().to_lowercase();
        for name in ["sonarr", "radarr"] {
            assert!(!text.contains(name), "{name} leaked: {text}");
        }
        let labels: Vec<&str> = body["sources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["display_label"].as_str().unwrap())
            .collect();
        assert_eq!(labels, ["Movies", "Series", "Series 2"]);
    }

    #[tokio::test]
    async fn requests_never_wait_on_a_slow_source() {
        let (router, state) = test_state().await;
        let slow = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_secs(20))
                    .set_body_json(json!([])),
            )
            .mount(&slow)
            .await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", slow.uri()));
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let started = std::time::Instant::now();
        let (status, body) = get(
            router,
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(body["entries"].as_array().unwrap().len(), 0);
        assert_eq!(body["sources"][0]["status"], "ok");
    }

    #[tokio::test]
    async fn rejects_oversized_or_inverted_ranges_and_bad_kinds() {
        let (router, state) = test_state().await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        for uri in [
            "/api/v1/calendar?start=2026-01-01&end=2026-12-31",
            "/api/v1/calendar?start=2026-10-10&end=2026-10-01",
            "/api/v1/calendar?kind=podcast",
        ] {
            let (status, _) = get(router.clone(), &token, uri).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        }
    }

    #[tokio::test]
    async fn requires_authentication() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/calendar")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn kind_filter_and_work_join() {
        let (router, state) = test_state().await;
        let server = fake_sonarr("Show").await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", server.uri()));
        prime(&state).await;
        let work_id = crate::test_support::seed_series_with_tvdb(&state, "Show", "77").await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let (_, body) = get(
            router.clone(),
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31&kind=episode",
        )
        .await;
        assert_eq!(body["entries"][0]["work_id"], work_id.to_string());
        let (_, body) = get(
            router,
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31&kind=movie",
        )
        .await;
        assert!(body["entries"].as_array().unwrap().is_empty());
    }

    async fn send(
        router: axum::Router,
        method: &str,
        uri: &str,
        token: Option<&str>,
    ) -> (StatusCode, HeaderMap, Vec<u8>) {
        let mut req = Request::builder().method(method).uri(uri);
        if let Some(t) = token {
            req = req.header("Authorization", bearer_header(t));
        }
        let response = router
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec();
        (status, headers, bytes)
    }

    fn feed_path(created: &serde_json::Value) -> String {
        format!(
            "/api/v1/calendar/feed/{}.ics",
            created["token"].as_str().unwrap()
        )
    }

    #[tokio::test]
    async fn feed_token_lifecycle_rotation_and_revocation() {
        let (router, state) = test_state().await;
        let server = fake_sonarr_today().await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", server.uri()));
        prime(&state).await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);

        let (status, _, body) =
            send(router.clone(), "GET", "/api/v1/calendar/feed", Some(&token)).await;
        assert_eq!(status, StatusCode::OK);
        let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status_json["active"], false);

        let (status, _, body) = send(
            router.clone(),
            "POST",
            "/api/v1/calendar/feed",
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let first: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(first["url"]
            .as_str()
            .unwrap()
            .ends_with(&format!("{}.ics", first["token"].as_str().unwrap())));

        // The feed needs no Authorization header, only the token.
        let (status, headers, body) = send(router.clone(), "GET", &feed_path(&first), None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(headers[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/calendar"));
        let ics = String::from_utf8(body).unwrap();
        assert!(ics.contains("BEGIN:VEVENT"), "{ics}");
        assert!(ics.contains("SUMMARY:Morning Programme S01E01: Pilot"));

        let (_, _, body) = send(router.clone(), "GET", "/api/v1/calendar/feed", Some(&token)).await;
        let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status_json["active"], true);
        assert!(status_json["last_used_at"].is_string());
        assert!(!String::from_utf8_lossy(&body).contains(first["token"].as_str().unwrap()));

        // Regenerating revokes the old URL.
        let (_, _, body) = send(
            router.clone(),
            "POST",
            "/api/v1/calendar/feed?rotate=true",
            Some(&token),
        )
        .await;
        let second: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_ne!(first["token"], second["token"]);
        assert_eq!(
            send(router.clone(), "GET", &feed_path(&first), None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            send(router.clone(), "GET", &feed_path(&second), None)
                .await
                .0,
            StatusCode::OK
        );

        // Revoking stops the feed; revoking again is harmless.
        assert_eq!(
            send(
                router.clone(),
                "DELETE",
                "/api/v1/calendar/feed",
                Some(&token)
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            send(router.clone(), "GET", &feed_path(&second), None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            send(
                router.clone(),
                "DELETE",
                "/api/v1/calendar/feed",
                Some(&token)
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
    }

    async fn fake_sonarr_two_episodes_one_day() -> MockServer {
        let server = MockServer::start().await;
        let series = json!({"id": 1, "title": "Show", "tvdbId": 77, "images": []});
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"id": 1, "seriesId": 1, "seasonNumber": 1, "episodeNumber": 2, "title": "Two",
                 "airDate": "2026-10-10", "airDateUtc": "2026-10-10T20:00:00Z",
                 "hasFile": true, "monitored": true, "series": series},
                {"id": 2, "seriesId": 1, "seasonNumber": 1, "episodeNumber": 1, "title": "One",
                 "airDate": "2026-10-10", "airDateUtc": "2026-10-10T20:00:00Z",
                 "hasFile": false, "monitored": true, "series": series},
                {"id": 3, "seriesId": 1, "seasonNumber": 1, "episodeNumber": 3, "title": "Three",
                 "airDate": "2026-10-11", "airDateUtc": "2026-10-11T20:00:00Z",
                 "hasFile": false, "monitored": false, "series": series}
            ])))
            .mount(&server)
            .await;
        server
    }

    fn actions_of(entry: &serde_json::Value) -> Vec<(String, bool)> {
        entry["actions"]
            .as_array()
            .map(|list| {
                list.iter()
                    .map(|a| {
                        (
                            a["action"].as_str().unwrap().to_string(),
                            a["enabled"].as_bool().unwrap(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn entries_carry_server_computed_actions_for_the_caller() {
        let (router, state) = test_state().await;
        let server = fake_sonarr("Show").await;
        let mut sonarr = instance(SourceKind::Sonarr, "TV", server.uri());
        state.source_instances.upsert(sonarr.clone());
        prime(&state).await;
        let uri = "/api/v1/calendar?start=2026-10-01&end=2026-10-31";

        // No request provider configured: request is listed, disabled, with a reason.
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let admin_token = mint_access_token(&state, admin);
        let (_, body) = get(router.clone(), &admin_token, uri).await;
        let entry = &body["entries"][0];
        assert_eq!(entry["snapshot"]["kind"], "series");
        assert_eq!(entry["snapshot"]["external_refs"][0]["external_id"], "77");
        let request = entry["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["action"] == "request")
            .unwrap();
        assert_eq!(request["enabled"], false);
        assert!(request["reason"].as_str().unwrap().len() > 3);

        // With a default root folder and quality profile the admin may request;
        // a user without `can_request` sees the action disabled, and why.
        sonarr.default_root_folder_id = Some("/tv".to_string());
        sonarr.default_quality_profile_id = Some(4);
        state.source_instances.upsert(sonarr.clone());
        prime(&state).await;
        let (_, body) = get(router.clone(), &admin_token, uri).await;
        assert!(actions_of(&body["entries"][0]).contains(&("request".to_string(), true)));
        assert!(actions_of(&body["entries"][0]).contains(&("watchlist".to_string(), true)));
        assert!(!actions_of(&body["entries"][0])
            .iter()
            .any(|a| a.0 == "open"));

        let user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user, vec![sonarr.id]).await;
        let (_, body) = get(router.clone(), &mint_access_token(&state, user), uri).await;
        let request = body["entries"][0]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["action"] == "request")
            .unwrap()
            .clone();
        assert_eq!(request["enabled"], false);
        assert!(request["reason"].as_str().unwrap().contains("not allowed"));

        // A series that is in the library is opened, never requested.
        let work_id = crate::test_support::seed_series_with_tvdb(&state, "Show", "77").await;
        let (_, body) = get(router.clone(), &admin_token, uri).await;
        let actions = actions_of(&body["entries"][0]);
        assert!(actions.contains(&("open".to_string(), true)), "{actions:?}");
        assert!(!actions.iter().any(|a| a.0 == "request"));
        let open = body["entries"][0]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["action"] == "open")
            .unwrap()
            .clone();
        assert_eq!(open["work_id"], work_id.to_string());
    }

    /// Like [`get`], also returning the `x-calendar-cache` header.
    async fn get_cached(
        router: &axum::Router,
        token: &str,
        uri: &str,
    ) -> (serde_json::Value, String) {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header("Authorization", bearer_header(token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let outcome = response.headers()["x-calendar-cache"]
            .to_str()
            .unwrap()
            .to_string();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (serde_json::from_slice(&bytes).unwrap(), outcome)
    }

    fn request_active(body: &serde_json::Value) -> bool {
        body["entries"][0]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["action"] == "request" && a["active"] == true)
    }

    #[tokio::test]
    async fn a_new_request_rebuilds_the_cached_calendar_and_shows_as_active() {
        let (router, state) = test_state().await;
        let server = fake_sonarr("Show").await;
        let sonarr = instance(SourceKind::Sonarr, "TV", server.uri());
        state.source_instances.upsert(sonarr.clone());
        prime(&state).await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let uri = "/api/v1/calendar?start=2026-10-01&end=2026-10-31";

        let (body, _) = get_cached(&router, &token, uri).await;
        assert!(!request_active(&body));

        // The request goes through the repository the request endpoints use.
        state
            .app
            .request_sync
            .record_direct(
                &crate::request_sync::NewTitle {
                    kind: playarr_model::discovery::DiscoveryKind::Series,
                    title: "Show".into(),
                    year: Some(2026),
                    tmdb_id: None,
                    tvdb_id: Some(77),
                    imdb_id: None,
                    poster_url: None,
                    seasons: vec![],
                    user: None,
                    requester_label: None,
                },
                sonarr.id,
            )
            .await
            .unwrap();
        let (body, outcome) = get_cached(&router, &token, uri).await;
        assert_eq!(outcome, "miss", "a request change rebuilds the calendar");
        assert!(request_active(&body), "{body}");
    }

    /// A read that fails while building must not be cached: the response is
    /// served (without Play/Open it could not compute) but the next request
    /// builds again and gets them back.
    #[tokio::test]
    async fn a_build_with_a_failed_read_is_not_cached() {
        let (router, state) = test_state().await;
        let server = fake_sonarr("Show").await;
        let sonarr = instance(SourceKind::Sonarr, "TV", server.uri());
        state.source_instances.upsert(sonarr.clone());
        prime(&state).await;
        crate::test_support::seed_series_with_tvdb(&state, "Show", "77").await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let open = |body: &serde_json::Value| {
            actions_of(&body["entries"][0])
                .iter()
                .any(|a| a.0 == "open")
        };

        for (end, table) in [(31, "media_files"), (30, "media_requests")] {
            let uri = format!("/api/v1/calendar?start=2026-10-01&end=2026-10-{end}");
            sqlx::query(&format!("ALTER TABLE {table} RENAME TO {table}_away"))
                .execute(&state.pool)
                .await
                .unwrap();
            let (_, first) = get_cached(&router, &token, &uri).await;
            let (_, second) = get_cached(&router, &token, &uri).await;
            assert_eq!(first, "miss");
            assert_eq!(
                second, "miss",
                "{table}: a failed build is never served from the cache"
            );
            sqlx::query(&format!("ALTER TABLE {table}_away RENAME TO {table}"))
                .execute(&state.pool)
                .await
                .unwrap();
            let (body, _) = get_cached(&router, &token, &uri).await;
            assert!(open(&body), "{table}: the next build is whole again");
        }
    }

    #[tokio::test]
    async fn watchlist_state_is_reflected_in_the_watchlist_action() {
        let (router, state) = test_state().await;
        let server = fake_sonarr("Show").await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", server.uri()));
        prime(&state).await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let uri = "/api/v1/calendar?start=2026-10-01&end=2026-10-31";
        let (_, body) = get(router.clone(), &token, uri).await;
        let snapshot = body["entries"][0]["snapshot"].clone();
        let watch = |body: &serde_json::Value| {
            body["entries"][0]["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["action"] == "watchlist")
                .unwrap()["active"]
                .as_bool()
                .unwrap()
        };
        assert!(!watch(&body));
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/watchlist")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(snapshot.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(response.status().is_success(), "{}", response.status());
        let (_, body) = get(router, &token, uri).await;
        assert!(watch(&body));
    }

    #[tokio::test]
    async fn group_series_day_folds_same_day_episodes_into_one_entry() {
        let (router, state) = test_state().await;
        let server = fake_sonarr_two_episodes_one_day().await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", server.uri()));
        prime(&state).await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let base = "/api/v1/calendar?start=2026-10-01&end=2026-10-31";

        let (_, plain) = get(router.clone(), &token, base).await;
        assert_eq!(plain["entries"].as_array().unwrap().len(), 3);
        assert!(plain["entries"][0].get("members").is_none());

        let (status, body) = get(router.clone(), &token, &format!("{base}&group=series_day")).await;
        assert_eq!(status, StatusCode::OK);
        let entries = body["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2, "{body}");
        let group = &entries[0];
        let members = group["members"].as_array().unwrap();
        assert_eq!(members.len(), 2);
        assert_eq!(members[0]["episode_number"], 1);
        assert_eq!(members[1]["episode_number"], 2);
        assert_eq!(group["episode_number"], 1);
        assert_eq!(
            group["has_file"], false,
            "in library only when every episode is"
        );
        assert!(group["actions"].as_array().unwrap().len() >= 2);
        assert!(
            entries[1].get("members").is_none(),
            "a lone episode stays single"
        );

        let (status, _) = get(router, &token, &format!("{base}&group=week")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    /// Seeds a library series (tvdb 77) with season 1: episodes 1 and 2 have
    /// their own files, episode 3 is known but has no file, episode 4 is not
    /// in the library at all. Returns the work id and the files of 1 and 2.
    async fn seed_series_with_files(state: &crate::test_support::TestState) -> (Uuid, Uuid, Uuid) {
        let work = crate::test_support::seed_series_with_tvdb(state, "Show", "77").await;
        let season = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO seasons (id, series_work_id, season_number, title, overview, monitored, availability) \
             VALUES (?, ?, 1, NULL, NULL, 1, 'available')",
        )
        .bind(season.to_string())
        .bind(work.to_string())
        .execute(&state.pool)
        .await
        .unwrap();
        let mut files = Vec::new();
        for number in 1..=3 {
            let episode = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO episodes (id, season_id, episode_number, title, overview, images, air_date, runtime_minutes, monitored, availability) \
                 VALUES (?, ?, ?, ?, NULL, '[]', NULL, 30, 1, 'available')",
            )
            .bind(episode.to_string())
            .bind(season.to_string())
            .bind(number)
            .bind(format!("Episode {number}"))
            .execute(&state.pool)
            .await
            .unwrap();
            if number <= 2 {
                let file = crate::test_support::seed_media_file(
                    state,
                    work,
                    playarr_model::media::LeafRef::Episode(episode),
                    Uuid::new_v4(),
                )
                .await;
                files.push(file);
            }
        }
        (work, files[0], files[1])
    }

    async fn fake_sonarr_file_states() -> MockServer {
        let server = MockServer::start().await;
        let series = json!({"id": 1, "title": "Show", "tvdbId": 77, "images": []});
        let episode = |id: i64, number: i64, day: &str, has_file: bool| {
            json!({"id": id, "seriesId": 1, "seasonNumber": 1, "episodeNumber": number,
                   "title": format!("E{number}"), "airDate": day,
                   "airDateUtc": format!("{day}T20:00:00Z"),
                   "hasFile": has_file, "monitored": true, "series": series})
        };
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                episode(1, 1, "2026-10-01", true),
                episode(2, 2, "2026-10-02", true),
                episode(3, 3, "2026-10-03", false),
                episode(4, 4, "2026-10-20", false),
            ])))
            .mount(&server)
            .await;
        server
    }

    fn entry_for_episode(body: &serde_json::Value, number: i64) -> &serde_json::Value {
        body["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["episode_number"] == number)
            .unwrap_or_else(|| panic!("no entry for episode {number}: {body}"))
    }

    fn action<'a>(entry: &'a serde_json::Value, kind: &str) -> Option<&'a serde_json::Value> {
        entry["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["action"] == kind)
    }

    #[tokio::test]
    async fn play_is_offered_only_for_an_episode_with_its_own_file() {
        let (router, state) = test_state().await;
        let server = fake_sonarr_file_states().await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", server.uri()));
        prime(&state).await;
        let (work, file1, file2) = seed_series_with_files(&state).await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let (status, body) = get(
            router,
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31",
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        // Aired, with a file: Play carries that episode's own file.
        let one = action(entry_for_episode(&body, 1), "play").expect("play for episode 1");
        assert_eq!(one["enabled"], true);
        assert_eq!(one["media_file_id"], file1.to_string());
        let two = action(entry_for_episode(&body, 2), "play").expect("play for episode 2");
        assert_eq!(two["media_file_id"], file2.to_string());

        // Aired, known to the library, but no file: never Play.
        let three = entry_for_episode(&body, 3);
        assert!(action(three, "play").is_none(), "{three}");
        assert!(action(three, "resume").is_none(), "{three}");
        assert_eq!(action(three, "open").unwrap()["work_id"], work.to_string());
        assert!(action(three, "watchlist").is_some());

        // Unaired, not in the library as an episode: never Play, and the
        // action never points at another episode's file.
        let four = entry_for_episode(&body, 4);
        assert!(action(four, "play").is_none(), "{four}");
        assert!(four["actions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["media_file_id"].is_null()));
        assert!(action(four, "open").is_some());
        assert!(action(four, "watchlist").is_some());
    }

    #[tokio::test]
    async fn an_unaired_episode_of_a_series_not_in_the_library_never_plays() {
        let (router, state) = test_state().await;
        let server = fake_sonarr_file_states().await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", server.uri()));
        prime(&state).await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let (_, body) = get(
            router,
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31",
        )
        .await;
        for entry in body["entries"].as_array().unwrap() {
            assert!(action(entry, "play").is_none(), "{entry}");
            assert!(action(entry, "request").is_some(), "{entry}");
        }
    }

    #[tokio::test]
    async fn grouped_members_do_not_borrow_another_episodes_file() {
        let (router, state) = test_state().await;
        let server = MockServer::start().await;
        let series = json!({"id": 1, "title": "Show", "tvdbId": 77, "images": []});
        let episode = |id: i64, number: i64, day: &str| {
            json!({"id": id, "seriesId": 1, "seasonNumber": 1, "episodeNumber": number,
                   "title": format!("E{number}"), "airDate": day,
                   "airDateUtc": format!("{day}T20:00:00Z"),
                   "hasFile": false, "monitored": true, "series": series})
        };
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                // Day one folds episodes 1 and 2 (the first has a file).
                episode(1, 1, "2026-10-01"),
                episode(2, 2, "2026-10-01"),
                // Day two folds episodes 3 (no file) and 4 (not in the library).
                episode(3, 3, "2026-10-20"),
                episode(4, 4, "2026-10-20"),
            ])))
            .mount(&server)
            .await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", server.uri()));
        prime(&state).await;
        let (_, file1, _) = seed_series_with_files(&state).await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let (_, body) = get(
            router,
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31&group=series_day",
        )
        .await;
        let entries = body["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2, "{body}");
        assert_eq!(entries[0]["members"].as_array().unwrap().len(), 2);
        let play = action(&entries[0], "play").expect("the first episode has a file");
        assert_eq!(play["media_file_id"], file1.to_string());
        assert_eq!(entries[1]["members"].as_array().unwrap().len(), 2);
        assert!(action(&entries[1], "play").is_none(), "{}", entries[1]);
        assert!(action(&entries[1], "resume").is_none(), "{}", entries[1]);
        assert!(action(&entries[1], "open").is_some());
    }

    #[tokio::test]
    async fn feed_link_is_returned_again_until_rotated_or_revoked() {
        let (router, state) = test_state().await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let post = |uri: &'static str| {
            let router = router.clone();
            let token = token.clone();
            async move {
                let (status, _, body) = send(router, "POST", uri, Some(&token)).await;
                (
                    status,
                    serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
                )
            }
        };
        let (status, first) = post("/api/v1/calendar/feed").await;
        assert_eq!(status, StatusCode::CREATED);
        let (_, _, body) = send(router.clone(), "GET", "/api/v1/calendar/feed", Some(&token)).await;
        let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status_json["link_available"], true);
        let (status, again) = post("/api/v1/calendar/feed").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(first["token"], again["token"]);
        assert_eq!(first["url"], again["url"]);

        // The token is not stored in the clear.
        let stored = state
            .app
            .calendar_feed_token_repo
            .active_for_user(admin)
            .await
            .unwrap()
            .unwrap();
        let sealed = stored.token_encrypted.unwrap();
        assert!(!sealed.contains(first["token"].as_str().unwrap()));

        let (status, rotated) = post("/api/v1/calendar/feed?rotate=true").await;
        assert_eq!(status, StatusCode::CREATED);
        assert_ne!(first["token"], rotated["token"]);
        assert_eq!(
            send(router.clone(), "GET", &feed_path(&first), None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        let (status, same) = post("/api/v1/calendar/feed").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(rotated["token"], same["token"]);

        // After revocation the next call creates a fresh link.
        send(
            router.clone(),
            "DELETE",
            "/api/v1/calendar/feed",
            Some(&token),
        )
        .await;
        let (status, fresh) = post("/api/v1/calendar/feed").await;
        assert_eq!(status, StatusCode::CREATED);
        assert_ne!(fresh["token"], same["token"]);
    }

    #[tokio::test]
    async fn legacy_unsealed_or_foreign_tokens_are_replaced_not_shown() {
        let (router, state) = test_state().await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        // A row from before the sealed column existed.
        state
            .app
            .calendar_feed_token_repo
            .rotate(admin, &hash_token("legacy"), None, Utc::now())
            .await
            .unwrap();
        let (status, _, body) = send(
            router.clone(),
            "POST",
            "/api/v1/calendar/feed",
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let created: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(created["token"].as_str().unwrap().len(), FEED_TOKEN_LEN);
        // Garbage in the sealed column is treated the same way.
        state
            .app
            .calendar_feed_token_repo
            .rotate(admin, &hash_token("garbage"), Some("v1:AAAA"), Utc::now())
            .await
            .unwrap();
        let (status, _, _) = send(router, "POST", "/api/v1/calendar/feed", Some(&token)).await;
        assert_eq!(status, StatusCode::CREATED);
    }

    #[test]
    fn sealing_round_trips_and_rejects_other_keys() {
        let cipher = ChaCha20Poly1305::new(&[7u8; 32].into());
        let token = new_token();
        let sealed = seal_token(&cipher, &token).unwrap();
        assert_ne!(sealed, token);
        assert_eq!(
            open_token(&cipher, &sealed).as_deref(),
            Some(token.as_str())
        );
        let other = ChaCha20Poly1305::new(&[8u8; 32].into());
        assert_eq!(open_token(&other, &sealed), None);
        assert_eq!(open_token(&cipher, "not-sealed"), None);
    }

    #[test]
    fn request_base_uses_the_uri_authority_for_http2_requests() {
        let h2: Uri = "https://server.example:8484/api/v1/calendar/feed"
            .parse()
            .unwrap();
        assert_eq!(
            request_base(&HeaderMap::new(), &h2),
            "https://server.example:8484"
        );
        let mut proxied = HeaderMap::new();
        proxied.insert("x-forwarded-proto", "https".parse().unwrap());
        proxied.insert("x-forwarded-host", "public.example".parse().unwrap());
        let origin_form: Uri = "/api/v1/calendar/feed".parse().unwrap();
        assert_eq!(
            request_base(&proxied, &origin_form),
            "https://public.example"
        );
        let mut plain = HeaderMap::new();
        plain.insert("host", "10.0.0.1:8484".parse().unwrap());
        assert_eq!(request_base(&plain, &origin_form), "http://10.0.0.1:8484");
    }

    #[tokio::test]
    async fn feed_rejects_malformed_tokens_and_unauthenticated_management() {
        let (router, _state) = test_state().await;
        for uri in [
            "/api/v1/calendar/feed/not-a-token.ics",
            "/api/v1/calendar/feed/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ics",
            "/api/v1/calendar/feed/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ] {
            assert_eq!(
                send(router.clone(), "GET", uri, None).await.0,
                StatusCode::NOT_FOUND,
                "{uri}"
            );
        }
        assert_eq!(
            send(router.clone(), "POST", "/api/v1/calendar/feed", None)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            send(router, "DELETE", "/api/v1/calendar/feed", None)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn feed_is_scoped_to_the_owners_current_libraries() {
        let (router, state) = test_state().await;
        let hd = fake_sonarr_today().await;
        let uhd = fake_sonarr_today().await;
        let hd_instance = instance(SourceKind::Sonarr, "TV HD", hd.uri());
        let uhd_instance = instance(SourceKind::Sonarr, "TV 4K", uhd.uri());
        state.source_instances.upsert(hd_instance.clone());
        prime(&state).await;
        state.source_instances.upsert(uhd_instance);
        prime(&state).await;
        let user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user, vec![hd_instance.id]).await;
        let token = mint_access_token(&state, user);
        let (_, _, body) = send(
            router.clone(),
            "POST",
            "/api/v1/calendar/feed",
            Some(&token),
        )
        .await;
        let created: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let (_, _, body) = send(router, "GET", &feed_path(&created), None).await;
        let ics = String::from_utf8(body).unwrap();
        assert!(ics.contains("Source: Series"), "{ics}");
        assert!(!ics.contains("TV HD"), "instance names stay admin-only");
        assert!(
            !ics.contains("TV 4K"),
            "restricted user must not see the other library"
        );
    }

    async fn fake_sonarr_today() -> MockServer {
        let server = MockServer::start().await;
        let now = Utc::now();
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": 1, "seriesId": 1, "seasonNumber": 1, "episodeNumber": 1, "title": "Pilot",
                "airDate": now.format("%Y-%m-%d").to_string(),
                "airDateUtc": now.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
                "hasFile": false, "monitored": true,
                "series": {"id": 1, "title": "Morning Programme", "tvdbId": 99, "images": []}
            }])))
            .mount(&server)
            .await;
        server
    }

    #[tokio::test]
    async fn webhook_events_drive_the_availability_lag_and_calendar_entries() {
        let (router, state) = test_state().await;
        let server = fake_sonarr("Show").await; // tvdb 77, aired 2026-10-10 in the fixture
        let sonarr = instance(SourceKind::Sonarr, "TV", server.uri());
        state.source_instances.upsert(sonarr.clone());
        prime(&state).await;
        let work_id = crate::test_support::seed_series_with_tvdb(&state, "Show", "77").await;

        let now = Utc::now();
        let air = |hours_ago: i64| {
            (now - ChronoDuration::hours(hours_ago))
                .format("%Y-%m-%dT%H:%M:%SZ")
                .to_string()
        };
        let payload = json!({
            "eventType": "Download", "isUpgrade": false,
            "series": {"id": 1, "tvdbId": 77},
            "episodes": [
                {"id": 1, "seasonNumber": 1, "episodeNumber": 1, "airDateUtc": air(2)},
                {"id": 2, "seasonNumber": 1, "episodeNumber": 2, "airDateUtc": air(24 * 60)},
                {"id": 3, "seasonNumber": 1, "episodeNumber": 3}
            ]
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/webhooks/{}", sonarr.id))
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);

        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let (status, body) = get(
            router.clone(),
            &token,
            &format!("/api/v1/catalog/{work_id}/availability-lag"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["sample_count"], 1);
        assert_eq!(
            body["backfill_count"], 1,
            "the 60-day-old episode is a backfill"
        );
        assert_eq!(
            body["unknown_count"], 1,
            "no air date is explicit, not zero"
        );
        let average = body["average_seconds"].as_i64().unwrap();
        assert!((7200..7300).contains(&average), "average {average}");

        let (_, body) = get(
            router,
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31",
        )
        .await;
        let lag = body["entries"][0]["average_lag_seconds"].as_i64().unwrap();
        assert!((7200..7300).contains(&lag));
    }

    #[tokio::test]
    async fn availability_lag_has_no_average_without_events() {
        let (router, state) = test_state().await;
        let work_id = crate::test_support::seed_series_with_tvdb(&state, "Quiet", "5").await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let (status, body) = get(
            router.clone(),
            &token,
            &format!("/api/v1/catalog/{work_id}/availability-lag"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["average_seconds"].is_null());
        let (status, _) = get(
            router,
            &token,
            &format!("/api/v1/catalog/{}/availability-lag", Uuid::new_v4()),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}
