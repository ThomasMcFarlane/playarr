-- Adds `Work::end_date`: when an ended series last aired, per its source Sonarr
-- (`lastAired`, falling back to `previousAiring`, only while the series status
-- is "ended"). Lets clients label a finished series with its year range
-- ("Series · 2011–2019"). NULL for movies, running series and anything the
-- source reports no last-aired date for. TEXT/ISO-8601, same as release_date.
ALTER TABLE works ADD COLUMN end_date TEXT;
