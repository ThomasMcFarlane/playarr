# Smart Start/Resume for TV series

The series detail page leads with one primary button on the left: **Start**
when nothing has been watched, otherwise **Resume**. The server decides what
it plays. When the viewer is simply watching through in order it plays the
next episode without asking. A chooser is shown only when the history is
ambiguous. Home "Continue Watching" shows a series with more than one option
as a stacked card and asks there too.

## Contract

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/catalog/{id}/resume-plan` | The plan for one series and the signed-in profile. |
| `POST /api/v1/catalog/{id}/resume-plan/choice` | Body `{kind, episode_id}`: the option the viewer picked. Records the answer, returns the updated plan. 400 if the option is not in the current plan. |
| `DELETE /api/v1/catalog/{id}/resume-plan/choices` | Forget every recorded answer for the series ("ask again"). |
| `GET /api/v1/playback/resume-plans` | Plans for series the profile has history in, newest first (Home). |

A plan has `action` (`start`, `resume`, `restart`), a deterministic `reason`,
`needs_choice`, `ask_reasons`, `target` (what to play when no choice is
needed) and `options` (the chooser entries; `target` is first). Each option
carries the episode label (`S01E05`, `S01E01-E02` for a multi-episode file),
title, position, duration, percent played and when it was last watched.

Clients play `target` when `needs_choice` is false. Otherwise they show the
options, play the one the viewer picks and report it with the choice endpoint
(report before or while starting playback; the call is idempotent). Closing
the chooser without picking records nothing.

## Rules (`playarr_model::resume`)

Episodes are ordered by season then number. Episodes without a media file are
skipped (a hole in the library is never a gap). Episodes sharing one file are
one unit. Specials (season 0) sort last and are never offered as a gap or as
"next", but a half-watched special can be resumed. A series of only specials
treats them as regular.

A unit is **watched** at 90% or more (or when the stored state says so),
**untouched** below 5% (an accidental open does not count) and **in progress**
in between. Without a known duration, 60 seconds played counts as in progress.

1. Nothing watched or in progress: `start` at the first episode.
2. **Unfinished** (chooser): two or more in-progress units, one that is not the
   most recent activity, or one behind further progress. A single in-progress
   episode that is the latest activity resumes without asking.
3. **Missed episode** (chooser): an untouched regular unit before the furthest
   watched or in-progress unit, not dismissed. Options: the earliest gap and
   the next episode in the series (or "start over" when the series is complete).
   Picking anything else dismisses the whole contiguous run of gaps.
4. **Rewatch** (chooser): the most recently watched unit is a finished one
   behind the furthest progress and a next-in-series episode exists. Options:
   continue from the last watched (the episode after it) or next in series.
   Either answer is remembered for that anchor; "continue from last" carries
   over to the following episodes of the same pass.
5. Otherwise the next episode after the furthest progress. When everything is
   watched: `restart` at the first episode (a rewatch in progress continues
   instead).

Activity within 60 seconds counts as simultaneous (bulk "mark watched"); the
furthest episode wins. Several triggers merge into one chooser; options that
point at the same episode are shown once.

## Storage

`resume_dismissals (user_id, series_work_id, episode_id, kind, created_at)`,
primary key `(user_id, episode_id, kind)`; kinds `missed_episode`,
`rewatch_continue_last`, `rewatch_continue_series`. Per profile (a profile is a
user) and removed with the user or the series.
