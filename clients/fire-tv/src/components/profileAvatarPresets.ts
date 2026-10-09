/**
 * The six gradient avatar presets every `ProfileAvatar` renders from,
 * deterministically keyed off a profile's own id -- design doc §7's closing
 * paragraph: "Six gradient presets rendered at runtime via linear-gradient --
 * no pre-baked PNGs needed (unlike Roku)".
 *
 * This is a harvest, not a fresh invention, and deliberately a SEPARATE copy
 * rather than an import: the source of truth is
 * `clients/tv-web/web/src/lib/profileAvatar.ts`'s `PROFILE_AVATAR_PRESETS`
 * array and its `defaultProfileAvatarPreset` hash function, copied
 * character-for-character (the same colour pairs, the same `hash * 31 +
 * charCode` loop, the same `>>> 0` unsigned-coercion and modulo). That file
 * lives under `clients/tv-web/web/src/lib/`, not `clients/tv-web/packages/`
 * -- and only `packages/*` sources are aliased into this project via
 * `metro.config.js`'s `watchFolders`/`extraNodeModules` (design doc §4.1).
 * `web/src/lib` is simply unreachable from here, the same reason
 * `theme/tokens.ts` harvests colours from `global.css` by hand rather than
 * importing it. Any future change to the web app's preset list or hash
 * algorithm must be mirrored here by hand; there is no build step that keeps
 * the two in sync.
 *
 * The preset artwork itself is no longer copied by hand: `profileAvatarArt.generated.ts` is generated from the shared
 * `clients/shared/profile-avatars/presets.json` (`scripts/gen-avatar-art.mjs`), and `ProfileAvatar.tsx` also renders the
 * account's custom photo (`{kind: 'custom', dataUrl}`) from the server preference. The colour pairs and the hash below
 * stay here because they are needed without the SVG layer; `profileAvatarArt.test.ts` fails if they drift from
 * `presets.json`.
 */

export interface ProfileAvatarPreset {
  id: string;
  /** Gradient start colour, top-left. */
  start: string;
  /** Gradient end colour, bottom-right. */
  end: string;
}

/**
 * Character-for-character copy of
 * `clients/tv-web/web/src/lib/profileAvatar.ts`'s `PROFILE_AVATAR_PRESETS`
 * -- see this file's own doc comment for why it is a copy, not an import.
 *
 * Deliberately `as const satisfies readonly ProfileAvatarPreset[]`, NOT a
 * plain `: readonly ProfileAvatarPreset[]` type annotation -- an explicit
 * annotation widens every `id` to `ProfileAvatarPreset`'s own `string`
 * field type, throwing away the exact six-literal union `as const` would
 * otherwise infer. `satisfies` (TypeScript ~4.9, Vega's own pinned
 * version -- design doc §3.2) checks structural compatibility with
 * `ProfileAvatarPreset[]` WITHOUT widening the inferred type the way an
 * annotation does, so `ProfileAvatarPresetId` below still resolves to the
 * real closed union `'astronaut' | 'cat' | 'dinosaur' | 'robot' | 'pirate'
 * | 'alien'` -- which matters because `ProfileAvatar.tsx`'s `PresetGlyph`
 * switches over exactly that union and needs it exhaustively checkable.
 */
export const PROFILE_AVATAR_PRESETS = [
  {id: 'astronaut', start: '#5267ad', end: '#222d5f'},
  {id: 'cat', start: '#e37c68', end: '#9c3f66'},
  {id: 'dinosaur', start: '#55a46e', end: '#237265'},
  {id: 'robot', start: '#5d9caf', end: '#365383'},
  {id: 'pirate', start: '#d39a48', end: '#91464c'},
  {id: 'alien', start: '#8b71c5', end: '#4a477f'},
] as const satisfies readonly ProfileAvatarPreset[];

export type ProfileAvatarPresetId = (typeof PROFILE_AVATAR_PRESETS)[number]['id'];

/**
 * Deterministically picks one of the six presets above from a profile id --
 * the same profile always renders the same gradient/glyph on every device
 * and every launch, with no server round trip and nothing to persist. Ported
 * unchanged from `defaultProfileAvatarPreset` in the web app's
 * `lib/profileAvatar.ts`: a simple polynomial rolling hash (`hash * 31 +
 * charCode`, coerced to an unsigned 32-bit integer after every step so the
 * accumulator can never go negative and break the modulo below), then
 * reduced onto the preset list's own length. Deliberately NOT
 * cryptographic and not claimed to be -- uniform-enough distribution across
 * six buckets for typically-short UUID/username-shaped ids is the entire
 * requirement, and this is pure, dependency-free arithmetic precisely so it
 * can be unit-tested without a Kepler host (see this file's `.test.ts`
 * sibling).
 */
// The return type is deliberately `(typeof PROFILE_AVATAR_PRESETS)[number]`,
// NOT the wider `ProfileAvatarPreset` interface: annotating the interface
// would widen the result's `id` field back to plain `string`, throwing away
// the exact six-literal union `PROFILE_AVATAR_PRESETS`'s `as const satisfies`
// declaration preserves (see that declaration's own doc comment) -- and
// `ProfileAvatar.tsx`'s `PresetGlyph` needs that literal union intact to
// exhaustively switch over `preset.id` without a `default` case.
export function pickProfileAvatarPreset(profileId: string): (typeof PROFILE_AVATAR_PRESETS)[number] {
  let hash = 0;
  for (let index = 0; index < profileId.length; index += 1) {
    hash = (hash * 31 + profileId.charCodeAt(index)) >>> 0;
  }
  const preset = PROFILE_AVATAR_PRESETS[hash % PROFILE_AVATAR_PRESETS.length];
  // PROFILE_AVATAR_PRESETS is a non-empty readonly literal, so `% length`
  // always lands on a real element -- the non-null assertion documents
  // that invariant rather than papering over a genuine possibility of
  // `undefined`.
  return preset!;
}
