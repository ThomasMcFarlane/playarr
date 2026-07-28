/**
 * Runtime device-profile bootstrap (brief sections 6.1 and 6.2).
 *
 * `deviceInfo.deviceType` is read exactly ONCE, at window-stage creation,
 * and closed over for the process lifetime: brief section 6.1 requires
 * `platformWireName` to be resolved once and never change mid-session,
 * because it stamps every playback session. Window size, by contrast, is
 * re-read on every window-size-change callback (fold/unfold, split-screen
 * resize, external-display hand-off) -- `inputMode` / `formFactor`
 * legitimately do change with window size while the app keeps running.
 *
 * IMPORTANT (brief section 6.1): compare `deviceInfo.deviceType` against
 * the raw string literals ("phone" | "tablet" | "tv" | "2in1" | "wearable"
 * | "car" | "default"), never against `deviceInfo.DeviceTypes` -- that enum
 * was only added in API 20 and this project targets API 12.
 *
 * The resolved `DeviceProfile` (`core/DeviceProfile.ts`'s `resolveProfile`)
 * is published into `AppStorage` under `DEVICE_PROFILE_STORAGE_KEY` so every
 * other layer reads it reactively via `@StorageProp`, per the brief's
 * `device/` layer-responsibility note ("writes a DeviceProfile into
 * AppStorage under a single key. Everything downstream reads it reactively
 * via @StorageProp").
 *
 * The TV design-space scale factor `k = windowWidthVp / 1920` (brief
 * section 6.2) is published alongside it, under `TV_STAGE_SCALE_STORAGE_KEY`,
 * for `design/Metrics.ets` (built in a parallel workflow) to consume via
 * `Metrics.tv(n) => n * k`. It is recomputed on every update regardless of
 * `formFactor` (one division -- cheap), even though it is only meaningful
 * while `metricsKey === "tv"` (the `tv` and `wide` form factors);
 * `Metrics.ets` decides when to apply it.
 */

import { deviceInfo } from '@kit.BasicServicesKit';
import { display, window } from '@kit.ArkUI';

import { DeviceProfile, resolveProfile } from '../core/DeviceProfile.ts';
import { logError } from '../util/Log';

// AppStorage keys. Exported so `design/Metrics.ets`, `design/Theme.ets` and
// any other reactive consumer import these constants rather than restating
// the key strings.
export const DEVICE_PROFILE_STORAGE_KEY: string = 'deviceProfile';
export const TV_STAGE_SCALE_STORAGE_KEY: string = 'tvStageScale';

const LOG_TAG: string = 'DeviceProfileService';

// The TV design space is exactly 1920 x 1080 vp (brief section 6.2).
const TV_DESIGN_WIDTH_VP: number = 1920;

interface WindowSizeVp {
  widthVp: number;
  heightVp: number;
}

/**
 * `k = windowWidthVp / 1920` -- the single scale factor every TV-stage
 * metric must use, per brief section 6.2's recommended approach: read the
 * real window width and treat every TV metric as a ratio of the 1920 vp
 * design canvas, rather than a nested `.scale()` transform (which would
 * blur text). This survives a 4K panel reporting a different vp width.
 */
export function computeTvStageScale(windowWidthVp: number): number {
  return windowWidthVp / TV_DESIGN_WIDTH_VP;
}

/**
 * Reads the main window's current size in px (`getWindowProperties().
 * windowRect`) and converts it to vp using the default display's current
 * `densityPixels`, per brief section 6.1's exact recipe. Re-read on every
 * call (never cached) so a display hand-off or fold/unfold that changes
 * density mid-session is always honoured.
 */
function currentWindowSizeVp(win: window.Window): WindowSizeVp {
  const properties: window.WindowProperties = win.getWindowProperties();
  const rect: window.Rect = properties.windowRect;
  const densityPixels: number = display.getDefaultDisplaySync().densityPixels;
  const sizeVp: WindowSizeVp = {
    widthVp: rect.width / densityPixels,
    heightVp: rect.height / densityPixels,
  };
  return sizeVp;
}

/**
 * Resolves the current `DeviceProfile` from the (fixed) `deviceType` and the
 * window's current vp size, then publishes both it and the TV stage scale
 * factor into `AppStorage`.
 */
function publishDeviceProfile(deviceType: string, win: window.Window): void {
  const sizeVp: WindowSizeVp = currentWindowSizeVp(win);
  const profile: DeviceProfile = resolveProfile(deviceType, sizeVp.widthVp, sizeVp.heightVp);
  AppStorage.setOrCreate<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY, profile);
  AppStorage.setOrCreate<number>(TV_STAGE_SCALE_STORAGE_KEY, computeTvStageScale(sizeVp.widthVp));
}

/**
 * Installs the device-profile service on `windowStage`. Call exactly ONCE,
 * from `EntryAbility.onWindowStageCreate`.
 *
 * Reads `deviceInfo.deviceType` once and captures it for the callback's
 * lifetime -- see the file-header note on why it must never be re-read on
 * resize. Publishes the initial profile immediately, then again on every
 * subsequent `windowSizeChange` event for as long as this window stage
 * lives. Never throws back to the caller: any failure is logged and the
 * previously published profile (if any) simply stays live in `AppStorage`.
 */
export function installDeviceProfileService(windowStage: window.WindowStage): void {
  try {
    const deviceType: string = deviceInfo.deviceType;
    const win: window.Window = windowStage.getMainWindowSync();

    publishDeviceProfile(deviceType, win);

    win.on('windowSizeChange', (): void => {
      try {
        publishDeviceProfile(deviceType, win);
      } catch (err) {
        // Never let a resize callback crash the app -- the previous
        // profile stays live in AppStorage until the next successful
        // update.
        logError(LOG_TAG, 'failed to update device profile on window size change: ' + String(err));
      }
    });
  } catch (err) {
    logError(LOG_TAG, 'failed to install device profile service: ' + String(err));
  }
}
