# Android client working agreement

Applies to `clients/android/` (phones, tablets, **Android TV / Google TV**).

## Fully native. No WebView product path.

- **Android TV is Jetpack Compose + Media3 only.** Same application as mobile,
  with the canonical Play ID `app.playarr.mobile` and adaptive UI via
  `isTelevision`. The legacy sideload channel temporarily retains
  `io.playarr.mobile` solely so installed APKs remain updateable.
- **Never** mount a WebView / Chromium shell of Playarr Web for the signed-in
  television experience, pixel parity, AE=0 freezes, or "temporary" product
  shortcuts.
- **Never** claim Android TV visual parity by freezes of a WebView SPA against
  desktop Chromium. That is not the product and is not allowed as a success
  path.
- Parity work means **native Compose** (D-pad, focus scale, 1920×1080 density
  contract, Media3) matched behaviourally and visually to the web reference
  where appropriate. Honest native screenshots only.
- Banned tools under `clients/android/tools/parity_*.py` that implement
  WebView/SPA AE gates exit with code 2. Do not revive them.
- Canonical policy: `docs/architecture/client-principles.md` and
  `docs/architecture/clients/android-tv.md`.

## Why this is non-negotiable

WebView "parity" optimises for Chromium-vs-Chromium pixel identity and hides
missing native TV UI. The product bar is a fully native ten-foot Compose app.
