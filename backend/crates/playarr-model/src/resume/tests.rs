use chrono::{Duration, TimeZone, Utc};

use super::*;

const RUNTIME: u64 = 1_800_000; // 30 min

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

/// Episode `s`,`e` with a stable id (`s*100+e`) and its own file
/// (`10_000 + s*100+e`).
fn ep(s: i32, e: i32) -> ResumeEpisode {
    ResumeEpisode {
        episode_id: id((s * 100 + e) as u128),
        season_number: s,
        episode_number: e,
        title: Some(format!("Title {s}x{e}")),
        media_file_id: Some(id(10_000 + (s * 100 + e) as u128)),
        runtime_ms: Some(RUNTIME),
    }
}

fn season(s: i32, count: i32) -> Vec<ResumeEpisode> {
    (1..=count).map(|e| ep(s, e)).collect()
}

fn t(day: i64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap() + Duration::days(day)
}

fn row(s: i32, e: i32, pct: u64, at: DateTime<Utc>) -> WatchProgress {
    let position_ms = RUNTIME * pct / 100;
    WatchProgress {
        media_file_id: id(10_000 + (s * 100 + e) as u128),
        work_id: id(1),
        position_ms,
        duration_ms: RUNTIME,
        state: WatchProgress::state_for(position_ms, RUNTIME, false),
        updated_at: Some(at),
    }
}

fn done(s: i32, e: i32, at: DateTime<Utc>) -> WatchProgress {
    row(s, e, 100, at)
}

fn plan(eps: &[ResumeEpisode], prog: &[WatchProgress], dis: &[ResumeDismissal]) -> ResumePlan {
    compute_resume_plan(id(1), eps, prog, dis)
}

fn labels(p: &ResumePlan) -> Vec<String> {
    p.options.iter().map(|o| o.label.clone()).collect()
}

fn kinds(p: &ResumePlan) -> Vec<ResumeOptionKind> {
    p.options.iter().map(|o| o.kind).collect()
}

fn target(p: &ResumePlan) -> String {
    p.target.as_ref().expect("target").label.clone()
}

fn all(seasons: &[(i32, i32)]) -> Vec<ResumeEpisode> {
    seasons.iter().flat_map(|&(s, n)| season(s, n)).collect()
}

fn watched_run(s: i32, from: i32, to: i32, start_day: i64) -> Vec<WatchProgress> {
    (from..=to)
        .map(|e| done(s, e, t(start_day + e as i64)))
        .collect()
}

// ---- Start ---------------------------------------------------------------

#[test]
fn nothing_watched_starts_at_s01e01() {
    let p = plan(&all(&[(1, 3), (2, 3)]), &[], &[]);
    assert_eq!(p.action, ResumeAction::Start);
    assert_eq!(p.reason, ResumeReason::NotStarted);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S01E01");
}

#[test]
fn start_skips_leading_specials_and_missing_files() {
    let mut eps = all(&[(0, 2), (1, 3)]);
    eps.retain(|e| !(e.season_number == 1 && e.episode_number == 1));
    eps.push(ResumeEpisode {
        media_file_id: None,
        ..ep(1, 1)
    });
    let p = plan(&eps, &[], &[]);
    assert_eq!(target(&p), "S01E02");
}

#[test]
fn no_playable_episodes_has_no_target() {
    let mut e = ep(1, 1);
    e.media_file_id = None;
    let p = plan(&[e], &[], &[]);
    assert_eq!(p.reason, ResumeReason::NoPlayableEpisodes);
    assert!(p.target.is_none() && p.options.is_empty() && !p.needs_choice);
    assert!(plan(&[], &[], &[]).target.is_none());
}

#[test]
fn only_specials_series_starts_at_first_special() {
    let p = plan(&season(0, 3), &[], &[]);
    assert_eq!(target(&p), "S00E01");
    let p = plan(&season(0, 3), &[done(0, 1, t(1))], &[]);
    assert_eq!(target(&p), "S00E02");
}

#[test]
fn under_five_percent_does_not_count_as_started() {
    let p = plan(&all(&[(1, 3)]), &[row(1, 1, 4, t(1))], &[]);
    assert_eq!(p.action, ResumeAction::Start);
    assert_eq!(target(&p), "S01E01");
}

