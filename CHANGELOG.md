# Changelog

All notable changes to Streamarr and Playarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add durable users, policies, rotating refresh-token families, profile PINs, player preferences,
  per-title playback preferences, and watch-progress storage for SQLite and PostgreSQL.
- Add saved library views, nested personal and system playlists, cast and crew credits, people
  lookups, semantic similarity, and a Streamarr-owned artwork cache with proactive prewarming.
- Add authenticated direct-play, rendition, live-session, subtitle, chapter, metadata, thumbnail,
  playback-event, and administrator playback-session APIs.
- Add Whisparr source support and persisted, administrator-managed Tdarr connection settings.
- Add a dedicated Streamarr administrator web application for source instances, users, library
  browsing, saved views, playlists, tasks, playback activity, and Tdarr configuration.
- Redesign Playarr Web with light and dark themes, TV-friendly navigation, profiles, search,
  playlists, saved-view shelves, infinite catalogue browsing, media actions, and richer detail
  pages for video, episodic, music, and site content.
- Add reusable web, Shaka, and Samsung AVPlay playback surfaces with quality, audio, subtitle,
  chapter, progress, retry, minimised-player, and remote-control support.
- Add an Android TV shell that hosts Playarr Web with saved server configuration, D-pad and Menu
  handling, fullscreen playback, and recoverable connection errors.
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

### Changed

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
- Separate the consumer Playarr experience from the Streamarr administrator application and remove
  the obsolete in-client administration screen.
- Rebrand the Android TV launcher as Playarr and use a hardware-accelerated fullscreen WebView so
  the television client stays aligned with the web experience.
- Install FFmpeg in the backend runtime image, persist artwork caches across every Docker Compose
  tier, and expose the standalone trusted-network CIDR setting.
- Consolidate Tdarr configuration into the Source instances card grid and creation flow instead
  of maintaining a separate administrator page.

### Fixed

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

- Document the Streamarr and Playarr design research snapshot and preserve a sanitised historical
  Playarr redesign handover for future implementation and debugging context.
