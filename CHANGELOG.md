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

### Changed

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

### Security

- Ignore local runtime data, browser-automation helpers, embedding caches, and the local backend
  scratch runner so credentials, databases, downloaded models, and machine-specific paths cannot
  be committed accidentally.
- Constrain artwork fetching to stored catalogue URLs, return secret-free administrator DTOs, and
  enforce least-privilege library and streaming grants across catalogue and playback routes.

### Testing

- Verify artist catalogue details attach media identifiers and runtimes only to tracks that have
  matching media files.
