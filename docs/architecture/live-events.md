# Live events (server push for every client)

Scope: TASKS rows 270-278. Anything a person can see changing in Playarr must
change on every signed-in device without a manual refresh: watched state and
resume positions made on another device, Home rails, new episodes and files in
a series, library additions and removals, playlists, the watchlist, the
calendar, downloads and household state. Polling stays only as a fallback.

`GET /api/v1/events` is a per-account server-sent event stream. It
generalises the durable, resumable design of `GET /api/v1/remote/stream`
(see `remote-control.md`), which stays as it is for device commands.

## Contract

Request: `GET /api/v1/events[?after=<seq>]` with `Authorization: Bearer
<access token>` (the same token every other route uses) and optional
`Last-Event-ID: <seq>`. Browsers' `EventSource` cannot send the header, so web
clients read the stream with `fetch` and a stream reader. The caller must have
streaming access; a household-locked profile may still connect (it needs to
learn when it is unlocked) but then only receives `household` and `account`
events.

Response: `200 text/event-stream`. Frames:

| Frame | `id` | `data` | Meaning |
| --- | --- | --- | --- |
| `ready` | newest seq | `{seq, retention_ms, heartbeat_ms, max_age_ms, server_time_ms}` | Sent first. Its `id` advances the client's cursor, so a quiet reconnect never looks stale. |
| `change` | seq | `{seq, type, entity, id?, changed[], at}` | One minimal change pointer. |
| `resync` | newest seq | `{reason, seq}` | The cursor could not be honoured (older than retention, or ahead of the log). Refetch everything shown. |
| `: ...` comment | none | none | Heartbeat every 15 seconds. |

The stream ends after five minutes (so it never outlives the access token that
opened it) and on policy loss (disabled or deleted account, lost streaming
access). Clients reconnect with `Last-Event-ID` set to the last `id` seen.

A server without this route (older release) answers an unknown `/api/v1/*`
path with the single page app's HTML, or a 404. A client treats any response
that is not `200` with `Content-Type: text/event-stream` as **unsupported**,
falls back to polling and does not retry the stream until the next foreground,
sign-in or server-version change.

### Event types

`entity` and `id` say what to refetch; `changed` says which facets moved. Frames
never carry entity bodies, so authorisation is always re-applied by the normal
read API.

| `type` | `entity` / `id` | `changed` | Audience | Refetch |
| --- | --- | --- | --- | --- |
| `watch` | `work` / work id | `progress`, `watched`, `unwatched` | the account | work progress and watched badges, Continue Watching, Up Next, Home rails, series season/episode state |
| `library` | `work` / work id | `files` (a file was imported: new movie or episode playable), `upserted`, `removed` | users whose libraries cover the work | work detail, seasons and episodes, library lists, Home rails, search |
| `library` | `*` | `bulk` | every user | all catalogue-derived views |
| `calendar` | `work` / work id | `imported` | users whose libraries cover the work | calendar window |
| `playlist` | `playlist` / playlist id | `meta`, `items`, `deleted` | the owner; everyone for a System playlist | playlist list and detail |
| `watchlist` | `watchlist` / title key | `added`, `removed` | the account | watchlist, discovery badges |
| `download` | `download` / ticket id | `created`, `status`, `deleted` | the account | download list and detail |
| `household` | `profile` / profile id | `policy`, `status`, `approval` | the profile and its guardians | household status, approvals, schedule gate |
| `account` | `profile` / user id | `policy`, `profile`, `removed` | the account | capabilities, profile, library access |
| `admin` | `source_instance` / instance id | `created`, `removed`, `sync_started`, `sync_finished` | admins | source lists and sync status |

Large runs are coalesced on the server: more than 50 rows of one type in one
batch (a first sync touches every title) become one `*` / `bulk` frame, so
clients invalidate the whole area instead of thousands of single entities.
`watch` progress ticks are throttled to one frame per file per eight seconds;
a watched-state change is always sent.

### Scoping and household rules

- Per-account types go only to that user id. Library types go only to users
  whose resolved library access (own `library_allow` plus group libraries;
  admins see all) covers the event's source instance, or, for a work-level event
  with no instance, covers at least one source instance holding a file for the
  work (a work with no synced file is visible to no restricted user, the same
  rule the catalogue applies).
