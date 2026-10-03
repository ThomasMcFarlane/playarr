# Aggregated release calendar

Tracks TASKS 74-77. One calendar of upcoming releases across every connected
*arr instance, served by Playarr Server and shown on every client, plus an
external iCal subscription and a per-series "time until available" statistic.

## 1. Sources

The calendar reads each *arr app's own calendar API through
`playarr-arr-client`; nothing is cached in the database.

| Source kind | Endpoint | Entry | Release dates used |
|-------------|----------|-------|--------------------|
| Sonarr | `GET /api/v3/calendar?start&end&unmonitored=true&includeSeries=true` | episode | `airDateUtc` (falls back to `airDate`) |
| Radarr | `GET /api/v3/calendar?start&end&unmonitored=true` | movie | `inCinemas`, `digitalRelease`, `physicalRelease` (one entry per date inside the window) |
| Lidarr | `GET /api/v1/calendar?start&end&unmonitored=true&includeArtist=true` | album | `releaseDate` |
| Readarr | `GET /api/v1/calendar?start&end&unmonitored=true&includeAuthor=true` | book | `releaseDate` |

Whisparr, Bazarr and Prowlarr are not calendar sources. Radarr's three dates
are separate entries (`release_type` `cinema`, `digital`, `physical`) so a
client can filter by the release it cares about.

## 2. Normalised entry

`playarr_model::CalendarEntry` (OpenAPI schema `CalendarEntry`):

- `id`: stable string derived from the dedup key, safe to use as a list key
- `media_kind`: `episode | movie | album | book`
- `release_type`: `air | cinema | digital | physical | release`
- `title`: series, movie, artist or author title; `subtitle`: episode title
  (with `season_number`/`episode_number`), album title or book title
- `date`: UTC calendar day (`YYYY-MM-DD`); `release_at`: exact instant when
  the source provides one, otherwise absent (all-day entry)
- `monitored`, `has_file` (library state in the source)
- `poster_url`: only an absolute external artwork URL; never an *arr-local,
  API-key-gated path
- `work_id`: the matching catalog `Work` when the series/movie/artist/author
  is already in the catalog (resolved through `Work::external_refs`), so a
  client can open the detail page
- `sources[]`: every instance that reported the entry (`source_instance_id`,
  `source_name`, `source_kind`, `arr_id`)

### Deduplication

Two instances (for example two Sonarr instances, or a 4K and an HD Radarr)
frequently track the same title. Entries merge when
`(media_kind, provider id, release_type, season/episode, date)` is equal,
where provider id is `tvdbId`, `tmdbId`, `foreignAlbumId` or `foreignBookId`.
The merged entry lists all contributing `sources`; `monitored`/`has_file` are
the logical OR. Entries lacking a provider id fall back to
`(source_instance_id, arr id)` and are never merged. Output is sorted by
`(date, title, season, episode)`.

## 3. API

`GET /api/v1/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD[&kind=episode,movie][&source_instance_id=<uuid>]`
(bearer token, same admission as the catalog: `CatalogViewer`).

- `start`/`end` are inclusive UTC days; the span is capped at 92 days
  (`400 invalid_range` otherwise). Defaults: today to today + 30 days.
- Response `CalendarResponse { start, end, entries[], sources[] }`.
- `sources[]` is a `CalendarSourceStatus` per *queried* instance:
  `status: ok | unreachable | rejected | error`, `error` message (no URLs,
  no credentials) and `entry_count`. An unreachable instance never fails the
  request and is never silently dropped: clients show a banner listing it.
- Permissions: only instances in the caller's allowed libraries
  (`Policy::library_allow` plus resolved group libraries; admins see all).
  A restricted caller never receives another library's entries or even its
  source status.
- Each instance is queried concurrently with a 10 s timeout. Results are
  cached in memory for 60 s per `(instance, start, end)`; the cache is
  shared across users because the raw source answer is user-independent and
  filtering happens after.

## 4. External subscription (TASKS 76)

