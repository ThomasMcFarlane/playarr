# TASKS fragments

Do not edit `TASKS.md` in a PR. Add `tasks.d/<row-number>.md` per row you create or update.
`TASKS.md` stays the live board: the merge train folds each fragment into it when your PR lands.

```
section: Heading text of the "## " epic the row belongs to
| 330 | Task | todo | owner | feat/branch | 329 | 2026-10-10 14:00 ICT | Notes and evidence |
```

The row has the eight canonical columns `ID | Task | Status | Owner | Branch | Depends | ETA | Notes`.
Status is one of `todo`, `in_progress`, `in_review`, `blocked`, `blocked_on_owner`, `parked`, `done`. Branch,
Depends and ETA may be empty (write a single space between the pipes). ETA is
`YYYY-MM-DD HH:MM <timezone>`. Do not pad cells and write a literal pipe as `\|`. A row with status
`in_review` must name its PR (`PR open: #123`) in Notes. A fragment in the former five-column shape
(`| n | Task | status | owner | Notes |`) is still accepted and converted when it folds.

- Updating an existing row: the fragment holds the complete new row; it replaces the row with that number
  in place (the `section:` line may be omitted).
- New row: the `section:` line is required; the row is appended to that section's table (the section
  is created at the top if it does not exist). Pick an unused number; a clash shows up as an add/add
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
