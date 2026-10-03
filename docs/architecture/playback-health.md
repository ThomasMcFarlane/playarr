# Playback health and compatibility screen

Status: design for TASKS 58-61. Owner: playback health epic.

## Goal

Let a viewer (or someone helping them) answer "why is this not direct playing,
why is HDR or surround missing, is my connection the problem?" from inside the
player, and export evidence that contains no secrets.

## Principles

- **Never overclaim.** Every fact carries a provenance:
  - `measured`: observed on this session. `source` says who observed it:
    `server` (negotiation, ffprobe of the source, session counters) or
    `client` (the player's own telemetry).
  - `reported`: the client declared it (capability lists, display HDR modes,
    audio output). A hardware advertisement is never promoted to "working".
  - `unknown`: nothing available. Shown as unknown, never guessed.
- Dolby Vision, HDR10 output and audio passthrough are only called *confirmed*
  when the client measured them. A direct-played HDR file with no client
  measurement is reported as "sent unchanged, output not confirmed".
- The existing negotiation stays authoritative. The health report reuses the
  stored `PlaybackSession` (`play_method`, `transcode_reason`, source and
  target codec/container/bitrate, buffering counters) instead of re-deciding.
  Nothing is added to the playback hot path.
- Hardware qualification (TASK 40) is not yet a data set. The report carries a
  `qualification` block that says `not_assessed` until a matrix exists, so the
  UI can link it later without a contract change.

## Server contract

`POST /api/v1/playback/sessions/{session_id}/health` (streaming user, session
must belong to the caller and still be active, library access re-checked).

Request `ClientPlaybackReport`:

- `reported`: `video_codecs`, `audio_codecs`, `hdr_formats`
  (`hdr10`, `hlg`, `dolby_vision`), `display_hdr_formats`, `audio_output`,
  `max_height`.
- `measured`: `video_codec`, `decoder_kind` (`hardware`/`software`), `width`,
  `height`, `hdr_active`, `audio_codec`, `audio_channels`, `audio_passthrough`,
  `dropped_frames`, `rebuffer_count`, `rebuffer_ms`, `throughput_bps`.

All fields optional; lists and strings are truncated and sanitised on input.

Response `PlaybackHealthReport`: `headline`, `severity`, `play_method`,
`facts[]` (key, label, value, provenance, source), `findings[]` (code,
severity, title, detail, next_action), `qualification`, and `export`.

The server adds one thing it did not know before: a bounded ffprobe of the
source's first video stream (`color_transfer`, side data) to classify the source
as `sdr`, `hdr10`, `hlg`, `dolby_vision` or unknown. Server transcodes are
8-bit `yuv420p` H.264, so any transcode of an HDR source is stated as
HDR-to-SDR.

### Findings

`direct_play`, `container_unsupported`, `video_codec_unsupported`,
`bitrate_over_limit`, `quality_selected`, `audio_selection`, `hdr_to_sdr`,
`hdr_not_confirmed`, `dolby_vision_not_confirmed`,
`audio_codec_unsupported`, `audio_passthrough_not_confirmed`,
`software_decode`, `buffering`, `bandwidth_low`, `dropped_frames`,
`telemetry_unavailable`. Each has a readable explanation and a next action
(for example "Choose Original quality", "Run the connection test", "Ask an
administrator to enable transcoding").

### Export and redaction

`export` is built by the server so every client shares one redaction policy.
It contains platform, app version, play method, reason codes, codecs,
measured numbers and finding codes. It never contains session, media, user or
device identifiers, titles, paths, URLs, IP addresses, tokens, or other
sessions. Client-supplied free text is dropped when it looks like a URL, IP
address, UUID, e-mail address or token. Clients show the export and only
share/copy it on an explicit action.

### Connection test

`GET /api/v1/playback/connection-test?bytes=N` returns `N` zero bytes
(default 1 MiB, hard cap 4 MiB, `Cache-Control: no-store`). At most four tests
run at once server-wide; extra callers get `429`. The client measures time to
first byte and throughput, caps the whole test at a few seconds, and cancels by
aborting the request. It runs a single request, so it cannot saturate a link
the way a parallel test would, and clients refuse to start it while a video is
actively playing and not paused unless the user confirms.

## Clients

- **Web** (including TV layouts): a "Playback health" panel reachable from the
  player's info/settings, with remote, keyboard and touch focus, a "Technical
  detail" toggle, connection test with cancel, and Copy/Download export.
- **Android (Compose)**: the same sections from the player menu, fed by
  `PlayarrPlaybackStats` (decoder, dropped frames, rebuffer, throughput) and
  the Media3 track/format and display/audio capability APIs.
- Other clients follow via sub-rows in `TASKS.md`.

## Validation (TASK 61)

Live checks against a regional server: direct play, forced transcode, HDR
source, buffering counters, a session that is not yours (403), an unknown
session (404), export fixture scan for sensitive values, cancelled and
concurrent connection tests, and the emulator for Android TV.
