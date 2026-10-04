//! Smart Start/Resume for TV series: a pure, deterministic rule engine.
//!
//! [`compute_resume_plan`] takes a series' playable episodes, the viewer's
//! per-file [`WatchProgress`] rows and the viewer's recorded
//! [`ResumeDismissal`]s, and returns a [`ResumePlan`]: which episode a
//! "Start"/"Resume" press should play, and, only when the history is
//! ambiguous, the options a chooser should offer. No I/O, no clock reads:
//! the same inputs always give the same plan.
//!
//! # Units
//!
//! Episodes are ordered by season then episode number. Specials (season 0)
//! sort after every regular season and never take part in gap or "next"
//! detection (a user is not nagged about unwatched specials), though a
//! half-watched special is still offered for resume. A series made only of
//! specials treats them as regular. Episodes without a media file are not
//! playable and are skipped entirely (a hole in the library is not a gap).
//! Several episodes sharing one media file (a multi-episode file) collapse
//! into a single *unit* labelled `S01E01-E02` whose state is the file's.
//!
//! # Per-unit state
//!
//! `Watched` when the stored state is watched or at least 90% was played;
//! `Untouched` when under 5% was played (an accidental open does not count);
//! otherwise `InProgress`. When no duration is known, 60 s played counts as
//! in progress.
//!
//! # Rules
//!
//! * Nothing watched or in progress: `Start` from the first episode.
//! * *Unfinished* (a chooser is shown): two or more in-progress units, or one
//!   that is not the most recent activity, or one behind further progress.
//!   A single in-progress unit that is simply the latest activity resumes
//!   without asking.
//! * *Missed episode*: an untouched regular unit before the furthest
//!   watched or in-progress unit, not yet dismissed. Declining dismisses the
//!   whole contiguous run of such units.
//! * *Rewatch*: the most recently watched unit is a finished one behind the
//!   furthest progress, and a "next in series" episode exists after that
//!   progress. Offers "continue from last watched" against "next in series".
//!   Either answer is remembered for that anchor (and for each following
//!   episode of the same rewatch pass) so it is not asked again.
//! * Otherwise the next episode after the furthest progress, without asking.
//!   When everything is watched, `Restart` from the first episode.

use std::collections::HashSet;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::playback::{WatchProgress, WatchState};

/// Below this fraction of the runtime, progress is treated as not started.
pub const PARTIAL_MIN_PERCENT: u64 = 5;
/// At or above this fraction of the runtime, a unit counts as watched.
pub const WATCHED_MIN_PERCENT: u64 = 90;
/// Played time that counts as started when no duration is known.
pub const UNKNOWN_DURATION_MIN_MS: u64 = 60_000;
/// Activity within this window of the newest counts as simultaneous (bulk
/// "mark watched" writes many rows at once); the furthest episode wins.
pub const SIMULTANEOUS_SECS: i64 = 60;

/// One catalogue episode, as the engine needs it.
#[derive(Debug, Clone, PartialEq)]
pub struct ResumeEpisode {
    pub episode_id: Uuid,
    pub season_number: i32,
    pub episode_number: i32,
    pub title: Option<String>,
    /// `None` when no file has synced for the episode.
    pub media_file_id: Option<Uuid>,
    pub runtime_ms: Option<u64>,
}

/// Why a dismissal row exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ResumeDismissalKind {
    /// The viewer declined to go back for this missed episode.
    MissedEpisode,
    /// The viewer chose to keep rewatching from the anchor episode.
    RewatchContinueLast,
    /// The viewer chose to continue the series past the rewatch.
    RewatchContinueSeries,
}

