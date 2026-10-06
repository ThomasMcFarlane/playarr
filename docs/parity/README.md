# Pixel parity tooling

Work in progress (early push). Web is the reference; native clients are fixed to match it.

- `scripts/parity/screens.json`: canonical screen ids (home, movies, series, film-detail, series-detail,
  search, calendar, settings, player-controls, player-quality-menu, profile-switcher, household-blocked),
  the `tv` (1920x1080 at 1x) and `mobile` (390x844 at 3x, 1170x2532 device pixels) layouts and the tolerance.
- `scripts/parity/diff.mjs`: `cd scripts/parity && npm ci && node diff.mjs --ref <dir> --cand <dir> --layout mobile`.
  Directories hold `<layout>/<screen-id>.png`; writes `report.json`, `summary.md` and `report.html`.
- `scripts/parity/capture-web.mjs`: coming next.
