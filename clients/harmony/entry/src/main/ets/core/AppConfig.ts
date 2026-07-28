// core/AppConfig.ts
//
// Compatibility identity: the wire names Playarr for HarmonyOS reports to
// the Playarr Server so playback-session analytics, the admin Activity
// screen and the compatibility table can tell a living-room session from a
// handset one. One HAP serves phone, tablet/foldable and Huawei Vision TV;
// the runtime device type decides which identity is reported.
//
// This is the ONLY file under core/ allowed to contain the literal wire-name
// strings "harmony-mobile" and "harmony-tv". Every other file in core/ (and
// every layer above it) must import HARMONY_MOBILE_PLATFORM /
// HARMONY_TV_PLATFORM, or call resolveClientPlatform, from here: never
// redeclare the literals elsewhere.
//
// No ArkUI, no @kit./@ohos. imports, no decorators: plain, Linux-testable
// TypeScript.

// Display name shown in about screens and device-pairing prompts.
export const clientName: string = "Playarr for HarmonyOS";

// MUST always equal AppScope/app.json5's app.versionName exactly. Pinned by
// a contract test: update both together.
export const clientVersion: string = "0.1.0";

// ClientPlatform wire names (see Rust `ClientPlatform::wire_name()`,
// `rename_all = "kebab-case"`). Declared exactly once, here.
export const HARMONY_MOBILE_PLATFORM: string = "harmony-mobile";
export const HARMONY_TV_PLATFORM: string = "harmony-tv";

// Catalog / search page-size and similarity-limit defaults (brief section
// 4.8): server defaults Playarr intentionally matches on every request.
export const catalogPageSize: number = 50;
export const searchLimit: number = 25;
export const similarLimit: number = 20;

// Resolves `deviceInfo.deviceType` to a ClientPlatform wire name.
//
// Only the literal deviceType "tv" reports the HarmonyTv variant. Every
// other known deviceType (phone, tablet, 2in1, default, wearable, car) and
// any value this build does not yet recognise reports HarmonyMobile, so an
// unrecognised deviceType degrades safely toward the touch profile rather
// than the D-pad one.
export function resolveClientPlatform(deviceType: string): string {
  if (deviceType === "tv") {
    return HARMONY_TV_PLATFORM;
  }
  return HARMONY_MOBILE_PLATFORM;
}
