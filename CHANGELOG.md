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

### Fixed

- Handle Whisparr site entries throughout the administrator library's work-kind labels.
- Backfill missing Lidarr media files even when the source reports an unknown availability state.
- Preserve client sessions across backend restarts and rotate expired access tokens through the
  newly exposed refresh endpoint.
- Keep playback sessions alive beyond their initial transcode window, wait for cold HLS manifests,
  and enforce library access on both negotiation and media delivery.

### Security

- Ignore local runtime data, browser-automation helpers, embedding caches, and the local backend
  scratch runner so credentials, databases, downloaded models, and machine-specific paths cannot
  be committed accidentally.
- Constrain artwork fetching to stored catalogue URLs, return secret-free administrator DTOs, and
  enforce least-privilege library and streaming grants across catalogue and playback routes.
