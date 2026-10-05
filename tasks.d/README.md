# TASKS fragments

Do not edit `TASKS.md` in a PR. Add `tasks.d/<row-number>.md` per row you create or update.
`TASKS.md` stays the live board: the merge train folds each fragment into it when your PR lands.

```
section: Heading text of the "## " section the row belongs to
| 330 | Task | status | owner | Notes and evidence |
```

- Updating an existing row: the fragment holds the complete new row; it replaces the row with that number
  in place (the `section:` line may be omitted).
- New row: the `section:` line is required; the row is appended to that section's table (the section
  is created at the top if it does not exist). Pick an unused number; a clash shows up as an add/add
  conflict on `tasks.d/<n>.md`.
- Validate locally: `node scripts/fold-fragments.mjs --check`.
