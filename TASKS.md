# Tasks

Live task board for Playarr. Every tracked unit of work is listed here with its
status and the agent that picked it up. Update tasks as they start, progress,
and complete. `CHANGELOG.md` remains the permanent engineering log; this file
is the current-work board. Newest and most active work goes first.

## Active — private Google Play publishing (2026-08-27)

| # | Task | Status | Picked up by | Notes |
|---|------|--------|--------------|-------|
| 1 | Publish the native Android app privately through Google Play with automatic GitHub Actions delivery | in progress — `0.2.17` published by self-hosted CI; Console submission and tester install proof pending | codex-20260827-google-play | Google Play uses `app.playarr.mobile`; the sideload-only `io.playarr.mobile` flavour retains LAN HTTP and signed APK updates. Self-hosted run `<id>` built, tested, signed, verified, artefacted, and published versionCode `2017` to the completed internal track through the repository-scoped `playarr-runners` ARC pool. Publisher API read-back on 28 August confirms `Playarr 0.2.17`, `completed:2017`; support contact details and the icon plus all visual assets remain configured in every language (`en-GB` and `en-US`). Public signed-out legal routes are live at `playarr.app`, `support@playarr.app` forwards to its verified destination, and a synthetic-content video demonstrates the user-started `FOREGROUND_SERVICE_DATA_SYNC` offline-download flow without exposing private media. Remaining: submit the completed answers and video link in the Play Console App content card, verify the invited individual tester can opt in, then prove install/update on phone and Android TV/Google TV. |

## Conventions

- One row per unit of work; newest work goes in the active section.
- Status values: `pending`, `in progress`, `blocked`, `done`.
- `Picked up by` names a concrete session, subagent resume id, or tracked
  background task id. List handoffs with `→`.
- Completed sections may be collapsed into `CHANGELOG.md` entries and removed
  after the work ships.
- Commit `TASKS.md` changes promptly without sweeping unrelated staged work
  into the commit.
