---
title: First run
summary: What Playarr does the first time it starts, how to reach it, how the first administrator account is created, and how to connect your library managers so the catalogue fills up.
group: Setup
order: 10
---

Playarr does all of its first-boot work by itself: it creates its database, applies its migrations,
mints this installation's node identity, seeds two default library shelves and provisions exactly one
administrator account. There is no setup wizard to click through. Your job on first run is to find
the generated password, sign in, connect the library managers you already run, and check that the
first reconciliation pass completed.

## Reach the server

Playarr listens on `0.0.0.0:8484` by default, and serves a Prometheus scrape endpoint on
`0.0.0.0:9090`. Neither is a bare port setting, both take a full socket address.

| Port | Purpose | Environment variable |
| --- | --- | --- |
| `8484/tcp` | HTTP API, and the co-hosted web UI when built assets are present | `PLAYARR_HTTP_BIND_ADDR` |
| `9090/tcp` | `GET /metrics` | `PLAYARR_METRICS_BIND_ADDR` |
| `80/tcp` | ACME HTTP-01 challenge, only when automatic HTTPS is enabled | `PLAYARR_ACME_HTTP01_BIND_ADDR` |

Check that it is alive and ready:

```bash
curl -sS http://<YOUR-SERVER-URL>:8484/healthz
curl -sS -i http://<YOUR-SERVER-URL>:8484/readyz
curl -sS http://<YOUR-SERVER-URL>:8484/api/system/version
```

`GET /healthz` is liveness. `GET /readyz` returns `200` only once startup has finished, the pool is
connected and migrations have been applied, and `503` until then. `GET /api/system/version` needs no
token and returns the instance name, server version, API version, build SHA, and the per-platform
client compatibility table.

> **Port 9090 should never be reachable from outside your network.** The production Compose stack at
> `infra/docker/docker-compose.prod.yml` only `expose`s 8484 and 9090 on the internal
> `playarr-net` network and fronts 8484 through Caddy, so nothing is published directly. The
> single-node stack at `infra/docker/docker-compose.standalone.yml` is the opposite: it publishes
> **both** `8484:8484` and `9090:9090` straight to the host, so firewall or remove the 9090 mapping
> before that host is reachable from anywhere you do not trust.

If you deployed with the reference Compose production stack, Caddy fronts everything on ports 80 and
443 instead, and the Playarr containers publish nothing directly, reach the API through Caddy's
hostname rather than `:8484`.

## Find the first administrator password

Before Playarr serves a single request, it checks whether the database contains any users. If it
does, nothing happens. If the database is empty, it provisions exactly one administrator:

- The username comes from `PLAYARR_BOOTSTRAP_ADMIN_USERNAME`, defaulting to `admin`.
- The password comes from `PLAYARR_BOOTSTRAP_ADMIN_PASSWORD`. **If you did not set it, Playarr
  generates a random 64-character password**, there is no fixed default password shipped in the
  code, and logs it exactly once, at `WARN`.
- Either way, only the Argon2id hash is stored. The cleartext is never logged a second time.

Retrieve it from the logs:

```bash
# systemd
sudo journalctl -u playarr.service | grep 'bootstrap admin'

# Docker Compose (standalone stack)
docker compose -f infra/docker/docker-compose.standalone.yml logs playarr | grep 'bootstrap admin'

# Kubernetes
kubectl -n playarr logs deploy/playarr-api | grep 'bootstrap admin'
```

The line reads `bootstrap admin created -- username: … password: … -- save this now, it will not be
shown again`. Save it in a password manager, then change it.

> **This account has no playback access, on purpose.** The bootstrap administrator is created with
> `can_stream: false`. It exists to run Playarr's operator surface, not as a household viewer
> account, `is_admin` deliberately does not imply Playarr access. Create a separate account for
> yourself as a viewer (see below).

To avoid the log-scraping step entirely, set the password in your environment file before the very
first start:

```bash
PLAYARR_BOOTSTRAP_ADMIN_USERNAME=admin
PLAYARR_BOOTSTRAP_ADMIN_PASSWORD=<A-LONG-RANDOM-PASSWORD>
```

Also set a stable JWT signing secret at the same time. Without it a fresh random secret is generated
on every boot, so every signed-in client is logged out whenever the process restarts:

```bash
PLAYARR_JWT_SECRET=$(openssl rand -hex 32)   # must be at least 32 bytes
```

## Sign in

Sign in over the API to get an access token:

