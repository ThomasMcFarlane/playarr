# Tasks

Live task board for Playarr. Every tracked unit of work is listed here with its
status and the agent that picked it up. Update tasks as they start, progress,
and complete. `CHANGELOG.md` remains the permanent engineering log; this file
is the current-work board. Newest and most active work goes first.

## Active — private Google Play publishing (2026-08-27)

| # | Task | Status | Picked up by | Notes |
|---|------|--------|--------------|-------|
| 1 | Publish the native Android app privately through Google Play with automatic GitHub Actions delivery | in progress — `0.2.14` published; tester install pending | codex-20260827-google-play | Google Play uses `app.playarr.mobile` while the existing sideload channel temporarily retains `io.playarr.mobile` for compatible updates. Internal release versionCode `2014`, the Play listing, and every required phone/TV asset are committed. The app-scoped publisher credential and dedicated Play upload identity are stored in the `release-android` GitHub environment; CI publishes manual releases and every later `android-v*` tag. Remaining owner actions: clear the GitHub Actions billing/spending-limit block, select or create the internal tester email list in Play Console, then verify the opt-in install/update on phone and Android TV/Google TV. |

## Conventions

- One row per unit of work; newest work goes in the active section.
- Status values: `pending`, `in progress`, `blocked`, `done`.
- `Picked up by` names a concrete session, subagent resume id, or tracked
  background task id. List handoffs with `→`.
- Completed sections may be collapsed into `CHANGELOG.md` entries and removed
  after the work ships.
- Commit `TASKS.md` changes promptly without sweeping unrelated staged work
  into the commit.
