/**
 * The public surface of the platform adapter layer. Design doc §1's single
 * governing rule: `src/platform/` is the only directory in this app allowed
 * to `import` from `@amazon-devices/*`, so that if one of the design's
 * unverified assumptions about Vega turns out wrong (§1.3's A1-A9), the
 * blast radius is a fix in one file under here -- never a screen, never a
 * component, never this barrel's own export list (which is deliberately
 * shaped around *concepts* -- remote input, focus, lifecycle, device
 * identity, capability flags, storage -- rather than around whichever
 * native package happens to implement each one today).
 *
 * Every screen, hook, and component elsewhere in this app imports from
 * `'../platform'` (or the appropriate relative path to this file), never
 * from an individual file under this directory and never from
 * `@amazon-devices/*` directly. That is a convention this file cannot
 * enforce by itself -- there is no lint config in this repo yet to make it
 * a build error (design doc §9.4 R27) -- so it is written here, in the one
 * place every future import of this layer starts from.
 */

// --- Remote control input (remote.ts) -----------------------------------
export {useRemoteKey} from './remote';
export type {RemoteKey, RemoteHardwareEvent} from './remote';

// --- Focus (focus.ts) ----------------------------------------------------
export {TvFocusScope, focusNode, blurNode, trapFocusWithin, getFocusedTag, useDefaultFocus, focusDefaultTarget} from './focus';
export type {TvFocusScopeProps, FocusDirection} from './focus';

// --- App lifecycle / de-duplicated back navigation (lifecycle.ts) -------
export {useBackHandler, useAppForeground} from './lifecycle';

// --- Device identity (deviceInfo.ts) -------------------------------------
export {getDeviceInfo} from './deviceInfo';
export type {DeviceInfo} from './deviceInfo';

// --- Unverified-on-device capability flags (capabilities.ts) -------------
export {CAPABILITIES} from './capabilities';
export type {Capabilities} from './capabilities';

// --- Storage --------------------------------------------------------------
// Composed here rather than leaving app code to import asyncStorage.ts and
// localStorageShim.ts separately and wire them together itself -- the only
// thing outside this layer should need to know is "await this, once,
// before rendering", not which concrete AsyncStorage-shaped value backs it.
import {asyncStorage} from './storage/asyncStorage';
import {hydrateLocalStorage} from './storage/localStorageShim';

/**
 * Hydrates `globalThis.localStorage` from Vega's real AsyncStorage. Must be
 * awaited before the first render -- see `src/bootstrap/hydrate.ts` and
 * `localStorageShim.ts`'s own doc comment for exactly what breaks if it
 * isn't.
 */
export async function hydrateStorage(): Promise<void> {
  await hydrateLocalStorage(asyncStorage);
}
