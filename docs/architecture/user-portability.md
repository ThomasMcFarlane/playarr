# Portable per-user library export and import

Tracked as TASKS 67 to 71. The package format is specified in
[`../formats/user-data-export-v1.md`](../formats/user-data-export-v1.md); this
document records the behaviour and the decisions around it.

## Purpose and non-goals

A person can take their own library history with them and bring it back into
the same or another Playarr Server: resume positions and watched state,
personal playlists and their order, and personal playback preferences.

This is independent of administrator server backup (TASKS 62 to 66). A user
export is not a disaster-recovery mechanism and is not a backup of anything an
administrator owns. Importing personal data never changes accounts,
permissions, credentials, library grants, devices or media, and conveys no
media rights: content that the destination does not have simply does not match.

What Playarr does not store is not exported or invented: there are no
per-viewing events or play counts (one resume state per title), no personal
ratings. The format reserves `ratings` so they can be added without a breaking
change. The watchlist (a per-profile list of titles that need not be in the
library, introduced with unified discovery) is exported and imported as its own
section, and a watchlist record is kept even when nothing matches locally.

## Components

| Piece | Where |
|---|---|
| Format types, ZIP and CSV writers, archive validation, title normalisation and the matching algorithm. No database, no HTTP. | `backend/crates/playarr-portability` |
| Export job registry, import preview and apply, routes, isolation. | `backend/crates/playarr-api/src/portability.rs` |
| Shared serialisation with server backups. | None yet. The server-backup epic (TASKS 62 to 66) serialises whole tables for administrators with different goals (all users, secrets, media). If a shared row-serialisation layer merges to `main` first it will be reused for reading rows; the user package deliberately keeps its own portable, identifier-based shape because backups carry local ids and the user package must not. |
| Web UI | Settings, "Your data" panel. |
| Android | Settings entry, native Compose, Storage Access Framework for the file. On television: QR transfer (see below). |

## Export

`POST /api/v1/users/me/data-exports` starts a job for the authenticated user.
There is no user id in any request: the subject is always the token's `sub`.
The routes use the same gate as playlists and the catalogue (an account that
may view the catalogue); no administrator role is needed. Content outside the
account's library grants is left out of the package and never reported.

1. The job is registered in a node-local registry with a random id (two UUIDv4
   values, the same token form used for refresh tokens), state `queued`, owned
   by the user. A user has at most one unfinished job (a second request returns
   it instead of starting another) and at most ten retained jobs; at most two
   jobs run at once per node (a semaphore) and the rest wait in `queued`.
2. The job reads, once each and in this order, the user's watch progress,
   playback preferences, personal playlists with items, the watchlist and account
   preference. This is the snapshot: each table is read once at job start and
   the package describes exactly those reads, even if the user keeps watching.
   A single SQL transaction across the repositories is not available through
   the repository layer; the snapshot is therefore per-table consistent, and
   the package records `generated_at` as the start time.
3. Each row is resolved to an ItemRef (work, external identifiers, season and
   episode, or album and track) through the catalogue, cached per work during
   the job. Rows pointing at content outside the user's library permissions or
   that no longer resolves are omitted and counted in `skipped`.
4. The package is built into a temporary file under the system temporary
   directory with a per-job random name. Memory is bounded by streaming the ZIP
   to disk and by a record cap (500,000).
5. State moves `queued`, `running` (with `progress` counts per section),
   `ready`, or `failed`. `GET /api/v1/users/me/data-exports/{id}` returns it.
6. `GET .../{id}/download` streams the file for the owner only, as
   `application/zip` with `Content-Disposition: attachment` and
   `Cache-Control: no-store`.
7. A job expires 30 minutes after it becomes ready. A sweeper removes expired
   files and registry entries on each request and every five minutes in the
   background; the temporary directory is emptied of stale files at start-up.
   After expiry the id returns `410 Gone`; another user's id and unknown ids
   both return `404`, so existence of other people's jobs is not revealed.
8. `GET /api/v1/users/me/data-exports` lists the caller's own jobs (id, time,
   state, counts). The response states the scope: only this account's data,
   nothing about other users.

Jobs and files are node-local and ephemeral by design: they are a download
staging area, not stored history. In a multi-node deployment a user polls and
downloads from the node that started the job; the client keeps the id and
retries from the start on `404`.

Excluded by construction, never selected: other users' rows, password
hashes, tokens, sessions, devices, PINs, avatars, administrator settings,
source instances, file paths, media files and any media binary. The package
contains no local file path and no source-instance identifier.

## Import

Import is stateless across the two steps so it is safe on any node and holds
no server-side draft. The client uploads the same package twice.

`POST /api/v1/users/me/data-imports/preview` (body: the ZIP, `application/zip`;
query `include_preferences`, `progress_conflicts=newest|keep_existing`)
validates and matches without writing anything and returns:

* `package_sha256`: digest of the uploaded bytes;
* `schema_version`, `generated_at`, `source.instance_name`;
* per section: total, matched, already present, will add, will update
  (conflict: existing progress differs), unmatched, ambiguous;
* a bounded list of example rows per bucket, with candidates for ambiguous
  records (title, year, kind only);
