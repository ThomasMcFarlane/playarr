# Phone remote and playback handoff

Scope: TASKS 50-53. A signed-in phone (controller) pairs with a playback
device (target: a TV or another client), sends navigation, text and playback
commands, and can transfer viewing between devices at the right position.
Everything extends the existing account and device identities (`devices`,
access-token `device_id`/`sub`); there is no new login path.

## Roles

- **Target**: a device that registers itself as remotely controllable
  (`PUT /api/v1/remote/target`) with a capability list, then long-polls its
  inbox. Capabilities are advertised, never assumed: `navigate`, `text`,
  `playback`, `input` (capture-input selection, task 38, advertised only when
  the device supports it) and `handoff`.
  Registration may carry an optional `fingerprint` (an install-independent device id). A new
  install on the same account with the same fingerprint, or without one on either side the same
  name and platform as an offline target, reclaims the old target and moves its pairings across
  instead of leaving a stale twin; different fingerprints are never merged. Targets unseen for 30
  days are pruned (pairings revoked) and the target list hides a target offline for over a day
  that a fresher same-name, same-platform target replaces.
- **Controller**: any other device of the same account holding a valid
  access token.
- **Server**: the only authority. Controllers never talk to targets directly.

## Pairing and authorisation

1. The controller asks to pair with a target of the same account
   (`POST /api/v1/remote/pairings`). The server creates a `pending` pairing,
   an expiry (5 minutes) and a six-digit verification code, and queues a
   `pairing_request` event for the target.
