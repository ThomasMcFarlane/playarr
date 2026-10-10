# TASKS fragments

Do not edit `TASKS.md` in a PR. Add `tasks.d/<row-number>.md` per row you create or update.
`TASKS.md` stays the live board: the merge train folds each fragment into it when your PR lands.

```
section: Epic name (or "N. Epic name") of the "## N. Epic name" heading the row belongs to
| 330 | Task | todo | owner | feat/branch | 3.329 | 2026-10-10 14:00 ICT | Notes and evidence |
```

Epics are numbered: the heading is `## <N>. <Epic name>`, N a positive integer that is unique and stable
(never renumbered or reused). A task's reference is `<epic>.<task>` (for example `3.9926`); the ID column
keeps the bare ID. Name tasks by reference everywhere: Depends (comma-separated, each must resolve to a
row, and the epic must be the row's own), Notes, commits, PR titles and bodies, chat and reports.
A bare row ID in Depends that is on the board is rewritten to its reference when the fragment folds and
`--check` warns about it.

The row has the eight canonical columns `ID | Task | Status | Owner | Branch | Depends | ETA | Notes`.
Status is one of `todo`, `in_progress`, `in_review`, `blocked`, `blocked_on_owner`, `parked`, `done`. Branch,
Depends and ETA may be empty (write a single space between the pipes). ETA is
`YYYY-MM-DD HH:MM <timezone>`. Do not pad cells and write a literal pipe as `\|`. A row with status
`in_review` must name its PR (`PR open: #123`) in Notes. A fragment in the former five-column shape
(`| n | Task | status | owner | Notes |`) is still accepted and converted when it folds.

- Updating an existing row: the fragment holds the complete new row; it replaces the row with that number
  in place, in its current epic (a `section:` line is ignored and may be omitted).
- Title guard: a fragment for an existing number must keep that row's title (lowercased, punctuation
  stripped, word overlap of at least 0.5). Otherwise `--check` fails with `row <ref> title mismatch`,
  because a different task reusing the number would silently overwrite an unrelated row. If the rename
  is deliberate, add a leading `retitle: true` line. Two pending fragments for one number with different
  titles fail the same way. `remove:` fragments are exempt.
- Row numbers: use only the number the coordinator gives you. Never pick, guess or reuse one.
- New row: the `section:` line is required; the row is appended to that epic's table. The name is
  matched against the current `## ` headings after dropping a leading `Active: `, `Planned: ` or epic
  number (`N. `) and ignoring case, so the bare name and `N. Name` both work, and known renamed headings map to their new names (the table is `SECTION_ALIASES` in
  `scripts/lib/board.mjs`). A name that still matches no heading fails `--check` and the fold, listing the
  current headings; the fold never creates a heading from `section:`. To start a new epic on purpose,
  write `section-new: <name>` instead (it reuses an existing epic of that name, otherwise it creates
  `## <highest N + 1>. <name>`). Pick an unused number; a clash shows up as an add/add
  conflict on `tasks.d/<n>.md`.
- Validate locally: `node scripts/fold-fragments.mjs --check`.
- Removing a row: a fragment holding the line `remove: <row-number>` deletes that row from the board
  (an unknown row number fails the fold). Work in other repositories (for example Dubarr) is not
  tracked on this board, so do not add rows for it.

- ETA rule: every `in_progress` and `in_review` row needs an ETA (for `in_review`, the expected merge).
  `node scripts/fold-fragments.mjs --check` fails when one is missing and only warns when it is already
  in the past (a hard failure would break CI as time passes), so update or move the row. Rows nobody is
  working are `todo` (Owner empty), `blocked`, `blocked_on_owner` or `parked`, with no ETA. The board mod computes
  and shows the epic ETA itself.