/// A recorded answer, keyed by the (first) episode it concerns.
#[derive(Debug, Clone, PartialEq)]
pub struct ResumeDismissal {
    pub kind: ResumeDismissalKind,
    pub episode_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ResumeAction {
    /// Nothing watched: play from the first episode.
    Start,
    /// Continue somewhere in the history.
    Resume,
    /// Everything watched: play from the first episode again.
    Restart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ResumeOptionKind {
    /// Resume a part-watched episode.
    Unfinished,
    /// Go back for an episode skipped before later watched ones.
    MissedEpisode,
    /// The episode after the most recently watched one (a rewatch).
    ContinueFromLastWatched,
    /// The episode after the furthest progress.
    NextInSeries,
    /// Play from the first episode again.
    StartOver,
}

/// Why the plan is what it is. Deterministic and stable for clients to key
/// copy on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ResumeReason {
    NoPlayableEpisodes,
    NotStarted,
    NextInOrder,
    ResumeUnfinished,
    ContinueRewatch,
    RewatchResolvedContinueSeries,
    CompletedRestart,
    ChoiceRequired,
}

/// What made the chooser necessary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ResumeAskReason {
    MultipleUnfinished,
    UnfinishedNotLatest,
    UnfinishedBehindProgress,
    MissedEpisode,
    RewatchBehindProgress,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ResumeOption {
    pub kind: ResumeOptionKind,
    /// First episode of the unit (the id to navigate to and to report back).
    pub episode_id: Uuid,
    pub media_file_id: Uuid,
    pub season_number: i32,
    pub episode_number: i32,
    /// Last episode number for a multi-episode file, otherwise absent.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub episode_number_end: Option<i32>,
    /// `S01E05`, or `S01E01-E02` for a multi-episode file.
    pub label: String,
    pub title: Option<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
    /// Whole percent played, 0 when unknown.
    pub progress_percent: u8,
    /// When the viewer last played it; absent when never.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_watched_at: Option<DateTime<Utc>>,
    /// For `continue_from_last_watched`: the finished episode it follows.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub anchor_episode_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ResumePlan {
    pub series_work_id: Uuid,
    pub action: ResumeAction,
    pub reason: ResumeReason,
    /// True when the client must show the chooser before playing.
    pub needs_choice: bool,
    pub ask_reasons: Vec<ResumeAskReason>,
    /// The episode to play when no choice is needed (the first option
    /// otherwise). Absent only when the series has no playable episode.
    pub target: Option<ResumeOption>,
    /// Choices for the chooser; contains `target` first. A single entry
    /// unless `needs_choice`.
    pub options: Vec<ResumeOption>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum UnitState {
    Untouched,
    InProgress,
    Watched,
}

struct Unit<'a> {
    first: &'a ResumeEpisode,
    last_number: i32,
    episode_ids: Vec<Uuid>,
    media_file_id: Uuid,
    runtime_ms: Option<u64>,
    progress: Option<&'a WatchProgress>,
    state: UnitState,
    regular: bool,
}

impl Unit<'_> {
    fn label(&self) -> String {
        let s = self.first.season_number;
        if self.last_number != self.first.episode_number {
            format!(
                "S{s:02}E{:02}-E{:02}",
                self.first.episode_number, self.last_number
            )
        } else {
            format!("S{s:02}E{:02}", self.first.episode_number)
        }
    }

    fn touched_at(&self) -> Option<DateTime<Utc>> {
        match self.state {
            UnitState::Untouched => None,
            _ => self.progress.and_then(|p| p.updated_at),
        }
    }

    fn option(&self, kind: ResumeOptionKind, anchor: Option<Uuid>) -> ResumeOption {
        let (position_ms, stored_duration) = self
            .progress
            .map(|p| (p.position_ms, p.duration_ms))
            .unwrap_or((0, 0));
        let duration_ms = if stored_duration > 0 {
            stored_duration
        } else {
            self.runtime_ms.unwrap_or(0)
        };
        let progress_percent = match self.state {
            UnitState::Watched => 100,
            _ if duration_ms > 0 => (position_ms.saturating_mul(100) / duration_ms).min(100) as u8,
            _ => 0,
        };
        ResumeOption {
            kind,
            episode_id: self.first.episode_id,
            media_file_id: self.media_file_id,
            season_number: self.first.season_number,
            episode_number: self.first.episode_number,
            episode_number_end: (self.last_number != self.first.episode_number)
                .then_some(self.last_number),
            label: self.label(),
            title: self.first.title.clone(),
            position_ms: if self.state == UnitState::InProgress {
                position_ms
            } else {
                0
            },
            duration_ms,
            progress_percent,
            last_watched_at: self.touched_at(),
            anchor_episode_id: anchor,
        }
    }
}