```bash
curl -sS -X POST http://<YOUR-SERVER-URL>:8484/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{
    \"username\": \"admin\",
    \"password\": \"<BOOTSTRAP-PASSWORD>\",
    \"device_id\": \"$(uuidgen)\",
    \"device_name\": \"operator-laptop\",
    \"client_platform\": \"playarr-admin\",
    \"client_version\": \"0.1.0\"
  }"
```

`device_id`, `device_name`, `client_platform` and `client_version` are all mandatory alongside the
credentials, `device_id` must be a UUID, and a request that omits `client_version` is rejected
before the handler ever sees it. `client_platform` is a closed set: `android-mobile`, `android-tv`,
`ios`, `web`, `tv-webos`, `tv-tizen`, `tv-vidaa`, `xbox` or `playarr-admin`. Resend the same
`device_id` on every later login and refresh from this machine, so device limits count one device
rather than a fresh one per sign-in.

The response carries `access_token`, `refresh_token`, `expires_in` and `user_id`. Export the access
token for the rest of this page:

```bash
export PLAYARR_TOKEN=<ACCESS-TOKEN>
```

`client_platform` matters here. Declaring `playarr-admin` selects the operator login check, which
does not require `Policy::can_stream`; any Playarr platform value (`web`, `android-tv`, `ios`, …)
requires it. Declaring a platform grants nothing by itself, every other endpoint still enforces the
persisted policy.

### The operator web UI

Playarr can co-host a built web UI at `/`, on the same origin and port as the API, so there is no
CORS setup. It serves whatever is at `PLAYARR_WEB_ASSETS_DIR`, or a `web/` directory next to the
binary, provided that directory contains an `index.html`. If nothing is found, the server runs
API-only and logs an info line saying so.

To build Playarr Admin and point the server at it:

```bash
cd clients/tv-web
pnpm install                 # workspace install + version-catalogue resolution
pnpm -r run build            # typechecks and builds every package in dependency order
# the admin bundle lands in clients/tv-web/admin/dist, so:
# PLAYARR_WEB_ASSETS_DIR=/absolute/path/to/clients/tv-web/admin/dist
```

`pnpm -r run build` is the command the workspace's own README documents; the admin app
(`@playarr-tv/admin`) depends on several workspace packages that must be built first, so building
it in isolation is not enough.

> The repository is inconsistent about this slot. `backend/src/main.rs` describes the co-hosted
> assets directory as Playarr Admin, but `infra/docker/backend.Dockerfile` copies the built Playarr
> **Web** client to `/app/web` instead. If you need the admin console specifically, build it and set
> `PLAYARR_WEB_ASSETS_DIR` explicitly rather than relying on the image default.

## The authentication model available today

`PLAYARR_AUTH_MODE` selects one server-wide login posture. Two values are selectable.

| Mode | Value | What a login requires | Status |
| --- | --- | --- | --- |
| Full account | `full-account` (**the default**) | Username and password | Built |
| Trusted network | `trusted-network` | Nothing, requests from allowlisted source IPs auto-authenticate as the default administrator | Built, opt-in |
| Managed profiles (PIN-only household logins) |, |, | Implemented in the auth crate but **not selectable**: no `PLAYARR_AUTH_MODE` value maps to it today |

Under `trusted-network`, the allowlist defaults to RFC 1918 plus loopback, `10.0.0.0/8`,
`172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1/32`, `::1/128`, and deliberately not `0.0.0.0/0`, so
a stray port forward cannot hand administrator access to the internet. `PLAYARR_TRUSTED_NETWORK_CIDR`
**replaces** that list rather than extending it.

> Trusted-network mode is not a substitute for real per-user authentication on a shared or untrusted
> LAN. Anyone who can reach the port from an allowlisted address is the administrator.

What is built alongside it:

- **Users and their policies are durably persisted**, so accounts, permissions and library grants
  survive a restart. (The in-repo roadmap still claims otherwise; it is out of date on this point.)
- **Passwords** are hashed with Argon2id. Access tokens are JWTs, paired with rotating refresh tokens
  and token-family tracking.
- **Administrator-issued invitations** are real: `POST /api/v1/admin/user-invites` mints a one-use,
  24-hour bearer invitation, and the invitee redeems it at `POST /api/v1/auth/signup` to create one
  ordinary account. Consumption is atomic, so one invitation can never produce two accounts. There is
  no open, self-service registration, an invitation is always required.
- **TV and console sign-in** uses a real RFC 8628 device authorisation grant. In-flight pairings are
  held in process only, so a restart (or a second replica) loses an incomplete pairing, start it
  again.

