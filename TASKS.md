# Tasks

Live task board for Playarr. Every tracked unit of work is listed here with its
status and the agent that picked it up. Update tasks as they start, progress,
and complete. `CHANGELOG.md` remains the permanent engineering log; this file
is the current-work board. Newest and most active work goes first.

## Active — private Google Play publishing (2026-08-27)

| # | Task | Status | Picked up by | Notes |
|---|------|--------|--------------|-------|
| 1 | Publish the native Android app privately through Google Play with automatic GitHub Actions delivery | in progress — `0.2.15` published by self-hosted CI; App content and tester access pending | codex-20260827-google-play | Google Play uses `app.playarr.mobile` while the existing sideload channel temporarily retains `io.playarr.mobile` for compatible updates. Self-hosted run `<id>` built, tested, signed, verified, artefacted, and published versionCode `2015` through the repository-scoped `playarr-runners` ARC pool on dev-host. Publisher API verification on 28 August confirms `completed:2015` and the complete visual listing in every configured language (`en-GB` and `en-US`); CI now discovers all listing locales so new languages receive the shared visual assets too. Public signed-out legal routes, including the Google Play privacy-policy URL, are being deployed on `playarr.app`. Remaining: complete every required Play Console App content declaration, ensure the tester list is selected on the internal track, then verify install/update on phone and Android TV/Google TV. |

## Conventions

- One row per unit of work; newest work goes in the active section.
- Status values: `pending`, `in progress`, `blocked`, `done`.
- `Picked up by` names a concrete session, subagent resume id, or tracked
  background task id. List handoffs with `→`.
- Completed sections may be collapsed into `CHANGELOG.md` entries and removed
  after the work ships.
- Commit `TASKS.md` changes promptly without sweeping unrelated staged work
  into the commit.
