---
title: Transcoding
summary: How Streamarr converts files at play time and how it hands library-wide re-encoding off to a Tdarr worker pool, with the real configuration keys for both.
group: Setup
order: 12
---

Streamarr treats "convert this video" as two unrelated problems and refuses to let one code path
serve both. One is latency-sensitive and happens the instant somebody presses play. The other is
low-priority background work that may take hours and is handed to a separate Tdarr worker pool.
They are dispatched, scheduled and monitored independently, and neither can starve the other.

Both ultimately shell out to FFmpeg, and in both cases FFmpeg runs **on the server**, as a
subprocess of the Streamarr process (or of a Tdarr node). No Playarr client app embeds FFmpeg.

## The two paths at a glance

| | On-demand transcode-on-play | Background re-encoding |
| --- | --- | --- |
| Trigger | A playback request the device cannot play as-is | A file arriving on the Tdarr dispatch channel |
| Runs where | The Streamarr node handling the request | Your Tdarr worker nodes |
| Priority | Immediate; blocks the viewer | Low; throttled while people are watching |
| Output | Live HLS, written to a temp directory, TTL'd | A durable `Rendition`, reused by later playbacks |
| Lifetime | Ephemeral — dies with the session | Persistent until you remove it |
| Configured by | Environment variables + client capability parameters | `POST /api/v1/admin/tdarr`, persisted in the database |
| Role required | `api` or `all` | `worker` or `all` |
| Optional? | No — always available | Yes — Streamarr works fine with no Tdarr at all |

> Streamarr is perfectly usable with no Tdarr instance. You simply pay for an on-demand transcode
> every time a device cannot play a file directly, instead of reusing a rendition someone else's
> playback already caused to be produced.

## On-demand transcode-on-play

### The negotiation order

`GET /api/v1/playback/{media_file_id}` runs three steps strictly in order and stops at the first
one that resolves:

1. **Direct play** — serve the source file byte-for-byte. Cheapest and by far the most common
   outcome. Byte serving goes through `tower_http::services::ServeFile`, so `Range` requests, 206
   Partial Content and seeking all work.
2. **Existing rendition** — reuse an already-`Ready` rendition for this `(media_file_id, profile)`
   pair, regardless of whether Tdarr or an earlier on-demand session produced it.
3. **On-demand transcode** — last resort. Spawn a supervised FFmpeg process producing HLS, just for
   this playback.

### What actually triggers step 3

Direct play is rejected — and a transcode starts — when any of these is true:

- The **container** is not in the client's `containers` list.
- The **video codec** is not in the client's `video_codecs` (or `audio_codecs`) list.
- The file's **known** bitrate exceeds the client's **known** `max_bitrate_bps` cap. An unknown
  source bitrate, or an uncapped client, cannot fail this check.
- The client passed `force_transcode=true` — an explicit quality choice in the player.
- The client passed `audio_stream_index` to select a non-default audio track, which always forces a
  fresh session so a track-specific request never reuses a default-audio rendition.
- **This viewer has a saved quality preference for this file that is not `original`**, and the
  request supplied no `profile` of its own. A viewer who once picked 480p in the player keeps
  getting a transcode on every later play of that file without passing anything at all. Pass
  `ignore_saved_preferences=true` to skip the remembered choice for one request.

Those are query parameters on the negotiation call. A minimal request looks like this:

```bash
curl -sS \
  -H "Authorization: Bearer <ACCESS-TOKEN>" \
  "https://<YOUR-SERVER-URL>/api/v1/playback/<MEDIA-FILE-ID>?containers=mp4&video_codecs=h264&audio_codecs=aac&max_bitrate_bps=8000000"
```

To get an access token for that call:

```bash
curl -sS -X POST "https://<YOUR-SERVER-URL>/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{
        "username": "<USERNAME>",
        "password": "<PASSWORD>",
        "device_id": "b3f2c9a4-6e1d-4f8a-9c2b-1a7e5d3f6b90",
        "device_name": "diagnostics",
        "client_platform": "web",
        "client_version": "0.1.0"
      }'
```

> Audio-codec compatibility is only partly enforced. `MediaFile` carries a single `codec` field —
> the video codec the source library manager reported — so `audio_codecs` is accepted and used to
> widen the codec match, but there is no separate audio-codec gate.