### Create an account you can actually watch with

Every grant is deny-by-default. A new account gets no libraries and no streaming access until you say
so explicitly:

```bash
curl -sS -X POST http://<YOUR-SERVER-URL>:8484/api/v1/admin/users \
  -H "Authorization: Bearer $PLAYARR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "alex",
    "display_name": "Alex",
    "password": "<PASSWORD>",
    "can_stream": true,
    "library_allow": ["<SOURCE-INSTANCE-ID>"]
  }'
```

`can_download` and `is_admin` also default to `false` for every new account and have to be granted
explicitly.

> **`library_allow` holds source-instance ids, which do not exist until you register one.** On a
> genuinely fresh install, either do **Add your libraries** below first and come back with a real id,
> or create the account now with `library_allow` omitted and grant it afterwards with
> `PATCH /api/v1/admin/users/{id}`. An account with an empty `library_allow` can sign in but sees an
> empty catalogue.

## Add your libraries

**Playarr does not scan folders.** It has no filesystem scanner and no metadata pipeline of its
own. Its catalogue is built by reconciling against the library-management apps you already run, over
those apps' own read-only REST endpoints. A deployment with nothing connected has an empty catalogue.

So "adding a library" means registering a **source instance**. Each registered instance is one
library for permission purposes, the UUIDs in a policy's `library_allow` are source-instance ids.

```bash
curl -sS -X POST http://<YOUR-SERVER-URL>:8484/api/v1/admin/source-instances \
  -H "Authorization: Bearer $PLAYARR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "kind": "radarr",
    "name": "Radarr",
    "base_url": "http://192.168.1.10:7878",
    "api_key": "<RADARR-API-KEY>",
    "priority": 0,
    "best_effort": false
  }'
```

A `200` response carries the saved instance, including the server-generated `id`, that UUID is what
every later command on this page means by `<SOURCE-INSTANCE-ID>` or `<INSTANCE-ID>`. If you lose it,
list them all back:

```bash
curl -sS -H "Authorization: Bearer $PLAYARR_TOKEN" \
  http://<YOUR-SERVER-URL>:8484/api/v1/admin/source-instances
```

In Playarr Admin the same thing lives on the **Source instances** page, which is the console's
landing page: pick a kind, give it a name, paste the base URL and API key, and press
**Add & test connection**.

| `kind` | What it contributes | Status |
| --- | --- | --- |
| `sonarr` | Series, seasons, episodes and episode files | Built |
| `radarr` | Films and their files, and, uniquely, cast and crew | Built |
| `lidarr` | Artists, albums and tracks | Built |
| `readarr` | Authors and books, identity and files only | Built, best-effort, the upstream API is unmaintained and these types are unverified against a spec |
| `bazarr` | Nothing, the connection registers and health-checks, but no catalogue data is read from it yet | Connection only |
| `prowlarr` | Nothing, the connection registers and health-checks, but no catalogue data is read from it yet | Connection only |

Things worth knowing before you register anything:

- **Registration health-checks the instance first.** A mistyped URL or a stale key returns `502`
  immediately rather than saving a connection that silently never works.
- **The API key is write-only.** It is never echoed back, not even redacted. Re-POSTing with the same
  `id` updates the row in place, which is how you rotate a key.
- **No restart is needed.** A supervisor loop re-checks every ten seconds and starts a poller for any
  newly registered instance.
- **Do not register two instances of the same kind yet.** The reconciliation diff is not scoped per
  instance, so two Radarr instances over separate libraries will each delete the other's works. This
  is a known gap, not a supported configuration.
- **API keys are not encrypted at rest.** Despite the `api_key_encrypted` column name, they are
  stored as plain text. Protect the database file accordingly.

### Media paths

Playarr stores the file paths exactly as the source app reports them. In the ordinary case , 
Playarr running on the same host as the media, that is already correct and there is nothing to
configure.

If Playarr runs somewhere else and reaches the same files through a network mount at a different
path, set both halves of the prefix substitution:

```bash
PLAYARR_MEDIA_REMOTE_ROOT=/data/media    # the prefix as the source app reports it
PLAYARR_MEDIA_LOCAL_ROOT=/mnt/nas/media  # where that same root is mounted on this host
```

Both must be set, with only one, the substitution is skipped entirely and the original path is used
unchanged. Only a single prefix pair is supported. A path that does not begin with the remote root is
returned untouched.

> For multi-server setups there is a per-instance, per-node equivalent at
> `PUT /api/v1/admin/source-instances/{id}/folder-mappings`, which maps a source's root to the
> physical location visible from each node.