2. The target shows the controller name and the code and the person in front
   of the screen explicitly approves or denies (`POST .../approve|deny`,
   called with the **target's own** token). Pairing alone grants nothing: only
   an `active` pairing authorises commands.
3. An active pairing carries `scopes` (a subset of the target's advertised
   capabilities, chosen by the controller, narrowed to what the target
   supports) and an absolute expiry (30 days). Either side, or the account
   owner from any device, can revoke it (`DELETE /api/v1/remote/pairings/{id}`).
   Revocation queues a `pairing_revoked` event for the target.

Rejected alternatives: minting a new bearer token per pairing (a second
credential to leak, store and rotate; the existing access token plus a
server-side grant is enough and revocation is instant); letting the
controller approve its own pairing (defeats the point of explicit
target-device approval).

### Checks on every command

A command is accepted only if all hold, otherwise it is rejected with a
distinct, non-leaking error:

- the access token verifies and its `sub` equals the pairing `user_id`
  (wrong account: 404, so pairing ids are not an oracle);
- the token `device_id` equals the pairing `controller_device_id`
  (another device of the same account cannot reuse a pairing);
- the pairing is `active`, not revoked and not expired (403/410);
- the command kind is inside the pairing `scopes` (403);
- the target is connected: it polled its inbox in the last 45 seconds, else
  409 `target_offline` (disconnected targets reject rather than queue
  stale input).

## Command channel

Commands use a durable per-target event queue (`remote_events`, monotonically
increasing `seq` per target) with two delivery transports over the same HTTPS
listener. Both read the same queue, so they behave identically and survive
server restarts and multi-replica deployments.

- **Push (preferred): SSE.** `GET /api/v1/remote/stream` is a
  `text/event-stream` authenticated by the target device's own access token
  (the same registered-target and per-event pairing checks as the poll: a
  command whose pairing was revoked or expired after queueing is acknowledged
  `revoked` and never sent). Each frame is `event: inbox`, `id: <seq>`,
  `data: <InboxEvent JSON>`; `: ` comments are keep-alives every 15 s and an
  `event: ready` frame opens the stream. Clients resume with `Last-Event-ID`
  (or `?after=`), so nothing queued during a reconnect is lost. The server ends
  the stream after five minutes so it never outlives the token that opened
  it; clients reconnect immediately with a fresh token. `EventSource` cannot
  send an `Authorization` header, so clients use fetch streaming (web) or an
  OkHttp streaming call (Android).
- **Fallback: long poll.** `GET /api/v1/remote/inbox?after=<seq>&wait=25`
  works through every proxy and toolkit. Clients use it when the stream cannot
  open (unsupported runtime, a proxy that buffers or blocks it): after three
  failed attempts they long-poll for two minutes and then try push again.

Inside one server process an enqueue wakes the waiting stream or poll at once
(an in-memory watch per target); waiters also re-check the database every
1.5 s, so another replica's enqueue is seen at worst that much later. The
handoff outcome can be awaited the same way:
`GET /api/v1/remote/handoffs/{id}?wait=20` returns as soon as the handoff leaves
`pending`.

Commands expire after 30 seconds if not delivered. The target acknowledges each
event (`POST /api/v1/remote/events/{id}/ack`); the controller reads the outcome
(`GET /api/v1/remote/commands/{id}`). Paired remotes can be renamed from any
device of the account (`PATCH /api/v1/remote/pairings/{id}`).

### Sensitive input

Text-entry payloads are keyboard input and may contain passwords. They are
stored only in the event payload column, cleared on acknowledgement and on
expiry, never copied into logs, traces, analytics or error bodies. Handlers
log event kind, ids and outcomes only.

## Transactional handoff

`POST /api/v1/remote/handoffs` carries content identity (`media_file_id`),
position, pause state and audio/subtitle language preferences, plus a
client-chosen idempotency key.

- Authorisation: source and destination must both belong to the caller's
  account; each end that is not the initiating device needs an active
  pairing from the initiator with the `handoff` scope. The destination must
  advertise `handoff` and be online. The destination is checked for content
  access exactly as playback negotiation would (`can_stream`, library
  allow-list, the media file resolves); a wrong profile or an inaccessible
  title is rejected before anything is sent.
- If the initiator is not the source, the snapshot is the source's last
  reported state (`PUT /api/v1/remote/target/state`), which must be at most
  20 seconds old; a stale source is refused rather than guessed.
- State machine, advanced only by compare-and-set updates:
  `pending -> committed | failed | expired | cancelled`. The destination gets
  a `handoff_offer` event, starts playback, and acknowledges with the position
  it actually started at (`POST /api/v1/remote/handoffs/{id}/ack`). Only the
  destination can acknowledge, and only while `pending`.
- Only on a successful acknowledgement the server commits and queues a
  `handoff_stop` event for the source. On failure, rejection or timeout
  (60 s) the source is never told to stop, so it keeps playing. Replays
  (a second ack, a re-sent create with the same key) return the recorded
  outcome and cause no second stop or second playback.
- The committed record keeps the snapshot position, the acknowledged position
  and their delta so the position tolerance can be measured (task 53). Target
  tolerance: within 2 seconds of the snapshot position after compensating for
  the elapsed offer-to-ack time, and ack latency under 5 seconds on a LAN.

### Provider limitations (explicit)

- Handoff transfers Playarr library content only (a `media_file_id` the
  destination can negotiate from the same server). Cast receivers, external
  providers and DRM-protected capture inputs are not hand-off sources or
  destinations.
- Audio/subtitle preferences are language preferences, not track indices:
  the destination applies the closest match and may differ if its container
  carries different tracks.
- Handoff between two different Playarr servers (peer group) is out of scope.
- Handoff is at-most-one-playing in the failure-free case; during the window
  between destination start and source stop (one poll round trip) both devices
  briefly play. The source mutes on offer-commit receipt, then stops.

## Security summary

Pairing needs target approval; commands require an active, unexpired,
unrevoked pairing bound to one controller device and one account, scoped per
capability; revocation is server-side and immediate; replays are blocked by
the state machines and idempotency keys; sensitive input is never logged or
retained after delivery; wrong-account and wrong-device callers see 404/403
and never learn whether a pairing exists.

## Trust boundary and measured behaviour

The trust boundary is the account: a device id is whatever the client sent at login, so the per-device
checks (controller device bound to the pairing, target-only approval) protect against mistakes and
other household devices, not against someone who already holds the account credentials.

Measured on an Android TV emulator against a regional server over a slow path: handoff offer to
acknowledgement 10.8 s (the destination must really start playback), acknowledged position within
1.4 s of the expected position after the destination seeks forward by the time the source kept playing.
On a LAN the 5 s latency target is expected to be reachable; that is verified on physical devices.
