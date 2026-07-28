---
title: Connect your library managers
summary: Point Playarr at the Sonarr, Radarr, Lidarr, Readarr, Bazarr and Prowlarr instances you already run, so it can read the library they have already organised.
group: Setup
order: 11
---

You already run the *arr suite to keep your library tidy on disk. Playarr does not replace any of
it, it reads the organised result. Each app you register becomes a **source instance**: a name, a
base URL and that app's own API key. Playarr then re-reads it on a schedule and turns what it
finds into the catalogue your Playarr clients browse.

> **What Playarr does not do.** Playarr supplies no media and obtains none. Every request it
> makes to a connected *arr app is an HTTP `GET`, there is no `POST`, `PUT` or `DELETE` helper
> anywhere in `playarr-arr-client`. It reads the library those apps have already organised; it
> never changes it, and it never reaches past it.

## Before you start

- A running Playarr server, reachable in your browser.
- **Playarr Admin actually being the thing served at `/`.** The Playarr binary co-hosts one
  built web UI on the same origin and port as the API, whatever is at `PLAYARR_WEB_ASSETS_DIR`,
  or a `web/` directory next to the binary. The published container image puts the Playarr **Web**
  client there, not Playarr Admin, so on a Docker deployment you must build Admin and point
  `PLAYARR_WEB_ASSETS_DIR` at it yourself. [First run](/docs/first-run) covers that step; if you
  would rather not, every instruction below is also available over the API.
- An admin account. On first boot Playarr provisions one, username from
  `PLAYARR_BOOTSTRAP_ADMIN_USERNAME`, default `admin`, and, when
  `PLAYARR_BOOTSTRAP_ADMIN_PASSWORD` is unset, generates a random password and logs it exactly
  once at `WARN` level.
- Each *arr app you want to connect, reachable from the Playarr server over HTTP, plus its API
  key.

Every *arr app exposes its key at **Settings → General → API Key** in its own UI.

| App | Playarr `kind` | API version Playarr talks | Typical port |
| --- | --- | --- | --- |
| Sonarr | `sonarr` | `v3` | 8989 |
| Radarr | `radarr` | `v3` | 7878 |
| Lidarr | `lidarr` | `v1` | 8686 |
| Readarr | `readarr` | `v1` | 8787 |
| Bazarr | `bazarr` | `/api` | 6767 |
| Prowlarr | `prowlarr` | `v1` | 9696 |

> **Note on ports.** Those are each application's own defaults, not Playarr settings, Playarr
> has no built-in port list and takes whatever base URL you give it. The same six ports are what
> `infra/docker/docker-compose.dev.yml` in the repository maps for its local test stack, so they are
> a reasonable starting guess; confirm each against your own installation.

## How a connection works

Three things are worth understanding before you add the first one.

**It is read-only.** Playarr authenticates with the app's standard `X-Api-Key` header and issues
only `GET` requests. The shared HTTP helpers are `get_json` and `get_status`; nothing else exists.

