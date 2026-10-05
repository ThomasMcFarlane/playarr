-- Admin-controlled folder scanning (unsorted folders, TASKS 371).
--
-- `scan_enabled` is the explicit opt-in: a root is only walked by the
-- background scanner (and offered to viewers) once an administrator enables
-- it. Roots reported by a source application start disabled; roots an
-- administrator adds by hand (`source_root_id` starts with `manual:`) are
-- created enabled.
ALTER TABLE source_root_folders ADD COLUMN scan_enabled INTEGER NOT NULL DEFAULT 0;