// ---- Watching in order (no prompt) ----------------------------------------

#[test]
fn watching_in_order_picks_next_without_asking() {
    let p = plan(&all(&[(1, 5)]), &watched_run(1, 1, 3, 0), &[]);
    assert_eq!(p.action, ResumeAction::Resume);
    assert_eq!(p.reason, ResumeReason::NextInOrder);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S01E04");
    assert_eq!(p.options.len(), 1);
}

#[test]
fn next_crosses_the_season_boundary() {
    let p = plan(&all(&[(1, 3), (2, 3)]), &watched_run(1, 1, 3, 0), &[]);
    assert_eq!(target(&p), "S02E01");
    assert!(!p.needs_choice);
}

#[test]
fn ninety_percent_counts_as_watched_and_89_does_not() {
    let eps = all(&[(1, 3)]);
    let p = plan(&eps, &[row(1, 1, 90, t(1))], &[]);
    assert_eq!(target(&p), "S01E02");
    let p = plan(&eps, &[row(1, 1, 89, t(1))], &[]);
    assert_eq!(p.reason, ResumeReason::ResumeUnfinished);
    assert_eq!(target(&p), "S01E01");
}

#[test]
fn five_percent_boundary_is_inclusive_for_in_progress() {
    let eps = all(&[(1, 3)]);
    let p = plan(&eps, &[row(1, 1, 5, t(1))], &[]);
    assert_eq!(p.reason, ResumeReason::ResumeUnfinished);
    let p = plan(&eps, &[row(1, 1, 4, t(1))], &[]);
    assert_eq!(p.action, ResumeAction::Start);
}

#[test]
fn stored_watched_state_wins_over_position() {
    let mut r = row(1, 1, 10, t(1));
    r.state = WatchState::Watched;
    let p = plan(&all(&[(1, 3)]), &[r], &[]);
    assert_eq!(target(&p), "S01E02");
}

#[test]
fn unknown_duration_uses_sixty_second_floor() {
    let mut eps = all(&[(1, 3)]);
    eps[0].runtime_ms = None;
    let mut r = row(1, 1, 0, t(1));
    r.duration_ms = 0;
    r.position_ms = 59_000;
    r.state = WatchState::PartWatched;
    assert_eq!(plan(&eps, &[r.clone()], &[]).action, ResumeAction::Start);
    r.position_ms = 61_000;
    let p = plan(&eps, &[r], &[]);
    assert_eq!(p.reason, ResumeReason::ResumeUnfinished);
    assert_eq!(p.target.unwrap().progress_percent, 0);
}

#[test]
fn runtime_fills_in_for_a_row_without_duration() {
    let eps = all(&[(1, 3)]);
    let mut r = row(1, 1, 50, t(1));
    r.duration_ms = 0;
    let p = plan(&eps, &[r], &[]);
    let o = p.target.unwrap();
    assert_eq!((o.duration_ms, o.progress_percent), (RUNTIME, 50));
}

// ---- 1. Unfinished ----------------------------------------------------------

#[test]
fn single_unfinished_latest_resumes_without_asking() {
    let mut prog = watched_run(1, 1, 3, 0);
    prog.push(row(1, 4, 40, t(10)));
    let p = plan(&all(&[(1, 6)]), &prog, &[]);
    assert!(!p.needs_choice);
    assert_eq!(p.reason, ResumeReason::ResumeUnfinished);
    let o = p.target.unwrap();
    assert_eq!(o.label, "S01E04");
    assert_eq!(o.progress_percent, 40);
    assert_eq!(o.position_ms, RUNTIME * 40 / 100);
    assert_eq!(o.last_watched_at, Some(t(10)));
}