- Household: a profile outside its schedule or over budget receives only
  `household` and `account` frames. Household approval and policy changes are
  addressed to the profile and its guardians only. Rating, tag and folder gates
  are not re-evaluated per frame (frames hold only an id); the refetch applies
  them.
- The caller's policy is re-resolved every 30 seconds, so a policy edit takes
  effect within that window without a reconnect.

## How events are produced

Database first: `live_events (seq, user_id?, kind, entity, entity_id, changed,
source_instance_id?, created_ms)`.

- Repository decorators in `playarr-db` (`EventingWatchProgressRepo`,
  `EventingPlaylistRepo`, `EventingWatchlistRepo`, `EventingDownloadTicketRepo`,
  `EventingWorkRepo`, `EventingMediaFileRepo`) append a row after every
  successful write. Because they wrap the repositories, every writer is
  covered: HTTP handlers, the arr sync poller and webhook-triggered refetches,
  peer sync, portability import and other devices of the same account.
- A *new* `media_files` row (an import) emits `library`/`files` plus
  `calendar`/`imported` scoped to its source instance. Updates of an existing
  file on each poll are deliberately silent.
- Household, account and source-instance handlers publish their own rows;
  the arr sync poller announces `sync_started` and `sync_finished`.
- The stream tails the table (`seq > cursor`, oldest first, 500 per read),
  filters per caller and emits frames. An in-process wake makes a local write
  visible immediately; a two-second timer covers rows written by another
  process.

Retention is bounded: rows older than ten minutes or beyond 50,000 rows are
deleted opportunistically by the publisher and the stream loops. The newest
row is never deleted: it is the watermark that proves a reconnecting cursor is
not behind. `Last-Event-ID` replay works inside the window; a cursor ahead of
the log or older than the oldest retained row yields `resync`.

## Multi-node and peers

- **Separate servers (region-a, region-b) are separate event domains.** Each has its own
  database, users and sequence. A client only ever holds a cursor for the server
  it is signed in to; a cursor from one server is meaningless on another and is
  answered with `resync`.
- **API and worker roles in separate processes, or several replicas sharing one
  Postgres,** work without extra wiring because the table is the source of
  truth: the worker writes rows, API replicas see them within the two-second
  timer. Only latency differs from the in-process wake.
- **Peer groups** (`peer-groups.md`): peer sync writes through the same
  decorated repositories on the node that applies the change, so the receiving
  node's clients are updated; there is no cross-node event forwarding.
- **Postgres ordering caveat:** `seq` comes from a sequence, so two concurrent
  writers can commit out of order and a stream may read a higher seq first and
  skip the lower one. Rows are tiny and clients also refetch on reconnect and on
  the fallback poll, so the exposure is one missed invalidation until the next
  refetch. A stricter ordering would need a serialised writer, which is not
  worth the contention for a hint stream.

## Client behaviour (all clients)

1. **Subscribe on foreground**, only while signed in with a server that
   advertises support (probe by response content type, see above). Pause in the
   background and on sign-out; resume with `Last-Event-ID`.
2. **Invalidate precisely.** Map each `type`/`entity`/`id` to the queries or
   state that show it and refetch only those, in place, without navigation or
   a full reload. Use `bulk` and `resync` to invalidate a whole area.
3. **Reconnect with backoff:** 1 s, 2 s, 4 s ... capped at 30 s with jitter,
   reset after a stream stays up for a minute. The five-minute server close is
   a normal reconnect (no backoff).
4. **Fallback polling** while the stream is down or unsupported: refetch the
   visible queries about every 30 seconds in the foreground (60 seconds on TV)
   and always once when the stream reconnects after more than the
   `retention_ms` gap or after a `resync`.
5. **Idempotent refetch:** an event for a change this device just made is
   harmless; clients may drop an event whose `at` is not newer than the data
   they already fetched.

## Alternatives rejected

- Per-device queues like the remote stream: each progress tick would write one
  row per device; one shared, filtered log is smaller and gives one cursor.
- Pushing entity bodies: would need per-frame authorisation of every field and
  duplicates the read API's household and library rules.
- Polling only: cannot meet "updates on another device within about a second".