A per-user, revocable bearer token embedded in the URL, because calendar apps
cannot send an `Authorization` header.

- Table `calendar_feed_tokens(id, user_id, token_hash, created_at,
  last_used_at, revoked_at)`; only a SHA-256 of the token is stored. The
  plaintext (256 bits, URL-safe base64) is returned exactly once.
- A user has at most one active token. `POST` creates or **rotates** (the old
  token is revoked in the same transaction), `DELETE` revokes.
- `GET /api/v1/calendar/feed` (auth) returns `{ active, created_at,
  last_used_at }`; `POST /api/v1/calendar/feed` returns
  `{ url, token, created_at }`; `DELETE /api/v1/calendar/feed` revokes.
- `GET /api/v1/calendar/feed/{token}.ics` is unauthenticated apart from the
  token: it resolves the token to the user, re-resolves that user's *current*
  policy (so revoking a library takes effect immediately) and renders
  `text/calendar` for `today - 14 days` to `today + 180 days`. Unknown or
  revoked tokens return `404` with no body distinction. Responses carry
  `Cache-Control: private, max-age=900` and the document declares
  `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` of 1 hour.
- iCal output (RFC 5545): `VEVENT` per entry, `UID` = `<entry id>@<node id>`
  (stable, so updates replace rather than duplicate), `DTSTAMP` = generation
  time, all-day `DTSTART;VALUE=DATE` with exclusive `DTEND` when no exact
  time, UTC `DTSTART` with a duration for timed entries, CRLF line endings,
  75-octet line folding, text escaping, `SUMMARY`, `DESCRIPTION` (sources and
  state) and `STATUS:CONFIRMED`. Unreachable sources contribute no events;
  the feed never emits stale-looking empties as deletions because UIDs are
  stable and a failed source is simply absent for that refresh.
- The token is a credential: never logged (request logs record the route
  template, not the path), redacted from request timing, and shown in clients
  only on creation with a copy action.

## 5. Availability lag (TASKS 77)

Record real events from the *arr webhooks Playarr already receives
(`/api/v1/webhooks/arr`): `Grab` and `Download` (import).

- Table `availability_events(source_instance_id, provider, external_id,
  season_number, episode_number, item_id, event_type (`grab|import`),
  occurred_at, air_at, is_upgrade)`; the primary key spans all of them except
  `air_at`/`is_upgrade`, so webhook retries are idempotent. Season and episode
  are `-1` for movies, albums and books. `air_at` is the release time in the
  payload (Sonarr `airDateUtc`, Radarr the earlier of `digitalRelease` and
  `physicalRelease`, Lidarr/Readarr `releaseDate`), absent when not supplied.
  `occurred_at` is when the webhook was received. Only identity, coordinates,
  release time and `isUpgrade` are read from the body. Events accumulate from
  the moment the webhooks are configured; earlier items simply have no samples.
- Lag per item is `first import occurred_at - air_at`. Upgrades
  (`isUpgrade`) and repeat imports never count; only the first import does.
- Excluded: items imported later than `BACKFILL_THRESHOLD` (30 days) after
  airing are classed `backfill` and excluded from the average but counted in
  `backfill_count`; items with no `air_at`, or an import before air (pre-air
  leaks, negative lag) are counted in `unknown_count` and excluded. Missing
  data is therefore explicit, never zero.
- `GET /api/v1/catalog/works/{id}/availability-lag` returns
  `{ average_seconds, sample_count, backfill_count, unknown_count,
  last_samples[] }`; `average_seconds` is `null` when there are no samples.
  Calendar entries gain `average_lag_seconds` (series only) from the same
  statistic.

## 6. Clients

Every client shows the same data: month, week and agenda views; filter by
media kind; entries open the work detail when `work_id` is set; a banner lists
sources that failed; subscription management (create, copy, regenerate,
revoke). Web has pointer, touch and TV (D-pad spatial navigation) layouts.
Android uses native Compose (phone, tablet and TV). Other clients are tracked
as TASKS sub-rows 74.x.
