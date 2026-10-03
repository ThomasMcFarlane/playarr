# Playarr portable user-data format, version 1

This is the normative specification of the package a person downloads from
"Export my data" and can upload to the same or another Playarr Server. It is
designed to be readable without Playarr: open the CSV files in a spreadsheet
and `playarr-user-data.json` in any text editor.

Design context and the server behaviour around it are in
[`../architecture/user-portability.md`](../architecture/user-portability.md).

## Package

The package is a ZIP file named `playarr-user-data-<UTC date>.zip`. Entry names
are plain relative paths using `/` separators and no directories other than
`schema/`.

| Entry | Role | Imported? |
|---|---|---|
| `README.txt` | Human-readable summary of the package and this format. | No |
| `playarr-user-data.json` | **Canonical data.** UTF-8 JSON, no byte-order mark. | **Yes** |
| `schema/playarr-user-data-v1.schema.json` | JSON Schema (draft 2020-12) of the canonical file. | No |
| `watch-progress.csv` | Convenience view of `watch_progress`. | No |
| `playlists.csv` | Convenience view of `playlists`. | No |
| `playlist-items.csv` | Convenience view of playlist entries, in playlist order. | No |

**Canonical JSON versus convenience CSV.** Only `playarr-user-data.json` is
ever read by an import. The CSV files exist so that a person can sort, filter
and inspect their data in a spreadsheet; they are regenerated from the JSON
content on every export, drop structure (for example provider identifiers are
flattened into columns), and are ignored on import. Editing a CSV has no
effect. To correct data before importing, edit the JSON.

All CSV files are UTF-8 with a byte-order mark (so spreadsheets detect the
encoding), comma-separated, `\r\n` record separators, RFC 4180 quoting, and a
header row. Cells whose first character is `=`, `+`, `-`, `@`, tab or carriage
return are prefixed with a single quote (`'`) so a spreadsheet cannot evaluate
them as a formula. The JSON is never altered this way.

## Versioning

`format` is always the string `playarr.user-data`. `schema_version` is a
positive integer.

* A change that adds optional fields, or new values in an open enumeration
  (`kind`, provider keys), keeps the same `schema_version`. Readers must ignore
  unknown fields.
* A change that removes or reinterprets a field increments `schema_version`.
  Servers refuse a package whose `schema_version` is higher than they support
  (reporting the version found and the versions supported) and refuse any
  package whose `format` differs. Older versions are read by a dedicated
  upgrade step; version 1 is the first.

New library kinds (for example games) extend `kind` and the item reference
fields; each addition ships with a compatibility test that a version 1 reader
still imports every other record in a package containing it (unknown kinds are
reported as unsupported, never silently dropped).

## Conventions

* **Timestamps**: RFC 3339 in UTC with a `Z` suffix, for example
  `2026-10-03T18:04:05Z`. No local time zone is stored.
* **Durations and positions**: integer milliseconds.
* **Identifiers**: UUID strings in lower-case hyphenated form. They identify
  records on the *source* server only and are never trusted as destination
  keys.
* **Text**: Unicode, NFC is not enforced on export; matching normalises (see
  below). Titles are data, never instructions.
* **Absent data**: a field Playarr did not store is omitted or `null`. Nothing
  is invented: Playarr stores one resume state per title, not a log of every
  viewing, so there are no per-view watch events or play counts, and the export
  does not contain them.

## `playarr-user-data.json`

```jsonc
{
  "format": "playarr.user-data",
  "schema_version": 1,
  "generated_at": "2026-10-03T18:04:05Z",
  "generator": { "name": "playarr-server", "version": "0.1.0" },
  "source": { "instance_name": "Living room server" },
  "owner": { "display_name": "alex" },        // attribution only
  "preferences": { "preferred_audio_language": "en" },
  "watch_progress": [ /* WatchRecord */ ],
  "playback_preferences": [ /* PlaybackPreferenceRecord */ ],
  "playlists": [ /* Playlist */ ],
  "ratings": [],                               // reserved, see below
  "watchlist": [],                             // reserved, see below
  "unmatched": [ /* UnmatchedRecord */ ]       // only in an "unmatched" package
}
```

`owner.display_name` is informational. An import **never** uses the package to
choose whose data is changed: the destination is always the signed-in user.

### ItemRef

Identifies one piece of content portably. A destination server resolves it with
the stable provider identifiers first and the human-readable fields second.

| Field | Type | Notes |
|---|---|---|
| `kind` | string | `movie`, `episode`, `series`, `site`, `track`, `artist`, `book`, `author`. Open enumeration. |
| `title` | string | Title of the work (series, movie, artist, author). |
| `year` | integer or null | Release year of the work. |
| `external_ids` | object | Provider key to identifier of the **work**: `tmdb`, `tvdb`, `imdb`, `musicbrainz_artist`, `musicbrainz_release_group`, `goodreads`, `isbn`, `asin`, `tpdb`, or `other:<name>`. |
| `season_number`, `episode_number`, `episode_title` | integer, integer, string | Episodes only. |
| `album_title`, `disc_number`, `track_number`, `track_title` | string, integer, integer, string | Tracks only. |
| `playarr` | object | `{ "work_id": uuid, "leaf_id": uuid or null }` as on the source server. |

