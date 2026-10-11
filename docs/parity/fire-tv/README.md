# Fire TV parity evidence

The Fire TV (Vega OS) client is compared with the web TV client at 1920x1080, in light and dark, on a real Fire TV Stick 4K Select.
Candidates come from `scripts/parity/fire-tv/capture.sh` (remote only, foreground-checked key presses); references come from
`scripts/parity/fire-tv/capture-web-live.mjs` run against the same server as the same account in the same session. The mismatch is
`scripts/parity/diff.mjs --layout tv`, the share of pixels that differ.

## Mismatch per screen

Live data (artwork, titles, clock) differs between a device and a browser capture, so the figure is a ceiling on layout error, not a
pass or fail on its own. Empty-state and form screens, which carry no artwork, land under 1 %.

| Screen | Dark | Light |
| --- | --- | --- |
| Home | 13.63 % | 8.05 % |
| Movies | 2.73 % | 3.15 % |
| Series | 4.65 % | 3.05 % |
| Film detail | 6.47 % | 6.40 % |
| Series detail | 4.93 % | 3.77 % |
| Search | 5.25 % | 4.49 % |
| Calendar | 3.39 % | 6.05 % |
| Downloads | 0.46 % | 0.44 % |
| Watchlist | 0.43 % | 0.50 % |
| Requests | 0.64 % | 0.53 % |
| Profile picker | 3.17 % | 3.37 % |
| Settings (list) | 1.22 % | 1.78 % |
| Settings: Profile avatar | 2.21 % | 3.08 % |
| Settings: Language | 0.81 % | 1.66 % |
| Settings: Player | 1.66 % | 2.90 % |
| Settings: Server connection | 1.42 % | 2.49 % |
| Settings: Profile lock | 0.83 % | 1.75 % |
| Settings: Invite a friend | 1.19 % | 1.92 % |
| Settings: Request latency | 0.86 % | 1.72 % |
| Settings: Phone remote | 1.43 % | 2.30 % |
| Settings: Your data | 2.48 % | 4.44 % |

Home is highest because its rails show different live artwork per capture and the hero art is not greyscaled on the device.

## Verified on the device (not by pixel diff)

- Player: controls, quality menu, layered Back (controls hide first, then the player exits), scrubber OK toggles play and pause,
  playback start and the resume point updating.
- Scrolled states: Home rails with the left gutter fade, library grid with the top fade, settings and calendar lists.
- Household-blocked page: unit-tested only; it needs a restricted account to show on a device.

## Platform limits and exceptions

- Dolby and DTS audio: Shaka Player on Vega plays direct MP4 with AAC. A title whose only audio is Dolby or DTS fails natively;
  the player's error panel offers "Choose quality", which asks the server for an audio transcode. Nothing in the client fights the platform.
- Vega has no masking: scroll-edge fades are overlays tinted to the page colour (light is softened so no box shows over the art wash).
- The focus engine measures layout frames, not transforms, so rails scroll through an animated `left` offset.

## Vega Virtual Device run (2026-10-11)

The wall's Fire TV slot runs the Vega Virtual Device at 1920x1080 at a fixed 1:1 window scale, signed in as the device test account in
the dark theme. Candidates are captured from the emulator window, references from live web as the same account in the same session, and
compared with `scripts/parity/diff.mjs --layout tv --theme dark` (clock and profile tile masked on both sides). Live data, so the figures
are a ceiling on layout error.

| Screen | Mismatch |
| --- | --- |
| Profile picker | 0.92 % |
| Player controls | 1.15 % |
| Settings | 1.55 % |
| Series | 1.64 % |
| Home | 1.85 % |
| Movies | 2.06 % |
| Title actions | 2.73 % |
| Search | 2.91 % |
| Series detail | 3.58 % |
| Film detail | 4.33 % |
| Calendar week | 6.21 % |
| Calendar agenda | 8.28 % |

Notes from the run:
- The virtual device's own screenshot tool writes empty files, so captures come from the emulator window. Keys reach the app most
  reliably through the window's keyboard (arrows, Return, Escape for Back, F2 for Menu), with at least 1.5 s between presses on the slower screens.
- Resizing the emulator window kills its GL output; start it with `-fixed-scale` instead.
- The calendar and Home commit thousands of view mutations per frame on Vega, so focus can lag the remote by seconds there.

## Open gaps

Calendar agenda details panel and entry pills in web's newer design; downloads (download support itself, hidden by ruling); music library and
music detail restyle; the profile picker's focus state; settings panels are not yet all pixel-matched.
