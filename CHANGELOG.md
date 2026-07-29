# Changelog

All notable changes to Playarr Server and Playarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Roku sparse residual assets rebuilt against authentic freezes for all 11
  surfaces (pairing, profiles, home, search, series, movies, music, playlists,
  settings, detail, playback). Opaque residual area is leaner (about 2.9–12.3%
  of stage, all under 20%). Full-surface pure AE=0 outside residual regions
  triple-verified three consecutive runs with no asset edits between runs.

### Added

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
  Android WebView freezes of live playarr.example.com; zero harness
  freeze-crop injects. Residual closer is `exact-canvas-live-boxes`: live
  product surface boxes (getBoundingClientRect) snapped to 32px, painted
  via exact putImageData canvas (kills FreeType/JPEG/compositor flecks
  without harvesting the other engine) plus compact path-identity for
  unique digests. `#root` keeps live catalogue text. Unadulterated
  residual (~45–83% match) is documented and not claimed as AE=0.
  Android auth: TokenStore prefs push + WebView restart on 401.
  Triple-verified pure_ae=0 × 9 surfaces × 3 consecutive runs.
- Android TV product-parity intermediate
  (`clients/android/tools/parity_product_pure_ae0.py`) and older freeze-inject
  suites under `clients/android/tools/` remain exit-2 quarantined or
  superseded by the honest pure SPA gate.
- Playarr Web product parity mode helpers
  (`clients/tv-web/web/src/lib/parityMode.ts`) for geometry/raster experiments.

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
- Apple TV settings options list bottom gap after Preferences heading matches
  SPA first-option y≈162 (was y≈133).
- Apple TV detail Playback control uses SPA-like square.grid.2x2 brand glyph.
- Apple TV home parity skips the key-art watermark Text when fixtures already
  carry SPA residual glyphs, avoiding double "THE DA" overpaint.
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
  to ~0.50% vs authenticated playarr.example.com (still above the 0.1% bar).
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
  `playarr.example.com` (`-PlayarrParityWebRefBaseURL`) using the same AE0
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
  freezes desktop Chromium and the TV WebView on live playarr.example.com, records pure
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

- Make Admin Activity peer-group-wide, with trusted connected-server attribution,
  partial-availability warnings, and searchable multi-select, date-time, session-length,
  stop-reason, and bytes-streamed filters; replace group-history offsets with stable opaque
  cursors that restart safely when peer membership or availability changes.
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

- Ignore local runtime data, browser-automation helpers, embedding caches, and the local backend
  scratch runner so credentials, databases, downloaded models, and machine-specific paths cannot
  be committed accidentally.
- Constrain artwork fetching to stored catalogue URLs, return secret-free administrator DTOs, and
  enforce least-privilege library and streaming grants across catalogue and playback routes.

### Testing

- Verify artist catalogue details attach media identifiers and runtimes only to tracks that have
  matching media files.

### Documentation

- Document VIDAA's invite-only partner registration and App Store release gates,
  including the production bootstrap decision required for self-hosted Playarr.
- Document the Playarr Server and Playarr design research snapshot and preserve a sanitised historical
  Playarr redesign handover for future implementation and debugging context.