fn classify(progress: Option<&WatchProgress>, runtime_ms: Option<u64>) -> UnitState {
    let Some(p) = progress else {
        return UnitState::Untouched;
    };
    if p.state == WatchState::Watched {
        return UnitState::Watched;
    }
    let duration = if p.duration_ms > 0 {
        p.duration_ms
    } else {
        runtime_ms.unwrap_or(0)
    };
    if duration > 0 {
        let played = p.position_ms.saturating_mul(100);
        if played >= duration.saturating_mul(WATCHED_MIN_PERCENT) {
            UnitState::Watched
        } else if played < duration.saturating_mul(PARTIAL_MIN_PERCENT) {
            UnitState::Untouched
        } else {
            UnitState::InProgress
        }
    } else if p.position_ms >= UNKNOWN_DURATION_MIN_MS {
        UnitState::InProgress
    } else {
        UnitState::Untouched
    }
}

fn build_units<'a>(episodes: &'a [ResumeEpisode], progress: &'a [WatchProgress]) -> Vec<Unit<'a>> {
    let mut sorted: Vec<&ResumeEpisode> = episodes
        .iter()
        .filter(|e| e.media_file_id.is_some())
        .collect();
    // Regular seasons ascending, then specials (season <= 0).
    sorted.sort_by_key(|e| (e.season_number <= 0, e.season_number, e.episode_number));
    let mut units: Vec<Unit<'a>> = Vec::new();
    for ep in sorted {
        let file = ep.media_file_id.expect("filtered");
        if let Some(unit) = units.iter_mut().find(|u| u.media_file_id == file) {
            unit.last_number = unit.last_number.max(ep.episode_number);
            unit.episode_ids.push(ep.episode_id);
            continue;
        }
        let row = progress.iter().find(|p| p.media_file_id == file);
        units.push(Unit {
            first: ep,
            last_number: ep.episode_number,
            episode_ids: vec![ep.episode_id],
            media_file_id: file,
            runtime_ms: ep.runtime_ms,
            progress: row,
            state: classify(row, ep.runtime_ms),
            regular: ep.season_number > 0,
        });
    }
    if !units.iter().any(|u| u.regular) {
        for u in &mut units {
            u.regular = true;
        }
    }
    units
}

