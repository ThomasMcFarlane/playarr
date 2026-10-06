/**
 * Stable device identity, for the two things that actually need it: the
 * `EnsureAccessTokenIdentity` a later `src/auth/session.ts` sends on every
 * login/refresh (`deviceName`, and `deviceId` when more than one session
 * must be distinguishable per install), and diagnostics.
 *
 * `getOrCreateDeviceId` is imported verbatim from `@playarr-tv/device-auth`
 * rather than reimplemented here: it already does exactly the right thing
 * once this app's `src/bootstrap/polyfills.ts` and
 * `src/platform/storage/localStorageShim.ts` have run (it prefers
 * `crypto.randomUUID()` -- which polyfills.ts installs, backed by
 * `react-native-uuid`, design doc §3.2 -- and persists the result under
 * `streamarr:session`'s sibling key `streamarr:deviceId` via `localStorage`
 * -- which the shim makes real). Re-deriving device-id generation here
 * would be a second, competing implementation of something
 * `@playarr-tv/device-auth` already owns correctly.
 *
 * Deliberately NOT used for `deviceId`, even though it looks tempting:
 * `@amazon-devices/react-native-device-info`'s `getUniqueId`/
 * `getUniqueIdSync` (verified present, see `modelName`/`osBuildVersion`
 * below for the two of its exports this file DOES use). A hardware-level
 * identifier is a different concept from what `LoginRequest.device_id`
 * actually wants -- `deviceId.ts`'s own doc comment is explicit that this
 * id exists so `Policy::device_allow`/`max_concurrent_sessions` can
 * recognise one INSTALL, not one physical device across reinstalls. Tying
 * it to hardware would mean reinstalling Playarr never gets a fresh device
 * identity, which is the wrong behaviour for that policy.
 */
import {Platform} from 'react-native';
import {getModel, getSystemVersion} from '@amazon-devices/react-native-device-info';
import {getOrCreateDeviceId} from '@playarr-tv/device-auth';
import {APP_CONFIG} from '../config/appConfig';

export interface DeviceInfo {
  /** Stable per-install id -- see `getOrCreateDeviceId`'s own doc comment for exactly what it's used for and why it must stay stable. */
  deviceId: string;
  /** This app's own display name, as sent to the server on login/refresh. Not a hardware name -- see `APP_CONFIG.deviceName`'s comment for why "Playarr for Fire TV" is the whole app's identity here, not a per-model string. */
  deviceName: string;
  /** `Platform.OS` -- `"kepler"` on every real Vega device and the virtual device alike (design doc §1.1). */
  osName: string;
  /** `Platform.Version`, stringified -- RN types this loosely across platforms, and nothing here needs it as anything but a display/diagnostic string. */
  osVersion: string;
  /** e.g. "Fire TV Stick 4K" -- best-effort, for diagnostics/support only, never a security or identity value. `undefined` if the native call throws or returns something that isn't a non-empty string, rather than surfacing a native error to a caller that only wanted a label. */
  modelName: string | undefined;
  /** The underlying OS build string `getSystemVersion()` reports -- distinct from `osVersion` (`Platform.Version`, RN's own cross-platform notion), kept alongside it because the two are not guaranteed to agree and diagnostics benefit from both. Same best-effort/`undefined`-on-failure contract as `modelName`. */
  osBuildVersion: string | undefined;
}

/**
 * `@amazon-devices/react-native-device-info`'s own types describe several
 * of its getters (including the two called below) as returning `any` --
 * not this app's choice, the package's own shipped `.d.ts` -- so this
 * guards the actual runtime value rather than trusting that type. A
 * confirmed-real, confirmed-synchronous package (per this project's own
 * `npm install` and a direct read of its installed `lib/commonjs/index.js`)
 * can still hand back something unexpected on a given device; this is what
 * turns "unexpected" into "diagnostic field is undefined" instead of a
 * crash.
 */
function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function getDeviceInfo(): DeviceInfo {
  return {
    deviceId: getOrCreateDeviceId(),
    deviceName: APP_CONFIG.deviceName,
    osName: Platform.OS,
    osVersion: String(Platform.Version),
    modelName: stringOrUndefined(getModel()),
    osBuildVersion: stringOrUndefined(getSystemVersion()),
  };
}