#[test]
fn several_unfinished_ask_newest_first_then_next() {
    let prog = vec![
        done(1, 1, t(1)),
        row(1, 2, 30, t(2)),
        done(1, 3, t(3)),
        row(1, 4, 60, t(5)),
    ];
    let p = plan(&all(&[(1, 8)]), &prog, &[]);
    assert!(p.needs_choice);
    assert_eq!(p.reason, ResumeReason::ChoiceRequired);
    assert_eq!(p.ask_reasons, vec![ResumeAskReason::MultipleUnfinished]);
    assert_eq!(labels(&p), vec!["S01E04", "S01E02", "S01E05"]);
    assert_eq!(
        kinds(&p),
        vec![
            ResumeOptionKind::Unfinished,
            ResumeOptionKind::Unfinished,
            ResumeOptionKind::NextInSeries
        ]
    );
    assert_eq!(p.target.as_ref().unwrap().label, "S01E04");
}

#[test]
fn unfinished_older_than_latest_watched_asks() {
    let prog = vec![row(1, 2, 50, t(1)), done(1, 3, t(2)), done(1, 4, t(3))];
    let p = plan(&all(&[(1, 8)]), &prog, &[]);
    // S01E01 is also a missed episode before watched ones.
    assert!(p.needs_choice);
    assert!(p
        .ask_reasons
        .contains(&ResumeAskReason::UnfinishedNotLatest));
    assert!(p.ask_reasons.contains(&ResumeAskReason::MissedEpisode));
    assert_eq!(labels(&p), vec!["S01E02", "S01E01", "S01E05"]);
}

#[test]
fn unfinished_rewatch_behind_progress_offers_next_in_series() {
    let mut prog = watched_run(1, 1, 8, 0);
    prog.extend(watched_run(2, 1, 2, 10));
    prog.push(row(1, 5, 30, t(30)));
    // Replace the finished S01E05 row with the unfinished rewatch.
    prog.retain(|r| r.media_file_id != id(10_105) || r.position_ms < RUNTIME);
    let p = plan(&all(&[(1, 8), (2, 5)]), &prog, &[]);
    assert!(p.needs_choice);
    assert_eq!(
        p.ask_reasons,
        vec![ResumeAskReason::UnfinishedBehindProgress]
    );
    assert_eq!(labels(&p), vec!["S01E05", "S02E03"]);
}

#[test]
fn unfinished_special_resumes_without_asking() {
    let prog = vec![done(1, 1, t(1)), row(0, 1, 40, t(5))];
    let p = plan(&all(&[(0, 1), (1, 3)]), &prog, &[]);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S00E01");
}

#[test]
fn unfinished_is_offered_even_when_it_is_the_last_episode() {
    let prog = vec![done(1, 1, t(1)), row(1, 2, 50, t(2))];
    let p = plan(&all(&[(1, 2)]), &prog, &[]);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S01E02");
}

// ---- 2. Missed episode --------------------------------------------------------

#[test]
fn missed_season_one_episode_before_season_two_asks() {
    let mut prog = watched_run(1, 2, 8, 0);
    prog.extend(watched_run(2, 1, 2, 20));
    let p = plan(&all(&[(1, 8), (2, 5)]), &prog, &[]);
    assert!(p.needs_choice);
    assert_eq!(p.ask_reasons, vec![ResumeAskReason::MissedEpisode]);
    assert_eq!(labels(&p), vec!["S01E01", "S02E03"]);
    assert_eq!(
        kinds(&p),
        vec![
            ResumeOptionKind::MissedEpisode,
            ResumeOptionKind::NextInSeries
        ]
    );
}

#[test]
fn spec_example_s02_watched_but_s01_incomplete() {
    let mut prog = watched_run(1, 3, 8, 0);
    prog.extend(watched_run(2, 1, 2, 20));
    let p = plan(&all(&[(1, 8), (2, 5)]), &prog, &[]);
    // Earliest gap is S01E01.
    assert_eq!(p.options[0].label, "S01E01");
}

#[test]
fn missed_without_a_next_episode_offers_start_over() {
    let prog = vec![done(1, 1, t(1)), done(1, 3, t(2))];
    let p = plan(&all(&[(1, 3)]), &prog, &[]);
    assert!(p.needs_choice);
    assert_eq!(labels(&p), vec!["S01E02", "S01E01"]);
    assert_eq!(
        kinds(&p),
        vec![ResumeOptionKind::MissedEpisode, ResumeOptionKind::StartOver]
    );
}

