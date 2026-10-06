# Phone remote and handoff: emulator run, 2026-10-07 (TASKS rows 53 and 174)

Second emulator pass, following `docs/validation/remote-physical-devices.md` as far as emulators allow.
The first pass is recorded under row 53 (2026-10-04). This one repeated it on a fresh local fixture
server (row 457) and added network loss, the TV app being backgrounded or restarted, and two controllers.

## Setup

- `sideload` debug build of the Android app on an Android TV emulator (API 36) and an Android phone emulator
  (API 35), run at the same time, headless, each under its own memory scope.
- One fixture server (`scripts/fixtures/up.sh`, own data directory and port), reached from both emulators over
  the emulator host alias; clips of three minutes with a burned-in timecode so positions can be read off the screen.
- Same fixture account on both devices. Input was `adb input` taps on the phone and, on the TV, D-pad key events
  only (a tap puts an emulator in touch mode, where the first key press only leaves touch mode).
- `scripts/remote-control-smoke.sh` against the fixture server first: `RESULT: PASS`; push command latency
  p50 34 ms, p95 239 ms; long-poll p50 54 ms, p95 708 ms; handoff create to commit (instant destination) p50 284 ms.

## Results

| Step | Result | Measured | Notes |
|------|--------|----------|-------|
| 1 Pair and approve | pass | codes matched on both screens | An unanswered prompt expired and the phone showed "The pairing was not approved."; commands only worked after Allow. Approval by D-pad Enter works. |
| 2 Navigate | pass after PR 98 | command acknowledged in 0.28 s (scripted controller), phone UI press to TV focus change under 2 s on the slow emulator | Up/Down/Left/Right/Home/Back moved focus as expected. Defect found and fixed: the first Select on a rail or grid card only moved focus (a second press opened it), for the physical remote as well as the phone remote. |
| 3 Text entry | pass (partial) | live mirror of the phone field into the focused TV search field | Space and several characters mirrored; accents and backspace not exercised (`adb input text` cannot type them). With no text field focused the phone shows "That did not work on the device." Up from Filters lands on the Back button rather than the search field (focus order, not fixed here). |
| 4 Playback | pass | pause held position, play resumed, +10 s and -10 s moved it, Stop returned the TV | Verified from the target's reported state, which lags by up to about 5 s. |
| 5 TV to phone | pass | create to commit 6.3 s; position 0.8 s behind the expected value | TV stopped only after the phone was playing. Latency is over the 5 s LAN target on this software-rendered emulator; not a real-device figure. |
| 6 Phone to TV | pass after PR 99 | create to commit 2.3 s; position 0.4 s behind the expected value | Before the fix a destination that had earlier played the same file acknowledged after 0.5 s with a stale position 64 s off. "Move to a second TV" not run (one TV emulator). |
| 7 Wrong profile | partial | a second account gets 404 `not_found` when pairing to this account's TV and does not see it | Switching the TV to a profile that cannot see the title not run. |
| 8 Input switching | not run | | Emulators have no capture inputs. Real device only. |
| 9 Revocation | pass | | Revoked from another device: the phone dropped its pad on its next refresh and listed the TV as pairable again; a second controller on the same TV kept working. Command-after-revoke rejection is covered by the smoke script. |
| 10 Network loss | pass after PR 101 | see below | |
| 11 Rename | not run | | |
| 12 Push versus fallback | pass (server side) | long-poll p95 708 ms | Smoke script only; no proxy that blocks long-lived connections was available. |
| Two controllers | pass (one scripted) | both worked, revoking one left the other | The second phone was a scripted client of the same account; a third emulator would have exceeded the emulator cap. |

### Network loss and app lifecycle

- Phone offline (airplane mode, 20 s, three presses): no press reached the server, nothing was replayed on
  reconnect, the next press worked. The phone said "That did not work on the device." (wrong); now "No connection."
- TV app in the background (system Home) for more than 20 s: commands stayed queued and expired, the TV was still
  listed online, the phone showed nothing. Now the phone shows "The device did not respond. Check that Playarr is open on it."
- TV app force-stopped: listed offline within 45 s; relaunched, back online within 15 s with the same pairing and no re-pairing.
- Server frozen for 53 s (SIGSTOP/SIGCONT): the TV came back by itself and the push stream resumed without a restart.
- A per-app network deny on the TV (`cmd connectivity` chain 3) did not cut the already-open stream, so it is not
  counted as TV network loss; an emulated TV is on Ethernet, which cannot be switched off without root.

### Other observations

- Every reinstall of the app registers a new device, so stale "Offline" TVs and duplicate pairings pile up in the
  phone's lists until revoked. Real devices will see this only after reinstalls or factory resets.
- A one-shot focus request for the TV approval prompt can run before the prompt is attached; the prompt now retries.

## Only a real device can prove

- Real input switching (task 38 capture inputs) and the "no control offered" case on a TV without inputs.
- Latency and position drift on real hardware and a real LAN (the figures above come from software-rendered emulators).
- Physical TV remote behaviour (key repeat, long press, first press after the app opens), TV standby and wake.
- A genuine Wi-Fi or Ethernet drop on a TV, and a router that blocks long-lived connections.
- Several physical TVs and moving playback between two of them; a profile switch on a physical TV.
- Accented text and backspace through a real phone keyboard.

## TV-to-phone handoff latency breakdown (follow-up)

Measured step 5 (create to commit 6.3 s) split into its steps, from the recorded handoff row, the controller
tap time and the state polls of both devices:

| Step | Time | Where | Avoidable? |
|------|------|-------|-----------|
| Tap to `POST /remote/handoffs` accepted (pairing, source and destination lookups, media access check, insert, push wake) | about 0.04 s on the phone's side; the server share is a handful of local database reads and one insert (smoke script: create to commit with an instant destination p50 0.28 s, including both HTTP calls) | phone and server | No |
| Offer delivered to the destination over the push stream | milliseconds (smoke script push p50 34 ms) | server | No |
| Destination acknowledges the offer event and starts the handoff in parallel | the event ack is issued after the player start is launched, so it adds no wait | phone | Already parallel |
| Open the player route, resolve playback, buffer, first frame | about 5 to 6 s on a software-rendered emulator (the destination first reported playing about 4.7 s after the tap) | phone | Not on this path; a real device is expected to be much faster |
| Start check poll and settle pause before the ack | up to 250 ms poll plus a fixed 300 ms pause, plus another poll when a catch-up seek is needed | phone | Yes: now 100 ms and 150 ms |
| Ack to commit (`POST .../ack`, one compare-and-set) and the controller's held request returning | tens of milliseconds; the controller holds a long poll, so it learns of the commit at once, with no poll interval | server | No |

Conclusion: the server and network share is well under 0.5 s; the rest is the destination player's start-up. The
two fixed waits in the destination were trimmed (about 0.3 s saved per handoff). Whether the 5 s LAN target holds
on real hardware still needs a physical device (row 174).
