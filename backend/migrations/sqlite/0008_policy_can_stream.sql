-- Adds `Policy::can_stream`: whether an account may sign in to Playarr (the
-- consumer streaming client family) at all, independent of `is_admin` -- see
-- that field's doc comment on `playarr_model::Policy` for why the two
-- don't imply each other. `DEFAULT 0` matches `library_allow`'s existing
-- least-privilege-by-default philosophy: an admin has to explicitly grant
-- streaming access, including for their own account if they also want to use
-- Playarr day to day.
--
-- 0/1, not a SQL `BOOLEAN` column -- same reason as every other boolean on
-- `policies` (see `0007_users_policies.sql`'s file-level note).

ALTER TABLE policies ADD COLUMN can_stream INTEGER NOT NULL DEFAULT 0;
