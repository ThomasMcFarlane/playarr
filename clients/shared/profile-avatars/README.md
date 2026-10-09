# Shared profile avatars

One source of truth for the six preset avatars (astronaut, cat, dinosaur, robot, pirate, alien).

- `presets.json`: ids, gradient stops and the SVG artwork. It mirrors the web client's `ProfileAvatar`, the reference.
- `plates/<id>.svg` and `plates/<id>.png`: the finished circular plate (web's 145deg gradient, 34%/26% sheen, artwork
  at 86%). The PNG is 240 px, for clients that cannot draw SVG (Roku).
- `render.mjs`: regenerates `plates/`; with `--check` it fails when `plates/` is stale or when `presets.json` and the
  web client disagree. CI runs the check.

Every client renders the account's server-side preference (`GET /api/v1/users/me/profile-avatar`): a preset id drawn
from this art, or a custom JPEG data URL. With no preference set, the preset is picked from a hash of the user id
(`defaultProfileAvatarPreset` in the web client).
