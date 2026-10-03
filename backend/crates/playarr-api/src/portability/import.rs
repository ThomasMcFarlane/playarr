//! Import planning and application. Planning never writes; applying always
//! writes as the authenticated user and only through the normal repositories.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use playarr_model::discovery::{identity_key, WatchlistItem};
use playarr_model::{ExternalRef, Playlist, PlaylistMediaType, WatchProgress, WatchState};
use playarr_portability::{ItemRef, UnmatchedRecord, UserDataPackage, WatchRecord};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::resolve::{discovery_kind, parse_provider_key, LeafMatch, Resolver, WorkMatch};
use crate::AppState;

const MAX_PLAYLISTS: usize = 1_000;
const MAX_NAME_CHARS: usize = 200;
const MAX_MS: u64 = 1_000_000_000;
const SAMPLE_CAP: usize = 100;
const ADD_SAMPLE_CAP: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProgressConflicts {
    /// Apply an incoming record only when it is newer than what exists.
    #[default]
    Newest,
    /// Never change progress that already exists and differs.
    KeepExisting,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ImportOptions {
    pub include_preferences: bool,
    pub progress_conflicts: ProgressConflicts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WatchAction {
    Add,
    Update,
    Unchanged,
    ConflictKept,
}

#[derive(Debug, Clone)]
struct WatchPlan {
    title: String,
    media_file_id: Uuid,
    work_id: Uuid,
    state: WatchState,
    position_ms: u64,
    duration_ms: u64,
    updated_at: DateTime<Utc>,
    action: WatchAction,
}

#[derive(Debug, Clone)]
struct PlaylistPlan {
    package_id: Uuid,
    parent_package_id: Option<Uuid>,
    name: String,
    media_type: PlaylistMediaType,
    existing: Option<Uuid>,
    new_items: Vec<(Uuid, Option<Uuid>)>,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct SectionSummary {
    pub total: usize,
    pub will_add: usize,
    pub will_update: usize,
    pub already_present: usize,
    /// Existing progress differs and was not replaced under the chosen policy.
    pub conflicts_kept: usize,
    pub unmatched: usize,
    pub ambiguous: usize,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct WatchlistSummary {
    pub total: usize,
    pub will_add: usize,
    pub already_present: usize,
    /// Records that are invalid or of a kind this server does not know.
    pub unmatched: usize,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct PlaylistSummary {
    pub total: usize,
    pub new: usize,
    pub existing: usize,
    pub items_total: usize,
    pub items_to_add: usize,
    pub items_already_present: usize,
    pub items_unmatched: usize,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct ImportSummary {
    pub watch_progress: SectionSummary,
    pub playlists: PlaylistSummary,
    pub watchlist: WatchlistSummary,
    /// The audio language that would be set, when preferences are included
    /// and it differs from the current one.
    pub preferred_audio_language_change: Option<String>,
    /// Per-file playback choices are specific to one server's files and are
    /// reported but never applied.
    pub playback_preferences_not_applied: usize,
    pub unmatched_total: usize,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ImportSample {
    /// `watch_progress` or `playlist_item`.
    pub section: String,
    pub title: String,
    /// `add`, `update`, `unchanged`, `conflict_kept`, `no_match`, `ambiguous`,
    /// `unsupported_kind` or `invalid_record`.
    pub outcome: String,
    pub playlist: Option<String>,
    pub candidates: Vec<String>,
}

pub struct Plan {
    watch: Vec<WatchPlan>,
    playlists: Vec<PlaylistPlan>,
    watchlist: Vec<WatchlistItem>,
    language: Option<String>,
    pub unmatched: Vec<UnmatchedRecord>,
    pub summary: ImportSummary,
    pub samples: Vec<ImportSample>,
}

fn label(item: &ItemRef) -> String {
    match item.kind.as_str() {
        "episode" => format!(
            "{} S{:02}E{:02}",
            item.title,
            item.season_number.unwrap_or(0),
            item.episode_number.unwrap_or(0)
        ),
        "track" => format!(
            "{} - {}",
            item.title,
            item.track_title.as_deref().unwrap_or("?")
        ),
        "book" => format!(
            "{} - {}",
            item.title,
            item.book_title.as_deref().unwrap_or("?")
        ),
        _ => match item.year {
            Some(year) => format!("{} ({year})", item.title),
            None => item.title.clone(),
        },
    }
}

fn valid_language(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 35
        && tag.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Moves records from an "unmatched" package back into the regular
/// sections so a package produced by an earlier import can be retried.
fn fold_unmatched(package: &mut UserDataPackage) {
    for record in std::mem::take(&mut package.unmatched) {
        match record.section.as_str() {
            "watch_progress" => {
                if let Ok(watch) = serde_json::from_value::<WatchRecord>(record.record) {
                    package.watch_progress.push(watch);
                }
            }
            "playlist_item" => {
                let Some(name) = record.playlist_name else {
                    continue;
                };
                let media_type = record
                    .record
                    .get("media_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("video")
                    .to_owned();
                let Some(entry) = record
                    .record
                    .get("entry")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                else {
                    continue;
                };
                match package
                    .playlists
                    .iter_mut()
                    .find(|p| p.parent_id.is_none() && p.name == name && p.media_type == media_type)
                {
                    Some(playlist) => playlist.items.push(entry),
                    None => {
                        let now = Utc::now();
                        package
                            .playlists
                            .push(playlist_for(name, media_type, now, entry));
                    }
                }
            }
            "watchlist" => {
                if let Ok(entry) = serde_json::from_value(record.record) {
                    package.watchlist.push(entry);
                }
            }
            _ => {}
        }
    }
}

fn playlist_for(
    name: String,
    media_type: String,
    now: DateTime<Utc>,
    entry: playarr_portability::PlaylistEntry,
) -> playarr_portability::Playlist {
    playarr_portability::Playlist {
        id: Uuid::new_v4(),
        name,
        media_type,
        parent_id: None,
        created_at: now,
        updated_at: now,
        items: vec![entry],
    }
}

/// A playlist entry's resolved (work, track), or why it could not be placed.
type ItemOutcome = Result<(Uuid, Option<Uuid>), (&'static str, Vec<String>)>;

struct Sampler {
    samples: Vec<ImportSample>,
    adds: usize,
}

impl Sampler {
    fn push(&mut self, sample: ImportSample) {
        let routine = matches!(sample.outcome.as_str(), "add" | "update" | "unchanged");
        if routine {
            if self.adds >= ADD_SAMPLE_CAP {
                return;
            }
            self.adds += 1;
        }
        if self.samples.len() < SAMPLE_CAP {
            self.samples.push(sample);
        }
    }
}

/// Matches and compares everything in `package` for `user_id`; writes nothing.
pub async fn plan_import(
    state: &AppState,
    user_id: Uuid,
    allowed: Option<Vec<Uuid>>,
    mut package: UserDataPackage,
    options: ImportOptions,
) -> Result<Plan, crate::error::ApiError> {
    fold_unmatched(&mut package);
    let mut resolver = Resolver::new(state, allowed);
    let mut summary = ImportSummary {
        playback_preferences_not_applied: package.playback_preferences.len(),
        ..ImportSummary::default()
    };
    let mut unmatched = Vec::new();
    let mut sampler = Sampler {
        samples: Vec::new(),
        adds: 0,
    };
    let now = Utc::now();

    // ---- watch progress ---------------------------------------------------
    let mut by_file: HashMap<Uuid, WatchPlan> = HashMap::new();
    summary.watch_progress.total = package.watch_progress.len();
    for record in &package.watch_progress {
        let title = label(&record.item);
        let mut reject = |reason: &str, candidates: Vec<String>, summary: &mut ImportSummary| {
            if reason == "ambiguous" {
                summary.watch_progress.ambiguous += 1;
            } else {
                summary.watch_progress.unmatched += 1;
            }
            unmatched.push(UnmatchedRecord {
                section: "watch_progress".into(),
                reason: reason.into(),
                playlist_name: None,
                record: serde_json::to_value(record).unwrap_or_default(),
            });
            sampler.push(ImportSample {
                section: "watch_progress".into(),
                title: title.clone(),
                outcome: reason.into(),
                playlist: None,
                candidates,
            });
        };
        let state_value = match record.state.as_str() {
            "watched" => WatchState::Watched,
            "part_watched" if record.position_ms > 0 => WatchState::PartWatched,
            _ => {
                reject("invalid_record", vec![], &mut summary);
                continue;
            }
        };
        if record.position_ms > MAX_MS || record.duration_ms > MAX_MS {
            reject("invalid_record", vec![], &mut summary);
            continue;
        }
        if !matches!(
            record.item.kind.as_str(),
            "movie" | "episode" | "track" | "book"
        ) {
            reject("unsupported_kind", vec![], &mut summary);
            continue;
        }
        match resolver.match_leaf(&record.item).await {
            LeafMatch::Found {
                work_id,
                media_file_id: Some(media_file_id),
                ..
            } => {
                let plan = WatchPlan {
                    title: title.clone(),
                    media_file_id,
                    work_id,
                    state: state_value,
                    position_ms: record.position_ms,
                    duration_ms: record.duration_ms,
                    updated_at: record.updated_at.unwrap_or(now),
                    action: WatchAction::Add,
                };
                // Two records for one file: the newer one stands.
                match by_file.get(&media_file_id) {
                    Some(prior) if prior.updated_at >= plan.updated_at => {}
                    _ => {
                        by_file.insert(media_file_id, plan);
                    }
                }
            }
            LeafMatch::Found { .. } | LeafMatch::NoMatch => {
                reject("no_match", vec![], &mut summary)
            }
            LeafMatch::Ambiguous(candidates) => reject("ambiguous", candidates, &mut summary),
            LeafMatch::Unsupported => reject("unsupported_kind", vec![], &mut summary),
        }
    }
    let mut watch: Vec<WatchPlan> = by_file.into_values().collect();
    watch.sort_by_key(|plan| plan.media_file_id);
    for plan in &mut watch {
        let existing = state
            .watch_progress
            .get(user_id, plan.media_file_id)
            .await?
            .filter(|row| row.state != WatchState::Unseen);
        plan.action = match existing {
            None => WatchAction::Add,
            Some(row) if row.state == plan.state && row.position_ms == plan.position_ms => {
                WatchAction::Unchanged
            }
            Some(row) => match options.progress_conflicts {
                ProgressConflicts::Newest
                    if row
                        .updated_at
                        .is_none_or(|existing| plan.updated_at > existing) =>
                {
                    WatchAction::Update
                }
                _ => WatchAction::ConflictKept,
            },
        };
        let (counter, outcome) = match plan.action {
            WatchAction::Add => (&mut summary.watch_progress.will_add, "add"),
            WatchAction::Update => (&mut summary.watch_progress.will_update, "update"),
            WatchAction::Unchanged => (&mut summary.watch_progress.already_present, "unchanged"),
            WatchAction::ConflictKept => {
                (&mut summary.watch_progress.conflicts_kept, "conflict_kept")
            }
        };
        *counter += 1;
        let title = plan.title.clone();
        sampler.push(ImportSample {
            section: "watch_progress".into(),
            title,
            outcome: outcome.into(),
            playlist: None,
            candidates: vec![],
        });
    }

    // ---- playlists --------------------------------------------------------
    let existing_playlists: Vec<Playlist> = state
        .playlist_repo
        .list_visible_to_user(user_id)
        .await?
        .into_iter()
        .filter(|p| p.owner_user_id == Some(user_id))
        .collect();
    let mut order: Vec<usize> = Vec::new();
    let known: HashSet<Uuid> = package.playlists.iter().map(|p| p.id).collect();
    let mut placed: HashSet<Uuid> = HashSet::new();
    while order.len() < package.playlists.len() {
        let before = order.len();
        for (index, playlist) in package.playlists.iter().enumerate() {
            if placed.contains(&playlist.id) {
                continue;
            }
            let ready = match playlist.parent_id {
                Some(parent) if known.contains(&parent) && parent != playlist.id => {
                    placed.contains(&parent)
                }
                _ => true,
            };
            if ready {
                placed.insert(playlist.id);
                order.push(index);
            }
        }
        if order.len() == before {
            // A cycle: place the rest as top-level rather than loop forever.
            for (index, playlist) in package.playlists.iter().enumerate() {
                if placed.insert(playlist.id) {
                    order.push(index);
                }
            }
        }
    }

    // package playlist id -> Some(existing real id) | None (will be created)
    let mut resolved: HashMap<Uuid, Option<Uuid>> = HashMap::new();
    let mut plans: Vec<PlaylistPlan> = Vec::new();
    summary.playlists.total = package.playlists.len().min(MAX_PLAYLISTS);
    for &index in order.iter().take(MAX_PLAYLISTS) {
        let playlist = &package.playlists[index];
        let name = playlist
            .name
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let media_type = match playlist.media_type.as_str() {
            "audio" => Some(PlaylistMediaType::Audio),
            "video" | "" => Some(PlaylistMediaType::Video),
            _ => None,
        };
        summary.playlists.items_total += playlist.items.len();
        let (Some(media_type), true) = (
            media_type,
            !name.is_empty() && name.chars().count() <= MAX_NAME_CHARS,
        ) else {
            for entry in &playlist.items {
                summary.playlists.items_unmatched += 1;
                unmatched.push(UnmatchedRecord {
                    section: "playlist_item".into(),
                    reason: "invalid_record".into(),
                    playlist_name: Some(playlist.name.clone()),
                    record: serde_json::json!({"media_type": playlist.media_type, "entry": entry}),
                });
            }
            continue;
        };
        let parent_package_id = playlist
            .parent_id
            .filter(|p| known.contains(p) && *p != playlist.id);
        let parent_real: Option<Option<Uuid>> =
            parent_package_id.map(|p| resolved.get(&p).copied().flatten());
        let existing = match parent_real {
            // A parent that will be created means this one is new as well.
            Some(None) => None,
            other => existing_playlists
                .iter()
                .find(|e| {
                    e.name.to_lowercase() == name.to_lowercase()
                        && e.media_type == media_type
                        && e.parent_playlist_id == other.flatten()
                })
                .map(|e| e.id),
        };
        resolved.insert(playlist.id, existing);
        if existing.is_some() {
            summary.playlists.existing += 1;
        } else {
            summary.playlists.new += 1;
        }
        let mut present: HashSet<(Uuid, Option<Uuid>)> = HashSet::new();
        if let Some(id) = existing {
            for item in state.playlist_repo.list_items(id).await? {
                present.insert((item.work_id, item.track_id));
            }
        }
        let mut new_items = Vec::new();
        for entry in &playlist.items {
            let title = label(&entry.item);
            let outcome: ItemOutcome = match resolver.match_leaf(&entry.item).await {
                LeafMatch::Found {
                    work_id, track_id, ..
                } => match (media_type, entry.item.kind.as_str()) {
                    (PlaylistMediaType::Audio, "track") => track_id
                        .map(|t| (work_id, Some(t)))
                        .ok_or(("no_match", vec![])),
                    (PlaylistMediaType::Audio, "artist") => Ok((work_id, None)),
                    (PlaylistMediaType::Video, "movie" | "series" | "site" | "episode") => {
                        Ok((work_id, None))
                    }
                    _ => Err(("unsupported_kind", vec![])),
                },
                LeafMatch::Ambiguous(c) => Err(("ambiguous", c)),
                LeafMatch::NoMatch => Err(("no_match", vec![])),
                LeafMatch::Unsupported => Err(("unsupported_kind", vec![])),
            };
            match outcome {
                Ok(key) => {
                    if present.insert(key) {
                        new_items.push(key);
                        summary.playlists.items_to_add += 1;
                        sampler.push(ImportSample {
                            section: "playlist_item".into(),
                            title,
                            outcome: "add".into(),
                            playlist: Some(name.clone()),
                            candidates: vec![],
                        });
                    } else {
                        summary.playlists.items_already_present += 1;
                    }
                }
                Err((reason, candidates)) => {
                    summary.playlists.items_unmatched += 1;
                    unmatched.push(UnmatchedRecord {
                        section: "playlist_item".into(),
                        reason: reason.into(),
                        playlist_name: Some(playlist.name.clone()),
                        record: serde_json::json!({"media_type": playlist.media_type, "entry": entry}),
                    });
                    sampler.push(ImportSample {
                        section: "playlist_item".into(),
                        title,
                        outcome: reason.into(),
                        playlist: Some(name.clone()),
                        candidates,
                    });
                }
            }
        }
        plans.push(PlaylistPlan {
            package_id: playlist.id,
            parent_package_id,
            name,
            media_type,
            existing,
            new_items,
        });
    }

    // ---- watchlist --------------------------------------------------------
    let mut watchlist_plan: Vec<WatchlistItem> = Vec::new();
    let mut seen_keys: HashSet<String> = HashSet::new();
    summary.watchlist.total = package.watchlist.len();
    for record in &package.watchlist {
        let title = label(&record.item);
        let reason = match discovery_kind(&record.item.kind) {
            _ if record.item.title.trim().is_empty() => Some("invalid_record"),
            None => Some("unsupported_kind"),
            Some(_) => None,
        };
        if let Some(reason) = reason {
            summary.watchlist.unmatched += 1;
            unmatched.push(UnmatchedRecord {
                section: "watchlist".into(),
                reason: reason.into(),
                playlist_name: None,
                record: serde_json::to_value(record).unwrap_or_default(),
            });
            sampler.push(ImportSample {
                section: "watchlist".into(),
                title,
                outcome: reason.into(),
                playlist: None,
                candidates: vec![],
            });
            continue;
        }
        let kind = discovery_kind(&record.item.kind).expect("checked above");
        let mut refs: Vec<ExternalRef> = record
            .item
            .external_ids
            .iter()
            .filter_map(|(key, value)| {
                parse_provider_key(key).map(|provider| ExternalRef {
                    provider,
                    external_id: value.clone(),
                })
            })
            .collect();
        // Library titles are linked to the local work when the account can
        // see it; everything else stays a snapshot, which is what the
        // watchlist is for.
        let mut work_id = None;
        if matches!(
            record.item.kind.as_str(),
            "movie" | "series" | "site" | "artist" | "author"
        ) {
            if let WorkMatch::Found(id) = resolver.match_work(&record.item).await {
                if let Some(detail) = resolver.detail(id).await {
                    work_id = Some(id);
                    for external in &detail.work.external_refs {
                        if !refs.contains(external) {
                            refs.push(external.clone());
                        }
                    }
                }
            }
        }
        let title_text = record.item.title.trim().to_owned();
        let key = identity_key(kind, &title_text, record.item.year, &refs);
        if !seen_keys.insert(key.clone()) {
            continue;
        }
        if state.watchlist_repo.get(user_id, &key).await?.is_some() {
            summary.watchlist.already_present += 1;
            continue;
        }
        summary.watchlist.will_add += 1;
        sampler.push(ImportSample {
            section: "watchlist".into(),
            title,
            outcome: "add".into(),
            playlist: None,
            candidates: vec![],
        });
        watchlist_plan.push(WatchlistItem {
            title_key: key,
            kind,
            title: title_text,
            year: record.item.year,
            work_id,
            external_refs: refs,
            poster_url: None,
            added_at: record.added_at,
        });
    }

    // ---- preferences ------------------------------------------------------
    let mut language = None;
    if options.include_preferences {
        if let Some(wanted) = package
            .preferences
            .preferred_audio_language
            .as_deref()
            .map(|l| l.trim().to_ascii_lowercase())
            .filter(|l| valid_language(l))
        {
            let current = state.user_repo.find_by_id(user_id).await?;
            if current.is_some_and(|u| u.preferred_audio_language != wanted) {
                summary.preferred_audio_language_change = Some(wanted.clone());
                language = Some(wanted);
            }
        }
    }

    summary.unmatched_total = unmatched.len();
    Ok(Plan {
        watch,
        playlists: plans,
        watchlist: watchlist_plan,
        language,
        unmatched,
        summary,
        samples: sampler.samples,
    })
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct ImportResult {
    /// `true` when every planned change was written.
    pub completed: bool,
    pub progress_added: usize,
    pub progress_updated: usize,
    pub progress_unchanged: usize,
    pub progress_conflicts_kept: usize,
    pub playlists_created: usize,
    pub playlist_items_added: usize,
    pub playlist_items_already_present: usize,
    pub watchlist_added: usize,
    pub watchlist_already_present: usize,
    pub preferred_audio_language_updated: bool,
    pub unmatched_total: usize,
    /// The first failure, when `completed` is `false`.
    pub failure: Option<String>,
    /// Sections not attempted after a failure; re-running the import is safe.
    pub sections_not_attempted: Vec<String>,
}

/// Writes the plan as `user_id`. Stops at the first failure and reports it.
pub async fn apply_plan(state: &AppState, user_id: Uuid, plan: &Plan) -> ImportResult {
    let mut result = ImportResult {
        progress_unchanged: plan.summary.watch_progress.already_present,
        progress_conflicts_kept: plan.summary.watch_progress.conflicts_kept,
        playlist_items_already_present: plan.summary.playlists.items_already_present,
        watchlist_already_present: plan.summary.watchlist.already_present,
        unmatched_total: plan.unmatched.len(),
        ..ImportResult::default()
    };

    for item in &plan.watch {
        if !matches!(item.action, WatchAction::Add | WatchAction::Update) {
            continue;
        }
        let row = WatchProgress {
            media_file_id: item.media_file_id,
            work_id: item.work_id,
            position_ms: item.position_ms,
            duration_ms: item.duration_ms,
            state: item.state,
            updated_at: Some(item.updated_at),
        };
        if let Err(error) = state.watch_progress.upsert(user_id, &row).await {
            result.failure = Some(format!("watch progress could not be saved: {error}"));
            result.sections_not_attempted =
                vec!["playlists".into(), "watchlist".into(), "preferences".into()];
            return result;
        }
        match item.action {
            WatchAction::Add => result.progress_added += 1,
            _ => result.progress_updated += 1,
        }
    }

    let mut real_ids: HashMap<Uuid, Uuid> = HashMap::new();
    for (index, plan) in plan.playlists.iter().enumerate() {
        let real_id = match plan.existing {
            Some(id) => id,
            None => {
                let now = Utc::now();
                let id = Uuid::new_v4();
                let playlist = Playlist {
                    id,
                    name: plan.name.clone(),
                    owner_user_id: Some(user_id),
                    parent_playlist_id: plan
                        .parent_package_id
                        .and_then(|p| real_ids.get(&p).copied()),
                    media_type: plan.media_type,
                    created_at: now,
                    updated_at: now,
                };
                if let Err(error) = state.playlist_repo.upsert(&playlist).await {
                    result.failure = Some(format!("playlist could not be created: {error}"));
                    result.sections_not_attempted = vec![
                        format!("playlists (from {} of {})", index + 1, plan.name),
                        "watchlist".into(),
                        "preferences".into(),
                    ];
                    return result;
                }
                result.playlists_created += 1;
                id
            }
        };
        real_ids.insert(plan.package_id, real_id);
        for (work_id, track_id) in &plan.new_items {
            if let Err(error) = state
                .playlist_repo
                .add_item(real_id, *work_id, *track_id)
                .await
            {
                result.failure = Some(format!("playlist item could not be added: {error}"));
                result.sections_not_attempted = vec!["watchlist".into(), "preferences".into()];
                return result;
            }
            result.playlist_items_added += 1;
        }
    }

    for item in &plan.watchlist {
        if let Err(error) = state.watchlist_repo.add(user_id, item).await {
            result.failure = Some(format!("watchlist title could not be saved: {error}"));
            result.sections_not_attempted = vec!["preferences".into()];
            return result;
        }
        result.watchlist_added += 1;
    }

    if let Some(language) = &plan.language {
        let outcome = async {
            let mut user = state.user_repo.find_by_id(user_id).await?;
            if let Some(user) = user.as_mut() {
                user.preferred_audio_language = language.clone();
                state.user_repo.upsert(user).await?;
            }
            Ok::<_, playarr_db::DbError>(user.is_some())
        }
        .await;
        match outcome {
            Ok(updated) => result.preferred_audio_language_updated = updated,
            Err(error) => {
                result.failure = Some(format!("preference could not be saved: {error}"));
                return result;
            }
        }
    }
    result.completed = true;
    result
}
