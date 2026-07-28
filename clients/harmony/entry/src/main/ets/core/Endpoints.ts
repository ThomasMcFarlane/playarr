// core/Endpoints.ts
//
// One exported function per Playarr Server endpoint, each a pure function of its
// parameters returning the exact server-relative path string. This is the
// ONLY file under core/ allowed to contain the literal "/api/" substring;
// every other layer must build request paths by calling these functions,
// never by hand-writing a path.
//
// App endpoints live under /api/v1/...; system probes live under
// /api/system/.... Query-string construction (limit, offset, kind, etc.) is
// deliberately left to the caller (data/ repositories) so this file stays a
// pure, dependency-free path table.
//
// No ArkUI, no @kit./@ohos. imports, no decorators: plain, Linux-testable
// TypeScript.

// -- 4.13 Version / compatibility -------------------------------------------

export function systemVersionUrl(): string {
  return "/api/system/version";
}

// -- 4.3 Device authorisation (RFC 8628) ------------------------------------

export function deviceCodeUrl(): string {
  return "/api/v1/oauth/device/code";
}

export function tokenUrl(): string {
  return "/api/v1/oauth/token";
}

// -- 4.5 Token refresh -------------------------------------------------------

export function refreshUrl(): string {
  return "/api/v1/auth/refresh";
}

// -- 4.6 Login ----------------------------------------------------------------

export function loginUrl(): string {
  return "/api/v1/auth/login";
}

// -- 4.7 Profiles --------------------------------------------------------------

export function profilesUrl(): string {
  return "/api/v1/users/profiles";
}

export function verifyPinUrl(profileId: string): string {
  return "/api/v1/users/profiles/" + profileId + "/verify-pin";
}

export function capabilitiesUrl(): string {
  return "/api/v1/users/me/capabilities";
}

export function playerPreferencesUrl(): string {
  return "/api/v1/users/me/player-preferences";
}

// -- 4.8 Catalog -----------------------------------------------------------

export function catalogUrl(): string {
  return "/api/v1/catalog";
}

export function catalogKindsUrl(): string {
  return "/api/v1/catalog/kinds";
}

export function catalogSearchUrl(): string {
  return "/api/v1/catalog/search";
}

export function catalogDetailUrl(id: string): string {
  return "/api/v1/catalog/" + id;
}

export function catalogSimilarUrl(id: string): string {
  return "/api/v1/catalog/" + id + "/similar";
}

export function viewsUrl(): string {
  return "/api/v1/views";
}

export function viewResolveUrl(id: string): string {
  return "/api/v1/views/" + id + "/resolve";
}

// -- 4.9 Artwork -----------------------------------------------------------

export function artworkWorkUrl(workId: string, kind: string): string {
  return "/api/v1/artwork/work/" + workId + "/" + kind;
}

export function artworkAlbumUrl(artistWorkId: string, albumId: string, kind: string): string {
  return "/api/v1/artwork/album/" + artistWorkId + "/" + albumId + "/" + kind;
}

export function mediaThumbnailUrl(mediaFileId: string): string {
  return "/api/v1/media/" + mediaFileId + "/thumbnail";
}

// -- 4.10 Playback negotiation ------------------------------------------------

export function playbackInfoUrl(mediaFileId: string): string {
  return "/api/v1/playback/" + mediaFileId;
}

// -- 4.11 Fetching bytes -----------------------------------------------------

export function mediaStreamUrl(mediaFileId: string): string {
  return "/api/v1/media/" + mediaFileId + "/stream";
}

export function mediaChaptersUrl(mediaFileId: string): string {
  return "/api/v1/media/" + mediaFileId + "/chapters";
}

export function mediaMetadataUrl(mediaFileId: string): string {
  return "/api/v1/media/" + mediaFileId + "/metadata";
}

export function mediaSubtitleUrl(mediaFileId: string, streamIndex: number): string {
  return "/api/v1/media/" + mediaFileId + "/subtitles/" + String(streamIndex);
}

// -- 4.12 Playback session reporting ------------------------------------------

export function playbackEventsUrl(sessionId: string): string {
  return "/api/v1/playback/sessions/" + sessionId + "/events";
}

export function playbackProgressListUrl(): string {
  return "/api/v1/playback/progress";
}

export function playbackProgressUrl(mediaFileId: string): string {
  return "/api/v1/playback/" + mediaFileId + "/progress";
}
