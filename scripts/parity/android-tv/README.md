# Android TV parity capture

`capture.sh <out-dir> <light|dark> [screen-id ...]` captures the TV screens from a running emulator (see its header for the setup)
and writes `<out-dir>/tv/<theme>/<id>.png`. Compare with the shared tool, chrome only on the player screens:

    node scripts/parity/diff.mjs --ref docs/parity/web --cand <out-dir> --layout tv --theme dark --chrome-only

Notes: the script clears the app data for every run (a leftover explicit theme, saved profile or paired device changes the
screens), chooses the theme in the app's own display preferences, freezes the app clock to the fixture clock with the
`parity_clock` extra, pauses the player at 2.0 s with `parity_pause_at_ms`, and waits for the debug build's
`PlayarrParity images inflight=0` log before every screenshot. Capture the player screens in one run (the quality menu
follows the controls) and keep the player-quality-menu after player-controls in the list.
