/**
 * Sidecar-subtitle handling (design doc §6.3): `addTextTrack(kind, label,
 * language, uri, mimeType)`'s `uri` is fetched by the native subtitle
 * pipeline, not by this app's own JS -- and design doc §6.1's table assumes
 * that pipeline cannot attach `Authorization` any more than
 * `VideoPlayer.src` can (assumption A2's sibling for subtitles). Every
 * Streamarr subtitle sidecar (`PlaybackSubtitleTrackOption.url`) requires a
 * bearer token, so handing that URL straight to `addTextTrack` would 401.
 *
 * The fix is the same shape design doc §6.3 describes: fetch the VTT with a
 * real, authed JS `fetch()` (where `Authorization` genuinely works, no
 * platform assumption involved at all -- unlike the media pipeline, RN's
 * `fetch()` is not restricted from setting it), write the bytes to
 * app-private storage via `@amazon-devices/kepler-file-system`, and hand
 * `addTextTrack` a local path instead of the authed URL.
 *
 * `@amazon-devices/kepler-file-system` is deliberately NOT a static `import`
 * at the top of this file, unlike every other module under
 * `platform/media/`: a static `import` runs the package's own module-level
 * code immediately (it calls `TurboModuleRegistry.getEnforcing(...)` at ITS
 * OWN top level, confirmed by actually running this file's tests against a
 * real static import before writing it this way), which throws under Jest
 * with no Vega/Kepler host to register that native module -- long before
 * this file's own `options.fileSystem` injection point would ever get a
 * chance to skip it. `loadRealFileSystem()`'s `require()` below is
 * deferred instead: it only runs if `downloadSubtitleToLocalFile` is ever
 * called WITHOUT an injected `fileSystem` (every real production call site
 * doesn't inject one; every test in `subtitles.test.ts` does), matching the
 * same "tests never touch the real native module" outcome
 * `platform/storage/asyncStorage.ts`'s split from `localStorageShim.ts`
 * achieves via a second file -- not worth a second file for a module this
 * size, so it lives here as one function instead.
 */
import type {ExternalSubtitleTrack} from '@playarr-tv/player-core';
import {attachAuth} from './authTransport';

/** The one `KeplerFileSystem` method this file actually calls, narrowed for injection in tests -- mirrors `platform/storage/localStorageShim.ts`'s `AsyncStorageLike` pattern. */
export interface SubtitleFileSystem {
  writeStringToFile(path: string, content: string, encoding: string): Promise<number>;
}

function loadRealFileSystem(): SubtitleFileSystem {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {KeplerFileSystem} = require('@amazon-devices/kepler-file-system') as {
    KeplerFileSystem: SubtitleFileSystem;
  };
  return KeplerFileSystem;
}

export interface DownloadSubtitleOptions {
  /** Reads the current access token for the authed VTT fetch; may be async. */
  getAccessToken: () => string | undefined | Promise<string | undefined>;
  /** Injectable for tests; defaults to RN's global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to the real `@amazon-devices/kepler-file-system`. */
  fileSystem?: SubtitleFileSystem;
}

/**
 * `/data` is Kepler's one writable, app-private, reboot-and-upgrade-durable
 * directory (`@amazon-devices/kepler-file-system`'s own README, confirmed
 * directly, not guessed -- see this project's `node_modules` copy). The
 * package exposes no directory-creation call at all (only
 * `removeDir`/`removeDirAll`), so every subtitle file is written flat
 * directly under `/data` rather than a subdirectory this app cannot itself
 * create ahead of time. `trackId` is caller-owned (`ExternalSubtitleTrack.id`,
 * ultimately a `PlaybackSubtitleTrackOption.id` from the server) and is
 * sanitised the same way `player-avplay`'s own `subtitleFileName` sanitises
 * its (unrelated) SAMI filenames, for the same reason: never trust a
 * server-supplied string directly into a filesystem path.
 */
function subtitleFilePath(trackId: string): string {
  const safeId = trackId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'subtitle';
  return `/data/playarr-subtitle-${safeId}.vtt`;
}

/**
 * Downloads `track.url` with a bearer token and writes it to app-private
 * storage, returning a `file://`-prefixed local path -- the exact form
 * `platform/capabilities.ts`'s `fileUriSubtitleTracks` flag's own doc
 * comment names as the current, unverified assumption about what
 * `addTextTrack`'s `uri` parameter accepts. Deciding whether to call this
 * function at all (i.e. respecting that flag, and falling back to "sidecar
 * unavailable" rather than throwing if it is ever flipped `false`) is the
 * caller's job (`VegaPlaybackEngine.addExternalSubtitleTracks`) -- this
 * function's own contract is simpler: download-and-write, or throw with a
 * real reason if either step fails.
 */
export async function downloadSubtitleToLocalFile(
  track: ExternalSubtitleTrack,
  options: DownloadSubtitleOptions
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fileSystem = options.fileSystem ?? loadRealFileSystem();

  const headers: Record<string, string> = {};
  await attachAuth(headers, {kind: 'subtitle', getAccessToken: options.getAccessToken});

  const response = await fetchImpl(track.url, {headers});
  if (!response.ok) {
    throw new Error(`Could not download subtitle "${track.id}" (${response.status})`);
  }
  const vttText = await response.text();

  const path = subtitleFilePath(track.id);
  await fileSystem.writeStringToFile(path, vttText, 'UTF-8');

  return `file://${path}`;
}
