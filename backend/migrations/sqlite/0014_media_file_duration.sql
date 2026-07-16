-- Fixed source-container runtime cached on the media file itself.
--
-- New imports normally receive this from Sonarr/Radarr's ffprobe-derived
-- mediaInfo.runTime value. Existing rows are filled lazily from the real
-- source file the first time Playarr requests metadata, so opening a title
-- never causes the entire library to be probed again.
ALTER TABLE media_files ADD COLUMN duration_ms INTEGER;
