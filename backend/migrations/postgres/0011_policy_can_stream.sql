-- Postgres mirror of `../sqlite/0008_policy_can_stream.sql` -- see that file
-- for the full rationale. Adds `Policy::can_stream`: whether an account may
-- sign in to Playarr at all, independent of `is_admin`. `DEFAULT 0` matches
-- `library_allow`'s existing least-privilege-by-default philosophy.
--
-- Kept as `INTEGER` 0/1, not a native `boolean`, for the same cross-engine
-- consistency reason as every other boolean on `policies`.

ALTER TABLE policies ADD COLUMN can_stream INTEGER NOT NULL DEFAULT 0;
