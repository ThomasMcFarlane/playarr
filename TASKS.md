# Tasks

Live task board for Playarr. Every tracked unit of work is listed here with its
status and the agent that picked it up. Update tasks as they start, progress,
and complete. `CHANGELOG.md` remains the permanent engineering log; this file
is the current-work board. Newest and most active work goes first.

## Active — private Google Play publishing (2026-08-27)

| # | Task | Status | Picked up by | Notes |
|---|------|--------|--------------|-------|
| 1 | Publish the native Android app privately through Google Play with automatic GitHub Actions delivery | pending — owner console setup required | codex-20260827-google-play | Before the first Play upload, change the application/package ID from `io.playarr.mobile` to `app.playarr.mobile` (reverse of `playarr.app`) and account for existing sideload installs. Create and verify the Play developer account and app; preserve the existing signing identity through Play App Signing; configure an app-scoped service account with only read-only app access and testing-track release permission; store its JSON as a GitHub environment secret; build and verify an AAB; bootstrap the first internal-testing release; then publish every later `android-v*` tag automatically to the internal track. Keep the app undiscoverable and verify opt-in installation/update on phone and Android TV/Google TV. |

## Conventions

- One row per unit of work; newest work goes in the active section.
- Status values: `pending`, `in progress`, `blocked`, `done`.
- `Picked up by` names a concrete session, subagent resume id, or tracked
  background task id. List handoffs with `→`.
- Completed sections may be collapsed into `CHANGELOG.md` entries and removed
  after the work ships.
- Commit `TASKS.md` changes promptly without sweeping unrelated staged work
  into the commit.