#[test]
fn a_single_distinct_answer_is_not_asked() {
    // The only gap is also where "start over" would land.
    let prog = vec![done(1, 2, t(1)), done(1, 3, t(2))];
    let p = plan(&all(&[(1, 3)]), &prog, &[]);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S01E01");
}

#[test]
fn dismissed_gap_is_not_asked_again() {
    let mut prog = watched_run(1, 2, 8, 0);
    prog.extend(watched_run(2, 1, 2, 20));
    let eps = all(&[(1, 8), (2, 5)]);
    let dis = [ResumeDismissal {
        kind: ResumeDismissalKind::MissedEpisode,
        episode_id: id(101),
        created_at: t(30),
    }];
    let p = plan(&eps, &prog, &dis);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S02E03");
}

#[test]
fn a_new_gap_after_a_dismissal_asks_again() {
    let mut prog = watched_run(1, 2, 8, 0);
    prog.extend(watched_run(2, 1, 2, 20));
    let dis = [ResumeDismissal {
        kind: ResumeDismissalKind::MissedEpisode,
        episode_id: id(101),
        created_at: t(30),
    }];
    // The viewer then skips S02E03 and watches S02E04.
    prog.push(done(2, 4, t(31)));
    let p = plan(&all(&[(1, 8), (2, 5)]), &prog, &dis);
    assert_eq!(labels(&p), vec!["S02E03", "S02E05"]);
}

#[test]
fn missed_run_covers_the_contiguous_gap_only() {
    let mut prog = vec![done(1, 4, t(1)), done(1, 7, t(2))];
    prog.extend(watched_run(2, 1, 1, 3));
    let eps = all(&[(1, 8), (2, 3)]);
    let ids = missed_run_episode_ids(&eps, &prog, id(101));
    assert_eq!(ids, vec![id(101), id(102), id(103)]);
    let ids = missed_run_episode_ids(&eps, &prog, id(105));
    assert_eq!(ids, vec![id(105), id(106)]);
    // Not a gap: a watched episode, or one after the furthest progress.
    assert!(missed_run_episode_ids(&eps, &prog, id(104)).is_empty());
    assert!(missed_run_episode_ids(&eps, &prog, id(202)).is_empty());
    assert!(missed_run_episode_ids(&eps, &prog, id(999)).is_empty());
}

#[test]
fn after_declining_a_run_the_remaining_gaps_are_still_offered() {
    let prog = vec![done(1, 4, t(1)), done(1, 7, t(2))];
    let eps = all(&[(1, 8)]);
    let dis: Vec<_> = missed_run_episode_ids(&eps, &prog, id(101))
        .into_iter()
        .map(|episode_id| ResumeDismissal {
            kind: ResumeDismissalKind::MissedEpisode,
            episode_id,
            created_at: t(3),
        })
        .collect();
    let p = plan(&eps, &prog, &dis);
    assert_eq!(labels(&p), vec!["S01E05", "S01E08"]);
}

#[test]
fn missing_library_episode_is_not_a_gap() {
    let mut eps = all(&[(1, 5)]);
    eps.retain(|e| e.episode_number != 2);
    eps.push(ResumeEpisode {
        media_file_id: None,
        ..ep(1, 2)
    });
    let prog = vec![done(1, 1, t(1)), done(1, 3, t(2))];
    let p = plan(&eps, &prog, &[]);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S01E04");
}

#[test]
fn next_skips_over_a_hole_in_the_library() {
    let mut eps = all(&[(1, 5)]);
    eps.retain(|e| e.episode_number != 3);
    let prog = watched_run(1, 1, 2, 0);
    assert_eq!(target(&plan(&eps, &prog, &[])), "S01E04");
}

#[test]
fn unwatched_specials_are_never_gaps_or_next() {
    let mut prog = watched_run(1, 1, 3, 0);
    prog.push(done(2, 1, t(10)));
    let p = plan(&all(&[(0, 2), (1, 3), (2, 3)]), &prog, &[]);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S02E02");
    // Everything regular watched: restart, not the specials.
    let mut full = watched_run(1, 1, 3, 0);
    full.extend(watched_run(2, 1, 3, 10));
    let p = plan(&all(&[(0, 2), (1, 3), (2, 3)]), &full, &[]);
    assert_eq!(p.action, ResumeAction::Restart);
    assert_eq!(target(&p), "S01E01");
}

