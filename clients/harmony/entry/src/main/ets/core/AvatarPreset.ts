/**
 * Deterministic default avatar preset for a user id. This MUST match
 * `clients/tv-web/web/src/lib/profileAvatar.ts`'s
 * `defaultProfileAvatarPreset` bit-for-bit (brief section 5.11:
 * "`core/AvatarPreset.ts` must match tv-web bit-for-bit -- unit-test it
 * against fixture ids").
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * Algorithm, copied verbatim from tv-web:
 *   hash = 0
 *   for each character in userId: hash = (hash * 31 + charCodeAt) >>> 0
 *   preset = presets[((hash % 6) + 6) % 6]
 *
 * The `>>> 0` is applied after EVERY multiply-add (not just once at the
 * end), which is exactly what tv-web's loop does -- this keeps `hash` an
 * unsigned 32-bit integer at every step so intermediate wraparound
 * behaviour matches bit-for-bit, not just the final value. Because `hash`
 * is already a non-negative unsigned 32-bit integer going into the final
 * `% 6`, the `((h % 6) + 6) % 6` normalisation can never actually change the
 * result -- it is kept anyway because the brief pins it as the final step.
 *
 * Preset ids, in the exact order tv-web declares `PROFILE_AVATAR_PRESETS`
 * and brief section 5.11 lists them:
 */
const AVATAR_PRESET_IDS: string[] = ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"];

/**
 * Resolve the deterministic default avatar preset id for a user id. Purely
 * a function of `userId` -- no I/O, no randomness, no clock.
 */
export function resolveAvatarPreset(userId: string): string {
  let hash: number = 0;
  for (const character of userId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const index: number = ((hash % 6) + 6) % 6;
  return AVATAR_PRESET_IDS[index];
}