**Polling is the truth.** A `ReconciliationPoller` runs a full listing pass per instance and diffs
it against Playarr's own catalogue. The interval is **300 seconds (five minutes)**, and the first
pass fires immediately at start-up so your catalogue populates without waiting. There is no way to
change the interval, the 300-second value is compiled in, not a config key. A webhook body is by
design never trusted as data, only as a nudge to re-read sooner, and that nudge is **not yet wired
up**; see [Webhooks](#webhooks-endpoint-built-faster-updates-not-built-yet) below.

**Registration is verified before it is saved.** Adding an instance performs a live health check
against that app's `system/status` endpoint first. A mistyped URL or a stale key fails immediately
with a `502`, rather than silently succeeding and going wrong later.

## Add a source instance in Playarr Admin

1. Open Playarr Admin at `http://<YOUR-SERVER-URL>/` and sign in as an admin. (If you land in
   Playarr Web instead, the server is co-hosting the wrong bundle, see **Before you start**.)
2. **Source instances** is the root page. You will see a card grid with a **+** tile.
3. Click **+** to open the **Add source instance** modal.
4. Fill in four fields:

| Field | Example | Notes |
| --- | --- | --- |
| **Kind** | `radarr` | Chosen from a dropdown. |
| **Name** | `My Radarr` | Your own label; shown on the card. |
| **Base URL** | `http://192.168.1.10:7878` | Scheme, host and port. No trailing API path. |
| **API key** | *(the app's key)* | Write-only, never echoed back, not even redacted. |

5. Click **Add & test connection**. The button reads *Testing connection…* while the health check
   runs.
6. On success the instance appears as a card showing its name, a `kind` badge, a sync-status pill
   (**Not synced** / **Syncing** / **Synced** / **Sync failed**) and a **Sync now** button. The page
   re-polls sync status every 5000 ms.
7. Leave it for a moment. A worker-side watch loop ticks every 10 seconds and starts a
   reconciliation poller for any instance registered since its last tick, no restart required , 
   and that poller's first pass runs immediately. The pill should move to **Syncing** and then
   **Synced** on its own.

Repeat for each app. Opening a card shows Kind, Base URL, Priority, Best effort and the last sync
status, and offers a delete action.

### Or register it over the API

The Admin UI is a client of the same endpoints. Get an admin token first:

```bash
curl -sS -X POST "http://<YOUR-SERVER-URL>/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "admin",
    "password": "<YOUR-ADMIN-PASSWORD>",
    "device_id": "b3f2c9a4-6e1d-4f8a-9c2b-1a7e5d3f6b90",
    "device_name": "setup-shell",
    "client_platform": "playarr-admin",
    "client_version": "0.1.0"
  }'
```

> **Keep `client_platform` as `playarr-admin`.** That value selects the operator login path, which
> does not require `Policy::can_stream`. The bootstrapped admin account is provisioned without
> streaming access on purpose, so logging in with a Playarr platform value (`web`, `ios`,
> `android-tv`, …) returns `403` for that account. Take `access_token` from the response and use it
> as `<ADMIN-ACCESS-TOKEN>` below.

Then register the instance:

```bash
curl -sS -X POST "http://<YOUR-SERVER-URL>/api/v1/admin/source-instances" \
  -H "Authorization: Bearer <ADMIN-ACCESS-TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{
    "kind": "radarr",
    "name": "Radarr (4K)",
    "base_url": "http://radarr.local:7878",
    "api_key": "<RADARR-API-KEY>",
    "priority": 0,
    "best_effort": false
  }'
```

Request body keys, from `SourceInstanceRequest`:

| Key | Required | Meaning |
| --- | --- | --- |
| `id` | no | Omit to create. Re-POST with an id returned earlier to update that instance in place (for example to rotate its API key). |
| `kind` | yes | One of `sonarr`, `radarr`, `lidarr`, `readarr`, `bazarr`, `prowlarr`. |
| `name` | yes | Display name. |
| `base_url` | yes | e.g. `http://radarr.local:7878`. |
| `api_key` | yes | Write-only. |
| `priority` | no (`0`) | Lower sorts first; breaks ties when several instances could serve a request. |
| `default_root_folder_id` | no | Optional root-folder default. |
| `default_quality_profile_id` | no | Optional profile default. |
| `best_effort` | no (`false`) | When `true`, a failure against this instance is logged and skipped instead of failing the whole reconciliation pass. |

The rest of the resource:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/admin/source-instances` | List registered instances (never includes API keys). |
| `DELETE /api/v1/admin/source-instances/{id}` | De-register; `204` either way, including when the id was already absent. Polling stops on its next tick; catalogue data already imported is left alone. |
| `POST /api/v1/admin/source-instances/{id}/sync` | "Sync now". `202` = handed to the poller; `404` = no such instance; `503` = no poller running for it yet. |
| `GET /api/v1/admin/source-instances/sync-status` | Last-known status per instance; backs the Admin **Tasks** screen. |
| `PUT /api/v1/admin/source-instances/{id}/folder-mappings` | Per-peer root-path remapping in a multi-node group. |

All require an admin bearer token: `401` without one, `403` for a non-admin.

> **Credentials are not encrypted at rest.** The database column is named `api_key_encrypted`, but
> it is stored as plain text; the `Sensitive<String>` wrapper only stops the value leaking through
> log formatting. Treat the Playarr database as holding live *arr credentials, and protect it
> accordingly.

## What each app contributes

### Sonarr

Playarr reads `GET /api/v3/series`, `GET /api/v3/episode?seriesId={id}` and
`GET /api/v3/episodefile?seriesId={id}`.

From those it takes title, sort title, TVDB id, monitored flag, status, path, overview, genres,
images and first-aired date for the series; season and episode numbering, titles, overviews, air
dates and runtimes for episodes; and, per imported episode file, the path, size, quality and
`mediaInfo` block (audio codec, audio bitrate, channels, video codec, video bitrate, resolution,
runtime). Each series becomes a `Series` work keyed on TVDB, with one media-file row per playable
episode file.

It reads nothing else from Sonarr, the request shapes are a deliberately hand-picked subset.

### Radarr

Playarr reads `GET /api/v3/movie` and `GET /api/v3/credit?movieId={id}`. Radarr embeds the file
on the movie itself, so there is no separate file listing.

Fields taken: title, sort title, TMDB id, monitored, `hasFile`, path, runtime, overview, genres,
images, `digitalRelease` and `physicalRelease`, plus the embedded `movieFile` (path, size, quality,
`mediaInfo`). Availability is derived rather than guessed, a file present means **Available**,
monitored without a file means **Pending**, anything else is **Unknown**. Release date prefers
`digitalRelease` and falls back to `physicalRelease`.

Radarr is also the **only** connected app that exposes cast and crew. Playarr reads `personName`,
`personTmdbId`, images, `type`, `character`, `department`, `job` and `order`, de-duplicates each
person by TMDB person id into one shared record, and fully replaces a film's credit list on every
pass. This is what fills the cast, crew and people screens in Playarr.

### Lidarr

Lidarr is on API v1. Playarr reads `GET /api/v1/artist`, `GET /api/v1/album`,
`GET /api/v1/track?artistId={id}` and `GET /api/v1/trackfile?artistId={id}`.

Artists become `Artist` works keyed on the MusicBrainz artist id, with availability derived from
`statistics.trackFileCount > 0`. Albums are classified into live / compilation / EP / single /
soundtrack / studio from `albumType` plus `secondaryTypes`, and one media-file row is written per
playable track with disc and track number, title, duration and the audio `mediaInfo` (codec,
bitrate, channels, bit depth, sample rate).

> **Artwork wrinkle.** Lidarr often reports only local, key-gated `/MediaCover/...` paths. Where an
> artist has no usable poster, Playarr falls back to the first album cover, and mints an opaque
> internal locator (`playarr-arr://<source-instance-id>/MediaCover/...`) that the backend resolves
> using the instance's own key. Your *arr host and API key never reach a Playarr client.

### Readarr

Playarr reads `GET /api/v1/author`, `GET /api/v1/book` and `GET /api/v1/bookfile?authorId={id}`.
Authors become `Author` works keyed on the Goodreads author id, with per-book file rows carrying
path, size and quality (`EPUB`, `PDF`, `MP3-320` and so on).

> **Best-effort, and labelled as such in the code.** Readarr's upstream is archived and has no
> actively maintained public API reference; the book-file shape in Playarr was written by analogy
> with Lidarr's track file rather than verified against a specification. Readarr authors carry no
> overview, genres, images or availability into Playarr, and book files get no bitrate and a zero
> duration, with the quality name standing in for a codec label. Do not expect parity with
> Sonarr, Radarr or Lidarr here.

### Bazarr

Bazarr can be registered as a source instance, is health-checked against `GET /api/system/status`,
is persisted, and appears as a card in the Admin UI like any other. A client with tests exists in
the codebase.

> **Not yet wired into sync, not built yet.** Bazarr's listing calls are never invoked by
> `playarr-arr-sync`; only its constructor and health check are. Subtitle-completeness state has
> no repository to be written into, and there is an explicit `TODO` in the code saying so. A
> reconciliation pass for a Bazarr instance logs that the kind has no catalogue surface and returns.
> Registering Bazarr therefore verifies the connection and nothing more.

Subtitles in Playarr come from somewhere else entirely: Playarr inspects the subtitle streams
**embedded in the media file itself** with `ffprobe`, converts them to WebVTT with `ffmpeg` on the
server, and caches the result on disk. No sidecar files are read and no subtitles are fetched from
Bazarr.

### Prowlarr

Prowlarr can be registered as a source instance and is health-checked against
`GET /api/v1/system/status`. Playarr reads no library data from it and it contributes nothing to
your catalogue: a reconciliation pass for a Prowlarr instance logs that the kind has no catalogue
surface and returns immediately. Nothing degrades if you never register it.

## Summary: what each integration contributes

| App | Playarr reads | Becomes | If absent |
| --- | --- | --- | --- |
| **Sonarr** | Series, episodes, episode files | `Series` works keyed on TVDB, one media file per episode | No series in the catalogue. Nothing else degrades. |
| **Radarr** | Films, embedded movie file, credits | `Movie` works keyed on TMDB, plus every person record | No films, **and no cast or crew anywhere**, since no other app provides them. |
| **Lidarr** | Artists, albums, tracks, track files | `Artist` works keyed on MusicBrainz, albums classified by type, one media file per track | No music in the catalogue. |
| **Readarr** | Authors, books, book files | `Author` works keyed on Goodreads (identity only) | No books. Best-effort quality even when present. |
| **Bazarr** | Health check only *(sync integration not built yet)* | Nothing | Nothing degrades. Embedded subtitles are unaffected. |
| **Prowlarr** | Health check only | Nothing | Nothing degrades. |

## What a reconciliation pass actually does

Every 300 seconds, per instance:

1. List everything from the app and normalise it into a source-agnostic shape.
2. Diff by external metadata id, TVDB, TMDB, MusicBrainz, Goodreads, not by Playarr's own UUID,
   into insert / update / delete operations.
3. Apply them, then run file-level sync and artwork prewarm for every touched work, followed by
   embedding sync. Embedding sync is best-effort: the local embedding model is downloaded on first
   use, and if it fails to load the server logs a warning and skips this step for the rest of the
   run, nothing else about reconciliation is affected.
4. Backfill any work already marked **Available** that has zero file rows, at up to 8 concurrent
   requests against the app, reporting progress as `backfilling media files: {completed}/{total}`.

Playarr owns and overwrites: title, sort title, monitored flag, availability, overview, genres,
images and release date. It never touches your tags, the `added_at` timestamp, or external
references contributed by anything else.

In a multi-node deployment each pass takes a cluster lock named `arr-sync:<source_instance_id>`, so
only one node reconciles a given instance at a time.

## Webhooks: endpoint built, faster updates not built yet

> **Read this before configuring anything.** The receiver endpoint exists, validates payloads and
> returns `202`, but **it does not yet make any instance sync sooner**. `backend/src/main.rs` creates
> the receiver's trigger channel and leaves the receiving end unclaimed, with a `TODO` explaining
> that handing it to the per-instance pollers depends on separate wiring that has not landed. The
> per-poller channel today sees only scheduled ticks and the manual "Sync now" trigger. Configuring
> webhooks therefore costs nothing and changes nothing: the five-minute poll remains the only path
> by which your catalogue updates. It is documented here so you know what the endpoint is and what
> it currently is not.

Playarr exposes a receiver per instance:

```http
POST http://<YOUR-SERVER-URL>/webhooks/<SOURCE-INSTANCE-ID>
```

You would add that as a generic webhook connection in the *arr app's own **Settings → Connect**.
Playarr extracts only `eventType` and, where it can, one entity id, `/series/id` for Sonarr,
`/movie/id` for Radarr, `/artist/id` for Lidarr, `/author/id` for Readarr. Bazarr and Prowlarr
signals carry no usable entity id. The extracted signal is turned into a re-fetch request and
offered to the poller; because nothing is listening for it yet, it is dropped and logged at `DEBUG`.

Responses today: `202` when the payload parsed, `400` if the body has no `eventType`, `404` for an
unknown instance id. A `202` means "parsed and enqueued", never "synced", even once the fast path
lands, the design deliberately drops signals rather than blocking the HTTP response when the
poller's inbox is full, on the basis that the next scheduled pass catches whatever they would have
covered.

## Verify it worked

Check the sync status of everything you have registered:

```bash
curl -sS "http://<YOUR-SERVER-URL>/api/v1/admin/source-instances/sync-status" \
  -H "Authorization: Bearer <ADMIN-ACCESS-TOKEN>"
```

Each entry carries `source_instance_id`, `kind`, `name`, `status` (`running`, `succeeded`,
`failed`, or `null` for an instance whose poller has not completed a pass yet), `started_at`,
`finished_at`, `error` and `detail`. The same data backs the Admin **Tasks** screen.

To force a pass rather than wait:

```bash
curl -sS -X POST "http://<YOUR-SERVER-URL>/api/v1/admin/source-instances/<ID>/sync" \
  -H "Authorization: Bearer <ADMIN-ACCESS-TOKEN>" -i
```

> Sync status is held in memory only. Nothing in it survives a Playarr restart, and an instance
> with no completed pass reports `status: null` rather than a synthetic "idle".

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `502` when adding an instance | The health check failed: wrong base URL, wrong key, or the app is unreachable from the Playarr host. | Check the URL from the Playarr machine, not your laptop. Container deployments need a resolvable hostname or the host IP, not `localhost`. |
| `401` / `403` on any admin call | No token, or a non-admin token. | Log in as an admin and resend the bearer token. |
| `503` from "Sync now" | No reconciliation poller is running for that instance yet. | Wait about ten seconds and retry, a worker-side watch loop ticks every 10 s and spawns a poller for any instance registered since the last tick. No restart is needed. |
| Titles appear but nothing plays | Works imported before their file rows. | The next pass backfills them automatically; watch for `backfilling media files:` in the logs. |
| Instance card stuck on **Not synced** | The poller has not completed a pass since the last restart. | Give it up to five minutes, then check `sync-status` for an `error`. |

## Known limitations

- **Two instances of the same kind will fight.** The reconciliation diff compares against every
  local work of the matching kind, not only the ones a given instance produced, so two Radarr
  instances covering disjoint libraries would each delete the other's works. This is a documented
  gap with a `TODO` in `playarr-arr-sync`. Do not run same-kind instances over separate libraries
  yet.
- **API keys are stored in plain text.** See the callout above.
- **Webhook-driven refresh is not built yet.** The receiver returns `202` but no poller consumes the
  signal. Five-minute polling is the only refresh path today.
- **The five-minute interval is not configurable.** It is a compile-time constant in
  `backend/src/main.rs`, not an environment variable.
- **Bazarr's catalogue integration is not built yet**, and Prowlarr has none by design.
- **Readarr is best-effort** with unverified request shapes.
- Playarr has no metadata-provider client of any kind. There is no TMDB, TVDB, MusicBrainz or
  Goodreads HTTP client in the backend, Playarr holds only the identifiers your *arr apps pass
  through, and downloads and caches the artwork at whatever image URLs they supply. Everything you
  see in Playarr traces back to the apps you already run.

## Where to go next

- **[Transcoding](/docs/transcoding)**, what the server does when a file will not play natively on
  a given device.
- **[Install the apps](/docs/clients)**, getting Playarr onto a browser, a phone and a TV now that
  there is a catalogue to browse.
- **[Remote access and TLS](/docs/remote-access)**, reaching the server from outside your network.
