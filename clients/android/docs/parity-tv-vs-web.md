# Android TV vs Playarr Web: parity matrix

Audit date: 2026-10-03. Reference: Playarr Web (`clients/tv-web/web`, live at
`https://playarr.app`, signed in to a Playarr server at
1920 x 1080) against the native Compose app (`io.playarr.mobile` sideload
build) on the Android TV emulator, driven by D-pad. Test account:
`test-user-a`. Both clients are native-vs-web comparisons; no WebView is
involved on Android.

Evidence is stored with the audit session scratchpad (`parity/web/*.png`,
`parity/android/*.png`). Status values: **matches**, **differs (design)**,
**missing (feature)**, **broken**, **unverified** (not exercisable at test time).

## Matrix

| Area | Web | Android TV | Status | Notes / evidence |
| --- | --- | --- | --- | --- |
| Sign in (server, user, password, QR) | Form + QR | Device-code pairing + manual form | matches | Verified earlier by the harness |
| Profiles ("Who's watching?") | Avatar, settings, sign out, add profile | Same layout | matches | `09-profiles` (web and Android) |
| Home hero + rows | Hero, "Start watching", "New movies/series" | Same hero and rows; "On deck" row when progress exists | matches | `01-home`; Android dark theme vs web system theme |
| Series / Movies / Music libraries | 3-column large cards, title count, back button, filters, A-Z | Fixed 3-up landscape cards on television (4 small, 2 large; covers 6/5/4), count, filters, A-Z | **fixed, verified on device** | `02`/`03`/`04`; `PlayarrLibraryGrid.kt` mirrors `.tv-title-grid-content` |
| Library completeness | All titles (944 series, 1,746 movies) | Capped at 240 | **broken, fixed** | Now pages 200 at a time: 1,746 movies shown (`fix1-after-movies-1746`) |
| Unwatched dot on library cards | Pink dot | Pink dot (same rule as web `WatchStateOverlay`: unseen, or no progress once progress loaded) | **fixed, verified on device** | Web `02-series` |
| Playlists | List, create, filter | List, create, filter | matches | `05-playlists`; empty account only |
| Search | Query, filters, preview, results | Same | matches | `06`, `06b` |
| Search layout on TV | Clear of rail | Content hidden under rail | **broken, fixed** | `06b-search-results` before, `fix2-search-after` after |
| Search first-query latency | Index prefetched | Full catalogue crawl on first query (~30 s) | **broken, fixed** | Index warmed when Search opens |
| Stale search preview after clearing | n/a | Preview card remained | **broken, fixed** | `now` before the change |
| Title detail (movie) | Playback options, Play, chapters (thumbnails), cast, similar | Play/Resume, Add to playlist, Playback options, chapter thumbnails, cast, similar | **fixed, verified on device** | `10`/`11`; `GET /api/v1/media/{id}/thumbnail?position_ms=` (authenticated, as web `getMediaThumbnail`) |
| Detail initial D-pad focus | Play | Navigation rail Search item (OK opened Search) | **broken, fixed** | `fix3-before...`, `fix3-after...-detail` |
| Series detail (seasons/episodes) | Season rows of episode cards (frame thumbnail, backdrop fallback, unwatched dot) | Same; episode frame thumbnail over backdrop, unwatched dot | **fixed, verified on device** (frame thumbnails not loadable, see below) | Source audit of `SeasonEpisodeTrack`; season/episode ordering, playable-only filtering already matched |
| Music artist detail | Albums, track rows with unwatched dot | Same; track unwatched dot added | **fixed, verified on device** (frame thumbnails not loadable, see below) | Source audit of `MusicDetail.tsx`; web cover-flow carousel is a design variant, not ported |
| Continue watching / resume | Resume from position | "On deck" row, "Resume from 0:56" | matches | `fix3-after-detail-focus-play-detail` |
| Watchlist | None found in web source | None | n/a | |
| Downloads | Route 404s in hosted web | Downloads screen when permitted | n/a | Android-only by design |
| Player: audio / subtitle / quality menus | Yes | Quality menu verified on device; audio and subtitle menus appear only when the server reports tracks (dev server reports none) | partly verified | Playback returned HTTP 500 on web and Android at test time (`20-player-error-500`, `web/20b-player-controls`); error screens match |
| Player: previous / next episode, queue | Yes | Next episode and queue panel verified on device | **verified on device** | H.264 1080p episode (a test series) |
| Player: chapters seek | Chapters on detail only | Same | matches | |
| Player: skip intro, quality/direct-play badge | Not in web | Not in Android | n/a | |
| Cast button | Yes | Yes | matches (source) | |
| Settings: Appearance, Avatar, Language, Player, Server, Profile lock, Invite | Yes | Yes | matches (source) | `08-settings-*` web |
| Settings: Request latency | Admin diagnostic table | Absent | missing (feature) | Low impact; 403 for most users |
| Settings: Legal | Separate legal routes | Settings section | differs (design) | |
| Theme / language | Dropdowns on auth and profiles | Same | matches | `09-profiles` |
| Mini player | Minimised player | Hidden unless playback is ready; a failed start (load failure or player error) off the player screen clears the queue | **broken, fixed, verified on device** | `t_s` capture after `20-player-crow` |
| Profile control focus cue | n/a | Focused but invisible | **broken, fixed, verified on device** | |