### What the client receives

When step 3 fires, the response points at an HLS manifest served by Streamarr itself:

- `GET /api/v1/media/sessions/{session_id}/{file_name}` — the live session's `playlist.m3u8` and its
  `segment_00000.ts`, `segment_00001.ts`, … files.
- `GET /api/v1/media/renditions/{rendition_id}/{file_name}` — the equivalent for a durable rendition
  resolved at step 2.
- `GET /api/v1/media/{media_file_id}/stream` — direct play, resolved at step 1.

The generated FFmpeg command is fixed and worth knowing, because it explains several client-side
behaviours:

| FFmpeg argument | Value | Why |
| --- | --- | --- |
| `-c:v` | `libx264` | Software H.264. See [hardware acceleration](#hardware-acceleration) below. |
| `-c:a` | `aac` | |
| `-b:v` `-b:a` | From the profile | The kbps figures in the ladder table below. |
| `-map` | `0:v:0` plus `0:a:0?` — or `0:<index>` | The second `-map` is what `audio_stream_index` selects; with no index the first audio stream is used, and the `?` makes a file with no audio track still encode. |
| `-pix_fmt` | `yuv420p` | Browser MSE implementations accept 8-bit H.264 but reject High 10 output; without this, a 10-bit source produces segments Chrome and Safari fail to append. |
| `-vf` | `scale=-2:min(<height>,ih)` | Never upscales — the profile height is a ceiling, not a target. |
| `-sn` | — | Subtitles are not burned in; they are served separately as WebVTT. |
| `-f hls` `-hls_time` | `4` | Fixed 4-second segments (`HLS_SEGMENT_SECONDS`). |
| `-hls_playlist_type` | `event` | The player tails the playlist while it is still being written. |
| `-hls_list_size` | `0` | Segments are never pruned from the playlist mid-session. |

Seeking beyond the produced part of the playlist stops the process and starts a replacement one at
the requested source position (`start_position_ms`). The replacement playlist's own media timeline
restarts at zero; the client carries the source offset separately.

### The quality ladder

Twelve profiles are compiled into the server, plus `original`, which is always offered first.
Profile names are the values you pass as `profile=` on the negotiation call and as
`default_profile` in the Tdarr connection.

| Profile name | Height | Tier | Video kbps | Audio kbps |
| --- | --- | --- | --- | --- |
| `h264-2160p-12mbps` | 2160 | Low | 12 000 | 192 |
| `h264-2160p-20mbps` | 2160 | Medium | 20 000 | 192 |
| `h264-2160p-35mbps` | 2160 | High | 35 000 | 192 |
| `h264-1080p-4mbps` | 1080 | Low | 4 000 | 128 |
| `h264-1080p-8mbps` | 1080 | Medium | 8 000 | 192 |
| `h264-1080p-12mbps` | 1080 | High | 12 000 | 192 |
| `h264-720p-2mbps` | 720 | Low | 2 000 | 96 |
| `h264-720p-4mbps` | 720 | Medium | 4 000 | 128 |
| `h264-720p-6mbps` | 720 | High | 6 000 | 128 |
| `h264-480p-1mbps` | 480 | Low | 1 000 | 96 |
| `h264-480p-2mbps` | 480 | Medium | 2 000 | 96 |
| `h264-480p-3mbps` | 480 | High | 3 000 | 128 |

If no `profile` is supplied, `h264-720p-4mbps` is the default. An unrecognised profile name does not
error — it resolves to a conservative H.264/AAC fallback at 720p, 4 000 kbps video and 128 kbps
audio, so a bad name degrades to something playable rather than failing the whole playback attempt.

> **The ladder is not admin-editable.** It is a fixed array in the server binary. Making it a
> per-deployment, configurable bitrate ladder is an explicit TODO in the source — **planned, not
> built yet.**

### Session lifecycle and configuration

A transcode session is ephemeral, node-scoped state. It lives in whatever cache backend the tier
resolved (in-memory `moka` on single-node, Postgres `LISTEN`/`NOTIFY` or Redis on multi-node), never
as a durable database row.

| Variable | Default | What it does |
| --- | --- | --- |
| `STREAMARR_TRANSCODE_SESSION_IDLE_TTL_SECS` | `60` | Idle deadline for a live session. Every manifest and segment request slides it forward, so this is not a cap on playback length — it is how long a session survives after a viewer closes the tab or loses connection before the FFmpeg process and its capacity slot are freed. A non-positive or unparseable value logs a warning and falls back to 60. |

Set it in the usual place for your deployment tier:

```bash
# Tier 1, systemd — /etc/streamarr/streamarr.env
STREAMARR_TRANSCODE_SESSION_IDLE_TTL_SECS=60
```

```bash
sudo systemctl restart streamarr.service
```

There is no hot reload; everything resolved at startup is read once.

> **Not built yet: session-to-node affinity.** A live session is pinned to the node that started it.
> In a multi-replica deployment nothing routes a client's subsequent manifest and segment requests
> back to that node, and if the node dies the session dies with it and the client must restart
> playback. Behind a load balancer, prefer sticky sessions until this lands.

> **Not built yet: a concurrency cap.** The orchestrator supports a maximum-concurrent-sessions
> limit in code, but nothing wires it up at startup and no environment variable exposes it. In
> practice a busy node is bounded by CPU, not by Streamarr.

### The feedback loop between the two paths

Starting a live on-demand session fires an event on the same in-process channel the Tdarr dispatcher
consumes. So a file that somebody watched once through a temporary FFmpeg session gets a durable
rendition produced in the background, after which every later playback of that file at that profile
resolves at step 2 instead of paying for step 3 again.

The send is fire-and-forget (`try_send`, never awaited), so a full or absent channel — no Tdarr
registered, or a process that does not run the worker role — never affects playback.

> **This bridge only works when one process runs both roles** (`STREAMARR_ROLE=all`). In a split
> `api` / `worker` deployment the receiver lives in a different process, the channel receiver is
> dropped, and every send fails closed. Background re-encoding still works from any other event
> source; it simply is not fed by live playback.

## Background re-encoding via Tdarr

This path is library-wide optimisation: moving files towards more efficient codecs, or fixing
container problems, across a pool of Tdarr worker nodes. It is low priority and allowed to take
hours.

### What Tdarr must be configured with

Streamarr does not install, manage or configure Tdarr. You run Tdarr yourself, and before
registering it you need:

1. **A reachable Tdarr server** with its REST v2 API available. Streamarr talks to
   `/api/v2/scan-individual-file`, `/api/v2/scan-files`, `/api/v2/search-db`, `/api/v2/get-nodes`
   and `/api/v2/alter-worker-limit`, authenticating with the `x-api-key` header on every request.
2. **An API key** for that server.
3. **A Tdarr library**, with its **database id**. This is Tdarr's own concept — you create the
   library on the Tdarr side and copy its id into Streamarr. Streamarr assumes exactly one Tdarr
   library per deployment; the connection is deliberately a singleton, and routing different
   libraries to different Tdarr instances is not a feature that exists.
4. **The Tdarr library's paths must resolve to the same files Streamarr sees.** Streamarr dispatches
   the media file's path as-is. If Streamarr and Tdarr mount storage at different points, fix that
   at the mount level, or with `STREAMARR_MEDIA_REMOTE_ROOT` / `STREAMARR_MEDIA_LOCAL_ROOT`.
5. **A Tdarr flow or plugin stack that actually produces your target output.** Streamarr tells Tdarr
   *which file* to process; what Tdarr does with it is entirely Tdarr's own configuration.
6. **The name of the worker pool to throttle** — one of Tdarr's process identifiers, e.g.
   `transcodecpu`, `transcodegpu`, `healthcheckcpu`, `healthcheckgpu`.

### Registering the connection

Configuration is an admin API call, persisted in the database. It replaces the older
`TDARR_URL` / `TDARR_API_KEY` / `TDARR_DB_ID` environment variables, which are no longer read.

```bash
curl -sS -X POST "https://<YOUR-SERVER-URL>/api/v1/admin/tdarr" \
  -H "Authorization: Bearer <ADMIN-ACCESS-TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{
        "base_url": "http://tdarr.local:8265",
        "api_key": "<TDARR-API-KEY>",
        "tdarr_db_id": "streamarr",
        "default_profile": "h264-720p-4mbps",
        "worker_process": "transcodecpu",
        "default_worker_limit": 2,
        "throttled_worker_limit": 0,
        "active_session_threshold": 2,
        "throttle_check_interval_secs": 30
      }'
```

Read it back, or remove it:

```bash
curl -sS -H "Authorization: Bearer <ADMIN-ACCESS-TOKEN>" \
  "https://<YOUR-SERVER-URL>/api/v1/admin/tdarr"

curl -sS -X DELETE -H "Authorization: Bearer <ADMIN-ACCESS-TOKEN>" \
  "https://<YOUR-SERVER-URL>/api/v1/admin/tdarr"
```

### The configuration keys

| Key | Required | Default | Meaning |
| --- | --- | --- | --- |
| `base_url` | **Yes** | — | Your Tdarr server's base URL. |
| `api_key` | **Yes** | — | Write-only. Never echoed back in any response, not even redacted. |
| `tdarr_db_id` | No | `streamarr` | The Tdarr library database id dispatched work targets. |
| `default_profile` | No | `h264-720p-4mbps` | The rendition profile checked before dispatching. If a `Ready` rendition already exists at this profile, there is nothing for Tdarr to do and the file is skipped. |
| `worker_process` | No | `transcodecpu` | Which Tdarr worker pool gets throttled. |
| `default_worker_limit` | No | `2` | Worker limit applied when no live playback needs headroom. |
| `throttled_worker_limit` | No | `0` | Worker limit applied while the threshold is met. `0` pauses background work entirely. |
| `active_session_threshold` | No | `2` | How many concurrent live on-demand sessions trigger the throttle. |
| `throttle_check_interval_secs` | No | `30` | How often the dispatcher re-evaluates and reapplies the limit. |

Registration is not accepted blindly: Streamarr calls Tdarr's `GET /api/v2/get-nodes` first and
returns `502` if the URL or key is rejected or Tdarr cannot be reached. A wrong value fails
immediately rather than surfacing later as silently missing renditions.

Re-`POST`ing updates the single row in place — that is how you rotate the API key.

### How throttling works

Every `throttle_check_interval_secs`, the dispatcher compares the live on-demand session count
against `active_session_threshold`, then calls `alter-worker-limit` on **every** connected Tdarr
node with either `default_worker_limit` or `throttled_worker_limit`. That is the whole mechanism:
background jobs back off while people are watching, and resume when they are not.

The session count is an in-process counter on the node running the dispatcher. In a multi-node
deployment the dispatcher only sees the sessions on its own node.

### Operational notes and limits

- **No restart is needed to register a connection for the first time.** If the worker role boots
  with no connection in the table, it re-checks every 10 seconds and starts the dispatch loop the
  moment one appears. That watcher is one-shot: it stops as soon as it has spawned the dispatcher.
- **But re-registering does not hot-swap an already-running dispatcher.** Rotating the API key
  updates the row; the running loop keeps its old client until the process restarts.
- **`DELETE` does not stop a running dispatcher either.** The dispatch loop exits only when its
  event channel closes, which happens at process shutdown. The API reference and the repository's
  own module docs describe removal as taking effect on the next watch tick; that is not what the
  code does today. After a `DELETE`, restart the process if you actually need dispatch to stop.
- **The dispatch loop is leader-gated.** In a cluster, exactly one node runs it, elected through the
  coordinator with a 30-second lease.
- **Removing the connection leaves already-cached renditions untouched.** They keep resolving at
  step 2 of playback negotiation.
- **There is no Tdarr page in Streamarr Admin.** The web admin has pages for source instances,
  users, library, views, playlists, tasks, activity, system settings, peer groups and an API
  explorer — Tdarr is configured through the API, or through Admin's built-in API explorer.

> **Not built yet: checkpointed dispatch progress.** A dispatcher restart loses in-flight job
> progress. Some architecture notes in the repository describe progress as checkpointed in the
> database; that is aspirational and inaccurate today. Do not rely on resumable background jobs.

> **Not built yet: library-manager import events on the dispatch channel.** Today the only producer
> feeding the dispatcher is the on-demand playback bridge described above. Wiring import and upgrade
> events from the *arr reconciliation flow onto the same channel is a known, unaddressed gap.

## Transcode temp directory

On-demand HLS output is written to a per-session directory under a fixed root:

```
<system temp dir>/streamarr-transcode/<session-id>/
```

**No Streamarr environment variable exposes this path.** The root is
`std::env::temp_dir().join("streamarr-transcode")`, so on Linux the only lever is the standard
`TMPDIR` environment variable, which Rust's `temp_dir()` honours (falling back to `/tmp`).

What that means per tier:

| Tier | Where segments land by default | Notes |
| --- | --- | --- |
| systemd | The unit's private `/tmp` (`PrivateTmp=true`) | If `/tmp` is a tmpfs on your host, segments consume RAM. |
| Docker Compose (prod) | `tmpfs: /tmp` on a read-only root filesystem | A RAM disk sized by Docker's default. |
| Kubernetes — Helm chart | An `emptyDir` mounted at `/tmp` | Node-local, sized by the node's ephemeral storage. |
| Kubernetes — Kustomize base | Nowhere in particular | `infra/kubernetes/base/deployment-api.yaml` declares no volumes and no `readOnlyRootFilesystem`, so segments land in the container's own writable layer. Add an `emptyDir` yourself if you use the overlays rather than the chart. |

To move it onto disk on a systemd install, point `TMPDIR` at a directory the unit may write to. The
unit's `ProtectSystem=strict` allows writes only to `ReadWritePaths`, which is
`/var/lib/streamarr /var/log/streamarr`, so use a subdirectory of one of those:

```bash
sudo -u streamarr mkdir -p /var/lib/streamarr/tmp
```

```bash
# /etc/streamarr/streamarr.env
TMPDIR=/var/lib/streamarr/tmp
```

```bash
sudo systemctl restart streamarr.service
```

> Size this generously. A single 4-second-segment session at `h264-2160p-35mbps` writes roughly
> 17 MB per segment and, because `-hls_list_size 0` keeps every segment for the life of the session,
> nothing is pruned while playback continues.

The other caches are configured separately and are not part of the transcode temp directory:
`STREAMARR_ARTWORK_CACHE_DIR`, `STREAMARR_THUMBNAIL_CACHE_DIR` and `STREAMARR_SUBTITLE_CACHE_DIR`.

## Hardware acceleration

**Not wired up. There is no VAAPI, NVENC, QSV, CUDA or VideoToolbox path in Streamarr.**

This is the honest position, and it is worth stating precisely rather than hedging:

| Accelerator | Status in Streamarr |
| --- | --- |
| VAAPI (Intel/AMD on Linux) | **Not built.** No `-hwaccel`, no `-vaapi_device`, no `/dev/dri` passthrough in any shipped manifest. |
| NVENC (NVIDIA) | **Not built.** No NVIDIA container runtime, no GPU resource requests in the Helm chart or Compose files. |
| QSV (Intel Quick Sync) | **Not built.** |
| VideoToolbox (macOS) | **Not built.** |

Every on-demand transcode resolves `-c:v libx264` — software H.264 — and there is no configuration
key, feature flag or manifest option that changes it. Nor can you substitute a wrapper binary for
the on-demand path: `STREAMARR_FFMPEG_BINARY` and `STREAMARR_FFPROBE_BINARY` exist, but they are
read only by the thumbnail and subtitle-extraction helpers. The transcode orchestrator does have an
internal `with_ffmpeg_binary` override, but nothing at startup passes anything to it, so the
playback path always invokes plain `ffmpeg` as resolved on `PATH`.

Practical consequences to plan for:

- On a low-power NAS or a Raspberry Pi, assume roughly one concurrent 1080p on-demand transcode, and
  design around direct play instead.
- Prefer keeping files your devices can play directly. Direct play costs almost nothing.
- If you want acceleration, put it in **Tdarr**. Tdarr worker nodes are separate machines running
  their own FFmpeg with their own flows, and whatever acceleration they use is Tdarr's, entirely
  outside Streamarr. Setting `worker_process` to `transcodegpu` throttles the correct pool.

> Hardware-accelerated transcoding inside Streamarr is **not on the shipped feature list**. Treat any
> mention of it as planned work with no delivery date.

## Where FFmpeg runs

FFmpeg is a **server-side subprocess** in every case:

- The Streamarr binary spawns `ffmpeg` through `tokio::process::Command` for on-demand HLS, and for
  thumbnail and subtitle extraction. The process is spawned with `kill_on_drop`, so it can never
  outlive the Streamarr process with nothing left to expire its session.
- Tdarr nodes run their own FFmpeg, on their own machines, under their own configuration.
- **No Playarr client app embeds FFmpeg.** Clients receive HLS or a direct byte stream over HTTP and
  play it with the platform's own player — ExoPlayer/Media3 on Android, AVKit on Apple platforms,
  the native `Video` node on Roku, `webapis.avplay` on Tizen, and Media Source Extensions in the
  browser.

No container image has been published to any registry yet, so today you build one yourself. The
runtime stage of `infra/docker/backend.Dockerfile` is `debian:bookworm-slim` and installs
`ca-certificates`, `curl`, `ffmpeg` and `tini`, so an image built from that Dockerfile already has
both binaries. A bare-metal systemd install must supply `ffmpeg` and `ffprobe` on `PATH` yourself:

```bash
ffmpeg -version && ffprobe -version
```

```bash
# Debian / Ubuntu
sudo apt-get install -y ffmpeg
```

> The Debian FFmpeg build that lands in an image built from `backend.Dockerfile` is covered by the
> GNU General Public Licence version 2 or later, separately from Streamarr's own MIT licence. If you
> distribute that image to anyone else, the corresponding-source obligation is yours. See
> [Licences and attribution](/legal/licences#ffmpeg).

## Verifying and troubleshooting

Confirm which path a given file took by reading the negotiation response, then watch the logs:

```bash
journalctl -u streamarr.service -f
```

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  --profile standard logs -f streamarr-api
```

> `docker-compose.prod.yml` interpolates `${STREAMARR_DB_PASSWORD:?…}`, so it fails every
> invocation — `logs` included — unless your local override or `.env` supplies it. Always pass the
> same file list and profile you brought the stack up with; see
> [Docker Compose](/docs/install/docker-compose).

Turn up the relevant log targets:

```bash
# /etc/streamarr/streamarr.env
STREAMARR_LOG=info,streamarr_transcode=debug,streamarr_api=debug
```

Common causes, in the order worth checking:

| Symptom | Likely cause |
| --- | --- |
| Everything transcodes, nothing direct-plays | The client is sending an empty or wrong `containers` / `video_codecs` list, or a `max_bitrate_bps` cap lower than your files. |
| Playback stalls a few seconds in | The transcode temp directory filled up, or its tmpfs is too small. |
| Sessions vanish behind a load balancer | No session-to-node affinity — pin sticky sessions to one backend. |
| Playback works but no renditions ever appear | No Tdarr connection registered, no node running the `worker` role, or a split `api`/`worker` deployment (the live-playback bridge needs `STREAMARR_ROLE=all`). |
| Tdarr connection rejected with `502` | `base_url` or `api_key` wrong, or `GET /api/v2/get-nodes` unreachable from the Streamarr node. |
| Tdarr accepts work but never produces anything | The dispatched path does not exist from Tdarr's side, or the Tdarr flow does not act on it. |
| 10-bit source plays as audio only in a browser | Should not happen — `-pix_fmt yuv420p` is forced. Confirm you are on a current build. |

Live sessions are also visible to admins: `GET /api/v1/admin/playback/sessions/active` for who is
watching right now, `GET /api/v1/admin/playback/sessions/history` for the filtered session history,
and `POST /api/v1/admin/playback/sessions/{session_id}/stop` to force-stop one.

In Streamarr Admin they are split across two pages:

| Page | What it shows |
| --- | --- |
| **Activity** | The polled "who is watching now" list from `.../sessions/active`, plus the filtered history from `.../sessions/history`. |
| **Tasks** | An **In-progress transcodes** panel — the same `active` list filtered to `play_method == "transcode"` — with a per-row stop button that calls `.../sessions/{session_id}/stop`. |
