# Android fastlane metadata

The Play store screenshots in `metadata/android/en-US/images/` show the open-movie demo library (openly licensed
Blender films, credited in the root README under "Third-party media") on the current native app, signed in as the
`demo` profile. Never use the parity fixture (`scripts/fixtures`) for them.

Retake them with the showcase (`scripts/showcase`): `fetch-media.sh`, `up.sh`, then `capture-android.sh` on a
1080x2400 phone and a 1920x1080 TV emulator, then `node scripts/showcase/manifest.mjs --write`. CI
(`scripts/ci/check-public-screenshots.sh`) fails when a public screenshot changes without `scripts/showcase`.
The icon, feature graphic and TV banner are brand graphics. The release workflow uploads these images to Play on
every release (`skip_upload_images: false`), so a bad screenshot reaches the live listing.
