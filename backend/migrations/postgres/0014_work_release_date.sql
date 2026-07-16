-- Postgres mirror of ../sqlite/0011_work_release_date.sql -- see that file
-- for the full rationale. Numbered 0014 here (the sqlite/postgres migration
-- directories are independent `Migrator`s -- see `0009_source_instances.sql`'s
-- own note on this convention).
ALTER TABLE works ADD COLUMN release_date TEXT;
