# Simulator VNC

`sim_vnc.py` serves one Apple TV simulator over VNC (RFB 3.8, VNC password, Tight/JPEG), standard library only.
It runs on the MacBook under the launchd agent `app.playarr.sim-live` (started over ssh; there is no repository workflow), bound to the Mac's tailnet address.

- Frames: `idb video-stream` (MJPEG), falling back to `xcrun simctl io <udid> screenshot`. Never the runner desktop.
- Keys: arrows move, Return selects, Escape or Backspace is Menu, Space is Play/Pause (sent with `idb ui key`).
- Password: environment variable `PLAYARR_VNC_PASSWORD`; the protocol only uses its first 8 characters.
- `seed_session.py` signs the device test account in by seeding the app's saved session (no QR flow).
- Tests: `python3 scripts/sim-vnc/test_sim_vnc.py`.
