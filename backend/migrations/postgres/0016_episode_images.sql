-- PostgreSQL mirror of `../sqlite/0013_episode_images.sql`.
ALTER TABLE episodes ADD COLUMN images TEXT NOT NULL DEFAULT '[]';
