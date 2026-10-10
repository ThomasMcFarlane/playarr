# HarmonyOS parity (TV, 1920x1080)

Huawei serves HarmonyOS emulator images only in mainland China (row 5.10013), so HarmonyOS parity runs on the
**DevEco Studio Previewer** for now: TV device, 1920x1080, screen density 160 (1 vp = 1 px = 1 web CSS px), dark theme,
signed in to a real server as the device test account. It is a UI preview, not an emulator:

- No video playback (no AVPlayer), so the player screens cannot be compared.
- Image decoding (`@kit.ImageKit`) is mocked by the Previewer, so artwork does not render.
- The Previewer only runs `EntryAbility` in debug mode, and this Previewer build ignores the module `routerMap`, so a
  local, uncommitted preview overlay adds a `navDestination` route builder to `pages/Index.ets` and Previewer mocks for
  `deviceInfo` (`tv`) and a persistent Asset Store. None of it ships in the app.

Captures of real media are never committed (AGENTS.md); the side-by-sides stay in the worker's scratch folder.

## 2026-10-11 pass (live web TV layout vs Harmony TV, same account and data)

| Screen | Harmony status | Match |
| --- | --- | --- |
| Home | renders (after #638); different layout: hero plus one glass rail panel, no full shell nav rail, no clock | no |
| Movies, Series, Music | full-width 3-column portrait grid; web has hero panel plus landscape grid, alphabet rail, Filters | no |
| Film detail, series detail | hero plus panel; web has action row, chapters, similar titles, season rows | partial |
| Profile picker | centred (after #639); letter avatar instead of the preset, no initial D-pad focus | partial |
| Calendar, Search, Settings, Filters, actions panel | not implemented on Harmony | missing |
| Player controls | not testable in the Previewer | n/a |

Fixed in this pass: #638 (TV Home rail builders ran with the wrong `this`; TV Home was empty on every device), #639
(root Navigation in Stack mode; wide screens showed an empty 240 vp sidebar). Open gaps are tracked on row 13.809.
