-- Invite portability -- `docs/architecture/peer-groups.md` §2.5 (Phase 4).
--
-- `group_library_allow` carries the same portable, group-wide library grant
-- `Policy::group_library_allow` already uses (§5.1) onto an invite,
-- alongside the existing node-local `library_allow`, so an invite issued
-- against a `GroupLibrary` grants correctly on whichever peer redeems it
-- (§6.1's multi-address invite links land in a later pass; this is just
-- the underlying grant).
--
-- `consumed_at`/`consumed_by_user_id`/`consumed_by_peer_id` resolve the
-- "invite redeemed against two peers during a partition" race explicitly
-- (§6.1/§3.5) instead of leaving it to luck: redemption becomes a soft
-- consume (this row survives, `consumed_at` set) rather than the hard
-- `DELETE` `UserInviteRepo::consume` used before, so a consumed invite's
-- state can actually propagate through gossip instead of only ever being
-- visible on whichever single peer happened to serve the redemption.
-- `updated_at` is added for exactly that: it lets `UserInviteRepo` cursor
-- sync on "did this row change" (creation *or* consumption), not just
-- `created_at` -- see that trait's own `list_updated_since` doc comment.
-- Nullable (an `ALTER TABLE` can't retroactively backfill it `NOT NULL` on
-- SQLite) but never actually `NULL` for a row written by this codebase
-- going forward: no backfill `UPDATE` is needed the way `users`/`policies`
-- got one (`0033_peer_sync_state.sql`) -- invites are always short-lived
-- (`USER_INVITE_TTL`, 24h), so any pre-migration row simply expires on its
-- own well within the window before its absent `updated_at` could matter.
ALTER TABLE user_invites ADD COLUMN group_library_allow TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_invites ADD COLUMN updated_at TEXT;
ALTER TABLE user_invites ADD COLUMN consumed_at TEXT;
ALTER TABLE user_invites ADD COLUMN consumed_by_user_id TEXT;
ALTER TABLE user_invites ADD COLUMN consumed_by_peer_id TEXT;

ALTER TABLE user_invite_requests ADD COLUMN group_library_allow TEXT NOT NULL DEFAULT '[]';
