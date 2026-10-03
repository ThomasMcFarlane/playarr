# Unified discovery and watchlist

Status: design for TASKS rows 46-49. Extends the existing catalogue search
(`GET /api/v1/catalog/search`), playback progress and arr source instances; it
does not replace them.

## 1. Goals and non-goals

- One search that answers "where can I watch this?" across the local library,
  peer servers, requestable catalogues (Radarr/Sonarr), live/upcoming TV and
  games, with each source attributed.
- One per-profile watchlist that holds titles whether or not they are in the
  library yet, and offers Play, Resume, Record or Request according to what is
  really possible right now.
- Not in scope: building the Games catalogue (row 22), tuner/guide/recording
  (rows 27-29) or external resume (row 37). The contract has slots for them;
  until they ship the providers report an explicit `unavailable` status with a
  reason, and the actions explain why they are disabled.

## 2. Title identity

A `DiscoveryTitle` is the merged view of one real-world title. Candidates come
from providers and carry `external_refs` (`tmdb`, `tvdb`, `imdb`, ...), a kind,
a title, an optional year and an optional `edition` label.

- Identity key (`title_key`): the first available of `tmdb`, `tvdb`, `imdb`,
  then any other ref, formatted `provider:kind:id`; with no refs it falls back
  to `title:kind:normalised-title:year`.
- Merging: two candidates merge when they share any `(provider, id)` pair, or
  when both have no refs and the fallback key matches. Merging is transitive
  (a Radarr hit with tmdb+imdb joins a library work that only has imdb).
  Different kinds never merge, so a film and a series with the same name stay
  separate.
- Editions: candidates that merge but carry different `edition` labels
  (Theatrical, Director's Cut, ...) stay one title with an `editions` list; each
  source entry records its edition.
- Games are a distinct kind (`game`). They are excluded from the default
  `scope=media` search and returned only for `scope=games` or `scope=all`,
  with a separate launch semantic (`launch`, never `play`).

## 3. Source attribution and availability

Every merged title carries `sources[]`. A source entry has a `source` kind
(`library`, `peer`, `request`, `live_tv`, `game`), a display `label`, an
`availability` (`available`, `requestable`, `upcoming`, `unavailable`) and an
optional human `reason`. Libraries are filtered by the caller's
`Policy::library_allow`; restricted titles are omitted rather than shown as
locked, so existence is never leaked.

Each provider reports a `ProviderStatus` in the response: `ok`,
`unavailable` (not configured / not built yet / failed) with a reason, or
`stale` with `as_of`. A failing provider never fails the search; results from
the others are returned and the client can say which sources were skipped.

Providers in this iteration:

| Provider | State |
|----------|-------|
| `library` | Local catalogue search plus peer remote-only titles. |
| `request` | Radarr/Sonarr lookup through enabled arr source instances; `unavailable` when none is configured. |
| `live_tv` | Stub, `unavailable` until rows 27-28. |
| `games` | Stub, `unavailable` until row 22. |

## 4. Watchlist

Table `watchlist_items(user_id, title_key, kind, title, year, work_id,
external_refs, poster_url, added_at)`, primary key `(user_id, title_key)`. A
profile is a user, so the list is per profile and follows the profile to every
device. A row stores a snapshot, so a title that is not in the library yet (or
a game) can still be listed. On read, each row is re-resolved against the
library by `work_id` then by external refs, so a requested title becomes
playable automatically once imported.

API (all require a signed-in streaming-capable user or admin):

- `GET /api/v1/watchlist` - entries, newest first, each with `actions[]`.
- `POST /api/v1/watchlist` - idempotent add from a title snapshot.
- `DELETE /api/v1/watchlist/{title_key}` - remove (idempotent).
- `GET /api/v1/discover?q&scope&kind&limit` - discovery search.

## 5. Source-aware actions

`actions[]` is computed server-side so every client behaves identically:

| Action | Enabled when | Target |
|--------|--------------|--------|
| `play` | A visible library work with a playable file exists and no resume point | Work id (movie) or first unwatched episode media file |
| `resume` | The caller has `part_watched` progress on a file of the work | `media_file_id` and `position_ms`; for series the most recently updated part-watched episode |
| `request` | Not in the library, a request provider is available and the caller may request | Provider instance and external id |
| `record` | A live/upcoming programme source exists | Disabled with reason until rows 27-29 |
| `launch` | Game with a launchable host | Disabled with reason until row 22 |

Disabled actions are still listed with `enabled: false` and a `reason`. An
external provider shortcut (for example opening Netflix) is never reported as
`resume`; external resume stays a blocker owned by row 37.

## 6. Client behaviour

Web, Android and the remaining clients use the same endpoints. Search shows the
merged titles with source chips and a games filter; the title page and the
watchlist screen render `actions[]` verbatim (label, enabled, reason) and call
the target. Remote/keyboard focus lands on the primary enabled action;
touch uses the same buttons.

## 7. Failure and edge handling

- Empty query returns empty titles and healthy provider statuses.
- Expired provider sessions and missing credentials surface as provider
  `unavailable` with a reason, never as a 5xx.
- A watchlist row whose library work is removed or no longer permitted keeps its
  snapshot but loses `play`/`resume`; it can still offer `request`.

## 8. Rollout

1. Backend: model, migration, repo, endpoints, OpenAPI (this document first).
2. Web client incl. TV layouts.
3. Android native Compose.
4. Parity sub-rows for iOS/tvOS, Roku, Xbox and HarmonyOS in `TASKS.md`.
