/**
 * App-sandbox file helpers for short-lived downloaded content. The one
 * caller today is `data/SubtitleRepository.ets` (brief 4.11): a bearer-gated
 * sidecar VTT track has to be downloaded, written to a real file, and handed
 * to AVPlayer as a file descriptor via `addSubtitleFromFd`, because
 * `addSubtitleFromUrl` cannot carry an `Authorization` header.
 *
 * Everything here lives under `<context.tempDir>/playback_sandbox`.
 * `context.tempDir` is HarmonyOS's own scratch directory for this app:
 * content there is expected to survive for the lifetime of one app run and
 * is not guaranteed to survive a restart, which matches a sidecar subtitle
 * download's actual lifetime (one playback session), unlike `filesDir`
 * (durable) or a bare `cacheDir` (shared with other cache concerns).
 *
 * `initSandbox(context)` must be called exactly once, from `EntryAbility`'s
 * bootstrap wiring, before any other function below is used -- the same
 * "call init first, or throw" discipline `auth/SettingsStore.ets` already
 * established (`initSettingsStore`). `AppContainer.ets` bootstraps
 * `net`/`auth`/`device`, not this file, since a sandbox is not a `net`/
 * `auth` concern; `entryability/EntryAbility.ets` wires this up directly,
 * alongside `bootstrapAppContainer`.
 *
 * `writeBytes` and `openFd` never throw -- any underlying `@kit.CoreFileKit`
 * failure is caught, logged, and reported back as `false` / `null`, matching
 * this project's general "never throw across a util boundary" discipline
 * (`net/HttpTransport.ets`, `util/Uuid.ets`). `cleanupStaleSandboxFiles`
 * never rejects for the same reason -- it is meant to be called
 * fire-and-forget on sign-out and on app start.
 */

import { fileIo } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';

import { logError, logWarn } from './Log';

const LOG_TAG: string = 'Sandbox';

/** Every file this module writes lives directly inside this subdirectory of `context.tempDir`, so cleanup can target exactly this tree. */
const SANDBOX_SUBDIRECTORY: string = 'playback_sandbox';

/**
 * A file older than this is treated as stale and safe to delete during
 * `cleanupStaleSandboxFiles`. A sidecar subtitle download is used for at
 * most one playback session; ten minutes comfortably covers a session that
 * is still starting up while leaving no realistic risk of deleting a file
 * still in active use by a long-running one (the file itself is read once,
 * up front, by `addSubtitleFromFd` -- not re-read continuously off disk).
 */
const STALE_FILE_AGE_MS: number = 10 * 60 * 1000;

let appContext: common.Context | null = null;

/**
 * Wires this module to the application context. Call exactly once, early in
 * `EntryAbility`'s lifecycle, before any function below is used. Safe to
 * call again (e.g. in a test harness) -- it simply replaces the stored
 * context.
 */
export function initSandbox(context: common.Context): void {
  appContext = context;
}

function requireContext(): common.Context {
  if (appContext === null) {
    throw new Error('Sandbox: initSandbox(context) must be called before use');
  }
  return appContext;
}

/** The sandbox directory path, creating it on first use if it does not exist yet. */
function sandboxDirectory(): string {
  const context = requireContext();
  const directory = context.tempDir + '/' + SANDBOX_SUBDIRECTORY;
  if (!fileIo.accessSync(directory)) {
    fileIo.mkdirSync(directory);
  }
  return directory;
}

/** Resolves `relativePath` (a bare file name, e.g. `"subtitle-<session>-<index>.vtt"`, never a leading slash) onto the sandbox directory. */
function resolvePath(relativePath: string): string {
  return sandboxDirectory() + '/' + relativePath;
}

/**
 * Writes `data` to `relativePath` inside the sandbox: opens (creating the
 * file if it does not exist, truncating it if it does, so a retried
 * download of the same relative path never appends onto a partial previous
 * write), writes the whole buffer, then closes. Returns `true` on success,
 * `false` on any failure (logged here; never thrown).
 */
export function writeBytes(relativePath: string, data: ArrayBuffer): boolean {
  let file: fileIo.File | null = null;
  try {
    const path = resolvePath(relativePath);
    const mode = fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC;
    file = fileIo.openSync(path, mode);
    fileIo.writeSync(file.fd, data);
    return true;
  } catch (err) {
    const asError = err as Error;
    logError(LOG_TAG, 'failed to write a sandbox file: ' + asError.message);
    return false;
  } finally {
    if (file !== null) {
      fileIo.closeSync(file.fd);
    }
  }
}

/**
 * Opens `relativePath` (already written via `writeBytes`) read-only and
 * returns its file descriptor, suitable for AVPlayer's `addSubtitleFromFd`
 * (brief 4.11). The caller owns the returned fd from this point on. Returns
 * `null` on any failure (logged here; never thrown) -- e.g. the file was
 * never successfully written, or has already been cleaned up.
 */
export function openFd(relativePath: string): number | null {
  try {
    const path = resolvePath(relativePath);
    const file: fileIo.File = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
    return file.fd;
  } catch (err) {
    const asError = err as Error;
    logError(LOG_TAG, 'failed to open a sandbox file for reading: ' + asError.message);
    return null;
  }
}

/**
 * Deletes every file directly inside the sandbox directory older than
 * `STALE_FILE_AGE_MS`. Call on sign-out and on app start, so sidecar
 * subtitle downloads do not accumulate forever. Never rejects: a single
 * file that fails to stat or delete is logged and skipped rather than
 * aborting the rest of the sweep, and a failure to even list the directory
 * (e.g. it does not exist yet on a fresh install) is likewise logged and
 * treated as nothing-to-clean rather than an error.
 */
export async function cleanupStaleSandboxFiles(): Promise<void> {
  let directory: string;
  let names: string[];
  try {
    directory = sandboxDirectory();
    names = fileIo.listFileSync(directory);
  } catch (err) {
    const asError = err as Error;
    logWarn(LOG_TAG, 'failed to prepare the sandbox directory for cleanup: ' + asError.message);
    return;
  }

  const nowMs = Date.now();
  for (const name of names) {
    const path = directory + '/' + name;
    try {
      const stat = fileIo.statSync(path);
      const ageMs = nowMs - stat.mtime * 1000;
      if (ageMs >= STALE_FILE_AGE_MS) {
        fileIo.unlinkSync(path);
      }
    } catch (err) {
      const asError = err as Error;
      logWarn(LOG_TAG, 'failed to clean up a stale sandbox file: ' + asError.message);
    }
  }
}
