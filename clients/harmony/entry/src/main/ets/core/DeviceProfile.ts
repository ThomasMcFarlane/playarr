/**
 * Pure resolver from HarmonyOS device characteristics to a `DeviceProfile`.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * `device/DeviceProfileService.ets` reads `deviceInfo.deviceType` and the
 * current window size at ability creation (and on every window-size
 * change), then calls straight into `resolveProfile` below and publishes
 * the result into `AppStorage`. Unit tests call the same function directly.
 *
 * INTENTIONAL EXCEPTION: the offline validator's source contract check
 * normally restricts the literals "harmony-tv" and "harmony-mobile" to
 * `core/AppConfig.ts` only. `core/DeviceProfile.ts` is the one additional
 * file allowed to contain them: `AppConfig.resolveClientPlatform` is the
 * runtime, `device.deviceInfo`-driven entry point, while this module is
 * the pure/testable resolver that both `AppConfig` and unit tests call
 * into, so importing `AppConfig.ts` from here would create a circular
 * dependency. This duplication of the literal strings is expected per the
 * brief's design, and the offline validator already accounts for this file
 * by name -- do not add these literals to a third file without also
 * updating the validator.
 */

export interface DeviceProfile {
  inputMode: "touch" | "dpad";
  formFactor: "phone" | "tablet" | "wide" | "tv";
  platformWireName: string;
  metricsKey: "tv" | "touch";
}

function buildDeviceProfile(
  inputMode: "touch" | "dpad",
  formFactor: "phone" | "tablet" | "wide" | "tv",
  platformWireName: string,
  metricsKey: "tv" | "touch"
): DeviceProfile {
  const profile: DeviceProfile = {
    inputMode: inputMode,
    formFactor: formFactor,
    platformWireName: platformWireName,
    metricsKey: metricsKey
  };
  return profile;
}

/**
 * Resolve a `DeviceProfile` from the raw `deviceInfo.deviceType` string and
 * the current window size in vp.
 *
 * Table (brief section 6.1):
 *
 * | Input                              | inputMode | formFactor | platformWireName | metricsKey |
 * |-------------------------------------|-----------|------------|-------------------|------------|
 * | deviceType === "tv"                 | dpad      | tv         | harmony-tv        | tv         |
 * | deviceType === "2in1", or           |           |            |                   |            |
 * |   widthVp >= 1280                   | touch     | wide       | harmony-mobile    | tv         |
 * | deviceType === "tablet" AND         |           |            |                   |            |
 * |   widthVp >= 760                    | touch     | tablet     | harmony-mobile    | touch      |
 * | everything else                     | touch     | phone      | harmony-mobile    | touch      |
 *
 * Plus iOS's full breakpoint predicate (not a width-only test), so a phone
 * in landscape is never misclassified as the "wide" / TV-metrics stage:
 * treat as compact/phone when `widthVp <= 760`, or when the formFactor
 * would otherwise be "phone" and `widthVp <= 920 && heightVp <= 500`.
 *
 * The `widthVp <= 760` guard only ever reclassifies a tentative "wide"
 * result (e.g. a "2in1" device folded down to a narrow width) back to
 * "phone" -- it must NOT run against a tentative "tablet" result, because
 * the tablet row's own breakpoint is `widthVp >= 760` and the two would
 * otherwise both fire, and disagree, at exactly `widthVp === 760`. Per
 * iOS's `PlayarrLayout.isPhone`, this guard's job is only to stop
 * mis-promotion into the wide / TV-metrics stage.
 */
export function resolveProfile(deviceType: string, widthVp: number, heightVp: number): DeviceProfile {
  if (deviceType === "tv") {
    return buildDeviceProfile("dpad", "tv", "harmony-tv", "tv");
  }

  let formFactor: "phone" | "tablet" | "wide" = "phone";

  if (deviceType === "2in1" || widthVp >= 1280) {
    formFactor = "wide";
  } else if (deviceType === "tablet" && widthVp >= 760) {
    formFactor = "tablet";
  } else {
    formFactor = "phone";
  }

  const isCompactWide: boolean = formFactor === "wide" && widthVp <= 760;
  const isCompactPhoneLandscape: boolean =
    formFactor === "phone" && widthVp <= 920 && heightVp <= 500;
  if (isCompactWide || isCompactPhoneLandscape) {
    formFactor = "phone";
  }

  if (formFactor === "wide") {
    return buildDeviceProfile("touch", "wide", "harmony-mobile", "tv");
  }
  if (formFactor === "tablet") {
    return buildDeviceProfile("touch", "tablet", "harmony-mobile", "touch");
  }
  return buildDeviceProfile("touch", "phone", "harmony-mobile", "touch");
}
