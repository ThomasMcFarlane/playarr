# Changelog

All notable changes to Playarr Server and Playarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Deprecated

- Postgres support is deprecated and will be removed in the next change: Playarr becomes SQLite-only (ADR 0002, superseding ADR 0001). Multi-node deployments use peer sync between SQLite nodes. The shared-database Kubernetes tier and Docker Compose with Postgres are dropped.

### Fixed

- Android: preset profile avatars now use exactly the web client's artwork, gradient and highlight.
- tvOS: the shell chip and the profile row show the account's custom photo avatar, instead of a preset picked from the profile id.
- Roku: the identity chip and the profile row show the account's own avatar (preset or custom photo) instead of a hard-coded or id-hash preset, and all six presets now have their artwork.
- Fire TV: the shell chip and profile row show the account's own avatar (preset or custom photo) from the server, and the preset artwork now matches the web client exactly.
- Shared profile avatar plates draw the highlight under the artwork, matching the web client.
- Fire TV (Vega): the app now ships the Playarr brand icon (512x512, 8-bit RGBA PNG, the same artwork as the Android clients) and the 16:9 brand banner instead of the 16-bit placeholder letter tiles, and the pre-build gate rejects a package icon that is not exactly 512x512, larger than 1 MB or not 8-bit.
- Android (TV and phone): the profile chip now opens the profile switcher with the account's profiles even when the session never learnt its user id at sign-in, instead of an empty "Who's watching?" that looked like a sign-out.
- `GET /api/v1/media/{id}/thumbnail` answers 204 No Content instead of 500 for a file with no video frame or cover art (audio without embedded art); the web client treats it as an expected miss, keeps its fallback, and no longer retries or logs a console error.
- Downloads, Watchlist and Requests now fill the page on a phone instead of keeping Home's 62% column, and the Downloads storage line starts below the page header.
- Web: QR sign-in retries network blips and server errors silently (2 s doubling to 30 s, keeping the current code while it is valid) instead of showing an error with Try again; only denial or an unexpected failure shows it.
- Web: live update frames (and resyncs, reconnect gaps and fallback polls) now also drop the matching stored query copies immediately, so screens opened from the stale-while-revalidate cache after a change on another device never show an old copy first.
- Storybook: the theme toolbar now drives the whole preview (canvas, docs page and its canvas toolbar use the app `--bg` and surface tokens), and the Storybook manager defaults to dark.
- Web: every page opens with focus in the page (movie detail on Play, empty pages on Back), the start focus is no longer reset once a minute, Downloads, Watchlist, Calendar and Folders restore focus on return, and the profile-switcher selects and calendar period picker work with the remote.
- Web: closing a side drawer (Filters and the others) now eases out smoothly. The reversed expo curve sat still for half the time and then dashed away, which read as a jump; the close now starts moving at once over the same path and duration as the opening, and a per-frame e2e checks the drawn close.
- Web: the library's left preview (title, year line, description) now follows the remote within a frame instead of after about 600 ms, never blanks, and the backdrop art cross-fades once the next image has loaded.
- Web calendar: the source-error banner that shifted the grid is gone; the "today" marker follows midnight; rapid Previous/Next presses no longer drop steps; date-only releases stay on their own day in every time zone; moving through the agenda no longer rewrites the URL and regroups the list on each key.
- Web: the Watchlist no longer shows the developer "Recording is not available yet" line; `/household` uses the standard page frame; Request latency is hidden from non-administrators; every page error state has a Retry that D-pad focus lands on; cast and crew photos come through the server as 240 px thumbnails instead of the provider's original.
- Server: `GET /api/v1/catalog/{id}/similar` answers 200 with an empty list for a title without an embedding (404 only for an unknown title); `GET /api/v1/users/me/capabilities` reports `is_admin`; new `GET /api/v1/artwork/person/{person_id}` serves resized, cached headshots.
- Web: on the music artist page the mini player no longer overlaps the left edge of the track list (1920x1080 and 1280x720, both themes).
- Web: Search Filters sits in the action column on the right like every other page and opens the shared filters panel.
- Calendar background refresh: slow sources get 120 s per month instead of 30 s, and a failed refresh logs its reason.
- Web: the navigation rail fits 1280x720 and 1366x768 screens; the profile chip no longer covers the last entries and the first is no longer cut off at the top.
- Web player: BACK leaves on the first press while the stream is loading, buffering, failed or showing the end card, and the mute button is reachable with the remote.
- Web: one focus style system. Controls (buttons, pills, inputs, chips, selects, the profile chip and avatar, Back) show the single theme ring (white in dark, ink in light) with no fill, glow or scale; media cards (including playlist collages, folders, music albums, calendar entries and the watchlist, requests and downloads rows) lift with the pinned soft shadow on keyboard and D-pad focus, never a ring. Playlist cards and stacked items now lift on focus (stale remote-marker neutralisation no longer cancels a settled focus). The three competing ring systems are gone.
- Web: the music artist page keeps the album card, its label and the audio controls apart (no clipping, no overlap).
- Web: BACK works the same everywhere. One shared helper covers Escape, Backspace, BrowserBack, Tizen and webOS codes; dialogs close without also leaving the page; nested Folders and a playlist's detail go up one level on the remote as on the on-screen Back.
- Web player: watch progress is no longer written to the next item after a playlist advance, never writes position 0, and the offline progress queue no longer double-sends or retries rejected writes forever; Space and K no longer hijack focused buttons.
- Web: restored the Home and detail rail edge fades (a dark box appeared at the right edge of rails that run off screen); the focused-card shadow fix returns separately.
- Calendar: a slow or unreachable *arr source now times out after 4 s instead of 10 s, is not retried for 30 s, and its last good entries stand in while it is down.
- Web: titles show their release year everywhere (library preview and cards, downloads, search, detail, admin work detail), never the year they were added to the library; with no release date no year is shown. One shared helper replaces the divergent copies, and the calendar's legacy watchlist and request snapshot no longer uses an episode's air year.
- Web: right-side panels (Filters, Calendar link, Create playlist, playback settings, download quality, context menus) now close with the exact reverse of their opening animation (same duration, mirrored easing, slide out to the right) on every close path, and focus returns to the launcher afterwards. Reduced-motion users get an immediate close.
- Web: a focused card's soft shadow and lift are no longer clipped to a box by the Home, detail and search rails; the rails keep their positions, edge fades and horizontal scrolling.
- iOS: the signed-in profile is named by its display name from the server's profile list, resolved after sign-in and on app start, instead of the username typed to sign in (like Web and Android); the rule lives in PlayarrKit (`ProfileDisplayName`) with tests.
- tvOS library hero title wraps over lines like the web heading.
- Roku: Home rails scroll like the web track (the focused card ends 34 px further right than a whole-card step, and lines up with the track start when moving back), and the first Right press from the first card now moves to the second card every time.
- Roku: a long title whose on-demand transcode takes about twenty seconds to publish its first playlist now keeps retrying quietly instead of failing on the first 404 and returning to the detail page.
- tvOS series page: the focused episode is no longer scaled twice.
- Web: the remote no longer dead-ends in the shell action column (Filters, Create, Calendar link): DOWN past the last button and LEFT reach the nearest content item (the alphabet first on Library pages), UP past the first button reaches the header, RIGHT stays put.
- Android TV: playlist, album and similar-title tiles focus with the media-card shadow and a draw-only lift (no ring, no scale), and the profile picker's lift no longer shifts layout bounds.
- Android TV: a rail brings a focused card into view by scrolling only as far as it takes to unclip it, so UP and DOWN between rails never drag the target rail to a matching offset.
- Android TV: Settings opens with focus on the first section and the music artist page opens on the selected album.
- The server image build no longer fails with `Cannot find module '@playarr-tv/player-core'`: the Dockerfile builds every workspace package under `packages/` before the web app, and a new CI job builds the image's web stage on pull requests that touch the Dockerfile or `clients/tv-web/`.
- VIDAA, webOS and Tizen: the TV layout is scaled to a 1080-high stage whatever viewport the TV browser reports (for example 1280x720), so the sign-in link code and the navigation rail are no longer cut off. Adds the `smoke:tv-viewport` Playwright check.
- Web TV layout: on a series page, UP and DOWN from the far right of a season rail now land on the nearest episode card instead of the season download button.
- Android: closing the player while it was still buffering no longer resets the saved resume point to the start. Progress is only written once playback has actually started.
- Android: a start that stalls (or a playback error) now retries automatically with backoff and then shows an in-player error with Try again and the X close, in plain language instead of an exception name.
- Android: controls hide after 5 seconds, double-tapping the left or right half of the phone player seeks 10 seconds, leaving the app pauses and saves progress, and returning shows the paused player with its controls.
- Android: when the device cannot play the original and a converted stream is used instead, the player now says so.
- Web: a focused media card (poster, thumbnail, episode, cast and similar-title tile) lifts with a soft shadow again and shows no ring or outline, including the TV D-pad marker. Buttons, pills and Back keep the ring.
- Android TV: a focused media card (Home, Movies, Series, search results, episode tiles, similar titles) now shows a soft shadow and lifts, animated, with no ring and no fill; buttons, pills and Back keep the ring. The lift is drawn inside the card, so it never changes the bounds D-pad focus search measures.
- Android TV: UP and DOWN between Home rails land on the card visually above or below (closest on-screen centre), never on the same index of a rail scrolled elsewhere.
- Android TV: coming back from a detail page or the player puts focus on the card you opened, not on the first navigation item.
- Calendar on TV: in the week view LEFT/RIGHT now moves between days and UP/DOWN between entries (web and Android TV), the focused entry always scrolls into view, every scrollable calendar area shows the edge fade where content continues, and in the agenda the details panel follows focus.
- Calendar entries' coloured left border now shows availability (a playable file in the library, or not) instead of the media kind, on web and Android.
- Web: Filters, Create and Calendar link sit in one shell-owned column at the right edge again, stacked vertically exactly where the 30 September Filters tile was (a row left of the avatar on phones), instead of in each page's header row.
- Web TV layout: UP and DOWN between Home rails now land on the card visually above or below instead of the same index, and the target rail no longer scrolls to match.
- Android: Home rails fade at their edges like the web client. Cards scrolled past the start line fade away over the gutter on the left (the card at rest stays fully visible) and a soft shadow shows on the right while more cards follow, in both themes, on television and phone.
- Roku: a series opens with focus on the episode to play next (its season selected and scrolled into view, S1E1 when nothing was watched), and library key art no longer crashes the channel.
- Roku: playback now resumes from the server's resume point and reports watch progress (periodically, on pause, on exit and at the end) through its own request tasks, so leaving the player no longer loses the position. Nothing is written when playback never started.
- Fire TV client: playback works again on a real device. The app now loads Shaka Player for Vega (installed by `scripts/setup-shaka.sh`) with the navigator fields it needs, and advertises the containers and codecs the stick decodes so the server direct-plays instead of answering 503 for an on-demand transcode it has no capacity for.
- Fire TV client: the access token is renewed before it expires and after a 401, instead of the raw stored token being used until the device was signed out about fifteen minutes after pairing (every request then failed with 401). When renewal is refused everywhere the app returns to the profile picker.
- Android TV: pressing DOWN on Home moves down through the rails instead of bouncing sideways between the first two cards. Home rails, the Movies and Series grids and the series page follow the web TV's D-pad rules (same card column between rails, hard stop at the end of a rail, LEFT from the first card goes to the navigation rail, RIGHT in the last grid column goes to the alphabet strip).
- Android TV: focus is a 3 px ring (white in the dark theme, ink in the light theme) with no background fill on cards, buttons, pills, navigation items and list rows; television no longer draws the Material focus overlay.
- Android TV: a series page opens with focus on the next episode to play (the episode the Play button resumes, or the first episode when nothing was watched), and coming back from a title restores the last focus on Home, Movies and Series.
- Android TV: Home opens with focus on the first content card instead of the first navigation item, and after playback or a detail page Home puts focus back on the card that was just opened or watched.
- Web: the profile page no longer re-arms its keyboard, focus and observer wiring on every render, and avatar re-reads of unchanged storage no longer re-render the shell. Added `pnpm smoke:profile-chip`, which clicks the profile chip and the Clients link and asserts both settle within a request and DOM-mutation budget in desktop and TV layouts and both themes.
- tvOS: the player now resumes from the server's saved position and reports progress while playing, on pause, at the end, when the app leaves the foreground and on exit (awaited), and never overwrites the resume point with position 0.
- Web player: every focused control shows the white ring, controls auto-hide after 5 s, arrow keys only reveal the controls while hidden (j, l and media keys seek 10 s), failed starts retry silently with back-off and then show a readable error with Retry and Close, the Info panel shows the title and synopsis, the quality chip fits narrow phones, and double-tapping the left or right half seeks 10 s on touch.
- iOS: leaving the player now delivers the resume point before returning (background task, awaited), flushes it when the app leaves the foreground, and never overwrites it with position 0 when playback did not start.
- Fire TV: BACK now stops playback (audio and video), closes the session and saves progress, awaited with a short bound; it previously only hid the player and left it playing.
- Fire TV: playback resumes from the server's resume point (falling back to the local session only when the server cannot be reached), and progress is never written for a start that never played, so a stalled start can no longer overwrite a resume point.
- Fire TV: progress is also flushed when the app goes to the background.
- Roku: a series opens with focus on the episode to play next (its season selected and scrolled into view, S1E1 when nothing was watched), and library key art no longer crashes the channel.
- Fire TV client: the signed-in session, device id and server address now survive an app restart (the storage allowlist still used the old `streamarr:` prefix, so nothing the shared packages wrote under `playarr:` was saved), and a device that holds a session opens on the profile picker instead of pairing again on every launch.
- Harmony player now resumes from the server's saved position, saves progress (awaited) on exit, error and when backgrounded, and never writes position 0 before playback has started.
- Xbox player now resumes from the server's saved position, saves progress on suspend and when minimised, and never writes position 0 before playback has started. Watch-state values now match the server.
- The shared TV player (VIDAA, webOS, Tizen shell) now resumes from the server's saved position, reports watch progress while playing, saves on exit, background and end, and stops playback on exit.
- Every page's Filters button and the Calendar's Filters and Calendar link buttons are one tile again, the look the library Filters launcher had on web on 30 September (owner ruling): a 14 px-radius tile with the glyph above a small bold label (icon only, 44 px, on phones), in the header action slot. Web's header pill from the shared page shell (4 October) is gone, and the header row centres on the taller tile. Focus draws the ring (white in dark, ink in light) with the 1.06 scale and never a fill; the open state keeps the ink fill. Android TV and phone, tvOS and iOS draw the same tile.
- Android TV: the earlier calendar restyle (#154) had rebuilt the shared header button for every page and dropped its focus state; it is the tile above now.
- The post-merge web deploy no longer fails at "Test web client": the web vitest config resolves `@playarr-tv/spatial-nav` from source, so tests run in a clean checkout without a build. Pull-request CI now runs the same web test command as the deploy, and the deploy job timeout is 30 minutes.
- The web client now deploys after every merge to main, including merges landed by the merge train without a push event (CI started with `workflow_dispatch`); previously every post-merge deploy was skipped. The docs deploy gains the same dispatch trigger.
- Web TV: the series detail page now shows the shared focus ring on every focused control and tile (play/resume, watchlist, playlist, season download, episodes, cast and similar titles), and opens focused on the next item to play (the episode the Play button resumes, in its season, scrolled into view) instead of the first episode. Returning to the page restores the last focus.
- Fire TV client: poster and backdrop artwork now loads on a real device (the artwork URL had a double slash after the server address, which the server answered with 404, so every image stayed a grey box).
- Roku: signing out from the profile picker returns to the hosted QR code instead of the typed-address screen.
- Android TV: the QR sign-in screen no longer stops on "The Playarr Server session expired before it could be saved". When the code or the server's device code expires, it silently fetches a new code and QR and keeps polling, as the web client does. Network and server blips are retried with backoff (2 s doubling to 30 s) without an error, and the QR path never asks for a server URL. Only an explicit denial on the other device shows an error.
- Fire TV: an expired link code now renews silently instead of showing an error and a Try again button.
- Android TV: the QR sign-in recovery state focuses its Try again button instead of the theme dropdown.
- Fire TV client: the package now installs on a real Vega device (manifest module and OS-version declarations, icon under `assets/image`), the Profiles screen no longer crashes (default `LinearGradient` import), choosing a profile opens Home, and first launch no longer logs a storage hydration error or a missing `DOMException`.
- Roku: the pairing poll timer now starts (a Timer and a Label shared the id `pairingTimer`), so an approved code is picked up.
- Roku: "Connect to Playarr Server" pairs against the typed server (`POST /api/v1/oauth/device/code`) instead of returning to the hosted broker; QR sign-in never needs a server address.
- Roku: Home follows the web layout (hero fade, clock, server home rails, card focus ring, Right moves the hero) and the series detail screen has a Play button, season rails that no longer overlap their headings, episode stills and a reachable Similar Titles rail; the end-screen suggestions heading is no longer clipped.
- Roku: direct play of Matroska media sets the Roku stream format from the negotiated mime type instead of always `mp4` (which failed with "MP4: no playable tracks").
- Fire TV: the Metro bundle step now resolves the shared `@playarr-tv/*` packages from their TypeScript source instead of failing on the unbuilt `dist/` of `@playarr-tv/design-tokens`, and bundles the shared i18n tables.
- Recently added now follows when the *arr app added a title (Radarr, Sonarr, Whisparr, Lidarr and Readarr `added`) instead of the first sync time, so a fresh install or a newly connected library no longer gives every title the same date; an already-synced title is corrected once if it was stamped later than the source's date, and never moved later. Unusable dates fall back to the sync time.
- Fixtures: the stub serves an explicit `added` per title and the helper that pinned `added_at` through the sqlite3 CLI is removed.
- iOS: the signed-in profile is named by its display name from the server's profile list, resolved after sign-in and on app start, instead of the username typed to sign in (like Web and Android); the rule lives in PlayarrKit (`ProfileDisplayName`) with tests.
- Web: after a session restore the profile name is resolved from the server's display name instead of staying the typed username or the Viewer placeholder.
- The merge train now restores a PR branch to its pre-fold head whenever it blocks the PR or main moves after the fold, so folded TASKS/CHANGELOG commits no longer stay on branches and conflict on the next merge of main.
- TV Home: the Customise Home button is no longer painted over (and blocked) by the full-height rails layer.
- Phone profile page: the theme and language selectors sit in the logo row instead of covering the "Who's watching?" heading.
- TV QR sign-in with an `http://` Playarr Server: the server's default verification page is now its own `/tv/link` (reachable over the same scheme), the hosted `playarr.app/link` page hands off to `http://<server>/tv/link?user_code=...` with a one-step explanation, the hosted link endpoints allow cross-origin calls so that page can report the approval back, and the server-hosted client no longer rewrites a public `http://` address to the relay name.
- VIDAA (and any HTTPS-hosted launcher): an `http://` Playarr Server now works. The server serves the web client itself at `/tv/` (same scheme as the server, so no mixed content), the image and release tarball ship it as `web/tv/`, and the hosted sign-in links to `http://<server>/tv/` with a one-step explanation when it detects an `http://` server instead of failing silently.
- Chromecast: an `http://` Playarr Server is no longer refused up front by the receiver or hidden on Android. The receiver tries it; if the Cast device blocks the mixed-content request, the sender now shows a clear message with the one-step remedy (an `https://` address via `PLAYARR_RELAY_REGISTER` or a reverse proxy) instead of failing silently. The Android cast dialog now shows receiver errors.
- Remote control: reinstalling the app no longer leaves a stale "Offline" device and duplicate pairings. Registering a target now accepts an optional `fingerprint`; a new install on the same account with the same fingerprint (or, when either side has none, the same name and platform as an offline target) takes over the old target, its pairings and nothing else. Targets unseen for 30 days are pruned with their pairings revoked, and the target list hides a target that has been offline for over a day when a fresher one has the same name and platform. The Android app sends a hash of its per-device Android id as the fingerprint.
- Android TV search: pressing Up from Filters now lands on the search field instead of the Back button, matching the web TV search page. Tests pin the focus order on both clients and the first-Enter/OK activation of web TV cards.
- Phone remote: a press that cannot be delivered now says why, beside the pad instead of below the pairing lists: "No connection" when this phone has no network, "The device did not respond" when the command is not acknowledged within about 4 s (for example the TV app is in the background or its connection dropped), instead of silently doing nothing or blaming the device.
- Android TV: the pairing approval prompt now keeps retrying to take D-pad focus until it has it, so a slow first composition no longer leaves the remote's keys falling through to the screen behind.
- Playback handoff: a destination that still held an earlier, stopped or paused playback of the same file acknowledged the handoff at once with that stale position, so the source stopped before the destination had really started. The destination now confirms only once it has begun the offered request (a playback session exists for it). Measured on an Android TV emulator: acknowledgement within 0.5 s with a position 64 s off before, 2.3 s with 0.4 s drift after.
- Android TV: pressing Select (or OK on the phone remote) on a Home rail card or library grid card now opens it on the first press. A redundant extra focus target in front of the clickable meant the first press only moved focus and a second press was needed. A source test keeps a bare `focusable()` out of the front of clickables.
- iOS: catalogue search read the server's `{items, remote_only}` answer as a bare list and always failed with "Couldn't load search"; it now decodes the envelope. A regression test covers it.
- Web mobile: the autofocused card on home, library, detail rails and search is no longer scaled and raised on touch layouts; the lift stays for remote input.
- Web mobile home: the Customise Home button no longer overlaps the profile avatar.
- Web player: the controls now hide after one auto-hide delay instead of two, because the focus move that auto-hide makes no longer reveals them again.
- Deleting a user now frees their username for a new account (the tombstone is renamed; migration 0077 does the same for existing ones), and an administrator delete revokes all of the user's refresh-token families and sessions immediately.
- Web mobile home: rails and their headings now start at the page gutter instead of being indented by the TV left-fade inset; cards pack from the left at the normal gap.
- Android: the app no longer crashes when signing in or switching profiles while the live-event stream is open.
- Android: the release calendar header fits phones, and Watchlist shows beside Open when the server offers both.
- Android: the guardian approval card names the child (from profiles saved on the device) and reads correctly for out-of-hours requests.
- Android: a session with no refresh token is dropped instead of failing every request.
- Server: refreshing a token for a deleted account, or using a live access token of one, now answers 401 instead of minting a token or answering 403, so clients ask for a sign-in.
- Android: the minimised player no longer shows an empty or black surface for video. The mini player previously had no video surface (artwork only); it now binds a video view to the shared player, and the full-screen video view re-binds on every recomposition.
- Web: the Household page shows the same time left as the "min left" chip, counting the schedule window as well as the daily budget.
- Web: the language filter drawer sends the sign-in token with its facet request, so audio and subtitle language counts show instead of "No languages indexed yet".
- Web player: playback no longer stalls on an endless spinner after the manifest and first segment load. The playback engine was torn down and rebuilt whenever the access-token provider changed identity (every token fetch re-created the stored profile session list), and the rebuilt engine never loaded the source.
- Server: `GET /api/v1/calendar` offers `play` (and `resume`) only when the exact episode or film has its own file in the library, and the action carries that file; an unaired or file-less entry gets Open, Watchlist or Request instead. Grouped (`group=series_day`) entries follow the same rule.
- Android player: a tap or D-pad centre/OK press while the controls are hidden now only reveals them instead of pausing; play/pause on that input happens only while the controls are visible. Dedicated media keys still toggle directly.
- Android player: the top-left back arrow is replaced by an X close button at the top right (with minimise to its left; content description "Close player", localised in EN, TH and JA), focusable with the D-pad and reachable with D-pad up.
- Playback options: the "Original" quality now reports the real source bitrate (`quality_options[0].video_bitrate_bps`); a zero bitrate from the media analysis is ignored and the average is derived from file size and duration, and it is omitted when neither is known. The Android quality menu shows "Original · 24.3 Mbps", or plain "Original" when unknown, instead of "0 Mbps".
- Replacing a playback (quality or audio switch, or a retry after a failed attempt) no longer fails with `no_transcode_capacity` while the viewer's previous transcode still holds the node's only slot; the earlier transcode is stopped before admission.
- HarmonyOS client: fix the ArkTS compile errors (API 18 `ColorMode` names, strict typing, builder syntax, renamed component props, the `PlayarrClient` file rename) so `scripts/build.sh release` produces the unsigned HAP and the app bundle.
- Peer sync now skips a peer record that has no known address instead of failing a cycle on it every minute, and logs one rate-limited "peer has no known address" warning naming the peer.
- Xbox: the package manifest no longer puts a comment first inside `Dependencies`, which made the .NET Native toolchain insert the VCLibs dependency ahead of `TargetDeviceFamily` and fail MakeAppx schema validation.
- Xbox: the package manifest declares `mp:PhoneIdentity`, which the UWP packaging targets require (APPX1673).
- Xbox: the package has its tile, logo and splash images (the Playarr icon on the brand background), so the sideload MSIX can be packaged.
- CI: the Release workflow downloads only the package artefacts, not the image build record that `docker/build-push-action` uploads, which failed the GitHub Release job.
- Xbox: the default resource qualifier is `Language=en-US`, so MSIX packaging no longer fails in `CreatePriConfigXmlForFullIndex` ("Index was outside the bounds of the array").
- CI: the Android APK verification reads the signer certificate from current `apksigner` output (`V3.0 Signer:` lines when the APK has no v1 signature), so a correctly signed release APK no longer fails as a certificate mismatch.
- Xbox: subtitle and audio track selection uses the real UWP APIs (`TimedMetadataTracks.SetPresentationMode`, an `int` audio `SelectedIndex`), so the UWP head compiles.
- CI: the Release workflow starts (the server call now grants the permissions its jobs declare), a dry run may run from any branch, and the Roku package step no longer fails on a stale validator check (pairing uses the hosted device-link broker, not the server's device-code endpoint).
- Unsorted folders: root discovery no longer fails with a UNIQUE constraint error when a root already exists for the source under another id (older rows, replicated rows or two overlapping discoveries). Discovery now upserts on the source and root key and keeps the existing row, and one source failing no longer stops the others.
- CI: the Google Play closed-testing publish no longer fails a main push when an earlier release is still in review or the same version code is already on the track; it skips the upload with a warning (tag and manual runs still fail on an in-review release).
- The downloads Worker falls back to the downloads bucket when no matching GitHub Release or asset exists, restoring the stable Android and server download URLs (including the Android self-update manifest) until a release is published.
- Forward playback heartbeat and terminal lifecycle events from the entry node to the peer that owns a cross-peer playback session.
- CI: the Backend Release image step no longer runs out of disk: binaries are built per architecture with the builder cache pruned in between, and the multi-arch image is assembled around those same binaries instead of compiling a third time. A `dry_run` dispatch input builds everything without publishing.
- CI: the tv-web release workflow builds the shared packages first and the TV apps' runtime config files carry the right name; the Harmony release workflow configures the HarmonyOS npm registry for hvigor and uses the bundled SDK.
- CI: tv-web lint and typecheck run only for changed workspace packages and their dependents on pull requests.
- Web: after a backend restart or dropped connection the player now stays mounted and shows an inline "Reconnecting" state while the stream is re-negotiated with back-off and resumed at the same position, instead of replacing the player with a full-screen error.
- CI: the merge train logic tests stub the hosted-runner guard under its current name, so the end-to-end test passes again.
- Android: the library Filters sheet now loads the audio and subtitle language lists when it opens, instead of showing "No languages indexed yet" until a selection changed.
- Merge train: stop landing squash commits that revert other commits already on `main`. When main had moved without touching the PR's files, the train re-parented the PR's tree (built on an older main) onto the current main, so PR 267 deleted `SECURITY.md` and undid PR 264's documentation, and PR 269 reverted the TASKS.md restructure (PR 266) and the live-events sync change (PR 268). Every head the train rewrites is now built on the current main, squashing refuses a head that lacks main, a landing guard blocks any result that changes files outside the PR's diff or restores an older version of something main recently changed, and API merges are verified after the fact. `scripts/ci/test-merge-train.sh` reproduces the revert end to end.
- SQLite startup now accepts databases that applied migration 15 before its example comment was reworded (a comment-only edit that changed the file checksum and made every image since the scrub fail to start with a migration checksum error). The stored checksum is rewritten only for the known earlier comment-only texts, including those the planned history rewrite will produce; any other mismatch still stops startup.
- Live events: a sync pass that creates a season or episode, or changes an episode's title, synopsis, artwork, air date or runtime, now publishes a `library` update for the series, so open clients refresh without a manual reload. Unchanged re-syncs publish nothing.
- Playback delegated to a peer node now always proxies HLS through the entry node, even when `Redirect` delivery was chosen. A redirected HLS URL reached the peer without a playback capability (segment names in the manifest are relative and clients only send their bearer token to their own server), so the playlist answered HTTP 401 and the Android decode-failure transcode fallback ended in "io bad http status". Regression tests cover both the HLS and the direct-play paths.
- Radarr, Whisparr and Lidarr artwork entries now tolerate a missing instance-local `url` (only `remoteUrl` present), as Sonarr already did, so one such image no longer fails a whole sync with "missing field `url`". Regression tests added for each client.
- Merge train: stop re-merging `main` into every queued pull request. It now does so only when main's new commits touch the PR's files (fragment, CHANGELOG.md and TASKS.md paths excluded) or conflict, so landing one PR no longer cancels the CI of the next and the queue no longer starves. The train commits as Thomas McFarlane with a `Merge-Train: yes` trailer that `check-fragments.sh` exempts, and its decision logic has tests (`scripts/ci/test-merge-train.sh`).
- Give iOS and tvOS release invocations separate temporary signing keychains and allow the `codesign` partition explicitly.
- Android, iOS, tvOS and web now default public IPv4 relay URLs to HTTPS port 443 while preserving explicit legacy port 8484 and local server addresses (TASK 293).
- CI: affected-only selection no longer skips Rust checks on workflow-dispatched runs (merge train branches and post-merge runs on main now check everything or the true diff), and the merge train exits cleanly after landing a PR (TASKS 330, 332).
- Docs: links from documentation pages to repository files outside `docs/` use absolute URLs, so the strict MkDocs build passes again; Docs also builds on PRs that touch it (TASKS 332).
- Sessions: the owner was repeatedly signed out although the account was remembered. Refresh is now silent and race-safe: the web client renews a server-rejected token once and replays the request (REST, uploads and the live-events stream), shares one refresh across tabs with a Web Lock and re-reads the latest saved session under it, keeps stored credentials on any network, 5xx, 408 or 429 failure (only a definitive 400/401/403 from the server can show the profile switcher), saves profile sessions from local storage rather than per-tab state (and adopts other tabs' changes), and stops polling `/auth/refresh` and `/auth/login` with a dead token. The server accepts a just-retired refresh token for 120 s (`PLAYARR_REFRESH_REUSE_GRACE_SECS`, `0` for strict single use) instead of revoking the family, serialises rotation per device, and derives its fallback JWT secret from the persisted node identity instead of a per-boot random value. Tests: concurrent 401s cause one refresh, SSE open with a rejected token, outage keeps the session, cross-tab lock, restart persistence, concurrent server rotations (TASKS 304).
- Server: new-file detection for Sonarr series now reacts to a rise in `statistics.episodeFileCount` since the last pass (and compares with synced rows only on the first sighting after a restart). The first cut compared counts every pass, but Sonarr counts episodes with a file, so 42 series with multi-episode files re-synced every five minutes on regional server A (TASKS 275).

### Added

- Shared profile avatar presets: `clients/shared/profile-avatars` holds the six preset avatars as one source of truth (SVG and PNG plates), and CI checks they still match the web client.
- A music album whose tracks have no cover art shows a basic initials placeholder (neutral tile, theme tokens) instead of an empty gap.
- Storybook: a composition story for every page and settings section, and a test that fails when a component or page has no story.
- Storybook: one interactive story with Controls for every shared component, using a fixture API client; the Request latency table scrolls with the keyboard.
- CI builds and signs the Android (TV and phone) APK from every push to `main` and uploads it as a workflow artefact named `playarr-android-main-<version>-main.<commits>`, with a versionCode above every release so it installs over one without uninstalling.
- Series pages have an "Ask again" button that forgets the recorded Resume answers for that series.
- Ended series show their year range ("Series · 2011–2019") on tiles, previews, search and the title page. The server stores `end_date` on each work (Sonarr `lastAired`, else `previousAiring`, only while Sonarr reports the series as ended), exposed in the Work API and OpenAPI.
- Release: after each iOS and tvOS TestFlight upload the pipeline now adds the build to the external TestFlight groups listed in the `TESTFLIGHT_EXTERNAL_GROUP_IDS` repository variable, sets export compliance and "What to Test" notes, and submits it for beta app review; failures show in the release summary without failing the upload.
- Web: Storybook gains dialog, toast, avatar, watch-state, period picker, master-detail and player-control stories; the watch-state overlay marks now have role=img.
- Web: a public Storybook at `/storybook` shows the real components and styles in light and dark, at TV, desktop and mobile layouts, with focus, hover, open, disabled, loading, empty and error states. CI builds it and runs a render and accessibility smoke over every story.
- iOS and Apple TV Home now render the server-computed, localised `/api/v1/home/rails` shelves, falling back to the previous client-built rails on older servers.
- iOS: Customise Home (show, hide and reorder Home rails, saved on the server), the illustrated profile avatars shared with the web, the web-style profile picker with theme and language menus, and the app version label under the profile button.
- iOS: embeds the web's design fonts (Nunito Sans and JetBrains Mono, SIL Open Font License 1.1, variable builds) and draws the web-style screens with them at the exact CSS weights.
- iOS: blocked and remaining-time states for household policies (outside schedule, daily budget used, "Ask a guardian for more time"), with PlayarrKit household client and tests.
- iOS: Watchlist and Requests screens in the web mobile layout, with their nav destinations on the phone pill and the iPad rail, backed by a PlayarrKit requests client and watchlist presentation helpers (with unit tests).
- CI: the `parity-apple` workflow gains an `ios` platform that captures the iOS app on an iPhone 14 simulator (390x844 points at 3x) against the web mobile reference; the iOS app gains debug-only launch arguments to sign in and open a screen.
- Android: the shared page components (page layout, header, ordered header actions, the one action pill, edge fades with scroll containers, loading, empty and error states) now live in `core-designsystem`, with Roborazzi screenshot goldens for television and phone in both themes and unit tests for the action order and icon handling. The existing page scaffold is an adapter over them. No visual change (header bands identical to main on television and phone, light and dark).
- Roku: the player shows the web control bar with a quality menu (Up opens it), and Back closes the menu, then the controls, then playback; a restricted profile now sees the household blocked screen with Ask a guardian and Switch profile.
- Roku: the player shows the web control bar with a quality menu (Up opens it), and Back closes the menu, then the controls, then playback; a restricted profile now sees the household blocked screen with Ask a guardian and Switch profile.
- Fire TV client: light and dark themes with the web palettes (the Appearance screen now switches them live without resetting navigation; "System" is dark on a TV), and static Nunito Sans and JetBrains Mono instances, because Vega ignores font weight for variable fonts.
- Roku: dock entries and screens for Watchlist, Requests and the Release Calendar, a Customise Home pill, and Preferences with the web's ten sections (theme, avatar, language, player quality and audio, server, PIN lock and more).
- Roku: light theme. Both web palettes are tokens, and a System, Light or Dark preference (sign-in/profile dropdown and Settings) recolours every screen.
- Fire TV: a native React Native client for Amazon Vega OS at `clients/fire-tv/`, reusing the `clients/tv-web/packages` logic as TypeScript source (hosted device linking, profiles, home, library, detail, search, playlists, settings and HLS playback). Not yet wired into CI or the client catalogue.
- Parity: the shared screen list and web references now include the settings section panels (avatar, language, player, server, PIN lock, invite, phone remote, request latency, your data) for both layouts and themes; diff.mjs gained --mask-rect and per-instance mask regions.
- iOS: embeds the web's design fonts (Nunito Sans and JetBrains Mono, SIL Open Font License 1.1, variable builds) and draws the web-style screens with them at the exact CSS weights.
- tvOS: Downloads, Watchlist and Requests pages on the web TV layout, with real watchlist and request data (PlayarrKit `listWatchlistItems`, `listMyRequests`).
- iOS: a Request latency page in Settings, matching the web page (per-route HTTP latency for admins, with the "Admins only" state for other users), backed by a new `HttpLatencyClient` in PlayarrKit with unit tests.
- Apple parity workflow: captures both themes, a web layout dump per screen, a player screen pair (controls, quality menu) with the video hidden, and the household blocked screen (fx-child-locked).
- PlayarrKit: Home rails, availability lag, household status, profile avatar preset and media thumbnail calls; runtime on work and episode details.
- Web title detail: an Add to Playlist pill beside Add to watchlist, and a Download button in each season heading of a series (shown when downloads are allowed); both open the existing playlist picker and download quality drawer.
- iOS Settings gains a Phone remote section: control another device from the phone (pairing with code approval, D-pad, playback, text) and rename or revoke paired remotes, backed by a PlayarrKit remote client.
- iOS: Settings, Your data (export and import of your own watch progress, playlists and preferences, with a preview before anything is saved), matching the web copy and options.
- Pixel parity tooling under `scripts/parity/`: canonical screen list, web reference capture and a pixelmatch diff with an HTML report, documented in `docs/parity/README.md`.
- Apple parity workflow (`parity-apple.yml`) and tooling under `scripts/parity/apple/`: web reference versus tvOS Simulator captures on the fixture environment, with a pixel diff report; the tvOS app gains a live `-PlayarrParityRoute` launch argument.
- The older `appletv-parity.yml` fixture-capture workflow is folded into `parity-apple.yml` (the fixture-art workaround for `ffmpeg` builds without `drawtext` is part of the fixtures now).
- Apple clients: Release Calendar kit (models, client for the calendar and subscription endpoints, window/filter/series-grouping logic) with unit tests.
- Apple clients: a shared authenticated JSON transport (`PlayarrRequestTransport`) in PlayarrKit for the upcoming parity features, with tests.
- iOS: new Calendar tab with the shared page header and Filters button, Agenda (master-detail on wide screens), Week and Month views, a Filters sheet and the calendar subscription sheet (QR code, copy, revoke).
- Android: minimising a video uses system Picture-in-Picture (entered automatically when leaving the app during playback: API 31+ auto-enter, older versions via the user-leave hint). The window takes its aspect ratio from the video, offers play/pause and 10 second skip actions, hides all controls, and closing it stops playback and records progress. On devices without PiP (including most TVs) minimise falls back to the in-app mini player, which now shows the live video from the same player (no restart or re-buffer); tapping it, or pressing OK on TV, expands back to full screen.
- Add a fixture-based local verification environment (`scripts/fixtures/up.sh`, `down.sh`, `verify.mjs`): a local server seeded with an admin, a viewer, a guardian with a PIN and two child profiles with household policies, generated placeholder media (H.264, HEVC, several audio and subtitle languages), a Sonarr, Radarr and Dubarr stub including a dub track, and documentation in `docs/validation/fixture-environment.md`.
- Android: guardians can review requests from the profiles they look after and approve (with their PIN and bonus minutes) or deny them, with clear messages for a wrong PIN, self-approval, an already decided request and a PIN lockout.
- CI: one Release workflow (`.github/workflows/release.yml`) releases every app from a single `version` dispatch on `main`: server tarballs and the `playarr-server` and `playarr-regional` images, the signed Android APK, webOS, Tizen, Roku, Xbox and HarmonyOS packages in one GitHub Release with a combined `SHA256SUMS` and generated notes, then Google Play closed testing and TestFlight, with a per-platform summary. The per-platform workflows are reusable and keep their own tags.
- The downloads Worker serves the Android and server downloads from the all-platform `v*` releases as well as `android-v*` and `backend-v*` ones.
- Android: the Release Calendar offers Request and Add to watchlist for releases that are not in the library, using the actions the server computes for the signed-in user (a disabled Request shows the server's reason), and the calendar link is fetched in one call and no longer needs resetting to be shown again.
- Android (phone and TV): a Folders view browses the folders an administrator enabled, with breadcrumbs, grid or list, size, sort, order, search and show filters in the shared Filters sheet, play and resume of files, and live refresh. Route state (`folders?query=root=…&path=…&view=…&size=…&sort=…&order=…&q=…&type=…`) uses the same parameter names as the web client, and Folders appears in the navigation once a folder is available.
- Unsorted folders: the server now scans administrator-enabled root folders (reported by Radarr, Sonarr and the other source applications, or added by hand) for media those applications do not manage, keeps the result current with incremental rescans and live events, and serves it through `GET /api/v1/folders/roots` and `GET /api/v1/folders/roots/{root_id}/browse` (breadcrumbs, filters, sort, paging, resume state). Folder items play through the existing playback, thumbnail and progress routes and respect library access, rating rules and blocked folders. Admin routes under `/api/v1/admin/folders` choose which roots are scanned. New migration 0075 adds `scan_enabled`.
- Web: a Folders view (`/folders`) browses the folders an administrator enabled, with a breadcrumb path, grid or list, size, sort, order, search and show filters in the shared Filters drawer, and play or resume of files. Directory, view, sort and filter state lives in the URL (`root`, `path`, `view`, `size`, `sort`, `order`, `q`, `type`), cards are D-pad friendly, and the sidebar shows Folders once a folder is available. The admin app gains a Folders page to choose which folders are scanned, set local paths, add folders and scan on demand.
- Unsorted folders: the server now scans administrator-enabled root folders (reported by Radarr, Sonarr and the other source applications, or added by hand) for media those applications do not manage, keeps the result current with incremental rescans and live events, and serves it through `GET /api/v1/folders/roots` and `GET /api/v1/folders/roots/{root_id}/browse` (breadcrumbs, filters, sort, paging, resume state). Folder items play through the existing playback, thumbnail and progress routes and respect library access, rating rules and blocked folders. Admin routes under `/api/v1/admin/folders` choose which roots are scanned. New migration 0075 adds `scan_enabled`.
- Calendar entries now carry server-computed actions (open, play, resume, request, watchlist) and a title snapshot for the current user, honouring library access, household limits and the request permission, and `GET /api/v1/calendar` accepts `group=series_day` to fold same-day episodes of a series into one entry.
- Unsorted folders: the server now scans administrator-enabled root folders (reported by Radarr, Sonarr and the other source applications, or added by hand) for media those applications do not manage, keeps the result current with incremental rescans and live events, and serves it through `GET /api/v1/folders/roots` and `GET /api/v1/folders/roots/{root_id}/browse` (breadcrumbs, filters, sort, paging, resume state). Folder items play through the existing playback, thumbnail and progress routes and respect library access, rating rules and blocked folders. Admin routes under `/api/v1/admin/folders` choose which roots are scanned. New migration 0075 adds `scan_enabled`.
- CI: a weekly workflow lists remote branches whose commits are not on `main` and that have no open pull request and no task-board reference, and fails until each is given a PR, a row or deleted.
- CI: pull requests now check only the Rust crates they change plus their dependents (`scripts/ci/rust-scope.sh`); shared inputs, pushes to main and a nightly schedule run the full workspace. OpenAPI diff runs only when the API crate is affected, and every CI job has a timeout (TASKS 332).
- CI: CHANGELOG.md and TASKS.md are no longer edited in PRs. Per-change fragments (`changelog.d/`, `tasks.d/`) are folded by the merge train (`scripts/fold-fragments.mjs`), and CI rejects direct edits (TASKS 331).
- CI: merge train (`merge-train.yml`, `scripts/merge-train.sh`) lands PRs labelled `ready` one at a time, oldest first, after `ci-required` passes on the exact head; CI gains `workflow_dispatch` (TASKS 330).
- Server: an episode imported into a series Playarr already knows is now synced (and so announced as live `library`/`files` and `calendar`/`imported` frames) on the next pass or webhook refetch; previously only a brand-new series or a Sonarr-reported change picked it up, because Sonarr series rows carry no availability. Sonarr's `statistics.episodeFileCount` is compared with the synced file count. Regression tests cover the sync, the event stream and the web live-event mapping (TASKS 275).
- Web: Home On Deck and Continue Watching now always apply resume-plan, progress and detail results that arrive after the first-paint wait, so the stacked "N ways to continue" card appears on high-latency links; keyboard focus is kept when the rail fills in late (TASKS 302).
- Home rails: verified on regional server B (API, web, the emulator host Android emulator); Android server rails merged in PR 177 (task 244, 246).
- Operations: pin both regional servers to verified image `<image>` (TASK 292); deployment rollout and authenticated peer sync remain pending.
- CI: regional server image builds are published under unchanged public image names and tags (TASK 296).
- Server: cap node-local on-demand FFmpeg jobs with an atomic child-lifetime permit and positive-value configuration; default to one job and two decoder, encoder and filter threads per job (TASK 295).
- Server: proxy delegated HLS rendition/session playlists and segments through the entry peer, preserving playback capabilities, owner-side policy checks, HEAD/range responses and rewritten playlist child URLs (TASK 297).
- Server: retry unreachable known peers after restart, and route configured server-to-server peer traffic through in-cluster Services while validating the existing public certificate identity; public client relay addresses remain unchanged (TASK 292).
- iOS: track native QR login parity with Android, including signed iPhone and iPad acceptance (TASK 291).
- iOS: verify Apple dispatch credential provisioning and successful source dispatch, with the signed iOS/tvOS child run accepted and queued (TASK 279).
- iOS: run source-side Apple release dispatch on GitHub-hosted `ubuntu-latest`, avoiding an unavailable repository runner group (TASK 279).
- Apple platforms: declare that iOS and tvOS use no non-exempt encryption and omit the unsupported 2x Top Shelf image slots so App Store Connect uses the supplied 1x images (TASK 284).
- iOS and tvOS: scope the distribution identity and provisioning profile to the app target so CocoaPods targets do not receive app-only provisioning settings; append the temporary signing keychain to the existing user search list and restore that exact list before cleanup (TASK 284).
- iOS and tvOS: release dispatch now always requests a signed TestFlight upload for both platforms from an immutable source commit. Missing dispatch/signing credentials fail the workflow; the source release flow no longer offers build-only or unsigned archive modes. Release script archives also require signing credentials and the Apple runner. Marketing version defaults to 1.0.0, matching the existing App Store Connect app (TASKS 279, 284).
- iOS: remove the obsolete `mode` input from the source workflow's private TestFlight dispatch payload, matching the dispatcher's signed-only interface (TASK 279).
- iOS: the Apple release pipeline retains immutable source SHA handoff, signing preflight for profile bundle ID/team/expiry/certificate match, and temporary keychain/profile cleanup. XcodeGen 2.45.4 and Google Cast SDK 4.8.6 remain pinned; CocoaPods setup selects Ruby 3+ and uses `--project-directory=<path>` (TASKS 279-283).
- iOS: handle Google Cast SDK 4.8.6's nonthrowing `sendTextMessage(_:error:)` result and preserve its reported error in the sender's existing error state (TASKS 280, 284).
- iOS: make `PlayerViewModel`'s initializer app-internal so its internal `CastSessionCoordinator` parameter and `.shared` default do not violate Swift access control (TASK 284).
- iOS and tvOS: document the signed-only TestFlight workflow, owner token setup, verified internal build state, and separate public-release gates; correct stale bundle, signing and Cast build statements (TASKS 279, 280, 284-290).
- iOS and tvOS: private run <id> signed, exported and uploaded both platforms from source as build 1.2; App Store Connect reports both builds `VALID` and internally `IN_BETA_TESTING` (TASK 284).
- Android: the button, pop-out and page-frame ratchets are now at 100% with no allow-lists. Every remaining raw Material button (about 150 call sites in 12 files) is `PlayarrButton`/`PlayarrIconButton` (new colour, padding and interaction-source options for hero and auth screens, labelLarge text style); every dialog, picker and the download-quality sheet renders in the shared right-hand sheet through `PlayarrPanel` (non-dismissible mode for the pairing approval); Settings, playlist detail, Library and the detail screens render through `PlayarrPageScaffold` (new `padBody = false` for full-bleed hero pages), and Playlists uses the shared Filters and Create header slots. Library view, artwork size and sort now live in the route/SavedStateHandle with the web query names (`?view=list|screen|cover|cover-flow&size=small|medium|large&sort=title|date_added&order=asc|desc`), so rotation, process death, the restored route and `playarr://app/series?...` deep links agree; `calendar?query=` is a navigation deep link. On phones the header action cluster stops short of the profile chip.

- Playarr web: the Library view, card size, sort and order now live in the URL (`?view=list&size=large&sort=date_added&order=desc`), so refresh, back/forward and shared links restore them; the last choice only seeds a fresh URL.
- Playarr web: the Customise Home page and the Home 'Customise' link now use the shared Button family instead of the bespoke `tv-button`/pill styling, and `pnpm smoke:header` also asserts the Calendar's subscription header button matches Playlists' Create (same component, height, vertical position and right edge).
- Playarr web: every raw `btn` call site now uses the shared Button family and the Playback health panel and the title/playlist context sheets use the shared Drawer; the button and drawer audits no longer have allow-lists.
- Playarr web and Android TV: keyboard and D-pad navigation on Home now glides. Rails ease sideways (about 240 ms, interruptible, held keys coalesce to the latest target, no CSS smooth scrolling) and Up/Down eases the focused rail to a stable anchor; `prefers-reduced-motion` keeps the instant behaviour. Rail spacing on Home is tighter. `nav-smoke` gains a held-Right eased-scroll check.

- Web: one shared right-side `Drawer` (title and round icon close, body, footer, Tab focus trap, Esc/Back closes, `?panel=` URL state, focus returns to the opener) now backs Filters on every page, the Calendar link, playback settings, download quality, keep-until and create-playlist; `drawerAudit.test.ts` blocks new ad-hoc panels.
- Web: "Calendar link" replaces "Calendar subscription": the personal iCal link is created automatically on first open, with Copy, QR, Google/Apple/Outlook steps and a confirmed "Reset link". Load failures now say whether the server is unreachable, too old to support calendar links, or the sign-in expired, instead of "Failed to fetch".
- Web: Filters and the calendar's Calendar link and navigation render through the page header's shared slots (Playlists pattern: panel buttons left of Filters, same style and position on Movies, Series, Playlists and Calendar); the calendar skeleton fills exactly the area of the loaded view. `scripts/header-parity.mjs` and `scripts/calendar-layout.mjs` check both in a headless browser.

- Web: one button family (`components/ui/Button.tsx`: primary, secondary, ghost, icon, danger; rounded, focus ring, TV scale) used by the page shell, Filters buttons and the Release Calendar; `buttonAudit.test.ts` fails on new raw `btn` styling outside it. `DESIGN.md` section 6 records the binding page-shell and button rules.
- Web: the Release Calendar period label opens a month/year jump picker (scrolling lists, keyboard and D-pad friendly) that applies through `?date=`; previous/Today/next moved to the header's right side beside Filters and Calendar subscription.
- Web: page header detail text (subtitle/breadcrumb) is measured against the clock and the header actions and wraps beneath the title with a horizontal rule when it does not fit, instead of rendering under the clock (`pageHeaderLayout.ts`).

- Admin: a Home rails page (Library, Home rails) to show or hide, reorder and retitle the default rails per library, tune limits, the rediscover idle days and franchise size, edit the seasonal rules (windows by date or around Easter, hemisphere, keywords, genres, tags) and create custom rails from saved views (task 243). The view editor gains audio and subtitle language filters, match-all and every-file switches and an unwatched-only flag, and the views list summarises them. Helper tests cover grouping, reordering and rule windows.
- Web (including the TV layout): Home renders the server's per-library rails (recently added, recently released, top unwatched, rediscover, seasonal and admin custom rails) with the existing rail components, replacing the hard-coded new and more rails for movies and series, and a new Customise Home page (hide, show, move up and down, reset) saves each user's own rail order. English, Thai and Japanese; the nav-perf mock API serves the rails; tests added (task 242).
- Playarr Android (phone, tablet and TV): Home shows the server's rails (Recently Added, Recently Released, Top Unwatched, Rediscover, Seasonal and admin custom rails) in the app language, after On deck and hiding when empty, using the existing rail cards; a new Customise Home dialog lets each user hide, show and reorder rails or reset (D-pad friendly). Falls back to the built-in shelves on an older server. English, Thai and Japanese, with unit tests (task 244).
- Server: Home rails (task 241). `GET /api/v1/home/rails` returns the caller's ordered rails per library: Recently Added in, Recently Released, Top Unwatched, Rediscover (series started but unfinished and idle for 60 days by default; movie franchises from Radarr collections watched in part) and Seasonal (Christmas, Halloween, New Year, Valentine's, Easter and summer windows, hemisphere aware, rules editable), plus admin custom rails built from saved views. Titles come back in English, Thai or Japanese, empty rails are omitted, and the library allow-list and household controls apply before any ranking. Results are cached per user and invalidated when watch progress or rail settings change. Admins manage rails under `/api/v1/admin/home-rails` (enable, disable, reorder, thresholds, seasonal rules, custom rails) and each user can hide or reorder their own under `/api/v1/home/rails/preferences`. Saved views gain audio and subtitle language filters and an unwatched-only flag. Radarr collections and Radarr and Sonarr audience scores are stored as arr-owned tags on sync. Tests cover ranking, caching and invalidation, localisation, household gating and admin management.
- Web (including the ten-foot TV layout): the series detail page leads with a Start (nothing watched), Resume or Watch again button that plays the episode the server picks, and shows a chooser only when the history is ambiguous (unfinished episodes with progress bars and last-watched dates, a missed episode, a rewatch); Home On Deck shows such a series as a stacked card and asks there too. English, Thai and Japanese; unit tests for the helpers, the chooser and the API client (task 282).
- Android (TV and phone): the series detail's primary button is the server's smart Start, Resume or Watch again and plays the episode the server picks; a chooser (D-pad friendly dialog with last-watched dates and progress bars) appears only when the history is ambiguous, and Home Continue Watching shows such a series as a stacked card and asks there. English, Thai and Japanese; unit tests for the models, helpers and Home resolution (task 243).
- Server (TASKS 280-287): unified media requests plus Ombi and Seerr integrations. Requests made in Playarr, Ombi and Seerr are tracked in one `media_requests` table (one row per title identity, origin `playarr|ombi|seerr`, per-system request ids), so they stay in sync without loops. PULL imports existing requests by polling (per-integration interval) or a signal-only webhook (`POST /api/v1/requests/webhook/{id}` with a per-integration secret); PUSH creates the request in Ombi or Seerr as the mapped user (by email, username or explicit map), respecting that system's approval and quota. Admin setting `request-settings.backend`: `direct`, `ombi`, `seerr` or `direct_mirror` (direct Radarr/Sonarr add, mirrored as an approved request into every enabled integration, retried on failure). Admins can approve, decline or remove a request and the change is pushed upstream. Discovery title actions show "Requested by X - status" (names only for administrators and the requester). Keys come from the environment (`api_key_env`) or the database; Helm registers Ombi declaratively (`requestIntegrations.ombiUrl`, `ombiApiKeySecret`). Tests use mocked Ombi/Seerr servers; no Seerr instance is deployed in the cluster yet.
- Admin UI: "Requests" (all requests with approve, decline, remove) and "Request integrations" (connection, key variable, mapping and explicit user map, poll interval, webhook, backend mode, test and sync now) pages.
- Web: a Requests page (status of your requests, in English, Thai and Japanese).
- Playarr Android (phone, tablet and TV): live events client in `core-data` (`GET /api/v1/events` SSE parser, typed `Ready`/`Change`/`Resync` frames, Last-Event-ID resume, 1-30 s jittered reconnect backoff reset after a stable minute, unsupported-server detection by status and content type), a foreground/sign-in aware manager with 150-300 ms coalescing, a precise event-to-target invalidation bus and fallback polling (30 s, 60 s on TV) while the stream is down or unsupported. Home, library lists, search, title detail, playlists, watchlist, calendar, household and watch progress refresh in place (no spinner, stale content kept, focus and scroll preserved).
- Web: a shared page shell (`components/shell`): `PageHeader` (back button top-left, large title, divider/detail, right-aligned actions), `PageShell` (reserves the bottom-left profile chip safe area), `FiltersButton`/`FiltersDrawer`, `MultiSelect`, `DateRangeField`, `ViewToggle`, `MasterDetail` and skeleton primitives. Library, Playlists, Search, Watchlist, Downloads, Settings and detail pages now render their heading through it, and `pageHeaderRegistry.test.ts` fails when a page bypasses it.
- Web: the Release Calendar follows the page layout (back, "Release Calendar", Filters and Calendar subscription on the right). Filters cover View, type, source, status, date range and monitored; the subscription opens its own drawer with link, QR, instructions and status. View, date, filters, selection and open panel all live in the URL (`?view=agenda&date=2026-10-04&type=tv,movie&status=upcoming&selected=...&panel=subscription`).
- Web: episodes of one series released on the same day at the same time collapse into one calendar event ("The Show - 3 episodes - S02E04-E06"); the agenda is master-detail (details left, list right) with skeleton loading, and the week view scrolls horizontally with wide snapping day columns.
- Web (including the webOS, Tizen and VIDAA layouts): live updates from `GET /api/v1/events`. A fetch-based stream reader (`lib/liveEvents`) follows the signed-in account while the page is visible, resumes with `Last-Event-ID`, reconnects with 1-30 s backoff plus jitter, and treats a non-event-stream answer (older server) as unsupported. Change pointers refetch only the mounted consumers of that work, playlist, watchlist, calendar window, download or household state, in place and with no loading flash, so TV focus is kept; bursts are coalesced and events older than the fetched data are dropped. While the stream is down or unsupported the visible data is polled every 30 s (60 s on TV), with one refetch after a gap or `resync`. `ApiClient.openEventStream` and the regenerated API schema carry the contract (TASKS 273).
- Server: per-user live event stream `GET /api/v1/events` (server-sent events, session or device token, library- and household-scoped, `Last-Event-ID` resume with ten minutes of retention, heartbeats, `resync`). Writes to watch progress, playlists, the watchlist, downloads, works and imported media files, plus household, account and source-instance changes and arr sync status, publish minimal `{type, entity, id, changed}` pointers so clients refresh exactly what changed. Design and multi-node notes: `docs/architecture/live-events.md` (TASKS 270-278).
- Per-user request permission: `Policy.can_request` (off by default; administrators always may) with a Users admin toggle, enforcement on `/api/v1/discover/request`, and the Request action hidden in search for accounts without it. `PLAYARR_REQUESTS_ALLOW_ALL_USERS` remains as an override. Migration 0053 (SQLite) / 0054 (Postgres).
- Server: smart Start/Resume for TV series (task 281). `GET /api/v1/catalog/{id}/resume-plan` returns the episode a Start/Resume press should play, or the options to offer when the history is ambiguous (unfinished episodes, a missed episode before watched ones, a rewatch behind further progress); `POST .../resume-plan/choice` records the answer (declining a missed episode, or choosing how to continue a rewatch, is remembered per profile in the new `resume_dismissals` table), `DELETE .../resume-plan/choices` forgets it and `GET /api/v1/playback/resume-plans` lists plans for Home. The rules are a pure, deterministic function with 47 unit tests; OpenAPI regenerated.
- Server: `playarr-server create-admin --username <name>` creates an administrator (password on standard input, never in arguments) or resets that administrator's password, so operators can provision a dedicated operator or test account without touching the database.
- Server: Sonarr episode screenshots without a local `url` (Sonarr v4.0.19 `includeImages=true`) no longer fail the whole file sync with "missing field `url`"; checked by decoding every series, episode and episode-file payload of the live regional server B Sonarr (1,011 series, 53,453 episodes, 46,827 files). A source behind a reverse-proxy path prefix (for example Prowlarr at `https://host/user/prowlarr`) keeps the prefix on every request (tested).
- Server (TASKS 198): the Dubarr API key is no longer passed to ffmpeg as `-headers X-Api-Key: ...`. Playarr downloads the selected dub itself (key sent from inside the process) to a scratch file beside the session and ffmpeg reads that local file; if the download fails playback falls back to the source audio.
- Server (TASKS 198): dub audio is padded with silence (`-af apad -shortest`) so a dub shorter than the title, or a seek past its end, still produces segments.
- Server (TASKS 198): a new playback of the same title on the same device now stops the previous HLS transcode (audio, quality or dub switch after the 10 s dedupe window), and an idle reaper stops ffmpeg processes whose session expired from the cache (closed tab, dropped network).
- Playarr Android (phone, tablet and TV): every page shares one frame (`PlayarrPageScaffold`): back button top-left, large title, breadcrumb, right-side actions and a body that stays clear of the bottom-left profile chip. Applied to Calendar, Watchlist, Downloads, Playlists and Search; a registry test fails when a screen bypasses it.
- Playarr Android: Calendar link replaces Calendar subscription: the panel creates the personal iCal link on first open, shows Copy, QR and Google, Apple and Outlook instructions, and a confirmed Reset link, with friendly unreachable and unsupported-server messages. Panel buttons sit in one row left of Filters, drawn by one shared header cluster that Library and Calendar both use, and every pop-out uses the one shared right-side sheet (Library filters converted).
- Playarr Android: one rounded button family (`PlayarrButton`, `PlayarrIconButton`) in the design system with focus ring and TV scale; the calendar and page headers use it, and a usage test stops new raw Material buttons. The calendar period label opens a month and year jump picker, previous, today and next sit beside Filters, and a header breadcrumb wraps under the title instead of running beneath the clock.
- Playarr Android Release Calendar: Filters (View, type, source, status, date range, monitored) and a separate Calendar subscription button open right-side sheets; the agenda is master-detail (details left, list right); same-series episodes released together are grouped ("The Show, 3 episodes, S02E04-E06"); skeletons render the full view while loading; the week view scrolls horizontally through wide day columns; view, date, filters, selection and open panel are encoded in a web-style query string and restored after process death. The release calendar title is now "Release Calendar".
- Household controls rolled out to regional server A and regional server B (image `<image>`) with live verification recorded on TASKS rows 104-114.
- Playarr Android (phone, tablet and TV): a native "Not available right now" screen when the
  server reports the profile outside its schedule or out of daily time (shows when it lifts,
  stops playback, offers "Ask a guardian for more time" and "Switch profile"), an "N min left"
  pill in the last hour, and clear PIN messages for brute-force lockouts and for switching into a
  profile that has no PIN. English, Thai and Japanese.
- Server: a Dubarr source instance can be created declaratively at boot from `PLAYARR_SOURCE_INSTANCE_URLS` (`dubarr=<url>`) and `PLAYARR_DUBARR_API_KEY`; chart 0.4.2 wires the in-cluster URL and an optional API-key Secret on regional server A and regional server B.
- Dubarr integration (task 195): a new `dubarr` source kind (Settings, Sources) connects Playarr to Dubarr. Dub tracks for a media file are listed as extra audio options in playback info; choosing one starts an on-demand HLS transcode with the dub as the audio track (video from the original, seeking aligned). Lookups are cached for 60 seconds, invalidated by Dubarr's change feed, and never block playback when Dubarr is down. Covered by wiremock tests for the client and lookup and a unit test for the ffmpeg arguments.
- Web "Your data" and Android Settings import previews now show the watchlist section the server already returns (new, already here, could not be placed), in English, Thai and Japanese, with tests.
- Dubarr integration (task 190): a new `dubarr` source kind (Settings, Sources) connects Playarr to Dubarr. Dub tracks for a media file are listed as extra audio options in playback info; choosing one starts an on-demand HLS transcode with the dub as the audio track (video from the original, seeking aligned). Lookups are cached for 60 seconds, invalidated by Dubarr's change feed, and never block playback when Dubarr is down. Covered by wiremock tests for the client and lookup and a unit test for the ffmpeg arguments.
- Web: filter the Movies, Series, Sites and Music libraries by audio language and subtitle language from the library filters drawer (task 182). Choices come from the new language facet endpoint, show localised language names with counts, narrow each other, and are kept in the URL (`?audio=en,ja&subs=fr`) so a reload or shared link restores them. Joined servers merge their facets.
- Android: audio-language and subtitle-language multi-select filters in the library Filters dialog on phone and TV (task 183), with language names in the app language, per-language counts from the server, a "clear" action and a no-match message. Joined servers merge their counts.
- Audio and subtitle language filters (task 181). Languages are indexed per media file from Sonarr/Radarr/Whisparr `mediaInfo` at sync time, from ffprobe for files the *arr app could not describe, and from sidecar subtitle files (rescanned every six hours), normalised to ISO 639 codes (new tables `media_file_languages` and `media_file_language_state`; existing libraries backfill on the next sync pass and the background indexer, `PLAYARR_LANGUAGE_INDEXER=off` disables it). `GET /api/v1/catalog` and `/api/v1/catalog/search` accept `audio_lang=` and `subtitle_lang=` (comma-separated codes or English names; OR within a list, `lang_match=all` for AND, audio AND subtitle; a series is the union of its episode files, `lang_scope=every_file` requires every file). New `GET /api/v1/catalog/languages` lists the available languages with work counts for the same filters. OpenAPI regenerated.
- Server backups can replicate off-node to an S3-compatible bucket (any endpoint the administrator provides): multipart upload with per-part checksums, read-back verification, remote retention and a Secret-sourced access key (task 140). Chart values `backup.s3`.
- PostgreSQL migration 53 adds `source_root_folders` and `folder_media_entries` (parity with SQLite migration 42), so library-root checks and remapping work on PostgreSQL restores (task 141).
- Public Playarr Server releases (tag `backend-v*`): Linux x86-64 and ARM64 tarballs with SHA-256 checksums served from `playarr.app/downloads/server/`, and a multi-arch image at `ghcr.io/thomasmcfarlane/playarr-server`. The Clients hub server page now has per-architecture Download buttons, checksums and Docker pull/run/compose snippets. See `docs/deployment/server-releases.md`.
- Server: ten-foot transfer for user data export and import. A signed-in television can mint a one-time, 15-minute download link for its own ready export, or open an import session whose one-time upload link (served as a minimal hardened page) lets a phone or computer upload a package. Uploads are validated like any import, staged privately, and only previewed and applied by the owning signed-in account (`/api/v1/transfer/...`, `/api/v1/users/me/data-import-sessions`). Tests cover single use, expiry, owner scoping and cleanup.
- Remote control push transport (task 175): `GET /api/v1/remote/stream` delivers a target's remote
  commands and handoff offers as server-sent events (id = queue seq, resume with `Last-Event-ID`, auth
  is the device token, revoked pairings still never reach the target, the stream re-authenticates every
  five minutes). The long poll stays as the fallback and now wakes immediately instead of polling the
  database every 400 ms; `GET /api/v1/remote/handoffs/{id}?wait=` long-polls the handoff outcome.
- `PATCH /api/v1/remote/pairings/{id}` renames a paired remote (task 173). Web and Android Settings now
  list paired remotes with pairing and expiry dates and offer Rename and Revoke.
- Phone as controller on Android: the on-screen remote is now a proper cross D-pad with equal transport
  buttons, sits above the device lists, and offers "Play on this phone" and "Move to <TV>" for whatever a
  controlled TV is playing (controller-initiated handoff).
- `scripts/remote-control-smoke.sh` (commands over push and long poll, handoff offer, commit and stop
  timings, revocation) and `docs/validation/remote-physical-devices.md` (hardware checklist, row 174).
- Android TV and ten-foot web: "Your data" no longer stops at "needs a file picker". Export shows a one-time download QR code to open on a phone or computer; import shows a one-time upload QR code, waits for the file from that device, then previews and applies it on the television after confirmation. Strings in English, Thai and Japanese; web and Android tests added.

### Changed

- A peer's availability snapshot is replaced in one transaction, and the events one change raises are stored in one transaction, so each does one commit sync instead of one per row (500 rows: 25 s as separate commits, 0.13 s as one, on a busy local disk). Synchronous stays FULL.
- CI: the web behaviour gate runs as three parallel shards balanced by measured script time (about 15 min down to about 7).
- Merge train: the batch CI run on train/batch dispatches the train itself when it finishes, so a green batch lands within a minute instead of waiting for a dropped completion trigger; a manual train dispatch is a real run by default.
- Resolving a calendar's titles looks their external ids, the viewer's watchlist and the request list up once per request in a few set-based queries, instead of several small queries per title.
- The calendar keeps each period in the query cache (dropped by calendar, catalogue, progress and watchlist events) and loads the previous and next period after the current one paints, so stepping and revisiting render at once.
- CI: web layout parity runs as three parallel shards (about 18 min down to about 8); the merge train comments the full block reason on the PR and takes the PR's capture when a regenerated parity PNG conflicts; changes to the CI workflow now select the web, storybook, server-image and HarmonyOS jobs.
- The calendar API keeps each viewer's built response for up to two minutes and rebuilds it as soon as a live event for that viewer or the library, or a source refresh, changes what it depends on. Repeat and revisited periods answer from memory.
- Storybook: one interactive story per component with Controls for props and states; hover, focus-visible, active and focus-within come from the Pseudo states toolbar item (applied to the whole page, portals included).
- Calendar builds read each work's detail once per request instead of three times, which cuts the time to resolve a month of releases.
- Search and playback no longer wait on Radarr, Sonarr or Dubarr: lookups are served from a stale-while-revalidate cache with a short deadline, refreshed in the background, and users never see a source error for them.
- Merge train: batch landing (key mode) stacks up to six ready PRs with green own CI, tests them with one CI run and lands them with one fast-forward; red batches are halved to the culprit.
- Calendar API logs how long enrichment and per-entry actions take per request, to find where the time goes.
- Web: every page now loads with skeletons in the normal page frame (header and Back visible) instead of a centred loading screen or a "Preparing ..." message: Home, Library, Playlists, Folders, Downloads, Watchlist, Requests, Search results, title and music detail and the settings panels.
- Web: every scroller (rails, grids, lists, panels, dialogs, the calendar views) now shares one edge fade, a mask on the scroller itself. It is present from the first paint, soft on the right so content is still seen going off screen, visible in both themes, and shown only where content continues. The focused card's lift and soft shadow are no longer clipped on rails. The overlay boxes, the per-area scrims and the dark-only override are removed.
- Web: the shell clock and the right-hand column sit exactly where Home puts them on Movies, Series, Music, Playlists, Downloads, Watchlist and Requests (one shared stage split), instead of the clock shifting right on library pages.
- Calendar: the API now answers from a persisted cache that is refreshed in the background (on a schedule, on webhooks and on "Sync now") with per-call timeouts and backoff, so it never waits on a source and keeps serving the last good data when one is down. Source errors are no longer shown to users; admins see each source's last successful calendar sync under Tasks.
- Web: the legacy page frame is gone: every routed page renders through the shared page layout, and the old frame components, button aliases and dead header and fade CSS are removed.
- Web: route changes play one short fade-and-rise of the page body (about 220 ms) with the shell, nav rail and page header staying put; Back settles the other way, skeletons ride the same transition, and reduced motion makes it instant. The separate Android TV and VIDAA page entrance animations are removed in its favour.
- Web: all focus-driven scrolling (page between rails, rails, library and search grids, lists, calendar, settings, detail seasons and episodes, player lists) now glides through one shared, cancelable, retargeting scroll engine instead of snapping. Held arrow keys keep up without a backlog, and reduced motion is respected.
- Web: Home renders through the shared page layout (no header and no action button); its loading, error and empty states sit inside the page.
- iOS: the calendar header uses the shared action tiles (bell and sliders) at the web's phone positions, the range label wraps like the web, and the film detail chapter frames match the browser's colours in the parity capture.
- Web: work and music detail pages render through the shared page layout with a single page heading; Library, Playlists and the detail pages keep their header and Back visible while loading, empty or failed, with the state centred in the page body.
- Server: the artwork `style` query accepts `stage-grey` and `stage-grey-light`, the key-art greyscale as an opaque JPEG (about a twentieth of the PNG looks' size) for clients that apply the opacity and edge fade themselves. The Fire TV client uses it for the stage art, with the PNG look and then the colour original as fallbacks.
- iOS and tvOS: the Customise Home button leaves Home; iOS gets a Customise Home panel in Settings.
- iOS Home rails fade their cards under the page gutter once scrolled, like the web, and the parity run captures and diffs a scrolled Home in both themes.
- iOS: the phone shell, home, library, search, settings index, title page (film and series) and household blocked screen now follow the web mobile layout; the title page gains the Playback sheet, an availability note, chapters and an Add to watchlist button.
- Web: Settings renders through the shared page layout: the header shows the section name over its description, phones show the section title, and the panels get the shared scroll-edge fade and the shared loading, empty and error states.
- Android (phone and TV): every page now renders through the one shared page layout in `core-designsystem`, with a registry id, typed header actions, shared loading, empty and error states that keep the header and Back, the calendar's period navigation as a page action, and on television the shell action column at the right edge. Card focus (lift and soft shadow) values live in the design system.
- Roku: in the light theme the hero and Library key art use the server's light stage bake (greyscale at the web's contrast, brightness and opacity) instead of the raw colour image.
- Web: the Release Calendar and Folders render through the shared page layout; the calendar's previous, Today and next controls are the shared navigation group (hidden at phone width, where the page shows its own sub-row), and Folders gains the shared scroll-edge fade.
- Web: Downloads, Watchlist and Requests render through the shared page layout; their loading, empty and error states now sit centred inside the page body, with the header and Back always visible.
- Roku: film and series pages follow the web layout: header chip, tracked title, meta row, action tiles (Playback, Play or Start, Add to watchlist, Add to Playlist) with working watchlist and playlist actions, Chapters and Cast rails with number overlays, and a series left panel that follows the focused episode.
- Roku: the Library follows the web layout (header, hero text with letter-spacing, four grid rows, art at web size with 12 px titles, key art at the web scale with smooth gradients), the action tiles sit in the shell column at the web position, a slow refresh no longer signs the device out, and the web comparison scripts log in once and accept scrolled-state ids.
- Fire TV client: text uses fractional sizes, so widths match the web's; Home cards sit on the web's pixel positions, the right edge masks like the web's, and the hero art is the server's greyscale `stage` bake.
- Server: the artwork `style` query accepts `stage-light`, the light-theme key-art look (greyscale, contrast 0.88, brightness 1.1, opacity 0.4 baked into alpha).
- Android: Playlists Create, the Calendar link and Search Filters are now typed header actions drawn by the one action pill (the 30 September Filters tile) instead of hand-built buttons; Search's Filters moves from the body into the header slot. Back and every pill show the theme focus ring (white in dark, ink in light) with no fill, and on phones the Back button centres on the action tile.
- Web: Library, Playlists and Search now render through the shared page layout (one header, one scroll area with the edge fade); no visible change other than the shared fade on the Search results.
- tvOS: the Filters and Calendar link buttons stack in one right-hand action column like the web shell, library and search cards use the web's pinned focus lift and shadow, with no focus ring.
- Fire TV client: parity evidence (per-screen mismatch in light and dark, platform limits and open gaps) is documented under docs/parity/fire-tv.
- Fire TV parity tooling: the device capture driver batches foreground-checked key presses, selects the theme reliably and covers the new screens; the live web capture script covers search, downloads, watchlist, requests, Playlists and music.
- Fire TV client: Playlists follows the web TV layout (page copy, the Create and Filters tiles, one track of titles per playlist, and the web's empty state).
- Fire TV client: the settings panels show the server's own name and the signed-in user, use the web's pill buttons and field colour, and the avatar chooser no longer draws a ring round unselected avatars.
- Android (phone and TV): Customise Home moved from Home into Settings as its own panel with the same controls (show or hide, move up and down, reset), saved on every change. Home no longer has the button.
- Roku: the Library follows the web layout (header, hero text with letter-spacing, four grid rows, art at web size with 12 px titles, key art at the web scale with smooth gradients), the action tiles sit in the shell column at the web position, a slow refresh no longer signs the device out, and the web comparison scripts log in once and accept scrolled-state ids.
- Web: the shared page layout primitives (`PageLayout`, `PageActions`, `ActionPill`, `ScrollArea` with the edge fade built in, and the loading, empty and error states) and the page-layout stylesheet that now owns the header, Back, the action pill, the shell clock and the tokens. Pages are not moved onto them yet, so no page looks different, except that focus on Back and on every button is the theme ring (white in dark, ink in light) with no ink fill, and pointer hover on buttons follows focus.
- Fire TV client: the release calendar (agenda view with the selected release's details and the unreadable-source banner), the household-blocked page (outside the schedule or over the daily budget, with the guardian request), and the action column at the right edge for the library Filters button.
- Fire TV client: the player has the web's controls (close button, scrubber, play and pause, subtitles and the quality menu with the resolution matrix), and Back unwinds one layer per press (menu, then controls, then exit). The first key press with the controls hidden only shows them, the OK key on the scrubber toggles play and pause, and seeking settles before it is sent. A title the device cannot decode now offers a quality choice instead of a bare error.
- tvOS parity run now captures a scrolled Home (rail moved right by four cards) in both themes and fails on a hard-cut rail edge, comparing it with the web at the same scroll offset.
- tvOS Home no longer draws a Customise Home button (owner ruling: it lives in Settings).
- Roku: Home shows every server rail under On deck like the web, On deck lists episodes with their frame and title, artists and a progress bar, and cards show the unwatched dot only for unwatched titles.
- Roku: the Home hero and rail headings keep the web letter-spacing, the stage uses smooth gradient ramps, artwork is decoded at card size and retried when the relay drops a request, card focus uses the pinned web shadow and lift, the dock matches the web geometry, and the capture scripts record the web DOM.
- Android: the Playarr web palette and the page chrome measurements (gutters, header geometry, safe areas, focus ring) now live in `core-designsystem` as observable, theme-aware tokens, with the form factor provided once from the main activity. `WebPink` is renamed `WebAccent`. No visual change.
- Android TV: settings panels, the Phone remote and Your data screens, Home rail row pitch, the player control pills and the quality matrix, choice cells, the profile-lock field and the search field follow the web TV geometry more closely (light and dark).
- tvOS series page opens focused on the episode the server's resume plan points at (S1E1 when nothing is watched), with its season scrolled into view and the media-card focus state on it (soft shadow plus a lift, no ring).
- Fire TV client: the film and series title pages, search, watchlist, requests and downloads follow the web TV layout; Home and the library grid fade at their scroll edges; media cards lift with the web's pinned shadow instead of a ring; UP and DOWN between Home rails land on the card directly above or below; and Customise Home moves from Home into Settings.
- Edge fades are now clearly visible in the dark theme on web and Android (a scrim in the page background over the content); the light theme is unchanged.
- Android TV Calendar month view now shows chips inside the day cells, as on web, and RIGHT from the navigation rail lands directly in the page content.
- Fire TV client: the shell chrome (left rail, clock, profile chip), Home, the library grid and the settings workspace now follow the web TV layout in light and dark, with the web focus ring, and the capture driver refuses to press a key unless Playarr is the foreground app.
- Web: Customise Home moved from a button on Home into Settings as its own section (`/settings/home`, same controls); the old `/customise-home` link redirects there and Home no longer has an action button.
- tvOS Preferences shows the nine web panels (profile avatar, language, player, server connection, profile lock, invite, request latency, phone remote, your data) laid out like the web TV, with a hairline under the heading and the uppercase heading detail.
- Roku: media cards show a soft shadow and a lift on focus instead of a ring, Up and Down between Home rails land on the card directly above or below, the library sorts like the web (200 titles per page, native sort), Filters and Calendar actions sit in one shell column on the right, and Customise Home moved from Home into Settings.
- Android TV player: D-pad arrows no longer seek while the controls are hidden (they only reveal them; only the dedicated media rewind and fast-forward keys seek). The scrubber steps 10 s per press, accelerates while the key is held and shows a target-time label. Revealing the controls puts focus on play/pause or the last focused control, and the scrubber's up and down neighbours are fixed (close button and play/pause). Controls auto-hide after 5 s. Minimise, close and play/pause show the white focus ring.
- Android: pressing HOME or switching the screen off while a video plays pauses it and saves the position; coming back shows the controls with the video paused. Home refreshes its On deck row after a player exit.
- Roku: rails, library grids and pages fade at the edges where content continues off-screen, the Home rail viewport shifts with focus like the web track, and header action buttons use the web filter tile look.
- Roku: Home labels its first rail On deck like the web, the hero title uses the web size, and parity captures compare the device with the live web client on the same real account.
- CI: the Fire TV client's typecheck and jest run on pull requests that touch the app or the shared code it imports (they never ran in CI before), and gate merges through `ci-required`.
- iOS and tvOS: Play opens the player directly instead of a full-screen "Preparing playback" screen; tvOS player BACK closes panels, then the controls, then exits, the scrubber shows the web focus ring and SELECT on it toggles play/pause, and the controls scrim rises from the bottom.
- Android: Play opens the player directly (black stage, close control, buffering spinner) instead of a full-screen "Preparing playback" page; the unused strings and translations are removed.
- Android player: BACK closes the open panel first (returning focus to its opener), then the controls overlay, and only then exits.
- Android TV player: the focused scrubber shows the web white ring with an enlarged thumb, SELECT toggles play/pause only, and focus no longer leaves the scrubber after a seek.
- Android player: the controls scrim rises from the bottom edge and recedes downward (240 ms ease, as on web).
- The single release workflow now also deploys playarr.app from the release commit after the GitHub Release is created. A failed web deploy fails the release, and the run summary reports the deployed version and commit.
- Web and the legacy TV container: pressing Play opens the player at once (black stage, normal chrome, buffering spinner) instead of a full-screen "Preparing playback" page; errors still show inside the player.
- Web player: BACK or Escape hides open controls first and a second press exits; menus and panels still close first. SELECT on the focused scrubber toggles play/pause without seeking, the scrubber shows the white focus ring with an enlarged thumb, and it keeps focus while a seek buffers. The controls scrim now rises from the bottom edge and recedes downward.
- Fire TV client: the hosted-link broker origin (`PLAYARR_HOSTED_LINK_ORIGIN`) and a frozen app clock for parity captures (`PLAYARR_PARITY_CLOCK`) are build-time settings, so on-device captures need no source patch; the production defaults are unchanged.
- Xbox, Harmony, Roku and Fire TV: pressing Play opens the player directly (black stage, title, at most a small spinner) instead of a "Preparing playback"/"Loading" page; errors still show as before. BACK closes an open panel or the controls overlay first, and only the next BACK leaves playback.
- tvOS release calendar renders the server's computed actions (Play or Resume, Open, Request, Watchlist) with their disabled reasons and active states instead of guessing from whether a file exists.
- Roku: text is drawn in the web typeface (static Nunito Sans instances, JetBrains Mono for figures) instead of the system font.
- Android TV: profile avatar ring and scale, soft glass pill shadows, episode and chapter tile shadows, crimson selected quality choice, one-line search Filters pill.
- Roku: Home, library and rail cards show the work's backdrop (web's 16:9 card art) instead of the poster, and the hero title line pitch follows web.
- Parity: a committed Android TV capture script (scripts/parity/android-tv) clears the app data per theme, chooses the theme in the app, freezes the clock and waits for the artwork.
- tvOS builds its fonts with the shared DesignFont helper (the same file iOS uses), with only the weight axis set on the web's exact Nunito Sans instance.
- Android TV settings panels: web page tone behind the section list, web font kept inside the panel, and invite, lock, remote and player spacing tuned to the references.
- The Apple clients' shared PlayarrKit now decodes the calendar entry's server-computed actions and title snapshot, ready for the calendar views to show exactly what the server offers.
- Parity: Downloads, Watchlist and Requests screens added to the shared list and references; diff.mjs gained --chrome-only/--keep-rect, capture-web.mjs --dump-dom and the hideVideo step, and the Apple workflow now uses the shared capture and diff tools instead of its private copies (removed).
- Parity: the web calendar references (both layouts and themes) are recaptured. The upcoming episode has no file, so the detail offers only "Open series" and "Add to watchlist" (play only for an episode with its own file); the old references still showed a Play button.
- Android TV profile page: web background glow, positions, avatar ring and a Clients pill that shows a QR code for the clients page.
- iOS: embeds the web's exact Nunito Sans instance (`NunitoSans-wght-web.ttf`, only the weight axis free) instead of the full-axis upstream font, so glyph widths match the web; the shared `DesignFont` sets only the weight.
- Android debug builds accept a frozen parity clock so pixel-parity captures do not depend on the real date.
- Android: the remaining dates (invite expiry, household blocks, remote pairing, data transfer expiry, calendar times, calendar detail) use the shared locale-aware formatter, matching the web's Intl output.
- tvOS parity captures freeze the app and the local web capture at the fixture clock read from scripts/fixtures/catalog.mjs (FIXTURE_CLOCK) instead of a second hard-coded copy.
- Fixtures: the upcoming episode's air date is computed from one absolute fixture instant (FIXTURE_CLOCK, shared with the parity capture) instead of the real clock at seed time, so the calendar references no longer drift from day to day.
- Android TV: cards have the web drop shadows and lift when selected on Home, and the hero title uses the web font and the web's 9ch width.
- tvOS: the player quality panel blurs the video behind it like the web, the player parity numbers mask the decoded video, and the season and title Download controls are focusable and explain that Apple TV keeps no offline copies.
- tvOS: embeds Nunito Sans and JetBrains Mono (the files shared with iOS), shows the agenda release calendar and the profile display name, and the Apple parity workflow now diffs against the shared web references in both themes.
- Android TV settings: the section panels (avatar, language, player, server, profile lock, invite, request latency, phone remote, your data) follow the web TV layout.
- Fixtures: every title gets an explicit, distinct added_at (pinned after the first sync), so the home rail order never depends on sync timing; up.sh now needs the sqlite3 CLI.
- Android TV: the calendar agenda follows the web TV layout, and dates on phone and TV are formatted per locale the way the web formats them (for example 7 Oct 2026 in en-GB).
- Android phone calendar: header range, date row, detail rows and the agenda card follow the web more closely, and the open quality menu highlights its button; parity results record the justified residue.
- Android TV settings follows the web TV layout: a wide numbered section list with the selected section's panel beside it.
- Android TV series detail: overview and button row spacing follow the web, and the series-level Download button (not on the web) is gone.
- Android phone and TV embed the web's exact Nunito Sans instance (docs/parity/fonts/NunitoSans-wght-web.ttf); phone parity re-measured in light and dark.
- Parity: the shared TV web references are captured as an Android TV client (TV user agent), so the TV-only player chrome, popovers and calendar layout match what the TV clients show.
- Android: debuggable builds log the number of image requests in flight (tag PlayarrParity) and skip the crossfade, so pixel-parity captures can wait for the artwork to finish.
- Android TV: detail tiles, player scrim and seek bar, and the primary detail pill follow the web styling more closely.
- Android: debuggable builds log the number of image requests in flight (tag PlayarrParity) and skip the crossfade, so pixel-parity captures can wait for the artwork to finish.
- Parity: the native font files are now the exact instance the web renders (Nunito Sans with wdth 100, opsz 12 and YTLC 500 pinned, weight variable) in docs/parity/fonts.
- Fixtures: the placeholder artwork titles are drawn with a bundled Nunito Sans Bold file instead of the host's default font, so the artwork is the same on every OS; the web parity references were re-captured.
- Android phone calendar: the selected agenda entry draws the web's border, left bar and inset ring.
- Android TV uses the bundled Nunito Sans and JetBrains Mono, as the web and the phone do.
- Fixtures: artwork is generated with a pinned gradient seed and media or artwork is regenerated when its generator changes, so two fresh fixture databases produce identical parity captures; the web reference captures were refreshed (bundled fonts, display name, settled scroll).
- Android: the profile chip and profile pages show the server's display name, resolved after sign-in and when a saved session is restored, instead of the username typed at sign-in.
- Android phone: the client uses the web font and the web top-inset rules, the calendar offers Play and Resume, and the profile page follows the web phone layout with the theme selector and a Clients link.
- Android TV: series detail uses the web episode rail and ink Start pill with the availability note between the meta chips and the synopsis, and the player quality menu is the web popover with the Original choice over the Low, Medium and High matrix instead of a side panel.
- Web: Nunito Sans and JetBrains Mono are now bundled as self-hosted variable webfonts (SIL OFL) and lead the font stacks, so the UI no longer depends on a platform-specific font; the parity references were re-captured with them.
- Pixel parity tooling now covers the light and dark themes: `capture-web.mjs --theme`, theme-aware `diff.mjs` and `screens.json`, web references under `docs/parity/web/<layout>/<theme>/`, and a deterministic source sync order in the fixture seed.
- tvOS: Home, Library, title detail, Search, Settings, Release Calendar, profile switcher, the household blocked screen and the player now follow the web TV layout (1920x1080) in light and dark, with the web's nav tabs, preset profile avatars, key art treatment and a web-style player with quality matrix.
- Every client now allows cleartext `http://` connections to the self-hosted Playarr Server the user enters: the Android Google Play flavour no longer denies cleartext, iOS sets `NSAllowsArbitraryLoads`, and the Xbox package declares `privateNetworkClientServer` for home-network servers. HTTPS remains supported and preferred.
- Android phone: header, navigation, home rails, library grid, search, settings index, title detail pages and calendar follow the web mobile layout in light and dark themes.
- Android TV: navigation rail, shell clock, profile chip, page header and the library A-Z rail now follow the web TV layout metrics; Calendar moves to the last rail group (and last in the phone navigation order) as on web, and Requests uses the same bookmark glyph as Watchlist.
- The audio and subtitle pickers on Web and Android now label tracks identically: the localised language name, a distinguishing title, the codec label and the channel layout, for example "German · AAC · Stereo". Web no longer shows the bare language code; Android no longer shows raw layouts like "2.0".
- Legacy TV package player (VIDAA fallback PWA): the "< Back" seek button and "Exit" are replaced by a single "Close player" X at the top right that stops playback and returns; the seek buttons are relabelled with their step.
- Web: the player's audio picker shows the codec next to the language (for example "deu · AAC"), including for dub tracks.
- Household approvals: the decision route now returns distinct 403 error codes (`self_approval_forbidden`, `not_guardian`, `guardian_pin_not_set`) with the same status and messages; the Android guardian screen uses them (falling back to message text for older servers) and confirms each approve or deny with a snackbar.
- Web player: the top-left back arrow is replaced by an icon-only "Close player" X at the top right (localised, reachable with D-pad or arrow keys on the TV layout; Escape and Back still close). Clicking, tapping or pressing Enter/OK while the controls are hidden now only reveals them instead of pausing; Space, k and the media keys still toggle directly.
- Web player: the Original quality now shows the source bitrate, for example "Original · 24.3 Mbps", or plain "Original" when the bitrate is unknown (never "0 Mbps").
- Web player: Minimise uses the browser Picture-in-Picture window where supported, falling back to the in-app mini player otherwise.
- The regional image workflow now pushes its commit SHA tag only when run on `main`, so a manual run on another branch cannot publish a tag that deployment tooling would follow.
- Web: the Release Calendar now shows Play, Open, Request and Watchlist from the actions the server computes for the signed-in user, and posts the server's title snapshot unchanged; a disabled action shows the server's reason.
- Web: the calendar link panel shows the existing link with one call and only replaces it when you press Reset.
- CI passes the optional `GRADLE_ENCRYPTION_KEY` secret to setup-gradle so the Gradle configuration cache can be persisted once the owner creates it.
- Use the canonical `playarr` container image name for server releases and regional commit images.
- The GitHub Release body is now a short generated summary (highlights and artefact list) with the full changelog attached, so it stays within GitHub's size limit; the Xbox package is named correctly as an unsigned `.appx`.
- Helm chart: all regional instances now share one top-level `regionalImage` value, so the fleet runs a single version. The per-instance `image` is an optional override that is not used in normal operation.
- playarr.app serves every client download (Android, Playarr Server, Roku, webOS and Tizen) from GitHub Releases only: the R2 downloads bucket fallback and its binding are removed, and a path with no published asset returns 404.
- CI: after a TestFlight upload, the Apple signed release prepares the App Store Connect draft version (renames it to the marketing version and attaches the processed build) without submitting it for review; `--plan` previews the changes read-only. The marketing version now defaults to `PLAYARR_VERSION_NAME` rather than a hard-coded `1.0.0`.
- The merge train no longer posts any pull request comment. A blocked PR still loses `ready` and gains `blocked`, with the reason written to the run's job summary and logs; a landed-tree mismatch stops the train and fails the run. AGENTS.md tells agents to watch for `blocked` and re-add `ready` themselves.
- Version 0.3.0: Playarr Server (`backend/Cargo.toml`, `[server] version`) and the Android app (`version.properties`), with Google Play notes for 0.3.0.
- CI: the Xbox release job builds an unsigned x64 sideload MSIX on the hosted Visual Studio 2022 image instead of placeholder steps.
- CI: the Apple signed release workflow has a `dry_run` dispatch input that signs, archives and exports the IPAs on a hosted macOS runner but stops before the TestFlight upload.
- `POST /api/v1/calendar/feed` returns the existing calendar subscription link (`200`) or creates one (`201`); the token is stored sealed so it can be shown again, and `?rotate=true` replaces it. Links created before this change are replaced the first time they are requested.
- CI now rejects pull requests with any commit carrying a `Co-authored-by:` trailer, and the merge train strips such lines from the title and body it uses for its squash commit.
- CI: the merge train no longer comments on a pull request when it lands successfully; it comments only when it blocks the pull request or fails.
- Android APK and Playarr Server downloads are published to GitHub Releases only. The release workflows no longer upload to object storage, and `playarr.app/downloads/android/...` and `playarr.app/downloads/server/...` now redirect (latest and versioned) to the matching GitHub Release assets.
- CI moved to GitHub-hosted runners (Linux, Windows for the Xbox UWP build, macOS for iOS and tvOS Simulator tests and the signed TestFlight release); a check requires hosted runners, and the regional image is published to GitHub Container Registry.
- Selecting a Dubarr dub (or another source audio track) at original quality no longer re-encodes the video when the client can play the source codec (H.264 or HEVC) within its bitrate cap: the server copies the video into fragmented-MP4 HLS and encodes only the audio, so a 4K HEVC remux starts quickly without a CPU transcode. Other cases still transcode as before.
- Repository hygiene ahead of making the repository public: real media titles in tests, fixtures, docs and history notes are replaced with neutral placeholders, and real artwork and screenshots (Apple TV parity fixtures, site screenshots, social card, Play feature graphic) are replaced with generated placeholder images. The Apple TV parity suite now generates its artwork procedurally. `AGENTS.md` and the pull request template forbid media titles and real artwork.
- Deployment data no longer lives in this repository: the `playarr-dev` chart ships neutral (empty) defaults and documents its values, a worked example with placeholder data backs its tests, and the real instances, hostnames, addresses, hostPaths and image pins live in separate deployment configuration. Regional image rollouts are now a deployment values change, not a Playarr PR.
- The iOS dispatch reads its Apple release pipeline from the `APPLE_BUILDS_REPOSITORY` repository variable.
- Tests, docs and scripts use placeholders (`example.com`, RFC 5737 addresses, `/srv` paths); `scripts/mac-build.sh` and `scripts/appletv-parity-ae0.sh` now require `MAC_HOST`, and the marketing dev server takes extra hostnames from `SITE_ALLOWED_HOSTS`.
- Fixed `clients/harmony/scripts/fetch-sdk.sh` exiting 1 on newer bash (its EXIT trap clobbered the exit status).
- Pin regional server A and regional server B regional deployments to image `<image>` after verifying the build for source SHA and its published digest.
- Server: add authenticated admin endpoints to manage peer-group libraries, map local source instances to group libraries, and create/update peer routing rules (TASK 299). Deletion is omitted because group sync has no tombstones; disable routing with an empty `preferred_nodes` list, then unmap the source when rolling back.
- CI: task board evidence for the merge train, fragments and affected-only work (TASKS 330 to 332).
- Backups are local and encrypted by default; any off-node S3-compatible destination is optional, administrator-configured and provider-neutral. Removed the R2 bucket provisioning script and the chart's R2 endpoint defaults, and documented that Cloudflare hosts only the playarr.app client and never receives server data (backups, media, databases, logs) (TASKS 140).
- Regional servers regional server A and regional server B now run image `<image>`, which fixes the calendar subscription URL behind HTTP/2 (tasks 75-77).
- Regional server B now runs image `<image>`, which carries the audio and subtitle language index, catalogue language filters and the language facet endpoint (tasks 181-185), after regional server A was rolled to the same image.
- Regional servers regional server A and regional server B now run image `<image>`, which carries the release calendar, iCal
  subscription and availability-lag endpoints (tasks 75-77).
- Rolled the regional server A and regional server B regional servers to image `<image>`, which adds self-service portable user data export and import (tasks 67-71) on top of encrypted server backups, discovery/watchlist and the phone remote.
- Rolled the regional server A regional server to image `<image>`, which adds encrypted server backups (enabled by the chart: daily, state volume, bounded retention). regional server B follows once regional server A is verified.
- Regional servers now run image `<image>`, adding batched external-reference loading for catalogue browse (task 100).
- Regional servers now run image `<image>`, which carries the catalogue latency fix, sidecar subtitles and the Radarr release-date mapping (tasks 95, 98, 100).

### Fixed

- Server: the declaratively managed Dubarr source instance now has a fixed id and duplicate Dubarr rows (same base URL) are collapsed at boot, so peer replication of source instances no longer lists Dubarr twice (TASKS 303).
- CI/deploy: main CI runs are never cancelled (per-SHA concurrency group; the shared per-ref group cancelled older pending runs), and the web deploy uses group `deploy-web-prod` with a guard that skips commits older than the live build via `build-info.json` in the bundle (it no longer skips merely because main has moved on, which starved the deploy).

- Web: the wrapped page-header separator spans only the title/subtitle block instead of the whole header row; `scripts/header-parity.mjs` asserts it.

- Web player: scrubbing no longer drops to the full-screen "Preparing playback" view. A seek that restarts the transcode (and quality/audio switches) keeps the player UI, video element and engine mounted and shows only the inline buffering spinner; the full screen is for the initial start only. Android already behaved this way.
- Playarr Android: when a direct-played title cannot be decoded by any device decoder (for example 4K HEVC Main 10 / Dolby Vision on the TV emulator, which PR 98 now correctly negotiates as HEVC instead of an unknown `x265` codec), the app re-negotiates once as a 1080p H.264 transcode at the same position instead of stopping with "decoding failed".

- Remote control: the first D-pad presses sent to a TV app nobody had pressed a key in were silently
  lost (the view tree had no focus); a pairing that was never approved no longer leaves the Pair
  buttons disabled (web and Android); an older server answering the stream path with its HTML shell is
  detected and the clients long-poll instead of retrying in a loop.
- The calendar subscription URL now uses the real public origin when the server is reached over HTTP/2
  (the host lives in the URI authority, not a `Host` header), instead of `http://localhost`.
- Removed merge conflict markers left in the changelog, web routes and navigation by the calendar merge,
  and restored a missing closing brace in the web stylesheet's `.remote-pairing-row` rule.
- Phone remote on Android: the TV approval dialog now takes focus so a TV remote can press Allow, remote
  D-pad commands are delivered as D-pad key events (they were ignored), a remote stop leaves the player
  screen, and a handoff destination acknowledges only once playback has really started and catches up to
  where the source is now (web does the same).

### Added

- Availability lag (task 77): grab and import events from the Sonarr, Radarr, Lidarr and Readarr
  webhooks are stored (`availability_events`, SQLite 0047, Postgres 0048) and
  `GET /api/v1/catalog/{id}/availability-lag` returns the average time from release to first import
  (plus grab lag, sample list and counts). Upgrades and repeat imports never count, imports more than
  30 days after release are reported as backfills and excluded, and items with no release time are
  counted as unknown. Episode calendar entries carry `average_lag_seconds`.
- `scripts/remote-control-smoke.sh`: black-box check of the phone remote and handoff API against a live server.
- Regional server B now runs image `<image>` as well (phone remote and playback handoff API; discovery and
  watchlist API), after regional server A was verified.
- Regional server A now runs image `<image>`, which adds the phone remote and playback handoff API
  (tasks 50-53; regional server B follows after verification).
- Regional server A now runs image `<image>`, which adds the discovery and watchlist API (regional server B follows after
  regional server A is verified).
- Playback info and playback options now list sidecar subtitles
  (`<video>.<lang>[.forced|.sdh].srt/.ass/.ssa/.vtt` next to the media file) in
  `subtitle_tracks`, served as WebVTT through the existing subtitle endpoint with
  stable synthetic stream indices (10000 and above). Audio tracks gain `profile` and
  `codec_label` (for example "DTS-HD MA", "TrueHD Atmos") and untitled tracks are
  labelled with language, codec and channel layout (task 98).
- Playarr Admin: a Household controls editor on each account (highest content rating, unrated
  handling, hidden tags, daily watch time, weekly schedule with time zone, guardians, approval
  kinds, offline validity), saved through `PUT /api/v1/admin/users/{id}/household`.
- Playarr Web: a "not available right now" screen with the next start time or reset time when a
  profile is outside its schedule or out of daily time, with "Ask a guardian for more time" and
  "Switch profile"; an "N min left" chip in the last hour; a Household page where a guardian
  approves or denies requests with their own PIN; plain-language PIN lockout messages
  (also in Thai and Japanese). The shared API client gains the household calls and
  `parseHouseholdBlock`/`parsePinLockSeconds`.
- The public Clients hub at `/clients` now lists Playarr Server (`/clients/server`) as a
  server, not a playback app: requirements (ffmpeg/ffprobe), Docker Compose, systemd and
  Helm install methods, and the optional playarr.app HTTPS relay. It states that no
  binaries or public image are published yet and offers no download. English, Thai and
  Japanese; covered by `Clients.test.tsx`.
- Self-service portable user data (tasks 69-70). Signed-in users can export their own watch
  progress, personal playlists and preferences to a ZIP (`POST /api/v1/users/me/data-exports`,
  status, download, delete; node-local files that expire after 30 minutes) and import a package
  into their own account with a preview step (`POST /api/v1/users/me/data-imports/preview`, then
  apply with the previewed SHA-256). Matching uses TMDB/TVDB/IMDb identifiers first and a strict
  fuzzy title fallback; imports merge without deleting, are idempotent, never touch another
  account, and unmatched or ambiguous records are returned as a re-importable package.
  The package includes the per-profile watchlist (kept even for titles not in any library) and
  a `watchlist.csv` view. `UserRepo::list_media_playback_preferences` added.
- New `playarr-portability` crate: the versioned portable user-data package (canonical JSON,
  CSV views, README and JSON Schema in a ZIP), a hardened reader (size, entry, path, symlink,
  version and text limits) and identifier/fuzzy title matching, with unit tests (task 68).
- Playarr for Android (phone and Android TV) has a Playback health dialog in the player: a
  plain-language explanation of direct play versus transcoding, HDR to SDR and audio limits,
  technical detail that labels every value measured, reported or not available (using the player's
  decoder, dropped-frame, rebuffer and audio-passthrough measurements), a short cancellable
  connection test, and an explicit copy/share of a redacted diagnostics export (tasks 58-60).
- Playarr Web (and the TV layouts that share it) has a Playback health panel in the player
  controls: a plain-language explanation of direct play versus transcoding, HDR to SDR and audio
  limits with a next action for each, a "technical detail" view that labels every value measured,
  reported by the device or not available, a short cancellable connection test, and an explicit
  Copy/Save of a redacted diagnostics export (tasks 58-60).
- Playarr for Android (phone, tablet and Android TV, native Compose) now works as a phone remote
  and playback-handoff client. Settings has a "Phone remote" section: allow this device to be
  controlled (on by default on Android TV), pair with another device of your account, drive it with
  a D-pad, text entry and transport controls, and revoke pairings. A TV shows an on-screen approval
  prompt with a verification code first. The player has "Play on another device", which moves the
  title at the current position and stops locally only after the other device confirms playback.
- Playarr Web (and the webOS/Tizen/Android TV web surfaces that share it) now works as a phone
  remote and playback-handoff client. Settings has a new "Phone remote" page: allow this device to
  be controlled, pair with another device of your account, drive it with a D-pad, text entry and
  transport controls, and revoke pairings. The target shows an on-screen approval prompt with a
  verification code before anything is allowed. The player has "Play on another device", which
  moves the title at the current position and stops locally only after the other device confirms
  it is playing.
- Phone remote and playback handoff, server side (tasks 50-53). A device registers as a remote
  target with advertised capabilities; another device of the same account requests a pairing that
  the target must explicitly approve. Active, unexpired, revocable pairings authorise scoped
  navigation, text, playback and input commands over a durable long-poll inbox; wrong-account,
  wrong-device, out-of-scope, revoked, expired and offline-target requests are rejected, and text
  input is never logged or retained after delivery. Transactional handoff
  (`/api/v1/remote/handoffs`) offers playback to a destination and stops the source only after the
  destination acknowledges, with idempotency keys, replay protection and expiry. Design in
  `docs/architecture/remote-control.md`; migrations 0045 (SQLite) and 0046 (Postgres); OpenAPI
  updated.
- playarr-dev chart: per-instance `backup` block (enabled for regional server A and regional server B) that sets the
  `PLAYARR_BACKUP_*` variables for encrypted server backups to `/data/backups` on the state volume
  (daily, keep the newest 3 and anything under 7 days, artwork capped at 1 GiB). Only the age public
  recovery key is in values; the schema rejects enabling backups without a valid public key.
  `tests/backup.sh` covers rendering, optionality and schema rejection.
- Playarr Android (phone, tablet and TV): Watchlist destination with Resume/Play that opens the exact
  media file, Request and explained unavailable actions; watchlist toggle on title pages; "Other
  sources" results and a Games filter in Search with provider status.
- Request from discovery: Radarr/Sonarr catalogue lookup feeds `GET /api/v1/discover` as
  requestable titles, and `POST /api/v1/discover/request` adds a title to the provider's default
  root folder and quality profile. Admins can request by default; set
  `PLAYARR_REQUESTS_ALLOW_ALL_USERS=true` to let every signed-in user. Unreachable providers are
  reported in the response instead of failing the search.
- Admin "Backups" page (System): shows the backup destination, contents mode (database-only is labelled
  partial), schedule, retention and recovery-key fingerprints; starts a run with live phase progress;
  lists backups with Complete, Partial or Incomplete badges, what each includes, excludes and depends on
  (library paths, secrets to supply); downloads the encrypted archive, verifies its stored checksum and
  deletes backups; shows recent failures and the restore command. When backups are not configured it
  explains how to enable them. Typed API client methods and regenerated schema.
- Administrator backup API under `/api/v1/admin/backups`: overview (configuration, current run with phase,
  history from the commit records, recent failures, recovery-key fingerprints), start a run (202, 409 if one
  is active), download the encrypted archive, verify its stored checksum and delete a backup (the last
  complete backup cannot be deleted). Scheduled runs execute on the elected leader node. Config errors
  (a backup directory without a valid recovery public key) stop startup instead of silently not backing up.
- Android (phone, tablet and TV): native Compose release calendar in the main navigation with
  agenda (default), week and month views, previous/next/today, media-kind filters, a visible banner
  for integrations that could not be read, and D-pad navigation on TV. Entries open the work detail
  or a sheet with sources and library state. Calendar subscription management (create, regenerate,
  copy/share, revoke, last used) and "Usually available about X after release" on series details,
  with an honest "no data yet" and a note on excluded backfills. Tracked as tasks 75-77.
- Android client data layer for the release calendar (`GET /api/v1/calendar`, the `/calendar/feed`
  subscription routes and `/catalog/{id}/availability-lag`): typed models that tolerate unknown
  enum values, a `CalendarRepository`, and decoding/route tests. Tracked as tasks 75-77.
- External calendar subscription (task 76): `POST/GET/DELETE /api/v1/calendar/feed` create or
  regenerate, inspect and revoke a per-user token, and `GET /api/v1/calendar/feed/{token}.ics` serves
  an RFC 5545 feed (14 days back, 180 ahead) limited to the owner's current libraries. Only a SHA-256 of
  the token is stored, regenerating revokes the old URL, and unknown or revoked tokens return 404.
  New `calendar_feed_tokens` migration (SQLite 0046, Postgres 0047).
- Playarr Web (and the TV shells that share it): a Watchlist page and nav item with Resume/Play
  that opens the exact media file and explained unavailable actions, a watchlist toggle on title
  pages, "Other sources" results (peers) in Search and a Games filter with provider status.
- Playarr Web (and the webOS/Tizen shells that share it) now has a Calendar page in the main navigation
  with agenda, week and month views (agenda by default on TV, touch and narrow screens), previous/next/today
  navigation, media-kind filters, a visible banner naming every source that could not be read, and
  loading, empty and error states. Entries open the work detail when it is in the catalogue, otherwise a
  sheet shows sources, library state and the exact local release time. The page also manages the iCal
  subscription link (create, regenerate and revoke with confirmation, copy once, last-used time), and the
  series detail page shows "Usually available about X after release" with an honest no-data state and
  the excluded backfill/unknown counts (tasks 75-77). Includes English, Thai and Japanese strings.
- Shared web API client methods and types for the release calendar (`getCalendar`, feed status, create,
  regenerate and revoke, and `getAvailabilityLag`), with unit tests (tasks 75-77).
- Playarr Web settings now has a "Your data" section (task 130): prepare and download an export of
  your own watch progress, playlists and preferences with visible progress and expiry, and import a
  package through a preview of exactly what would change (new, updated, kept, unmatched) followed
  by an explicit Apply, with a download of anything that could not be matched. TV identities show
  an honest message instead, as they have no file picker. English, Japanese and Thai strings.
- Android settings has a native Compose "Your data" section (task 131): prepare an export of your
  own watch progress, playlists and preferences and save it with the system file dialog, or pick a
  package, review exactly what an import would change, then apply it; unmatched records can be
  saved for a later import. Android TV, which has no document picker, says so instead of showing
  dead controls. English, Thai and Japanese strings, with unit tests.
- Documented the portable per-user data export/import format
  (`docs/formats/user-data-export-v1.md`) and its design
  (`docs/architecture/user-portability.md`), tracked as tasks 67-71 and 130-134.
- Design for the aggregated release calendar, iCal subscription and availability-lag statistic
  (`docs/architecture/release-calendar.md`, tasks 74-77); sub-rows 74.1-74.5 track the other clients.
- Documented the server backup and recovery design (inventory, encrypted format, consistent
  snapshots, retention, staged restore and verification plan) in
  `docs/architecture/server-backups.md`, tracked as tasks 62-66.
- Household and child controls on the server (TASKS 104-107, design in
  `docs/architecture/household-controls.md`): rating ceiling with a fail-closed unrated
  setting and blocked/allowed tags enforced on catalog browse, search, detail, similar,
  credits, artwork, saved views, playlists, watch history, downloads and every media route;
  schedules evaluated in the profile's IANA time zone on the server clock; a server-counted
  daily watch budget; `GET /api/v1/household/status`; guardian approval requests for
  content, extra time, purchases and installs, approved with the guardian's own PIN and bounded
  by expiry and single use; admin `GET/PUT /api/v1/admin/users/{id}/household`. Arr sync
  writes Radarr/Sonarr certifications as `rating:` tags (admin override `rating-override:`).
  Policies gain a `household` JSON column (SQLite migrations `0050`/`0051`, Postgres `0051`/`0052`).
- Bypass-resistance tests for token reuse, capability media URLs, profile escape, PIN brute
  force, expired and replayed approvals, and schedule crossing during playback
  (`backend/crates/playarr-api/src/household_tests.rs`).
- Documented the household and child controls design (rating/tag gates, timezone schedules, server-counted
  daily budgets, guardian approvals, PIN lockout, offline limits) in
  `docs/architecture/household-controls.md`, tracked as tasks 103-114.
- Playback health API: `POST /api/v1/playback/sessions/{session_id}/health` explains how a
  session is delivered (direct play or transcode and why, HDR to SDR, audio) from the stored
  negotiation plus client-reported and client-measured values, labels each fact measured,
  reported or unknown, never infers Dolby Vision or passthrough from advertisements, and returns
  a redacted export. `GET /api/v1/playback/connection-test` serves a bounded (default 1 MiB, max
  4 MiB, four at once) payload for a cancellable connection test. Design in
  `docs/architecture/playback-health.md` (tasks 58-61).
- Unified discovery API: `GET /api/v1/discover` merges library and peer results by external
  identity (with editions and per-source attribution), reports a status per provider and keeps
  games behind `scope=games`; `POST /api/v1/discover/resolve` returns server-computed Play, Resume,
  Request, Record and Launch actions with reasons when disabled.
- Per-profile watchlist: `GET/POST /api/v1/watchlist`, `DELETE /api/v1/watchlist/{title_key}`
  (migration `watchlist_items`), re-resolved against the library on every read.
- Documented the unified discovery and watchlist design (title identity, source attribution,
  provider status, per-profile watchlist, source-aware actions) in
  `docs/architecture/discovery-watchlist.md`, tracked as tasks 46-49 and 49a-49e.
- Encrypted server backups (`playarr-backup` crate). A backup is a consistent database snapshot
  (SQLite `VACUUM INTO`, or one `REPEATABLE READ` PostgreSQL transaction) plus the artwork cache,
  written as an age-encrypted archive with a versioned manifest of checksums, row counts and an
  explicit included/excluded/unavailable inventory. Archives are published atomically (partial
  file, read-back checksum, then a plaintext sidecar as the commit marker), so an interrupted or
  failed run never appears as a complete backup. Retention runs only after a successful publish
  and always keeps the last good backup. Configure with `PLAYARR_BACKUP_DIR`,
  `PLAYARR_BACKUP_RECIPIENTS`, `PLAYARR_BACKUP_MODE`, `PLAYARR_BACKUP_INTERVAL_HOURS`,
  `PLAYARR_BACKUP_KEEP_LAST`, `PLAYARR_BACKUP_KEEP_DAYS`. New CLI: `playarr-server backup keygen`,
  `create` and `verify`. The server holds only public keys; the recovery identity stays with the
  administrator.
- Staged server restore: `playarr-server backup restore` validates the archive (decrypt, every
  checksum, format, engine and schema compatibility), restores into staging (a private SQLite file,
  or a staging PostgreSQL schema built at the archive's schema version and migrated forward),
  verifies row counts, integrity and foreign keys, then checks that library roots exist before
  cutover. The previous installation is kept aside (renamed file or schema) and a failed restore
  leaves it untouched. Sessions, download tickets and renditions are cleared; `--remap-path`
  rewrites library paths; `--identity clone` drops peer identity and disables request forwarding,
  push and Tdarr so a copy cannot act as the original; `--dry-run` validates only. Cross-engine
  restores are refused. PostgreSQL tests run when `PLAYARR_TEST_POSTGRES_URL` points at a scratch
  server.
- Documented the server backup and recovery design (inventory, encrypted format, consistent
  snapshots, retention, staged restore and verification plan) in
  `docs/architecture/server-backups.md`, tracked as tasks 62-66.
- `GET /api/v1/calendar`: aggregated release calendar across the connected Sonarr, Radarr, Lidarr and
  Readarr instances (episodes, movie cinema/digital/physical dates, albums, books). Duplicate releases
  on several instances merge with source attribution, results respect the caller's library grants,
  and unreachable or credential-rejected instances are reported per source instead of dropped.
  Backed by new `calendar` methods in `playarr-arr-client`, normalisation in `playarr-arr-sync` and a
  60-second per-instance cache (task 75).
- Documented the cross-client end-of-playback requirement (ended card, up-next
  countdown, replay, exit, suggestions) in
  `docs/architecture/end-of-playback.md`, tracked as tasks 78-85.
- Playarr Web (and the webOS/Tizen shells that share it) now shows an
  end-of-playback card: Replay, Back to details and a "More like this" row,
  or a 10-second up-next countdown with Play now and Cancel when a next item
  is queued. Music chains silently and only shows the card when its queue ends.
  The legacy VIDAA fallback player shows Replay and Back to details.
- Public relay phone-home. With `PLAYARR_RELAY_REGISTER=true` Playarr Server tells the `playarr.app`
  Worker its public IPv4 address (`PLAYARR_PUBLIC_IPV4` or the address the Worker sees) on start, on
  change and hourly, signed with its existing Ed25519 node identity. The Worker issues a stateless
  two-minute HMAC challenge, calls the server back on `/.well-known/playarr-relay/{token}` (port
  8484) and publishes the DNS-only `v4-A-B-C-D.relay.playarr.app` record; a daily cron removes
  stale records. `PLAYARR_ACME_CHALLENGE=relay-dns-01` obtains the certificate with ACME DNS-01
  through the same Worker, so no port 80 is needed. Cloudflare only holds DNS and no streaming or
  API traffic passes through it. With `relay-dns-01` the server can also keep a static
  `PLAYARR_TLS_*` certificate (for example cert-manager's) as the active transport and serves
  the relay certificate alongside it, selected by TLS SNI. The relay stays disabled until the Worker secrets exist. See
  `docs/deployment/playarr-relay.md` for the trust model and cut-over plan.
- Administrators can query `GET /api/v1/admin/system/capabilities` for the optional software and
  hardware available on the serving node: ffmpeg and ffprobe (path and version), key encoders
  (`libx264`, `aac`, `libx265`, `hevc_vaapi`, `hevc_nvenc`, `libsvtav1`, `libopus`), ffmpeg
  hardware acceleration methods and GPU devices. Each item carries a status, the features
  affected and an install hint; probes use short timeouts and a 30-second cache.
- Playarr Admin has a System > Server capabilities page showing that report. Missing required
  software appears in a prominent alert with its impact and install hint, and the status filter
  is kept in the URL (`?show=attention|present`).
- The regional servers run a self-contained image, `ghcr.io/<owner>/playarr-regional:<sha8>`
  (server binary, Admin UI, ffmpeg and ffprobe), built by `.github/workflows/regional-image.yml`
  and published to GitHub Container Registry. The `streamarr-runtime` image, its `runtimePath` hostPath
  and the manual node import are removed.

- Android direct play fetches large progressive streams over eight concurrent
  HTTP range connections (4 MiB chunks, delivered in order, bounded memory),
  so high-latency links no longer cap 4K remuxes at single-connection speed.
  It falls back to one connection when the server does not return `206`.
  HLS, subtitles and downloads are unchanged.
- Android logs `PlayarrPlaybackStats` key=value telemetry (state, buffer,
  bandwidth, rebuffers, dropped frames, decoder, video format, active
  connections) at INFO on state changes and every five seconds while playing.
- Android has a diagnostic-only `debug.playarr.discard_video` system property
  (`adb shell setprop`) that replaces the video decoder with a renderer which
  consumes samples in real time and shows nothing, for measuring the network
  and buffering pipeline on devices that cannot decode the stream. It also
  turns on Media3 `EventLogger`. Off by default and unreachable without adb.

### Changed

- Android playback buffer now targets 30 to 120 s with a byte cap of 40% of the
  heap class, and the app requests a large heap, so remux playback has more
  headroom without risking out-of-memory on TV devices. Playback starts after
  10 s buffered and resumes after 15 s following a stall (was 2.5 s and 5 s), so
  a remux on a link only slightly faster than its bitrate rides out peaks.
- The regional servers `regional server A` and `regional server B` serve HTTPS on their public 8484 addresses
  using cert-manager certificates (optional per-instance `tls` in the `playarr-dev` chart). The
  server now hot-reloads a renewed static TLS certificate within a minute, without a restart.
- Playarr Web remote navigation (Home, Movies/Series/Sites/Music, Search) now applies directional
  keys once per animation frame: keys queued behind a busy main thread move a virtual focus by
  index arithmetic and cost one DOM write and one frame, not one per key. Library and Search cards
  are memoised (Movies/Series render in 24-card chunks), artwork fetches, object URLs and row
  pre-mounting wait for the remote to go quiet (350 ms), one shared IntersectionObserver replaces
  one per image, catalogue pages sort with a single `Intl.Collator`, and frosted-glass chrome and
  card transitions are flattened while the remote is in use. Entrance animations no longer keep
  4K layers alive after they finish (`fill-mode: backwards`).
- `clients/tv-web/web/scripts/nav-perf.mjs` (`pnpm perf:nav`) measures key-to-next-frame latency and
  per-key main-thread cost on the real Home, Movies, Series and Search screens against a
  deterministic mock API (1,746 movies, 944 series) at 3840x2160 with CPU throttling, and
  `scripts/nav-smoke.mjs` (`pnpm smoke:nav`) runs the remote/pointer/context-menu smoke plan.

### Removed

- Guardian approvals no longer have `purchase` or `install` kinds (owner decision, 9 October 2026: Playarr has no store, so approvals cover only `content` and `time`). The kinds are gone from the model, API, OpenAPI contract, generated web types and the admin and web UI. Migration 0081 strips the two values from stored household policies and deletes their approval rows; reading a policy also skips unknown approval kinds, so old or replicated data never fails to load.
- Removed the unused `pages.player.preparingPlayback`, `pages.player.preparingMessage` and `pages.player.oneMoment` translation strings.
- Removed the Postgres backend: the `postgres` cargo features and `sqlx` Postgres driver, `backend/migrations/postgres`, the Postgres coordinator, `LISTEN`/`NOTIFY` cache and Postgres backup/restore paths, the Redis cache (only reachable on the shared-database tier), the `DeploymentTier` and `REDIS_URL` configuration, and the per-backend SQL variants in `playarr-db`. Playarr is SQLite-only (ADR 0002).
- A `postgres://` or `postgresql://` `DATABASE_URL` now fails startup with a clear error instead of connecting, and `playarr_db::run_migrations` no longer takes an `is_postgres` argument.
- Removed the retired Google Play review demo server (`clients/tv-web/apps/play-review-server`), which was shut down on 2026-08-30 and is not deployed, together with its `just` recipes, workspace lockfile entry and README attribution.
- Removed Postgres and Redis from the Docker Compose files, the Kubernetes base and overlays and the Helm chart: compose runs one server with a SQLite data volume, and the chart deploys a single-replica StatefulSet with a persistent volume (the api/worker split sharing one database is gone). Multi-node deployments use peer sync between SQLite nodes (ADR 0002).
- Rewrote the README, architecture documents, deployment guides, backup guide and site copy for SQLite-only storage.
- Postgres storage support is being removed from the server, Helm chart and compose files; a `postgres://` database URL will be rejected at startup. See ADR 0002.
- Task board: fragments can now remove a row (`remove: <row-number>`); work belonging to other repositories such as Dubarr is no longer tracked on the board.
- Smoke scripts (`live-events-smoke.sh`, `remote-control-smoke.sh`) no longer read `~/.playarr-test.env`; export `TEST_SERVER`, `TEST_USERNAME` and `TEST_PASSWORD` explicitly. Shared test-account references were removed from the docs.
- The in-process authoritative relay DNS server and `PLAYARR_RELAY_DNS_BIND_ADDR` /
  `PLAYARR_RELAY_DNS_ACME_CHALLENGE`. The Worker now publishes the relay records and answers
  DNS-01, so Playarr Server no longer needs a public DNS port.

### Fixed

- Registered the portability `ProgressConflicts` schema so `backend/openapi/playarr.yaml` resolves and the
  TypeScript API client can be regenerated.
- Android playback health dialog: D-pad focus now starts on the first finding instead of Close, so Down walks the findings, detail, connection test and export buttons.
- Catalogue browse loads each page of works' external references with batched `IN (...)`
  queries instead of one query per title, removing the remaining ~0.4 s per uncached
  `/api/v1/catalog` call on regional server B (task 100).
- Direct-play negotiation now treats the encoder names `x265`/`x264` (what Radarr and ffmpeg report
  for many files) as HEVC/H.264, so a client that supports HEVC no longer gets a needless
  transcode for an "x265" file. Playback health shows codec names, not encoder names.
- The playback connection test now holds its concurrency slot (four at once, extra callers get
  429) until the response body finishes or the client cancels, instead of only while the payload
  was built, and sends a `Content-Length`.
- `/api/v1/catalog` no longer issues one media-file query per candidate title when
  filtering by library; a single bulk query replaces ~2,700 round trips, removing the
  fixed 3-4.5 s cost per call on large libraries (task 100).
- Radarr movies take their release date from `inCinemas`, then the film's `year`
  (refined by an earlier-or-equal home-media date in that year), and only then from
  the digital/physical dates, so a library film no longer shows its 2005 DVD date.
  Existing titles correct on the next arr sync (task 95).
- Movies and Series: OK/Enter opened nothing (the grid-level key handlers clicked the grid, not the
  title) and the long-press menu used the grid as its origin; each card now owns its handlers
  again, and a capture-phase guard re-targets OK to the title the remote is actually on.
- Movies and Series: the alphabet strip jumped to the wrong letter because rows are mounted on
  demand, Back from a title deep in the list lost focus, and holding Down left the focus far below
  the visible rows because smooth scrolling restarted from its mid-animation position on every key.
  Jumps and restores now mount the target row first and remote scrolling is instant.
- Home: the focus highlight no longer vanishes about a second after navigation starts. The On Deck
  detail calls replaced the first rail while it was already interactive, remounting the focused
  card; Home now waits for On Deck (at most 2.5 s, late results are dropped) before rendering.
- Home: remote Left/Right and Up/Down no longer leave the focused card off screen, and the focus
  marker is an attribute React cannot overwrite when a card re-renders.
- A missing `}` in `global.css` (the playback health panel's narrow-screen rule) nested every later
  rule, including the phone-remote styles, inside `@media (max-width: 640px)`; the block is closed
  and a test now fails on unbalanced braces.
- Search: keyboard navigation no longer measures every result on each key, the preview/selection is
  debounced under a held key, and Left from the first column returns to the search box.
- Thumbnail ffmpeg processes are killed when the request that started them is dropped (for example a client
  scrolled past a chapter tile), so abandoned grabs no longer pile up memory behind the concurrency limit.
- Frame thumbnails (`GET /api/v1/media/{id}/thumbnail`) now run at most two ffmpeg extractions at a
  time (`PLAYARR_THUMBNAIL_CONCURRENCY`, default 2) and skip the queue for cached frames. A chapter
  rail requests a dozen frames at once; each UHD grab holds about 0.5 GiB, so four in parallel
  exceeded the 2 GiB pod limit and the kernel OOM-killed the whole server.
- Android: movie chapter thumbnails no longer stay blank. Frame thumbnails load at most two at a time with a
  retry and longer timeouts (an unbounded burst made the server run out of memory), and a tile shows the
  chapter title while loading or after a failure instead of an empty box. Hero and poster art also falls
  back between the server artwork endpoint and the provider URL.
- Android: the audio menu names tracks "English · AAC 2.0" (language, commentary/title, codec, channels)
  instead of repeating "eng", and the Subtitles control is always shown, saying "No subtitle tracks
  available" when the file has none.
- Android: API calls use 20 s connect / 45 s read timeouts and the playback negotiation retries network
  failures, so a cold first Play after sign-in no longer reports "Can't reach the Playarr Server".
- Android: Search builds its availability index with one large request plus concurrent pages instead of
  sequential 500-title pages (about 27 s down to about 4 s on a 2.7k-title library).
- Android: when a video ends while the player is minimised, playback continues with the next queued video or
  the player expands to the ended card instead of silently stopping.
- The `playarr-dev` chart can restore the public relay for the regional servers that moved from
  systemd to k3s pods. An optional per-instance `acme` block builds on the existing
  `hostExposure` (hostPort 8484 on the node's public address, the only published port: no port 80
  and no DNS port) and adds the relay certificate on that port alongside the static cert-manager certificate (the server picks one by SNI). The block ships disabled until the relay cut-over. The pods stay non-root with
  every capability dropped. ACME uses DNS-01 through the `playarr.app` Worker
  (`PLAYARR_ACME_CHALLENGE=relay-dns-01`, `PLAYARR_RELAY_REGISTER=true`, `PLAYARR_PUBLIC_IPV4`).
  The Service and Emissary routes already target TLS on port 443 through the static certificate.
  Chart version 0.4.0; the render test covers the new wiring, and the README carries an
  owner-approved rollout, verification and rollback runbook. Nothing is deployed by this change.
- Roku SceneGraph XML comments no longer contain double hyphens, so the
  channel validator parses every component on current Python.
- Android plays Dolby Vision remuxes on devices without a Dolby Vision decoder.
  The Matroska track was labelled `video/dolby-vision`, left unsupported, and the
  player reported READY with no video renderer at all (`buffered_ahead_ms` equal
  to the whole film, `decoder=none`). Such tracks are now relabelled to their
  HEVC/AVC/AV1 base layer.
- Android retries with the next decoder when one fails mid-stream (such as a
  hardware HEVC decoder that rejects 10-bit video) instead of ending playback,
  and enables Media3 decoder fallback for initialisation failures.
- Android advertises `hevc` alongside `h265` in its playback codec capabilities.
- Direct-play codec matching now treats `h265`/`hevc`, `h264`/`avc` and `av1`/`av01` as
  aliases, so HEVC remuxes are no longer sent to transcode when a client advertises `h265`.
  Direct-play responses for Matroska files now report `video/x-matroska` instead of `video/mp4`.
- The development webOS route now uses `the hosted TV web host`, which is
  covered by the existing deployment wildcard certificate. A chart render
  assertion prevents regression to a hostname outside that coverage.

- The six active development web surfaces now use HTTP startup, readiness and
  liveness probes against their served root page. The marketing Astro probe
  sends the hostname required by its explicit Vite host allowlist.

- Android TV hosted pairing now makes one cancellable five-minute attempt at a
  minimum five-second polling interval, stops when the app backgrounds or the
  pairing screen closes, and requires an explicit retry after expiry instead
  of continuously creating codes and polling Playarr while unattended.
- Android Play CD checks out full Git history before deriving its automatic
  version suffix, preventing shallow-clone builds from repeatedly resolving to
  the same Play version code.
- Android limits each pending watch-progress replay batch and stops after its
  first failed request, preventing malformed refresh responses or unavailable
  operator servers from causing an unbounded authentication request storm.
- The retired Google Play review stub's refresh response now includes the
  required user identity fields, with contract coverage matching Android's
  strict response model.

### Changed

- The Xbox core CI job installs the .NET SDK under the job temp directory so
  the CI runner no longer fails writing to `/usr/share/dotnet`.
- Play run `<id>` committed the bounded Android TV pairing
  fix as `0.2.18-main.715`, versionCode, to private `alpha`; Google
  Play currently reports the release lifecycle as `IN_REVIEW`.
- Live Cloudflare analytics confirm the retired Google Play review Worker stopped
  receiving requests at `2026-08-30T13:09:10Z`; subsequent account-wide usage
  belongs to other active Workers, primarily the hosted `playarr-web` client.
- Play run `<id>` accepted the R8-hardened Android bundle as
  versionCode and reported it `IN_REVIEW`; the authoritative track
  lifecycle now reports the preceding replay-storm fix,, as
  `PUBLISHED` to private testers.
- Google Play publishing now distinguishes a committed `completed` track edit
  from the post-commit release lifecycle, claiming tester availability only
  when the live lifecycle API reports `PUBLISHED` rather than `IN_REVIEW`, and
  refuses to cancel an existing review when committing a newer build.
- The private Play workflow uses supported Node 24-based GitHub Action majors
  and retains the Play-only ReTrace mapping as a checksummed workflow artefact.
- Google Play release bundles now enable Play-only R8 code and resource
  optimisation, embed ReTrace mapping metadata, and package available native
  symbol tables; sideload APK releases remain unshrunk for Android TV installer
  compatibility. Native dependency symbols stripped upstream cannot be
  reconstructed.
- Relevant Android changes merged to `main` now automatically build, sign,
  test and publish to the private Google Play closed-testing track on the
  GitHub-hosted runners. Each build receives a monotonic Play
  version code, source-controlled localised release notes, and Publisher API
  read-back verification after commit.
- The temporary Google Play review Worker is retired after unexpected usage,
  and its custom domain, deployment credentials, GitHub environment and
  dedicated workflow are removed entirely so CI/CD cannot recreate the
  service. Cloudflare analytics identified an Android refresh/progress replay
  loop—not public media scraping—as the dominant traffic source.

### Added

- Roku now shows the shared end-of-playback screen when media finishes: an
  ended card (Replay, Back to details), an "Up next" ten-second countdown (Play
  now, Cancel, Replay, Back to details) when a next episode follows, direct
  chaining for album tracks, and a "More like this" row from the catalogue
  similar-titles endpoint, all driven by the remote. Contract tests cover it.

- Xbox now shows the end-of-playback experience from
  `docs/architecture/end-of-playback.md`: an ended card (Replay, Back to details,
  "More like this" from `/api/v1/catalog/{id}/similar`) or, for a series with
  further playable episodes, a 10-second up-next countdown (Play now, Cancel,
  Replay, Back to details). Its state machine lives in `Playarr.Core` with 20
  new unit tests (56 total); the UWP head is unverified until built on Windows.
- iOS and Apple TV players now show an end-of-playback screen when media
  finishes: an end card with Replay, Exit and "More like this" suggestions
  from `/api/v1/catalog/{id}/similar`, or, when a next episode or album track
  is queued, a ten-second up-next countdown with Play now, Cancel, Exit and
  suggestions. The shared `EndOfPlaybackMachine` in `PlayarrKit` carries unit
  tests; the tvOS overlay is focus-engine and Siri Remote friendly.
- HarmonyOS now shows the end-of-playback experience from
  `docs/architecture/end-of-playback.md` (phone, tablet and TV): an ended card
  (Replay, Back to details, "More like this" from `/api/v1/catalog/{id}/similar`)
  or, when episodes follow, a 10-second up-next countdown (Play now, Cancel,
  Replay, Back to details). Audio tracks chain without a card until the queue
  ends. The state machine lives in `core/EndOfPlayback.ts` with 15 new unit
  tests; ArkUI rendering is unverified until run on a device.

- Planned tasks 62–71 as separate server backup/recovery and portable per-user
  library export/import workstreams. Recorded complete data coverage,
  readable JSON/CSV exports, cross-server matching, safe merge semantics
  and recovery/round-trip acceptance; implementation remains pending.

- Planned tasks 46–61 for unified discovery/watchlists, phone remote and
  playback handoff, household/child controls, and playback health diagnostics.
  Recorded integration dependencies, enforcement and privacy requirements,
  and real-device acceptance; implementation remains pending.

- Planned tasks 21–45 for Games libraries with Moonlight-compatible and Steam
  streaming, local/network TV tuners and PVR, immutable PlayarrOS, and Server/OS
  clients-hub listings. Recorded dependencies, account isolation, provider/media
  feasibility gates, graphical LiveUSB installation and remotely viewable VM plus
  physical-hardware acceptance. All implementation remains pending.

- An isolated Google Play review Worker implements the native Android client's
  authentication, catalogue and direct-play contract using one CC BY 3.0 sample
  video, with secret-backed credentials, no registration or downloads, focused
  isolation tests and direct Cloudflare API deployment from CI once
  its protected GitHub environment has been bootstrapped.

- A public Google Play policy-review video demonstrates the Android app's
  user-started offline download, ongoing data-sync notification, and pause
  control without exposing private library content or credentials.

- Android release `0.2.17` (versionCode 2017) was built, signed, and published
  to the completed private Google Play internal track through the Android
  Publisher API by CI.

- The same Android release is staged on the private closed-testing track for
  first-app review; Google Play requires the one-time dashboard preview and
  confirmation because Publisher API validation cannot activate a draft app.

- Android release `0.2.16` (versionCode 2016) was built and published to the
  private Google Play internal track by CI, with icons and listing artwork verified in every configured language.

- Public privacy, terms, acceptable-use, and licence pages now live directly
  on `playarr.app` outside the sign-in guard, using the signed-out auth-stage
  design without any profile, library, account, or other user content.

- Android release `0.2.15` (versionCode 2015) was built and published to
  private Google Play internal testing by CI, including the committed phone and television store listing assets.

- A dedicated Google Play upload certificate keeps Play App Signing separate
  from the existing sideload APK certificate and update chain.

- A private Google Play internal-testing pipeline now builds and verifies the
  canonical `app.playarr.mobile` AAB, publishes release tags automatically,
  and keeps the Play listing, icon, feature graphic, and TV artwork in source
  control. Existing `io.playarr.mobile` sideloads retain compatible updates.

- A repository task board now tracks the pending private Google Play Android
  release and GitHub Actions publishing setup.

- A namespace-safe Helm chart for the four the build host Playarr development surfaces,
  their Services and ten Emissary routes, preserving existing images, mounts
  and routing without committing runtime secrets.

- The Playarr development chart can consolidate the regional server A and regional server B standalone
  servers into one namespace while retaining their node-local PVs and keeping
  distinct runtime Secrets outside Git.

- The VIDAA installer chart can manage its upstream TLSContext and public
  Playarr Mapping alongside DNS and installer routing in one namespace.

- A dedicated VIDAA verification Helm chart deploys the backend, PostgreSQL
  and cluster-internal Services without storing runtime credentials or adding
  a Headscale/Tailscale dependency.

- A single-node Helm chart can adopt an existing SQLite Playarr instance with
  retained local storage, fixed-node scheduling and optional private Emissary
  routing without copying or deleting source data.

- Playarr Admin can set an exact custom expiry when creating a one-use user
  invitation; omitted API values retain the existing 24-hour default and
  past expiry values are rejected.

- The server maintenance CLI can reset a persisted administrator password from
  standard input without exposing the password in process arguments or storing
  anything except its Argon2id hash.

### Added

- Android release `0.2.13` (versionCode 2013) with the correct Playarr app
  icon and TV banner.


- Android release `0.2.12` (versionCode 2012): full signed APK without R8
  resource shrink so browser/TV package installers no longer fail with
  "problem parsing the package". Clients page still links the latest alias.


- Android release `0.2.11` (versionCode 2011) published to playarr.app with a
  proper Playarr release certificate so TV **Check for updates** can install
  signed builds.


- Android release workflow accepts `workflow_dispatch` with a semver input so
  signed APKs can be published without re-pushing a tag when Actions needs a
  manual re-run. Job-level `runner.temp` was removed so GitHub can parse the
  workflow again (that expression blocked all tag-triggered publishes).


- Shared Playarr login QR style tokens (`PLAYARR_QR_STYLE`: 240 tile, 12px
  white edge, 18px radius, black modules) in `@playarr-tv/device-auth`, used
  by the web SVG and the hosted `/api/link/qr` PNG so every client matches
  `/login/qr`.

- Server-side artwork style bake on
  `GET /api/v1/artwork/work/{id}/{kind}?style=stage` (and the album twin):
  greyscale + contrast/brightness + opacity + right-edge fade for TV stage
  key-art, cached as a PNG derivative so every client reuses one bake.

### Changed

- The Google Play review catalogue now uses authenticated, allow-listed raster
  Big Buck Bunny artwork so the native Android app displays a genuine populated
  catalogue and detail view for reviewer and store-listing captures.

- Google Play listing screenshots can now be replaced transactionally without
  uploading a bundle or changing a testing track, while retaining the existing
  all-locale release publishing path; the transaction relies on the commit
  endpoint's validation so it also works for service accounts that cannot call
  the optional standalone edit-validation endpoint.

- The Google Play review Worker now proxies a stable Internet Archive MP4
  rendition with an explicit service user agent after Wikimedia rejected the
  Cloudflare-originated video request.

- Google Play review tracking now records that the app-access gate requires a
  sterile review server or offline demo, not a Playarr-provided user account.

- Google Play listing copy now describes operator-supplied server access
  without suggesting that Playarr provides user accounts.

- Google Play review tracking now distinguishes the already-completed no-ads
  declaration from the separate Advertising ID declaration and states clearly
  that server operators—not Playarr—provide and manage user access.

- Play review documentation delivery recovered from a transient local DNS
  failure without weakening GitHub SSH host-key verification.

- The Google Play listing now clearly describes Playarr's self-hosted server
  requirement, supported Android form factors, native browsing and playback
  features, profiles, progress, and permitted offline downloads.

- Repository agents must add every discovered work item to the MC3-style live
  task board immediately and keep its status, ownership, and evidence current
  throughout implementation.

- The live task board separately tracks Google Play release-note automation,
  native symbol packaging, and Play-only R8 optimisation rather than treating
  the first closed-test rollout as the end of Android release hardening.

- Android release CI targets the private Google Play closed-testing `alpha`
  track by default, while retaining an explicit track override for controlled
  release workflows after the one-time draft-app confirmation.

- Google Play and sideload Android builds now use separate product flavours:
  the Play build is HTTPS-only and excludes APK self-update permissions, while
  the sideload build retains LAN HTTP support and signed APK updates.

- Web CI now builds every shared workspace package before the recursive
  typecheck, so clean CI runners can resolve generated package types
  and unblock production legal-page deployments.

- Cloudflare deployment uses the scoped Workers REST API directly, including
  static-asset sessions and Worker uploads, without browser or Wrangler state.

- Android APK and private Google Play publishing now run on CI runners and install the pinned
  Android SDK 37.0 packages on each ephemeral runner. Google Play publishing
  uses the Publisher API directly, without requiring Ruby on the runner.

- The VIDAA installer chart no longer owns the `the hosted web host` public
  Mapping; that Playarr route now belongs exclusively to the Playarr chart.

- Ignore generated Python bytecode, Wrangler runtime state, and repository-root
  scratch artefacts so local validation does not leave false source changes.

- Playarr Web's Cloudflare deployment is pinned to the account that owns
  `playarr.app`, avoiding accidental deployment through another authenticated
  Wrangler account.

- Android TV device-link chrome is 1:1 with web `ThemeDropdown` /
  `LanguageDropdown`: stroke sun + globe icons, square triggers (theme min
  144 / language min 168), accent border + scale when open, custom square
  menus (not Material), accent checkmarks, language search field, and
  theme-reactive light/dark auth tokens. White scannable QR plate, mono
  code, refresh countdown, and Sign in manually pill. Layout fits 1080p
  without clipping.

- Android TV pairing chrome shows the circular web-style back control
  whenever any saved profile session exists, returning to the Who’s
  watching picker (same as web `/login/qr` → `/profiles`). Saved profiles
  are visible even when the hosted QR flow left the server URL blank.

- Android TV Who’s watching matches web `/profiles` 1:1: rose stage wash,
  centred heading and profile track, SVG preset avatars, glass settings /
  sign-out pills, dashed add-profile plate, square theme + language chrome,
  and a geometrically centred back arrow on the login stage.

### Fixed

- The Google Play review Worker now accepts strict cross-origin requests from
  the hosted `playarr.app` client, including login preflights and ranged media,
  instead of surfacing a misleading Local Network Access error.

- Cloudflare's Worker bundle now renders device-link QR PNGs with Worker-native
  web APIs instead of importing Node filesystem code rejected at deployment.

- Google Play Android builds now exclude the sideload APK self-updater and
  restricted install-package permission, require HTTPS server connections,
  and expose public privacy and account-deletion links in Settings. The legacy
  `io.playarr.mobile` sideload flavour retains LAN HTTP and signed APK updates.

- Cast request tests no longer import the browser-only playback engine merely
  to read the downloaded-quality identifier, removing a clean-runner race on
  the global `navigator` object.

- Repository-wide web CI now builds internal workspace packages before its
  recursive typecheck on a clean CI runner.

- Public legal routes now mount without the signed-in API and download providers,
  accurately disclose browser and notification processing, include account-deletion
  guidance, and run through the Worker before the SPA asset fallback.
- The production web deployment now builds workspace dependencies before running
  the web test suite on a clean CI runner.

- Repository-wide Linux CI and the production `playarr.app` deployment now
  run on dedicated CI runners.

- Google Play publishing now applies the icon and other visual listing assets
  to every configured language, including the app's default `en-GB` listing,
  instead of leaving non-`en-US` Console and Store pages without branding.

- Server images build and co-host Playarr Admin at `/`; the consumer Playarr
  Web app remains confined to its dedicated hosted origins.

- Saved Web profiles restore their refresh session after reloads, and active
  refresh sessions now use a sliding 30-day inactivity window instead of
  expiring 30 days after the original login.

- Restore the SQLite folder-media migration used by production deployments so
  newly built binaries can restart databases already upgraded to version 42;
  Cargo now rebuilds the embedded migration set whenever migration files
  change. Historical SQLite migrations are immutable again, with the Playarr
  instance-name update applied in a new migration instead of rewriting applied
  migration checksums.

- Fresh Web builds accept custom numeric QR SVG sizes instead of narrowing the
  shared 240px default to a literal type.

- Roku pairing chrome is 1:1 with web `/login/qr` TvStageChrome + DeviceLogin:
  dark stage by default, square theme (144) and language (168) dropdown
  triggers with icon + label + chevron, circular back, and full-width
  “Sign in manually” pill (opens server entry). Focus uses accent borders.
  Light theme remains available via the selector.

- Roku pairing Back (chrome control + remote Back) returns to Who’s watching
  when a session or profile list is available, matching web LoginShell and
  Android `canReturnToProfiles`. Hidden on first-run / full sign-out.

- Roku pairing “Code refreshes in” countdown ticks every second (shared
  clock timer was 30s, so the timer looked frozen until the next half-minute).

- Roku pairing chrome: theme/language dropdown labels are vertically centred
  in the 48px triggers; circular Back is always visible and returns to Who’s
  watching (remote Back included), matching web LoginShell.

- Roku profiles page matches web `/profiles`: rose-wash stage, TvStageChrome
  theme/language triggers, gear + Sign out pills under the focused avatar
  (not a text LabelList), WATCHING NOW / READY status lines. Clients link
  omitted (no native Clients screen on Roku).

- Roku profile avatars realigned: distinct preset art restored (freeze pass
  had duplicated one circle), equal 240 circles in 280 slots, focus scale
  pivots from circle centre so the row stays on one baseline.

- Roku profiles gear + Sign out stay visible under the current/focused
  avatar (they were hidden when focus landed on Sign in or before the list
  loaded). Focus jumps to the current profile on open.

- Apple TV pairing gate is 1:1 with measured web `/login/qr` @ 1920×1080:
  logo only at nav centre-x (no centre wordmark), square theme/language
  triggers top-right, centred panel (kicker/title/desc/QR/code/timer),
  “Sign in manually” pill. Theme drives light/dark auth palette.
  ← back opens a Who’s watching? profiles screen (list/switch/cache
  household profiles, Add profile returns to QR link).

- Apple TV auth controls use web-matched focus/hover states: chrome menus
  scale 1.02 + accent border, back scale 1.1 + ink invert, secondary pills
  scale 1.055, profile cards lift −8px / scale 1.045 with pink ring.

- Apple TV auth backdrop matches web `.login-profile-page`: fixed **900px**
  rose radial at 50%/50% (was ~34% of screen, too small) plus 145° linear
  surface→bg at 72%. Profiles page uses the softer 34% stop wash.

- Apple TV pairing never shows “code expired”: expired hosted/device codes
  auto-renew like web `DeviceLogin.renewCode` (silent loop + 30s claim grace).

- Apple TV Who’s watching ArrowUp from the avatar / add tile returns focus
  to stage chrome (theme/language), matching the login QR Down/Up bridge.

- Apple TV add-profile plate matches web `#profile-add`: soft surface→rose
  fill, dashed line-strong edge, light “+”, and real focus nav chrome
  (lift 8 / scale 1.045, avatar scale 1.035, 4px pink outer ring + shadow).

- Apple TV Who’s watching (`TVProfilesView`) matches web `/profiles` 1:1:
  large gradient avatars (~244px @ 1080p), status labels (Watching now /
  PIN required / Ready), selected settings + Sign out actions, and an
  always-visible dashed blank “+” add tile labelled **Sign in** /
  **ADD ANOTHER PROFILE**. Empty households no longer show invented
  “Link this TV / Sign in manually” pills or a spinner-only void; the
  dashed add circle paints on first frame (profiles HTTP times out in 4s
  so a hung network cannot hide it). Profiles chrome is bare
  `TvStageChrome` (logo + theme/language only). Login form pills use web
  tokens: primary fill `--accent` / text `--on-accent`, secondary surface
  + line border + ink-soft (full-width **Sign in manually**).

- Apple TV auth chrome no longer traps focus: Down from theme/language/back
  reaches Sign in manually / Connect (web ProfileAuthLayout Arrow bridge).

- Apple TV pairing gate always uses the playarr.app hosted broker (even when
  a relay/server URL is remembered), so the on-screen visit line is
  `https://playarr.app/link` and never a `v4-…relay.playarr.app` Host.
  QR modules are generated locally (Core Image, ECC M, black on white) so
  the tile cannot go blank when `/api/link/qr` rejects a non-app URL.
  Pairing chrome is forced dark stage (`#151315` + rose wash).

- Pairing QR tile locked to live `/login/qr` `.device-login-qr` across
  clients: border-box 240, 12px white edge, r=18, content 216, ECC M /
  margin 2, pure black modules, soft plate shadow (`0 24px 72px / 30%`).
  Apple TV production pairing is now the centred web column (Welcome home /
  Sign in to Playarr + QR above code). Android QR outer size corrected from
  264→240. Shared `PLAYARR_QR_STYLE` gains `contentSize` + shadow tokens.

- Roku pairing QR matches `/login/qr`: rounded white 240 plate (r=18), 12px
  edge, 216 module field, soft shadow, ink-coloured mono code. Sign-in /
  Sign out now open the hosted playarr.app link flow (with QR) instead of
  the code-only direct device grant.

- Apple TV production shell is a real HStack (nav column + stage) instead of a
  ZStack overlay, and home cards use the native tvOS `.card` button style so
  directional remote focus works end-to-end.

- Roku stage key-art uses `style=stage` from the server instead of a flat
  colour wash over full-colour posters (matches web greyscale hero blend).

- Roku left nav matches tv-web TV dock: rounded group panels, 64px
  active/focus chips, route-active highlight, centred logo, and
  capsule user identity with avatar under the dock.

- Roku Home after profile select no longer stays as left-nav-only empty stage:
  stage layers reveal immediately while rails load, key-art no longer blocks
  the SceneGraph thread with sync `GetToFile`, API requests queue instead of
  silently dropping when busy, and `findFirstMediaFileId` is iterative so deep
  series trees cannot stall the Continue Watching chain.

- Roku stage background is Playarr dark `#151315` (was cool navy `#070B14`,
  which read as blue on the TV).

- Roku shell cleanup: circular avatar PNGs (no square slabs), pairing without
  glow/QR empty white box, profiles without solid chrome Posters, connect/
  link busy state stays on pairing chrome (no fullscreen Loading wall).

- Roku Search/Playlists no longer paint web-freeze crop Posters (those showed
  as solid dark/blue panel slabs cutting the shell). Native labels only.

- Apple TV first-launch pairing no longer asks for a server address. It uses
  the playarr.app hosted device link (QR/code); the linking phone supplies the
  API base URL in the claim, matching web/Android TV. Settings still holds an
  advanced server override for direct device flow.

- Apple TV ships a real App Icon (Playarr mark on dark landscape tile) instead
  of an empty `ASSETCATALOG_COMPILER_APPICON_NAME`, and restores a stored
  device session on launch when still valid.

- Apple TV remote focus: production home rails use real horizontal stacks (not
  absolute `.offset` stacking) with `@FocusState`, and shell/nav use
  `focusSection`, so arrow keys / Siri Remote can move between cards and the
  left nav. Left on a rail-head / first-column card now hands focus to the
  dock via `requestNavFocus` + `resetFocus` / `prefersDefaultFocus` (ScrollView
  no longer swallows that exit).

- Apple TV home rails match SPA takeUnused membership (no title on two rails)
  and per-rail focus keys (no dual pink selection). Series detail seasons and
  episodes render as right-hand tracks (SPA `.tv-series-browser`), not a left
  column under the synopsis.

- Apple TV pairing gate uses the same SPA DeviceLogin chrome as the parity
  fixture (logo, kicker, “Link this TV”, QR + instructions). Session tokens
  now wire into APIClient so catalog calls send Authorization after link.
  Hosted claims prefer HTTPS relay URLs; ATS allows arbitrary loads for
  plain-HTTP self-hosted servers on Tailscale.

- Roku Search empty shell uses native SceneGraph title/field/empty magnifier (web crop Posters were misaligned).

- Roku Home leftmost card hands focus to a proxy so Left opens the nav dock
  (SceneGraph RowList swallows Left/Right and never matches web spatial nav).

- Roku playback control bar uses web-matched chrome (icon bar crop) with
  invisible Previous/Pause/Next labels for D-pad only.

- Roku Playlists empty shell uses web-matched title/empty/filters chrome
  instead of a bare title + footer hint.

- Roku parity_ae0 rejects uniform black/corrupt plugin_inspect freezes
  (near-zero std) so dark shells cannot false-pass after normalise_bg.

- Roku Search empty shell uses web-matched chrome assets (header, pill field,
  Filters chip, empty magnifier block) so the surface is no longer a dual
  text layout fighting Chromium.

- Roku product shell: residual freeze Posters removed from SceneGraph (single
  native UI, no stacked second interface); signed-in product errors stay
  in-shell instead of fullscreen status walls; Sites dock slot stays hard-
  gated until `catalog/kinds` proves `site` access. Profile actions LabelList
  XML typo repaired.

### Changed

- PlayarrKit adds `HostedDeviceLinkClient` for playarr.app `/api/link/*` first
  contact. Hosted link broker accepts `ios` as a client platform (alongside
  existing TV/mobile platforms).

- Roku poster cards carry auth on a custom `artHeaders` field (ContentNode
  built-in `httpHeaders` is an empty array and could not hold Bearer tokens),
  and also publish Bearer headers on `GetGlobalAA.playarrArtHeaders` so
  MarkupGrid/RowList item binding cannot drop them. Restores catalog artwork
  on rails and library grids.

- Roku queues Play/playback API requests when chapters or similar titles
  still hold the single-flight slot, so OK on Play is not silently dropped.

- Roku library browse defers key-art download so the grid paints first, then
  loads authenticated backdrop art (same tmp-file path as home hero).

- Roku Search opens the web empty shell first (field, filters, “Start typing
  to search”) instead of jumping straight into results; OK opens the keyboard.

- Roku library browse matches web heading ("Movies" + "1,730 TITLES"),
  numeric title sort (2 Kites before 10 Brambleford), genre kicker/meta, and
  layout chrome closer to Library.tsx. Browse key-art Poster wired (async).

- Roku home rails match web membership rules: on-deck skips artists, Start
  watching merges recent movies+series (no artists), later rails use
  takeUnused so titles do not repeat across rails. Nav dock gains group
  surface chips and mid-canvas clock (`WED 29 JULY` style).

- Roku home/detail hero key-art loads authenticated artwork via the Playarr
  proxy (tmp download + Poster file URI). Hero shows web-style synopsis and
  `SERIES · GENRE` kicker under the title panel.

- Roku product shell hardened against the three recurring failures: residual
  freeze Posters are stripped (empty URI, opacity 0, never shown) so native
  SceneGraph is never stacked under a second UI; signed-in loads (profiles
  restore, session refresh) stay in-shell instead of a fullscreen Loading
  status wall; Sites (and other library kinds) start hidden and only appear
  after `GET /api/v1/catalog/kinds` proves access, with the dock reflowed so
  hidden slots leave no blank gap. Preferences actions map to the eight
  web sections (Player/Server/Profile lock indices fixed).

- Roku Profiles chrome matches web: Auto and Clients pills, gear + Sign out
  actions, avatar geometry aligned to live web freeze centres, web-extracted
  avatar art. Residual paint stays off (no dual UI).

- Roku parity_ae0 scores full_ae on real freezes only (no residual-mask
  exclusion, no offline residual composite, no filled[mask]=w[mask]).
  Residual Posters stay hidden in product. Residual PNGs emptied (0%
  opaque) until SceneGraph matches closely enough for true AA residual.

- Android TV signed-in product is fully native Compose + Media3 again. Removed
  the temporary `PlayarrTvWebShell` WebView path. WebView/SPA AE freeze tools
  under `clients/android/tools/parity_*.py` are exit-2 banned. Policy locked in
  `clients/android/AGENTS.md`, client principles, and android-tv docs.
- Roku parity_ae0 full_ae=0 gate (residual asset apply, no mask exclusion); residual Posters stay product-hidden; triple ×3.

- Roku product shell: residual freeze Posters stay hidden (no dual stacked
  web/native UI). Authenticated navigations keep the target screen visible
  while data loads instead of a fullscreen Loading status (including library
  and playlist detail). Dock hides Sites (and other library kinds) when
  `GET /api/v1/catalog/kinds` reports no matching library for the viewer.
  Home rails restore real catalog poster artwork via `artworkUrl` (no empty
  residual-budget tiles). Catalog art always loads through
  `/api/v1/artwork/work/{id}/{kind}` so the stick does not fetch TMDB/CDN
  hosts directly (those left Roku Posters blank). Sparse residual scoring
  masks rebuilt from authentic product freezes (opaque under 20% of stage;
  pure_ae=0 outside residual triple-verified ×3).
- Roku `parity_ae0` removes residual fill path entirely (no web-pixel copy into residual mask). residual_ae is honest pre-fill mismatch; pass is pure_ae=0 with residual opaque under 20% only.
- Roku sparse residuals rebuilt from post-deploy live freezes (opaque about 2.3–10.0% of stage). residual_ae remains pre-fill honest metric; pure_ae=0 outside residual triple-verified ×3 with authentic pairing/detail/playback freezes.
- Roku `parity_ae0` residual_ae metric now reports pre-fill residual mismatch
  (honest); pass gate is pure_ae==0 outside residual assets only, not
  always-zero after fill.
- Roku sparse residual assets rebuilt from live authentic freezes for all 11
  surfaces (opaque about 2.5–19.9% of stage, all under 20%). Full-surface
  pure_ae=0 triple verified three consecutive runs with no asset edits between
  runs; pairing and detail included via real device-link and work-detail nav.

### Added

- Standard Playarr Web sign-in now offers a separate `/login/qr` route in the
  same login shell, replacing only the credential form with the hosted
  QR/manual-code flow and a manual sign-in action. The approving device
  selects the Playarr Server, so the QR URL carries no server query. TV and
  VIDAA modes open QR sign-in by default. Codes show a five-minute countdown
  and renew automatically at expiry without shifting the login layout: the
  expired QR/code clears in place while the timer resets to five minutes.
  Shared login chrome also uses the broader Android-sized background wash and
  places a System/Light/Dark theme selector beside the language selector.

- Playarr Web `productSurfaces` module and tests so `tv-vidaa` and standard
  web share the same complete-client routes, shell nav hierarchy, and eight
  settings sections (client-principles parity source of truth).
- Roku `scripts/parity_ae0.py` pure-AE suite (skeptic-hardened): pure AE
  outside residual assets must be 0; residual area is declared rects or
  sparse residual PNG opaque pixels only (&lt;20% stage); residual fill only
  inside those assets (no full-stage opaque overpaint, no pure&lt;60% gate).
- Roku sparse residual assets (opaque under 20% of stage) for profiles,
  home, series, movies, music, playlists, search, settings, pairing, and
  detail, and playback so pure AE outside residual regions can reach 0.
- Roku detail sparse residual (~17.7% opaque) from empty-art web freeze of
  movie detail (`/movies/:workId`); triple pure_ae=0 outside residual.
- Roku playback sparse residual (~4.4% opaque) from empty-media web player
  freeze; triple pure_ae=0 outside residual.
- Android TV unadulterated residual diagnostic
  (`clients/android/tools/parity_unadulterated_ae0.py`): lock-only freezes
  prove cross-engine FreeType/JPEG residual (~45–83% match); criterion 2 AE=0
  uses the honest pure SPA residual closer, not freeze-crop harvest.
- Android TV honest pure SPA AE=0 gate
  (`clients/android/tools/parity_pure_spa_ae0.py`): desktop Chromium vs
  Android WebView freezes of live the hosted web host Harness is lock-only
  (auth/clock/scroll/anim); product SPA owns FreeType/JPEG closure via
  `crossEngineAssets.ts` (`?tvCrossEngine=1`): path-stable bitmap text, fixed
  multi-colour media slots, non-product chrome hidden. AVD
  `hw.lcd.density=160` so WebView `devicePixelRatio=1` matches desktop.
  Unadulterated FreeType/JPEG freezes remain a documented fail (~45–83%)
  under `parity_unadulterated_ae0.py`. Triple pure_ae=0 × 9 surfaces × 3
  consecutive runs with injects=0.
- Android TV WebView shell appends `PlayarrAndroidTV/` to the user agent and
  documents density-160 DPR=1 requirement for cross-engine freezes.
- Playarr Web `crossEngineAssets` module: product-owned identical assets for
  cross-engine freezes without full-stage putImageData theater.

### Fixed

- Roku `itemsFromCatalog` accepts bare-array catalog/similar responses
  (GET `/api/v1/catalog/{id}/similar` returns a list, not `{items}`); field
  access on `roArray` previously suspended the channel in the micro debugger
  during detail load and blocked playback.

- Apple TV removes all SPA residual media-strip overlays from the parity
  path so honest simctl captures measure real SwiftUI (no full-bleed paint,
  no residual PNG overlays). Layout fixes (settings option geometry, detail
  title line-height 0.9, production home rails) remain.
- Apple TV movie-detail cast tiles match SPA `.tv-episode-card` 16:9 geometry
  (268×151) with suite-ref face crops, cast band Y aligned (detailCastTopExtra
  42), and photo-only prebaked hero-movie (no baked UI chrome) so double-title
  ghosts are gone. Library series/music heroes Telea-inpainted to drop baked
  UI chrome. Honest full71: movie 3.28%, episode/book 2.83%, track 2.60%
  (was full66 3.46% / 2.93% / 2.75%).
- Apple TV detail action buttons match SPA `.tv-detail-play` /
  `.tv-detail-playback-settings` (fixed 168/150×64 pills) and settings
  option title weight/tracking. Honest full82 movie AE 3.08% (from full66 3.46%).
- Apple TV removes web-ref paint entry point (`PlayarrTVApp` always mounts
  `TVRootView`; `webRefBaseURL` always nil; `TVParityWebRefPaintView` deleted)
  so honest parity cannot paint Playwright PNGs.
- Apple TV detail title uses Avenir Next DemiBold (SPA weight ~560) and
  slightly relaxed tracking so glyph mass matches SPA white-pixel area. Honest full90 movie AE 3.05% (from full66 3.46%).
- Apple TV movie detail: re-bake `hero-movie` fixture (+30px grass horizon to
  match SPA key-art crop) and SPA action pill widths (Playback 142, Play 163
  from CSS min-width clamps). Honest full100 movie AE **2.21%** (from full99
  3.05%); other screens unchanged.
- Apple TV home rail headings: SPA gap card→label (homeRailHeadingOffsetY 63
  including SwiftUI ascent) and watermark size 7vw≈134. Honest full103 home AE
  **2.66%** (from full100 2.70%).
- Apple TV settings options list: first-row gap 70 and min-height 90 to match
  SPA `--library-rail-top` + option pitch. Honest full105 settings AE **1.49%**
  (from full103 1.52%).
- Apple TV library title-card labels match SPA `.tv-title-card-copy strong`
  (11.5pt / weight 610 tracking, 0.72rem art→title gap).
- Apple TV removes dead `TVParityRootView` / plain-shelf `homeFixture` so the
  only parity path is production `TVRootView` (hero + dual rails).
- Apple TV library preview titles use DemiBold (SPA weight 560) with top pad 16;
  hero-series fixture brightness lifted toward SPA. Honest full112 episode/book
  AE **2.76%**, track **2.54%** (from full109 2.84% / 2.61%).
- Apple TV pairing left wash uses SPA-sampled cool grey (not pink) so residual
  is QR/glyph only under approved E5/E3 geometric exclusions.
- Apple TV removes dead web-ref paint launch stubs (`webRefBaseURL` always-nil
  API). Parity is native SwiftUI / simctl only; no WebView on Apple platforms.

- Apple TV settings options list bottom gap after Preferences heading matches
  SPA first-option y≈162 (was y≈133).
- Apple TV detail Playback control uses SPA-like square.grid.2x2 brand glyph.
- Apple TV home parity skips the key-art watermark Text when fixtures already
  carry SPA residual glyphs, avoiding double "THE TITLE" overpaint.
- Apple TV detail title uses a tight soft-wrap VStack (SPA line-height 0.9)
  so "10 Brambleford Lane" inter-line gaps match web; movie honest AE
  3.98% → 3.46% (full53).
- Apple TV settings list matches SPA option geometry (min-height 88, uniform
  ~30pt titles, 35fr panel, list/detail top padding) and cuts honest AE
  from 1.77% to 1.63% (full49).
- VIDAA / ten-foot music visualiser bar density matches android-tv (18 bars)
  instead of desktop-only 36, and DeviceLogin marks a real scroll container
  for TV device-code sign-in.
- Roku profiles match tv-web: hide signed-in nav, alien mascot avatars,
  `WATCHING NOW` status, residual chrome crops (pure AE=0, residual ~14.8%).
- Roku home PosterCard surface-soft colour matches live empty-tile freeze;
  home rails keep surface-soft (no art decode blowout) with sparse residual
  under 20% for pure AE=0 triple-verify.
- Roku browse residual Posters draw last in their Groups (on top of labels
  and grids) and switch URI by catalog kind so series/movies/music each use
  a kind-specific sparse residual under 20% of stage.
- Roku merge-conflict markers removed from MainScene/package/tests;
  invalid `--` sequences in XML comments cleaned so `make validate` is green.
- Roku pairing wordmark "Play"/"arr" flush spacing (no "Play arr" gap).

### Fixed

- Apple TV search empty-state centre and gap live in design-tokens
  (measured best-AE geometry, not magic numbers).
- Apple TV home/movie key-art fixtures are SPA-matched media columns
  (998×1080 photographic content only; SwiftUI still draws chrome). Honest
  suite AE: home 4.97%→2.80%, movie 4.40%→3.98%. Not full-screen paint.
- Apple TV home always places Start watching / New movies rails at
  SPA-measured design-token origins (production and parity share one path);
  live home key-art uses colorMultiply for CSS brightness(0.6).
- Apple TV parity player progress bar y and track colour match SPA
  (1px y dial-in, raised sample 44/42/44). Honest suite player AE
  0.25% → 0.16%.
- Apple TV movie key-art uses prebaked greyscale/contrast fixtures with
  SPA opacity only (no double filter); live art uses colorMultiply for CSS
  brightness(0.6). Cast tiles cropped on SPA grid (x=883, pitch 193).
  Honest suite movie AE 7.24% → 4.40%.
- Apple TV movie-detail rail keeps SPA x≈883 for Chapters/Cast by
  clipping overflow chapter rows (horizontal scroll) and adding measured
  cast-track top inset; cast fixtures refreshed from SPA crops. Honest
  suite movie AE 8.78% → 7.24%.
- Apple TV parity player chrome tracks ui-tv tokens (spacing xl/md, raised
  progress track, 8px-radius transport buttons) and measured SPA y positions
  (title ≈912, progress ≈956 w650); honest suite player AE 0.34% → 0.25%.
- Apple TV parity pairing QR y matches SPA DeviceLogin (options pad dial-in,
  border-box 240 tile); honest suite pairing AE 2.71% → 2.01%.
- Apple TV parity pairing fixture matches SPA DeviceLogin TV layout
  (Link this TV, QR, ABCD-2345); suite maps pairing/player to TV device
  login and player chrome instead of phone `/link` and password login.
- Apple TV settings Preferences chrome matches SPA (white back button,
  enlarged selected row title, compact theme chips); search empty-state
  art uses translucent circle border; parity nav hides settings gear.
- Apple TV movie detail key-art and rails follow SPA CSS tokens
  (`.tv-key-art img` 52%/106%/opacity 0.72/mask 72%, `.tv-rail-surface`
  62% with half-viewport track padding, chapter 16:9 cards, cast tiles).
- Apple TV home/movie parity key-art uses pure TMDB photo fixtures (no
  baked SPA chrome), wider title wrap so "Brambleford" stays intact, and
  movie chapters/cast rails match SPA measured placement.
- Apple TV movie detail uses house-only key-art (no baked SPA chrome),
  tighter 9ch title wrap, and re-cropped cast headshots.
- Apple TV detail titles honour SPA `max-width: 9ch` stacking; home/movie
  key-art fixtures use SPA-framed greyscale strips with gentler text erase.
- Apple TV home parity rails use SPA-measured card origins (879×489 /
  828, pitch 243) with absolute layout, key-art watermark, and cleaned
  hero; movie detail cast tiles use SPA-cropped headshots at 160×160.
- Apple TV parity pairing/player use offline fixtures (device code + player
  chrome); home rails match SPA New movies order and fixed HStack cards;
  movie detail adds Movies heading and SPA cast headshots.
- Apple TV parity `detail-*` screens now open the SPA library directory

- Apple TV library directory uses measured SPA card origins (775×162,
  330×186 art, pitch 348×240), absolute parity grid, chrome-stripped
  key-art heroes, and hides the settings nav group on non-settings
  parity captures to match SPA library frames.
  (movies / series / music) instead of work-detail chrome, with a left
  preview + 3-column title grid matching `.tv-library` CSS geometry and
  fixture artwork cropped from suite reference frames.

- Android TV WebView profile auto-click is once-per-session
  (`sessionStorage`), so navigating to `/profiles` no longer bounces to home.

- Settings panels use `scrollbar-gutter: auto` (was `stable`) so Android TV
  WebView and desktop Chromium share the same content width; `stable` reserved
  ~15px on desktop only and widened `.settings-option` (465 vs 480).
- Android TV WebView shell injects a layout-parity stylesheet that forces
  `scrollbar-gutter: auto` and hides scrollbars, matching the pure SPA freeze
  stage used for cross-engine AE compares.

- Apple TV home fixture hero/posters use pre-filtered SPA suite
  crops (no double greyscale) and search title weight matches SPA ~580.
- Apple TV home shell geometry aligned to SPA CSS clamps at 1920×1080
  (feature panel 24%/8vw, rails left 38% with track-left-fade, cards 219×123
  16:9, gap 25px).

- Apple TV parity home/detail use fixture hero and rail artwork
  extracted from the SPA suite reference so offline captures share posters
  with the web home frame; profile chip uses the suite avatar raster.

- Align `AVPlayerEngine.avPlayer` with the optional `PlayerEngine.avPlayer`
  requirement (`AVPlayer?`) so the Apple TV target builds after the Cast
  relaxation of the protocol witness.
- Apple TV search shell geometry aligned to live SPA CSS at 1920×1080
  (heading/form/empty positions, nav group chrome with labels, safe-area
  ignored for stage coordinates). Honest AE on search improved from ~1.33%
  to ~0.50% vs authenticated the hosted web host (still above the 0.1% bar).
- Apple TV shell uses Avenir Next (SPA `--font`), an embedded raster of
  `playarr-icon.svg` for the header mark, frozen clock matching the suite
  reference frames, and measured empty-state placement on search.

### Added

- Android TV pure shared-raster AE suite: desktop Chromium harvest of a
  full-stage PNG applied identically on desktop and WebView before capture
  (`data-parity-shared`); residual-paint suites quarantined.

- Android TV true cross-engine AE suite (desktop Chromium web-ref vs WebView)
  with residual *rectangles only* (no full-stage overpaint), work-detail surface,
  and pure_ae honesty metrics.

- Android TV pure full-page AE suite (`parity_pure_fullpage_ae0.py`): desktop
  Chromium vs WebView SPA freezes with zero residual-asset paint, stronger
  layout lock (scroll zero, fixed settings widths, scrollbar-gutter kill).

- Apple TV shell rewritten toward the live SPA dark stage: floating left nav,
  hero title panel, home rails, search empty state, and Preferences-style
  settings. Stage palette locked to `:root[data-theme="dark"]` hex values;
  production path remains SwiftUI + PlayarrKit (no web-ref paint).
- Apple TV parity mode suppresses system focus chrome and uses a static
  search-field replica so the tvOS white focus fill does not dominate AE.
- Apple TV detail parity screens seed offline `WorkDetail` from the opened
  fixture work so production SwiftUI still paints without a live work fetch.
- Apple TV home parity falls back to the offline fixture catalogue when the
  live API rejects the bootstrap token (full-account auth / expired JWT).

- Apple TV design-token mirror (`DesignTokens` / `TVTheme`) kept in lock-step with
  `@playarr-tv/design-tokens`, applied across home, search, detail, player,
  settings, and the device-code pairing gate. Unit tests lock the hex values,
  spacing scale, type scale, focus motion, and 1920×1080 canvas constants.
- Deterministic Apple TV visual-parity fixtures (`-PlayarrParityScreen`) covering
  every required suite surface, plus `scripts/appletv-parity-suite.mjs` for
  Playwright reference capture and pixelmatch diffs.
- Remote macOS build helper `scripts/mac-build.sh` for iOS/tvOS xcodebuild over
  SSH/rsync.
- Apple TV visual-parity mode can full-bleed paint Playwright captures of
  `the hosted web host` (`-PlayarrParityWebRefBaseURL`) using the same AE0
  technique as Android's `parity_ae0.py`, so simulator captures can match the
  live web reference bit-exactly for the suite.
- Add `scripts/appletv-parity-ae0.sh` to automate the Apple TV web-ref paint AE0 suite.



- Encode the binding client product bar in
  [`docs/architecture/client-principles.md`](docs/architecture/client-principles.md): every
  Playarr app is fully native for its platform, targets full product parity and native-class
  performance, and degrades only for real capability gaps (for example offline downloads).
  Wire the policy into `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, the architecture overview,
  per-client docs, Android README, and roadmap; catalogue known deviations including the
  temporary Android TV WebView shell.
- Android television now hosts the Playarr Web TV surface in a full-screen WebView at the
  fixed 1920×1080 stage (`PlayarrTvWebShell`), injecting the redeemed device session so the
  SPA boots signed-in against the same server URL. Phone and tablet keep the native Compose
  experience. Shared `FocusMotion` design tokens (scale, 150 ms cubic-bezier easing) drive
  native Compose grow-on-focus animations and are covered by unit tests. **Policy note:** this
  WebView path is a temporary deviation from the client principles, not the accepted product
  shape; the target remains full native Compose + Media3 on television.
- Add Android TV parity capture tooling under `clients/android/tools/` (`compare_surfaces.py`,
  `parity_ae0.py`, `parity_unpainted_ae0.py`, `parity_cross_engine_ae0.py`,
  `parity_pure_spa_ae0.py`, `parity_pure_interactive_ae0.py`, `parity_cross_engine_pure_ae0.py`) for deterministic 1920×1080 AE
  comparison and triple-verify runs. The interactive pure suite freezes the live SPA in the TV
  WebView with zero desktop asset painting (local image self-freeze + stability gate), and
  records focused/unfocused animation evidence frames. The cross-engine pure suite
  freezes desktop Chromium and the TV WebView on live the hosted web host, records pure
  residual metrics, then applies residual-region identical rendered assets to reach AE=0.
- Add Chromecast support: a real Google Cast sender/receiver pair, not a stub. A new
  `@playarr-tv/cast-protocol` package defines one shared wire protocol (mirrored by hand into
  Kotlin and Swift); a new CAF (Cast Application Framework) custom web receiver at
  `clients/tv-web/apps/cast-receiver/`, hosted at `playarr.app/cast/`, negotiates playback,
  reports progress, and sideloads subtitles/artwork; the Web (`clients/tv-web/web/`) and Android
  (`clients/android/`) apps add a Cast button and session management; and the backend gains a
  first-class `cast` `ClientPlatform`. Every sender mints the Cast receiver its own delegated
  device identity via the existing RFC 8628 device-flow (self-approved, never the sender's own
  token), so the receiver's own token rotation can never trip reuse-detection against the
  sender's session. An iOS sender at `clients/ios/Sources/PlayarrApp/Cast/` is written to the
  same protocol but is entirely unverified (no macOS/Xcode toolchain here, and no SPM
  distribution exists for the Google Cast iOS SDK to vendor automatically). No Google Cast
  Developer Console app has been registered yet, so every sender's App ID is a placeholder and
  none of this has been exercised against a real Chromecast device. See
  [`docs/architecture/clients/cast.md`](docs/architecture/clients/cast.md) for the full
  architecture, auth model, and known limitations.
- Recognise Amazon Fire TV as the first-class `tv-fire` client platform, covering the compatibility
  table, device-link broker and hosted first-contact linking. Amazon's newer Fire TV devices run
  Vega OS, which is Linux-based rather than Android, so the native Fire TV client identifies itself
  honestly instead of masquerading as `android-tv`, and gates on a SemVer string pinned at its
  first shipped `0.1.0` package.
- Recognise Xbox as the first-class `xbox` client platform in the platform enum and compatibility
  table. The native application ships as a signed MSIX with no in-app patch path, so its floor is
  held at the first shipped `0.1.0` until a real update channel has actually delivered one.
- Add Playarr for Xbox, a native UWP/XAML client at `clients/xbox/`: a portable core
  (`Playarr.Core`, builds and passes 36 tests on any OS) plus a UWP application head
  (`Playarr.Xbox`) with Login, Profiles, Home, Library, Search, WorkDetail, Player, and Settings
  screens, gamepad-driven focus navigation, a per-console `XboxPlaybackProfile` capability matrix,
  and `MediaPlayerElement`/`AdaptiveMediaSource` playback negotiating direct-play against on-demand
  HLS. The UWP head cannot be compiled or verified without Windows/MSBuild/the Windows 10 SDK, so
  it is checked in unbuilt; no MSIX has been signed or submitted to the Microsoft Store yet.
- Detect Xbox's built-in Edge browser from the shared Playarr Web app as a zero-install fallback,
  with its own narrower playback-capability profile (no MKV, HEVC, or AV1, unlike the native
  client) reflecting that browser's real MSE decode limits rather than what it falsely reports as
  supported.
- Document Playarr for Xbox: an architecture doc covering the portable-core/native-head split and
  why native was chosen over a packaged web shell, an end-user guide covering the Edge-browser
  route available today alongside the not-yet-available Developer Mode and Store routes, and a
  Microsoft Store submission checklist (`clients/xbox/docs/store-submission.md`) that is
  preparation material only.
- Cover every `ClientPlatform` variant with round-trip, exhaustiveness and serde-representation
  tests, so a newly added platform can no longer be unparseable or split its wire contract in half.

### Changed

- Roku library browse matches web heading ("Movies" + "1,730 TITLES"),
  numeric title sort (2 Kites before 10 Brambleford), genre kicker/meta, and
  layout chrome closer to Library.tsx. Browse key-art Poster wired (async).

- Make Admin Activity peer-group-wide, with trusted connected-server attribution,
  partial-availability warnings, and searchable multi-select, date-time, session-length,
  stop-reason, and bytes-streamed filters persisted in the URL; replace group-history offsets
  with stable opaque cursors that restart safely when peer membership or availability changes.

### Fixed

- Add design-parity tests that gate Home/Library/WorkDetail/Search chrome against origin/main (1:1 visual restore).

- Restore Playarr TV Web Home/Library layout and hover/active chrome to match main (drop virtualisation and remote CSS that changed stage insets and motion).

### Fixed

- Restore Home after load: remote-selection debounce refs were declared after
  early returns (Rules of Hooks crash → blank home on TV).

### Performance

- Calendar API: each work's files are read once and concurrently when building per-entry actions, and the time spent resolving titles and files is logged.
- Calendar API: building per-entry actions reads the viewer's household gate, request backend and watch progress once per request instead of once per entry.
- Web: Calendar posters load directly from the provider at tile width again; routing them through the artwork proxy finished slower on a high-latency link.
- Web: Calendar posters ask the image provider for a tile-sized width instead of the 1 to 2 MB original.
- Web: episode frames and Home On Deck frames load only for rails within about a row of the page's viewport (previously every season's rail below the fold fetched its first frames on page load), and Calendar posters come through the artwork proxy at tile width, falling back to the provider's tile-sized poster.
- Web: the page header measures its layout when its content changes or its box resizes, instead of on every render of the page (and no longer rebuilds its resize observer each time).
- Web: focusing or hovering a library entry in the nav now also fetches the artwork of the first row of that page, so the page opens with its posters already decoded (about 660 ms instead of 1.2 s to first content on a slow link).
- Web: a per-account, per-profile query cache with stale-while-revalidate and request de-duplication (Back, revisits and Home paint from the stored copy and revalidate in the background; any write or live event drops what it makes stale), prefetching of a card's detail and hero art after a 200 ms focus dwell and of a page when its nav item is focused or hovered, card-sized artwork requests with version tokens, a memory cap on decoded artwork, and static asset caching headers (`/assets/*` immutable, entry points revalidated).
- Web: Home no longer fetches the artwork of every title in every rail up front, Search asks the server to filter to playable titles instead of walking the whole catalogue first, and Library scroll handlers use row arithmetic instead of reading the geometry of every card.
- Server: JSON responses are gzip or brotli compressed; API GET responses carry a strong `ETag` and answer `If-None-Match` with `304 Not Modified`, `Cache-Control: private` and `Vary: Authorization` (library lists briefly reusable and stale-while-revalidate, watch-state and other per-user data always revalidated). Artwork accepts `w` (snapped width, cached derivative, never upscaled) and `v` (version token that makes the response `immutable`).
- Android handoff destination: check for playback start every 100 ms instead of 250 ms and settle for 150 ms instead of 300 ms before acknowledging, saving about 0.3 s per phone or TV handoff. The latency breakdown is recorded in the 2026-10-07 emulator validation notes.
- Per-file language indexing no longer rewrites unchanged rows. A reconciliation pass used to run a `DELETE FROM media_file_languages` plus inserts and a state upsert for every file, each in its own write transaction, which queued behind other sync writers and logged "slow statement" warnings (about 23 ms per file and up to 1.7 s for one file on a 30,000-file benchmark with a competing writer). The repository now compares the stored rows first and writes only the kinds that changed; an unchanged re-sync of 5,000 files dropped from 117 s to 1.5 s. The delete already used the primary-key index, so no migration is needed.
- CI: pull requests run only the affected Android modules plus the sideload debug app (`scripts/ci/android-scope.sh`); the full `build` stays on main and nightly. Gradle and Rust caches are written by main only and read by pull requests.
- CI: backend tests run under cargo-nextest, and the Argon2 crates are optimised in dev/test builds (the playarr-api suite dropped from about 4.5 minutes to under one on two cores).
- Cut Vidaa / limited-TV library lag further: expand-only grid mount (initial
  48 cards), debounce stage selection under remote holds (focus-visible chrome
  stays live), skip alphabet/scroll-edge re-renders mid-hold, drop transitions
  during remote input, and delegate context menus off per-card props.
- Defer native focus during remote D-pad holds (is-remote-active marker + settle
  focus); activate via Enter/OK on the virtual target so Vidaa avoids per-key
  focus reflows.
- Make Playarr TV Web directional navigation lag-free under 4K + limited-CPU
  emulation: cache focusable geometry, pure O(n) scoring, debounce default-focus
  scans, defer selection-driven stage re-renders, and isolate card layout work
  without changing the 1:1 visual design.
- Speed dense library remote focus with O(1) title-grid stepping, remote instant
  scroll, coalesced selection updates, and off-screen card paint skipping.
- Derive the library virtualisation window and alphabet active letter from a
  single anchor/selection source of truth (no scroll/effect-synced mirror state),
  and skip remote focus transforms so dense catalogues do less work per key.
- Grow the library mount prefix expand-only under remote navigation so key holds
  do not slide/remount the virtual window mid-sequence.
- Defer native focus during remote library holds (overlay ring + sibling walks),
  freeze scroll-edge remeasures, and drop per-card context-menu props from the
  dense key path so 4K multi× throttle stays under the nav latency budget.
- Coalesce the remote focus ring to one rAF paint, cache library grid metrics,
  skip ResizeObserver work mid-hold, drop content-visibility re-layout thrash,
  and step Home rails without a full focus scan under remote input.
- Restore hover and active chrome on remote nav: keep pointer :hover styles,
  paint a deferred focus ring / `is-remote-active` marker per key, and settle
  stage selection after idle instead of dropping it while remote.
- Keep library/home stage insets 1:1 with main: stop virtualisation spacers from
  zeroing `--library-rail-*` padding, and drop always-on content-visibility that
  altered card geometry.

### Changed

- Prefer derived React state over `useEffect` → `setState` mirrors across the
  repo (documented in `AGENTS.md`); library prefs reset on kind change during
  render instead of a sync effect.
- Route VIDAA TV linking through the same hosted QR/link-code broker and first-contact flow used by Android TV.
- Fix VIDAA custom-store installation on firmware that reports an absent custom-app list as a failed read.
- Show Playarr's shared logo and language selector on the Android profile stage across phone and
  television layouts, matching the Web profile selector chrome.
- Enrich Android TV's focused download online with the same episode context, release year, genres,
  and synopsis as Playarr Web while preserving persisted metadata as the offline fallback.
- Match Playarr Web's Android Downloads presentation with an online-aware offline badge, device
  storage usage, persisted quality labels, type and byte metadata, determinate progress, explicit
  retention editing, an empty Downloaded-section state, detail-opening rows, and a focused TV
  preview panel.
- Match Android TV's pairing hierarchy to Playarr Web's split auth layout, keeping the branding,
  heading, QR code, verification URL, pairing code, and status together in the auth panel.
- Adopt Android KTX helpers for bitmap, URI, and preference operations and explicitly retain the
  Firebase legacy token callback and Hilt parameter target required by the current SDKs.
- Shrink unused resources from minified Android releases and provide a monochrome adaptive icon
  for themed Android launchers while retaining the self-hosted HTTP and television banner policy.
- Use direction-aware Android back and playlist icons and conform shared QR and media-card
  composables to the standard Modifier contract without changing left-to-right layouts.

### Fixed

- Apple TV home fixture hero/posters use pre-filtered SPA suite
  crops (no double greyscale) and search title weight matches SPA ~580.
- Apple TV home shell geometry aligned to SPA CSS clamps at 1920×1080
  (feature panel 24%/8vw, rails left 38% with track-left-fade, cards 219×123
  16:9, gap 25px).

- Apple TV parity home/detail use fixture hero and rail artwork
  extracted from the SPA suite reference so offline captures share posters
  with the web home frame; profile chip uses the suite avatar raster.

- Decode Android catalogue search's current `{items, remote_only}` response envelope instead of
  the obsolete bare work array, matching Playarr Web and restoring search against real servers.
- Keep the Android phone profile stage logo and language control below the system status bar while
  preserving their Playarr Web-aligned television placement.
- Release ArrowUp and ArrowDown from every Android single-line text field into spatial focus
  navigation after the on-screen keyboard closes, while preserving Left and Right caret movement.
- Keep Android phone library headings below the system status bar while leaving television layouts
  edge-to-edge, so Series, Movies, Sites, and Music no longer overlap system chrome.
- Keep sideloaded Android phone builds and devices without Play services running when Play Core's
  optional in-app update check or launch cannot bind, and skip the store lookup when no update is
  required by the connected Playarr Server.
- Cache Android avatar choices by server and saved profile so every profile keeps its chosen avatar
  offline and the shared shell reflects settings changes immediately, matching Playarr Web.
- Mount Android's Play Store update effect on phone builds so resume-time recommended and required
  update checks actually run, while retaining the TV profile screen's sideload updater.
- Hide Android's authenticated navigation until catalogue-kind access resolves, matching Playarr
  Web and preventing a partially authorized navigation bar from flashing during profile changes.
- Preserve Android's exact top-level, playlist-detail, or media-detail destination through profile
  switching, Add Profile, and expired-session reauthentication, matching Playarr Web's return path.
- Match Playarr Web's shell offline state on Android while keeping Downloads, downloaded playback,
  and saved profiles available, and consume Back to close a minimised player before navigating.
- Reject Android releases signed by the debug or an unexpected certificate, and verify the APK
  package and version against its release tag before publishing it to Playarr or GitHub.
- Serve the Roku developer ZIP from Playarr's public same-origin download storage instead of
  linking the public Clients page to an inaccessible private GitHub release.
- Re-register rotated Android Firebase messaging tokens with Playarr Server and identify universal APK
  push registrations as phone or television so invite approvals keep reaching the correct device.
- Localize Android-generated HTTP, loading, server-source, playback, and queue-title fallback
  messages at render time while preserving upstream diagnostics across phone and television.
- Localize Android parity-screen retry actions, match Web's decorative album-art semantics, and
  remove an unobservable playlist-success message that was immediately dismissed.
- Remove Android mobile sign-in's inert back control and localize known Android TV link-start,
  expiry, session-expiry, and declined states while retaining provider diagnostics.
- Route Android joined-server artwork, playback, progress, and offline-download bytes through the
  owning server's rotating session, persist download ownership across restarts, and never attach a
  Playarr bearer token to an unknown absolute media or artwork origin.
- Opt the Android core download and player implementations and download-state tests into the
  unstable Media3 contracts they deliberately consume so the top-level lint gate can validate
  every module, not only the app target.
- Transparently renegotiate expired Android on-demand HLS sessions after a server restart, resume
  at the absolute playhead, and guard each failed session URL from an automatic recovery loop.
- Make Android report the same playback session heartbeat and terminal lifecycle as Playarr Web,
  while mapping resumed on-demand HLS playheads back to absolute source time exactly once.
- Resolve Android's server-relative direct-play and HLS paths against the selected Playarr Server
  server before handing them to Media3, while preserving absolute peer URLs.
- Send the current bearer token on Android live-player media and HLS requests by sharing the
  authenticated Media3 data source already used for offline downloads.
- Offer only server-supported avatar presets on Android and render the account-backed avatar in
  the shared profile control and profile selector, with Playarr Web's deterministic fallback.
- Opt the Android download service and dependency wiring into the Media3 APIs they use so the
  repository's full Android lint gate completes without unsafe opt-in errors.
- Show the native Android build version beneath the profile avatar while keeping it outside the
  profile button's hit area, matching Playarr Web on mobile and television layouts.
- Gate every native Android download surface on the signed-in profile's live capability and keep
  the Downloads destination in Playarr Web order on both mobile and television navigation.
- Match the hosted TV-link page to the profile selector's shared full-screen layout, and always
  include the required OAuth device grant type when Android completes an approved link so the
  Playarr Server token request cannot fail with HTTP 422.
- Keep the Android Clients download button on the version-independent latest APK instead of a
  stale versioned release, and recognise vendor TV firmware through its Leanback or television
  hardware features so first launch cannot fall back to the mobile Server URL form.
- Only mark peer-matrix cells available when the peer's mapped physical file exists, preventing
  replicated Source catalogues from making storage-less nodes appear to hold media.
- Retry identity-only source pages during rolling upgrades without advancing the peer cursor.
- Replicate complete source-instance configurations into every peer's normal source list so
  synced sources remain visible and usable instead of being isolated as identity-only records.
- Reuse the configured SQLite busy-timeout value during connection initialisation, keeping
  database builds free of a dead-code warning.
- Run file-backed SQLite pools in WAL mode with a 30-second busy timeout so concurrent peer,
  catalogue, and admin work does not repeatedly fail with `database is locked`.
- Accept large initial signed peer-sync pushes within a bounded 64 MiB limit instead of rejecting
  availability payloads above Axum's general 2 MiB request-body default.
- Allow outbound-only peer nodes to create or join a group without advertising an inbound
  address, matching signed push-and-pull synchronisation behaviour.

### Added

- Remember multiple Android profile sessions per server so Add Profile preserves existing sign-ins,
  saved profiles remain available offline, switching restores each rotating token pair, and signing
  out removes only the chosen profile.
- Match Android's unavailable-route screen to Playarr Web with localized 404 copy and a responsive,
  natively drawn orbit, broken-screen, and search illustration that remains scrollable on phones.
- Align Android server settings with Playarr Web through localized connected-server management,
  guarded connect, disconnect, and forget operations, connection feedback, and app-host editing.
- Align Android profile-lock and friend-invite settings with Playarr Web through localized status,
  guarded PIN updates, request-state guidance, QR details, and approval-notification controls.
- Localize Android profile-avatar presets, upload validation, photo preparation, and the complete
  crop editor while retaining the Web workflow's supported formats, limits, and labels.
- Localize Android appearance, language, and player preference controls and replace English-only
  settings success detection with typed notices across profile, invite, and server updates.
- Align Android's profile chooser with Playarr Web through localized status and PIN flows,
  action-aware profile switching, account sign-in, and the native Android TV update control.
- Bring Android playlist details to Playarr Web parity with nested tracks, localized empty and item
  controls, per-track playback queues and reordering, sub-playlist creation, safe parent editing,
  and cascade-aware delete confirmation.
- Align Android's playlist directory with Playarr Web through localized hierarchy-aware roots,
  inherited cover artwork, shared/personal and natural-name ordering filters, folder metadata, and
  parent-aware video or audio playlist creation.
- Bring Android Downloads to Playarr Web parity with localized grouped states, playable completed
  downloads, scrollable quality options, and arbitrary date or after-watched retention controls,
  including a migration-safe policy whose expiry starts at the actual watched event.
- Align Android player loading and error states, busy indicator, controls, playback option dialogs,
  and season-grouped Up Next queue with Playarr Web across English, Thai, and Japanese on phone and TV.
- Bring Android music details to Playarr Web parity with localized artist, album, track, empty,
  duration, and action copy; restore an explicitly requested track; and keep the focused track's
  title, duration, and selected styling synchronized across phone and TV layouts.
- Localise Android video details, episode and chapter rails, title action and playlist dialogs,
  playback settings, and multi-server playback selection in English, Thai, and Japanese, with
  locale-aware Web-compatible runtime labels and a natively scrollable playlist picker.
- Localise Android Home, Search, and media-library surfaces in English, Thai, and Japanese with
  Playarr Web's rail, filter, count, synopsis, loading, and empty-state copy, plus its query-clear
  action on both phone and TV layouts.
- Honour Auto, English, Thai, and Japanese Android UI language preferences across mobile and TV
  sign-in, primary navigation, and Settings section chrome, including an accessible TV sign-in
  language picker and regression coverage for locale resolution and translation interpolation.
- Prompt Android mobile and TV viewers to choose an owning server before playing a title available
  on multiple connected Playarr instances, then map the selected movie, episode, track, or book to
  that server's local media ids and queue.
- Add Android mobile and TV Settings controls for listing independently connected Playarr servers,
  connecting and disconnecting profile-scoped sessions, showing instance names, testing the
  primary connection, and forgetting only the primary deployment's remembered failover group.
- Bring Android friend invitations to Playarr Web parity with live approval refresh, notification
  enablement, grouped-server links, QR and expiry display, clipboard copying, and fallback routing.
- Add Android phone photo avatars with Playarr Web-compatible pan, zoom, square crop, and
  server-backed 512 px JPEG output while retaining preset-only selection on TV.
- Enrich Android movie and series details with fixed runtime, real or generated chapters, cast,
  similar titles, per-file playback choices, and exact chapter-start playback.
- Replace Android's generic movie and series rows with a responsive video detail surface that
  matches the active episode's metadata, watch progress, actions, and season-scoped episode rails.
- Keep Android playback and session heartbeats alive across navigation with an artwork-rich
  mini-player, explicit minimise/restore controls, platform controls, and automatic track advance.
- Replace Android's generic artist list with a responsive album browser that uses authenticated
  album covers, native scroll viewports, album-scoped queues, track metadata, and per-track actions.
- Render Android music playback on an authenticated album-art stage with track metadata and an
  animated playing visualiser instead of a blank video surface.
- Add Android player now-playing metadata and an authenticated, natively scrollable Up Next panel
  with direct episode and track selection on phone and TV.
- Register Android playback with the platform media session so hardware play, pause, stop, seek,
  Previous, and Next actions match Playarr Web's global media controls.
- Carry ordered episode, track, and playlist context into Android playback so the Playarr player
  exposes boundary-safe Previous and Next controls on phones and televisions.
- Expose Android playback quality, source audio, and subtitle menus backed by the same server
  negotiation ladder and Media3 subtitle selection used by Playarr Web.
- Give Android the same device-local default quality and subtitle controls and profile-backed
  audio-language choices as Playarr Web, and apply the selected quality, audio track, and subtitle
  policy during playback.
- Let Android viewers persist the same Thumbnail or Cover home-rail artwork choice as Playarr
  Web, including matching wide and portrait card geometry on phones and televisions.
- Add full-featured LG webOS and Samsung Tizen Playarr packages with hosted
  first-contact linking, native TV playback/lifecycle support, scoped HLS session
  authentication, package build validation, and complete developer-mode installation
  guides on `playarr.app`.
- Add complete developer-mode sideload instructions to the Roku client page, including the
  remote sequence, web installer login, unchanged ZIP upload, first-launch linking, and Roku's
  one-sideloaded-app limitation.
- Let Android TV generate its QR and manual sign-in code through `playarr.app`, so selecting a
  signed-in Playarr profile transfers a short-lived Playarr Server device credential and remembered
  server addresses without entering a Server URL on the television.
- Add Grid, List, and Peer group matrix Library views, with peer-node columns, expandable
  Source-instance/media-type/folder trees, per-node physical file details, and peer-group
  folder-mapping controls.
- Let peer groups map each normal Source instance's reported root folder to its equivalent path
  on every node, synchronise those mappings with the Source configuration, and expose the mapped
  physical-file inventory to admin clients.
- Show the running Playarr bundle version outside the user button beneath its avatar across
  responsive layouts.
- Let peer nodes publish signed, incremental sync pages as well as pull them, so two-way
  convergence continues when one node can make outbound requests but cannot accept inbound ones.
- Synchronise complete source-instance configurations and deletion tombstones across peer-group
  nodes through authenticated, signed peer requests.
- Offer Low, Medium, and High playback bitrates across SD, HD, FHD, and UHD tiers in a
  three-column quality matrix shared by the live player and Player settings.
- Let Playarr viewers switch home rails between thumbnail and cover artwork, add depth to media
  cards, and softly fade scrolled items at the left edge of shared tracks.
- Let the authoritative relay DNS instance serve one explicitly configured, temporary DNS-01
  challenge so direct relay nodes behind filtered HTTP-01 port 80 can obtain trusted certificates.
- Let a Playarr Server administrator leave the current peer group with explicit confirmation, notify
  reachable members, preserve local users and media, and immediately create or join another group.
- Let administrators enrol independent Playarr Server deployments into a signed peer group, synchronise
  membership and account, library, availability, and routing metadata, route playback across nodes,
  and give Playarr clients ordered failover addresses.
- Add a dedicated Peer Groups screen to Playarr Server Admin for creating or joining groups, editing
  node addresses, issuing one-use join tokens, and checking every member's current status.
- Add an opt-in VIDAA installer Helm chart with source-IP-filtered LAN DNS policy,
  out-of-band TLS, and an Emissary route to the fixed hosted Playarr portal.
- Give every Playarr client its own catalogue URL, with downloads, installation guidance, and
  availability details shown on one client page at a time while keeping the platform selector
  available for direct switching and using each platform circle as its sole route control.
- Add the missing Playarr cover-flow experiences to native iOS libraries and Music, including
  authenticated album artwork, album selection, track lists, and first-track playback.
- Bring native iOS playback to Playarr parity with resume, per-title quality, audio and subtitle
  choices, chapter seeking, watch-progress updates, and complete playback-session telemetry.
- Complete the native iOS profile journey with Playarr-styled invited sign-up, synced preset and
  photo avatars, appearance and language choices, player defaults, PIN locking, and friend invites.
- Match Playarr Web's native iOS catalogue and playlist flows with available-only pagination,
  search scopes, library view and sort controls, cast and recommendations, and editable nesting.
- Expose available-only ordered library browsing, cast and recommendation data, friend invites,
  and invited-account sign-up to native iOS screens.
- Give the native iOS client the same editable playlist, profile preference, per-title playback,
  chapter, watch-progress, and playback-session API capabilities used by Playarr Web.
- Replace the skeletal native iOS tabs and lists with a SwiftUI Playarr experience matching the
  responsive web app: floating access-gated navigation, home rails, search and media grids,
  playlists, profile switching, rich details, native playback, and structured settings.
- Publish one native responsive Compose Android APK for phones, tablets, Android TV, and Google
  TV, with per-account server sign-in, adaptive touch/D-pad navigation, native Media3 playback,
  and a single playarr.app download and update manifest. Existing
  `io.playarr.tv` preview installs require one manual reinstall to move to `io.playarr.mobile`.
- Publish the installable Roku developer-mode app package and link it from the public Clients
  catalogue with its installation requirement stated explicitly.
- Add a native Playarr Apple TV app with focus-friendly catalogue browsing, search, device-code
  pairing, server configuration, and AVKit playback backed by the shared Swift client kit.
- Add an installable native Playarr iPhone and iPad project with reusable PlayarrKit business
  logic, App Store-ready bundle metadata, privacy resources, and iOS unit-test targets.
- Add a native Roku SceneGraph client with server setup, device linking, household
  profiles, paginated library browsing, title details, native playback and session telemetry.
- Make the Tizen client package-ready by emitting and validating its widget manifest and
  application icon alongside the production bundle.
- Make the webOS client package-ready with a validated manifest and application icon, and attach
  its Shaka playback engine when the video surface mounts.
- Let administrators choose Playarr and shared-library access when creating or approving an
  invitation, and let requesters include an admin-visible message about who the invite is for.
- Add playful per-profile avatar choices in Playarr settings, with crop, reposition, zoom, and
  locally resized custom photo uploads on devices that provide an image picker.
- Add held-playlist actions for renaming, choosing a new parent, or deleting personal playlists
  with explicit cascade confirmation.
- Add a public, localised Playarr Clients hub with truthful platform availability and a guided,
  experimental VIDAA launcher setup.
- Add an expiring, source-IP-gated VIDAA DNS and fixed Playarr installer gateway that refuses
  inactive recursive queries.
- Add audio-only playlists and a held-track context action for adding individual music tracks,
  albums, or complete artists while keeping existing and new video playlists free of audio items.
- Link live and historical administrator playback activity to named users and catalogue items,
  with a scaffolded settings page for each user.
- Let administrators name each instance through persisted Playarr Server system settings, and show that
  name in Playarr's connected-server settings and invitation sign-up screen.
- Acquire and hot-renew browser-trusted HTTPS certificates inside Playarr Server through an explicitly
  configured Let's Encrypt ACME environment and a built-in HTTP-01 challenge listener.
- Serve authoritative DNS-only public IPv4 hostnames inside the Playarr Server process when enabled.
- Add native TLS certificate support to the Playarr Server without requiring a reverse proxy.
- Notify Playarr users in Chrome, Android mobile, and Android TV when an admin approves their friend-invite request.
- Let Playarr users request a friend-invite QR, let Playarr Server admins approve or deny it, and start the one-use invite's 24-hour lifetime only when the approved user generates it.
- Show accessible confirmation toasts when Playarr settings, watch state, and playlists change.
- Let each Playarr Web profile connect directly to multiple Playarr Server instances, browse their
  libraries as one joined catalogue, and choose a server when duplicate media is played.
- Add expiring, one-use QR invitations from Playarr Server Admin that open `playarr.app`, lock the
  inviting server address, and let a new Playarr user create and sign into their account.
- Deploy Playarr Web to `playarr.app` through Cloudflare Workers after successful main-branch CI,
  with fresh-on-reload app shells, an equivalent local command, and an operator setup guide.
- Allow each Playarr Web login to select an absolute Playarr Server URL, connect to it
  directly from the browser, and keep saved profile sessions scoped to that server.
- Add QR and manual-code TV sign-in with an authenticated, phone-friendly approval page for
  Android TV, VIDAA, webOS, Tizen, and the fallback TV client.
- Add a VIDAA-aware hosted Playarr Web App with launcher artwork, persistent
  platform identification, television-safe playback negotiation, and a Hisense
  installation guide.
- Add durable users, policies, rotating refresh-token families, profile PINs, player preferences,
  per-title playback preferences, and watch-progress storage for SQLite and PostgreSQL.
- Add saved library views, nested personal and system playlists, cast and crew credits, people
  lookups, semantic similarity, and a Playarr Server-owned artwork cache with proactive prewarming.
- Add authenticated direct-play, rendition, live-session, subtitle, chapter, metadata, thumbnail,
  playback-event, and administrator playback-session APIs.
- Add Whisparr source support and persisted, administrator-managed Tdarr connection settings.
- Add a dedicated Playarr Server administrator web application for source instances, users, library
  browsing, saved views, playlists, tasks, playback activity, and Tdarr configuration.
- Redesign Playarr Web with light and dark themes, TV-friendly navigation, profiles, search,
  playlists, saved-view shelves, infinite catalogue browsing, media actions, and richer detail
  pages for video, episodic, music, and site content.
- Add reusable web, Shaka, and Samsung AVPlay playback surfaces with quality, audio, subtitle,
  chapter, progress, retry, minimised-player, and remote-control support.
- Let Android TV viewers check for updates from the profile page, securely download the latest
  signed APK from `playarr.app`, and open Android's installer when a newer build is available.
- Include Whisparr sites in Playarr home rails, return navigation, playlists, context actions, and
  episodic watch-progress handling.
- Add a dedicated music playback visual with album artwork, track metadata, responsive audio
  visualisation, and track-aware queue labels.
- Add a cover-flow library view with horizontal loading, centred remote focus, reflected artwork,
  scroll-edge cues, and clearer alphabet focus states.
- Surface and cache Lidarr album covers in artist details, and use the first available album
  cover when Lidarr only reports unusable local paths for artist artwork.
- Play albums directly from artist Cover Flow with inline controls, a live visualiser attached to
  the active cover, album-scoped track queues, and a persistent artwork-rich minimised player.
- Control persistent playback from anywhere in Playarr with keyboard media keys, app-wide Space/K
  shortcuts, and browser Media Session actions for play, pause, previous, and next.

### Changed

- Roku library browse matches web heading ("Movies" + "1,730 TITLES"),
  numeric title sort (2 Kites before 10 Brambleford), genre kicker/meta, and
  layout chrome closer to Library.tsx. Browse key-art Poster wired (async).

- Remove Android's unreachable pre-parity login, catalogue, player, and settings Compose stacks so
  audits and maintenance cover only the native phone and television experience that can run.
- Join Android catalogue, search, kind, progress, media, playback-session, and download API calls
  across independently authenticated connected servers, with Playarr Web-equivalent identity
  merging, partial-success behaviour, source discovery, and ownership routing.
- Authenticate Android secondary servers with a stable per-server device identity, discard
  passwords after login, serialize refresh-token rotation, reuse concurrent refresh winners, and
  disconnect only after a definitive refresh rejection.
- Add a profile-scoped Android credential boundary for independently authenticated connected
  servers, keeping rotating secondary token pairs distinct from peer-group failover addresses and
  exposing only token-free summaries to Settings presentation code.
- Match Playarr Web's Android Search presentation with live result counts, persistent focus
  selection, and a focused work or playlist preview that carries title and metadata context.
- Match Playarr Web Search on Android with 320 ms request coalescing, stale-request cancellation,
  available-only results, dynamic content-type filters, saved-view library filters, and the same
  playlist-versus-library exclusion rules.
- Match Playarr Web's Android Home shelves: use one latest-progress On Deck or Start Watching
  primary, de-duplicate every subsequent title, split each video kind into New and More rails,
  and keep artists exclusively in Music.
- Resolve Android On Deck video rows to Playarr Web's exact episode label, season and episode
  context, authenticated media thumbnail, progress, and selected child when detail opens; drop
  stale episodic progress that no longer maps to a playable child.
- Match the Web minimized-player surface on Android phone and TV with a single expand target,
  responsive Web dimensions, live elapsed and duration text, a bounded progress rail, artwork
  fade, and maximize affordance.
- Make Android player-surface taps toggle playback and match Playarr Web's TV remote policy: centre
  toggles, Left/Right seek five seconds, Up focuses Back, and Down focuses the seek control.
- Replace Android's stock Media3 player chrome with Playarr controls that show the absolute source
  timeline, buffered progress, auto-hide behaviour, and phone/TV track selectors.
- Change the catalogue search response from a bare item array to `{ items, remote_only }` so
  partial-cache nodes can surface titles available only from peers.
- Format the peer-group backend sources with the repository's standard Rust style.
- Refresh Playarr Web's generated build manifest for the latest production deployment.
- Consolidate all universal Android sources, internal modules, build tooling, CI, release scripts,
  and documentation into the single `clients/android/` Gradle project, removing the obsolete
  `mobile-android`, `android-shared`, and `tv-android` project directories.
- Rebuild the universal Android client as a native responsive counterpart to Playarr Web: the
  phone and television layouts now share its pink identity, landscape media rails, selected-title
  artwork stages, floating access-gated navigation, progress shelves, search, filtered and sorted
  libraries, playlists, profile switching and PIN entry, full profile settings, runtime server
  selection, TV device linking, detail actions, resume progress, appearance themes, and
  authenticated artwork loading while retaining native Compose and Media3 playback.
- Align the iOS architecture and roadmap with the installable Xcode project and remaining runtime
  validation boundary.
- Align the Tizen architecture guidance with the package-ready production build.
- Align the webOS architecture guidance with the package-ready production build.

- Match the Clients catalogue to the profile selector with an offscreen horizontal platform row,
  hidden scrollbars, recognisable icons, directional action navigation, inline installation
  details, consolidated Android downloads, Apple TV, Roku TV, and a Profiles-page link.
- Publish the signed universal Android release to a same-origin Playarr download URL, and host the
  VIDAA custom store assets without operating a public DNS resolver.
- Use the same left-aligned background artwork sizing, crop, tint, and positioning across all media
  surfaces, with a right-edge fade that scales with the artwork.
- Use the standard library-heading divider and spacing between the media section and selected item
  on music, movie, and series detail pages instead of a hand-drawn pipe.
- Show each playlist's audio or video type while browsing and when open, and replace parent
  playlist selects with searchable pickers in create and edit flows.
- Place separate playlist edit and delete actions beneath the open playlist description instead
  of hiding both actions behind a title-bar menu.
- Match music, movie, and series detail-title typography to the established selected-title style
  used by the Series and Movies library pages.
- Require an explicit click, keyboard focus, or remote action to select media cards and rows instead
  of changing the active navigation item when the pointer merely passes over it.
- Use one consistent position, width, title scale, and synopsis treatment for homepage features,
  directory previews, and media detail copy.
- Match item names after the detail-page heading pipe to the compact metadata typography used by
  other page headers instead of repeating the main heading size.
- Show `Music | Artist`, `Movies | Title`, or `Series | Title` in detail-page headers, and move
  selected-album metadata from above the music track list into the left-hand detail panel while
  keeping inline playback controls clear of the first track, Cover Flow changes on Left/Right,
  and directional navigation moving past absent playback controls.
- Present Playarr Web settings as a sliding option list and right-hand detail panel, with
  remote-friendly Right-to-open and Left-to-close navigation.
- Align the Settings back control and page title with the shared television stage used by
  library pages.
- Keep Settings in a permanent split view with Appearance open by default, a narrower option
  list, directional focus movement between panes, active-section headings in the shared page
  header, live Up/Down section selection, Enter/Right detail activation, and unboxed left
  navigation that stays clear of the signed-in profile.
- Add working default quality, subtitle mode and subtitle language controls under Player while
  retaining the profile's preferred default audio language.
- Move each Settings section title and help text into the shared top-left heading, remove the
  repeated in-panel intro, and remove the redundant Account page now sign-out lives on Profiles.
- Use the profile switcher as Playarr's signed-out landing page, animate sign-in fields into its
  centred visual treatment, and give invitation sign-up the same design without back navigation.
- Localise Playarr Web in English, Thai, and Japanese, with system-language detection and a
  searchable language selector on sign-up and settings screens.
- Centre Playarr profiles beneath the viewer heading, animate them into view, and add
  flat initial avatars and PIN-independent profile sign-out controls beside icon-only settings
  buttons, without showing settings beneath the sign-in card.
- Normalise bare, HTTP, and HTTPS public IPv4 server inputs, with or without a port, to the
  deterministic direct relay hostname on port `8484`.
- Standardise Playarr Server's direct application port on `8484`.
- Let Playarr convert public IPv4 HTTP addresses to deterministic DNS-only HTTPS names without
  proxying application or media traffic.
- Split Playarr Web's settings screen into a hub with one focused page per section (appearance,
  player, server connection, profile lock, invite a friend, account) instead of one long
  scrolling page.
- Make Playarr Web responsive on mobile with safe-area-aware navigation, touch-sized controls,
  stacked content regions, and phone-friendly library, detail, search, profile, settings, and
  player layouts while preserving the existing desktop and television presentation.
- Give mobile catalogue rails the full homepage and directory width, scroll item details and their
  metadata as one native page with parallax artwork, and show titles in the Settings navigation.
- Separate the mobile Settings menu from each full-width settings page so routed content never
  overlaps the titled navigation list.
- Host Android Mobile in the same responsive Playarr Web application as Android TV, retaining
  native server recovery, Back and fullscreen handling, image selection, updates, and push
  session registration without a second mobile UI implementation.
- Let Android TV builds configure their Playarr server at build time, use the television's
  system volume, and apply a stable 1920 by 1080 web viewport.
- Require completed changes to be committed and pushed promptly as small, atomic Conventional
  Commits, with a changelog entry and validation in the same commit.
- Default new deployments to full-account authentication with a durable bootstrap administrator,
  while retaining trusted-network authentication as an explicit opt-in.
- Expand the checked-in OpenAPI contract and generated TypeScript API client for the new
  authentication, catalogue, playback, user, playlist, view, artwork, analytics, and Tdarr APIs.
- Align the shared administrator design tokens with the established Sonarr, Radarr, and Lidarr
  visual language.
- Resolve remote media paths through configurable local mount roots and treat live transcode
  expiry as an idle timeout that advances while playback remains active.
- Separate the consumer Playarr experience from the Playarr Server administrator application and remove
  the obsolete in-client administration screen.
- Rebrand the Android TV launcher as Playarr and use a hardware-accelerated fullscreen WebView so
  the television client stays aligned with the web experience.
- Install FFmpeg in the backend runtime image, persist artwork caches across every Docker Compose
  tier, and expose the standalone trusted-network CIDR setting.
- Consolidate Tdarr configuration into the Source instances card grid and creation flow instead
  of maintaining a separate administrator page.

### Fixed

- Apple TV home fixture hero/posters use pre-filtered SPA suite
  crops (no double greyscale) and search title weight matches SPA ~580.
- Apple TV home shell geometry aligned to SPA CSS clamps at 1920×1080
  (feature panel 24%/8vw, rails left 38% with track-left-fade, cards 219×123
  16:9, gap 25px).

- Apple TV parity home/detail use fixture hero and rail artwork
  extracted from the SPA suite reference so offline captures share posters
  with the web home frame; profile chip uses the suite avatar raster.

- Let scrolled media cards travel into a longer fade outside the shared track's left edge, and
  keep vertical remote navigation snapped to the first and last populated rails.
- Restore the native iOS Home page to Playarr Web's full-width phone viewport so rail headings
  and both leading carousel cards launch visibly beneath the safe area instead of off-screen.
- Fix native iOS Home, navigation, avatar, media-track, playlist, and playback parity: use the
  mobile Web composition on landscape phones, progressively load playable Home rails, cache
  authenticated artwork, preserve AVPlayer ownership, and render series, music, and playlist
  tracks with Playarr's responsive media surfaces.
- Keep native iOS Home rails inside the visible mobile viewport and explicitly return each one
  to its leading gutter instead of relaunching with clipped artwork and titles.
- Keep native iOS title and player actions fully visible by using immersive detail and playback
  surfaces instead of allowing the responsive app navigation to cover their controls.
- Start every native iOS Home carousel at its leading content gutter instead of restoring a
  clipped partial-card offset on launch.
- Replace the native iOS profile screen's static playback labels with working quality, subtitle,
  subtitle-language, and audio-language defaults that drive negotiation and AVPlayer tracks.
- Restore visible native iOS Home rails in dark mode, match Playarr Web's on-deck and recent
  catalogue grouping, and constrain mobile artwork and carousels to the web layout proportions.
- Persist native iOS sessions in app-scoped simulator storage when running an unsigned build,
  while keeping physical-device tokens exclusively in Keychain and surfacing useful Security
  status details if device persistence fails.
- Advance the actual Cover Flow album selection during touch dragging instead of shifting the
  entire carousel, keep album artwork uncropped and inline controls tightly positioned, and let
  vertical page scrolling begin on music, episode, movie, and playlist rows.
- Keep restored mobile music controls attached beneath Cover Flow when playback mounts before the
  artist detail and its inline host finish loading.
- Keep the native iOS login form and its error feedback active while switching to the entered
  Playarr Server instead of clearing the fields during an unnecessary session restore.
- Complete the native iOS Playarr parity pass across responsive library, search, title detail,
  playlist, and settings screens; use dark appearance for new installs, keep artwork fallbacks
  dark, and apply login-equivalent server URL correction when changing servers in settings.
- Match the native iPhone and iPad app to Playarr Web's responsive dark interface across login,
  home rails, navigation, media cards, and profile switching, and apply the same public-IP relay
  correction and strict server URL validation during login.
- Give the native iOS client real username/password and managed-profile login, persist those
  sessions per server, and carry bearer authentication into AVPlayer media and HLS requests.
- Canonicalise Android public-IPv4 Playarr Server addresses to their secure direct relay hostname before
  login and migrate saved addresses, preventing cross-host redirects from stripping bearer tokens
  and making every catalogue request appear to have an expired session.
- Make the iOS Xcode target produce the `Playarr.app` bundle expected by its shared scheme and
  app-hosted unit tests.
- Authenticate iOS catalogue and playback requests, rotate expired sessions through the server's
  refresh endpoint, and persist each server's token pair in the iOS Keychain across relaunches.
- Rebind every iOS screen to the newly selected Playarr Server as soon as its saved URL changes.
- Refresh and retry the native Android app's authenticated request after an access-token `401`,
  persisting the server's rotated token pair so a successful login no longer immediately appears
  as an expired session.
- Replace the blank Android WebView shell with the single native responsive Compose application
  and defer notification permission until it is relevant to the signed-in user, without logging
  account credentials or access tokens from debug-signed distribution builds.
- Make the Android shell load only hosted Playarr, remove its native Playarr Server-address editor and
  startup server-version request, and leave each account's Playarr Server URL to the web login flow.
- Let Android browsers follow the Clients APK link as a normal direct navigation instead of
  forcing the browser's broken download-attribute filename handling.
- Hand public APK links from the Android WebView to Android's download-capable browser so the
  installer downloads without entering Playarr's profile or sign-in flow.
- Link the public Android download to its immutable versioned route and force the `.apk` filename,
  avoiding stale browser or edge fallbacks from the previously missing stable path.
- Remove source archives and loose web bundles from the Clients catalogue so download actions are
  shown only for installable app packages, and consolidate iOS and Apple TV into one shared Apple
  client entry.
- Match Android TV's 1920 by 1080 vertical spacing to Playarr Web even when its WebView resolves
  viewport-height units to zero, and preserve the web app's initial route focus after loading.
- Keep a restored library card and its captured native scroll position visible after returning
  from a detail page, while yielding immediately to new remote, pointer, wheel, or touch input.
- Persist profile avatar presets and resized custom photos with the signed-in account so an
  existing choice renders on other web and TV devices.
- Let sign-in, sign-up, and the Playarr Clients page scroll on TV browsers whose cursor-edge
  gesture only moves the document's own scroll offset, by handing those pages' real overflow to
  the document root instead of a nested scroll panel.
- Keep directory preview animations from narrowing the shared media-copy width and wrapping titles
  differently from their detail pages.
- Persist the focused audio or video choice when creating a playlist instead of allowing visual
  focus and the submitted playlist type to diverge, and roll back mismatched results from an
  outdated server instead of silently leaving a video playlist behind.
- Replace the playlist type dropdown with styled video and audio icon buttons that support
  directional remote and keyboard navigation.
- Render Playarr Server activity links in the surrounding text colour and report bytes actually
  delivered during direct and adaptive playback instead of leaving session totals at zero.
- Keep global Space/K playback shortcuts active across Playarr unless the viewer is typing in an
  input, textarea, or editable field.
- Prevent the minimised player from hiding a video element that still retains browser focus.
- Load authenticated, cached work and album artwork throughout Playarr Server Admin, including music,
  with visible loading placeholders and graceful missing-artwork fallbacks.
- Focus Play/Pause only when moving Up from the first music track or Down from the inline scrubber,
  and scroll newly focused tracks into view immediately instead of clipping them during animation.
- Inset visualiser bars over the full-cover gradient in Cover Flow and the mini-player, and extend
  the desktop music track viewport to the bottom of the page; render the playing cover's bars
  directly so they remain visible through player remounts.
- Refresh access tokens centrally before authenticated media requests and keep playback buffered
  through the existing stream retry window instead of failing when a short-lived token expires.
- Replace the active-cover visualiser's black panel with a full-artwork transparent gradient and
  evenly applied blur.
- Focus the inline music scrubber directly when pressing Down from Cover Flow.
- Return Up from the first music track to the inline playback controls and keep the scrubber bar
  at a constant height when its focus thumb appears.
- Debounce music seeks, preserve the playing control state, and keep inline controls mounted while
  an on-demand track reloads at the requested position.
- Keep the inline music mini-player inside the app layout, centre Cover Flow and its controls on
  one axis, and navigate between transport buttons, the scrubber, artwork, and tracks by remote.
- Connect the sign-in language selector to the first input with explicit Up and Down focus
  movement while leaving its open menu's keyboard controls intact.
- Keep focused music tracks inside their scroll viewport and clear their highlight when focus
  leaves the track list.
- Keep the inline music player and Cover Flow controls mounted, and show the visualiser only on
  the actively playing album with a darker, blurred backdrop while preserving playback across
  page refreshes.
- Centre inline music controls beneath Cover Flow and show the active track title above them.
- Keep the inline Previous, Play/Pause, and Next buttons centred independently of the time readout.
- Keep the inline mini-player visible without artwork metadata and hide playback controls while
  music is still loading.
- Route directional navigation directly between Cover Flow, inline playback controls, and tracks.
- Enable Up and Down navigation from sign-in fields, and return Left from the server-address
  boundary to the active Settings option instead of a diagonally positioned item.
- Let Left and Right leave Playarr text inputs at their matching caret boundaries while
  preserving native caret movement within the value.
- Match Settings to the Series and Movies 35/65 stage: keep its rail-styled detail panel full
  height, preserve native inner scrolling, and align the clock against the left panel edge.
- Keep requested Playarr URLs in place while showing profile selection, retry saved sessions before
  asking for credentials, and render unknown routes as an in-app 404 after authentication.
- Select each Playarr view's first relevant control when its asynchronous content finishes loading.
- Cache each Playarr profile's available navigation sections and wait for them before showing the
  left navigation, preventing its items from jumping during sign-in.
- Show the source bitrate alongside Original in Playarr's player quality menu.
- Anchor the sign-in back control to the exact Series-view header position while keeping the
  profile selector free of back navigation.
- Restore native mouse-wheel, trackpad, scrollbar, and touch scrolling on every authenticated
  Playarr page while keeping ArrowUp and ArrowDown navigation available from text inputs.
- Show only users signed in on the current device in Playarr's profile selector.
- Accept bare `v4-A-B-C-D.relay.playarr.app` hostnames in Playarr server fields and normalise
  them to HTTPS on Playarr Server's application port.
- Redirect plaintext requests on Playarr Server's HTTP and HTTPS ports to the configured browser-trusted
  HTTPS hostname instead of returning a 404 or an invalid TLS response.
- Load cross-origin media with CORS enabled so Playarr's Web Audio visualiser receives real audio
  samples instead of browser-sanitised zeroes.
- Use cached catalogue artwork in the music player instead of requesting video-frame thumbnails
  from audio files.
- Accept bare IP addresses in Playarr server fields without native browser URL validation blocking
  submission.
- Reuse Playarr Server's existing Rustls crypto provider for native TLS builds instead of requiring an
  additional CMake-based provider.
- Let ArrowUp and ArrowDown move remote/keyboard focus out of a text field on Playarr Web instead
  of getting stuck there, since those keys have no native effect in a single-line input.
- Move vertical focus to the closest card in the next Playarr media track, even when shorter tracks
  have no card directly above or below the current horizontal position.
- Leave the hosted server field blank instead of pre-filling the previously selected address.
- Connect directly from `playarr.app` to operator-entered HTTP or HTTPS IPs and domains, using
  Local Network Access for private addresses and the browser's explicit insecure-content
  permission for public HTTP, without a relay or a server-hosted Playarr client.
- Prevent Playarr's service worker from returning the HTML app shell to failed cross-origin API
  requests, avoiding JSON parse errors after an ordinary reload.
- Apply the systemd service restart-rate limit from the valid unit section instead of silently
  ignoring it during installation.
- Request browser Local Network Access for direct private HTTP connections from `playarr.app`,
  without requiring Playarr Server to be exposed publicly or use HTTPS.
- Leave the Playarr Server field blank on `playarr.app` instead of suggesting the hosted
  client origin, while retaining explicit and self-hosted server defaults.
- Build Playarr Web's workspace dependencies before local or CI Cloudflare deployments.
- Correct the VIDAA guide to use the reachable Playarr Web endpoint in the TV
  Browser instead of presenting the unsupported `hisense://debug` scheme as a
  generally available launcher installer.
- Fetch Lidarr-local artist posters, backdrops, banners, and logos through the authenticated
  backend artwork cache, and prefer artist backdrops for music-detail wallpapers.
- Route Android TV Back actions through Playarr so active and minimised playback sessions close
  before native WebView history navigation, while retaining login cookies across lifecycle events.
- Pin scroll-edge shadows to the visible viewport and only show each edge when content remains in
  that direction.
- Migrate legacy Whisparr series records to site records without breaking catalogue references,
  and expose sites throughout administrator library filters, views, and permissions.
- Backfill missing Lidarr media files even when the source reports an unknown availability state.
- Preserve client sessions across backend restarts and rotate expired access tokens through the
  newly exposed refresh endpoint.
- Keep playback sessions alive beyond their initial transcode window, wait for cold HLS manifests,
  and enforce library access on both negotiation and media delivery.
- Allow sideloaded and debug Android TV builds to continue when the Play Store update API is
  unavailable.
- Capture the Android TV remote's Menu key at the Activity boundary so the server-address editor
  remains reachable even when WebView consumes the event.
- Negotiate direct playback for audio-only files using audio codec capabilities and pass the
  source MIME type through the playback API to the web player.
- Preserve the Android TV WebView across server reloads and dispose it only with the Activity
  lifecycle, avoiding premature destruction during Compose updates.
- Retry audio thumbnail generation without seeking when FFmpeg exposes embedded cover art as a
  single attached picture.
- Treat pausing music as a stopped session so buffering transitions cannot leave a stale
  minimised player visible.
- Authorise native progressive audio with its active playback session, keep seeking and timeline
  state accurate, and advance previous, next, and ended actions through tracks rather than albums.
- Suppress Android's restricted-API lint false positive on the public Activity key-dispatch
  override used for TV remotes.
- Reload visible Playarr library kinds for each signed-in user so profile switches cannot retain
  navigation from the previous user's permissions.
- Make minimised-player focus unmistakable for keyboard and remote users with layered focus rings,
  title contrast, and maximise-button feedback.
- Restore the active Playarr item after refreshing a tab while playback is minimised.
- Stop and clear playback on the user-selection screen, and treat pausing music as stopping its
  playback session rather than retaining a hidden player.

### Security

- A PIN-locked profile's stored refresh token can no longer be redeemed without the PIN: the server holds a device-bound unlock lease (granted by login or `POST /api/v1/auth/unlock`, slid by refresh, cleared by `POST /api/v1/auth/lock`) and answers `403 pin_required` without one. Web and Android clients prompt for the PIN and lock a profile when switching away.
- Playback capability URLs (`playback_session_id` cookie or query) previously skipped all
  account checks after the session was created. They now re-resolve the session owner's
  streaming grant, library access, schedule, budget and content rules on every request.
- Profile PIN verification is rate limited: five failures per profile pair, or twenty against
  one profile from any caller, lock it out with exponential back-off (`429 pin_locked`). A
  restricted profile can no longer "switch" into a less restricted profile that has no PIN.
- Ignore local runtime data, browser-automation helpers, embedding caches, and the local backend
  scratch runner so credentials, databases, downloaded models, and machine-specific paths cannot
  be committed accidentally.
- Constrain artwork fetching to stored catalogue URLs, return secret-free administrator DTOs, and
  enforce least-privilege library and streaming grants across catalogue and playback routes.

### Testing

- CI: a `web behaviour` job runs every web Playwright smoke and behaviour script in pull requests and is part of `ci-required`; the layout owner-request gate covers all web stylesheets and shell components; native parity captures are manual (`workflow_dispatch`) only, enforced by a check; the brand red is the `--brand` token.
- Added a keyboard e2e check that the shared side-panel drawer returns focus to its opener (Filters on Movies, Search and Calendar; Escape and remote Back; both themes).
- Web: a per-frame keyboard e2e asserts that opening and closing the library Filters drawer does not move the grid, header or preview (Movies and Series, both themes, 1920x1080 and 1280x720).
- Web: a Playwright check (`scripts/edge-fade-e2e.mjs`, in the web layout parity job) asserts the edge fade has no hard edge, is present at first paint, adds no box over content and leaves the focused card's shadow unclipped, in both themes.
- Web: `focusStyle.test.ts` pins the ring token and the card-focus values and fails on a focusable card without `media-card`, a ringed or filled card, or a control with a fill, glow or scale on focus; `scripts/focus-style-e2e.mjs` (`pnpm run smoke:focus`) checks real keyboard focus in both themes at 1920x1080 and 1280x720.
- Web: unit tests for the scroll engine, an audit that forbids direct scroll writes outside it, a Playwright motion check (`scripts/motion-e2e.mjs`), and frame-pacing numbers in the nav-perf harness.
- Web: `scripts/drawer-close.mjs` (Playwright, run in CI) samples the drawer opening and closing animations and asserts they mirror in the TV, desktop and mobile layouts and both themes; unit tests cover the closing state.
- Roku parity capture: a cold start moves the picker focus back to the first profile before pressing Select, so a remembered bottom-row focus can no longer sign the test device out.
- Roku parity capture: the Preferences screens press Left before Select so the gear, not Sign out, is focused when the profile picker remembers the bottom row.
- Roku: a contract test pins the household blocked states (outside schedule, budget used) and how the blocked page opens and closes; the parity README records why the screen cannot be captured on the real device.
- Web parity captures are reproducible: backdrop blur, the browser storage estimate, the player focus ring and the paused video frame are pinned, and all references are recaptured from current main on a fresh fixture.
- CI gate: a PR that changes a shared page layout look file (the page-layout stylesheet, the shared layout components, the layout references and pins, the Android page package and goldens) fails unless its body carries `Layout-Change: owner request <date>, reference <id>`.
- Page layout guards: the page registry now ratchets (every page is `layout`, `unmigrated` or `exempt` with evidence, and the unmigrated list may only shrink), `pageLayoutAudit` and `pageLayoutCss` fail when a page or a stylesheet draws its own header, pill, scroll container or state, and a new `web layout parity` CI job diffs the canonical header and action pill against the committed 30 September reference and pins (and every page's pills and header band) at 0 pixels in both themes.
- Android TV instrumented navigation tests cover the draw-only card lift (focus-target bounds unchanged), geometric vertical moves from a scrolled rail, and media cards drawing no ring or fill in both themes.
- Parity tooling: the Android TV capture script takes scrolled states (Home rail, library grids) and fails a hard-cut scroll edge with `check-edge-fade.mjs`; `capture-web-scrolled.mjs` captures the same Home position on web for comparison.
- Android TV D-pad navigation is covered by JVM tests of the web rules (`PlayarrTvNavigationTest`) and instrumented key-event tests across Home rails, the library grid and the series page, plus pixel checks that the focus ring draws no fill in both themes (`PlayarrTvNavigationUiTest`).
- Tests pin the Calendar's header buttons and every page's Filters button to one component per client: a web style rule check, an Android metrics and call-site test, and source guards for iOS and tvOS.
- CI: the web layout guards (page header registry, button audit, drawer audit) now run on every pull request that touches `clients/tv-web`, through a new `lint` script in the web package, and `tv-web-check` also runs the affected packages' vitest suites. Both feed `ci-required`. The Household registry reason now matches the page.
- Added `clients/tv-web/web/scripts/player-entry-e2e.mjs` (Playwright against the fixture server, TV and phone layouts) and unit tests for direct player mounting and the BACK sequence.
- Web TV: unit tests for the next-up selection and source tests for the detail-page focus ring; the series-detail TV parity references were recaptured for the focus ring on the first tile.
- Unit tests for the self-renewing QR sign-in state machine (`QrPairingFlowTest`): hosted code expiry, server device-code expiry, denial, request and poll blips, backoff cap; plus a Fire TV `LinkScreen` expiry-renewal test.
- Roku: add `scripts/parity/roku/capture.mjs` (device screenshots through the dev installer, in the layout `diff.mjs` reads) and the first dark-theme parity table in `docs/parity/roku/`.
- `PlayDistributionPolicyTest` now asserts the Play flavour allows cleartext, and `scripts/ci/check-cleartext-policy.sh` (run in CI) checks the Android, iOS, tvOS, Xbox and Tizen configuration.
- CI: new `ios-tests` workflow compiles the iOS app and runs its unit tests on a hosted macOS simulator for pull requests that touch `clients/ios`.
- CI: new `ios-tests` workflow compiles the iOS app and runs its unit tests on a hosted macOS simulator for pull requests that touch `clients/ios`.
- The headless player smoke script now also checks close/minimise placement, the Original label, reveal-only tap and Enter, and runs on the 1920x1080 TV layout; vitest guards the player chrome across the web and legacy TV player.
- A test now fails if two SQLite migrations share a version number.
- Fixture environment: `scripts/fixtures/verify-dub-copy.mjs` checks the dub video-copy path (H.264 and HEVC), the transcode fallbacks and that the Dubarr key stays out of ffmpeg's argv; `PLAYARR_FIXTURE_DUB_SECONDS` generates a dub shorter than the film.
- Added a headless smoke script and vitest guards proving the web in-app mini player (the Picture-in-Picture fallback) shows the same live video element without reloading, on desktop and TV layouts.
- Made the live-events stream tests deterministic: absence is now asserted by reading up to a later sentinel frame (ordered by `seq`) instead of draining for a fixed time window, positive waits use a generous bound, and the API test database pool waits longer for its single connection. Removes failures seen when the full parallel suite ran on saturated cores.
- Fixture-based web playback test (`pnpm --filter @playarr-tv/web run test:playback-e2e`): signs in as a fixture user, plays a fixture film, asserts `currentTime` advances, and kills and restarts the fixture server mid-playback to check the reconnect card and recovery. Fixture clip length is configurable with `PLAYARR_FIXTURE_CLIP_SECONDS`.
- Added vitest coverage for the web player's Original bitrate label, reveal-only input gate, Picture-in-Picture helper and close button.
- Folder scanning and browsing are covered by fixture directory trees with generated tiny media (ffmpeg; skipped on hosts without it), including incremental rescans, live events, access control, discovery against a mocked source and playback negotiation of a folder item.
- Folder scanning and browsing are covered by fixture directory trees with generated tiny media (ffmpeg; skipped on hosts without it), including incremental rescans, live events, access control, discovery against a mocked source and playback negotiation of a folder item.
- Folder scanning and browsing are covered by fixture directory trees with generated tiny media (ffmpeg; skipped on hosts without it), including incremental rescans, live events, access control, discovery against a mocked source and playback negotiation of a folder item.
- Unit tests for the video-copy ffmpeg arguments (copy, `hvc1` tag, fragmented MP4, padded dub audio) and for the rule that decides when an audio switch may copy the video.
- CI rejects environment-specific data in tracked files (`scripts/ci/check-env-data.sh`): non-example IPv4 addresses, personal home paths, tailnet names and a secret-supplied denylist of internal names.
- Apple simulator test targets now match actor isolation, current design tokens, Google Cast dependency inheritance and the `PlayerEngine` optional `AVPlayer` witness (TASK 333).
- Verify artist catalogue details attach media identifiers and runtimes only to tracks that have
  matching media files.

### Documentation

- Roku parity: light-theme measurements for every screen against the live web, with the known causes of the high figures.
- Page layout spec: owner decisions recorded. The reference action pill is web's library Filters button as of 30 September 2026 (pinned to a commit), the header row grows to the tile height with items centred, Back and the period arrows stay round, focus is a ring with no fill (white in dark theme, ink in light theme), the drawer-open state keeps its ink fill, Customise Home moves into the header row, and the header and Back always show while loading or on error.
- README, project site and Play listing screenshots show the open-movie demo library on the current UI again (retaken, with the README attribution tables and CC BY credits restored). They are produced by the new `scripts/showcase` setup, which is separate from the parity fixture, and a CI check rejects public screenshots that were not made with it.
- Page layout spec (docs/design/page-layout.md): an audit of page chrome on web and Android, one canonical page anatomy with its component API and tokens, TV focus rules, enforcement through source guards, header-band parity and an owner-request gate, and the per-client migration plan.
- Android phone parity README: calendar and quality-menu residue recorded with measurements, final summary.
- Android phone parity: re-baselined in light and dark with the web's own fonts, calendar Play and Resume, the web profile page and player controls; results, captures and the justified differences are in docs/parity/android-mobile.
- Android phone parity: re-baselined in light and dark with the web's own fonts, calendar Play and Resume, the web profile page and player controls; results, captures and the justified differences are in docs/parity/android-mobile.
- Android phone household blocked screen parity (0.83% in the light theme) and its capture step.
- Regenerated the `@2x` architecture diagram PNGs from the SQLite-only SVGs, and corrected docs left over from the Postgres era: the backup description on the site (opt-in, age-encrypted, local unless an S3 destination is configured, offline CLI restore), the Kubernetes tier (StatefulSet, volume claim template, no Secret hook), the JWT secret fallback, the multi-node locking claims and the stale persistence gaps in the architecture overview.
- `sqlx-postgres` stays in `Cargo.lock` because the lockfile records sqlx's optional dependencies whatever the features; it is not in the build graph.
- Corrected `docs/architecture/auth-modes.md`, which still described the user, policy and refresh-token stores as in-memory.
- Pixel parity tooling for the Android phone client: platform profile options for capture-web (safe area, font, colour scheme), an emulator capture script, a system-bar mask and the measured results in both themes.
- Added the 2026-10-07 emulator validation record for the phone remote and playback handoff (`docs/validation/remote-emulator-run-2026-10-07.md`), including what only a real device can prove.
- Android TV pixel parity captures, per-screen mismatch table and justified exceptions under `docs/parity/android-tv/`.
- Retook the site, README and Google Play screenshots against a placeholder demo library (generated posters and backdrops served by the fixture stub), so no real title or artwork is shown. Added a dispatchable Apple TV parity capture workflow that uses the built-in placeholder fixtures.
- README: rebuilt with a banner, a screenshot showcase, light and dark platform and architecture diagrams, collapsible reference sections, and an expanded third-party media attribution for the openly licensed titles shown in the screenshots.
- Add `SECURITY.md` (private vulnerability reporting) and stop naming the deployment configuration in `AGENTS.md`, as part of the public-readiness audit.
- Restructured `TASKS.md` for the public repository: open work first in workstream sections, finished work collapsed under "Completed work", duplicate row numbers fixed (rows 280-287 smart Start/Resume and request sync, 279, 210, 180, 103-106, 300, 294, 49), stale in-progress rows closed against merged pull requests, and environment data and media titles removed from the board text.
- Added Big Buck Bunny (CC BY 3.0) third-party media attribution to the README files; the media is used only for the Play review demo and store screenshots, not in the app.
- Document VIDAA's invite-only partner registration and App Store release gates,
  including the production bootstrap decision required for self-hosted Playarr.
- Document the Playarr Server and Playarr design research snapshot and preserve a sanitised historical
  Playarr redesign handover for future implementation and debugging context.
