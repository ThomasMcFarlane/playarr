-- Soft-deleted users kept their username, and `users.username` is UNIQUE, so a deleted name could
-- never be registered again (re-creating a fixture user after a delete failed with a constraint
-- error). `UserRepo::delete` now renames the row to `<name>~deleted~<id>` as it tombstones it; this
-- does the same for tombstones written before that change. The id suffix keeps each one unique.
UPDATE users
SET username = username || '~deleted~' || id
WHERE deleted_at IS NOT NULL
  AND instr(username, '~deleted~') = 0;
