# @streamarr-tv/app-vidaa-fallback

Minimal PWA shell for VIDAA (Hisense) TVs. VIDAA has no dedicated native app
SDK target in the current plan, so this app runs as an installable Progressive
Web App against VIDAA's Chromium-based browser instead of a packaged native
bundle -- bootstraps `@streamarr-tv/ui-tv` with `@streamarr-tv/player-shaka`
(the same pairing as the webOS shell, since VIDAA's browser also supports
MSE + EME).

`src/featureFlags.ts` exports `vidaaOtaEnabled`, a stub flag for the
over-the-air self-update delivery path called out in the plan as VIDAA's
long-term distribution story. It is `false` until that path is implemented
and validated against a real VIDAA device or simulator.

## Building

`pnpm --filter @streamarr-tv/app-vidaa-fallback run build` produces a
static `dist/` bundle via Vite, installable as a PWA from any HTTPS origin
that serves it (root-relative `base: "/"`, unlike the file-packaged webOS/
Tizen shells).

## Known gaps

- No real VIDAA device or simulator is available in this environment, so
  the PWA install/OTA flow is untested here -- validate on-device before
  shipping.
- `manifest.json` references `icons/icon-192.png` and `icons/icon-512.png`,
  which are not included in this scaffold.
- Service worker registration (required for a fully offline-capable /
  OTA-updating PWA) is stubbed but not implemented; see `vidaaOtaEnabled`
  in `src/featureFlags.ts` and the corresponding guard in `src/index.tsx`.