### WatchRecord

| Field | Type | Notes |
|---|---|---|
| `item` | ItemRef | A playable leaf: `movie`, `episode`, `track`, or `book`. |
| `state` | string | `part_watched` or `watched`. `unseen` rows are not exported. |
| `position_ms` | integer | Resume position. |
| `duration_ms` | integer | Duration known when the position was stored (0 if unknown). |
| `updated_at` | timestamp or null | When the state last changed on the source server. |

### PlaybackPreferenceRecord

Per-title player choices.

| Field | Type | Notes |
|---|---|---|
| `item` | ItemRef | |
| `quality_id` | string | `original` or a quality identifier. |
| `audio_track_id`, `subtitle_track_id` | string or null | Track identifiers are server specific and are applied only when the destination has an identical identifier for the matched file; otherwise only `quality_id` is applied. |

### Playlist

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Local to the package: used for `parent_id`. |
| `name` | string | |
| `media_type` | string | `video` or `audio`. |
| `parent_id` | uuid or null | `id` of the parent playlist in the same package. |
| `created_at`, `updated_at` | timestamps | |
| `items` | array | Ordered. Each: `{ "position": int, "added_at": timestamp, "item": ItemRef }`. `position` is zero-based and dense; the array order is authoritative. |

Only playlists the user owns are exported. "System" playlists (administrator
managed, visible to everyone) are not the user's data and are not exported, and
other people's playlists are never included.

### Ratings and watchlist

Playarr version 1 stores neither personal ratings nor a separate watchlist
(watch-later is a playlist). The arrays are present and empty so the format
has a stable place for them; importers ignore them until a later
`schema_version` defines their records. A watchlist implemented as a playlist
is exported and imported as a playlist.

### UnmatchedRecord

Produced by an import's "unmatched" download so nothing is lost. Same shape as
the records above wrapped as
`{ "section": "watch_progress" | "playback_preferences" | "playlist_item",
"reason": "no_match" | "ambiguous" | "unsupported_kind" | "not_accessible",
"playlist_name": string or null, "record": <original record> }`.
An unmatched package is itself a valid package: it can be uploaded again after
the missing library content has been added.

## Matching rules (normative for importers)

For each ItemRef the importer resolves a work, then a leaf:

1. **Work by external identifier.** Try `tmdb`, `tvdb`, `imdb`, then the other
   providers present, in that order. A single distinct work found by an
   identifier is a match. Identifiers matching two or more distinct works are
   **ambiguous**.
2. **Work by title (fallback).** Only when no identifier matched anything and
   the package supplied no identifiers or none are known here. Titles are
   compared after Unicode NFKC normalisation, case folding, removal of
   punctuation and a leading article, and whitespace collapse. An exact
   normalised equality of the same `kind` whose `year` agrees (or is unknown on
   either side) is a match when it is the only candidate. A fuzzy similarity of
   at least 0.92 (normalised Levenshtein/Jaro-Winkler blend) with agreeing year
   is a match only when it is the unique best candidate and clearly better than
   the runner-up; anything weaker is **ambiguous** (candidates reported) or
   **no match**. The importer never guesses.
3. **Leaf.** Episodes by `season_number` and `episode_number`; tracks by album
   and `disc_number`/`track_number`, falling back to a normalised
   `track_title`; movies are the work itself.
4. **Visibility.** The matched work must be visible to the importing user under
   their library permissions, otherwise the record is `not_accessible` (the
   result must not reveal whether the content exists).

## Import semantics (normative for importers)

* Merge, never replace. Nothing is deleted.
* **Watch progress**: a record is applied only when the destination has no
  state for that file, or the incoming `updated_at` is later than the existing
  one; `watched` is never downgraded to `part_watched` by an older record.
  Applying the same package twice changes nothing.
* **Playlists**: a playlist is matched by case-insensitive name, `media_type`
  and parent among the user's own playlists. A new playlist is created when
  none matches; items already present are not duplicated and new items are
  appended in package order.
* **Preferences**: `preferred_audio_language` is applied only if the user
  chooses to include preferences; the value is validated.
* Accounts, passwords, permissions, library grants, tokens, devices, sessions
  and media files are never read from, or written by, an import.

## Limits

An importer enforces at least: a 50 MiB archive, 200 MiB total expanded size,
at most 16 entries, a 64 MiB JSON document, 500,000 records and string fields
of at most 2,000 characters. Entry names with `..`, a leading `/`, `\`, a drive
letter or NUL are rejected, as are symbolic links and encrypted entries.
Entries not listed in the table above are ignored.