/// Compute the plan. See the module docs for the rules.
pub fn compute_resume_plan(
    series_work_id: Uuid,
    episodes: &[ResumeEpisode],
    progress: &[WatchProgress],
    dismissals: &[ResumeDismissal],
) -> ResumePlan {
    let units = build_units(episodes, progress);
    let plan = |action, reason, needs_choice, ask_reasons, options: Vec<ResumeOption>| ResumePlan {
        series_work_id,
        action,
        reason,
        needs_choice,
        ask_reasons,
        target: options.first().cloned(),
        options,
    };

    let Some(first_regular) = units.iter().position(|u| u.regular) else {
        return plan(
            ResumeAction::Start,
            ResumeReason::NoPlayableEpisodes,
            false,
            vec![],
            vec![],
        );
    };
    let regular: Vec<usize> = (0..units.len()).filter(|&i| units[i].regular).collect();
    let in_play = |i: usize| units[i].state != UnitState::Untouched;

    // Newest activity; ties inside the simultaneity window go to the
    // furthest unit. Rows without a timestamp sort as the epoch.
    let stamp = |i: usize| units[i].touched_at().unwrap_or_default();
    let Some(newest) = (0..units.len()).filter(|&i| in_play(i)).map(stamp).max() else {
        return plan(
            ResumeAction::Start,
            ResumeReason::NotStarted,
            false,
            vec![],
            vec![units[first_regular].option(ResumeOptionKind::NextInSeries, None)],
        );
    };
    let window = Duration::seconds(SIMULTANEOUS_SECS);
    let last_touched = (0..units.len())
        .filter(|&i| in_play(i) && stamp(i) >= newest - window)
        .max()
        .expect("something is in play");

    let frontier_all = regular.iter().copied().filter(|&i| in_play(i)).max();
    let frontier_watched = regular
        .iter()
        .copied()
        .filter(|&i| units[i].state == UnitState::Watched)
        .max();
    let next_in_series: Option<usize> = match frontier_all {
        Some(f) => regular.iter().copied().find(|&i| i > f),
        None => Some(first_regular),
    };

    // Unfinished, newest first.
    let mut unfinished: Vec<usize> = (0..units.len())
        .filter(|&i| units[i].state == UnitState::InProgress)
        .collect();
    unfinished.sort_by(|&a, &b| {
        units[b]
            .touched_at()
            .cmp(&units[a].touched_at())
            .then(b.cmp(&a))
    });

    let dismissed_gap = |i: usize| {
        dismissals.iter().any(|d| {
            d.kind == ResumeDismissalKind::MissedEpisode
                && units[i].episode_ids.contains(&d.episode_id)
        })
    };
    let first_gap: Option<usize> = frontier_all.and_then(|f| {
        regular
            .iter()
            .copied()
            .find(|&i| i < f && units[i].state == UnitState::Untouched && !dismissed_gap(i))
    });

    // Rewatch: the newest activity is a finished unit behind the furthest
    // progress.
    let rewatch_anchor = frontier_all
        .filter(|&f| {
            units[last_touched].regular
                && units[last_touched].state == UnitState::Watched
                && last_touched < f
        })
        .map(|_| last_touched);
    let rewatch_resolution =
        rewatch_anchor.and_then(|l| resolution_for(&units, &regular, l, dismissals));
    let rewatch_next = rewatch_anchor.and_then(|l| {
        let pos = regular.iter().position(|&i| i == l)?;
        regular.get(pos + 1).copied()
    });

    let mut asks: Vec<ResumeAskReason> = Vec::new();
    if let Some(&u0) = unfinished.first() {
        if unfinished.len() >= 2 {
            asks.push(ResumeAskReason::MultipleUnfinished);
        } else if u0 != last_touched {
            asks.push(ResumeAskReason::UnfinishedNotLatest);
        } else if units[u0].regular && frontier_watched.is_some_and(|w| u0 < w) {
            asks.push(ResumeAskReason::UnfinishedBehindProgress);
        }
    }
    if first_gap.is_some() {
        asks.push(ResumeAskReason::MissedEpisode);
    }
    let rewatch_ask = rewatch_resolution.is_none()
        && next_in_series.is_some()
        && rewatch_next.is_some()
        && unfinished.is_empty();
    if rewatch_ask {
        asks.push(ResumeAskReason::RewatchBehindProgress);
    }

    if !asks.is_empty() {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut options: Vec<ResumeOption> = Vec::new();
        let mut push = |i: usize, kind: ResumeOptionKind, anchor: Option<Uuid>| {
            if seen.insert(i) {
                options.push(units[i].option(kind, anchor));
            }
        };
        for &u in &unfinished {
            push(u, ResumeOptionKind::Unfinished, None);
        }
        if let Some(g) = first_gap {
            push(g, ResumeOptionKind::MissedEpisode, None);
        }
        if rewatch_ask {
            if let Some(a) = rewatch_next {
                push(
                    a,
                    ResumeOptionKind::ContinueFromLastWatched,
                    Some(units[last_touched].first.episode_id),
                );
            }
        }
        if let Some(b) = next_in_series {
            push(b, ResumeOptionKind::NextInSeries, None);
        }
        if next_in_series.is_none() {
            push(first_regular, ResumeOptionKind::StartOver, None);
        }
        if options.len() > 1 {
            return plan(
                ResumeAction::Resume,
                ResumeReason::ChoiceRequired,
                true,
                asks,
                options,
            );
        }
        // One distinct answer: no point asking.
        let only = options.remove(0);
        let reason = if only.kind == ResumeOptionKind::Unfinished {
            ResumeReason::ResumeUnfinished
        } else {
            ResumeReason::NextInOrder
        };
        return plan(ResumeAction::Resume, reason, false, vec![], vec![only]);
    }

    // No ambiguity: a single answer.
    if let Some(&u0) = unfinished.first() {
        return plan(
            ResumeAction::Resume,
            ResumeReason::ResumeUnfinished,
            false,
            vec![],
            vec![units[u0].option(ResumeOptionKind::Unfinished, None)],
        );
    }
    if let (Some(l), Some(a)) = (rewatch_anchor, rewatch_next) {
        let anchor = Some(units[l].first.episode_id);
        let continue_series =
            rewatch_resolution == Some(ResumeDismissalKind::RewatchContinueSeries);
        if let (true, Some(b)) = (continue_series, next_in_series) {
            return plan(
                ResumeAction::Resume,
                ResumeReason::RewatchResolvedContinueSeries,
                false,
                vec![],
                vec![units[b].option(ResumeOptionKind::NextInSeries, None)],
            );
        }
        if rewatch_resolution == Some(ResumeDismissalKind::RewatchContinueLast)
            || next_in_series.is_none()
        {
            return plan(
                ResumeAction::Resume,
                ResumeReason::ContinueRewatch,
                false,
                vec![],
                vec![units[a].option(ResumeOptionKind::ContinueFromLastWatched, anchor)],
            );
        }
    }
    match next_in_series {
        Some(b) if frontier_all.is_none() => plan(
            ResumeAction::Start,
            ResumeReason::NotStarted,
            false,
            vec![],
            vec![units[b].option(ResumeOptionKind::NextInSeries, None)],
        ),
        Some(b) => plan(
            ResumeAction::Resume,
            ResumeReason::NextInOrder,
            false,
            vec![],
            vec![units[b].option(ResumeOptionKind::NextInSeries, None)],
        ),
        None => plan(
            ResumeAction::Restart,
            ResumeReason::CompletedRestart,
            false,
            vec![],
            vec![units[first_regular].option(ResumeOptionKind::StartOver, None)],
        ),
    }
}

