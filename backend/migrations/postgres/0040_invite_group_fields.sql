-- Postgres mirror of ../sqlite/0037_invite_group_fields.sql -- see that
-- file for the full rationale. Numbered 0040 here (independent `Migrator`
-- from the sqlite side -- see 0009_source_instances.sql's own note on this
-- convention).

ALTER TABLE user_invites ADD COLUMN group_library_allow TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_invites ADD COLUMN updated_at TEXT;
ALTER TABLE user_invites ADD COLUMN consumed_at TEXT;
ALTER TABLE user_invites ADD COLUMN consumed_by_user_id TEXT;
ALTER TABLE user_invites ADD COLUMN consumed_by_peer_id TEXT;

ALTER TABLE user_invite_requests ADD COLUMN group_library_allow TEXT NOT NULL DEFAULT '[]';