Counts after the on-device pass: see the verification section below.

## Fixes (branch `task/android-tv-parity`)

1. `fix(android): page through the full library catalogue`
2. `fix(android): keep tv search content clear of the navigation rail`
3. `perf(android): warm the search availability index when Search opens`
4. `fix(android): focus Play first on television title details`
5. `fix(android): show a visible D-pad focus ring on the television profile control`
6. `fix(android): dismiss the mini player after a failed playback start`
7. `feat(android): show frame thumbnails for movie chapters`
8. `feat(android): match web library grid density and unwatched dot on television`
9. `fix(android): label the no-subtitles option and default the audio selection like web`
10. `feat(android): show episode frame thumbnails and unwatched dots on series and music detail`

Source-audited with no discrepancy found: playlist creation (name required,
media type, parent playlist, server media-type mismatch rollback), Settings
sections (Request latency remains the only gap), previous/next and queue panel.

## On-device verification (combined build, 2026-10-03)

Build: `verify/combined` (this branch plus `task/android-eu-perf`),
`:app:assembleSideloadRelease`, debug-signed, installed over the signed-in
emulator at 1920 x 1080. Screenshots are in the audit scratchpad
`verify/*.png`.

| Item | Verdict | Evidence |
| --- | --- | --- |
| Library grid 3-up beside preview panel, focus scale not clipped | verified, including first, middle and right-edge columns | `02-movies-grid`, `03-grid-focus-mid`, `03b-grid-focus-right`, `03c-grid-focus-left` |
| Unwatched dots | verified; dot was grey, now crimson `#CF3157` like web | `03c...` (before), `23-music-crimson-dots` (after) |
| Movies and series counts | verified: 1,746 movies and 944 series after paging | `02b-movies-1746`, `07-series-detail` background |
| Detail opens with Play focused | verified (movie and episode) | `04-detail-opened`, `07-series-detail` |
| Chapter thumbnails (authenticated) | not provable here: the dev server has no ffmpeg (thumbnail endpoint returns 500 with auth, 401 without), so cards show the same empty placeholder as web | `04-detail-opened`, `25-after-failed-back` |
| Episode thumbnails and unwatched dots on series detail | dots and backdrop fallback verified; real frames not loadable for the same server reason | `07-series-detail` |
| Profile control focus ring | verified | `28-rail-focus` |
| Search layout clear of the rail | verified | `29-search-empty`, `30-search-results` |
| First-search latency | about 2.5 s to first results (previously about 30 s), measured by polling `uiautomator`, so +/- 1 s | `30-search-results` |
| Mini player after a failed start | verified: a 500 on Play shows the error screen, and no mini player remains after Back | `24-movie-play-failed`, `25-after-failed-back` |
| Player: quality menu, next episode, queue panel | verified on an H.264 1080p episode | `18-quality-menu`, `19-queue-panel`, `21-next-episode` |
| Player: audio and subtitle menus | not exercisable: the server reports no audio or subtitle tracks for any title tried (ffprobe missing) | n/a |

Defects found on device and fixed on the playback branch: the player surface
ignored D-pad keys (packed key code read with `toInt()`), the seek slider
trapped focus, and playback buttons had no focus ring. The unwatched dot
colour was fixed on this branch.

## Remaining gaps, by impact

1. Real chapter and episode frame thumbnails, and the audio and subtitle
   menus, need a server with ffmpeg and ffprobe; re-verify there.
2. Web music cover-flow carousel and the web player's mute, volume and
   fullscreen controls are not ported (television uses system volume).
3. Request latency settings section is absent (admin diagnostic).
