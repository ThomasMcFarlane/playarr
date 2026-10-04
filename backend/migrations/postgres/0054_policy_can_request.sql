-- Postgres mirror of `../sqlite/0053_policy_can_request.sql`.
ALTER TABLE policies ADD COLUMN can_request INTEGER NOT NULL DEFAULT 0;