#[test]
fn watched_special_does_not_move_the_frontier() {
    let mut prog = watched_run(1, 1, 2, 0);
    prog.push(done(0, 1, t(10)));
    let p = plan(&all(&[(0, 2), (1, 5)]), &prog, &[]);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S01E03");
}

// ---- 3. Rewatch ----------------------------------------------------------------

fn rewatch_state() -> (Vec<ResumeEpisode>, Vec<WatchProgress>) {
    let eps = all(&[(1, 8), (2, 5)]);
    let mut prog = watched_run(1, 1, 8, 0);
    prog.extend(watched_run(2, 1, 2, 10));
    // Recently rewatched S01E05.
    prog.retain(|r| r.media_file_id != id(10_105));
    prog.push(done(1, 5, t(40)));
    (eps, prog)
}

#[test]
fn rewatch_behind_progress_offers_continue_from_last_or_next() {
    let (eps, prog) = rewatch_state();
    let p = plan(&eps, &prog, &[]);
    assert!(p.needs_choice);
    assert_eq!(p.ask_reasons, vec![ResumeAskReason::RewatchBehindProgress]);
    assert_eq!(labels(&p), vec!["S01E06", "S02E03"]);
    assert_eq!(
        kinds(&p),
        vec![
            ResumeOptionKind::ContinueFromLastWatched,
            ResumeOptionKind::NextInSeries
        ]
    );
    assert_eq!(p.options[0].anchor_episode_id, Some(id(105)));
}

#[test]
fn choosing_next_in_series_resolves_the_rewatch() {
    let (eps, prog) = rewatch_state();
    let dis = [ResumeDismissal {
        kind: ResumeDismissalKind::RewatchContinueSeries,
        episode_id: id(105),
        created_at: t(41),
    }];
    let p = plan(&eps, &prog, &dis);
    assert!(!p.needs_choice);
    assert_eq!(p.reason, ResumeReason::RewatchResolvedContinueSeries);
    assert_eq!(target(&p), "S02E03");
}

#[test]
fn choosing_continue_from_last_resumes_there_without_asking() {
    let (eps, prog) = rewatch_state();
    let dis = [ResumeDismissal {
        kind: ResumeDismissalKind::RewatchContinueLast,
        episode_id: id(105),
        created_at: t(41),
    }];
    let p = plan(&eps, &prog, &dis);
    assert!(!p.needs_choice);
    assert_eq!(p.reason, ResumeReason::ContinueRewatch);
    assert_eq!(target(&p), "S01E06");
}

#[test]
fn continue_from_last_carries_over_the_rest_of_the_pass() {
    let (eps, mut prog) = rewatch_state();
    let dis = [ResumeDismissal {
        kind: ResumeDismissalKind::RewatchContinueLast,
        episode_id: id(105),
        created_at: t(41),
    }];
    // The viewer watched S01E06 after answering: anchor moves to it.
    prog.retain(|r| r.media_file_id != id(10_106));
    prog.push(done(1, 6, t(42)));
    let p = plan(&eps, &prog, &dis);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S01E07");
}

#[test]
fn a_fresh_rewatch_anchor_asks_again() {
    let (eps, mut prog) = rewatch_state();
    let dis = [ResumeDismissal {
        kind: ResumeDismissalKind::RewatchContinueSeries,
        episode_id: id(105),
        created_at: t(41),
    }];
    // Later the viewer jumps back to S01E02 on their own.
    prog.retain(|r| r.media_file_id != id(10_102));
    prog.push(done(1, 2, t(50)));
    let p = plan(&eps, &prog, &dis);
    assert!(p.needs_choice);
    assert_eq!(labels(&p), vec!["S01E03", "S02E03"]);
}

#[test]
fn rewatching_a_finished_series_continues_the_rewatch_without_asking() {
    let eps = all(&[(1, 4)]);
    let mut prog = watched_run(1, 1, 4, 0);
    prog.retain(|r| r.media_file_id != id(10_102));
    prog.push(done(1, 2, t(30)));
    let p = plan(&eps, &prog, &[]);
    assert!(!p.needs_choice);
    assert_eq!(p.reason, ResumeReason::ContinueRewatch);
    assert_eq!(target(&p), "S01E03");
}

