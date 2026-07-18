-- Carry the administrator's access choices through invitation redemption and
-- preserve requester context for the review queue.
ALTER TABLE user_invites ADD COLUMN can_stream INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_invites ADD COLUMN library_allow TEXT NOT NULL DEFAULT '[]';

ALTER TABLE user_invite_requests ADD COLUMN message TEXT;
ALTER TABLE user_invite_requests ADD COLUMN can_stream INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_invite_requests ADD COLUMN library_allow TEXT NOT NULL DEFAULT '[]';
