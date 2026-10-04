-- Smart Start/Resume answers (docs/architecture/smart-resume.md): a viewer
-- declining a missed episode, or choosing how to continue a rewatch, is
-- remembered per profile so the chooser is not shown again for that gap.
-- `episode_id` is the first episode of the unit the answer concerns.
CREATE TABLE IF NOT EXISTS resume_dismissals (
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    series_work_id TEXT NOT NULL REFERENCES works (id) ON DELETE CASCADE,
    episode_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, episode_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_resume_dismissals_user_series
    ON resume_dismissals (user_id, series_work_id);