#[test]
fn bulk_mark_watched_in_one_instant_is_not_a_rewatch() {
    let eps = all(&[(1, 5)]);
    // All rows share a timestamp (mark season watched); the furthest wins.
    let prog: Vec<_> = (1..=3).map(|e| done(1, e, t(1))).collect();
    let p = plan(&eps, &prog, &[]);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S01E04");
}

#[test]
fn rewatch_with_a_gap_merges_into_one_chooser() {
    let eps = all(&[(1, 8), (2, 5)]);
    let mut prog = watched_run(1, 2, 8, 0);
    prog.extend(watched_run(2, 1, 2, 10));
    prog.retain(|r| r.media_file_id != id(10_105));
    prog.push(done(1, 5, t(40)));
    let p = plan(&eps, &prog, &[]);
    assert_eq!(
        p.ask_reasons,
        vec![
            ResumeAskReason::MissedEpisode,
            ResumeAskReason::RewatchBehindProgress
        ]
    );
    assert_eq!(labels(&p), vec!["S01E01", "S01E06", "S02E03"]);
}

// ---- Completed, multi-episode files, ordering ------------------------------------

#[test]
fn everything_watched_restarts() {
    let mut prog = watched_run(1, 1, 3, 0);
    prog.extend(watched_run(2, 1, 3, 10));
    let p = plan(&all(&[(1, 3), (2, 3)]), &prog, &[]);
    assert_eq!(p.action, ResumeAction::Restart);
    assert_eq!(p.reason, ResumeReason::CompletedRestart);
    assert!(!p.needs_choice);
    assert_eq!(target(&p), "S01E01");
}

#[test]
fn a_new_episode_after_completion_is_next() {
    let prog = watched_run(1, 1, 3, 0);
    let mut eps = all(&[(1, 3)]);
    eps.push(ep(1, 4));
    assert_eq!(target(&plan(&eps, &prog, &[])), "S01E04");
}

fn multi_episode_series() -> Vec<ResumeEpisode> {
    let mut eps = all(&[(1, 5)]);
    // E02 and E03 share one file.
    eps[2].media_file_id = eps[1].media_file_id;
    eps
}

#[test]
fn multi_episode_file_is_one_unit_with_a_range_label() {
    let eps = multi_episode_series();
    let p = plan(&eps, &[done(1, 1, t(1))], &[]);
    assert_eq!(target(&p), "S01E02-E03");
    let o = p.target.unwrap();
    assert_eq!((o.episode_number, o.episode_number_end), (2, Some(3)));
}

#[test]
fn watching_a_multi_episode_file_advances_past_both() {
    let eps = multi_episode_series();
    let prog = vec![done(1, 1, t(1)), done(1, 2, t(2))];
    assert_eq!(target(&plan(&eps, &prog, &[])), "S01E04");
}

#[test]
fn input_order_does_not_matter() {
    let mut eps = all(&[(2, 3), (1, 3), (0, 1)]);
    let prog = watched_run(1, 1, 2, 0);
    let a = plan(&eps, &prog, &[]);
    eps.reverse();
    let b = plan(&eps, &prog, &[]);
    assert_eq!(a, b);
    assert_eq!(target(&a), "S01E03");
}

#[test]
fn identical_inputs_give_identical_plans() {
    let (eps, prog) = rewatch_state();
    assert_eq!(plan(&eps, &prog, &[]), plan(&eps, &prog, &[]));
}

#[test]
fn progress_for_files_outside_the_series_is_ignored() {
    let mut stray = done(1, 1, t(1));
    stray.media_file_id = id(777_777);
    let p = plan(&all(&[(1, 3)]), &[stray], &[]);
    assert_eq!(p.action, ResumeAction::Start);
}

#[test]
fn skipping_ahead_with_in_progress_marks_the_gap() {
    let prog = vec![done(1, 1, t(1)), row(1, 4, 40, t(2))];
    let p = plan(&all(&[(1, 6)]), &prog, &[]);
    assert!(p.needs_choice);
    assert_eq!(labels(&p), vec!["S01E04", "S01E02", "S01E05"]);
}