/// The recorded rewatch answer for the anchor unit, directly or inherited
/// along a rewatch pass: the previous regular unit was answered and the
/// anchor was played after that answer.
fn resolution_for(
    units: &[Unit<'_>],
    regular: &[usize],
    anchor: usize,
    dismissals: &[ResumeDismissal],
) -> Option<ResumeDismissalKind> {
    let rewatch = |u: usize| {
        dismissals.iter().filter(move |d| {
            matches!(
                d.kind,
                ResumeDismissalKind::RewatchContinueLast
                    | ResumeDismissalKind::RewatchContinueSeries
            ) && units[u].episode_ids.contains(&d.episode_id)
        })
    };
    if let Some(d) = rewatch(anchor).max_by_key(|d| d.created_at) {
        return Some(d.kind);
    }
    let pos = regular.iter().position(|&i| i == anchor)?;
    let prev = *regular.get(pos.checked_sub(1)?)?;
    let answered = rewatch(prev).max_by_key(|d| d.created_at)?;
    // Only a "continue from last" answer carries over to the next episode of
    // the pass, and only when that episode was played after the answer.
    (answered.kind == ResumeDismissalKind::RewatchContinueLast
        && units[anchor]
            .touched_at()
            .is_some_and(|t| t >= answered.created_at))
    .then_some(answered.kind)
}

/// Episode ids to dismiss when the viewer declines the missed episode
/// `declined`: the whole contiguous run of untouched regular units around
/// it, so the next gap-mate is not asked about immediately afterwards.
pub fn missed_run_episode_ids(
    episodes: &[ResumeEpisode],
    progress: &[WatchProgress],
    declined: Uuid,
) -> Vec<Uuid> {
    let units = build_units(episodes, progress);
    let regular: Vec<usize> = (0..units.len()).filter(|&i| units[i].regular).collect();
    let Some(at) = regular
        .iter()
        .position(|&i| units[i].episode_ids.contains(&declined))
    else {
        return vec![];
    };
    let untouched = |p: usize| units[regular[p]].state == UnitState::Untouched;
    if !untouched(at) {
        return vec![];
    }
    let frontier = (0..regular.len())
        .rev()
        .find(|&p| !untouched(p))
        .unwrap_or(0);
    if at >= frontier {
        return vec![];
    }
    let (mut lo, mut hi) = (at, at);
    while lo > 0 && untouched(lo - 1) {
        lo -= 1;
    }
    while hi + 1 < regular.len() && untouched(hi + 1) {
        hi += 1;
    }
    (lo..=hi)
        .map(|p| units[regular[p]].first.episode_id)
        .collect()
}

#[cfg(test)]
mod tests;
