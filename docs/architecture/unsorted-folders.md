# Unsorted folders (native folder browsing)

Scope: TASKS row 371. Media that Radarr, Sonarr and the other source applications do not manage
("unsorted" files) is browsable and playable as a plain folder tree on every complete client.

## Model

- `source_root_folders` holds one row per root folder. Roots come from two places: a media-owning
  source application reports them (`GET /api/v3|v1/rootfolder`, discovered on a timer and on demand),
  or an administrator adds a directory by hand (`source_root_id` starts with `manual:`).
- A root is **off by default**. Only roots an administrator enabled (`scan_enabled`) are scanned and
  offered to viewers. Manual roots start enabled.
- A root's directory on this server is its explicit local path when set, else the reported path mapped
  through the source's folder mapping, else the reported path as is.
- `folder_media_entries` holds one row per playable file below an enabled root: a normalised
  root-relative path plus probed facts. Each file also has an ordinary `media_files` row and a hidden
  backing work (reserved external provider `playarr_folder`), so playback negotiation, direct play,
  HLS, thumbnails, downloads and watch progress all use the existing `media_file_id` routes. Hidden
  works are excluded from catalogue enumeration (`WorkRepo::list_by_kind`) and from peer availability.
- Ids are deterministic (UUID v5 from the root and the relative path), so a rescan is idempotent and
  playback URLs stay stable.

## Scanning

`folder_scan::run_folder_scanner` (API role, every `PLAYARR_FOLDER_SCAN_INTERVAL_SECS`, default 900,
`0` disables) discovers roots, then scans every enabled root. Admins can scan one root on demand.
A scan walks the directory without following symbolic links, skips hidden entries, keeps only video
(movie, series, site roots) or audio (artist, author roots) extensions, and skips files a source
application already manages (compared in both the reported and the mapped path form). Only new and
changed files (size or modification time differ) are probed with ffprobe; vanished or newly managed
files are removed. One `library` live event (`folder_root` / root id / `entries`) is published per scan
that changed anything.

## API

Viewers (`CatalogViewer`, library access applies):

- `GET /api/v1/folders/roots?kind=` lists enabled roots the caller may browse (path-free).
- `GET /api/v1/folders/roots/{root_id}/browse?path=&q=&sort=&order=&type=&limit=&offset=` returns one
  directory level, sub-directories first. `sort` is `name`, `modified`, `size` or `duration`; `type`
  is `all`, `directories` or `media`. Media entries carry the caller's own resume state
  (`watch_state`, `position_ms`) and a `media_file_id` to play.

Administrators:

- `GET /api/v1/admin/folders/roots`, `POST /api/v1/admin/folders/discover`,
  `POST /api/v1/admin/folders/roots` (add a manual root), `PATCH .../{root_id}` (`scan_enabled`,
  `local_path`, `name`), `DELETE .../{root_id}` (manual roots only), `POST .../{root_id}/scan`.

## Access rules

- Library access: a root belongs to its source's library; callers without it see and open nothing.
- Household: a profile under rating or tag rules gets no folder content (the files are unrated).
  Blocked folders hide files and roots by their server path, for browsing and playback alike.
- Paths: clients send and receive root-relative paths only; `..`, backslashes and NUL are rejected, and
  no server path appears in any viewer response.
