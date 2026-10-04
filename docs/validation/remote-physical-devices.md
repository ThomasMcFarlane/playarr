# Phone remote and handoff: physical-device validation (TASKS rows 53 and 174)

Emulator and server evidence is already recorded under row 53. This checklist is what remains for real
hardware. Budget: 45 minutes with one phone, two TVs (Android TV or a web TV shell), one test account.
Record each result in the table at the end and paste it into row 174.

## Before you start

- Server on a build that includes the push stream (`GET /api/v1/remote/stream`); check
  `scripts/remote-control-smoke.sh https://<server>` prints `RESULT: PASS` first (it exercises pairing,
  push and long-poll delivery, handoff and revocation with throw-away devices and prints timings).
- Same Playarr account on the phone and both TVs, same server. Use a playable title that direct plays
  on both TVs. Note the TV models, phone model, OS versions and the network (same Wi-Fi or not).
- Turn on "Allow my other devices to control this one" on each TV (Settings, Phone remote). It is on by
  default on Android TV.

## Script

1. **Pair and approve.** Phone: Settings, Phone remote, tap TV A, Pair. Expect a code on both screens.
   Deny once (phone shows "not approved"), then pair again and Allow with the TV remote. Pass: no commands
   work before Allow; they work straight after.
2. **Navigate.** Use Up/Down/Left/Right/OK/Back/Home through Home, a title page and Search. Pass: every
   press moves focus once; first press on a freshly opened TV app moves focus (no dead first press).
   Stopwatch ten presses: each should feel instant (target under 300 ms on the same LAN).
3. **Text entry.** Open Search on the TV, focus the field, type on the phone keyboard (include a space, an
   accent and backspace). Pass: the TV field mirrors the phone live; Send submits.
4. **Playback.** Start a title on TV A. From the phone: pause, play, -10 s, +10 s, Stop. Pass: each takes
   effect within a second; Stop returns the TV to its previous screen.
5. **Play on this phone (TV to phone).** While TV A plays, phone shows "Playing on TV A" with
   "Play on this phone". Tap it. Measure from tap to first frame on the phone (target under 5 s on a LAN).
   Pass: TV A stops only after the phone is playing; position within 2 s of where the TV was.
6. **Move to the other TV.** With the phone controlling TV A while it plays, tap "Move to TV B"
   (pair with TV B first if asked, approve on TV B). Pass: TV B starts, then TV A stops; position within 2 s.
7. **Wrong profile.** Switch TV B to a profile that cannot see the title, repeat step 6. Pass: refused with
   a clear message and TV A keeps playing.
8. **Input switching** (only on a TV that supports capture inputs): from the phone select another input.
   Pass: input changes; a TV without inputs does not offer the control.
9. **Revocation.** Revoke the phone's pairing from the TV (or from Settings on another device). Pass: the
   phone's next press is rejected and no queued press arrives late; re-pairing needs approval again.
10. **Network loss.** Phone: turn Wi-Fi off for 20 s while pressing Down, then back on. Pass: no press is
    replayed after reconnect (commands expire after 30 s), the phone shows a failure rather than hanging.
    TV: unplug network for 60 s, restore. Pass: the TV is listed offline then returns by itself within
    about 30 s and the push stream resumes without a restart.
11. **Rename.** Phone: Settings, Phone remote, Paired remotes, Rename. Pass: new name shows on the phone and
    in the TV's list; Revoke removes the row.
12. **Push versus fallback** (optional): put the phone and TV behind a network that blocks long-lived
    connections. Pass: control still works (long poll), a little slower.

## Evidence table

| Step | Device(s) | Result (pass/fail) | Measured value | Notes |
|------|-----------|--------------------|----------------|-------|
| 1 Pair and approve | | | | |
| 2 Navigate | | | ms per press | |
| 3 Text entry | | | | |
| 4 Playback | | | | |
| 5 TV to phone | | | s to first frame, position drift | |
| 6 Move to TV B | | | s, position drift | |
| 7 Wrong profile | | | | |
| 8 Input switching | | | | |
| 9 Revocation | | | | |
| 10 Network loss | | | s to recover | |
| 11 Rename | | | | |
