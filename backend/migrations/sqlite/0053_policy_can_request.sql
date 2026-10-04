-- Per-user request permission (`Policy::can_request`): whether an account may
-- request titles that are not in the library through discovery. Least
-- privilege: existing accounts default to no. Administrators always may.
ALTER TABLE policies ADD COLUMN can_request INTEGER NOT NULL DEFAULT 0;