## What the first scan does

Reconciliation is **poll-as-truth, webhook-as-signal**. A poller re-reads each connected app on a
fixed **300-second (five minute)** cycle and diffs the result against Playarr's own catalogue. The
first tick fires immediately when the poller starts, so you do not wait five minutes for anything to
appear. Webhooks are optional and only make Playarr notice sooner; a webhook body is never trusted
as data.

Watch progress:

```bash
curl -sS -H "Authorization: Bearer $PLAYARR_TOKEN" \
  http://<YOUR-SERVER-URL>:8484/api/v1/admin/source-instances/sync-status
```

Each entry reports `status` as `running`, `succeeded` or `failed`, with `error` set on failure and a
free-text `detail` while running, a large first pass reports live progress such as
`backfilling media files: 412/9310`. A `null` status means no poller has reported yet, which is normal
for an instance registered in the last ten seconds or so. Nothing here survives a restart; it is
runtime state, not history.

To force a pass without waiting for the next tick:

```bash
curl -sS -X POST -H "Authorization: Bearer $PLAYARR_TOKEN" \
  http://<YOUR-SERVER-URL>:8484/api/v1/admin/source-instances/<INSTANCE-ID>/sync
```

`202` means the request was handed to the poller. `503` means no poller is running for that instance
yet.

What a first pass actually does, in order:

1. Lists everything from the source app and normalises it into Playarr's own model.
2. Diffs by external metadata id, not by Playarr's internal UUID, into inserts, updates and
   deletes.
3. Syncs file-level rows for every touched work.
4. Backfills media files for anything already marked available but holding zero file rows, at up to
   eight concurrent requests against the source app. This is the step that dominates the first pass on
   a large library and the one that reports live progress.
5. Warms the artwork cache and computes similarity embeddings for every touched work.

Expect the first pass on a large library to take minutes rather than seconds, and expect the API to
stay responsive throughout, reconciliation runs in the worker role, and on a multi-node deployment a
per-instance lock ensures only one node reconciles a given instance at a time.

> **One first-run network dependency.** The "more like this" feature uses a small 384-dimension,
> CPU-only sentence-embedding model that runs entirely on your server. Its weights are fetched once
> from Hugging Face on first use and cached locally, after which it is offline. Every caller treats a
> failure here as non-fatal, so an air-gapped server simply has no similarity data, nothing else
> breaks.

Two library shelves, **Newly Added** and **Newly Released**, are seeded on first boot. They can be
renamed and retuned but not deleted, because the Playarr home screen references them by id.

## Where artwork and metadata come from

There is no TMDB, TVDB, MusicBrainz or Goodreads client anywhere in the Playarr backend. Playarr
adds no second metadata pipeline: titles, sort titles, overviews, genres, release dates, availability
and image URLs all arrive from the apps you already run, and Playarr carries their external
identifiers through.

| Source app | Catalogue kind | Identifier carried |
| --- | --- | --- |
| Sonarr | Series | TVDB |
| Radarr | Film | TMDB |
| Lidarr | Artist | MusicBrainz artist |
| Readarr | Author | Goodreads |

Artwork specifically:

- Playarr accepts the remote image URL the source app supplies, and keeps its **own local artwork
  cache** on your server. A prewarm job runs straight after each reconciliation pass, so the first
  person to browse a title gets a cache hit instead of paying for the fetch. An on-demand route
  remains as a fallback. Cached images are capped at 12 MiB each.
- Where an image only exists behind the source app's own API key, Playarr mints an opaque internal
  locator and resolves it server-side. **Your source instance's host and API key never reach a Playarr
  client.**
- Episode stills are extracted lazily from the media file itself with ffmpeg and cached on the node.
- Cache locations default sensibly for SQLite deployments (beside the database file) but fall back to
  the process temp directory on Postgres, so set `PLAYARR_ARTWORK_CACHE_DIR` explicitly for anything
  other than a single-node SQLite install.

Cast and crew come from Radarr only, it is the one app in this family that exposes credits. An empty
credits list on a series, album or book is the normal case, not an error.

This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by
TMDB.

## Next

- **[Connect your library managers](/docs/library-managers)**, per-app detail on what Playarr
  reads from Sonarr, Radarr, Lidarr and Readarr, optional webhooks, and connecting Tdarr for
  background transcoding.
- **[Install the clients](/docs/clients)**, how to get Playarr onto a browser, a phone and a TV, and
  how device-code sign-in pairs a TV with this server.
