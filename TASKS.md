# Tasks

Live task board for Playarr. Every tracked unit of work is listed here with its
status and the agent that picked it up. Update tasks as they start, progress,
and complete. `CHANGELOG.md` remains the permanent engineering log; this file
is the current-work board. Newest and most active work goes first.

## Active — private Google Play publishing (2026-08-27)

| # | Task | Status | Picked up by | Notes |
|---|------|--------|--------------|-------|
| 1 | Publish the native Android app privately through Google Play with automatic GitHub Actions delivery | in progress — internal `0.2.17` published; app-level draft blocks review and reliable tester access | codex-20260827-google-play | Google Play uses `app.playarr.mobile`; the sideload-only `io.playarr.mobile` flavour retains LAN HTTP and signed APK updates. Self-hosted run `<id>` built, tested, signed, verified, artefacted, and published versionCode `2017` to the internal track through `playarr-runners`; lifecycle read-back remains `RELEASE_LIFECYCLE_STATE_PUBLISHED`. On 29 August, Internal App Sharing returned `NOT_PUBLISHED`, proving that the app itself remains draft. VersionCode `2017` is now committed to the private `alpha` track as `RELEASE_LIFECYCLE_STATE_DRAFT`; Google rejects promotion with `Only releases with status draft may be created on draft app.` The official Android Publisher v3 discovery document has no regular-app draft-to-review endpoint and exposes only Data Safety among App content declarations. Remaining unavoidable bootstrap: complete the required Play Console App content cards and send the app for first review; then promote the prepared private closed release through API and prove phone plus Android TV/Google TV installation. |

## Conventions

- One row per unit of work; newest work goes in the active section.
- Status values: `pending`, `in progress`, `blocked`, `done`.
- `Picked up by` names a concrete session, subagent resume id, or tracked
  background task id. List handoffs with `→`.
- Completed sections may be collapsed into `CHANGELOG.md` entries and removed
  after the work ships.
- Commit `TASKS.md` changes promptly without sweeping unrelated staged work
  into the commit.