* warnings (the package's original owner name is shown for information only).

Per-title `playback_preferences` are reported (`playback_preferences_not_applied`)
and never applied: quality ladders and track ids belong to one server's files.

`POST /api/v1/users/me/data-imports` (body: the ZIP; query
`package_sha256=<digest from the preview>`, plus the same options as the preview) re-validates, re-matches and
applies. A missing or mismatching digest is `409`. The response reports what
was added, updated and skipped. `POST /api/v1/users/me/data-imports/unmatched`
regenerates, from the same upload, an "unmatched" package of everything the
server could not place, so nothing is lost.

Validation is layered and happens before any matching:

1. Streaming size cap on the request body (50 MiB), then ZIP parse.
2. Entry-name rules (no `..`, absolute, backslash, drive letter, NUL, symbolic
   links, encryption), entry count, per-entry and total expanded size measured
   while inflating (not trusting the declared size), and a compression-ratio
   guard.
3. `format` and `schema_version`, then strict typed parsing with field length
   limits and record caps. Unknown fields are ignored; unknown enumerations are
   reported unsupported, not coerced.
4. Control characters are stripped from imported text; text is stored and
   returned only as data (the API returns JSON, the clients render text, no
   field is interpreted as markup, a path or a query).

Apply writes through the same repositories the normal API uses, always with
the authenticated user id. It runs sequentially per section; a failure stops
the apply, the response reports what was and was not done, and re-running is
safe because every operation is idempotent (progress: newest wins; playlists:
matched by name; items: not duplicated). That is the "no unreported partial
change" guarantee: either the response says everything applied, or it names
the first failing record and the sections not attempted.

### Isolation

* The only identity input is the bearer token. No endpoint accepts a user id,
  and the package's `owner` block is never read for authorisation.
* Imported progress rows and preferences are keyed to files of the importing
  user; imported playlists are created with the importer as owner and cannot
  reference another owner's playlist even if the ids collide (ids in the
  package are remapped, never reused).
* Matched works go through the same library-visibility check as the catalogue.
* Cross-user export ids, download links and preview digests are covered by
  tests (TASKS 71).

## Ten-foot transfer (televisions)

Televisions have no file picker and no way to save a file, so the signed-in
television moves the package through a phone or computer instead. Both flows
use unauthenticated links on the same server (`/api/v1/transfer/...`) because
the second device is not signed in; the link itself is the credential, and it
is deliberately narrow.

* **Link token**: 256 random bits, shown only as a QR code. The response
  carries both the origin-relative `path` and an absolute `url` built from
  the address the request arrived on (proxy headers honoured). The server keeps only its SHA-256 digest, in memory, on one
  node. A link is bound to the account that created it, expires after 15
  minutes and works once. Malformed tokens are `404`; used or expired links
  are `410`. Responses carry `Cache-Control: no-store`, `Referrer-Policy:
  no-referrer` and `X-Robots-Tag: noindex`. As with exports, a multi-node
  deployment must send the television and the phone to the same node (the
  QR code is built from the address the television itself uses).
* **Export**: `POST /users/me/data-exports/{id}/transfer-link` (signed in, own
  ready export only) returns `{path, expires_at}`; `GET
  /transfer/export/{token}` streams the ZIP once. A link never outlives the
  export (30 minutes after it was ready). At most five live links per account.
* **Import**: `POST /users/me/data-import-sessions` (signed in) opens a
  session and returns the id and the one-time upload path; a new session
  replaces the account's previous one. `GET /transfer/import/{token}` serves a
  small self-contained page (strict CSP, no external resources, no token in
  the markup) and `POST` to the same path uploads the package. The upload is
  validated exactly like any import (size cap, ZIP rules, schema) before it is
  kept; an invalid file does not spend the link. The file is staged in the
  private mode-0700 directory with mode 0600 and kept for at most 15 minutes
  after the upload.
* **Nothing is applied by the upload.** The television polls `GET
  /users/me/data-import-sessions/{id}`, then previews and applies through
  `.../{id}/preview` and `.../{id}/apply` with its own bearer token. Those
  routes only see the caller's own session (another account's id is `404`),
  re-validate the staged bytes, and still require the previewed digest. A
  completed apply deletes the staged file; so does closing or expiring the
  session.

## Operations and limits

Export and import are rate-limited by the per-user and per-node concurrency
above, bounded in size, and do no media I/O. Neither writes outside the system
temporary directory. Neither logs package contents; logs carry the user id,
job id, counts and durations only.

## Clients

Web (settings) and Android (native Compose settings) deliver the first
slice. Other native clients are tracked as sub-rows under task 67 and must
follow [`../architecture/client-principles.md`](client-principles.md): native
file pickers and share sheets, no WebView.

## Testing

* Unit tests in `playarr-portability`: schema round trip, CSV safety, archive
  hardening (zip slip, bombs, symlinks, encrypted entries, oversize), title
  normalisation and matching tiers, Unicode.
* API tests in `playarr-api`: scoped export, cross-user and expired ids,
  preview/apply digest binding, idempotent repeat import, conflicting progress,
  cross-server id change, missing and ambiguous titles, hostile text, export
  then import then export equality, no secrets in the package.
* Live round trip on a regional server with a test account.
