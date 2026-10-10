-- A file the source no longer lists but that cannot be safely deleted (no
-- replacement row to carry viewers' resume positions and choices) is marked
-- missing instead of removed. NULL means present. Missing rows are hidden from
-- playable and availability views; watch progress, playback preferences and
-- download tickets that point at them stay intact. The next sync that lists the
-- same source file id clears the mark.
ALTER TABLE media_files ADD COLUMN missing_since TEXT;
