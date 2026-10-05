# End-of-playback experience

Status: canonical cross-client product requirement (owner request, 3 October
2026). Binding on every complete client: Web (browser/PWA), LG webOS, Samsung
Tizen, VIDAA fallback, Cast receiver (where it renders player state), Android
(phone, tablet, TV), iOS/iPadOS, tvOS, Roku, Xbox and HarmonyOS. Tracked in
[`TASKS.md`](https://github.com/ThomasMcFarlane/playarr/blob/main/TASKS.md) task 78. Principles:
[`client-principles.md`](client-principles.md).

> When media finishes, there must be a UI with exit, replay, suggestions and
> so on, or a countdown to the next item when in a playlist (with UI around it
> for exiting, playing the next media now, suggestions and so on). It applies
> everywhere.

Clients implement the behaviour natively; the wording, timings, ordering and
telemetry below are shared. Deviations need an entry in the principles doc.

## 1. States

```
playing --(end trigger)--> ended-card          (nothing follows)
playing --(end trigger)--> up-next-countdown   (a next item exists)
ended-card / up-next --Replay--> playing (new playback session, position 0, same item)
up-next --Play now / countdown 0--> playing (new playback session, next item)
up-next --Cancel--> ended-card (for the item that just finished)
any --Exit/Back--> details screen of the finished work
```

- **Ended card**: the video surface stays on its last frame (or artwork
  backdrop if the engine has released the surface), dimmed. Shows title and,
  for episodes, the series and `S{n}:E{m}`; a "Finished" label; primary
  action **Replay**; secondary **Back to details** (exit); then the
  **Suggestions row**.
- **Up-next countdown**: replaces the ended card when a next item exists (see
  section 3). Shows artwork/thumbnail, title, series and `S{n}:E{m}` of the
  next item, a countdown ring or bar and "Playing in {n}", primary action
  **Play now**, secondary **Cancel** (stay on the ended card) and **Back to
  details**, plus a **Replay** action for the item that just ended. The
  Suggestions row is shown below on 10-foot and tablet layouts; on phones in
  portrait it is reached by scrolling.

The two states are mutually exclusive. Cancel is sticky for that ended item:
the countdown never restarts without a new playback.

## 2. Triggers

1. **Primary: engine ended** (`STATE_ENDED`, `ended` event, `MediaPlayer`
   `Finished`, AVPlayer `didPlayToEnd`, Roku `finished`, etc.). Mandatory on
   every client.
2. **Optional earlier trigger (credits/outro)**. The backend exposes only
   container chapters (`GET /api/v1/media/{media_file_id}/chapters`, entries
   `index`, `title?`, `start_ms`, `end_ms?`). It has **no** intro, credits or
   outro marker API. Therefore: v1 clients MUST NOT infer credits from chapter
   titles and MUST use the primary trigger only. If a future server adds
   explicit markers (for example `credits_start_ms`), clients may show the
   up-next card early with a "Skip credits" style affordance, but must still
   fall back to the primary trigger. This is deliberately out of scope now.
3. The trigger fires once per playback session of an item. Seeking back
   after the card has appeared resumes playback and dismisses the card;
   reaching the end again triggers it again.
4. Playback progress must be saved as watched (existing progress/watched
   reporting) before the card is shown; the card never delays that report.

## 3. What is "next"

Resolved in this order, first match wins:

1. The next entry of the explicit playback queue/playlist the player was
   launched with (playlist, album, "play all").
2. For an episode launched without a queue, the next episode in series order
   (next in season, then first of the next season), only if it has a playable
   file the viewer can access.
3. Otherwise there is no next item: show the ended card.

Auto-advance is controlled by the existing "autoplay next" preference where a
client has one; when it is off, the up-next card is still shown but the
countdown does not run (the card shows **Play now** as primary). If a client
has no such preference yet, behave as autoplay on.

## 4. Countdown

- Length: **10 seconds** (no existing client code defines another length for
  video). Constant `END_SCREEN_COUNTDOWN_SECONDS = 10`.
- Counts whole seconds down to 0, then starts the next item with the same
  quality/audio/subtitle preferences the viewer last chose.
- Pauses (does not reset) while the app is backgrounded or a system dialog
  covers it, and cancels if the player is closed or casting begins.
- Any explicit action (Play now, Cancel, Replay, Exit, selecting a
  suggestion) stops the timer. Mere focus movement or hover does **not**.
  Moving focus onto the suggestions row on a 10-foot UI does not stop the
  timer either, but selecting an item does.
- Reduced motion: replace the animated ring with a plain "Playing in N"
  text; the timer still runs.

## 5. Actions

| Action | Where | Behaviour |
| --- | --- | --- |
| Replay | ended card, up-next | Start a **new playback session** for the same item from 0 (see "Starting playback after the end" below). |
| Back to details (Exit) | both | Leave the player to the finished work's details screen, restoring the selected episode (same as the player Back route). Hardware Back/Escape triggers this. |
| Play now | up-next | Start the next item immediately, as a new playback session. |
| Cancel | up-next | Stop the countdown, show the ended card. |
| Suggestion tile | both | Open that work's details (or play directly if the client already offers one-tap play on tiles). |

### Starting playback after the end

When an item ends, the client reports it watched and closes the server
playback session with reason `completed`. A closed session accepts no further
heartbeats or progress, so **Replay, Play now and autoplay-next must each start
a fresh playback session through the normal playback-info negotiation
(`GET /api/v1/playback/{media_file_id}`, start position 0 for Replay)
exactly as for a new play**. They must never seek the ended session back to 0
(or reuse its session id), otherwise replayed playback would send no
heartbeats and record no progress. The new session uses the same
quality/audio/subtitle choices the viewer last made, and the previous session
id is never reused or re-opened. Clients that play local downloads simply
re-prepare the local file; no server session exists there.

### Suggestions row

- Source: `GET /api/v1/catalog/{id}/similar?limit=12` using the **work** id of
  the finished item (series work for episodes, album work for music).
- Fallbacks, in order, when the call returns 404/empty/error or the viewer
  lacks access: (1) other items in the same series/album queue not yet watched
  (remaining episodes), (2) the client's existing "Continue watching" rail
  excluding the finished work, (3) hide the row. Never show a spinner that
  blocks the primary actions; load in the background when playback starts or
  at trigger time and render when ready. The row never contains the finished
  item itself and is capped at 12 tiles.
- Tile artwork: the tile is 16:9. Choose the image kind in the order backdrop,
  thumb, poster, banner (skipping kinds the work has no image for), load it
  from the server artwork endpoint
  `GET /api/v1/artwork/work/{work_id}/{kind}` (authenticated, server-cached),
  and fall back to the provider URL from `images[]` and then to the next kind
  when a load fails. When nothing loads, show a placeholder tile containing the
  work title; a tile is never an empty box.
- Heading: "More like this".

## 6. Focus and remote rules (10-foot UIs)

- The first focus on the card is the primary action: **Play now** when a
  countdown is running, **Replay** on the plain ended card. Focus is never
  lost to the video surface or the page behind.
- D-pad: Left/Right move between the action buttons; Down moves to the
  suggestions row and Up returns to the last action. Focus order is
  Play now / Replay, Cancel (up-next only), Back to details, then suggestions.
  OK/Enter activates. No focus traps beyond the card; the card owns the whole
  screen while visible.
- Back (webOS 461, Tizen 10009, Android BACK, Roku `back`, Xbox B, tvOS
  Menu) behaves as **Back to details** from the card. It never merely hides
  the card and it never exits the app.
- Media keys: Play/Pause on the card activates the primary action. Fast
  forward/rewind are ignored. Next-track key equals Play now when a next
  item exists.
- Text is at least the platform's 10-foot body size; primary action meets
  the platform's minimum focus target; focus ring uses the standard
  DESIGN.md focus treatment.

## 7. Touch and pointer rules (mobile, tablet, desktop)

- Tap targets at least 44 x 44 pt (48 dp). Primary and secondary actions sit
  in the lower half of the screen within thumb reach.
- Phone portrait stacks the card vertically with the suggestions row below,
  scrollable; landscape uses two columns. Tapping the dimmed backdrop does
  nothing (no accidental dismissal).
- Swipe-down on phones is not bound. Desktop supports Space/Enter on the
  focused action, Escape for Back to details, and mouse hover/click.
- The system back gesture equals Back to details.

## 8. Accessibility

- The card is a labelled dialog region (`role="dialog"`, `aria-modal` on web;
  platform equivalents natively) announced as "Finished playing {title}" or
  "Up next: {title}".
- The countdown is announced at start and at 5 s and 0 s only (polite live
  region); it is not announced every second. A "Cancel" action is always
  reachable by keyboard and screen reader before the timer elapses, and the
  timer pauses while a screen reader is actively reading the card where the
  platform exposes that.
- Every control has an accessible name; the ring is decorative with the
  numeric text as the accessible value. Contrast meets the app theme AA
  baseline; reduced motion is respected (section 4).
- All strings are localised with the existing client i18n mechanism; do not
  hard-code English. Keys are suffixed `endScreen.*` (web) or the
  platform equivalent.

## 9. Telemetry

Use the existing client analytics/diagnostics channel only (no new vendor,
no PII, no title text; ids only). Events:

- `end_screen_shown` { kind: `ended` | `up_next`, has_suggestions }
- `end_screen_action` { action: `replay` | `exit` | `play_now` | `cancel` |
  `suggestion`, kind }
- `end_screen_autoplay` { } when the countdown elapses

If a client has no analytics channel, omit; do not add one for this feature.

## 10. Keep-awake

Screen/idle keep-awake that applies during playback **remains held** while
the end card or countdown is visible (so the countdown is not cut by a
screensaver) and is released when: the viewer chooses Exit, Cancel has been
pressed and 60 s pass without input on the ended card, or the card closes.
After 60 s idle on a plain ended card, clients may let the platform idle
normally; the state is preserved.

## 11. Edge cases

- **Last item in a queue**: no countdown; ended card. Suggestions row is
  shown. Offer Replay (the last item). A "Replay all"/"Start queue again"
  action is optional (phones may skip).
- **Next item unavailable** (removed, no access, offline and not
  downloaded): behave as no next item; ended card with the reason not shown
  unless an error follows.
- **Offline/downloaded media**: the card works offline. The suggestions row
  uses only locally available data (remaining downloaded items); otherwise it
  is hidden. Next item must be downloaded to be auto-advanced.
- **Playback error**: errors keep their existing error UI and never show the
  end card. If an error occurs on the *next* item after auto-advance, show the
  normal error UI with Back to details.
- **Casting**: the sender shows its cast controller and no local end card; the
  receiver, if it renders player end state, shows the ended card (Replay and
  suggestions are not interactive on the receiver; it advances through the
  queue the sender sent). The sender resumes the up-next decision from
  receiver `ended` state.
- **Trailers/extras/previews**: no end card; return to the previous screen.
- **Live TV and recordings in progress**: no end card.
- **Picture-in-picture/minimised player**: auto-advance may continue per the
  next-item rules; the full card appears only when the player is expanded.
  Expanding during a countdown resumes it from the current second.
- **Audio-only/music**: continues the queue immediately with no card and no
  countdown (existing behaviour, crossfade/gapless where the platform
  supports it). Only when the **queue ends** (last track finishes) show the
  ended card (album/playlist title, Replay, Back to details, similar artists
  or albums if available) with no countdown. Skipping or Back never shows a
  card. Mini/inline music players show the card only when expanded.
- **Resumed items near the end** (position within 5 s of the end): treated
  as watched; starting them replays from 0.

## 12. Verification checklist (per client)

1. Finish a movie: ended card, Replay restarts from 0 as a new playback
   session (heartbeats/progress resume), Back returns to the movie details.
2. Finish an episode with a next episode: up-next with 10 s countdown, Play
   now, Cancel, Replay, Back all work; suggestions row loads or falls back.
3. Finish the last episode/queue item: ended card only.
4. Music queue: tracks chain without a card; after the last track an ended
   card shows without a countdown.
5. D-pad/touch/keyboard rules and Back behaviour per sections 6 and 7.
6. Error, offline and cast edge cases from section 11.
