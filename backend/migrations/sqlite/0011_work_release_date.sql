-- Adds `streamarr_model::Work::release_date` -- the real release date this
-- title's source *arr app reports (Radarr digitalRelease/physicalRelease,
-- Sonarr firstAired), distinct from `added_at` (when Streamarr itself
-- learned about the work). Nullable: arr-sync only populates this for
-- Movie/Series kinds whose source app actually reports it (see
-- streamarr-arr-sync/src/arr_client.rs's map_radarr/map_sonarr); Artist/
-- Author works keep this NULL (their own children -- albums/books -- carry
-- release_date already; the parent aggregate has no single release date of
-- its own). TEXT/ISO-8601, same convention as added_at.
ALTER TABLE works ADD COLUMN release_date TEXT;
