-- Postgres mirror of `../sqlite/0077_release_deleted_usernames.sql`: rename existing soft-deleted
-- users so their usernames can be registered again.
UPDATE users
SET username = username || '~deleted~' || id
WHERE deleted_at IS NOT NULL
  AND position('~deleted~' in username) = 0;
